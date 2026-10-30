#!/usr/bin/env bash
# install-appimage.sh — Install / upgrade / roll back Octavo's Linux AppImage
#
# Generic Linux helper (any distro that can run AppImages). Fetches
# Octavo_*_{amd64|arm64}.AppImage from GitHub Releases into XDG user dirs,
# symlinks ~/.local/bin/octavo, and writes a .desktop entry for the launcher.
#
# Usage (see --help for full examples):
#   ./tools/install-appimage.sh                  # install or upgrade to latest
#   ./tools/install-appimage.sh --latest         # same
#   ./tools/install-appimage.sh --version 0.2.12 # install / roll back to a release
#   ./tools/install-appimage.sh update           # upgrade existing install to latest
#   ./tools/install-appimage.sh update v0.2.12   # roll back existing install
#
# Requires: curl (or gh). Optional: jq (curl API path), update-desktop-database.
# Running AppImages may need FUSE on some systems — install via your distro.
set -euo pipefail

readonly REPO="nmofonseca/octavo"
readonly API_BASE="https://api.github.com/repos/${REPO}"
readonly DOWNLOAD_BASE="https://github.com/${REPO}/releases/download"
readonly ICON_RAW_URL="https://raw.githubusercontent.com/${REPO}/main/src-tauri/icons/128x128.png"

# XDG Base Directory paths (user-local; no root / package manager required).
XDG_DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
XDG_BIN_HOME="${XDG_BIN_HOME:-${HOME}/.local/bin}"

INSTALL_DIR="${XDG_DATA_HOME}/Octavo"
BIN_DIR="${XDG_BIN_HOME}"
APPS_DIR="${XDG_DATA_HOME}/applications"
ICONS_DIR="${XDG_DATA_HOME}/icons/hicolor/128x128/apps"
DESKTOP_ID="octavo.desktop"
APPIMAGE_NAME="Octavo.AppImage"
ICON_BASENAME="octavo.png"

# MODE: install (default) | update
# VERSION: empty means latest; otherwise tag/semver
MODE="install"
VERSION=""

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Install, upgrade, or roll back Octavo's Linux AppImage from GitHub Releases.

Generic Linux (XDG user dirs). Works on any distro that can run AppImages —
no package-manager assumptions. Creates/updates a stable AppImage path and a
.desktop launcher (Name=Octavo).

Usage:
  install-appimage.sh [COMMAND] [OPTIONS] [VERSION]

Commands:
  install                 Install or replace with the requested release (default)
  update, upgrade         Same as install, but requires an existing install
  help                    Show this help

Options:
  -l, --latest            Use the latest GitHub Release (default when VERSION omitted)
  -v, --version VERSION   Release tag or semver (v optional), e.g. 0.2.12 or v0.2.12
  -h, --help              Show this help and exit

Examples:
  # Install latest (first-time or replace existing)
  ./tools/install-appimage.sh
  ./tools/install-appimage.sh --latest
  ./tools/install-appimage.sh install --latest

  # Install / roll back to a specific version
  ./tools/install-appimage.sh --version 0.2.12
  ./tools/install-appimage.sh --version v0.2.12
  ./tools/install-appimage.sh v0.2.12

  # Upgrade an existing install to latest
  ./tools/install-appimage.sh update
  ./tools/install-appimage.sh upgrade --latest

  # Upgrade / roll back an existing install to a specific tag
  ./tools/install-appimage.sh update --version 0.2.12
  ./tools/install-appimage.sh update v0.2.12

XDG install paths (.desktop Exec always points at the stable AppImage path):
  AppImage   $XDG_DATA_HOME/Octavo/Octavo.AppImage   (default: ~/.local/share/Octavo/)
  Symlink    $XDG_BIN_HOME/octavo                    (default: ~/.local/bin/octavo)
  Desktop    $XDG_DATA_HOME/applications/octavo.desktop
  Icon       $XDG_DATA_HOME/icons/hicolor/128x128/apps/octavo.png
  VERSION    $XDG_DATA_HOME/Octavo/VERSION

Asset selection matches host CPU: amd64 (x86_64) or arm64 (aarch64).
Prefers gh when available; otherwise curl (+ jq for API listing).
Replacing an existing install overwrites the AppImage in place and refreshes the .desktop.
EOF
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

normalize_version() {
  local v="$1"
  v="${v#v}"
  [[ -n "$v" ]] || die "empty version"
  printf 'v%s\n' "$v"
}

detect_arch() {
  local m
  m="$(uname -m)"
  case "$m" in
    x86_64|amd64) printf 'amd64\n' ;;
    aarch64|arm64) printf 'arm64\n' ;;
    *) die "unsupported architecture: ${m} (need amd64 or arm64)" ;;
  esac
}

have_gh() {
  command -v gh >/dev/null 2>&1
}

installed_appimage() {
  printf '%s/%s\n' "$INSTALL_DIR" "$APPIMAGE_NAME"
}

require_existing_install() {
  local path
  path="$(installed_appimage)"
  [[ -e "$path" ]] || die "no existing install at ${path} (run without 'update' to install first)"
}

# Resolve tag name (e.g. v0.2.13). Empty want => latest.
# Prefer gh; fall back to curl (+ jq) if gh is missing or fails (e.g. no auth).
resolve_tag() {
  local want="$1" tag out

  if [[ -z "$want" ]]; then
    if have_gh; then
      if out="$(gh release view -R "$REPO" --json tagName --jq .tagName 2>/dev/null)" && [[ -n "$out" ]]; then
        printf '%s\n' "$out"
        return
      fi
    fi
    need_cmd curl
    need_cmd jq
    out="$(curl -fsSL "${API_BASE}/releases/latest" | jq -r .tag_name)" \
      || die "failed to resolve latest release via GitHub API"
    [[ -n "$out" && "$out" != "null" ]] || die "failed to resolve latest release via GitHub API"
    printf '%s\n' "$out"
    return
  fi

  tag="$(normalize_version "$want")"
  if have_gh; then
    if gh release view -R "$REPO" "$tag" >/dev/null 2>&1; then
      printf '%s\n' "$tag"
      return
    fi
  fi
  need_cmd curl
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' "${API_BASE}/releases/tags/${tag}" || true)"
  [[ "$code" == "200" ]] || die "release not found: ${tag} (HTTP ${code:-000})"
  printf '%s\n' "$tag"
}

# Print asset download URL for tag + arch. Prefer Octavo_*_${arch}.AppImage.
asset_url_for() {
  local tag="$1" arch="$2"
  local pattern="Octavo_.*_${arch}\\.AppImage$"
  local name url

  if have_gh; then
    name="$(
      gh release view -R "$REPO" "$tag" --json assets \
        --jq ".assets[].name" 2>/dev/null \
        | grep -E "$pattern" \
        | head -n1 || true
    )"
    if [[ -n "$name" ]]; then
      printf '%s/%s/%s\n' "$DOWNLOAD_BASE" "$tag" "$name"
      return
    fi
  fi

  need_cmd curl
  need_cmd jq
  url="$(
    curl -fsSL "${API_BASE}/releases/tags/${tag}" \
      | jq -r --arg arch "$arch" '
          .assets[]
          | select(.name | test("Octavo_.*_" + $arch + "\\.AppImage$"))
          | .browser_download_url
        ' \
      | head -n1 || true
  )"
  [[ -n "$url" && "$url" != "null" ]] \
    || die "no AppImage asset matching *_${arch}.AppImage on ${tag}"
  printf '%s\n' "$url"
}

download() {
  local url="$1" dest="$2"
  need_cmd curl
  curl -fL --progress-bar -o "$dest" "$url" \
    || die "download failed: ${url}"
}

extract_icon_from_appimage() {
  local appimage="$1" dest="$2"
  local tmp extract_dir candidate
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '${tmp}'" RETURN

  if ! (cd "$tmp" && "$appimage" --appimage-extract >/dev/null 2>&1); then
    return 1
  fi
  extract_dir="${tmp}/squashfs-root"
  candidate="$(
    find "$extract_dir" -type f \( \
      -path '*/hicolor/128x128/apps/*.png' -o \
      -path '*/hicolor/256x256/apps/*.png' -o \
      -name 'octavo.png' -o \
      -name 'Octavo.png' -o \
      -name 'icon.png' \
    \) 2>/dev/null | head -n1 || true
  )"
  if [[ -n "$candidate" && -f "$candidate" ]]; then
    cp -f "$candidate" "$dest"
    return 0
  fi
  return 1
}

install_icon() {
  local appimage="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if extract_icon_from_appimage "$appimage" "$dest"; then
    return 0
  fi
  printf 'note: could not extract icon from AppImage; downloading repo icon\n' >&2
  need_cmd curl
  curl -fsSL -o "$dest" "$ICON_RAW_URL" \
    || die "failed to download icon from ${ICON_RAW_URL}"
}

write_desktop() {
  local exec_path="$1" icon_name="$2" desktop_path="$3"
  # Icon= uses the freedesktop icon name (octavo); file lives under
  # $XDG_DATA_HOME/icons/hicolor/128x128/apps/octavo.png
  # Exec always uses the stable install path so upgrades/rollbacks keep the launcher valid.
  cat >"$desktop_path" <<EOF
[Desktop Entry]
Type=Application
Name=Octavo
Comment=Octavo — multi-platform desktop PDF reader with annotations
Exec=${exec_path} %F
Icon=${icon_name}
Terminal=false
Categories=Office;Viewer;
MimeType=application/pdf;
StartupWMClass=octavo
Keywords=PDF;Reader;Annotate;
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help|help)
        usage
        exit 0
        ;;
      install)
        MODE="install"
        shift
        ;;
      update|upgrade)
        MODE="update"
        shift
        ;;
      -l|--latest)
        VERSION=""
        shift
        ;;
      -v|--version)
        [[ $# -ge 2 ]] || die "--version requires an argument"
        VERSION="$2"
        shift 2
        ;;
      --version=*)
        VERSION="${1#--version=}"
        shift
        ;;
      -*)
        die "unknown option: $1 (try --help)"
        ;;
      *)
        if [[ -n "$VERSION" ]]; then
          die "unexpected argument: $1"
        fi
        VERSION="$1"
        shift
        ;;
    esac
  done
}

main() {
  parse_args "$@"

  if [[ "$MODE" == "update" ]]; then
    require_existing_install
  fi

  local arch tag url tmp_appimage appimage_path icon_path desktop_path bin_link prev
  arch="$(detect_arch)"
  tag="$(resolve_tag "$VERSION")"
  url="$(asset_url_for "$tag" "$arch")"

  appimage_path="$(installed_appimage)"
  icon_path="${ICONS_DIR}/${ICON_BASENAME}"
  desktop_path="${APPS_DIR}/${DESKTOP_ID}"
  bin_link="${BIN_DIR}/octavo"
  prev=""
  if [[ -f "${INSTALL_DIR}/VERSION" ]]; then
    prev="$(tr -d '[:space:]' <"${INSTALL_DIR}/VERSION" || true)"
  fi

  if [[ -n "$prev" ]]; then
    printf 'Replacing Octavo %s → %s (%s)…\n' "$prev" "$tag" "$arch"
  else
    printf 'Installing Octavo %s (%s)…\n' "$tag" "$arch"
  fi
  printf '  source: %s\n' "$url"

  mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$APPS_DIR" "$ICONS_DIR"

  tmp_appimage="$(mktemp "${TMPDIR:-/tmp}/Octavo.XXXXXX.AppImage")"
  # shellcheck disable=SC2064
  trap "rm -f '${tmp_appimage}'" EXIT

  download "$url" "$tmp_appimage"
  chmod +x "$tmp_appimage"

  # Icon from the new AppImage before atomic replace.
  install_icon "$tmp_appimage" "$icon_path"

  # Replace in place so the stable path (and .desktop Exec=) stay valid.
  mv -f "$tmp_appimage" "$appimage_path"
  chmod +x "$appimage_path"
  trap - EXIT

  ln -sfn "$appimage_path" "$bin_link"
  # Icon key is the basename without extension (freedesktop theme lookup).
  write_desktop "$appimage_path" "octavo" "$desktop_path"

  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t "${XDG_DATA_HOME}/icons/hicolor" >/dev/null 2>&1 || true
  fi

  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPS_DIR" >/dev/null 2>&1 \
      || printf 'note: update-desktop-database reported an error (launcher may still work)\n' >&2
  fi

  printf '%s\n' "$tag" >"${INSTALL_DIR}/VERSION"

  cat <<EOF
Done: Octavo ${tag} (${arch}).

  AppImage:  ${appimage_path}
  Command:   ${bin_link}  (ensure ${BIN_DIR} is on PATH)
  Launcher:  ${desktop_path}
  Icon:      ${icon_path}

Open Octavo from your application menu, or run: octavo
If the AppImage fails to start, install a FUSE 2 runtime via your distro packages.
EOF
}

main "$@"
