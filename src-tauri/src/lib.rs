mod video_stream;

use tauri::Manager;

#[tauri::command]
fn select_video(
    app: tauri::AppHandle,
    state: tauri::State<'_, video_stream::VideoStream>,
    path: String,
) -> Result<String, String> {
    let path = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let home = std::fs::canonicalize(home).map_err(|error| error.to_string())?;
    if !path.starts_with(home)
        || !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("mp4"))
    {
        return Err("Choose an MP4 inside your home directory".into());
    }
    state.select(&path).map_err(|error| error.to_string())
}

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
                    vec![tauri_plugin_sql::Migration {
                        version: 1,
                        description: "initial_schema",
                        sql: include_str!("../../src/lib/db/migrations/0001_initial.sql"),
                        kind: tauri_plugin_sql::MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, select_video])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
