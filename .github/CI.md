# Octavo CI

Default branch is **`main`** (do not target `master`).

## Workflows

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| [`workflows/ci.yml`](workflows/ci.yml) | `pull_request`, `push` | Lint, typecheck, unit tests (Node + Rust clippy/test) |
| [`workflows/build.yml`](workflows/build.yml) | `push` to `main` only | GitVersion → stamp app versions → Tauri package matrix |

`workflows/test.yml` was replaced by the above (no unsafe `pull_request_target`).

## Hardening

- Default `permissions: contents: read` (least privilege).
- Third-party Actions pinned by full commit SHA (with version comments).
- `concurrency` cancels superseded runs on the same ref.
- Dependabot weekly updates for `github-actions` only (optional; see `dependabot.yml`).

## Versioning

[`GitVersion.yml`](../GitVersion.yml) uses GitHub Flow on `main`, starting from `next-version: 0.2.0`.

On merge builds, `scripts/apply-version.mjs` writes the computed SemVer into:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

## Build matrix (merge to `main`)

| OS | Arch | Runner | Status |
| --- | --- | --- | --- |
| Linux | amd64 | `ubuntu-latest` | Supported |
| Linux | arm64 | `ubuntu-24.04-arm` | Supported (GitHub-hosted ARM) |
| Windows | amd64 | `windows-latest` | Supported |
| Windows | arm64 | `windows-11-arm` | **Gap** — not in matrix (runner may be unavailable / long-queue on some plans; WebView2 + Tauri arm64 still evolving) |

### Known gaps

- **Windows arm64:** omitted from `build.yml` so missing `windows-11-arm` capacity cannot stall the workflow. Re-add when the hosted runner is reliably available for this repo.
- **macOS** is out of scope for this matrix (no Apple signing secrets in CI).
- **Cross-compile from amd64 → foreign arch** is not used; native runners only.
- Desktop installers are uploaded as artifacts; release publishing is not wired yet.
