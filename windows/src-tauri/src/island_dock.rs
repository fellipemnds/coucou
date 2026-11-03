//! Fork: on Windows the island docks in the bottom-left corner of the taskbar,
//! where Windows 11 shows Widgets, and opens upwards from there.

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering::Relaxed};
use tauri::{AppHandle, Manager, Monitor};

pub const ON: bool = cfg!(windows);

static RAISE_IN: AtomicU8 = AtomicU8::new(0);
static WAS_DOWN: AtomicBool = AtomicBool::new(false);
static TICKS: AtomicU8 = AtomicU8::new(0);
static HIDDEN: AtomicBool = AtomicBool::new(false);

/// Called on every cursor-poll tick, even when the cursor did not move. A click
/// on the taskbar brings it over topmost windows, covering the pill: shortly
/// after each click, put the island back on top.
pub fn after_tick(app: &AppHandle) {
    if !ON {
        return;
    }
    // Twice a second: a full-screen app (video, game, slides) hides the taskbar, and the pill goes with it.
    if TICKS.fetch_add(1, Relaxed) % 30 == 0 {
        let full = fullscreen();
        if HIDDEN.swap(full, Relaxed) != full {
            if let Some(w) = app.get_webview_window(crate::island::WINDOW_LABEL) {
                place(&w, if full { Show::Hide } else { Show::Show });
            }
        }
    }
    let down = crate::platform::left_button_down();
    if WAS_DOWN.swap(down, Relaxed) && !down {
        // ~150 ms at 60 Hz, once the shell has raised the taskbar.
        RAISE_IN.store(10, Relaxed);
        return;
    }
    match RAISE_IN.load(Relaxed) {
        0 => {}
        1 => {
            RAISE_IN.store(0, Relaxed);
            if let Some(w) = app.get_webview_window(crate::island::WINDOW_LABEL) {
                place(&w, Show::Keep);
            }
        }
        n => RAISE_IN.store(n - 1, Relaxed),
    }
}

enum Show {
    Keep,
    Show,
    Hide,
}

/// Puts the island back on top of the topmost band, never taking the focus.
#[cfg(windows)]
fn place(win: &tauri::WebviewWindow, show: Show) {
    use ::windows::Win32::Foundation::HWND;
    use ::windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_ASYNCWINDOWPOS, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, SWP_SHOWWINDOW,
    };
    let Ok(h) = win.hwnd() else { return };
    let hwnd = HWND(h.0 as isize as *mut _);
    let mut flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS;
    match show {
        Show::Keep => {}
        Show::Show => flags |= SWP_SHOWWINDOW,
        Show::Hide => flags |= SWP_HIDEWINDOW,
    }
    unsafe {
        let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, flags);
    }
}

#[cfg(not(windows))]
fn place(_: &tauri::WebviewWindow, _: Show) {}

/// A full-screen app, a full-screen game or presentation mode, as Windows reports it.
#[cfg(windows)]
fn fullscreen() -> bool {
    use ::windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    matches!(
        unsafe { SHQueryUserNotificationState() },
        Ok(s) if s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE
    )
}

#[cfg(not(windows))]
fn fullscreen() -> bool {
    false
}

/// Logical height of the compact pill (`NOTCH_H` in core/layout.ts) and its gaps.
const PILL_H: f64 = 32.0;
const GAP: f64 = 12.0;
/// Extra window height: open, the panel floats above the taskbar (`LIFT` in island/dock.ts).
pub const LIFT: f64 = if ON { 48.0 } else { 0.0 };

/// Physical top-left of a window `ph` tall whose bottom edge is the pill's bottom edge.
pub fn origin(m: &Monitor, ph: u32) -> (i32, i32) {
    let (mp, ms, wa) = (m.position(), m.size(), m.work_area());
    let bottom = pill_bottom(
        mp.y + ms.height as i32,
        wa.position.y + wa.size.height as i32,
        m.scale_factor(),
    );
    (mp.x + (GAP * m.scale_factor()).round() as i32, bottom - ph as i32)
}

/// Centred in a taskbar docked at the bottom; above the work area otherwise
/// (auto-hidden taskbar, or one on another edge).
fn pill_bottom(monitor_bottom: i32, work_bottom: i32, scale: f64) -> i32 {
    let band = monitor_bottom - work_bottom;
    let pill = (PILL_H * scale).round() as i32;
    if band >= pill && band < (200.0 * scale) as i32 {
        monitor_bottom - (band - pill) / 2
    } else {
        work_bottom - (GAP * scale).round() as i32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pill_sits_in_the_taskbar_or_above_it() {
        // 48 px taskbar at 100 %: 8 px above and below the 32 px pill.
        assert_eq!(pill_bottom(1080, 1032, 1.0), 1072);
        // 150 %: 72 px taskbar, 48 px pill.
        assert_eq!(pill_bottom(1620, 1548, 1.5), 1608);
        // Auto-hidden taskbar: no band, the pill floats just above the edge.
        assert_eq!(pill_bottom(1080, 1080, 1.0), 1068);
        // Taskbar on another edge of a display placed below the primary one.
        assert_eq!(pill_bottom(2160, 2160, 1.0), 2148);
    }
}
