#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Ensure the GTK/KDE window decoration icon matches Logo B.
            // Desktop/taskbar icons come from hicolor; the titlebar menu uses
            // the window icon, which WebKit can also overwrite from favicon.
            #[cfg(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "openbsd"
            ))]
            {
                use tauri::image::Image;
                use tauri::Manager;

                if let Some(window) = app.get_webview_window("main") {
                    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;
                    window.set_icon(icon)?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Octavo");
}
