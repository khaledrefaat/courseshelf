//! Repair only the pinned generator's zero-duration boundary fragments. User
//! sidecars never pass through this code. Never invent or reverse timestamps.
use super::paths::MAX_VTT;

struct Cue {
    start: u64,
    end: u64,
    timing: String,
    text: String,
}

fn timestamp(value: &str) -> Result<u64, String> {
    let invalid = || "Generated subtitles contain an invalid timestamp.".to_owned();
    let (time, millis) = value.split_once('.').ok_or_else(invalid)?;
    let parts: Vec<_> = time.split(':').collect();
    if parts.len() != 3
        || parts[0].len() < 2
        || parts[1].len() != 2
        || parts[2].len() != 2
        || millis.len() != 3
        || !parts
            .iter()
            .all(|part| part.bytes().all(|b| b.is_ascii_digit()))
        || !millis.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(invalid());
    }
    let hours: u64 = parts[0].parse().map_err(|_| invalid())?;
    let minutes: u64 = parts[1].parse().map_err(|_| invalid())?;
    let seconds: u64 = parts[2].parse().map_err(|_| invalid())?;
    let millis: u64 = millis.parse().map_err(|_| invalid())?;
    if minutes >= 60 || seconds >= 60 {
        return Err(invalid());
    }
    hours
        .checked_mul(3_600_000)
        .and_then(|h| h.checked_add(minutes * 60_000 + seconds * 1000 + millis))
        .ok_or_else(invalid)
}

fn join_text(first: &str, second: &str) -> String {
    format!("{} {}", first.trim_end(), second.trim_start())
}

pub fn normalize(content: &str) -> Result<String, String> {
    if content.len() as u64 > MAX_VTT {
        return Err("Generated subtitles exceed the 2 MiB limit.".into());
    }
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let mut blocks = normalized.split("\n\n");
    if blocks.next() != Some("WEBVTT") {
        return Err("Generated subtitles must have a WEBVTT header.".into());
    }
    let mut cues: Vec<Cue> = Vec::new();
    let mut pending: Option<Cue> = None;
    let mut changed = false;
    let mut count = 0;
    for block in blocks.filter(|block| !block.trim().is_empty()) {
        count += 1;
        if count > 10_000 {
            return Err("Generated subtitles exceed the 10,000 cue limit.".into());
        }
        let (timing, text) = block
            .split_once('\n')
            .ok_or("Generated subtitles contain an invalid cue.")?;
        let (start, end) = timing
            .split_once(" --> ")
            .ok_or("Generated subtitles contain an invalid cue.")?;
        let mut cue = Cue {
            start: timestamp(start)?,
            end: timestamp(end)?,
            timing: timing.into(),
            text: text.trim().into(),
        };
        if cue.end < cue.start {
            return Err(format!(
                "Generated subtitle cue {count} ends before it starts ({timing})."
            ));
        }
        if cue.end == cue.start {
            changed = true;
            if cue.text.is_empty() {
                continue;
            }
            if pending.is_none()
                && let Some(previous) = cues.last_mut()
                && previous.end == cue.start
            {
                previous.text = join_text(&previous.text, &cue.text);
            } else if let Some(fragment) = pending.as_mut() {
                if fragment.start != cue.start {
                    return Err("Generated zero-duration subtitle fragments have no matching neighbor. No timing was guessed.".into());
                }
                fragment.text = join_text(&fragment.text, &cue.text);
            } else {
                pending = Some(cue);
            }
            continue;
        }
        if let Some(fragment) = pending.take() {
            if fragment.start != cue.start {
                return Err("Generated zero-duration subtitle fragment has no matching neighbor. No timing was guessed.".into());
            }
            cue.text = join_text(&fragment.text, &cue.text);
        }
        // Do not create an empty timed cue as an anchor for a text fragment.
        if !cue.text.is_empty() {
            cues.push(cue);
        }
    }
    if pending.is_some() {
        return Err("Generated zero-duration subtitle fragment has no matching neighbor. No timing was guessed.".into());
    }
    if cues.is_empty() {
        return Err("Generated subtitles contain no readable cues.".into());
    }
    if !changed {
        return Ok(content.to_owned());
    }
    let mut output = String::from("WEBVTT\n\n");
    for cue in cues {
        output.push_str(&cue.timing);
        output.push('\n');
        output.push_str(&cue.text);
        output.push_str("\n\n");
    }
    if output.len() as u64 > MAX_VTT {
        return Err("Normalized subtitles exceed the size limit.".into());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_valid_generator_output_byte_for_byte() {
        for text in [
            "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n Hello.\n\n",
            "WEBVTT\r\n\r\n01:02:03.400 --> 01:02:05.600\r\n مرحبا\r\n\r\n",
        ] {
            assert_eq!(normalize(text).unwrap(), text);
        }
    }

    #[test]
    fn folds_the_171680_ms_boundary_fragment_into_its_preceding_cue_without_shifting_timing() {
        let text = "WEBVTT\n\n00:02:50.080 --> 00:02:51.680\n These are the same\n\n00:02:51.680 --> 00:02:51.680\n ideas.\n\n00:02:51.680 --> 00:02:54.320\n A new sentence.\n\n";
        assert_eq!(
            normalize(text).unwrap(),
            "WEBVTT\n\n00:02:50.080 --> 00:02:51.680\nThese are the same ideas.\n\n00:02:51.680 --> 00:02:54.320\nA new sentence.\n\n"
        );
    }

    #[test]
    fn handles_leading_consecutive_and_trailing_fragments_without_losing_words() {
        let text = "WEBVTT\n\n00:00:00.000 --> 00:00:00.000\nFirst\n\n00:00:00.000 --> 00:00:00.000\nsecond\n\n00:00:00.000 --> 00:00:01.000\nthird\n\n00:00:01.000 --> 00:00:01.000\nfourth\n\n00:00:01.000 --> 00:00:01.000\nfifth\n\n";
        assert_eq!(
            normalize(text).unwrap(),
            "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFirst second third fourth fifth\n\n"
        );
    }

    #[test]
    fn rejects_reversed_or_unanchored_cues_and_invalid_timestamps_instead_of_guessing() {
        for text in [
            "00:00:02.000 --> 00:00:01.000\nReversed",
            "00:00:01.000 --> 00:00:01.000\nNo neighbor",
            "00:00:01.000 --> 00:00:01.000\nGap\n\n00:00:02.000 --> 00:00:03.000\nNext",
            "00:00:00.000 --> 00:00:01.000\nPrevious\n\n00:00:02.000 --> 00:00:02.000\nGap",
            "00:00:00.000 --> 00:00:00.000\nFirst\n\n00:00:01.000 --> 00:00:01.000\nDifferent boundary",
            "00:60:00.000 --> 01:01:00.000\nInvalid minutes",
            "00:00:00.00 --> 00:00:01.000\nInvalid precision",
            "99999999999999999999:00:00.000 --> 99999999999999999999:00:01.000\nOverflow",
        ] {
            assert!(normalize(&format!("WEBVTT\n\n{text}")).is_err(), "{text}");
        }
    }

    #[test]
    fn ignores_only_empty_zero_length_fragments_and_enforces_limits() {
        assert!(normalize("WEBVTT\n\n00:00:00.000 --> 00:00:00.000\n ").is_err());
        assert_eq!(
            normalize(
                "WEBVTT\n\n00:00:00.000 --> 00:00:00.000\n \n\n00:00:00.000 --> 00:00:01.000\nHello"
            )
            .unwrap(),
            "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n\n"
        );
        assert_eq!(normalize("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n\n00:00:01.000 --> 00:00:01.000\n \n").unwrap(), "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n\n");
        let too_many = format!(
            "WEBVTT\n\n{}",
            "00:00:00.000 --> 00:00:01.000\nx\n\n".repeat(10_001)
        );
        assert!(normalize(&too_many).unwrap_err().contains("10,000"));
        assert!(
            normalize(&"x".repeat(MAX_VTT as usize + 1))
                .unwrap_err()
                .contains("2 MiB")
        );
    }
}
