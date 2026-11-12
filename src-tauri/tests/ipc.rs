//! Drives the app's commands the way the webview does, through Tauri's mock
//! runtime, with the real `tauri.conf.json` and capabilities. This is what
//! checks that each command is registered, granted and serializes as the
//! frontend expects.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bestprompt_lib::claude::{ClaudeExe, ClaudeState};
use bestprompt_lib::commands::{Db, register};
use bestprompt_lib::db::builtins::seed_builtins;
use bestprompt_lib::db::entries::PromptEntry;
use bestprompt_lib::db::frameworks::Framework;
use bestprompt_lib::db::projects::Project;
use bestprompt_lib::db::{migrate, open_in_memory};
use bestprompt_lib::terminal::Sessions;
use bestprompt_lib::terminal::folders::PickedFolders;
use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Everything the app sent down channels, with each channel's id.
type Sent = Arc<Mutex<Vec<(u32, InvokeResponseBody)>>>;

/// The app as `run` builds it, minus the plugins, on a database with the
/// built-ins seeded, with one window of the given label.
fn window(label: &str) -> WebviewWindow<MockRuntime> {
    window_with_channels(label, Sent::default())
}

/// Like `window`, recording what the app sends down channels in `sent`.
/// Claude Code is `examples/fake_claude.rs`, which `cargo test` builds into
/// `target/<profile>/examples/`, next to this binary's `deps/`.
fn window_with_channels(label: &str, sent: Sent) -> WebviewWindow<MockRuntime> {
    let mut conn = open_in_memory().unwrap();
    migrate::migrate(&mut conn).unwrap();
    seed_builtins(&mut conn).unwrap();
    let app = register(mock_builder())
        .manage(Db(Mutex::new(conn)))
        .manage(fake_claude())
        .manage(Sessions::default())
        .manage(PickedFolders::new())
        .channel_interceptor(move |_, callback, _, body| {
            sent.lock().unwrap().push((callback.0, body.clone()));
            true
        })
        .build(tauri::generate_context!())
        .unwrap();
    // `build` doesn't create the windows from `tauri.conf.json`; `run` would.
    WebviewWindowBuilder::new(&app, label, WebviewUrl::default())
        .build()
        .unwrap()
}

/// The fake writes its arguments to the file this names, in the folder it
/// starts in: one line each, its UTF-8 in hex.
const ARGS_VAR: &str = "FAKE_CLAUDE_ARGS";
const ARGS_FILE: &str = "fake-claude-args";

fn fake_claude() -> ClaudeState {
    let exe = std::env::current_exe().unwrap();
    let profile = exe.parent().unwrap().parent().unwrap();
    let fake = profile
        .join("examples")
        .join(format!("fake_claude{}", std::env::consts::EXE_SUFFIX));
    let env = std::env::vars_os()
        .chain([(ARGS_VAR.into(), ARGS_FILE.into())])
        .collect();
    ClaudeState::from_parts(Some(ClaudeExe::Exe(fake)), env, None)
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

fn projects(window: &WebviewWindow<MockRuntime>) -> Vec<Project> {
    serde_json::from_value(invoke(window, "list_projects", json!({})).unwrap()).unwrap()
}

#[test]
fn a_folder_not_picked_is_refused_for_a_project() {
    let window = main_window();
    let dir = tempfile::tempdir().unwrap();
    let existing: Project = serde_json::from_value(
        invoke(&window, "create_project", json!({ "name": "Old" })).unwrap(),
    )
    .unwrap();
    let refused = json!({ "kind": "invalid", "message": "That folder isn't one you chose." });

    let created = invoke(
        &window,
        "create_project",
        json!({ "name": "API", "folder": dir.path() }),
    );
    let set = invoke(
        &window,
        "set_project_folder",
        json!({ "id": existing.id, "folder": dir.path() }),
    );

    assert_eq!(created, Err(refused.clone()));
    assert_eq!(set, Err(refused));
    assert_eq!(projects(&window), [existing]);
}

#[test]
fn a_picked_folder_is_stored() {
    let window = main_window();
    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().to_str().unwrap().to_owned();
    window
        .state::<PickedFolders>()
        .record(dir.path().to_path_buf());

    let created: Project = serde_json::from_value(
        invoke(
            &window,
            "create_project",
            json!({ "name": "API", "folder": folder }),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(created.folder.as_deref(), Some(folder.as_str()));
    assert_eq!(projects(&window), std::slice::from_ref(&created));

    let cleared: Project = serde_json::from_value(
        invoke(
            &window,
            "set_project_folder",
            json!({ "id": created.id, "folder": null }),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(cleared.folder, None);
    assert_eq!(projects(&window), std::slice::from_ref(&cleared));

    let set: Project = serde_json::from_value(
        invoke(
            &window,
            "set_project_folder",
            json!({ "id": created.id, "folder": folder }),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(set.folder.as_deref(), Some(folder.as_str()));
    assert_eq!(projects(&window), [set]);
}

#[test]
fn a_projects_own_folder_can_be_set_again_without_a_pick() {
    let window = main_window();
    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().to_str().unwrap().to_owned();
    window
        .state::<PickedFolders>()
        .record(dir.path().to_path_buf());
    let project: Project = serde_json::from_value(
        invoke(
            &window,
            "create_project",
            json!({ "name": "API", "folder": folder }),
        )
        .unwrap(),
    )
    .unwrap();

    // A later run: nothing is picked, but the project still has the folder.
    let later = main_window();
    later
        .state::<Db>()
        .0
        .lock()
        .unwrap()
        .execute(
            "INSERT INTO projects (id, name, folder, created_at, updated_at) VALUES (?1, 'API', ?2, 0, 0)",
            [&project.id, &folder],
        )
        .unwrap();
    let set: Project = serde_json::from_value(
        invoke(
            &later,
            "set_project_folder",
            json!({ "id": project.id, "folder": folder }),
        )
        .unwrap(),
    )
    .unwrap();

    assert_eq!(set.folder.as_deref(), Some(folder.as_str()));
}

#[test]
fn another_projects_folder_is_refused() {
    let window = main_window();
    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().to_str().unwrap().to_owned();
    {
        let db = window.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO projects (id, name, folder, created_at, updated_at) VALUES ('a', 'A', '{}', 0, 0);
             INSERT INTO projects (id, name, created_at, updated_at) VALUES ('b', 'B', 0, 0);",
            folder.replace('\'', "''")
        ))
        .unwrap();
    }

    let error = invoke(
        &window,
        "set_project_folder",
        json!({ "id": "b", "folder": folder }),
    );

    assert_eq!(
        error,
        Err(json!({ "kind": "invalid", "message": "That folder isn't one you chose." }))
    );
}

#[test]
fn a_projects_folder_can_start_a_session_without_a_pick() {
    let sent = Sent::default();
    let window = window_with_channels("main", sent.clone());
    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().to_str().unwrap().to_owned();
    // Saved straight into the database, as an earlier run would have left it.
    window
        .state::<Db>()
        .0
        .lock()
        .unwrap()
        .execute(
            "INSERT INTO projects (id, name, folder, created_at, updated_at) VALUES ('p', 'API', ?1, 0, 0)",
            [&folder],
        )
        .unwrap();

    let started = invoke(
        &window,
        "start_session",
        json!({
            "folder": folder,
            "cols": 120,
            "rows": 30,
            "output": OUTPUT,
            "events": EVENTS,
        }),
    )
    .unwrap();

    let id = started["id"].as_str().unwrap().to_owned();
    assert_eq!(
        invoke(&window, "close_session", json!({ "id": id })),
        Ok(Value::Null)
    );
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

fn framework_input(name: &str, sections: Value) -> Value {
    json!({
        "name": name,
        "description": "",
        "template": "{{goal}}",
        "summaryKey": "goal",
        "sections": sections,
    })
}

#[test]
fn create_update_delete_restore_through_ipc() {
    let window = main_window();
    let goal = json!({ "key": "goal", "label": "Goal", "helpText": "" });
    let tone = json!({ "key": "tone", "label": "Tone", "helpText": "" });

    let created: Framework = serde_json::from_value(
        invoke(
            &window,
            "create_framework",
            json!({ "input": framework_input("Mine", json!([goal])) }),
        )
        .unwrap(),
    )
    .unwrap();
    let updated: Framework = serde_json::from_value(
        invoke(
            &window,
            "update_framework",
            json!({ "id": created.id, "input": framework_input("Yours", json!([goal, tone])) }),
        )
        .unwrap(),
    )
    .unwrap();
    let deleted: Framework = serde_json::from_value(
        invoke(&window, "delete_framework", json!({ "id": created.id })).unwrap(),
    )
    .unwrap();
    let after_delete: Vec<Framework> =
        serde_json::from_value(invoke(&window, "list_frameworks", json!({})).unwrap()).unwrap();
    let restored: Framework = serde_json::from_value(
        invoke(&window, "restore_framework", json!({ "id": created.id })).unwrap(),
    )
    .unwrap();
    let after_restore: Vec<Framework> =
        serde_json::from_value(invoke(&window, "list_frameworks", json!({})).unwrap()).unwrap();

    assert!(created.is_custom);
    assert_eq!(created.name, "Mine");
    assert_eq!(updated.id, created.id);
    assert_eq!(updated.name, "Yours");
    assert_eq!(updated.sections.len(), 2);
    assert!(deleted.deleted_at.is_some());
    assert!(after_delete.iter().all(|f| f.id != created.id));
    assert_eq!(restored.id, created.id);
    assert_eq!(restored.deleted_at, None);
    assert!(after_restore.iter().any(|f| f.id == created.id));
}

#[test]
fn an_invalid_framework_reaches_the_webview_as_invalid() {
    let window = main_window();

    let error = invoke(
        &window,
        "create_framework",
        json!({ "input": framework_input("Mine", json!([])) }),
    )
    .unwrap_err();

    assert_eq!(error["kind"], "invalid");
}

const OUTPUT: &str = "__CHANNEL__:1";
const EVENTS: &str = "__CHANNEL__:2";

/// The raw bytes sent down channel `id` so far.
fn raw_on(sent: &Sent, id: u32) -> Vec<u8> {
    sent.lock()
        .unwrap()
        .iter()
        .filter(|(channel, _)| *channel == id)
        .flat_map(|(_, body)| match body {
            InvokeResponseBody::Raw(bytes) => bytes.clone(),
            InvokeResponseBody::Json(text) => text.clone().into_bytes(),
        })
        .collect()
}

/// Waits until `found` holds for what was sent down channel `id`.
fn wait_on(sent: &Sent, id: u32, what: &str, found: impl Fn(&str) -> bool) {
    let start = Instant::now();
    loop {
        let text = String::from_utf8_lossy(&raw_on(sent, id)).into_owned();
        if found(&text) {
            return;
        }
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "timed out waiting for {what}: {text:?}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Starts the fake CLI through `start_session` in a new folder the user
/// picked, with `prompt`, and waits until it's ready. Returns the session
/// id, what `start_session` returned, and the folder, which lives as long
/// as the value.
fn start_fake_session(
    window: &WebviewWindow<MockRuntime>,
    sent: &Sent,
    prompt: Option<&str>,
) -> (String, Value, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    window
        .state::<PickedFolders>()
        .record(dir.path().to_path_buf());

    let started = invoke(
        window,
        "start_session",
        json!({
            "folder": dir.path(),
            "cols": 120,
            "rows": 30,
            "prompt": prompt,
            "output": OUTPUT,
            "events": EVENTS,
        }),
    )
    .unwrap();
    let id = started["id"].as_str().unwrap().to_owned();
    // ConPTY asks where the cursor is and shows nothing until it's told, as
    // xterm.js does in the app.
    if cfg!(windows) {
        wait_on(sent, 1, "the cursor query", |text| text.contains("\x1b[6n"));
        let reply = json!({ "id": id, "data": "\x1b[1;1R" });
        assert_eq!(invoke(window, "write_session", reply), Ok(Value::Null));
    }
    wait_on(sent, 1, "ready", |text| text.contains("ready"));
    (id, started, dir)
}

#[test]
fn a_session_runs_through_ipc() {
    let sent = Sent::default();
    let window = window_with_channels("main", sent.clone());
    let (id, started, dir) = start_fake_session(&window, &sent, None);

    let wrote = invoke(&window, "write_session", json!({ "id": id, "data": "abc" }));
    wait_on(&sent, 1, "the input", |text| text.contains("hex 616263"));
    let resized = invoke(
        &window,
        "resize_session",
        json!({ "id": id, "cols": 100, "rows": 40 }),
    );
    let closed = invoke(&window, "close_session", json!({ "id": id }));
    wait_on(&sent, 2, "the exit", |text| {
        text.contains(r#""type":"exited""#)
    });
    let after = invoke(&window, "write_session", json!({ "id": id, "data": "x" }));

    assert_eq!(started, json!({ "id": id, "prefilled": false }));
    let args = std::fs::read_to_string(dir.path().join(ARGS_FILE)).unwrap();
    assert_eq!(args, "");
    assert_eq!(wrote, Ok(Value::Null));
    assert_eq!(resized, Ok(Value::Null));
    assert_eq!(closed, Ok(Value::Null));
    assert_eq!(
        after,
        Err(json!({ "kind": "notFound", "message": "That session has ended." }))
    );
}

#[test]
fn a_session_starts_with_a_prompt_through_ipc() {
    let sent = Sent::default();
    let window = window_with_channels("main", sent.clone());

    let (id, started, dir) = start_fake_session(&window, &sent, Some("fix\r\nit"));

    let hex: String = b"--prefill=fix\nit"
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let args = std::fs::read_to_string(dir.path().join(ARGS_FILE)).unwrap();
    assert_eq!(args, format!("{hex}\n"));
    assert_eq!(started, json!({ "id": id, "prefilled": true }));
    let closed = invoke(&window, "close_session", json!({ "id": id }));
    assert_eq!(closed, Ok(Value::Null));
}

/// An unknown session is refused before the clipboard is touched.
#[test]
fn pasting_into_an_unknown_session_is_an_ended_error() {
    let window = main_window();

    let error = invoke(&window, "paste_clipboard", json!({ "id": "nope" }));

    assert_eq!(
        error,
        Err(json!({ "kind": "notFound", "message": "That session has ended." }))
    );
}

#[test]
fn a_folder_never_picked_cannot_start_a_session() {
    let window = main_window();
    let dir = tempfile::tempdir().unwrap();

    let error = invoke(
        &window,
        "start_session",
        json!({
            "folder": dir.path(),
            "cols": 80,
            "rows": 24,
            "output": OUTPUT,
            "events": EVENTS,
        }),
    )
    .unwrap_err();

    assert_eq!(
        error,
        json!({ "kind": "invalid", "message": "That folder isn't one you chose." })
    );
}

#[test]
fn the_webview_can_read_the_claude_status() {
    let window = main_window();

    let status = invoke(&window, "claude_status", json!({})).unwrap();

    assert_eq!(status["found"], true);
    let path = PathBuf::from(status["path"].as_str().unwrap());
    assert!(path.ends_with(format!("fake_claude{}", std::env::consts::EXE_SUFFIX)));
}

#[test]
fn get_and_set_settings_over_ipc() {
    // Each window gets its own fresh in-memory database, so these are the
    // defaults.
    let window = main_window();

    let before = invoke(&window, "get_settings", json!({})).unwrap();
    invoke(
        &window,
        "set_setting",
        json!({ "setting": { "theme": "dark" } }),
    )
    .unwrap();
    invoke(
        &window,
        "set_setting",
        json!({ "setting": { "sendHintSeen": true } }),
    )
    .unwrap();
    let after = invoke(&window, "get_settings", json!({})).unwrap();

    assert_eq!(before, json!({ "theme": "system", "sendHintSeen": false }));
    assert_eq!(after, json!({ "theme": "dark", "sendHintSeen": true }));
}
