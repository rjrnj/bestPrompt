import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  claudeStatus,
  closeSession,
  latestEntryProject,
  listFrameworks,
  listProjects,
  pasteClipboard,
  pickFolder,
  savePromptEntry,
  setProjectFolder,
  startSession as startApiSession,
  writeSession,
} from "../api";
import type { Framework } from "../bindings/Framework";
import type { Project } from "../bindings/Project";
import type { PromptEntry } from "../bindings/PromptEntry";
import type { SessionEvent } from "../bindings/SessionEvent";
import type { StartedSession } from "../bindings/StartedSession";
import { writeText } from "../clipboard";
import type { NewPromptEntry } from "../bindings/NewPromptEntry";
import type { Dispatch } from "react";
import {
  AppStateProvider,
  useAppActions,
  useAppDispatch,
  useAppState,
  type AppActions,
} from "../state/AppState";
import type { Action, State } from "../state/reducer";
import { currentPlatform } from "../terminal/keys";
import {
  disposeTerminal,
  startTerminalSession,
  terminalFor,
} from "../terminal/terminals";
import { PromptActions } from "./PromptActions";
import { PromptForm } from "./PromptForm";
import { FolderExplainerDialog } from "./terminal/FolderExplainerDialog";
import { Toaster } from "./Toaster";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  savePromptEntry: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  claudeStatus: vi.fn(),
  pickFolder: vi.fn(),
  setProjectFolder: vi.fn(),
  closeSession: vi.fn(),
  startSession: vi.fn(),
  writeSession: vi.fn(),
  pasteClipboard: vi.fn(),
}));
vi.mock("../clipboard", () => ({ writeText: vi.fn() }));
// No real xterm by default: jsdom can't lay one out. A test can hand these
// the real functions to follow the whole flow down to the api.
vi.mock("../terminal/terminals", () => ({
  startTerminalSession: vi.fn(),
  terminalFor: vi.fn(),
  disposeTerminal: vi.fn(),
}));
vi.mock("../terminal/keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../terminal/keys")>()),
  currentPlatform: vi.fn(),
}));

const rtf: Framework = {
  id: "rtf",
  name: "RTF",
  description: "",
  template:
    "{{#role}}# Role\n{{role}}{{/role}}\n\n{{#task}}# Task\n{{task}}{{/task}}",
  summaryKey: null,
  isCustom: false,
  deletedAt: null,
  sections: [
    { key: "role", label: "Role", helpText: "" },
    { key: "task", label: "Task", helpText: "" },
  ],
  createdAt: 1,
  updatedAt: 1,
};

const broken: Framework = {
  ...rtf,
  template: "{{#role}} never closed",
};

/** The app's state as last rendered, and its actions. */
let appState: State;
let appActions: AppActions;
let appDispatch: Dispatch<Action>;

function StateSpy() {
  const state = useAppState();
  const actions = useAppActions();
  const dispatch = useAppDispatch();
  useEffect(() => {
    appState = state;
    appActions = actions;
    appDispatch = dispatch;
  });
  return null;
}

async function renderActions(framework: Framework = rtf) {
  vi.mocked(listFrameworks).mockResolvedValue([framework]);
  render(
    <AppStateProvider>
      <PromptForm />
      <PromptActions />
      <FolderExplainerDialog />
      <Toaster />
      <StateSpy />
    </AppStateProvider>,
  );
  return {
    copy: await screen.findByRole("button", { name: "Copy" }),
    save: screen.getByRole("button", { name: "Save" }),
    clear: screen.getByRole("button", { name: "Clear" }),
    role: screen.getByRole("textbox", { name: "Role" }),
    task: screen.getByRole("textbox", { name: "Task" }),
  };
}

function stored(): PromptEntry {
  return {
    id: "entry",
    frameworkId: "rtf",
    frameworkSnapshot: {
      name: rtf.name,
      template: rtf.template,
      summaryKey: rtf.summaryKey,
      sections: rtf.sections,
    },
    sectionValues: {},
    renderedPrompt: "",
    title: null,
    projectId: null,
    createdAt: 1,
    version: 0,
  };
}

beforeEach(() => {
  vi.mocked(listProjects).mockResolvedValue([]);
  vi.mocked(latestEntryProject).mockResolvedValue(null);
  vi.mocked(claudeStatus).mockResolvedValue({
    found: true,
    path: "/bin/claude",
  });
  vi.mocked(currentPlatform).mockReturnValue("windows");
  vi.mocked(closeSession).mockResolvedValue();
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

// The buttons are marked unavailable with aria-disabled rather than
// disabled, so a button that becomes unavailable while focused keeps focus.
function expectOff(...buttons: HTMLElement[]) {
  for (const button of buttons) {
    expect(button).toHaveAttribute("aria-disabled", "true");
  }
}

function expectOn(...buttons: HTMLElement[]) {
  for (const button of buttons) {
    expect(button).not.toHaveAttribute("aria-disabled", "true");
  }
}

describe("PromptActions", () => {
  it("marks every button unavailable while the draft is empty", async () => {
    const { copy, save, clear } = await renderActions();

    expectOff(copy, save, clear, await findSend());
  });

  it("ignores Copy and Save while they are unavailable", async () => {
    const { copy, save } = await renderActions();

    await userEvent.click(copy);
    await userEvent.click(save);

    expect(writeText).not.toHaveBeenCalled();
    expect(savePromptEntry).not.toHaveBeenCalled();
  });

  it("offers every button once a section has text", async () => {
    const { copy, save, clear, role } = await renderActions();

    await userEvent.type(role, "a reviewer");

    expectOn(copy, save, clear);
  });

  it("offers only Clear for a draft of whitespace", async () => {
    const { copy, save, clear, role } = await renderActions();

    await userEvent.type(role, "   ");

    expectOff(copy, save);
    expectOn(clear);
  });

  it("offers only Clear for a title alone, and clears it", async () => {
    const { copy, save, clear } = await renderActions();
    const title = screen.getByRole("textbox", { name: "Title" });

    await userEvent.type(title, "Login fix");

    expectOff(copy, save);
    expectOn(clear);
    await userEvent.click(clear);
    expect(title).toHaveValue("");
    expectOff(clear);
  });

  it("offers only Clear when the template renders nothing", async () => {
    const { copy, save, clear, role } = await renderActions(broken);

    await userEvent.type(role, "a reviewer");

    expectOff(copy, save);
    expectOn(clear);
  });

  it("clears the draft and keeps focus on Clear", async () => {
    const { clear, role } = await renderActions();
    await userEvent.type(role, "a reviewer");

    await userEvent.click(clear);

    expect(role).toHaveValue("");
    expectOff(clear);
    expect(clear).toHaveFocus();
  });

  it("copies the rendered prompt and saves it with every section", async () => {
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry).mockResolvedValue(stored());
    const { copy, role } = await renderActions();
    await userEvent.type(role, "a reviewer");

    await userEvent.click(copy);

    expect(writeText).toHaveBeenCalledWith("# Role\na reviewer");
    expect(savePromptEntry).toHaveBeenCalledExactlyOnceWith({
      frameworkId: "rtf",
      sectionValues: { role: "a reviewer", task: "" },
      renderedPrompt: "# Role\na reviewer",
      title: null,
      projectId: null,
    });
  });

  it("saves under the selected project", async () => {
    vi.mocked(savePromptEntry).mockResolvedValue(stored());
    vi.mocked(listProjects).mockResolvedValue([
      { id: "p-api", name: "api", folder: null, createdAt: 1, updatedAt: 1 },
    ]);
    vi.mocked(latestEntryProject).mockResolvedValue("p-api");
    const { save, role } = await renderActions();
    await userEvent.type(role, "a reviewer");
    await vi.waitFor(() => expect(latestEntryProject).toHaveBeenCalled());

    await userEvent.click(save);

    expect(savePromptEntry).toHaveBeenCalledWith(
      expect.objectContaining({ title: null, projectId: "p-api" }),
    );
  });

  it("saves without copying", async () => {
    vi.mocked(savePromptEntry).mockResolvedValue(stored());
    const { save, task } = await renderActions();
    await userEvent.type(task, "review this");

    await userEvent.click(save);

    expect(writeText).not.toHaveBeenCalled();
    expect(savePromptEntry).toHaveBeenCalledExactlyOnceWith({
      frameworkId: "rtf",
      sectionValues: { role: "", task: "review this" },
      renderedPrompt: "# Task\nreview this",
      title: null,
      projectId: null,
    });
  });

  it("marks Copy and Save unavailable while a save is running", async () => {
    let finish!: (entry: PromptEntry) => void;
    vi.mocked(savePromptEntry).mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    const { copy, save, clear, role } = await renderActions();
    await userEvent.type(role, "a reviewer");

    await userEvent.click(save);

    expectOff(copy, save, await findSend());
    expectOn(clear);
    expect(save).toHaveFocus();
    await act(async () => finish(stored()));
    expectOn(save);
  });
});

const SEND = "Send to Claude Code";
const SENT_LINE = "Sent to Claude Code.";
const PASTE_HINT = "Claude Code is already running. Paste into it with Ctrl+V.";
const ALREADY_RUNNING =
  "Claude Code is already running, so your prompt is copied. Paste it into Claude with Ctrl+V.";

function findSend() {
  return screen.findByRole("button", { name: SEND });
}

function project(id: string, folder: string | null): Project {
  return { id, name: id, folder, createdAt: 1, updatedAt: 1 };
}

const api = project("p-api", "/home/me/api");

/** The event callback of each session started, by id. */
let events: Record<string, (e: SessionEvent) => void>;
/** The focus of each session's terminal, by id. */
let focus: Record<string, () => void>;

/** Makes the next starts return these sessions, in turn. */
function startsWith(...sessions: StartedSession[]) {
  for (const session of sessions) {
    vi.mocked(startTerminalSession).mockImplementationOnce(
      async (_folder, onEvent) => {
        events[session.id] = onEvent;
        return session;
      },
    );
  }
}

/**
 * Renders the actions with `selected` chosen at startup, waits for Send and
 * fills in the Role, so the prompt is `PROMPT`.
 */
async function renderSend(
  projects: Project[] = [api],
  selected: string | null = api.id,
) {
  vi.mocked(listProjects).mockResolvedValue(projects);
  vi.mocked(latestEntryProject).mockResolvedValue(selected);
  const { role } = await renderActions();
  const send = await findSend();
  await vi.waitFor(() => expect(appState.selectedProjectId).toBe(selected));
  await userEvent.type(role, "a reviewer");
  return send;
}

/** Answers the explainer before Claude's folder chooser with Choose folder. */
async function chooseInExplainer() {
  await userEvent.click(
    within(
      await screen.findByRole("alertdialog", {
        name: "Choose a folder for Claude Code",
      }),
    ).getByRole("button", { name: "Choose folder…" }),
  );
}

const PROMPT = "# Role\na reviewer";

/** The entry Send makes from that prompt under `api`. */
const ENTRY: NewPromptEntry = {
  frameworkId: "rtf",
  sectionValues: { role: "a reviewer", task: "" },
  renderedPrompt: PROMPT,
  title: null,
  projectId: api.id,
};

/** The messages of the toasts showing, oldest first. */
function toastTexts(): string[] {
  const messages = appState.toasts.map((toast) => toast.message);
  // Each is on screen, not only in state.
  for (const message of messages) {
    expect(
      within(screen.getByRole("region", { name: /notifications/i })).getByText(
        message,
      ),
    ).toBeInTheDocument();
  }
  return messages;
}

describe("Send to Claude Code", () => {
  beforeEach(() => {
    events = {};
    focus = {};
    vi.mocked(savePromptEntry).mockResolvedValue(stored());
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(terminalFor).mockImplementation((id: string) => {
      focus[id] ??= vi.fn();
      return { focus: focus[id] } as unknown as ReturnType<typeof terminalFor>;
    });
  });

  it("send_is_hidden_when_claude_is_missing", async () => {
    vi.mocked(claudeStatus).mockResolvedValue({ found: false, path: null });
    await renderActions();

    await vi.waitFor(() => expect(appState.claude.status).toBe("missing"));
    expect(screen.queryByRole("button", { name: SEND })).toBeNull();
  });

  it("send_is_hidden_while_claude_is_unknown", async () => {
    vi.mocked(claudeStatus).mockReturnValue(new Promise(() => {}));
    await renderActions();

    expect(appState.claude.status).toBe("unknown");
    expect(screen.queryByRole("button", { name: SEND })).toBeNull();
  });

  it("send_saves_starts_and_pastes", async () => {
    // A short window starts with the drawer hidden.
    vi.stubGlobal("innerHeight", 600);
    startsWith({ id: "s1", prefilled: true });
    const send = await renderSend();
    expect(
      screen.getByRole("button", { name: "Show Claude Code" }),
    ).toBeInTheDocument();

    await userEvent.click(send);

    expect(savePromptEntry).toHaveBeenCalledExactlyOnceWith({
      frameworkId: "rtf",
      sectionValues: { role: "a reviewer", task: "" },
      renderedPrompt: PROMPT,
      title: null,
      projectId: api.id,
    });
    expect(startTerminalSession).toHaveBeenCalledExactlyOnceWith(
      "/home/me/api",
      expect.any(Function),
      { prompt: PROMPT },
    );
    await vi.waitFor(() => expect(focus.s1).toHaveBeenCalled());
    expect(toastTexts()).toEqual([]);
    expect(appState.drawer.open).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Show Claude Code" }),
    ).toBeNull();
    expect(appState.sessions[api.id]).toMatchObject({
      id: "s1",
      state: "running",
    });
    expect(focus.s1).toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("a_session_that_ends_before_the_prompt_runs_copies_it", async () => {
    // Claude exits at once, before the start has even returned.
    vi.mocked(startTerminalSession).mockImplementationOnce(
      async (_folder, onEvent) => {
        onEvent({ type: "exited", code: 1 });
        return { id: "s1", prefilled: true };
      },
    );
    const send = await renderSend();

    await userEvent.click(send);

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual([
        "Claude Code ended before your prompt could run, so it's copied.",
      ]),
    );
    expect(writeText).toHaveBeenCalledExactlyOnceWith(PROMPT);
    expect(appState.sessions[api.id]).toMatchObject({
      id: "s1",
      state: "exited",
      code: 1,
    });
    expect(focus.s1).toBeUndefined();
  });

  it("a_session_that_ends_before_the_prompt_runs_says_so_when_it_cant_be_copied", async () => {
    vi.mocked(writeText).mockRejectedValue(new Error("clipboard busy"));
    vi.mocked(startTerminalSession).mockImplementationOnce(
      async (_folder, onEvent) => {
        onEvent({ type: "exited", code: 1 });
        return { id: "s1", prefilled: true };
      },
    );
    const send = await renderSend();

    await userEvent.click(send);

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual([
        "Couldn't copy to the clipboard: clipboard busy",
      ]),
    );
  });

  it("a_send_finishing_after_a_project_switch_leaves_the_focus_alone", async () => {
    const web = project("p-web", "/home/me/web");
    let finish!: (session: StartedSession) => void;
    vi.mocked(startTerminalSession).mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)),
    );
    const send = await renderSend([api, web], api.id);

    await userEvent.click(send);
    await vi.waitFor(() => expect(startTerminalSession).toHaveBeenCalled());
    // Another project shows before the start has finished.
    act(() => appDispatch({ type: "projectSelected", id: web.id }));
    await act(async () => finish({ id: "s1", prefilled: true }));

    await vi.waitFor(() =>
      expect(appState.sessions[api.id]).toMatchObject({
        id: "s1",
        state: "running",
      }),
    );
    expect(toastTexts()).toEqual([]);
    expect(appState.selectedProjectId).toBe(web.id);
    expect(focus.s1).toBeUndefined();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("send_without_a_folder_explains_first", async () => {
    const bare = project("p-bare", null);
    vi.mocked(pickFolder).mockResolvedValueOnce(null);
    const send = await renderSend([bare], bare.id);

    // Nothing is chosen before the explainer is answered.
    await userEvent.click(send);
    await screen.findByRole("alertdialog", {
      name: "Choose a folder for Claude Code",
    });
    expect(pickFolder).not.toHaveBeenCalled();
    // A cancelled pick starts nothing.
    await chooseInExplainer();
    await vi.waitFor(() =>
      expect(pickFolder).toHaveBeenCalledExactlyOnceWith("claude"),
    );
    await vi.waitFor(() => expectOn(send));
    expect(startTerminalSession).not.toHaveBeenCalled();
    expect(setProjectFolder).not.toHaveBeenCalled();

    vi.mocked(pickFolder).mockResolvedValueOnce("/picked");
    vi.mocked(setProjectFolder).mockResolvedValue({
      ...bare,
      folder: "/picked",
    });
    startsWith({ id: "s1", prefilled: true });
    await userEvent.click(send);
    await chooseInExplainer();

    await vi.waitFor(() =>
      expect(startTerminalSession).toHaveBeenCalledExactlyOnceWith(
        "/picked",
        expect.any(Function),
        { prompt: PROMPT },
      ),
    );
    expect(setProjectFolder).toHaveBeenCalledWith(bare.id, "/picked");
    const last = ({ mock }: { mock: { invocationCallOrder: number[] } }) =>
      mock.invocationCallOrder[mock.invocationCallOrder.length - 1];
    expect(last(vi.mocked(pickFolder))).toBeLessThan(
      last(vi.mocked(setProjectFolder)),
    );
    expect(last(vi.mocked(setProjectFolder))).toBeLessThan(
      last(vi.mocked(startTerminalSession)),
    );
  });

  it("send_is_unavailable_while_a_session_runs_and_says_to_paste", async () => {
    startsWith({ id: "s1", prefilled: false });
    const send = await renderSend();
    expect(screen.queryByText(/already running/)).toBeNull();
    expect(send).not.toHaveAttribute("aria-describedby");

    // A session started with Start, so nothing was sent to it.
    await act(() => appActions.startSession(api.id));
    await vi.waitFor(() => expectOff(send));
    await userEvent.click(send);

    expect(startTerminalSession).toHaveBeenCalledTimes(1);
    expect(savePromptEntry).not.toHaveBeenCalled();
    const hint = screen.getByText(PASTE_HINT);
    expect(send).toHaveAttribute("aria-describedby", hint.id);
    expect(send).toHaveAccessibleDescription(PASTE_HINT);
  });

  it("a_prefilled_send_says_sent_beside_the_button", async () => {
    startsWith({ id: "s1", prefilled: true });
    const send = await renderSend();

    await userEvent.click(send);

    const line = await screen.findByText(SENT_LINE);
    expectOff(send);
    expect(send).toHaveAttribute("aria-describedby", line.id);
    expect(send).toHaveAccessibleDescription(SENT_LINE);
    expect(screen.queryByText(/already running/)).toBeNull();
  });

  it("editing_the_prompt_brings_back_the_paste_hint", async () => {
    startsWith({ id: "s1", prefilled: true });
    const send = await renderSend();
    await userEvent.click(send);
    await screen.findByText(SENT_LINE);

    await userEvent.type(screen.getByRole("textbox", { name: "Role" }), "s");

    expect(screen.queryByText(SENT_LINE)).toBeNull();
    const hint = screen.getByText(PASTE_HINT);
    expect(send).toHaveAttribute("aria-describedby", hint.id);
  });

  it("a_copied_send_keeps_the_paste_hint", async () => {
    startsWith({ id: "s1", prefilled: false });
    const send = await renderSend();

    await userEvent.click(send);

    const hint = await screen.findByText(PASTE_HINT);
    expect(screen.queryByText(SENT_LINE)).toBeNull();
    expect(send).toHaveAttribute("aria-describedby", hint.id);
  });

  it("send_is_unavailable_while_a_session_runs_and_says_to_paste on Linux", async () => {
    vi.mocked(currentPlatform).mockReturnValue("linux");
    startsWith({ id: "s1", prefilled: false });
    const send = await renderSend();

    await act(() => appActions.startSession(api.id));

    expect(
      await screen.findByText(
        "Claude Code is already running. Paste into it with Ctrl+Shift+V.",
      ),
    ).toBeInTheDocument();
    expectOff(send);
  });

  it("send_after_an_exited_session_starts_a_new_one", async () => {
    startsWith({ id: "s1", prefilled: true }, { id: "s2", prefilled: true });
    const send = await renderSend();
    await userEvent.click(send);
    await vi.waitFor(() => expectOff(send));

    act(() => events.s1({ type: "exited", code: 0 }));

    expectOn(send);
    expect(screen.queryByText(/already running/)).toBeNull();
    await userEvent.click(send);
    await vi.waitFor(() =>
      expect(appState.sessions[api.id]).toMatchObject({
        id: "s2",
        state: "running",
      }),
    );
    expect(startTerminalSession).toHaveBeenCalledTimes(2);
    expect(startTerminalSession).toHaveBeenLastCalledWith(
      "/home/me/api",
      expect.any(Function),
      { prompt: PROMPT },
    );
    // The ended session had nothing left to close.
    expect(closeSession).not.toHaveBeenCalled();
  });

  it("a_prompt_that_isnt_prefilled_is_copied_and_says_so", async () => {
    startsWith({ id: "s1", prefilled: false });
    const send = await renderSend();

    await userEvent.click(send);

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual([
        "Claude Code couldn't take this prompt directly, so it's copied. Paste it into Claude with Ctrl+V.",
      ]),
    );
    expect(writeText).toHaveBeenCalledExactlyOnceWith(PROMPT);
  });

  it("a_prompt_that_isnt_prefilled_is_copied_and_says_so on Linux", async () => {
    vi.mocked(currentPlatform).mockReturnValue("linux");
    startsWith({ id: "s1", prefilled: false });
    const send = await renderSend();

    await userEvent.click(send);

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual([
        "Claude Code couldn't take this prompt directly, so it's copied. Paste it into Claude with Ctrl+Shift+V.",
      ]),
    );
    expect(writeText).toHaveBeenCalledExactlyOnceWith(PROMPT);
  });

  it("a prompt that isn't prefilled says so when it can't be copied", async () => {
    vi.mocked(writeText).mockRejectedValue(new Error("clipboard busy"));
    startsWith({ id: "s1", prefilled: false });
    const send = await renderSend();

    await userEvent.click(send);

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual([
        "Couldn't copy to the clipboard: clipboard busy",
      ]),
    );
  });

  it("a_failed_start_shows_the_error_and_pastes_nothing", async () => {
    vi.mocked(startTerminalSession).mockRejectedValueOnce(
      new ApiError("failed", "Claude Code could not start."),
    );
    const send = await renderSend();

    await userEvent.click(send);

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual(["Claude Code could not start."]),
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(writeSession).not.toHaveBeenCalled();
    expect(pasteClipboard).not.toHaveBeenCalled();
    expect(terminalFor).not.toHaveBeenCalled();
    await vi.waitFor(() => expectOn(send));
  });

  it("send_never_writes_to_an_existing_session", async () => {
    // The real terminals, so anything typed or pasted into a session would
    // reach the api's writeSession or pasteClipboard.
    const real = await vi.importActual<typeof import("../terminal/terminals")>(
      "../terminal/terminals",
    );
    vi.mocked(startTerminalSession).mockImplementation(
      real.startTerminalSession,
    );
    vi.mocked(terminalFor).mockImplementation(real.terminalFor);
    vi.mocked(disposeTerminal).mockImplementation(real.disposeTerminal);
    vi.mocked(writeSession).mockResolvedValue();
    vi.mocked(pasteClipboard).mockResolvedValue();
    const sessions: StartedSession[] = [
      { id: "s1", prefilled: true },
      { id: "s2", prefilled: false },
      { id: "s3", prefilled: true },
    ];
    vi.mocked(startApiSession).mockImplementation(
      async (_folder, _size, _prompt, _onOutput, onEvent) => {
        const session = sessions.shift()!;
        events[session.id] = onEvent;
        return session;
      },
    );
    const send = await renderSend();

    for (const id of ["s1", "s2", "s3"]) {
      await userEvent.click(send);
      await vi.waitFor(() => expect(events[id]).toBeDefined());
      await vi.waitFor(() => expectOff(send));
      expect(real.terminalFor(id)).toBeDefined();
      // Blocked while it runs, by the button and by the action itself.
      await userEvent.click(send);
      await act(() => appActions.send(ENTRY));
      act(() => events[id]({ type: "exited", code: 0 }));
    }

    expect(startApiSession).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(startApiSession).mock.calls) {
      expect(call[2]).toBe(PROMPT);
    }
    expect(writeSession).not.toHaveBeenCalled();
    expect(pasteClipboard).not.toHaveBeenCalled();
  });

  it("a_failed_save_still_sends_and_says_so", async () => {
    vi.mocked(savePromptEntry).mockRejectedValue(
      new ApiError("database", "disk full"),
    );
    startsWith({ id: "s1", prefilled: true });
    const send = await renderSend();

    await userEvent.click(send);

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual(["Couldn't save to History: disk full"]),
    );
    expect(startTerminalSession).toHaveBeenCalledWith(
      "/home/me/api",
      expect.any(Function),
      { prompt: PROMPT },
    );
  });

  it("a_double_click_sends_once", async () => {
    let finish!: (session: StartedSession) => void;
    vi.mocked(startTerminalSession).mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)),
    );
    const send = await renderSend();

    await userEvent.dblClick(send);

    // Unavailable while the send is under way.
    await vi.waitFor(() => expect(startTerminalSession).toHaveBeenCalled());
    expectOff(send);
    await act(async () => finish({ id: "s1", prefilled: true }));

    expect(savePromptEntry).toHaveBeenCalledTimes(1);
    expect(startTerminalSession).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(appState.sessions[api.id]).toBeDefined());
    expect(toastTexts()).toEqual([]);
  });

  it("a_failed_save_with_no_start_still_says_so", async () => {
    vi.mocked(savePromptEntry).mockRejectedValue(
      new ApiError("database", "disk full"),
    );
    const bare = project("p-bare", null);
    vi.mocked(pickFolder).mockResolvedValueOnce(null);
    const send = await renderSend([bare], bare.id);

    // A cancelled pick: nothing starts, and only the save is reported.
    await userEvent.click(send);
    await chooseInExplainer();

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual(["Couldn't save to History: disk full"]),
    );
    expect(startTerminalSession).not.toHaveBeenCalled();
  });

  it("a_failed_save_and_a_failed_start_both_say_so", async () => {
    vi.mocked(savePromptEntry).mockRejectedValue(
      new ApiError("database", "disk full"),
    );
    vi.mocked(startTerminalSession).mockRejectedValueOnce(
      new ApiError("failed", "Claude Code could not start."),
    );
    const send = await renderSend();

    await userEvent.click(send);

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual([
        "Claude Code could not start.",
        "Couldn't save to History: disk full",
      ]),
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it("send_says_so_when_claude_code_is_already_starting", async () => {
    let finish!: (session: StartedSession) => void;
    vi.mocked(startTerminalSession).mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)),
    );
    const send = await renderSend();
    // A start from the drawer, still under way.
    act(() => void appActions.startSession(api.id));
    await vi.waitFor(() => expect(startTerminalSession).toHaveBeenCalled());

    await userEvent.click(send);

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual([
        "Claude Code is already starting, so your prompt is copied. Paste it into Claude with Ctrl+V once it's ready.",
      ]),
    );
    expect(writeText).toHaveBeenCalledExactlyOnceWith(PROMPT);
    expect(savePromptEntry).toHaveBeenCalledTimes(1);
    await act(async () => finish({ id: "s1", prefilled: false }));
    expect(startTerminalSession).toHaveBeenCalledTimes(1);
  });

  it("send_says_so_when_claude_code_is_already_starting on Linux", async () => {
    vi.mocked(currentPlatform).mockReturnValue("linux");
    vi.mocked(startTerminalSession).mockReturnValueOnce(new Promise(() => {}));
    const send = await renderSend();
    act(() => void appActions.startSession(api.id));
    await vi.waitFor(() => expect(startTerminalSession).toHaveBeenCalled());

    await userEvent.click(send);

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual([
        "Claude Code is already starting, so your prompt is copied. Paste it into Claude with Ctrl+Shift+V once it's ready.",
      ]),
    );
    expect(writeText).toHaveBeenCalledExactlyOnceWith(PROMPT);
  });

  it("already_starting_says_so_when_the_prompt_cant_be_copied", async () => {
    vi.mocked(writeText).mockRejectedValue(new Error("clipboard busy"));
    vi.mocked(startTerminalSession).mockReturnValueOnce(new Promise(() => {}));
    const send = await renderSend();
    act(() => void appActions.startSession(api.id));
    await vi.waitFor(() => expect(startTerminalSession).toHaveBeenCalled());

    await userEvent.click(send);

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual([
        "Couldn't copy to the clipboard: clipboard busy",
      ]),
    );
    expect(startTerminalSession).toHaveBeenCalledTimes(1);
  });

  it("a_session_started_during_the_save_is_never_replaced", async () => {
    let saved!: (entry: PromptEntry) => void;
    vi.mocked(savePromptEntry).mockReturnValueOnce(
      new Promise((resolve) => (saved = resolve)),
    );
    startsWith({ id: "s1", prefilled: false });
    const send = await renderSend();

    await userEvent.click(send);
    await vi.waitFor(() => expect(savePromptEntry).toHaveBeenCalled());
    // The drawer starts a session while the save is under way.
    await act(() => appActions.startSession(api.id));
    expect(appState.sessions[api.id]).toMatchObject({
      id: "s1",
      state: "running",
    });
    await act(async () => saved(stored()));

    await vi.waitFor(() => expect(toastTexts()).toEqual([ALREADY_RUNNING]));
    // The advice is true: the prompt is on the clipboard.
    expect(writeText).toHaveBeenCalledExactlyOnceWith(PROMPT);
    expect(startTerminalSession).toHaveBeenCalledTimes(1);
    expect(closeSession).not.toHaveBeenCalled();
    expect(appState.sessions[api.id]).toMatchObject({
      id: "s1",
      state: "running",
    });
  });

  /** Sends, with the drawer starting `api`'s session during the save. */
  async function sendWhileTheDrawerStarts() {
    let saved!: (entry: PromptEntry) => void;
    vi.mocked(savePromptEntry).mockReturnValueOnce(
      new Promise((resolve) => (saved = resolve)),
    );
    startsWith({ id: "s1", prefilled: false });
    const send = await renderSend();
    await userEvent.click(send);
    await vi.waitFor(() => expect(savePromptEntry).toHaveBeenCalled());
    await act(() => appActions.startSession(api.id));
    await act(async () => saved(stored()));
  }

  it("already_running_copies_the_prompt on Linux", async () => {
    vi.mocked(currentPlatform).mockReturnValue("linux");

    await sendWhileTheDrawerStarts();

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual([
        "Claude Code is already running, so your prompt is copied. Paste it into Claude with Ctrl+Shift+V.",
      ]),
    );
    expect(writeText).toHaveBeenCalledExactlyOnceWith(PROMPT);
  });

  it("already_running_says_so_when_the_prompt_cant_be_copied", async () => {
    vi.mocked(writeText).mockRejectedValue(new Error("clipboard busy"));

    await sendWhileTheDrawerStarts();

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual([
        "Couldn't copy to the clipboard: clipboard busy",
      ]),
    );
    expect(startTerminalSession).toHaveBeenCalledTimes(1);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it("send_ignores_a_second_call_while_one_runs", async () => {
    startsWith({ id: "s1", prefilled: true }, { id: "s2", prefilled: true });
    await renderSend();

    // Both calls in one go: only the busy flag can stop the second.
    await act(async () => {
      await Promise.all([appActions.send(ENTRY), appActions.send(ENTRY)]);
    });

    expect(savePromptEntry).toHaveBeenCalledTimes(1);
    expect(startTerminalSession).toHaveBeenCalledTimes(1);
    expect(toastTexts()).toEqual([]);
  });

  it("send_does_nothing_while_the_session_runs_even_without_the_button", async () => {
    startsWith({ id: "s1", prefilled: true });
    await renderSend();
    await act(() => appActions.startSession(api.id));

    await act(() => appActions.send(ENTRY));

    expect(savePromptEntry).not.toHaveBeenCalled();
    expect(startTerminalSession).toHaveBeenCalledTimes(1);
    expect(closeSession).not.toHaveBeenCalled();
    expect(toastTexts()).toEqual([]);
  });

  it("copy_and_save_are_unavailable_while_a_send_runs", async () => {
    let finish!: (session: StartedSession) => void;
    vi.mocked(startTerminalSession).mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)),
    );
    const send = await renderSend();
    const copy = screen.getByRole("button", { name: "Copy" });
    const save = screen.getByRole("button", { name: "Save" });

    await userEvent.click(send);
    await vi.waitFor(() => expect(startTerminalSession).toHaveBeenCalled());

    expectOff(send, copy, save);
    await userEvent.click(copy);
    expect(writeText).not.toHaveBeenCalled();
    await act(async () => finish({ id: "s1", prefilled: true }));
    expectOn(copy, save);
  });

  it("a_session_that_starts_just_before_a_failed_save_is_never_replaced", async () => {
    let failSave!: (e: Error) => void;
    vi.mocked(savePromptEntry).mockReturnValueOnce(
      new Promise((_r, reject) => (failSave = reject)),
    );
    let finish!: (session: StartedSession) => void;
    vi.mocked(startTerminalSession).mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)),
    );
    startsWith({ id: "s2", prefilled: false });
    const send = await renderSend();
    await userEvent.click(send);
    await vi.waitFor(() => expect(savePromptEntry).toHaveBeenCalled());
    act(() => void appActions.startSession(api.id));
    await vi.waitFor(() => expect(startTerminalSession).toHaveBeenCalled());

    // The drawer's start ends, then the save fails, before React renders
    // again: it renders in a later task, and only microtasks run between.
    // Out of act's control, so React schedules its render as in the app.
    const react = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const actEnvironment = react.IS_REACT_ACT_ENVIRONMENT;
    react.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      finish({ id: "s1", prefilled: false });
      for (let i = 0; i < 20; i++) await Promise.resolve();
      failSave(new Error("disk full"));
      await vi.waitFor(() => expect(toastTexts()).toHaveLength(2));
    } finally {
      react.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    }

    expect(toastTexts()).toEqual([
      ALREADY_RUNNING,
      "Couldn't save to History: disk full",
    ]);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(PROMPT);
    expect(startTerminalSession).toHaveBeenCalledTimes(1);
    expect(appState.sessions[api.id]).toMatchObject({ id: "s1" });
  });
});
