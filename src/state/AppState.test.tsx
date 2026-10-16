import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, listFrameworks } from "../api";
import type { Framework } from "../bindings/Framework";
import {
  AppStateProvider,
  useAppActions,
  useAppDispatch,
  useAppState,
} from "./AppState";
import { currentDraft } from "./reducer";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
}));

const rtf: Framework = {
  id: "rtf",
  name: "RTF",
  description: "",
  template: "{{role}}",
  isCustom: false,
  sections: [{ key: "role", label: "Role", helpText: "" }],
  createdAt: 1,
  updatedAt: 1,
};

/** Shows the state the hooks expose and offers the actions as buttons. */
function Probe() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { loadFrameworks } = useAppActions();
  const frameworks = state.frameworks;
  return (
    <div>
      <p>status: {frameworks.status}</p>
      {frameworks.status === "error" && <p>message: {frameworks.message}</p>}
      <p>selected: {state.selectedId ?? "none"}</p>
      <p>role: {currentDraft(state).role ?? ""}</p>
      <button onClick={() => void loadFrameworks()}>reload</button>
      <button
        onClick={() =>
          dispatch({ type: "editSection", key: "role", value: "typed" })
        }
      >
        type
      </button>
    </div>
  );
}

/** A promise the test resolves by hand, to order overlapping loads. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function renderProbe() {
  return render(
    <AppStateProvider>
      <Probe />
    </AppStateProvider>,
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("AppStateProvider", () => {
  it("loads the frameworks on mount and selects the first", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);

    renderProbe();

    expect(screen.getByText("status: loading")).toBeInTheDocument();
    expect(await screen.findByText("status: ready")).toBeInTheDocument();
    expect(screen.getByText("selected: rtf")).toBeInTheDocument();
    expect(listFrameworks).toHaveBeenCalledTimes(1);
  });

  it("exposes the error message when loading fails", async () => {
    vi.mocked(listFrameworks).mockRejectedValue(
      new ApiError("database", "no db"),
    );

    renderProbe();

    expect(await screen.findByText("status: error")).toBeInTheDocument();
    expect(screen.getByText("message: no db")).toBeInTheDocument();
  });

  it("reloads through the actions hook, loading again meanwhile", async () => {
    const reload = deferred<Framework[]>();
    vi.mocked(listFrameworks)
      .mockRejectedValueOnce(new ApiError("database", "no db"))
      .mockReturnValueOnce(reload.promise);
    renderProbe();
    await screen.findByText("status: error");

    await userEvent.click(screen.getByRole("button", { name: "reload" }));

    expect(screen.getByText("status: loading")).toBeInTheDocument();
    reload.resolve([rtf]);
    expect(await screen.findByText("status: ready")).toBeInTheDocument();
    expect(listFrameworks).toHaveBeenCalledTimes(2);
  });

  it("ignores the result of a load that a later one superseded", async () => {
    const stale = deferred<Framework[]>();
    const latest = deferred<Framework[]>();
    vi.mocked(listFrameworks)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(latest.promise);
    renderProbe();
    await userEvent.click(screen.getByRole("button", { name: "reload" }));

    latest.resolve([rtf]);
    await screen.findByText("status: ready");
    stale.resolve([{ ...rtf, id: "other", name: "Other" }]);
    await screen.findByText("status: ready");

    expect(screen.getByText("selected: rtf")).toBeInTheDocument();
  });

  it("applies dispatched actions through the reducer", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    renderProbe();
    await screen.findByText("status: ready");

    await userEvent.click(screen.getByRole("button", { name: "type" }));

    expect(screen.getByText("role: typed")).toBeInTheDocument();
  });

  it("refuses each hook outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const StateOnly = () => <p>{useAppState().selectedId}</p>;
    const DispatchOnly = () => <p>{typeof useAppDispatch()}</p>;
    const ActionsOnly = () => <p>{typeof useAppActions().loadFrameworks}</p>;

    expect(() => render(<StateOnly />)).toThrow(
      /useAppState.*AppStateProvider/,
    );
    expect(() => render(<DispatchOnly />)).toThrow(
      /useAppDispatch.*AppStateProvider/,
    );
    expect(() => render(<ActionsOnly />)).toThrow(
      /useAppActions.*AppStateProvider/,
    );
  });
});
