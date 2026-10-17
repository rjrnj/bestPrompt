//! Drives the app's commands the way the webview does, through Tauri's mock
//! runtime, with the real `tauri.conf.json` and capabilities. This is what
//! checks that each command is registered, granted and serializes as the
//! frontend expects.

use std::collections::BTreeSet;
use std::sync::Mutex;

use bestprompt_lib::commands::{Db, register};
use bestprompt_lib::db::builtins::seed_builtins;
use bestprompt_lib::db::entries::PromptEntry;
use bestprompt_lib::db::frameworks::Framework;
use bestprompt_lib::db::projects::Project;
use bestprompt_lib::db::{migrate, open_in_memory};
use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The app as `run` builds it, minus the plugins, on a database with the
/// built-ins seeded, with one window of the given label.
fn window(label: &str) -> WebviewWindow<MockRuntime> {
    let mut conn = open_in_memory().unwrap();
    migrate::migrate(&mut conn).unwrap();
    seed_builtins(&mut conn).unwrap();
    let app = register(mock_builder())
        .manage(Db(Mutex::new(conn)))
        .build(tauri::generate_context!())
        .unwrap();
    // `build` doesn't create the windows from `tauri.conf.json`; `run` would.
    WebviewWindowBuilder::new(&app, label, WebviewUrl::default())
        .build()
        .unwrap()
}

/// The window the capability grants the commands to.
fn main_window() -> WebviewWindow<MockRuntime> {
    window("main")
}

/// Calls `cmd` the way the webview does and returns what it gets back.
fn invoke(window: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
    let response = get_ipc_response(
        window,
        InvokeRequest {
            cmd: cmd.to_owned(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_owned(),
        },
    );
    response.map(|body| match body {
        InvokeResponseBody::Json(text) => serde_json::from_str(&text).unwrap(),
        InvokeResponseBody::Raw(bytes) => Value::String(String::from_utf8(bytes).unwrap()),
    })
}

#[test]
fn the_webview_can_list_the_builtin_frameworks() {
    let window = main_window();

    let frameworks: Vec<Framework> =
        serde_json::from_value(invoke(&window, "list_frameworks", json!({})).unwrap()).unwrap();

    let ids: Vec<&str> = frameworks.iter().map(|f| f.id.as_str()).collect();
    assert_eq!(ids, ["costar", "race", "risen", "rtf"]);
}

/// Every `"..."` literal in `text`.
fn quoted(text: &str) -> impl Iterator<Item = &str> {
    text.split('"').skip(1).step_by(2)
}

/// The text between the first `start` and the next `end` after it.
fn between<'a>(text: &'a str, start: &str, end: &str) -> &'a str {
    let from = text.find(start).expect(start) + start.len();
    let to = text[from..].find(end).expect(end);
    &text[from..from + to]
}

/// The command list lives in three places: `build.rs` (the app manifest,
/// which is what makes the ACL apply to app commands), the capability (the
/// grants) and `commands.rs` (the handler). A command missing from any one of
/// them compiles fine and fails only when the webview calls it, so the three
/// are compared here.
#[test]
fn the_command_list_agrees_across_the_manifest_the_capability_and_the_handler() {
    let manifest: BTreeSet<String> = quoted(between(
        include_str!("../build.rs"),
        "const COMMANDS: &[&str] = &[",
        "];",
    ))
    .map(str::to_owned)
    .collect();
    // Plugin permissions (`core:default`, `clipboard-manager:allow-write-text`)
    // carry the plugin's prefix, so only the app's own grants pass the filter.
    let granted: BTreeSet<String> = quoted(include_str!("../capabilities/default.json"))
        .filter_map(|permission| permission.strip_prefix("allow-"))
        .map(|command| command.replace('-', "_"))
        .collect();
    let handled: BTreeSet<String> = between(
        include_str!("../src/commands.rs"),
        "generate_handler![",
        "]",
    )
    .split(',')
    .map(str::trim)
    .filter(|name| !name.is_empty())
    .map(str::to_owned)
    .collect();

    assert!(!manifest.is_empty());
    assert_eq!(manifest, granted, "manifest (left) vs capability (right)");
    assert_eq!(manifest, handled, "manifest (left) vs handler (right)");
}

/// The capability names the main window, so a window it doesn't cover gets
/// nothing. This only holds because the app declares its commands in an app
/// manifest (`build.rs`); without one, Tauri allows app commands everywhere.
#[test]
fn a_window_the_capability_does_not_cover_cannot_call_commands() {
    let window = window("other");

    let error = invoke(&window, "list_frameworks", json!({})).unwrap_err();

    let text = error.as_str().unwrap_or_default();
    assert!(text.contains("not allowed"), "{error}");
}

/// A main window in an app with only the clipboard plugin registered.
fn main_window_with_clipboard() -> WebviewWindow<MockRuntime> {
    let app = mock_builder()
        .plugin(tauri_plugin_clipboard_manager::init())
        .build(tauri::generate_context!())
        .unwrap();
    WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
        .build()
        .unwrap()
}

/// Called without its `text` argument, `write_text` gets past the permission
/// check and then fails on the missing argument, so this proves the grant
/// without overwriting the real clipboard.
#[test]
fn the_webview_may_write_the_clipboard() {
    let window = main_window_with_clipboard();

    let error = invoke(&window, "plugin:clipboard-manager|write_text", json!({})).unwrap_err();

    let text = error.as_str().unwrap_or_default();
    assert!(text.contains("missing required key text"), "{error}");
}

/// Only writing is granted: a page that could read the clipboard could read
/// whatever the user copied from anywhere else.
#[test]
fn the_webview_may_not_read_the_clipboard() {
    let window = main_window_with_clipboard();

    let error = invoke(&window, "plugin:clipboard-manager|read_text", json!({})).unwrap_err();

    // Tauri also says "not allowed" for a command or plugin it cannot find,
    // so the test checks the denial is for this command and not that.
    let text = error.as_str().unwrap_or_default();
    assert!(
        text.contains("clipboard-manager.read_text not allowed"),
        "{error}"
    );
    assert!(!text.contains("not found"), "{error}");
}

#[test]
fn the_webview_can_get_one_framework_by_id() {
    let window = main_window();

    let framework: Framework =
        serde_json::from_value(invoke(&window, "get_framework", json!({ "id": "rtf" })).unwrap())
            .unwrap();

    assert_eq!(framework.name, "RTF");
}

#[test]
fn an_unknown_id_reaches_the_webview_as_a_not_found_error() {
    let window = main_window();

    let error = invoke(&window, "get_framework", json!({ "id": "nope" })).unwrap_err();

    assert_eq!(
        error,
        json!({ "kind": "notFound", "message": "framework nope not found" })
    );
}

#[test]
fn the_webview_can_save_an_entry_and_read_it_back_alone_and_in_the_list() {
    let window = main_window();
    let entry = json!({
        "frameworkId": "rtf",
        "sectionValues": { "role": "a reviewer", "task": "", "format": "" },
        "renderedPrompt": "# Role\na reviewer",
    });

    let saved: PromptEntry = serde_json::from_value(
        invoke(&window, "save_prompt_entry", json!({ "entry": entry })).unwrap(),
    )
    .unwrap();
    let read: PromptEntry = serde_json::from_value(
        invoke(&window, "get_prompt_entry", json!({ "id": saved.id })).unwrap(),
    )
    .unwrap();
    let listed: Vec<PromptEntry> = serde_json::from_value(
        invoke(
            &window,
            "list_prompt_entries",
            json!({
                "query": { "project": { "kind": "any" }, "frameworkId": null, "search": null },
                "limit": 10,
                "after": null
            }),
        )
        .unwrap(),
    )
    .unwrap();

    assert_eq!(saved.framework_snapshot.name, "RTF");
    assert_eq!(saved.rendered_prompt, "# Role\na reviewer");
    assert_eq!(read, saved);
    assert_eq!(listed, [saved]);
}

/// The query that matches every entry.
fn everything() -> Value {
    json!({ "project": { "kind": "any" }, "frameworkId": null, "search": null })
}

fn save_entry(window: &WebviewWindow<MockRuntime>, body: &str, project_id: Value) -> PromptEntry {
    let entry = json!({
        "frameworkId": "rtf",
        "sectionValues": { "role": body },
        "renderedPrompt": body,
        "title": null,
        "projectId": project_id,
    });
    serde_json::from_value(invoke(window, "save_prompt_entry", json!({ "entry": entry })).unwrap())
        .unwrap()
}

#[test]
fn the_webview_can_create_list_rename_and_delete_a_project() {
    let window = main_window();

    let created: Project = serde_json::from_value(
        invoke(&window, "create_project", json!({ "name": "API" })).unwrap(),
    )
    .unwrap();
    let renamed: Project = serde_json::from_value(
        invoke(
            &window,
            "rename_project",
            json!({ "id": created.id, "name": "Docs" }),
        )
        .unwrap(),
    )
    .unwrap();
    let listed: Vec<Project> =
        serde_json::from_value(invoke(&window, "list_projects", json!({})).unwrap()).unwrap();
    let deleted = invoke(&window, "delete_project", json!({ "id": created.id })).unwrap();
    let after: Vec<Project> =
        serde_json::from_value(invoke(&window, "list_projects", json!({})).unwrap()).unwrap();

    assert_eq!(created.name, "API");
    assert_eq!(renamed.id, created.id);
    assert_eq!(renamed.name, "Docs");
    assert_eq!(listed, [renamed]);
    assert_eq!(deleted, Value::Null);
    assert!(after.is_empty());
}

#[test]
fn a_duplicate_project_name_reaches_the_webview_as_invalid() {
    let window = main_window();
    invoke(&window, "create_project", json!({ "name": "API" })).unwrap();

    let error = invoke(&window, "create_project", json!({ "name": " api " })).unwrap_err();

    assert_eq!(error["kind"], "invalid");
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("already exists"),
        "{error}"
    );
}

#[test]
fn the_webview_can_list_entries_with_a_query() {
    let window = main_window();
    let project: Project = serde_json::from_value(
        invoke(&window, "create_project", json!({ "name": "API" })).unwrap(),
    )
    .unwrap();
    let inside = save_entry(&window, "review the parser", json!(project.id));
    save_entry(&window, "write a poem", Value::Null);

    let by_project: Vec<PromptEntry> = serde_json::from_value(
        invoke(
            &window,
            "list_prompt_entries",
            json!({
                "query": { "project": { "kind": "project", "id": project.id }, "frameworkId": null, "search": null },
                "limit": 10,
                "after": null
            }),
        )
        .unwrap(),
    )
    .unwrap();
    let by_search: Vec<PromptEntry> = serde_json::from_value(
        invoke(
            &window,
            "list_prompt_entries",
            json!({
                "query": { "project": { "kind": "any" }, "frameworkId": null, "search": "pars" },
                "limit": 10,
                "after": null
            }),
        )
        .unwrap(),
    )
    .unwrap();
    let first: Vec<PromptEntry> = serde_json::from_value(
        invoke(
            &window,
            "list_prompt_entries",
            json!({ "query": everything(), "limit": 1 }),
        )
        .unwrap(),
    )
    .unwrap();
    let after = json!({ "createdAt": first[0].created_at, "id": first[0].id });
    let next: Vec<PromptEntry> = serde_json::from_value(
        invoke(
            &window,
            "list_prompt_entries",
            json!({ "query": everything(), "limit": 1, "after": after }),
        )
        .unwrap(),
    )
    .unwrap();

    assert_eq!(by_project, std::slice::from_ref(&inside));
    assert_eq!(by_search, [inside]);
    assert_eq!(first.len(), 1);
    assert_eq!(next.len(), 1);
    assert_ne!(next[0].id, first[0].id);
}

#[test]
fn the_webview_can_retitle_move_and_delete_an_entry() {
    let window = main_window();
    let project: Project = serde_json::from_value(
        invoke(&window, "create_project", json!({ "name": "API" })).unwrap(),
    )
    .unwrap();
    let entry = save_entry(&window, "review the parser", Value::Null);

    let titled: PromptEntry = serde_json::from_value(
        invoke(
            &window,
            "set_entry_title",
            json!({ "id": entry.id, "title": "Parser review" }),
        )
        .unwrap(),
    )
    .unwrap();
    let moved: PromptEntry = serde_json::from_value(
        invoke(
            &window,
            "set_entry_project",
            json!({ "id": entry.id, "projectId": project.id }),
        )
        .unwrap(),
    )
    .unwrap();
    let latest = invoke(&window, "latest_entry_project", json!({})).unwrap();
    let deleted = invoke(&window, "delete_prompt_entry", json!({ "id": entry.id })).unwrap();
    let gone = invoke(&window, "get_prompt_entry", json!({ "id": entry.id })).unwrap_err();

    assert_eq!(titled.title.as_deref(), Some("Parser review"));
    assert_eq!(moved.project_id.as_deref(), Some(project.id.as_str()));
    assert_eq!(moved.title.as_deref(), Some("Parser review"));
    assert_eq!(latest, json!(project.id));
    assert_eq!(deleted, Value::Null);
    assert_eq!(gone["kind"], "notFound");
}
