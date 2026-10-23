use tauri_build::{AppManifest, Attributes};

/// The commands the webview may call, once a capability grants them. Tauri
/// only gates app commands through the ACL when the app declares them here;
/// without this list, every window could call every command.
const COMMANDS: &[&str] = &[
    "list_frameworks",
    "get_framework",
    "create_framework",
    "update_framework",
    "delete_framework",
    "restore_framework",
    "save_prompt_entry",
    "list_prompt_entries",
    "get_prompt_entry",
    "set_entry_title",
    "set_entry_project",
    "delete_prompt_entry",
    "latest_entry_project",
    "list_projects",
    "create_project",
    "rename_project",
    "delete_project",
];

fn main() {
    tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
    embed_test_manifest();
}

/// tauri-build embeds a Windows application manifest into the app binary, but
/// not into test binaries. They link the same runtime code, which imports
/// `TaskDialogIndirect` from common controls 6.0, so without the manifest a
/// test binary fails to load (`STATUS_ENTRYPOINT_NOT_FOUND`) before any test
/// runs.
fn embed_test_manifest() {
    if std::env::var_os("CARGO_CFG_TARGET_OS").is_some_and(|os| os == "windows")
        && std::env::var_os("CARGO_CFG_TARGET_ENV").is_some_and(|env| env == "msvc")
    {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-manifest.xml");
        println!("cargo::rerun-if-changed={}", manifest.display());
        println!("cargo::rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo::rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
