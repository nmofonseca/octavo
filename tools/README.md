# tools/

Helper scripts that are not part of the npm/Tauri build.

## `install-appimage.sh`

Generic **Linux** helper: install, **upgrade to latest**, or **roll back to a specific version** of Octavo’s AppImage from [GitHub Releases](https://github.com/nmofonseca/octavo/releases). Uses XDG user directories (no root, no distro package manager). Registers a `.desktop` launcher under `$XDG_DATA_HOME/applications/` (default `~/.local/share/applications/`).

```bash
# Install or upgrade to latest
./tools/install-appimage.sh
./tools/install-appimage.sh --latest

# Install / roll back to a specific release
./tools/install-appimage.sh --version 0.2.12
./tools/install-appimage.sh v0.2.12

# Upgrade an existing install to latest
./tools/install-appimage.sh update

# Upgrade / roll back an existing install to a tag
./tools/install-appimage.sh update --version 0.2.12
```

Stable XDG paths (`.desktop` `Exec=` always points at the AppImage path, so upgrades keep the launcher valid):

| What | Path |
| --- | --- |
| AppImage | `~/.local/share/Octavo/Octavo.AppImage` |
| Symlink | `~/.local/bin/octavo` |
| Desktop | `~/.local/share/applications/octavo.desktop` |
| Icon | `~/.local/share/icons/hicolor/128x128/apps/octavo.png` |

Uses `gh` when available, otherwise `curl` (+ `jq` for the Releases API). Host arch is detected as `amd64` or `arm64`. Run `./tools/install-appimage.sh --help` for the full flag list.
