#[cfg(target_os = "linux")]
fn fullscreen_flag(state: gtk::gdk::WindowState) -> bool {
    state.contains(gtk::gdk::WindowState::FULLSCREEN)
}

// Synchronous Tauri commands execute on the main thread, as required by GTK.
// Read-only: no resize, maximize or fullscreen state changes are performed here.
#[tauri::command]
pub fn actual_window_fullscreen(window: tauri::Window) -> Result<Option<bool>, String> {
    if window.label() != "main" {
        return Err("Only the main window may inspect its fullscreen state".into());
    }
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        let native = window.gtk_window().map_err(|error| error.to_string())?;
        let surface = native.window().ok_or("Main window has no GDK surface")?;
        Ok(Some(fullscreen_flag(surface.state())))
    }
    #[cfg(not(target_os = "linux"))]
    Ok(None)
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use gtk::gdk::WindowState;

    #[test]
    fn maximized_is_not_fullscreen_and_fullscreen_preserves_other_flags() {
        assert!(!fullscreen_flag(WindowState::empty()));
        assert!(!fullscreen_flag(WindowState::MAXIMIZED));
        assert!(fullscreen_flag(WindowState::FULLSCREEN));
        assert!(fullscreen_flag(
            WindowState::MAXIMIZED | WindowState::FULLSCREEN
        ));
        assert!(!fullscreen_flag(
            WindowState::MAXIMIZED | WindowState::FOCUSED
        ));
    }
}
