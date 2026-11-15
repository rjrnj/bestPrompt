import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import {
  claudeStatus,
  getSettings,
  latestEntryProject,
  listFrameworks,
  listProjects,
  listPromptEntries,
  pickFolder,
  setProjectFolder,
} from "../api";
import type { Framework } from "../bindings/Framework";
import type { Project } from "../bindings/Project";
import type { SessionEvent } from "../bindings/SessionEvent";
import { closeWarning } from "../closeWarning";
import { closeWarningLines } from "./CloseWarningDialog";
import { startTerminalSession } from "../terminal/terminals";
import { closeListeners, requestClose, windowMock } from "../test/tauriWindow";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  listPromptEntries: vi.fn(),
  getSettings: vi.fn(),
  claudeStatus: vi.fn(),
  pickFolder: vi.fn(),
  setProjectFolder: vi.fn(),
}));
vi.mock("../closeWarning", async (importOriginal) => {
  const original = await importOriginal<typeof import("../closeWarning")>();
  return { ...original, closeWarning: vi.fn(original.closeWarning) };
});
vi.mock("../terminal/terminals", () => ({
  startTerminalSession: vi.fn(),
  disposeTerminal: vi.fn(),
}));
vi.mock("./terminal/TerminalView", () => ({
  TerminalView: () => <div data-testid="terminal" />,
}));

const rtf: Framework = {
  id: "rtf",
  name: "RTF",
  description: "",
  template: "{{task}}",
  summaryKey: null,
  isCustom: false,
  deletedAt: null,
  sections: [{ key: "task", label: "Task", helpText: "" }],
  createdAt: 1,
  updatedAt: 1,
};
const mine: Framework = {
  ...rtf,
  id: "mine",
  name: "Mine",
  isCustom: true,
};
const api: Project = {
  id: "p-api",
  name: "api",
  folder: "/home/me/api",
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  vi.mocked(listFrameworks).mockResolvedValue([rtf, mine]);
  vi.mocked(listProjects).mockResolvedValue([api]);
  vi.mocked(latestEntryProject).mockResolvedValue(api.id);
  vi.mocked(listPromptEntries).mockResolvedValue([]);
  vi.mocked(getSettings).mockResolvedValue({
    theme: "light",
    sendHintSeen: false,
  });
  vi.mocked(claudeStatus).mockResolvedValue({
    found: true,
    path: "/bin/claude",
  });
});
afterEach(() => {
  vi.resetAllMocks();
});

/** Starts a session, then clears the project's folder in Manage projects. */
async function runningWithoutAFolder(user: ReturnType<typeof userEvent.setup>) {
  vi.mocked(startTerminalSession).mockResolvedValue({
    id: "s1",
    prefilled: false,
  });
  await startClaude(user);
  await screen.findByTestId("terminal");
  vi.mocked(setProjectFolder).mockResolvedValueOnce({ ...api, folder: null });
  await user.click(screen.getByRole("combobox", { name: "Project" }));
  await user.click(
    await screen.findByRole("option", { name: "Manage projects…" }),
  );
  const manage = await screen.findByRole("dialog", { name: "Manage projects" });
  await user.click(
    within(manage).getByRole("button", { name: "Clear folder of api" }),
  );
  await waitFor(() =>
    expect(
      within(manage).queryByRole("button", { name: "Clear folder of api" }),
    ).toBeNull(),
  );
  await user.click(within(manage).getByRole("button", { name: "Done" }));
}

async function renderApp() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "Copy" });
  await waitFor(() => expect(closeListeners()).toBe(1));
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent(
      "api",
    ),
  );
  return user;
}

async function startClaude(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "Start Claude Code" }),
  );
}

/** Goes on from the folder explainer to the chooser, which never answers. */
async function chooseInExplainer(user: ReturnType<typeof userEvent.setup>) {
  const explainer = await screen.findByRole("alertdialog", {
    name: "Choose a folder for Claude Code",
  });
  await user.click(
    within(explainer).getByRole("button", { name: "Choose folder…" }),
  );
}

const quitDialog = () =>
  screen.findByRole("alertdialog", { name: "Quit bestPrompt?" });

describe("the close warning", () => {
  it("a_start_under_way_counts_for_the_close_warning", async () => {
    vi.mocked(listProjects).mockResolvedValue([{ ...api, folder: null }]);
    vi.mocked(pickFolder).mockReturnValue(new Promise(() => {}));
    const user = await renderApp();
    await startClaude(user);
    await chooseInExplainer(user);
    await waitFor(() => expect(pickFolder).toHaveBeenCalled());

    const { prevented } = await requestClose();

    expect(prevented).toBe(true);
    expect(await quitDialog()).toHaveTextContent(
      "1 Claude Code session will end.",
    );
  });

  it("close_without_anything_to_lose_just_closes", async () => {
    await renderApp();
    const { prevented } = await requestClose();
    expect(prevented).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(windowMock.destroy).not.toHaveBeenCalled();
  });

  it("close_with_a_session_asks_and_quit_closes", async () => {
    vi.mocked(startTerminalSession).mockResolvedValue({
      id: "s1",
      prefilled: false,
    });
    const user = await renderApp();
    await startClaude(user);
    await screen.findByTestId("terminal");

    const { prevented } = await requestClose();

    expect(prevented).toBe(true);
    const dialog = within(await quitDialog());
    expect(dialog.getByText("1 Claude Code session will end.")).toBeVisible();
    expect(dialog.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(windowMock.destroy).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: "Quit" }));
    expect(windowMock.destroy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("cancel_keeps_the_window_open", async () => {
    let exit!: (event: SessionEvent) => void;
    vi.mocked(startTerminalSession).mockImplementation(async (_f, onEvent) => {
      exit = onEvent;
      return { id: "s1", prefilled: false };
    });
    const user = await renderApp();
    await startClaude(user);
    await screen.findByTestId("terminal");
    expect(exit).toBeTypeOf("function");

    await requestClose();
    await user.click(
      within(await quitDialog()).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await requestClose();
    await quitDialog();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();

    expect(windowMock.destroy).not.toHaveBeenCalled();
    expect(screen.getByTestId("terminal")).toBeInTheDocument();
    // Still running: a close asks again.
    expect((await requestClose()).prevented).toBe(true);
    expect(await quitDialog()).toBeInTheDocument();
  });

  it("closing_the_warning_returns_focus_to_where_it_was", async () => {
    const user = await renderApp();
    const task = screen.getByRole("textbox", { name: "Task" });
    await user.type(task, "hello");

    await requestClose();
    await quitDialog();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(task).toHaveFocus();

    await requestClose();
    await user.click(
      within(await quitDialog()).getByRole("button", { name: "Cancel" }),
    );
    expect(task).toHaveFocus();
  });

  it("a_failed_quit_toasts_and_leaves_the_dialog_closed", async () => {
    windowMock.destroy.mockRejectedValue(new Error("No window to close"));
    vi.mocked(pickFolder).mockReturnValue(new Promise(() => {}));
    vi.mocked(listProjects).mockResolvedValue([{ ...api, folder: null }]);
    const user = await renderApp();
    await startClaude(user);
    await chooseInExplainer(user);
    await waitFor(() => expect(pickFolder).toHaveBeenCalled());
    await requestClose();
    await user.click(
      within(await quitDialog()).getByRole("button", { name: "Quit" }),
    );
    expect(await screen.findByText("No window to close")).toBeVisible();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("the_close_warning_names_unsaved_drafts_and_framework_edits", async () => {
    const user = await renderApp();
    await user.type(screen.getByRole("textbox", { name: "Task" }), "hello");
    await requestClose();
    let dialog = await quitDialog();
    expect(dialog).toHaveTextContent("Unsaved Builder drafts will be lost.");
    expect(dialog).not.toHaveTextContent("Claude Code session");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("tab", { name: "Frameworks" }));
    await user.click(await screen.findByRole("button", { name: "Mine" }));
    const name = await screen.findByRole("textbox", { name: "Name" });
    await user.type(name, "!");
    await requestClose();
    dialog = await quitDialog();
    expect(dialog).toHaveTextContent("Unsaved Builder drafts will be lost.");
    expect(dialog).toHaveTextContent("Unsaved changes to Mine! will be lost.");
    expect(dialog.textContent!.indexOf("drafts")).toBeLessThan(
      dialog.textContent!.indexOf("Unsaved changes"),
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await user.clear(name);
    await user.type(name, "  ");
    await requestClose();
    expect(await quitDialog()).toHaveTextContent(
      "Unsaved changes to a framework will be lost.",
    );
  });

  it("a_cancelled_start_stops_counting", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(latestEntryProject).mockResolvedValue(null);
    vi.mocked(pickFolder).mockResolvedValue(null);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Copy" });
    await waitFor(() => expect(closeListeners()).toBe(1));
    await startClaude(user);
    await chooseInExplainer(user);
    await waitFor(() => expect(pickFolder).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    const { prevented } = await requestClose();

    expect(prevented).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("a_cancelled_restart_counts_once", async () => {
    const user = await renderApp();
    await runningWithoutAFolder(user);
    let answer!: (folder: string | null) => void;
    vi.mocked(pickFolder).mockReturnValue(
      new Promise((resolve) => (answer = resolve)),
    );
    await user.click(screen.getByRole("button", { name: "Restart" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Restart",
      }),
    );
    await chooseInExplainer(user);
    await waitFor(() => expect(pickFolder).toHaveBeenCalled());

    await requestClose();
    const dialog = await quitDialog();
    expect(dialog).toHaveTextContent("1 Claude Code session will end.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    answer(null);
    await waitFor(() => expect(closeListeners()).toBe(1));
    await Promise.resolve();
    await requestClose();
    expect(await quitDialog()).toHaveTextContent(
      "1 Claude Code session will end.",
    );
    expect(screen.getByTestId("terminal")).toBeInTheDocument();
  });

  it("a_close_while_the_dialog_is_open_is_prevented_and_refreshes_it", async () => {
    let exit!: (event: SessionEvent) => void;
    vi.mocked(startTerminalSession).mockImplementation(async (_f, onEvent) => {
      exit = onEvent;
      return { id: "s1", prefilled: false };
    });
    const user = await renderApp();
    await user.type(screen.getByRole("textbox", { name: "Task" }), "hello");
    await startClaude(user);
    await screen.findByTestId("terminal");
    await requestClose();
    const dialog = await quitDialog();
    expect(dialog).toHaveTextContent("1 Claude Code session will end.");
    expect(dialog).toHaveTextContent("Unsaved Builder drafts");

    act(() => exit({ type: "exited", code: 0 }));
    const { prevented } = await requestClose();

    expect(prevented).toBe(true);
    expect(windowMock.destroy).not.toHaveBeenCalled();
    expect(await quitDialog()).not.toHaveTextContent("Claude Code session");
    expect(await quitDialog()).toHaveTextContent("Unsaved Builder drafts");
  });

  it("the_dialog_follows_the_state_while_it_is_open", async () => {
    let exit!: (event: SessionEvent) => void;
    vi.mocked(startTerminalSession).mockImplementation(async (_f, onEvent) => {
      exit = onEvent;
      return { id: "s1", prefilled: false };
    });
    const user = await renderApp();
    await startClaude(user);
    await screen.findByTestId("terminal");
    await requestClose();
    expect(await quitDialog()).toHaveTextContent("1 Claude Code session");

    act(() => exit({ type: "exited", code: 0 }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(windowMock.destroy).not.toHaveBeenCalled();
    // A later close request, with nothing left to lose, closes as usual.
    expect((await requestClose()).prevented).toBe(false);
  });

  it("the_framework_name_in_the_warning_is_trimmed", () => {
    const lines = closeWarningLines({
      sessions: 0,
      drafts: false,
      frameworkEdits: { name: "  Mine " },
    });
    expect(lines).toEqual([
      {
        kind: "frameworkEdits",
        text: "Unsaved changes to Mine will be lost.",
      },
    ]);
  });

  it("a_throw_while_deciding_does_not_stop_the_window_closing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderApp();
    vi.mocked(closeWarning).mockImplementationOnce(() => {
      throw new Error("broken");
    });

    const { prevented } = await requestClose();

    expect(prevented).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/close request/i);
    warn.mockRestore();
  });
});
