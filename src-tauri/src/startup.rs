#[cfg(any(windows, test))]
#[derive(Default)]
struct RevealOnce(std::sync::Mutex<bool>);

#[cfg(any(windows, test))]
impl RevealOnce {
    fn revealed(&self) -> bool {
        *self.0.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn reveal(&self, show: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
        let mut revealed = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if !*revealed {
            show()?;
            *revealed = true;
        }
        Ok(())
    }
}

#[cfg(windows)]
use tauri::Manager;

#[cfg(windows)]
fn reveal_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.state::<RevealOnce>().reveal(|| {
        window.show().map_err(|error| error.to_string())?;
        // Focus is best effort; a focus refusal must not cause another reveal.
        let _ = window.set_focus();
        Ok(())
    })
}

#[cfg(windows)]
pub fn install(app: &tauri::AppHandle) -> std::io::Result<()> {
    app.manage(RevealOnce::default());
    let app = app.clone();
    std::thread::Builder::new()
        .name("startup-reveal-fallback".into())
        .spawn(move || {
            // Independent of JS, RAF and database/registration success. An error
            // before React mounts must not leave an invisible process forever.
            std::thread::sleep(std::time::Duration::from_secs(5));
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(window) = handle.get_webview_window("main")
                    && let Err(error) = reveal_main(&window)
                {
                    eprintln!("Could not reveal the startup window: {error}");
                }
            });
        })?;
    Ok(())
}

#[cfg(windows)]
pub fn waiting(app: &tauri::AppHandle) -> bool {
    // The second-instance callback can arrive before setup installs the gate.
    app.try_state::<RevealOnce>()
        .is_none_or(|gate| !gate.revealed())
}

#[tauri::command]
pub fn frontend_ready(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window may signal startup readiness".into());
    }
    #[cfg(windows)]
    reveal_main(&window)?;
    // Non-Windows startup visibility is unchanged.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    #[test]
    fn ready_timeout_and_remounts_reveal_once_without_reopening_a_minimized_window() {
        let gate = RevealOnce::default();
        let shows = AtomicUsize::new(0);
        assert!(!gate.revealed());
        for _ in 0..3 {
            gate.reveal(|| {
                shows.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
            .unwrap();
        }
        assert!(gate.revealed());
        assert_eq!(shows.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn failed_reveal_remains_pending_for_the_fallback_to_retry() {
        let gate = RevealOnce::default();
        assert!(gate.reveal(|| Err("show failed".into())).is_err());
        assert!(!gate.revealed());
        gate.reveal(|| Ok(())).unwrap();
        assert!(gate.revealed());
    }

    #[test]
    fn concurrent_ready_and_fallback_do_not_duplicate_the_reveal() {
        let gate = Arc::new(RevealOnce::default());
        let shows = Arc::new(AtomicUsize::new(0));
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let gate = gate.clone();
                let shows = shows.clone();
                std::thread::spawn(move || {
                    gate.reveal(|| {
                        shows.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    })
                    .unwrap()
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(shows.load(Ordering::SeqCst), 1);
    }
}
