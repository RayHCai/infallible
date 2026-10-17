//! Tauri shell for the visualizer. Rust is only the window host; all logic is
//! in the TypeScript frontend, which talks to the driver over HTTP/WS directly.

/// Builds and runs the Tauri application.
///
/// # Panics
///
/// Panics if the Tauri runtime fails to start (e.g. no display available).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the Infallible visualizer");
}
