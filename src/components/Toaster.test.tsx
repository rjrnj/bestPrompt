import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listFrameworks } from "../api";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../state/AppState";
import { Toaster } from "./Toaster";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
}));

/** Adds toasts through the reducer and shows how many are in state. */
function Probe() {
  const dispatch = useAppDispatch();
  const { toasts } = useAppState();
  return (
    <div>
      <p>toasts: {toasts.length}</p>
      <button
        onClick={() =>
          dispatch({ type: "toastAdded", kind: "info", message: "Copied" })
        }
      >
        add info
      </button>
      <button
        onClick={() =>
          dispatch({ type: "toastAdded", kind: "error", message: "No luck" })
        }
      >
        add error
      </button>
    </div>
  );
}

function renderToaster() {
  vi.mocked(listFrameworks).mockResolvedValue([]);
  render(
    <AppStateProvider>
      <Probe />
      <Toaster />
    </AppStateProvider>,
  );
}

/** The toast list, as opposed to Radix's screen-reader announcement copy. */
function notifications() {
  return within(screen.getByRole("region", { name: /notifications/i }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("Toaster", () => {
  it("shows each toast in state in the notifications region", async () => {
    renderToaster();

    await userEvent.click(screen.getByRole("button", { name: "add info" }));
    await userEvent.click(screen.getByRole("button", { name: "add error" }));

    expect(notifications().getByText("Copied")).toBeInTheDocument();
    expect(notifications().getByText("No luck")).toBeInTheDocument();
  });

  it("removes a toast from state when its close button is pressed", async () => {
    renderToaster();
    await userEvent.click(screen.getByRole("button", { name: "add info" }));

    await userEvent.click(
      notifications().getByRole("button", { name: "Dismiss" }),
    );

    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
    expect(screen.getByText("toasts: 0")).toBeInTheDocument();
  });

  it("dismisses an info toast after four seconds", () => {
    vi.useFakeTimers();
    renderToaster();
    fireEvent.click(screen.getByRole("button", { name: "add info" }));

    act(() => vi.advanceTimersByTime(3900));
    expect(notifications().getByText("Copied")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));

    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
    expect(screen.getByText("toasts: 0")).toBeInTheDocument();
  });

  it("keeps an error toast up for eight seconds", () => {
    vi.useFakeTimers();
    renderToaster();
    fireEvent.click(screen.getByRole("button", { name: "add error" }));

    act(() => vi.advanceTimersByTime(7900));
    expect(notifications().getByText("No luck")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));

    expect(screen.queryByText("No luck")).not.toBeInTheDocument();
  });

  it("announces an error assertively and an info toast politely", async () => {
    renderToaster();

    await userEvent.click(screen.getByRole("button", { name: "add error" }));
    await userEvent.click(screen.getByRole("button", { name: "add info" }));

    // Radix announces each toast once through a visually hidden status
    // region, its label ("Notification") first.
    // The region appears at once but gets its text a frame or two later.
    const live = (text: string) =>
      screen
        .queryAllByRole("status")
        .find((region) => region.textContent?.includes(text))
        ?.getAttribute("aria-live");
    await waitFor(() => {
      expect(live("No luck")).toBe("assertive");
      expect(live("Copied")).toBe("polite");
    });
  });

  // Radix pauses every timer while the pointer or focus is on the stack and
  // resumes on pointerleave or focusout, but only listens while a toast is
  // showing. Closing the last toast by hand happens with the pointer or focus
  // there, so without a fresh provider the next toasts would never time out.
  it("times out new toasts after the last one was closed by its button", async () => {
    const user = userEvent.setup();
    renderToaster();
    fireEvent.click(screen.getByRole("button", { name: "add info" }));

    await user.click(notifications().getByRole("button", { name: "Dismiss" }));
    // Fake timers only now: user-event hangs under them in Vitest.
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "add info" }));
    act(() => vi.advanceTimersByTime(4100));

    expect(screen.getByText("toasts: 0")).toBeInTheDocument();
  });

  it("times out new toasts after the last one was closed with Escape", async () => {
    const user = userEvent.setup();
    renderToaster();
    fireEvent.click(screen.getByRole("button", { name: "add info" }));
    const dismiss = notifications().getByRole("button", { name: "Dismiss" });
    await user.hover(dismiss);
    act(() => dismiss.focus());

    await user.keyboard("{Escape}");
    // Fake timers only now: user-event hangs under them in Vitest.
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "add info" }));
    act(() => vi.advanceTimersByTime(4100));

    expect(screen.getByText("toasts: 0")).toBeInTheDocument();
  });
});
