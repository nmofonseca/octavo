#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // KDE/Plasma titlebar "window menu" uses _NET_WM_ICON / themed
            // icon-name — not the AppImage/hicolor taskbar path alone.
            // PR #16 set a single large PNG via set_icon; that is not enough
            // when WebKit or the WM falls back to a stale favicon/class icon.
            #[cfg(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "openbsd"
            ))]
            {
                apply_linux_window_icons(app)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Octavo");
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
fn apply_linux_window_icons(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use gtk::gdk_pixbuf::Pixbuf;
    use gtk::prelude::*;
    use std::sync::Arc;
    use tauri::image::Image;
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    // Multi-size _NET_WM_ICON list (titlebar menu wants ~16–24px).
    const PNGS: &[&[u8]] = &[
        include_bytes!("../icons/16x16.png"),
        include_bytes!("../icons/24x24.png"),
        include_bytes!("../icons/32x32.png"),
        include_bytes!("../icons/48x48.png"),
        include_bytes!("../icons/64x64.png"),
        include_bytes!("../icons/128x128.png"),
        include_bytes!("../icons/256x256.png"),
        include_bytes!("../icons/icon.png"),
    ];

    let mut loaded: Vec<Pixbuf> = Vec::with_capacity(PNGS.len());
    for bytes in PNGS {
        // PixbufLoader avoids depending on from_read availability.
        let loader = gtk::gdk_pixbuf::PixbufLoader::new();
        loader.write(bytes)?;
        loader.close()?;
        let Some(pixbuf) = loader.pixbuf() else {
            return Err("failed to decode window icon PNG".into());
        };
        loaded.push(pixbuf);
    }
    let pixbufs = Arc::new(loaded);

    let paint = Arc::new({
        let pixbufs = Arc::clone(&pixbufs);
        move |window: &tauri::WebviewWindow| {
            if let Ok(gtk_window) = window.gtk_window() {
                gtk_window.set_icon_list(pixbufs.as_ref());
                // Same theme name the .desktop / taskbar uses.
                gtk_window.set_icon_name(Some("octavo"));
            }
            if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/128x128.png")) {
                let _ = window.set_icon(icon);
            }
        }
    });

    paint(&window);

    // Re-apply on the GTK main loop after the webview settles — WebKit can
    // overwrite the window icon from a cached favicon (old yellow mark).
    for delay_ms in [250_u64, 1000, 2500] {
        let window = window.clone();
        let paint = Arc::clone(&paint);
        glib::timeout_add_local(std::time::Duration::from_millis(delay_ms), move || {
            paint(&window);
            glib::ControlFlow::Break
        });
    }

    Ok(())
}
