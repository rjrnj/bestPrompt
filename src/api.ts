// Typed wrappers around Tauri's `invoke`, one per command in
// src-tauri/src/commands.rs. The types come from src/bindings, which ts-rs
// generates from the Rust types.

import { invoke } from "@tauri-apps/api/core";
import type { DbError, DbErrorKind } from "./bindings/DbError";
import type { EntryCursor } from "./bindings/EntryCursor";
import type { EntryQuery } from "./bindings/EntryQuery";
import type { Framework } from "./bindings/Framework";
import type { FrameworkInput } from "./bindings/FrameworkInput";
import type { NewPromptEntry } from "./bindings/NewPromptEntry";
import type { Project } from "./bindings/Project";
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

// `satisfies` makes this a compile error when the generated DbErrorKind gains
// a value that isn't listed here, so a new backend kind can't be silently
// reclassified as "database".
const KINDS = {
  database: true,
  notFound: true,
  invalid: true,
} satisfies Record<DbErrorKind, true>;

function isKnownKind(value: unknown): value is DbErrorKind {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(KINDS, value)
  );
}

/** Only the backend's own `{ kind, message }` shape, with a kind we know. */
function isDbError(value: unknown): value is DbError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    isKnownKind(value.kind) &&
    "message" in value &&
    typeof value.message === "string"
  );
}

/** The best available text for a rejection that isn't the backend's shape. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
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
    throw new ApiError("database", messageOf(error));
  }
}

export function listFrameworks(): Promise<Framework[]> {
  return call("list_frameworks");
}

export function getFramework(id: string): Promise<Framework> {
  return call("get_framework", { id });
}

export function createFramework(input: FrameworkInput): Promise<Framework> {
  return call("create_framework", { input });
}

export function updateFramework(
  id: string,
  input: FrameworkInput,
): Promise<Framework> {
  return call("update_framework", { id, input });
}

export function deleteFramework(id: string): Promise<Framework> {
  return call("delete_framework", { id });
}

export function restoreFramework(id: string): Promise<Framework> {
  return call("restore_framework", { id });
}

export function savePromptEntry(entry: NewPromptEntry): Promise<PromptEntry> {
  return call("save_prompt_entry", { entry });
}

export function listPromptEntries(
  query: EntryQuery,
  limit: number,
  after: EntryCursor | null,
): Promise<PromptEntry[]> {
  return call("list_prompt_entries", { query, limit, after });
}

export function getPromptEntry(id: string): Promise<PromptEntry> {
  return call("get_prompt_entry", { id });
}

export function setEntryTitle(
  id: string,
  title: string | null,
): Promise<PromptEntry> {
  return call("set_entry_title", { id, title });
}

export function setEntryProject(
  id: string,
  projectId: string | null,
): Promise<PromptEntry> {
  return call("set_entry_project", { id, projectId });
}

export function deletePromptEntry(id: string): Promise<void> {
  return call("delete_prompt_entry", { id });
}

export function latestEntryProject(): Promise<string | null> {
  return call("latest_entry_project");
}

export function listProjects(): Promise<Project[]> {
  return call("list_projects");
}

export function createProject(name: string): Promise<Project> {
  return call("create_project", { name });
}

export function renameProject(id: string, name: string): Promise<Project> {
  return call("rename_project", { id, name });
}

export function deleteProject(id: string): Promise<void> {
  return call("delete_project", { id });
}
