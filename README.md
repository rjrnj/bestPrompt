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

Run all commands from the repository root.

### Run the app

| Command               | What it does                                                    |
| --------------------- | --------------------------------------------------------------- |
| `npm install`         | Installs dependencies                                           |
| `npm run tauri dev`   | Runs the desktop app in development mode with hot reload        |
| `npm run tauri build` | Builds the release app and installers for your OS               |
| `npm run dev`         | Runs only the Vite dev server (frontend in a browser, no Tauri) |
| `npm run build`       | Builds the frontend for production                              |

### Checks

| Command                | What it does                                                                      |
| ---------------------- | --------------------------------------------------------------------------------- |
| `npm run verify`       | Runs all checks below, the build, and the Rust checks; stops at the first failure |
| `npm run typecheck`    | TypeScript type-check                                                             |
| `npm run lint`         | ESLint                                                                            |
| `npm run format:check` | Verifies formatting with Prettier                                                 |
| `npm run format`       | Rewrites files with Prettier                                                      |
| `npm run test`         | Runs frontend tests once (Vitest)                                                 |
| `npm run test:watch`   | Runs frontend tests in watch mode                                                 |

`npm run verify` also runs the Rust checks, which you can run on their own from inside `src-tauri/`:

```
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

`verify` does not run `tauri build`, which is slow; CI covers it.

### Where tests live

- **Frontend:** `*.test.ts` files next to the code they test, using Vitest.
- **Rust:** `#[cfg(test)]` modules inside the source file they test.
