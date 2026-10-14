// Typed wrappers around Tauri's `invoke`, one per command in
// src-tauri/src/commands.rs. The types come from src/bindings, which ts-rs
// generates from the Rust types.

import { invoke } from "@tauri-apps/api/core";
import type { DbError, DbErrorKind } from "./bindings/DbError";
import type { Framework } from "./bindings/Framework";
import type { NewPromptEntry } from "./bindings/NewPromptEntry";
import type { PromptEntry } from "./bindings/PromptEntry";

/** A command that failed, with the `kind` the backend reported. */
export class ApiError extends Error {
  readonly kind: DbErrorKind;

  constructor(kind: DbErrorKind, message: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
  }
}

function isDbError(value: unknown): value is DbError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value
  );
}

/**
 * Calls a command and turns a rejection into an `ApiError`. The backend
 * rejects with a plain `{ kind, message }` object; anything else (an IPC
 * failure, a command missing from the capability) is reported as a database
 * error with whatever text is available.
 */
async function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (error) {
    if (isDbError(error)) {
      throw new ApiError(error.kind, error.message);
    }
    throw new ApiError(
      "database",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function listFrameworks(): Promise<Framework[]> {
  return call("list_frameworks");
}

export function getFramework(id: string): Promise<Framework> {
  return call("get_framework", { id });
}

export function savePromptEntry(entry: NewPromptEntry): Promise<PromptEntry> {
  return call("save_prompt_entry", { entry });
}

export function listPromptEntries(
  limit: number,
  offset: number,
): Promise<PromptEntry[]> {
  return call("list_prompt_entries", { limit, offset });
}

export function getPromptEntry(id: string): Promise<PromptEntry> {
  return call("get_prompt_entry", { id });
}
