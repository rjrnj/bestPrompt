import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import {
  ApiError,
  claudeStatus,
  closeSession,
  detectClaude,
  latestEntryProject,
  listFrameworks,
  listProjects,
  pickFolder,
  savePromptEntry,
  setProjectFolder,
} from "../../api";
import type { Framework } from "../../bindings/Framework";
import type { Project } from "../../bindings/Project";
import type { PromptEntry } from "../../bindings/PromptEntry";
import type { SessionEvent } from "../../bindings/SessionEvent";
import {
  disposeTerminal,
  startTerminalSession,
} from "../../terminal/terminals";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  listPromptEntries: vi.fn().mockResolvedValue([]),
  claudeStatus: vi.fn(),
  detectClaude: vi.fn(),
  pickFolder: vi.fn(),
  setProjectFolder: vi.fn(),
  closeSession: vi.fn(),
  savePromptEntry: vi.fn(),
}));
vi.mock("../../clipboard", () => ({ writeText: vi.fn() }));
// No real xterm: jsdom can't lay one out. The view shows which session it
// was given instead.
vi.mock("../../terminal/terminals", () => ({
  startTerminalSession: vi.fn(),
  disposeTerminal: vi.fn(),
}));
// Like the real view, it takes the focus when it mounts. `broken` makes it
// fail, as a terminal chunk that can't load would.
const view = vi.hoisted(() => ({ broken: false }));
vi.mock("./TerminalView", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    TerminalView: function TerminalView({ sessionId }: { sessionId: string }) {
      const box = useRef<HTMLDivElement>(null);
      useEffect(() => box.current?.focus(), [sessionId]);
      if (view.broken) throw new Error("Failed to fetch the terminal");
      return (
        <div ref={box} tabIndex={-1} data-testid="terminal">
          {sessionId}
        </div>
      );
    },
  };
});

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

function project(id: string, name: string, folder: string | null): Project {
  return { id, name, folder, createdAt: 1, updatedAt: 1 };
}

const api = project("p-api", "api", "/home/me/api");
const web = project("p-web", "web", "/home/me/web");

/** The exit callback of each session started, by id. */
let exits: Record<string, (e: SessionEvent) => void>;

/** Makes the next starts return these ids, in turn. */
function startsWith(...ids: string[]) {
  for (const id of ids) {
    vi.mocked(startTerminalSession).mockImplementationOnce(
      async (_folder, onEvent) => {
        exits[id] = onEvent;
        return { id, prefilled: false };
      },
    );
  }
}

/**
 * Renders the app with `projects`, `selected` chosen at startup, and waits
 * for the Builder.
 */
async function renderApp(
  projects: Project[] = [api, web],
  selected: string | null = api.id,
) {
  vi.mocked(listProjects).mockResolvedValue(projects);
  vi.mocked(latestEntryProject).mockResolvedValue(selected);
  render(<App />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Copy" });
  if (selected !== null) {
    const name = projects.find((p) => p.id === selected)!.name;
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Project" }),
      ).toHaveTextContent(name),
    );
  }
  return user;
}

function drawer() {
  return screen.getByRole("region", { name: "Claude Code" });
}

function handle() {
  return screen.getByRole("separator", { name: "Resize Claude Code" });
}

async function start(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await within(drawer()).findByRole("button", { name: "Start Claude Code" }),
  );
}

async function selectProject(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole("combobox", { name: "Project" }));
  await user.click(await screen.findByRole("option", { name }));
}

beforeEach(() => {
  exits = {};
  view.broken = false;
  vi.mocked(listFrameworks).mockResolvedValue([rtf]);
  vi.mocked(claudeStatus).mockResolvedValue({
    found: true,
    path: "/bin/claude",
  });
  vi.mocked(closeSession).mockResolvedValue();
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ClaudeDrawer", () => {
  it("start_opens_a_session_in_the_projects_folder", async () => {
    startsWith("s1");
    const user = await renderApp();

    await start(user);

    expect(startTerminalSession).toHaveBeenCalledWith(
      "/home/me/api",
      expect.any(Function),
      { prompt: undefined },
    );
    expect(await within(drawer()).findByTestId("terminal")).toHaveTextContent(
      "s1",
    );
    expect(drawer()).toHaveTextContent("claude · /home/me/api");
    expect(pickFolder).not.toHaveBeenCalled();
  });

  it("start_without_a_folder_asks_for_one_and_saves_it", async () => {
    const bare = project("p-bare", "bare", null);
    vi.mocked(pickFolder).mockResolvedValueOnce(null);
    const user = await renderApp([bare], bare.id);

    // A cancelled pick starts nothing and says nothing.
    await start(user);
    expect(pickFolder).toHaveBeenCalledTimes(1);
    expect(startTerminalSession).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: /notifications/i })).toBeNull();

    vi.mocked(pickFolder).mockResolvedValueOnce("/picked");
    vi.mocked(setProjectFolder).mockResolvedValue({
      ...bare,
      folder: "/picked",
    });
    startsWith("s1");
    await start(user);

    expect(setProjectFolder).toHaveBeenCalledWith(bare.id, "/picked");
    expect(startTerminalSession).toHaveBeenCalledWith(
      "/picked",
      expect.any(Function),
      { prompt: undefined },
    );
    expect(await within(drawer()).findByTestId("terminal")).toHaveTextContent(
      "s1",
    );
  });

  it("no_project_uses_a_picked_folder_for_this_session_only", async () => {
    vi.mocked(pickFolder).mockResolvedValue("/tmp/scratch");
    startsWith("s1", "s2");
    const user = await renderApp([api], null);

    await start(user);

    expect(startTerminalSession).toHaveBeenCalledWith(
      "/tmp/scratch",
      expect.any(Function),
      { prompt: undefined },
    );
    expect(setProjectFolder).not.toHaveBeenCalled();
    expect(await within(drawer()).findByTestId("terminal")).toHaveTextContent(
      "s1",
    );

    // Starting again reuses the folder without asking.
    act(() => exits.s1({ type: "exited", code: 0 }));
    await user.click(
      within(drawer()).getAllByRole("button", { name: "Restart" })[0],
    );
    await waitFor(() =>
      expect(within(drawer()).getByTestId("terminal")).toHaveTextContent("s2"),
    );
    expect(startTerminalSession).toHaveBeenLastCalledWith(
      "/tmp/scratch",
      expect.any(Function),
      { prompt: undefined },
    );
    expect(pickFolder).toHaveBeenCalledTimes(1);
    expect(setProjectFolder).not.toHaveBeenCalled();
  });

  it("switching_project_shows_its_own_session", async () => {
    startsWith("s1", "s2");
    const user = await renderApp();
    await start(user);
    await within(drawer()).findByTestId("terminal");

    await selectProject(user, "web");
    expect(within(drawer()).queryByTestId("terminal")).toBeNull();
    expect(drawer()).toHaveTextContent(
      "No Claude Code session for this project.",
    );
    await start(user);
    expect(await within(drawer()).findByTestId("terminal")).toHaveTextContent(
      "s2",
    );
    expect(startTerminalSession).toHaveBeenLastCalledWith(
      "/home/me/web",
      expect.any(Function),
      { prompt: undefined },
    );

    await selectProject(user, "api");
    expect(within(drawer()).getByTestId("terminal")).toHaveTextContent("s1");
    expect(closeSession).not.toHaveBeenCalled();
    expect(disposeTerminal).not.toHaveBeenCalled();
  });

  it("hide_keeps_the_session_running", async () => {
    startsWith("s1");
    const user = await renderApp();
    expect(
      screen.queryByRole("button", { name: "Show Claude Code" }),
    ).toBeNull();
    await start(user);
    await within(drawer()).findByTestId("terminal");

    await user.click(within(drawer()).getByRole("button", { name: "Hide" }));

    expect(screen.queryByRole("region", { name: "Claude Code" })).toBeNull();
    expect(closeSession).not.toHaveBeenCalled();
    expect(disposeTerminal).not.toHaveBeenCalled();
    // Focus goes to the button that brings it back, not to the page.
    expect(
      screen.getByRole("button", { name: "Show Claude Code" }),
    ).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Show Claude Code" }));

    expect(within(drawer()).getByTestId("terminal")).toHaveTextContent("s1");
    expect(
      screen.queryByRole("button", { name: "Show Claude Code" }),
    ).toBeNull();
  });

  it("close_asks_then_ends_the_session", async () => {
    startsWith("s1");
    const user = await renderApp();
    expect(
      within(drawer()).queryByRole("button", { name: "Close" }),
    ).toBeNull();
    await start(user);
    await within(drawer()).findByTestId("terminal");

    await user.click(within(drawer()).getByRole("button", { name: "Close" }));
    const confirm = await screen.findByRole("alertdialog", {
      name: "End this Claude Code session?",
    });
    expect(confirm).toHaveAccessibleDescription(
      "The conversation can't be brought back.",
    );
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(closeSession).not.toHaveBeenCalled();
    expect(within(drawer()).getByTestId("terminal")).toBeInTheDocument();

    await user.click(within(drawer()).getByRole("button", { name: "Close" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "End session",
      }),
    );

    await waitFor(() =>
      expect(drawer()).toHaveTextContent(
        "No Claude Code session for this project.",
      ),
    );
    expect(closeSession).toHaveBeenCalledWith("s1");
    expect(disposeTerminal).toHaveBeenCalledWith("s1");
    expect(within(drawer()).queryByTestId("terminal")).toBeNull();
    // Focus lands on the empty state's button, not on the page.
    await waitFor(() =>
      expect(
        within(drawer()).getByRole("button", { name: "Start Claude Code" }),
      ).toHaveFocus(),
    );
  });

  it("restart_asks_then_starts_a_fresh_one", async () => {
    startsWith("s1", "s2");
    const user = await renderApp();
    await start(user);
    await within(drawer()).findByTestId("terminal");

    await user.click(within(drawer()).getByRole("button", { name: "Restart" }));
    const confirm = await screen.findByRole("alertdialog", {
      name: "End this Claude Code session?",
    });
    expect(closeSession).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Restart" }));

    await waitFor(() =>
      expect(within(drawer()).getByTestId("terminal")).toHaveTextContent("s2"),
    );
    expect(closeSession).toHaveBeenCalledWith("s1");
    expect(disposeTerminal).toHaveBeenCalledWith("s1");
    expect(startTerminalSession).toHaveBeenLastCalledWith(
      "/home/me/api",
      expect.any(Function),
      { prompt: undefined },
    );
  });

  it("restart_uses_the_projects_current_folder", async () => {
    startsWith("s1", "s2");
    const user = await renderApp();
    await start(user);
    await within(drawer()).findByTestId("terminal");

    // The folder changes in Manage projects while the session runs.
    vi.mocked(pickFolder).mockResolvedValueOnce("/home/me/api2");
    vi.mocked(setProjectFolder).mockResolvedValueOnce({
      ...api,
      folder: "/home/me/api2",
    });
    await user.click(screen.getByRole("combobox", { name: "Project" }));
    await user.click(
      await screen.findByRole("option", { name: "Manage projects…" }),
    );
    const manage = await screen.findByRole("dialog", {
      name: "Manage projects",
    });
    await user.click(
      within(manage).getByRole("button", { name: "Folder… for api" }),
    );
    expect(
      await within(manage).findByText("/home/me/api2"),
    ).toBeInTheDocument();
    await user.click(within(manage).getByRole("button", { name: "Done" }));

    await user.click(within(drawer()).getByRole("button", { name: "Restart" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Restart",
      }),
    );

    await waitFor(() =>
      expect(within(drawer()).getByTestId("terminal")).toHaveTextContent("s2"),
    );
    expect(startTerminalSession).toHaveBeenLastCalledWith(
      "/home/me/api2",
      expect.any(Function),
      { prompt: undefined },
    );
    expect(drawer()).toHaveTextContent("claude · /home/me/api2");
  });

  it("restart_without_a_folder_asks_first_and_a_cancel_keeps_the_session", async () => {
    startsWith("s1");
    const user = await renderApp();
    await start(user);
    await within(drawer()).findByTestId("terminal");

    // The folder is cleared in Manage projects while the session runs.
    vi.mocked(setProjectFolder).mockResolvedValueOnce({ ...api, folder: null });
    await user.click(screen.getByRole("combobox", { name: "Project" }));
    await user.click(
      await screen.findByRole("option", { name: "Manage projects…" }),
    );
    const manage = await screen.findByRole("dialog", {
      name: "Manage projects",
    });
    await user.click(
      within(manage).getByRole("button", { name: "Clear folder of api" }),
    );
    await waitFor(() =>
      expect(
        within(manage).queryByRole("button", { name: "Clear folder of api" }),
      ).toBeNull(),
    );
    await user.click(within(manage).getByRole("button", { name: "Done" }));

    vi.mocked(pickFolder).mockResolvedValueOnce(null);
    await user.click(within(drawer()).getByRole("button", { name: "Restart" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Restart",
      }),
    );

    await waitFor(() => expect(pickFolder).toHaveBeenCalledTimes(1));
    // The pick was cancelled: the running session is left alone.
    expect(closeSession).not.toHaveBeenCalled();
    expect(disposeTerminal).not.toHaveBeenCalled();
    expect(startTerminalSession).toHaveBeenCalledTimes(1);
    expect(within(drawer()).getByTestId("terminal")).toHaveTextContent("s1");
  });

  it("an_ended_session_offers_restart", async () => {
    startsWith("s1", "s2");
    const user = await renderApp();
    await start(user);
    await within(drawer()).findByTestId("terminal");

    act(() => exits.s1({ type: "exited", code: 2 }));

    expect(drawer()).toHaveTextContent("Claude Code ended (exit code 2).");
    const restarts = within(drawer()).getAllByRole("button", {
      name: "Restart",
    });
    await user.click(restarts[restarts.length - 1]);

    // No question for a session that has already ended, and nothing to close.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() =>
      expect(within(drawer()).getByTestId("terminal")).toHaveTextContent("s2"),
    );
    expect(closeSession).not.toHaveBeenCalled();
    expect(disposeTerminal).toHaveBeenCalledWith("s1");
  });

  it("claude_missing_shows_look_again", async () => {
    vi.mocked(claudeStatus).mockResolvedValue({ found: false, path: null });
    const user = await renderApp();

    expect(
      await within(drawer()).findByText(
        "Claude Code wasn't found. Install it, then Look again.",
      ),
    ).toBeInTheDocument();
    expect(
      within(drawer()).queryByRole("button", { name: "Start Claude Code" }),
    ).toBeNull();

    vi.mocked(detectClaude).mockResolvedValue({
      found: true,
      path: "/bin/claude",
    });
    await user.click(
      within(drawer()).getByRole("button", { name: "Look again" }),
    );

    expect(
      await within(drawer()).findByRole("button", {
        name: "Start Claude Code",
      }),
    ).toBeInTheDocument();
    expect(drawer()).not.toHaveTextContent("wasn't found");
  });

  it("while_detecting_neither_missing_nor_send_shows", async () => {
    vi.mocked(claudeStatus).mockReturnValue(new Promise(() => {}));
    await renderApp();

    expect(drawer()).toHaveTextContent("Looking for Claude Code…");
    expect(drawer()).not.toHaveTextContent("wasn't found");
    expect(
      within(drawer()).queryByRole("button", { name: "Look again" }),
    ).toBeNull();
    expect(
      within(drawer()).queryByRole("button", { name: "Start Claude Code" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Send to Claude Code" }),
    ).toBeNull();
  });

  it("a_start_in_a_missing_folder_offers_choose_folder", async () => {
    const gone = project("p-gone", "gone", "/home/me/gone");
    vi.mocked(startTerminalSession).mockRejectedValueOnce(
      new ApiError("invalid", "That folder no longer exists."),
    );
    const user = await renderApp([gone], gone.id);

    await start(user);

    expect(
      await screen.findByText("That folder no longer exists."),
    ).toBeInTheDocument();
    const choose = await within(drawer()).findByRole("button", {
      name: "Choose folder…",
    });
    expect(
      within(drawer()).queryByRole("button", { name: "Start Claude Code" }),
    ).toBeNull();

    vi.mocked(pickFolder).mockResolvedValue("/home/me/moved");
    vi.mocked(setProjectFolder).mockResolvedValue({
      ...gone,
      folder: "/home/me/moved",
    });
    startsWith("s1");
    await user.click(choose);

    expect(setProjectFolder).toHaveBeenCalledWith(gone.id, "/home/me/moved");
    expect(await within(drawer()).findByTestId("terminal")).toHaveTextContent(
      "s1",
    );
    expect(startTerminalSession).toHaveBeenLastCalledWith(
      "/home/me/moved",
      expect.any(Function),
      { prompt: undefined },
    );
  });

  it("a_missing_folder_opens_the_hidden_drawer_to_choose_another", async () => {
    const gone = project("p-gone", "gone", "/home/me/gone");
    let fail!: (error: Error) => void;
    vi.mocked(startTerminalSession).mockReturnValueOnce(
      new Promise((_resolve, reject) => (fail = reject)),
    );
    const user = await renderApp([gone], gone.id);
    await start(user);
    // Hidden while the start is under way.
    await user.click(within(drawer()).getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("region", { name: "Claude Code" })).toBeNull();

    await act(async () =>
      fail(new ApiError("invalid", "That folder no longer exists.")),
    );

    expect(
      within(drawer()).getByRole("button", { name: "Choose folder…" }),
    ).toBeInTheDocument();
  });

  it("a_folder_fixed_in_manage_projects_offers_start_again", async () => {
    const gone = project("p-gone", "gone", "/home/me/gone");
    vi.mocked(startTerminalSession).mockRejectedValueOnce(
      new ApiError("invalid", "That folder no longer exists."),
    );
    const user = await renderApp([gone], gone.id);
    await start(user);
    await within(drawer()).findByRole("button", { name: "Choose folder…" });

    vi.mocked(pickFolder).mockResolvedValueOnce("/home/me/moved");
    vi.mocked(setProjectFolder).mockResolvedValueOnce({
      ...gone,
      folder: "/home/me/moved",
    });
    await user.click(screen.getByRole("combobox", { name: "Project" }));
    await user.click(
      await screen.findByRole("option", { name: "Manage projects…" }),
    );
    const manage = await screen.findByRole("dialog", {
      name: "Manage projects",
    });
    await user.click(
      within(manage).getByRole("button", { name: "Folder… for gone" }),
    );
    expect(
      await within(manage).findByText("/home/me/moved"),
    ).toBeInTheDocument();
    await user.click(within(manage).getByRole("button", { name: "Done" }));

    expect(drawer()).toHaveTextContent(
      "No Claude Code session for this project.",
    );
    startsWith("s1");
    await start(user);
    expect(await within(drawer()).findByTestId("terminal")).toHaveTextContent(
      "s1",
    );
    expect(startTerminalSession).toHaveBeenLastCalledWith(
      "/home/me/moved",
      expect.any(Function),
      { prompt: undefined },
    );
    expect(pickFolder).toHaveBeenCalledTimes(1);
  });

  it("the_drawer_is_hidden_at_first_below_700px", async () => {
    vi.stubGlobal("innerHeight", 600);
    const user = await renderApp();

    expect(screen.queryByRole("region", { name: "Claude Code" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show Claude Code" }));
    expect(drawer()).toBeInTheDocument();
  });

  it("show_claude_code_hands_the_focus_to_the_drawers_button", async () => {
    vi.stubGlobal("innerHeight", 600);
    const user = await renderApp();
    const show = screen.getByRole("button", { name: "Show Claude Code" });
    show.focus();

    await user.keyboard("{Enter}");

    // Show has gone with the drawer open; its button takes the focus.
    expect(
      within(drawer()).getByRole("button", { name: "Start Claude Code" }),
    ).toHaveFocus();
  });

  it("show_claude_code_hands_the_focus_to_the_terminal", async () => {
    vi.stubGlobal("innerHeight", 600);
    startsWith("s1");
    const user = await renderApp();
    await user.click(screen.getByRole("button", { name: "Show Claude Code" }));
    await start(user);
    await within(drawer()).findByTestId("terminal");
    await user.click(within(drawer()).getByRole("button", { name: "Hide" }));
    expect(
      screen.getByRole("button", { name: "Show Claude Code" }),
    ).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(within(drawer()).getByTestId("terminal")).toHaveFocus();
  });

  it("show_claude_code_while_detecting_focuses_hide", async () => {
    vi.stubGlobal("innerHeight", 600);
    vi.mocked(claudeStatus).mockReturnValue(new Promise(() => {}));
    const user = await renderApp();

    await user.click(screen.getByRole("button", { name: "Show Claude Code" }));

    // Nothing to start yet, so the drawer's first button has it.
    expect(
      within(drawer()).getByRole("button", { name: "Hide" }),
    ).toHaveFocus();
  });

  describe("its height", () => {
    // The Builder area: 1000 px tall, 100 px down the window.
    function stubArea() {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect({ x: 0, y: 100, width: 1100, height: 1000 }),
      );
    }

    it("the_height_can_be_dragged_to_the_whole_window", async () => {
      stubArea();
      const user = await renderApp();
      expect(handle()).toHaveAttribute("aria-valuenow", "40");
      expect(handle()).toHaveAttribute("aria-valuemin", "12");
      expect(handle()).toHaveAttribute("aria-valuemax", "100");
      expect(handle()).toHaveAttribute("aria-orientation", "horizontal");
      expect(drawer()).toHaveStyle({ height: "40%" });

      fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 700 });
      fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 400 });
      expect(handle()).toHaveAttribute("aria-valuenow", "70");
      fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 100 });
      fireEvent.pointerUp(handle(), { pointerId: 1, clientY: 100 });
      expect(handle()).toHaveAttribute("aria-valuenow", "100");
      expect(drawer()).toHaveStyle({ height: "100%" });
      // Moves after the drag has ended change nothing.
      fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 600 });
      expect(handle()).toHaveAttribute("aria-valuenow", "100");

      // And with the keyboard.
      handle().focus();
      await user.keyboard("{ArrowDown}{ArrowDown}");
      expect(handle()).toHaveAttribute("aria-valuenow", "90");
      await user.keyboard("{ArrowUp}");
      expect(handle()).toHaveAttribute("aria-valuenow", "95");
    });

    it("near_the_top_it_snaps_to_full_height", async () => {
      stubArea();
      await renderApp();

      fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 700 });
      fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 108 });
      fireEvent.pointerUp(handle(), { pointerId: 1, clientY: 108 });

      expect(handle()).toHaveAttribute("aria-valuenow", "100");
    });

    it("maximize_fills_the_window_and_restores_the_height", async () => {
      stubArea();
      const user = await renderApp();
      handle().focus();
      await user.keyboard("{ArrowUp}");
      expect(handle()).toHaveAttribute("aria-valuenow", "45");

      await user.click(
        within(drawer()).getByRole("button", { name: "Maximize" }),
      );
      expect(handle()).toHaveAttribute("aria-valuenow", "100");
      expect(drawer()).toHaveStyle({ height: "100%" });
      await user.click(
        within(drawer()).getByRole("button", { name: "Restore" }),
      );
      expect(handle()).toHaveAttribute("aria-valuenow", "45");
      expect(
        within(drawer()).getByRole("button", { name: "Maximize" }),
      ).toBeInTheDocument();

      await user.dblClick(handle());
      expect(handle()).toHaveAttribute("aria-valuenow", "100");
      await user.dblClick(handle());
      expect(handle()).toHaveAttribute("aria-valuenow", "45");

      // A drag from maximized starts at full height and is no longer
      // maximized.
      await user.dblClick(handle());
      fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 100 });
      fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 500 });
      fireEvent.pointerUp(handle(), { pointerId: 1, clientY: 500 });
      expect(handle()).toHaveAttribute("aria-valuenow", "60");
      expect(
        within(drawer()).getByRole("button", { name: "Maximize" }),
      ).toBeInTheDocument();
    });

    it("a_click_with_a_little_jitter_is_not_a_drag", async () => {
      stubArea();
      const user = await renderApp();
      handle().focus();
      await user.keyboard("{ArrowUp}");
      await user.click(
        within(drawer()).getByRole("button", { name: "Maximize" }),
      );

      // A click on the handle that wobbles a pixel or two keeps maximized.
      fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 100 });
      fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 101 });
      fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 102 });
      fireEvent.pointerUp(handle(), { pointerId: 1, clientY: 102 });
      expect(handle()).toHaveAttribute("aria-valuenow", "100");
      expect(
        within(drawer()).getByRole("button", { name: "Restore" }),
      ).toBeInTheDocument();

      // So does a double-click, which then restores the earlier height.
      for (let i = 0; i < 2; i++) {
        fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 100 });
        fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 101 });
        fireEvent.pointerUp(handle(), { pointerId: 1, clientY: 101 });
      }
      fireEvent.doubleClick(handle());
      expect(handle()).toHaveAttribute("aria-valuenow", "45");
      expect(
        within(drawer()).getByRole("button", { name: "Maximize" }),
      ).toBeInTheDocument();
    });

    it("arrow_up_while_maximized_keeps_the_height_to_restore", async () => {
      stubArea();
      const user = await renderApp();
      handle().focus();
      await user.keyboard("{ArrowUp}");
      await user.click(
        within(drawer()).getByRole("button", { name: "Maximize" }),
      );

      handle().focus();
      await user.keyboard("{ArrowUp}");

      expect(handle()).toHaveAttribute("aria-valuenow", "100");
      await user.click(
        within(drawer()).getByRole("button", { name: "Restore" }),
      );
      expect(handle()).toHaveAttribute("aria-valuenow", "45");
    });

    it("a_lost_pointer_capture_ends_the_drag", async () => {
      stubArea();
      await renderApp();

      fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 700 });
      fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 400 });
      expect(handle()).toHaveAttribute("aria-valuenow", "70");
      fireEvent.lostPointerCapture(handle(), { pointerId: 1 });
      fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 600 });
      expect(handle()).toHaveAttribute("aria-valuenow", "70");

      // And so does a cancelled pointer.
      fireEvent.pointerDown(handle(), { pointerId: 1, clientY: 400 });
      fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 500 });
      expect(handle()).toHaveAttribute("aria-valuenow", "60");
      fireEvent.pointerCancel(handle(), { pointerId: 1 });
      fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 800 });
      expect(handle()).toHaveAttribute("aria-valuenow", "60");
    });
  });

  it("an_exiting_session_leaves_the_focus_where_it_is", async () => {
    startsWith("s1");
    const user = await renderApp();
    await start(user);
    await within(drawer()).findByTestId("terminal");
    const task = screen.getByRole("textbox", { name: "Task" });
    await user.click(task);
    expect(task).toHaveFocus();

    act(() => exits.s1({ type: "exited", code: 1 }));

    expect(drawer()).toHaveTextContent("Claude Code ended (exit code 1).");
    expect(task).toHaveFocus();
  });

  it("a_start_under_way_keeps_its_busy_state_to_its_own_project", async () => {
    let finish!: (session: { id: string; prefilled: boolean }) => void;
    vi.mocked(startTerminalSession).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = await renderApp();
    await start(user);
    expect(
      within(drawer()).getByRole("button", { name: "Start Claude Code" }),
    ).toHaveAttribute("aria-disabled", "true");

    await selectProject(user, "web");
    expect(
      within(drawer()).getByRole("button", { name: "Start Claude Code" }),
    ).toHaveAttribute("aria-disabled", "false");

    await selectProject(user, "api");
    expect(
      within(drawer()).getByRole("button", { name: "Start Claude Code" }),
    ).toHaveAttribute("aria-disabled", "true");

    await act(async () => finish({ id: "s1", prefilled: false }));
    expect(within(drawer()).getByTestId("terminal")).toHaveTextContent("s1");
  });

  it("a_terminal_that_cannot_load_is_reported_in_the_drawer", async () => {
    // React reports the caught error on the console.
    vi.spyOn(console, "error").mockImplementation(() => {});
    view.broken = true;
    startsWith("s1");
    const user = await renderApp();

    await start(user);

    expect(
      await within(drawer()).findByText("Couldn't load the terminal."),
    ).toBeInTheDocument();
    // The rest of the app is still there.
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();

    view.broken = false;
    await user.click(
      within(drawer()).getByRole("button", { name: "Try again" }),
    );
    expect(await within(drawer()).findByTestId("terminal")).toHaveTextContent(
      "s1",
    );
  });

  it("a_project_switch_during_close_leaves_its_focus_alone", async () => {
    startsWith("s1");
    let finishClose!: () => void;
    vi.mocked(closeSession).mockReturnValueOnce(
      new Promise((resolve) => {
        finishClose = resolve;
      }),
    );
    const user = await renderApp();
    await start(user);
    await within(drawer()).findByTestId("terminal");

    await user.click(within(drawer()).getByRole("button", { name: "Close" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "End session",
      }),
    );
    // Another project shows before the close has finished: its button
    // isn't the one the close was for. The picker puts the focus back on
    // itself as it closes, so what counts is whether the button was
    // focused at all.
    const focused = vi.spyOn(HTMLElement.prototype, "focus");
    await selectProject(user, "web");
    const webStart = within(drawer()).getByRole("button", {
      name: "Start Claude Code",
    });
    expect(focused.mock.contexts).not.toContain(webStart);

    // Nor does api's button take it later, once the close is long done.
    await act(async () => finishClose());
    await selectProject(user, "api");
    const apiStart = within(drawer()).getByRole("button", {
      name: "Start Claude Code",
    });
    expect(focused.mock.contexts).not.toContain(apiStart);
  });

  it("hide_without_show_claude_code_focuses_the_builder_tab", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([]);
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(latestEntryProject).mockResolvedValue(null);
    // Another tablist earlier in the page must not get the focus.
    render(
      <>
        <div role="tablist" aria-label="Elsewhere">
          <button type="button" role="tab" aria-selected="true">
            Other
          </button>
        </div>
        <App />
      </>,
    );
    const user = userEvent.setup();
    const hide = await within(
      await screen.findByRole("region", { name: "Claude Code" }),
    ).findByRole("button", { name: "Hide" });
    expect(
      screen.queryByRole("button", { name: "Show Claude Code" }),
    ).toBeNull();

    await user.click(hide);

    expect(screen.getByRole("tab", { name: "Builder" })).toHaveFocus();
  });

  it("a_short_builder_area_scrolls", async () => {
    await renderApp();

    // jsdom has no layout, so this checks the classes that make it scroll.
    // The area above the drawer takes what is left, never asks for a
    // minimum, and scrolls; the panes inside keep a floor, so a short area
    // scrolls them as one instead of squeezing each.
    const above = screen.getByTestId("builder-panes");
    expect(above).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
    const grid = above.firstElementChild!;
    expect(grid).toHaveClass("h-full", "min-h-60", "grid-rows-[minmax(0,1fr)]");
    // Each pane still scrolls on its own when there is room.
    const form = grid.firstElementChild!;
    expect(form).toHaveClass("min-h-0", "overflow-y-auto");
    // The drawer keeps its share and no sideways scrolling comes from it.
    expect(drawer()).toHaveClass("flex-none", "min-w-0");
    expect(drawer().parentElement).toBe(above.parentElement);
  });

  it("a_send_into_a_missing_folder_opens_the_drawer_to_choose_another", async () => {
    vi.stubGlobal("innerHeight", 600);
    const gone = project("p-gone", "gone", "/home/me/gone");
    vi.mocked(savePromptEntry).mockResolvedValue({} as PromptEntry);
    vi.mocked(startTerminalSession).mockRejectedValueOnce(
      new ApiError("invalid", "That folder no longer exists."),
    );
    const user = await renderApp([gone], gone.id);
    await user.type(screen.getByRole("textbox", { name: "Task" }), "a task");
    expect(screen.queryByRole("region", { name: "Claude Code" })).toBeNull();

    await user.click(
      await screen.findByRole("button", { name: "Send to Claude Code" }),
    );

    expect(
      await screen.findByText("That folder no longer exists."),
    ).toBeInTheDocument();
    expect(
      within(drawer()).getByRole("button", { name: "Choose folder…" }),
    ).toBeInTheDocument();
  });
});
