import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  pasteClipboard,
  resizeSession,
  startSession,
  writeSession,
} from "../api";
import type { SessionEvent } from "../bindings/SessionEvent";
import type { StartedSession } from "../bindings/StartedSession";
import { writeText } from "../clipboard";
import {
  disposeTerminal,
  resizeTerminalSession,
  startTerminalSession,
  terminalFor,
} from "./terminals";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  startSession: vi.fn(),
  writeSession: vi.fn(),
  resizeSession: vi.fn(),
  pasteClipboard: vi.fn(),
}));
vi.mock("../clipboard", () => ({ writeText: vi.fn() }));

const noEvents = () => {};

/** What `startSession` resolves with for a session started as `id`. */
const session = (id: string, prefilled = false): StartedSession => ({
  id,
  prefilled,
});

beforeEach(() => {
  vi.mocked(writeSession).mockResolvedValue();
  vi.mocked(resizeSession).mockResolvedValue();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

/** A matchMedia fake whose dark/light answer can be flipped. */
function fakeColourScheme(dark: boolean) {
  let matches = dark;
  const listeners = new Set<(e: { matches: boolean }) => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_: string, l: (e: { matches: boolean }) => void) =>
      listeners.add(l),
    removeEventListener: (_: string, l: (e: { matches: boolean }) => void) =>
      listeners.delete(l),
  }));
  return (next: boolean) => {
    matches = next;
    listeners.forEach((l) => l({ matches: next }));
  };
}

describe("the terminal registry", () => {
  it("the_prompt_is_passed_on_and_whether_it_was_prefilled_comes_back", async () => {
    vi.mocked(startSession).mockResolvedValue(session("s14", true));

    const started = await startTerminalSession("/work", noEvents, {
      prompt: "fix it",
    });

    expect(started).toEqual({ id: "s14", prefilled: true });
    expect(startSession).toHaveBeenCalledWith(
      "/work",
      expect.anything(),
      "fix it",
      expect.any(Function),
      expect.any(Function),
    );
    disposeTerminal("s14");
  });

  it("without_a_prompt_none_is_passed", async () => {
    vi.mocked(startSession).mockResolvedValue(session("s15"));

    const started = await startTerminalSession("/work", noEvents);

    expect(started).toEqual({ id: "s15", prefilled: false });
    expect(vi.mocked(startSession).mock.calls[0][2]).toBeNull();
    disposeTerminal("s15");
  });

  it("output_written_while_hidden_is_there_when_shown", async () => {
    vi.mocked(startSession).mockImplementation(async (_f, _s, _p, onOutput) => {
      onOutput(new TextEncoder().encode("hello"));
      return session("s1");
    });

    await startTerminalSession("/work", noEvents);
    const terminal = terminalFor("s1")!;
    await new Promise<void>((done) => terminal.write("", done));
    terminal.open(document.createElement("div"));

    expect(terminal.buffer.active.getLine(0)?.translateToString()).toContain(
      "hello",
    );
    disposeTerminal("s1");
  });

  it("the_theme_follows_the_colour_scheme", async () => {
    const setDark = fakeColourScheme(true);
    vi.mocked(startSession).mockResolvedValue(session("s2"));

    await startTerminalSession("/work", noEvents);
    const terminal = terminalFor("s2")!;
    const dark = terminal.options.theme;
    setDark(false);
    const light = terminal.options.theme;

    expect(dark?.background).not.toBe(light?.background);
    expect(light?.background).toBe("#ffffff");
    disposeTerminal("s2");
  });

  it("typing_before_the_id_is_known_is_sent_once_it_is", async () => {
    let resolve!: (started: StartedSession) => void;
    vi.mocked(startSession).mockImplementation((_f, _s, _p, onOutput) => {
      // A cursor position query: the terminal answers through onData, the
      // same path a key press takes.
      onOutput(new TextEncoder().encode("[6n"));
      return new Promise<StartedSession>((r) => (resolve = r));
    });

    const started = startTerminalSession("/work", noEvents);
    await new Promise((r) => setTimeout(r, 50));
    expect(writeSession).not.toHaveBeenCalled();

    resolve(session("s3"));
    await started;

    expect(writeSession).toHaveBeenCalledWith("s3", "[1;1R");
    disposeTerminal("s3");
  });

  it("ctrl_shift_v_pastes_through_the_backend", async () => {
    vi.mocked(startSession).mockResolvedValue(session("s4"));
    vi.mocked(pasteClipboard).mockResolvedValue();
    await startTerminalSession("/work", noEvents);
    const terminal = terminalFor("s4")!;
    terminal.open(document.createElement("div"));

    const key = new KeyboardEvent("keydown", {
      key: "V",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    terminal.textarea!.dispatchEvent(key);

    expect(pasteClipboard).toHaveBeenCalledWith("s4");
    expect(key.defaultPrevented).toBe(true);
    expect(writeSession).not.toHaveBeenCalled();
    disposeTerminal("s4");
  });

  it("copying_clears_the_selection_so_the_next_ctrl_c_reaches_claude", async () => {
    vi.mocked(startSession).mockResolvedValue(session("s11"));
    vi.mocked(writeText).mockResolvedValue();
    await startTerminalSession("/work", noEvents);
    const terminal = terminalFor("s11")!;
    terminal.open(document.createElement("div"));
    await new Promise<void>((done) => terminal.write("hello", done));
    terminal.select(0, 0, 5);
    expect(terminal.hasSelection()).toBe(true);

    const key = new KeyboardEvent("keydown", {
      key: "C",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    terminal.textarea!.dispatchEvent(key);

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(key.defaultPrevented).toBe(true);
    expect(terminal.hasSelection()).toBe(false);
    disposeTerminal("s11");
  });

  it("a_failed_start_disposes_the_terminal", async () => {
    const listening = new Set<unknown>();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: (_: string, l: unknown) => listening.add(l),
      removeEventListener: (_: string, l: unknown) => listening.delete(l),
    }));
    vi.mocked(startSession).mockRejectedValue(new Error("no claude"));

    await expect(startTerminalSession("/work", noEvents)).rejects.toThrow(
      "no claude",
    );

    expect(listening.size).toBe(0);
  });

  it("output_after_dispose_is_dropped", async () => {
    let onOutput!: (bytes: Uint8Array) => void;
    vi.mocked(startSession).mockImplementation(async (_f, _s, _p, output) => {
      onOutput = output;
      return session("s5");
    });
    await startTerminalSession("/work", noEvents);
    const write = vi.spyOn(terminalFor("s5")!, "write");

    disposeTerminal("s5");
    expect(() => onOutput(new TextEncoder().encode("late"))).not.toThrow();

    expect(write).not.toHaveBeenCalled();
  });

  it("typing_after_the_session_exits_is_not_sent", async () => {
    let onEvent!: (e: SessionEvent) => void;
    vi.mocked(startSession).mockImplementation(
      async (_f, _s, _p, _o, events) => {
        onEvent = events;
        return session("s6");
      },
    );
    const seen = vi.fn();
    await startTerminalSession("/work", seen);
    const terminal = terminalFor("s6")!;

    terminal.input("a");
    expect(writeSession).toHaveBeenCalledTimes(1);
    onEvent({ type: "exited", code: 0 });
    terminal.input("b");

    expect(writeSession).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith({ type: "exited", code: 0 });
    disposeTerminal("s6");
  });

  it("after_a_write_finds_the_session_ended_nothing_more_is_sent", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(startSession).mockResolvedValue(session("s7"));
    vi.mocked(writeSession).mockRejectedValueOnce(
      new ApiError("notFound", "That session has ended."),
    );
    await startTerminalSession("/work", noEvents);
    const terminal = terminalFor("s7")!;

    terminal.input("a");
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    terminal.input("b");
    terminal.input("c");
    await new Promise((r) => setTimeout(r, 20));

    expect(writeSession).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    disposeTerminal("s7");
  });

  it("other_write_errors_are_logged_and_typing_goes_on", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(startSession).mockResolvedValue(session("s9"));
    vi.mocked(writeSession).mockRejectedValue(new ApiError("failed", "x"));
    await startTerminalSession("/work", noEvents);
    const terminal = terminalFor("s9")!;

    terminal.input("a");
    terminal.input("b");
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));

    expect(writeSession).toHaveBeenCalledTimes(2);
    disposeTerminal("s9");
  });

  it("a_resize_after_the_session_exits_is_not_sent", async () => {
    let onEvent!: (e: SessionEvent) => void;
    vi.mocked(startSession).mockImplementation(
      async (_f, _s, _p, _o, events) => {
        onEvent = events;
        return session("s12");
      },
    );
    await startTerminalSession("/work", noEvents);

    resizeTerminalSession("s12", 100, 30);
    onEvent({ type: "exited", code: 0 });
    resizeTerminalSession("s12", 90, 20);

    expect(resizeSession).toHaveBeenCalledTimes(1);
    expect(resizeSession).toHaveBeenCalledWith("s12", 100, 30);
    disposeTerminal("s12");
  });

  it("after_a_resize_finds_the_session_ended_nothing_more_is_sent", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(startSession).mockResolvedValue(session("s13"));
    vi.mocked(resizeSession).mockRejectedValueOnce(
      new ApiError("notFound", "That session has ended."),
    );
    await startTerminalSession("/work", noEvents);
    const terminal = terminalFor("s13")!;

    resizeTerminalSession("s13", 100, 30);
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    resizeTerminalSession("s13", 90, 20);
    terminal.input("a");
    await new Promise((r) => setTimeout(r, 20));

    expect(resizeSession).toHaveBeenCalledTimes(1);
    expect(writeSession).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    disposeTerminal("s13");
  });

  it("paste_after_the_session_exits_is_not_sent", async () => {
    let onEvent!: (e: SessionEvent) => void;
    vi.mocked(startSession).mockImplementation(
      async (_f, _s, _p, _o, events) => {
        onEvent = events;
        return session("s8");
      },
    );
    await startTerminalSession("/work", noEvents);
    const terminal = terminalFor("s8")!;
    terminal.open(document.createElement("div"));
    onEvent({ type: "exited", code: 0 });

    terminal.textarea!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "V",
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );

    expect(pasteClipboard).not.toHaveBeenCalled();
    disposeTerminal("s8");
  });

  it("after_a_paste_finds_the_session_ended_nothing_more_is_sent", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(startSession).mockResolvedValue(session("s10"));
    vi.mocked(pasteClipboard).mockRejectedValueOnce(
      new ApiError("notFound", "That session has ended."),
    );
    await startTerminalSession("/work", noEvents);
    const terminal = terminalFor("s10")!;
    terminal.open(document.createElement("div"));
    const paste = () =>
      terminal.textarea!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "V",
          ctrlKey: true,
          shiftKey: true,
          cancelable: true,
        }),
      );

    paste();
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    paste();
    terminal.input("a");
    await new Promise((r) => setTimeout(r, 20));

    expect(pasteClipboard).toHaveBeenCalledTimes(1);
    expect(writeSession).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    disposeTerminal("s10");
  });
});
