import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, listFrameworks, savePromptEntry } from "../api";
import type { Framework } from "../bindings/Framework";
import type { PromptEntry } from "../bindings/PromptEntry";
import { writeText } from "../clipboard";
import {
  AppStateProvider,
  useAppActions,
  useAppDispatch,
  useAppState,
} from "./AppState";
import { currentDraft, renderedPrompt } from "./reducer";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  savePromptEntry: vi.fn(),
}));
vi.mock("../clipboard", () => ({ writeText: vi.fn() }));

const rtf: Framework = {
  id: "rtf",
  name: "RTF",
  description: "",
  template: "{{role}}",
  summaryKey: null,
  isCustom: false,
  sections: [{ key: "role", label: "Role", helpText: "" }],
  createdAt: 1,
  updatedAt: 1,
};

/** Shows the state the hooks expose and offers the actions as buttons. */
function Probe() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { loadFrameworks, copy, save } = useAppActions();
  const frameworks = state.frameworks;
  const entry = () => ({
    frameworkId: state.selectedId ?? "",
    sectionValues: currentDraft(state),
    renderedPrompt: renderedPrompt(state),
  });
  return (
    <div>
      <p>status: {frameworks.status}</p>
      {frameworks.status === "error" && <p>message: {frameworks.message}</p>}
      <p>selected: {state.selectedId ?? "none"}</p>
      <p>role: {currentDraft(state).role ?? ""}</p>
      <p>saving: {String(state.saving)}</p>
      <ul aria-label="toasts">
        {state.toasts.map((t) => (
          <li key={t.id}>
            {t.kind}: {t.message}
          </li>
        ))}
      </ul>
      <button onClick={() => void loadFrameworks()}>reload</button>
      <button onClick={() => void copy(entry())}>copy</button>
      <button onClick={() => void save(entry())}>save</button>
      <button
        onClick={() =>
          dispatch({ type: "editSection", key: "role", value: "typed" })
        }
      >
        type
      </button>
      <button
        onClick={() =>
          dispatch({ type: "editSection", key: "role", value: "retyped" })
        }
      >
        retype
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

/** What the backend returns for a saved entry; the provider only awaits it. */
function stored(prompt: string): PromptEntry {
  return {
    id: "entry",
    frameworkId: "rtf",
    frameworkSnapshot: {
      name: rtf.name,
      template: rtf.template,
      summaryKey: rtf.summaryKey,
      sections: rtf.sections,
    },
    sectionValues: { role: prompt },
    renderedPrompt: prompt,
    createdAt: 1,
  };
}

/** The provider with RTF loaded and "typed" in its only section. */
async function renderTyped() {
  vi.mocked(listFrameworks).mockResolvedValue([rtf]);
  renderProbe();
  await screen.findByText("status: ready");
  await userEvent.click(screen.getByRole("button", { name: "type" }));
}

function toasts() {
  const list = screen.getByRole("list", { name: "toasts" });
  return Array.from(list.querySelectorAll("li"), (li) => li.textContent);
}

async function click(name: string) {
  await userEvent.click(screen.getByRole("button", { name }));
}

describe("AppStateProvider save flow", () => {
  it("copies the prompt, then saves it with the draft", async () => {
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry).mockResolvedValue(stored("typed"));
    await renderTyped();

    await click("copy");

    expect(writeText).toHaveBeenCalledWith("typed");
    expect(savePromptEntry).toHaveBeenCalledExactlyOnceWith({
      frameworkId: "rtf",
      sectionValues: { role: "typed" },
      renderedPrompt: "typed",
    });
    expect(toasts()).toEqual(["info: Copied and saved"]);
  });

  it("copies an unchanged prompt again without saving it twice", async () => {
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry).mockResolvedValue(stored("typed"));
    await renderTyped();
    await click("copy");

    await click("copy");

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(savePromptEntry).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual(["info: Copied and saved", "info: Copied"]);
  });

  it("saves again once the prompt has changed", async () => {
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry).mockResolvedValue(stored("typed"));
    await renderTyped();
    await click("copy");

    await click("retype");
    await click("copy");

    expect(savePromptEntry).toHaveBeenCalledTimes(2);
    expect(savePromptEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ renderedPrompt: "retyped" }),
    );
  });

  it("saves nothing when the clipboard write fails", async () => {
    vi.mocked(writeText).mockRejectedValue(new Error("no display"));
    await renderTyped();

    await click("copy");

    expect(savePromptEntry).not.toHaveBeenCalled();
    expect(toasts()).toEqual([
      "error: Couldn't copy to the clipboard: no display",
    ]);
  });

  it("reports a failed save after a successful copy", async () => {
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry).mockRejectedValue(
      new ApiError("database", "disk full"),
    );
    await renderTyped();

    await click("copy");

    expect(toasts()).toEqual(["error: Copied, but couldn't save: disk full"]);
    expect(screen.getByText("saving: false")).toBeInTheDocument();
  });

  it("saves without copying, and only once while unchanged", async () => {
    vi.mocked(savePromptEntry).mockResolvedValue(stored("typed"));
    await renderTyped();

    await click("save");
    await click("save");

    expect(writeText).not.toHaveBeenCalled();
    expect(savePromptEntry).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual(["info: Saved", "info: Already saved"]);
  });

  it("keeps the draft when a save fails, and the next save tries again", async () => {
    vi.mocked(savePromptEntry)
      .mockRejectedValueOnce(new ApiError("database", "disk full"))
      .mockResolvedValueOnce(stored("typed"));
    await renderTyped();

    await click("save");

    expect(toasts()).toEqual(["error: Couldn't save: disk full"]);
    expect(screen.getByText("role: typed")).toBeInTheDocument();
    expect(screen.getByText("saving: false")).toBeInTheDocument();
    await click("save");
    expect(savePromptEntry).toHaveBeenCalledTimes(2);
    expect(toasts()).toContain("info: Saved");
  });

  it("is saving while the save is in flight", async () => {
    const pending = deferred<PromptEntry>();
    vi.mocked(savePromptEntry).mockReturnValue(pending.promise);
    await renderTyped();

    await click("save");

    expect(screen.getByText("saving: true")).toBeInTheDocument();
    await act(async () => pending.resolve(stored("typed")));
    expect(screen.getByText("saving: false")).toBeInTheDocument();
  });

  it("records the prompt that was saved, not one typed during the save", async () => {
    const pending = deferred<PromptEntry>();
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(stored("retyped"));
    await renderTyped();

    await click("save");
    await click("retype");
    await act(async () => pending.resolve(stored("typed")));
    await click("copy");

    expect(savePromptEntry).toHaveBeenCalledTimes(2);
    expect(savePromptEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ renderedPrompt: "retyped" }),
    );
    expect(toasts()).toEqual(["info: Saved", "info: Copied and saved"]);
  });

  // A double click lands both clicks before the first copy has finished.
  it("ignores a copy or save started while another is running", async () => {
    const clipboard = deferred<void>();
    vi.mocked(writeText).mockReturnValue(clipboard.promise);
    vi.mocked(savePromptEntry).mockResolvedValue(stored("typed"));
    await renderTyped();

    await click("copy");
    await click("copy");
    await click("save");
    await act(async () => clipboard.resolve());

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(savePromptEntry).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual(["info: Copied and saved"]);
  });
});
