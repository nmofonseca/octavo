//! Parse CLI / desktop-entry argv into absolute PDF paths.
//!
//! File managers pass either absolute paths or `file://` URIs via `%F` / `%U`.
//! Non-PDF args (flags, the executable itself) are ignored.

use std::path::{Path, PathBuf};

/// Extract PDF file paths from a full argv list (including argv[0] = executable).
/// Relative paths are resolved against `cwd` when provided.
pub fn pdf_paths_from_args(args: &[String], cwd: Option<&Path>) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter_map(|raw| normalize_open_arg(raw, cwd))
        .collect()
}

/// Turn one argv token into an absolute filesystem path if it looks like a PDF.
pub fn normalize_open_arg(raw: &str, cwd: Option<&Path>) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return None;
    }

    let path = if let Some(path) = path_from_file_uri(trimmed) {
        path
    } else {
        PathBuf::from(trimmed)
    };

    if !is_pdf_path(&path) {
        return None;
    }

    let absolute = if path.is_absolute() {
        path
    } else if let Some(cwd) = cwd {
        cwd.join(path)
    } else {
        std::env::current_dir().ok()?.join(path)
    };

    Some(absolute.to_string_lossy().into_owned())
}

fn path_from_file_uri(raw: &str) -> Option<PathBuf> {
    let lower = raw.to_ascii_lowercase();
    if !lower.starts_with("file:") {
        return None;
    }

    // Prefer url crate–style decode without adding a dependency: handle common forms.
    let rest = raw
        .strip_prefix("file://")
        .or_else(|| raw.strip_prefix("FILE://"))
        .or_else(|| raw.strip_prefix("file:"))
        .or_else(|| raw.strip_prefix("FILE:"))?;

    // `file:///tmp/a.pdf` → `/tmp/a.pdf`
    // `file://localhost/tmp/a.pdf` → `/tmp/a.pdf`
    // `file:/tmp/a.pdf` → `/tmp/a.pdf`
    let path_part = if rest.starts_with('/') {
        rest
    } else {
        let idx = rest.find('/')?;
        &rest[idx..]
    };

    Some(PathBuf::from(percent_decode(path_part)))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (from_hex(bytes[i + 1]), from_hex(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn from_hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn is_pdf_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

/// Read a local PDF for the frontend (bytes + display name).
pub fn read_pdf_file(path: &str) -> Result<(String, Vec<u8>), String> {
    let path = PathBuf::from(path);
    if !is_pdf_path(&path) {
        return Err("not a PDF path".into());
    }
    if !path.is_file() {
        return Err(format!("file not found: {}", path.display()));
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "document.pdf".into());
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() < 5 || &bytes[0..5] != b"%PDF-" {
        return Err("file does not look like a PDF".into());
    }
    Ok((name, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn skips_flags_and_non_pdf() {
        let args = vec![
            "octavo".into(),
            "--foo".into(),
            "/tmp/notes.txt".into(),
            "/tmp/doc.PDF".into(),
        ];
        assert_eq!(
            pdf_paths_from_args(&args, None),
            vec!["/tmp/doc.PDF".to_string()]
        );
    }

    #[test]
    fn resolves_file_uri_and_relative() {
        let cwd = Path::new("/home/reader");
        assert_eq!(
            normalize_open_arg("file:///home/reader/a.pdf", Some(cwd)).as_deref(),
            Some("/home/reader/a.pdf")
        );
        assert_eq!(
            normalize_open_arg("file://localhost/tmp/b.pdf", Some(cwd)).as_deref(),
            Some("/tmp/b.pdf")
        );
        assert_eq!(
            normalize_open_arg("docs/c.pdf", Some(cwd)).as_deref(),
            Some("/home/reader/docs/c.pdf")
        );
        assert_eq!(
            normalize_open_arg("file:///tmp/my%20file.pdf", Some(cwd)).as_deref(),
            Some("/tmp/my file.pdf")
        );
    }

    #[test]
    fn read_pdf_file_checks_magic() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("octavo-open-paths-{stamp}"));
        fs::create_dir_all(&dir).unwrap();
        let good = dir.join("ok.pdf");
        let bad = dir.join("bad.pdf");
        fs::write(&good, b"%PDF-1.4\n%%EOF\n").unwrap();
        fs::write(&bad, b"not a pdf").unwrap();

        let (name, bytes) = read_pdf_file(good.to_str().unwrap()).unwrap();
        assert_eq!(name, "ok.pdf");
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(read_pdf_file(bad.to_str().unwrap()).is_err());
        assert!(read_pdf_file(dir.join("missing.pdf").to_str().unwrap()).is_err());

        let _ = fs::remove_dir_all(&dir);
    }
}
