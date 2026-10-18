mod backup_target;
mod course_scanner;
mod fs_links;
mod startup;
mod video_stream;
mod window_state;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must run before plugins open the shared database or restore folder grants.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            #[cfg(windows)]
            if startup::waiting(app) {
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            #[cfg(windows)]
            startup::install(app.handle())?;
            app.manage(video_stream::VideoStream::new()?);
            // Inspect bundled production CSP without granting frontend devtools access.
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            Ok(())
        })
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(
                    "sqlite:courseshelf.db",
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "initial_schema",
                            sql: include_str!("../../src/lib/db/migrations/0001_initial.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 2,
                            description: "missing_lessons",
                            sql: include_str!(
                                "../../src/lib/db/migrations/0002_missing_lessons.sql"
                            ),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 3,
                            description: "lesson_durations",
                            sql: include_str!(
                                "../../src/lib/db/migrations/0003_lesson_durations.sql"
                            ),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 4,
                            description: "course_archived",
                            sql: include_str!(
                                "../../src/lib/db/migrations/0004_course_archived.sql"
                            ),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            startup::frontend_ready,
            window_state::actual_window_fullscreen,
            video_stream::register_course_roots,
            video_stream::register_course_root,
            video_stream::unregister_course_root,
            backup_target::validate_backup_target,
            video_stream::get_media_session,
            video_stream::get_lesson_url,
            course_scanner::canonicalize_course_root,
            course_scanner::scan_course_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
