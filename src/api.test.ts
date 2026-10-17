import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import {
  ApiError,
  getFramework,
  getPromptEntry,
  listFrameworks,
  listPromptEntries,
  savePromptEntry,
} from "./api";
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

  it("lists entries through list_prompt_entries with limit and offset", async () => {
    const calls = answering([entry]);

    await expect(listPromptEntries(20, 40)).resolves.toEqual([entry]);

    expect(calls).toEqual([
      { cmd: "list_prompt_entries", args: { limit: 20, offset: 40 } },
    ]);
  });

  it("gets an entry through get_prompt_entry with its id", async () => {
    const calls = answering(entry);

    await expect(getPromptEntry(entry.id)).resolves.toEqual(entry);

    expect(calls).toEqual([
      { cmd: "get_prompt_entry", args: { id: entry.id } },
    ]);
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
