import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, listFrameworks } from "../api";
import { AppStateProvider, useAppState } from "../state/AppState";
import { LoadErrorPanel } from "./LoadErrorPanel";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
}));

/** The panel when loading failed, otherwise the status, as the shell will do. */
function Shell() {
  const { frameworks } = useAppState();
  if (frameworks.status === "error") {
    return <LoadErrorPanel message={frameworks.message} />;
  }
  return <p>status: {frameworks.status}</p>;
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("LoadErrorPanel", () => {
  it("shows the message and retries loading", async () => {
    vi.mocked(listFrameworks)
      .mockRejectedValueOnce(new ApiError("database", "no db"))
      .mockResolvedValueOnce([]);
    render(
      <AppStateProvider>
        <Shell />
      </AppStateProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("no db");

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("status: ready")).toBeInTheDocument();
    expect(listFrameworks).toHaveBeenCalledTimes(2);
  });
});
