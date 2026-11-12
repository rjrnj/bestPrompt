import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import {
  claudeStatus,
  closeSession,
  getSettings,
  latestEntryProject,
  listFrameworks,
  listProjects,
  savePromptEntry,
  setSetting,
} from "../../api";
import type { Framework } from "../../bindings/Framework";
import type { Project } from "../../bindings/Project";
import type { PromptEntry } from "../../bindings/PromptEntry";
import type { SessionEvent } from "../../bindings/SessionEvent";
import { startTerminalSession, terminalFor } from "../../terminal/terminals";

vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  listPromptEntries: vi.fn().mockResolvedValue([]),
  claudeStatus: vi.fn(),
  closeSession: vi.fn(),
  savePromptEntry: vi.fn(),
  getSettings: vi.fn(),
  setSetting: vi.fn(),
}));
vi.mock("../../clipboard", () => ({ writeText: vi.fn() }));
// No real xterm: jsdom can't lay one out.
vi.mock("../../terminal/terminals", () => ({
  startTerminalSession: vi.fn(),
  terminalFor: vi.fn(),
  disposeTerminal: vi.fn(),
}));
vi.mock("./TerminalView", () => ({
  TerminalView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="terminal">{sessionId}</div>
  ),
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

function project(id: string, folder: string): Project {
  return { id, name: id, folder, createdAt: 1, updatedAt: 1 };
}

const api = project("api", "/home/me/api");
const web = project("web", "/home/me/web");

const NOTE =
  "Your prompt is waiting. Answer Claude's questions below and it will appear in Claude's input box. Then press Enter to run it.";
const WHY_TEXT =
  "On its first run, and when it opens a folder it hasn't seen, Claude asks a few setup questions before it shows your prompt.";
const SENT_LINE = "Sent to Claude Code.";

let exits: Record<string, (e: SessionEvent) => void>;

function startsWith(id: string, prefilled = true) {
  vi.mocked(startTerminalSession).mockImplementationOnce(
    async (_folder, onEvent) => {
      exits[id] = onEvent;
      return { id, prefilled };
    },
  );
}

async function renderApp() {
  vi.mocked(listProjects).mockResolvedValue([api, web]);
  vi.mocked(latestEntryProject).mockResolvedValue(api.id);
  render(<App />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Copy" });
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent(
      api.name,
    ),
  );
  await user.type(screen.getByRole("textbox", { name: "Task" }), "review it");
  return user;
}

type User = Awaited<ReturnType<typeof renderApp>>;

async function send(user: User) {
  await user.click(
    await screen.findByRole("button", { name: "Send to Claude Code" }),
  );
}

async function selectProject(user: User, name: string) {
  await user.click(screen.getByRole("combobox", { name: "Project" }));
  await user.click(await screen.findByRole("option", { name }));
}

// The bar in the drawer; the hidden live region holds the same text.
const drawerRegion = () => screen.getByRole("region", { name: "Claude Code" });
const note = () =>
  screen.queryByRole("region", { name: "Claude Code" }) === null
    ? null
    : within(drawerRegion()).queryByText(NOTE);
const findNote = () => waitFor(() => within(drawerRegion()).getByText(NOTE));

beforeEach(() => {
  exits = {};
  vi.mocked(listFrameworks).mockResolvedValue([rtf]);
  vi.mocked(claudeStatus).mockResolvedValue({
    found: true,
    path: "/bin/claude",
  });
  vi.mocked(closeSession).mockResolvedValue();
  vi.mocked(savePromptEntry).mockResolvedValue({} as PromptEntry);
  vi.mocked(getSettings).mockResolvedValue({
    theme: "system",
    sendHintSeen: false,
  });
  vi.mocked(setSetting).mockResolvedValue();
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("the waiting note", () => {
  it("a_prefilled_send_shows_the_waiting_note_without_a_toast", async () => {
    startsWith("s1");
    const user = await renderApp();

    await send(user);

    const text = await findNote();
    expect(
      within(screen.getByRole("region", { name: "Claude Code" })).getByText(
        NOTE,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /notifications/i })).toBeNull();
    // The note never takes the focus.
    expect(text.parentElement).not.toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it("the_note_is_announced_through_a_region_that_is_always_there", async () => {
    startsWith("s1");
    const user = await renderApp();
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();

    await send(user);

    await findNote();
    // The same element, now holding the message and nothing else.
    await waitFor(() => expect(region).toHaveTextContent(/^Your prompt/));
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toBe(NOTE);
    // The bar itself is not a live region.
    expect(screen.getAllByRole("status")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Close note" }));
    await waitFor(() => expect(region).toBeEmptyDOMElement());
  });

  describe("the_note_stays_until_closed_or_the_session_ends", () => {
    it("closed", async () => {
      startsWith("s1");
      const user = await renderApp();
      await send(user);
      await findNote();

      await user.click(screen.getByRole("button", { name: "Close note" }));

      expect(note()).toBeNull();
      expect(screen.getByText(SENT_LINE)).toBeInTheDocument();
    });

    it("the session exits", async () => {
      startsWith("s1");
      const user = await renderApp();
      await send(user);
      await findNote();

      act(() => exits.s1({ type: "exited", code: 0 }));

      expect(note()).toBeNull();
    });

    it("Close in the drawer", async () => {
      startsWith("s1");
      const user = await renderApp();
      await send(user);
      await findNote();

      await user.click(screen.getByRole("button", { name: "Close" }));
      await user.click(
        await screen.findByRole("button", { name: "End session" }),
      );

      await waitFor(() => expect(note()).toBeNull());
    });

    it("Restart", async () => {
      startsWith("s1");
      startsWith("s2");
      const user = await renderApp();
      await send(user);
      await findNote();

      await user.click(screen.getByRole("button", { name: "Restart" }));
      const dialog = await screen.findByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "Restart" }));

      await waitFor(() =>
        expect(screen.getByTestId("terminal")).toHaveTextContent("s2"),
      );
      expect(note()).toBeNull();
      expect(screen.queryByText(SENT_LINE)).toBeNull();
    });
  });

  describe("closing_the_note_moves_the_focus_on", () => {
    it("to_the_sessions_terminal", async () => {
      const focus = vi.fn();
      vi.mocked(terminalFor).mockImplementation((id: string) =>
        id === "s1"
          ? ({ focus } as unknown as ReturnType<typeof terminalFor>)
          : undefined,
      );
      startsWith("s1");
      const user = await renderApp();
      await send(user);
      await findNote();
      focus.mockClear();

      await user.click(screen.getByRole("button", { name: "Close note" }));

      await waitFor(() => expect(focus).toHaveBeenCalledTimes(1));
    });

    it("to_the_drawer_when_there_is_no_terminal", async () => {
      startsWith("s1");
      const user = await renderApp();
      await send(user);
      await findNote();

      await user.click(screen.getByRole("button", { name: "Close note" }));

      await waitFor(() =>
        expect(drawerRegion()).toContainElement(
          document.activeElement as HTMLElement,
        ),
      );
    });
  });

  it("notes_and_sent_lines_follow_the_selected_project", async () => {
    startsWith("sa");
    startsWith("sb");
    const user = await renderApp();
    await send(user);
    await findNote();
    await selectProject(user, "web");
    expect(note()).toBeNull();
    await send(user);
    await waitFor(() =>
      expect(screen.getByTestId("terminal")).toHaveTextContent("sb"),
    );
    expect(note()).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Close note" }));
    expect(note()).toBeNull();
    await selectProject(user, "api");

    expect(screen.getByTestId("terminal")).toHaveTextContent("sa");
    expect(note()).not.toBeNull();
    expect(screen.getByText(SENT_LINE)).toBeInTheDocument();
    await selectProject(user, "web");
    expect(note()).toBeNull();
    expect(screen.getByText(SENT_LINE)).toBeInTheDocument();

    // And the other way: closing api's note leaves web's alone.
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(
      await screen.findByRole("button", { name: "End session" }),
    );
    startsWith("sb2");
    await send(user);
    await findNote();
    await selectProject(user, "api");
    await user.click(screen.getByRole("button", { name: "Close note" }));
    expect(note()).toBeNull();
    await selectProject(user, "web");
    expect(note()).not.toBeNull();
  });

  it("the_first_time_hint_shows_until_a_note_showing_it_is_closed", async () => {
    startsWith("s1");
    startsWith("s2");
    const user = await renderApp();
    await send(user);
    const why = await screen.findByRole("button", { name: "Why?" });
    expect(why).toHaveAttribute("aria-expanded", "false");
    // Folded away, but still there for aria-controls to point at.
    const folded = document.getElementById(why.getAttribute("aria-controls")!);
    expect(folded).toHaveTextContent(WHY_TEXT);
    expect(folded).not.toBeVisible();

    await user.click(why);

    expect(why).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(WHY_TEXT)).toBe(folded);
    expect(folded).toBeVisible();
    // Expanding alone doesn't count as seen.
    expect(setSetting).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Close note" }));
    expect(setSetting).toHaveBeenCalledExactlyOnceWith({ sendHintSeen: true });

    // The next send's note has no hint.
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(
      await screen.findByRole("button", { name: "End session" }),
    );
    await send(user);
    await findNote();
    expect(screen.queryByRole("button", { name: "Why?" })).toBeNull();
  });
});
