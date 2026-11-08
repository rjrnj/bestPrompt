import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionTerminal } from "./SessionTerminal";

// The load fails as a chunk that can't be fetched does: the import rejects,
// and a lazy component that saw the rejection keeps it for good, so only a
// fresh one can load the view.
const load = vi.hoisted(() => ({ failures: 0, calls: 0 }));
vi.mock("./importTerminalView", () => ({
  importTerminalView: async () => {
    load.calls++;
    if (load.failures > 0) {
      load.failures--;
      throw new TypeError("Failed to fetch dynamically imported module");
    }
    return {
      TerminalView: ({ sessionId }: { sessionId: string }) => (
        <div data-testid="terminal">{sessionId}</div>
      ),
    };
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionTerminal", () => {
  it("try_again_recovers_from_a_failed_load", async () => {
    // React reports the caught error on the console.
    vi.spyOn(console, "error").mockImplementation(() => {});
    load.failures = 1;
    render(<SessionTerminal sessionId="s1" />);

    expect(
      await screen.findByText("Couldn't load the terminal."),
    ).toBeInTheDocument();
    expect(load.calls).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("terminal")).toHaveTextContent("s1");
    expect(load.calls).toBe(2);
  });
});
