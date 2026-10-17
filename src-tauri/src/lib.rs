mod course_scanner;
mod video_stream;

use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(video_stream::VideoStream::new()?);
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
                    ],
                )
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            video_stream::register_course_roots,
            video_stream::register_course_root,
            video_stream::get_media_session,
            video_stream::get_lesson_url,
            course_scanner::canonicalize_course_root,
            course_scanner::scan_course_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
