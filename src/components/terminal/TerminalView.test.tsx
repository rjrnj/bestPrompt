import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resizeSession, startSession } from "../../api";
import type { SessionEvent } from "../../bindings/SessionEvent";
import {
  disposeTerminal,
  fitFor,
  startTerminalSession,
  terminalFor,
} from "../../terminal/terminals";
import { TerminalView } from "./TerminalView";

vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  startSession: vi.fn(),
  writeSession: vi.fn().mockResolvedValue(undefined),
  resizeSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../clipboard", () => ({ writeText: vi.fn() }));

/** What `startSession` resolves with for the session these tests start. */
const v1 = { id: "v1", prefilled: false };

afterEach(() => {
  disposeTerminal("v1");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TerminalView", () => {
  it("renders nothing for an unknown id", () => {
    const { container } = render(<TerminalView sessionId="nope" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("attaches the terminal's element on mount and detaches it on unmount without disposing", async () => {
    vi.mocked(startSession).mockResolvedValue(v1);
    await startTerminalSession("/work", () => {});
    const terminal = terminalFor("v1")!;

    const { container, unmount } = render(<TerminalView sessionId="v1" />);
    expect(container.querySelector(".xterm")).toBe(terminal.element);

    unmount();

    expect(terminal.element?.isConnected).toBe(false);
    expect(terminalFor("v1")).toBe(terminal);
    expect(() => terminal.write("still usable")).not.toThrow();

    const again = render(<TerminalView sessionId="v1" />);
    expect(again.container.querySelector(".xterm")).toBe(terminal.element);
  });

  it("clips whatever xterm lays out past the box it is opened in", async () => {
    vi.mocked(startSession).mockResolvedValue(v1);
    await startTerminalSession("/work", () => {});

    const { container } = render(<TerminalView sessionId="v1" />);

    // xterm's hidden input is absolutely positioned at the cursor row and can
    // reach past the box, so something around xterm must clip it.
    const xterm = container.querySelector(".xterm")!;
    expect(xterm.closest(".overflow-hidden")).not.toBeNull();
  });

  it("a_session_that_has_ended_is_not_resized", async () => {
    let onEvent!: (e: SessionEvent) => void;
    vi.mocked(startSession).mockImplementation(
      async (_f, _s, _p, _o, events) => {
        onEvent = events;
        return v1;
      },
    );
    await startTerminalSession("/work", () => {});
    const terminal = terminalFor("v1")!;
    // jsdom lays nothing out: give the box a size, and have each fit pick
    // the next size in turn.
    const sizes = [
      [100, 30],
      [90, 20],
    ];
    let size = [terminal.cols, terminal.rows];
    Object.defineProperty(terminal, "cols", { get: () => size[0] });
    Object.defineProperty(terminal, "rows", { get: () => size[1] });
    vi.spyOn(fitFor("v1")!, "fit").mockImplementation(() => {
      size = sizes.shift()!;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    let resized!: () => void;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const error = vi.spyOn(console, "error");

    render(<TerminalView sessionId="v1" />);
    resized();
    onEvent({ type: "exited", code: 0 });
    resized();

    expect(resizeSession).toHaveBeenCalledTimes(1);
    expect(resizeSession).toHaveBeenCalledWith("v1", 100, 30);
    expect(error).not.toHaveBeenCalled();
  });

  it("the_terminal_is_fitted_to_a_box_without_padding", async () => {
    vi.mocked(startSession).mockResolvedValue(v1);
    await startTerminalSession("/work", () => {});
    const terminal = terminalFor("v1")!;

    render(<TerminalView sessionId="v1" />);

    // FitAddon measures the parent, whose size includes any padding.
    const box = terminal.element!.parentElement!;
    expect(box.className).not.toMatch(/\bp[xytrbl]?-/);
    expect(box.parentElement!.className).toContain("p-2");
  });
});
