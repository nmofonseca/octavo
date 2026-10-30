#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Plasma/Wayland titlebar menu often ignores GTK set_icon_list and
            // instead resolves the .desktop Icon= / themed name. AppImages do
            // not install into the user icon theme, so we seed ~/.local/share
            // and only set_icon_name when lookup succeeds.
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

    let icon_path = install_user_hicolor_icons()?;
    install_user_desktop_entries(&icon_path)?;

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
        let loader = gtk::gdk_pixbuf::PixbufLoader::new();
        loader.write(bytes)?;
        loader.close()?;
        let Some(pixbuf) = loader.pixbuf() else {
            return Err("failed to decode window icon PNG".into());
        };
        loaded.push(pixbuf);
    }
    let pixbufs = Arc::new(loaded);
    let theme_has_octavo = icon_theme_has_octavo();
    let icon_path = Arc::new(icon_path);

    // Default icon for any window created afterward (incl. after WebKit resets).
    gtk::Window::set_default_icon_list(pixbufs.as_ref());
    if theme_has_octavo {
        gtk::Window::set_default_icon_name("octavo");
    }
    if let Some(path) = icon_path.as_ref() {
        let _ = gtk::Window::set_default_icon_from_file(path);
    }

    let paint = Arc::new({
        let pixbufs = Arc::clone(&pixbufs);
        let icon_path = Arc::clone(&icon_path);
        move |window: &tauri::WebviewWindow| {
            if let Ok(gtk_window) = window.gtk_window() {
                gtk_window.set_icon_list(pixbufs.as_ref());
                if let Some(path) = icon_path.as_ref() {
                    let _ = gtk_window.set_icon_from_file(path);
                }
                // Only set the theme name when it resolves — otherwise GTK may
                // clear the pixbuf/file icon and Plasma shows a stale yellow W.
                if theme_has_octavo {
                    gtk_window.set_icon_name(Some("octavo"));
                }
            }
            if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/128x128.png")) {
                let _ = window.set_icon(icon);
            }
        }
    });

    paint(&window);

    for delay_ms in [250_u64, 1000, 2500, 5000, 10000] {
        let window = window.clone();
        let paint = Arc::clone(&paint);
        glib::timeout_add_local(std::time::Duration::from_millis(delay_ms), move || {
            paint(&window);
            glib::ControlFlow::Break
        });
    }

    Ok(())
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
fn icon_theme_has_octavo() -> bool {
    use gtk::prelude::*;
    match gtk::IconTheme::default() {
        Some(t) => t.has_icon("octavo"),
        None => false,
    }
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
fn install_user_hicolor_icons() -> Result<Option<std::path::PathBuf>, Box<dyn std::error::Error>> {
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;

    let Some(home) = std::env::var_os("HOME") else {
        return Ok(None);
    };
    let base = PathBuf::from(home).join(".local/share/icons/hicolor");

    let sizes: &[(&str, &[u8])] = &[
        ("16x16", include_bytes!("../icons/16x16.png")),
        ("24x24", include_bytes!("../icons/24x24.png")),
        ("32x32", include_bytes!("../icons/32x32.png")),
        ("48x48", include_bytes!("../icons/48x48.png")),
        ("64x64", include_bytes!("../icons/64x64.png")),
        ("128x128", include_bytes!("../icons/128x128.png")),
        ("256x256", include_bytes!("../icons/256x256.png")),
        ("512x512", include_bytes!("../icons/icon.png")),
    ];

    let mut primary: Option<PathBuf> = None;
    for (size, bytes) in sizes {
        let dir = base.join(size).join("apps");
        fs::create_dir_all(&dir)?;
        let dest = dir.join("octavo.png");
        fs::write(&dest, bytes)?;
        // Also under the reverse-DNS id Plasma may look up.
        fs::write(dir.join("com.octavo.app.png"), bytes)?;
        if *size == "256x256" {
            primary = Some(dest);
        }
    }

    let index = base.join("index.theme");
    if !index.exists() {
        let mut f = fs::File::create(&index)?;
        writeln!(
            f,
            "[Icon Theme]\nName=Hicolor\nComment=User hicolor\nDirectories=16x16/apps,24x24/apps,32x32/apps,48x48/apps,64x64/apps,128x128/apps,256x256/apps,512x512/apps\n"
        )?;
        for size in ["16x16", "24x24", "32x32", "48x48", "64x64", "128x128", "256x256", "512x512"]
        {
            writeln!(
                f,
                "[{size}/apps]\nSize={}\nContext=Applications\nType=Fixed\n",
                size.split('x').next().unwrap_or("48")
            )?;
        }
    }

    let _ = std::process::Command::new("gtk-update-icon-cache")
        .args(["-f", "-t"])
        .arg(&base)
        .status();

    Ok(primary)
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
fn install_user_desktop_entries(
    icon_path: &Option<std::path::PathBuf>,
) -> Result<(), Box<dyn std::error::Error>> {
    use std::fs;
    use std::path::PathBuf;

    let Some(home) = std::env::var_os("HOME") else {
        return Ok(());
    };
    let apps = PathBuf::from(home).join(".local/share/applications");
    fs::create_dir_all(&apps)?;

    let icon = icon_path
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "octavo".into());

    // Absolute Icon= path bypasses stale theme caches that still hold a yellow W.
    let body = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Octavo\n\
         Comment=Octavo — multi-platform desktop PDF reader\n\
         Exec=octavo %F\n\
         Icon={icon}\n\
         StartupWMClass=octavo\n\
         Terminal=false\n\
         Categories=Office;Viewer;\n\
         MimeType=application/pdf;\n"
    );

    for name in ["octavo.desktop", "com.octavo.app.desktop"] {
        fs::write(apps.join(name), &body)?;
    }

    let _ = std::process::Command::new("update-desktop-database")
        .arg(&apps)
        .status();
    let _ = std::process::Command::new("kbuildsycoca6")
        .arg("--noincremental")
        .status();

    Ok(())
}
