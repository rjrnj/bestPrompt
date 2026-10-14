//! Drives the app's commands the way the webview does, through Tauri's mock
//! runtime, with the real `tauri.conf.json` and capabilities. This is what
//! checks that each command is registered, granted and serializes as the
//! frontend expects.

use std::sync::Mutex;

use bestprompt_lib::commands::{Db, register};
use bestprompt_lib::db::builtins::seed_builtins;
use bestprompt_lib::db::entries::PromptEntry;
use bestprompt_lib::db::frameworks::Framework;
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
            json!({ "limit": 10, "offset": 0 }),
        )
        .unwrap(),
    )
    .unwrap();

    assert_eq!(saved.framework_snapshot.name, "RTF");
    assert_eq!(saved.rendered_prompt, "# Role\na reviewer");
    assert_eq!(read, saved);
    assert_eq!(listed, [saved]);
}
