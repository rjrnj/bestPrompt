import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import {
  ApiError,
  createProject,
  deleteProject,
  deletePromptEntry,
  getFramework,
  getPromptEntry,
  latestEntryProject,
  listFrameworks,
  listProjects,
  listPromptEntries,
  renameProject,
  savePromptEntry,
  setEntryProject,
  setEntryTitle,
} from "./api";
import type { EntryQuery } from "./bindings/EntryQuery";
import type { Framework } from "./bindings/Framework";
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

  it("lists entries through list_prompt_entries with query, limit and offset", async () => {
    const calls = answering([entry]);
    const query: EntryQuery = {
      project: { kind: "project", id: "p" },
      frameworkId: null,
      search: "csv",
    };

    await expect(listPromptEntries(query, 20, 40)).resolves.toEqual([entry]);

    expect(calls).toEqual([
      { cmd: "list_prompt_entries", args: { query, limit: 20, offset: 40 } },
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
    const project = { id: "p", name: "API", createdAt: 1, updatedAt: 1 };
    const calls = answering([project]);

    await expect(listProjects()).resolves.toEqual([project]);

    expect(calls).toEqual([{ cmd: "list_projects", args: {} }]);
  });

  it("creates a project through create_project with its name", async () => {
    const project = { id: "p", name: "API", createdAt: 1, updatedAt: 1 };
    const calls = answering(project);

    await expect(createProject("API")).resolves.toEqual(project);

    expect(calls).toEqual([{ cmd: "create_project", args: { name: "API" } }]);
  });

  it("renames a project through rename_project with its id and name", async () => {
    const project = { id: "p", name: "Docs", createdAt: 1, updatedAt: 2 };
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
});
