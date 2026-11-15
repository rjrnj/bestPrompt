import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import {
  claudeStatus,
  listPromptEntries,
  latestEntryProject,
  listFrameworks,
  listProjects,
} from "../../api";
import type { Framework } from "../../bindings/Framework";
import type { SessionEvent } from "../../bindings/SessionEvent";
import type { Project } from "../../bindings/Project";
import { F6_HINT_ID } from "../../terminal/keys";
import { startTerminalSession } from "../../terminal/terminals";

const F6_HINT = "F6: back to the Builder";

vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  listPromptEntries: vi.fn(),
  claudeStatus: vi.fn(),
}));
vi.mock("../../terminal/terminals", () => ({
  startTerminalSession: vi.fn(),
  disposeTerminal: vi.fn(),
}));
vi.mock("./TerminalView", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    TerminalView: function TerminalView({ sessionId }: { sessionId: string }) {
      const input = useRef<HTMLTextAreaElement>(null);
      useEffect(() => input.current?.focus(), [sessionId]);
      return (
        <div className="xterm" data-testid="terminal">
          <textarea
            ref={input}
            className="xterm-helper-textarea"
            aria-label="Terminal input"
          />
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
const api: Project = {
  id: "p-api",
  name: "api",
  folder: "/home/me/api",
  createdAt: 1,
  updatedAt: 1,
};

async function renderApp() {
  vi.mocked(listProjects).mockResolvedValue([api]);
  vi.mocked(latestEntryProject).mockResolvedValue(api.id);
  render(<App />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Copy" });
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent(
      "api",
    ),
  );
  return user;
}

const drawer = () => screen.getByRole("region", { name: "Claude Code" });
const panes = () => screen.getByTestId("builder-panes");
const task = () => within(panes()).getByRole("textbox", { name: /Task/ });

/** Starts a session whose fake terminal is the mounted terminal view. */
async function startSession(user: ReturnType<typeof userEvent.setup>) {
  let onEvent: (event: SessionEvent) => void = () => {};
  vi.mocked(startTerminalSession).mockImplementationOnce(
    async (_folder, handler) => {
      onEvent = handler;
      return { id: "s1", prefilled: false };
    },
  );
  await user.click(
    await within(drawer()).findByRole("button", { name: "Start Claude Code" }),
  );
  const element = await within(drawer()).findByLabelText("Terminal input");
  await waitFor(() => expect(element).toHaveFocus());
  return {
    element,
    end: () => act(() => onEvent({ type: "exited", code: 1 })),
  };
}

function f6(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "F6",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.mocked(listFrameworks).mockResolvedValue([rtf]);
  vi.mocked(listPromptEntries).mockResolvedValue([]);
  vi.mocked(claudeStatus).mockResolvedValue({
    found: true,
    path: "/bin/claude",
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("F6", () => {
  it("f6_moves_from_the_terminal_to_the_builder_and_back", async () => {
    const user = await renderApp();
    const { element } = await startSession(user);

    // The field that last had the focus gets it back.
    await user.click(task());
    element.focus();
    const event = f6();
    expect(event.defaultPrevented).toBe(true);
    expect(task()).toHaveFocus();

    // And from the Builder, the terminal.
    f6();
    expect(element).toHaveFocus();

    // With no field focused before, the first form field.
    cleanup();
    const again = await renderApp();
    const second = await startSession(again);
    expect(task()).not.toHaveFocus();
    f6();
    expect(second.element).not.toHaveFocus();
    const first = panes().querySelector<HTMLElement>(
      "input, textarea, select, button",
    );
    expect(first).toHaveFocus();
  });

  it("f6_with_no_session_goes_to_the_drawer_button", async () => {
    const user = await renderApp();
    await user.click(task());

    const event = f6();

    expect(event.defaultPrevented).toBe(true);
    expect(
      within(drawer()).getByRole("button", { name: "Start Claude Code" }),
    ).toHaveFocus();
  });

  it("f6_does_nothing_with_the_drawer_hidden_or_on_other_tabs", async () => {
    const user = await renderApp();
    await user.click(task());

    // Modifiers.
    for (const init of [
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { metaKey: true },
    ]) {
      expect(f6(init).defaultPrevented).toBe(false);
      expect(task()).toHaveFocus();
    }

    // Hidden drawer.
    await user.click(within(drawer()).getByRole("button", { name: "Hide" }));
    const hidden = document.activeElement;
    expect(f6().defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(hidden);

    // Another tab, with the drawer open.
    await user.click(screen.getByRole("button", { name: "Show Claude Code" }));
    await user.click(screen.getByRole("tab", { name: "History" }));
    const tab = document.activeElement;
    expect(f6().defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(tab);
  });

  it("the_hide_button_mentions_f6", async () => {
    await renderApp();
    expect(
      within(drawer()).getByRole("button", { name: "Hide" }),
    ).toHaveAttribute("title", "F6 moves between Claude Code and the Builder");
  });

  it("the_drawer_shows_the_f6_hint_with_a_session", async () => {
    const user = await renderApp();
    expect(within(drawer()).queryByText(F6_HINT)).toBeNull();

    await startSession(user);

    const hint = within(drawer()).getByText(F6_HINT);
    expect(hint).toHaveAttribute("id", F6_HINT_ID);
  });

  it("f6_does_nothing_while_a_dialog_is_open", async () => {
    await renderApp();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inside = document.createElement("button");
    dialog.appendChild(inside);
    document.body.appendChild(dialog);
    inside.focus();

    const event = f6();

    expect(event.defaultPrevented).toBe(false);
    expect(inside).toHaveFocus();
    dialog.remove();
  });

  it("f6_from_a_drawer_button_goes_to_the_terminal", async () => {
    const user = await renderApp();
    const { element } = await startSession(user);
    within(drawer()).getByRole("button", { name: "Hide" }).focus();

    const event = f6();

    expect(event.defaultPrevented).toBe(true);
    expect(element).toHaveFocus();
  });

  it("f6_from_a_header_picker_goes_to_the_terminal", async () => {
    const user = await renderApp();
    const { element } = await startSession(user);
    for (const name of ["Framework", "Project"]) {
      screen.getByRole("combobox", { name }).focus();
      f6();
      expect(element).toHaveFocus();
    }
  });

  it("f6_with_an_ended_session_goes_to_restart", async () => {
    const user = await renderApp();
    const { end } = await startSession(user);
    await end();
    await user.click(task());

    f6();

    expect(
      within(drawer()).getAllByRole("button", { name: "Restart" })[1],
    ).toHaveFocus();
  });

  it("f6_from_a_full_height_drawer_goes_to_its_header", async () => {
    const user = await renderApp();
    const { element } = await startSession(user);
    await user.click(
      within(drawer()).getByRole("button", { name: "Maximize" }),
    );
    expect(panes()).toHaveAttribute("inert");
    element.focus();

    f6();

    expect(
      within(drawer()).getByRole("button", { name: "Restore" }),
    ).toHaveFocus();
    expect(element).not.toHaveFocus();
  });
});
