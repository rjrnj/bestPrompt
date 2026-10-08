# bestPrompt

Built with Tauri 2, React, TypeScript, and a local SQLite database. Windows and Linux are the supported platforms.

**Status:** early development. The app does not do anything useful yet.

## Prerequisites

- **Node.js 24 (LTS).** The version is pinned in `.nvmrc`; with [nvm](https://github.com/nvm-sh/nvm) run `nvm use`.
- **Rust.** Install [rustup](https://rustup.rs/). The exact toolchain (including `rustfmt` and `clippy`) is pinned in `rust-toolchain.toml` and is installed automatically the first time you run a `cargo` command in this repo.
- **Tauri platform dependencies.** Follow the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS. In particular:
  - **Windows:** Microsoft C++ Build Tools with the "Desktop development with C++" workload, and WebView2 (already present on Windows 11 and current Windows 10). Building MSI installers also needs the VBSCRIPT optional Windows feature.
  - **Linux:** the system libraries listed on the Tauri page for your distribution (WebKitGTK 4.1, GTK, and related development packages).

## Commands

Commands will be documented here as the project is scaffolded.
