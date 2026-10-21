use super::*;
use std::fs;

#[test]
fn commands_are_main_document_only_and_dev_origin_is_not_a_release_origin() {
    for url in [
        "tauri://localhost",
        "tauri://localhost#/course/1",
        "tauri://localhost/#/course/1",
        "http://tauri.localhost/index.html#/course/1",
    ] {
        assert!(allowed_document("main", &url.parse().unwrap(), false));
        assert!(!allowed_document("other", &url.parse().unwrap(), false));
    }
    let development = "http://localhost:1420/#/course/1".parse().unwrap();
    assert!(allowed_document("main", &development, true));
    assert!(!allowed_document("main", &development, false));
    for url in [
        "https://example.com/",
        "tauri://localhost/?query=1",
        "tauri://localhost/other.html",
        "http://tauri.localhost.evil/",
        "http://localhost:1420.evil/",
        "http://127.0.0.1:1421/",
        "http://user:secret@tauri.localhost/",
    ] {
        if let Ok(parsed) = url.parse() {
            assert!(!allowed_document("main", &parsed, true));
        }
    }
}

fn fixture() -> (PathBuf, Checkpoint) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/flashcard-tests")
        .join(storage::random_id().unwrap());
    fs::create_dir_all(&root).unwrap();
    let checkpoint = Checkpoint {
        version: 1,
        id: "a".repeat(64),
        lesson: Lesson {
            course_id: 1,
            lesson_id: 2,
            relative_path: "lesson.mp4".into(),
            generated: None,
        },
        source_hash: "b".repeat(64),
        source_fingerprint: "c".repeat(64),
        model: http::MODEL.into(),
        prompt_version: PROMPT.into(),
        validator_version: VALIDATOR.into(),
        sections: vec![Bounds {
            first_cue: 1,
            last_cue: 3,
        }],
        requests: vec![],
    };
    (root, checkpoint)
}
#[test]
fn prompt_version_matches_renderer_and_rejects_old_native_checkpoints_without_rewriting() {
    let core = include_str!("../../../src/lib/flashcards/core.ts");
    assert!(core.contains(&format!("PROMPT_VERSION = \"{PROMPT}\"")));
    assert!(core.contains(&format!("VALIDATOR_VERSION = \"{VALIDATOR}\"")));
    let (root, mut checkpoint) = fixture();
    checkpoint.prompt_version = "flashcards-trial-7".into();
    checkpoint.validator_version = "flashcards-validator-6".into();
    let dir = storage::lesson_dir(&root, 1, 2).unwrap();
    storage::save(&dir, &checkpoint).unwrap();
    let original = fs::read(dir.join("manifest.json")).unwrap();
    let error = storage::load(&dir).err().unwrap();
    assert!(error.contains("Saved cards and partial responses were kept"));
    assert_eq!(fs::read(dir.join("manifest.json")).unwrap(), original);
    assert_eq!(checkpoint.prompt_version, "flashcards-trial-7");
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn checkpoints_preserve_received_responses_hashes_and_uncertain_requests_without_reissuing() {
    let (root, mut checkpoint) = fixture();
    let dir = storage::lesson_dir(&root, 1, 2).unwrap();
    storage::save(&dir, &checkpoint).unwrap();
    checkpoint.requests.push(Record {
        stage: "section-1".into(),
        status: "started".into(),
        hash: None,
    });
    storage::save(&dir, &checkpoint).unwrap();
    let uncertain = storage::load(&dir).unwrap().unwrap();
    assert!(!uncertain.resumable());
    assert!(storage::replies(&dir, &uncertain).unwrap().is_empty());
    let reply = Reply {
        content: "invalid model JSON is still retained".into(),
        usage: None,
        model: http::MODEL.into(),
        finish_reason: "stop".into(),
    };
    checkpoint.requests[0].hash = Some(storage::save_reply(&dir, 0, &reply).unwrap());
    checkpoint.requests[0].status = "received".into();
    storage::save(&dir, &checkpoint).unwrap();
    let restored = storage::load(&dir).unwrap().unwrap();
    assert!(restored.resumable());
    assert_eq!(
        storage::replies(&dir, &restored).unwrap()[0].content,
        reply.content
    );
    assert!(storage::save_reply(&dir, 0, &reply).is_err());
    fs::write(dir.join("response-0.json"), "changed").unwrap();
    assert!(storage::replies(&dir, &restored).is_err());
    storage::clear(&dir).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn resume_rejects_changed_sources_and_unknown_requests_and_renews_publication_identity() {
    let (root, mut checkpoint) = fixture();
    let dir = storage::lesson_dir(&root, 1, 2).unwrap();
    let source = Source {
        content: String::new(),
        filename: "lesson.vtt".into(),
        source_hash: checkpoint.source_hash.clone(),
        source_fingerprint: checkpoint.source_fingerprint.clone(),
    };
    let reply = Reply {
        content: "{}".into(),
        usage: None,
        model: http::MODEL.into(),
        finish_reason: "stop".into(),
    };
    let hash = storage::save_reply(&dir, 0, &reply).unwrap();
    checkpoint.requests.push(Record {
        stage: "section-1".into(),
        status: "received".into(),
        hash: Some(hash.clone()),
    });
    storage::save(&dir, &checkpoint).unwrap();
    let resumed =
        resume_checkpoint(&dir, &checkpoint.lesson, &source, &checkpoint.sections).unwrap();
    assert_ne!(resumed.id, checkpoint.id);
    assert_eq!(resumed.requests[0].hash.as_ref(), Some(&hash));
    let mut changed = source.clone();
    changed.source_hash = "d".repeat(64);
    assert!(resume_checkpoint(&dir, &checkpoint.lesson, &changed, &checkpoint.sections).is_err());
    let mut other = checkpoint.lesson.clone();
    other.relative_path = "other.mp4".into();
    assert!(resume_checkpoint(&dir, &other, &source, &checkpoint.sections).is_err());
    let mut uncertain = resumed;
    uncertain.requests.push(Record {
        stage: "selection".into(),
        status: "started".into(),
        hash: None,
    });
    storage::save(&dir, &uncertain).unwrap();
    assert!(resume_checkpoint(&dir, &checkpoint.lesson, &source, &checkpoint.sections).is_err());
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn stage_order_versions_ids_and_hard_bounds_are_enforced() {
    let (root, mut checkpoint) = fixture();
    assert!(checkpoint.validate().is_ok());
    checkpoint.requests.push(Record {
        stage: "selection".into(),
        status: "started".into(),
        hash: None,
    });
    assert!(checkpoint.validate().is_err());
    checkpoint.requests.clear();
    checkpoint.sections = vec![Bounds {
        first_cue: 2,
        last_cue: 3,
    }];
    assert!(checkpoint.validate().is_err());
    checkpoint.sections = vec![
        Bounds {
            first_cue: 1,
            last_cue: 3,
        },
        Bounds {
            first_cue: 5,
            last_cue: 6,
        },
    ];
    assert!(checkpoint.validate().is_err());
    checkpoint.sections = vec![Bounds {
        first_cue: 1,
        last_cue: 10_001,
    }];
    assert!(checkpoint.validate().is_err());
    assert!(!valid_id("../x"));
    assert!(!valid_id(&"A".repeat(64)));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn explicit_recovery_preserves_originals_and_copies_only_the_confirmed_prefix() {
    let (root, mut checkpoint) = fixture();
    let base = storage::lesson_dir(&root, 1, 2).unwrap();
    for index in 0..2 {
        let reply = Reply {
            content: format!("response-{index}"),
            usage: None,
            model: http::MODEL.into(),
            finish_reason: "stop".into(),
        };
        checkpoint.requests.push(Record {
            stage: checkpoint.stage(index),
            status: "received".into(),
            hash: Some(storage::save_reply(&base, index, &reply).unwrap()),
        });
    }
    storage::save(&base, &checkpoint).unwrap();
    let original = fs::read(base.join("manifest.json")).unwrap();
    let original_response = fs::read(base.join("response-1.json")).unwrap();
    let (active, retry) = storage::recover(&base, &checkpoint, 1).unwrap();
    assert_ne!(retry.id, checkpoint.id);
    assert_eq!(retry.requests.len(), 1);
    assert_eq!(storage::active_dir(&base).unwrap(), active);
    assert_eq!(
        storage::replies(&active, &retry).unwrap()[0].content,
        "response-0"
    );
    assert!(!active.join("response-1.json").exists());
    assert_eq!(fs::read(base.join("manifest.json")).unwrap(), original);
    assert_eq!(
        fs::read(base.join("response-1.json")).unwrap(),
        original_response
    );
    assert!(storage::recover(&base, &checkpoint, 0).is_err()); // stale confirmation
    assert!(storage::recover(&base, &retry, 1).is_err()); // no failed suffix
    // An interrupted request is never converted into a paid retry.
    let mut uncertain = retry.clone();
    uncertain.requests.push(Record {
        stage: "selection".into(),
        status: "started".into(),
        hash: None,
    });
    storage::save(&active, &uncertain).unwrap();
    assert!(storage::recover(&base, &uncertain, 1).is_err());
    assert_eq!(fs::read(base.join("manifest.json")).unwrap(), original);
    // Explicit discard clears only the owned files, including both bounded slots.
    storage::clear(&base).unwrap();
    assert_eq!(fs::read_dir(&base).unwrap().count(), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn repeated_recovery_is_bounded_and_failed_or_unsafe_staging_never_switches_the_active_checkpoint()
{
    let (root, mut checkpoint) = fixture();
    let base = storage::lesson_dir(&root, 1, 2).unwrap();
    let reply = Reply {
        content: "invalid received response".into(),
        usage: None,
        model: http::MODEL.into(),
        finish_reason: "length".into(),
    };
    checkpoint.requests.push(Record {
        stage: "section-1".into(),
        status: "received".into(),
        hash: Some(storage::save_reply(&base, 0, &reply).unwrap()),
    });
    storage::save(&base, &checkpoint).unwrap();
    let original = fs::read(base.join("manifest.json")).unwrap();
    let (mut active, mut current) = storage::recover(&base, &checkpoint, 0).unwrap();
    for _ in 0..4 {
        current.requests.push(Record {
            stage: "section-1".into(),
            status: "received".into(),
            hash: Some(storage::save_reply(&active, 0, &reply).unwrap()),
        });
        storage::save(&active, &current).unwrap();
        (active, current) = storage::recover(&base, &current, 0).unwrap();
    }
    assert_eq!(fs::read(base.join("manifest.json")).unwrap(), original);
    assert_eq!(
        fs::read_dir(&base)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_dir())
            .count(),
        2
    );
    current.requests.push(Record {
        stage: "section-1".into(),
        status: "received".into(),
        hash: Some(storage::save_reply(&active, 0, &reply).unwrap()),
    });
    storage::save(&active, &current).unwrap();
    let inactive = base.join(if active.ends_with("retry-a") {
        "retry-b"
    } else {
        "retry-a"
    });
    fs::write(inactive.join("personal.txt"), "keep").unwrap();
    assert!(storage::recover(&base, &current, 0).is_err());
    assert_eq!(storage::active_dir(&base).unwrap(), active);
    assert!(storage::clear(&base).is_err());
    assert_eq!(fs::read(base.join("manifest.json")).unwrap(), original);
    assert_eq!(
        fs::read_to_string(inactive.join("personal.txt")).unwrap(),
        "keep"
    );
    fs::remove_file(inactive.join("personal.txt")).unwrap();
    // Corrupt response hashes cannot seed recovery.
    fs::write(active.join("response-0.json"), "tampered").unwrap();
    assert!(storage::recover(&base, &current, 0).is_err());
    assert_eq!(storage::active_dir(&base).unwrap(), active);
    storage::clear(&base).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn recovery_binds_the_current_source_lesson_sections_and_versions_before_mutation() {
    let (root, mut checkpoint) = fixture();
    let base = storage::lesson_dir(&root, 1, 2).unwrap();
    let reply = Reply {
        content: "{}".into(),
        usage: None,
        model: http::MODEL.into(),
        finish_reason: "stop".into(),
    };
    checkpoint.requests.push(Record {
        stage: "section-1".into(),
        status: "received".into(),
        hash: Some(storage::save_reply(&base, 0, &reply).unwrap()),
    });
    storage::save(&base, &checkpoint).unwrap();
    let bytes = fs::read(base.join("manifest.json")).unwrap();
    let retry = Recovery {
        checkpoint: checkpoint.clone(),
        keep: 0,
    };
    let source = Source {
        content: String::new(),
        filename: "lesson.vtt".into(),
        source_hash: checkpoint.source_hash.clone(),
        source_fingerprint: checkpoint.source_fingerprint.clone(),
    };
    let mut changed_source = source.clone();
    changed_source.source_hash = "d".repeat(64);
    assert!(
        recover_checkpoint(
            &base,
            &checkpoint.lesson,
            &changed_source,
            &checkpoint.sections,
            &retry
        )
        .is_err()
    );
    changed_source = source.clone();
    changed_source.source_fingerprint = "d".repeat(64);
    assert!(
        recover_checkpoint(
            &base,
            &checkpoint.lesson,
            &changed_source,
            &checkpoint.sections,
            &retry
        )
        .is_err()
    );
    let mut other = checkpoint.lesson.clone();
    other.relative_path = "other.mp4".into();
    assert!(recover_checkpoint(&base, &other, &source, &checkpoint.sections, &retry).is_err());
    let bounds = vec![Bounds {
        first_cue: 1,
        last_cue: 4,
    }];
    assert!(recover_checkpoint(&base, &checkpoint.lesson, &source, &bounds, &retry).is_err());
    checkpoint.prompt_version = "old".into();
    storage::save(&base, &checkpoint).unwrap();
    assert!(
        recover_checkpoint(
            &base,
            &checkpoint.lesson,
            &source,
            &checkpoint.sections,
            &retry
        )
        .is_err()
    );
    assert!(!base.join("active.json").exists());
    checkpoint.prompt_version = PROMPT.into();
    storage::save(&base, &checkpoint).unwrap();
    assert_eq!(fs::read(base.join("manifest.json")).unwrap(), bytes);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn recovery_rejects_linked_slots_and_pointer_files() {
    use std::os::unix::fs::symlink;
    let (root, mut checkpoint) = fixture();
    let base = storage::lesson_dir(&root, 1, 2).unwrap();
    let outside = root.join("outside");
    fs::create_dir(&outside).unwrap();
    let reply = Reply {
        content: "{}".into(),
        usage: None,
        model: http::MODEL.into(),
        finish_reason: "stop".into(),
    };
    checkpoint.requests.push(Record {
        stage: "section-1".into(),
        status: "received".into(),
        hash: Some(storage::save_reply(&base, 0, &reply).unwrap()),
    });
    storage::save(&base, &checkpoint).unwrap();
    symlink(&outside, base.join("retry-a")).unwrap();
    assert!(storage::recover(&base, &checkpoint, 0).is_err());
    assert!(storage::clear(&base).is_err());
    assert!(base.join("manifest.json").exists());
    fs::remove_file(base.join("retry-a")).unwrap();
    let private = outside.join("private.json");
    fs::write(&private, "\"retry-a\"").unwrap();
    symlink(&private, base.join("active.json")).unwrap();
    assert!(storage::active_dir(&base).is_err());
    assert!(storage::recover(&base, &checkpoint, 0).is_err());
    assert_eq!(fs::read_to_string(private).unwrap(), "\"retry-a\"");
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn cleanup_is_course_scoped_and_never_recurses_into_unknown_files() {
    let (root, checkpoint) = fixture();
    let own = storage::lesson_dir(&root, 1, 2).unwrap();
    let other = storage::lesson_dir(&root, 3, 4).unwrap();
    storage::save(&own, &checkpoint).unwrap();
    storage::save(&other, &checkpoint).unwrap();
    fs::write(own.join("personal.txt"), "do not delete").unwrap();
    assert!(storage::clean_course(&root, 1).is_err());
    assert!(own.join("manifest.json").exists());
    fs::remove_file(own.join("personal.txt")).unwrap();
    storage::clean_course(&root, 1).unwrap();
    assert!(!own.exists());
    assert!(other.join("manifest.json").exists());
    fs::remove_dir_all(root).unwrap();
}
#[cfg(unix)]
#[test]
fn checkpoints_refuse_linked_directories_files_and_oversized_payloads() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let (root, checkpoint) = fixture();
    let dir = storage::lesson_dir(&root, 1, 2).unwrap();
    assert_eq!(
        fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
        0o700
    );
    let outside = root.join("outside.json");
    fs::write(&outside, "private").unwrap();
    symlink(&outside, dir.join("manifest.json")).unwrap();
    assert!(storage::load(&dir).is_err());
    assert!(storage::clear(&dir).is_err());
    fs::remove_file(dir.join("manifest.json")).unwrap();
    storage::save(&dir, &checkpoint).unwrap();
    assert_eq!(
        fs::metadata(dir.join("manifest.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    fs::File::create(dir.join("manifest.json"))
        .unwrap()
        .set_len(65_537)
        .unwrap();
    assert!(storage::load(&dir).is_err());
    assert_eq!(fs::read_to_string(&outside).unwrap(), "private");
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn cancellation_aborts_matching_jobs_and_does_not_need_a_player() {
    let (root, checkpoint) = fixture();
    let state = Flashcards::default();
    let aborted = Arc::new(AtomicBool::new(false));
    let observed = aborted.clone();
    let job = Arc::new(Job {
        base_directory: root.clone(),
        id: checkpoint.id.clone(),
        lesson: checkpoint.lesson.clone(),
        source: Source {
            content: "WEBVTT".into(),
            filename: "lesson.vtt".into(),
            source_hash: checkpoint.source_hash.clone(),
            source_fingerprint: checkpoint.source_fingerprint.clone(),
        },
        directory: root.clone(),
        checkpoint: Mutex::new(checkpoint),
        cancelled: AtomicBool::new(false),
        in_flight: AtomicBool::new(false),
        abort: Mutex::new(Some(Box::new(move || {
            observed.store(true, Ordering::SeqCst);
        }))),
    });
    *state.job.lock().unwrap() = Some(job.clone());
    state.cancel(Some(3));
    assert!(job.check().is_ok());
    assert!(!aborted.load(Ordering::SeqCst));
    state.cancel(Some(1));
    assert!(job.check().is_err());
    assert!(aborted.load(Ordering::SeqCst));
    fs::remove_dir_all(root).unwrap();
}
