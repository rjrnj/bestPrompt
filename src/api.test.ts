import { Channel } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  claudeStatus,
  closeSession,
  createFramework,
  createProject,
  deleteFramework,
  deleteProject,
  deletePromptEntry,
  detectClaude,
  getFramework,
  getPromptEntry,
  latestEntryProject,
  listFrameworks,
  listProjects,
  listPromptEntries,
  pasteClipboard,
  pickFolder,
  renameProject,
  resizeSession,
  restoreFramework,
  savePromptEntry,
  setEntryProject,
  setEntryTitle,
  setProjectFolder,
  startSession,
  updateFramework,
  writeSession,
} from "./api";
import type { EntryQuery } from "./bindings/EntryQuery";
import type { Framework } from "./bindings/Framework";
import type { FrameworkInput } from "./bindings/FrameworkInput";
import type { PromptEntry } from "./bindings/PromptEntry";

type Call = { cmd: string; args: unknown };

/** Answers every command with `result` and records what was asked. */
function answering(result: unknown): Call[] {
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    return result;
  });
  return calls;
}

const rtf: Framework = {
  id: "rtf",
  name: "RTF",
  description: "",
  template: "{{role}}",
  summaryKey: null,
  isCustom: false,
  deletedAt: null,
  sections: [{ key: "role", label: "Role", helpText: "" }],
  createdAt: 1,
  updatedAt: 1,
};

const entry: PromptEntry = {
  id: "0192d4c8-7b3a-7f00-8a1e-3c5d7e9f0b2a",
  frameworkId: "rtf",
  frameworkSnapshot: {
    name: "RTF",
    template: "{{role}}",
    summaryKey: null,
    sections: [],
  },
  sectionValues: { role: "a reviewer" },
  renderedPrompt: "a reviewer",
  title: null,
  projectId: null,
  createdAt: 2,
  version: 0,
};

afterEach(clearMocks);

describe("api", () => {
  it("lists frameworks through list_frameworks", async () => {
    const calls = answering([rtf]);

    await expect(listFrameworks()).resolves.toEqual([rtf]);

    expect(calls).toEqual([{ cmd: "list_frameworks", args: {} }]);
  });

  it("gets a framework through get_framework with its id", async () => {
    const calls = answering(rtf);

    await expect(getFramework("rtf")).resolves.toEqual(rtf);

    expect(calls).toEqual([{ cmd: "get_framework", args: { id: "rtf" } }]);
  });

  it("creates a framework through create_framework with its input", async () => {
    const calls = answering(rtf);
    const input: FrameworkInput = {
      name: "RTF",
      description: "",
      template: "{{role}}",
      summaryKey: "",
      sections: rtf.sections,
    };

    await expect(createFramework(input)).resolves.toEqual(rtf);

    expect(calls).toEqual([{ cmd: "create_framework", args: { input } }]);
  });

  it("updates a framework through update_framework with its id and input", async () => {
    const calls = answering(rtf);
    const input: FrameworkInput = {
      name: "RTF",
      description: "",
      template: "{{role}}",
      summaryKey: "",
      sections: rtf.sections,
    };

    await expect(updateFramework("rtf", input)).resolves.toEqual(rtf);

    expect(calls).toEqual([
      { cmd: "update_framework", args: { id: "rtf", input } },
    ]);
  });

  it("deletes a framework through delete_framework with its id", async () => {
    const calls = answering(rtf);

    await expect(deleteFramework("rtf")).resolves.toEqual(rtf);

    expect(calls).toEqual([{ cmd: "delete_framework", args: { id: "rtf" } }]);
  });

  it("restores a framework through restore_framework with its id", async () => {
    const calls = answering(rtf);

    await expect(restoreFramework("rtf")).resolves.toEqual(rtf);

    expect(calls).toEqual([{ cmd: "restore_framework", args: { id: "rtf" } }]);
  });

  it("saves an entry through save_prompt_entry under the key entry", async () => {
    const calls = answering(entry);
    const draft = {
      frameworkId: "rtf",
      sectionValues: { role: "a reviewer" },
      renderedPrompt: "a reviewer",
      title: null,
      projectId: null,
    };

    await expect(savePromptEntry(draft)).resolves.toEqual(entry);

    expect(calls).toEqual([
      { cmd: "save_prompt_entry", args: { entry: draft } },
    ]);
  });

  it("lists entries through list_prompt_entries with query, limit and cursor", async () => {
    const calls = answering([entry]);
    const query: EntryQuery = {
      project: { kind: "project", id: "p" },
      frameworkId: null,
      search: "csv",
    };

    const after = { createdAt: 5, id: "e9" };

    await expect(listPromptEntries(query, 20, after)).resolves.toEqual([entry]);

    expect(calls).toEqual([
      { cmd: "list_prompt_entries", args: { query, limit: 20, after } },
    ]);
  });

  it("gets an entry through get_prompt_entry with its id", async () => {
    const calls = answering(entry);

    await expect(getPromptEntry(entry.id)).resolves.toEqual(entry);

    expect(calls).toEqual([
      { cmd: "get_prompt_entry", args: { id: entry.id } },
    ]);
  });

  it("lists projects through list_projects", async () => {
    const project = {
      id: "p",
      name: "API",
      folder: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const calls = answering([project]);

    await expect(listProjects()).resolves.toEqual([project]);

    expect(calls).toEqual([{ cmd: "list_projects", args: {} }]);
  });

  it("creates a project through create_project with its name", async () => {
    const project = {
      id: "p",
      name: "API",
      folder: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const calls = answering(project);

    await expect(createProject("API", "/work/api")).resolves.toEqual(project);

    expect(calls).toEqual([
      {
        cmd: "create_project",
        args: { name: "API", folder: "/work/api" },
      },
    ]);
  });

  it("sets and clears a project's folder through set_project_folder", async () => {
    const project = {
      id: "p",
      name: "API",
      folder: null,
      createdAt: 1,
      updatedAt: 2,
    };
    const calls = answering(project);

    await expect(setProjectFolder("p", null)).resolves.toEqual(project);
    await setProjectFolder("p", "/work/api");

    expect(calls).toEqual([
      { cmd: "set_project_folder", args: { id: "p", folder: null } },
      { cmd: "set_project_folder", args: { id: "p", folder: "/work/api" } },
    ]);
  });

  it("renames a project through rename_project with its id and name", async () => {
    const project = {
      id: "p",
      name: "Docs",
      folder: null,
      createdAt: 1,
      updatedAt: 2,
    };
    const calls = answering(project);

    await expect(renameProject("p", "Docs")).resolves.toEqual(project);

    expect(calls).toEqual([
      { cmd: "rename_project", args: { id: "p", name: "Docs" } },
    ]);
  });

  it("deletes a project through delete_project with its id", async () => {
    const calls = answering(null);

    await expect(deleteProject("p")).resolves.toBeNull();

    expect(calls).toEqual([{ cmd: "delete_project", args: { id: "p" } }]);
  });

  it("sets an entry's title through set_entry_title, including a cleared one", async () => {
    const calls = answering(entry);

    await expect(setEntryTitle(entry.id, "Review")).resolves.toEqual(entry);
    await setEntryTitle(entry.id, null);

    expect(calls).toEqual([
      { cmd: "set_entry_title", args: { id: entry.id, title: "Review" } },
      { cmd: "set_entry_title", args: { id: entry.id, title: null } },
    ]);
  });

  it("moves an entry through set_entry_project under the key projectId", async () => {
    const calls = answering(entry);

    await expect(setEntryProject(entry.id, "p")).resolves.toEqual(entry);
    await setEntryProject(entry.id, null);

    expect(calls).toEqual([
      { cmd: "set_entry_project", args: { id: entry.id, projectId: "p" } },
      { cmd: "set_entry_project", args: { id: entry.id, projectId: null } },
    ]);
  });

  it("deletes an entry through delete_prompt_entry with its id", async () => {
    const calls = answering(null);

    await expect(deletePromptEntry(entry.id)).resolves.toBeNull();

    expect(calls).toEqual([
      { cmd: "delete_prompt_entry", args: { id: entry.id } },
    ]);
  });

  it("reads the newest entry's project through latest_entry_project", async () => {
    const calls = answering("p");

    await expect(latestEntryProject()).resolves.toBe("p");

    expect(calls).toEqual([{ cmd: "latest_entry_project", args: {} }]);
  });

  it("turns a rejected command into an ApiError with its kind and message", async () => {
    mockIPC(() => {
      throw { kind: "notFound", message: "framework nope not found" };
    });

    const error = await getFramework("nope").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      kind: "notFound",
      message: "framework nope not found",
    });
  });

  it("turns an invalid rejection into an ApiError of kind invalid", async () => {
    mockIPC(() => {
      throw { kind: "invalid", message: "A project name can't be blank." };
    });

    const error = await listFrameworks().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      kind: "invalid",
      message: "A project name can't be blank.",
    });
  });

  it("treats a rejection with an unknown kind as a database error, keeping its message", async () => {
    mockIPC(() => {
      throw { kind: "somethingElse", message: "from a plugin" };
    });

    const error = await listFrameworks().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "database", message: "from a plugin" });
  });

  it("wraps an unexpected rejection as a database error", async () => {
    mockIPC(() => {
      throw new TypeError("boom");
    });

    const error = await listFrameworks().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "database", message: "boom" });
  });

  it("turns a failed session error into an ApiError of kind failed", async () => {
    mockIPC(() => {
      throw { kind: "failed", message: "Couldn't start Claude Code." };
    });

    const error = await startSession(
      "/work",
      { cols: 80, rows: 24 },
      null,
      vi.fn(),
      vi.fn(),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      kind: "failed",
      message: "Couldn't start Claude Code.",
    });
  });

  it("asks for the Claude Code status", async () => {
    const status = { found: true, path: "/usr/bin/claude" };
    const calls = answering(status);

    await expect(claudeStatus()).resolves.toEqual(status);
    await expect(detectClaude()).resolves.toEqual(status);

    expect(calls).toEqual([
      { cmd: "claude_status", args: {} },
      { cmd: "detect_claude", args: {} },
    ]);
  });

  it("picks a folder", async () => {
    const calls = answering("/work");

    await expect(pickFolder()).resolves.toBe("/work");

    expect(calls).toEqual([{ cmd: "pick_folder", args: {} }]);
  });

  it("writes, resizes and closes a session", async () => {
    const calls = answering(null);

    await writeSession("s", "ls -l");
    await resizeSession("s", 100, 30);
    await closeSession("s");

    expect(calls).toEqual([
      { cmd: "write_session", args: { id: "s", data: "ls -l" } },
      { cmd: "resize_session", args: { id: "s", cols: 100, rows: 30 } },
      { cmd: "close_session", args: { id: "s" } },
    ]);
  });

  it("pastes the clipboard into a session by its id", async () => {
    const calls = answering(null);

    await pasteClipboard("s");

    expect(calls).toEqual([{ cmd: "paste_clipboard", args: { id: "s" } }]);
  });

  it("starts a session over two channels and hands output over as bytes", async () => {
    let args: Record<string, unknown> = {};
    let cmd = "";
    mockIPC((c, a) => {
      cmd = c;
      args = a as Record<string, unknown>;
      return { id: "session-1", prefilled: false };
    });
    const onOutput = vi.fn();
    const onEvent = vi.fn();

    await expect(
      startSession("/work", { cols: 100, rows: 30 }, null, onOutput, onEvent),
    ).resolves.toEqual({ id: "session-1", prefilled: false });

    expect(cmd).toBe("start_session");
    expect(args).toMatchObject({
      folder: "/work",
      cols: 100,
      rows: 30,
      prompt: null,
    });
    const output = args.output as Channel<unknown>;
    const events = args.events as Channel<unknown>;
    expect(output).toBeInstanceOf(Channel);
    expect(events).toBeInstanceOf(Channel);
    expect(output).not.toBe(events);

    output.onmessage(new Uint8Array([104, 105]).buffer);
    output.onmessage([111, 107]);
    events.onmessage({ type: "exited", code: 0 });

    expect(onOutput).toHaveBeenNthCalledWith(1, new Uint8Array([104, 105]));
    expect(onOutput).toHaveBeenNthCalledWith(2, new Uint8Array([111, 107]));
    expect(onOutput.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(onEvent).toHaveBeenCalledWith({ type: "exited", code: 0 });
  });

  it("starts a session with a prompt and says whether it was prefilled", async () => {
    let args: Record<string, unknown> = {};
    mockIPC((_, a) => {
      args = a as Record<string, unknown>;
      return { id: "session-2", prefilled: true };
    });

    await expect(
      startSession("/work", { cols: 80, rows: 24 }, "fix it", vi.fn(), vi.fn()),
    ).resolves.toEqual({ id: "session-2", prefilled: true });

    expect(args).toMatchObject({ folder: "/work", prompt: "fix it" });
  });
});
