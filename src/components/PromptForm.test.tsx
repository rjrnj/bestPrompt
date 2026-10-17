import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listFrameworks } from "../api";
import type { Framework } from "../bindings/Framework";
import type { Section } from "../bindings/Section";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../state/AppState";
import { currentDraft } from "../state/reducer";
import { PromptForm } from "./PromptForm";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
}));

function framework(id: string, sections: Section[]): Framework {
  return {
    id,
    name: id.toUpperCase(),
    description: "",
    template: "",
    summaryKey: null,
    isCustom: false,
    sections,
    createdAt: 1,
    updatedAt: 1,
  };
}

const costar = framework("costar", [
  { key: "context", label: "Context", helpText: "Background the model needs." },
  { key: "objective", label: "Objective", helpText: "The task to carry out." },
]);
const rtf = framework("rtf", [
  { key: "role", label: "Role", helpText: "" },
  { key: "task", label: "Task", helpText: "What to do." },
]);

/** Shows the draft and offers a switch between the two frameworks. */
function Probe() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  return (
    <div>
      <p>draft: {JSON.stringify(currentDraft(state))}</p>
      <button onClick={() => dispatch({ type: "selectFramework", id: "rtf" })}>
        switch to rtf
      </button>
      <button
        onClick={() => dispatch({ type: "selectFramework", id: "costar" })}
      >
        switch to costar
      </button>
    </div>
  );
}

async function renderForm(frameworks: Framework[] = [costar, rtf]) {
  vi.mocked(listFrameworks).mockResolvedValue(frameworks);
  render(
    <AppStateProvider>
      <PromptForm />
      <Probe />
    </AppStateProvider>,
  );
  await screen.findByText(/^draft: \{/);
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("PromptForm", () => {
  it("renders one labelled textarea per section, described by its help text", async () => {
    await renderForm();

    const context = screen.getByRole("textbox", { name: "Context" });
    const objective = screen.getByRole("textbox", { name: "Objective" });
    expect(context).toHaveAccessibleDescription("Background the model needs.");
    expect(objective).toHaveAccessibleDescription("The task to carry out.");
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });

  it("stores what is typed in the draft", async () => {
    await renderForm();

    await userEvent.type(
      screen.getByRole("textbox", { name: "Context" }),
      "a library",
    );

    expect(screen.getByRole("textbox", { name: "Context" })).toHaveValue(
      "a library",
    );
    expect(
      screen.getByText('draft: {"context":"a library","objective":""}'),
    ).toBeInTheDocument();
  });

  it("keeps newlines in the draft", async () => {
    await renderForm();

    await userEvent.type(
      screen.getByRole("textbox", { name: "Context" }),
      "one{enter}two",
    );

    expect(screen.getByRole("textbox", { name: "Context" })).toHaveValue(
      "one\ntwo",
    );
  });

  it("shows the selected framework's sections and keeps each draft", async () => {
    await renderForm();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Context" }),
      "kept",
    );

    await userEvent.click(
      screen.getByRole("button", { name: "switch to rtf" }),
    );
    expect(screen.queryByRole("textbox", { name: "Context" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Role" })).toHaveValue("");
    await userEvent.type(screen.getByRole("textbox", { name: "Role" }), "also");

    await userEvent.click(
      screen.getByRole("button", { name: "switch to costar" }),
    );
    expect(screen.getByRole("textbox", { name: "Context" })).toHaveValue(
      "kept",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "switch to rtf" }),
    );
    expect(screen.getByRole("textbox", { name: "Role" })).toHaveValue("also");
  });

  it("mounts fresh fields on a switch, even for a shared section key", async () => {
    // Three built-ins share the key `role`; a reused textarea would carry its
    // dragged height, scroll offset and undo stack into the other framework.
    const shared = framework("shared", [
      { key: "role", label: "Role", helpText: "" },
    ]);
    await renderForm([shared, rtf]);
    const before = screen.getByRole("textbox", { name: "Role" });

    await userEvent.click(
      screen.getByRole("button", { name: "switch to rtf" }),
    );

    expect(screen.getByRole("textbox", { name: "Role" })).not.toBe(before);
  });

  it("leaves a field without help text undescribed", async () => {
    await renderForm([rtf]);

    expect(screen.getByRole("textbox", { name: "Role" })).not.toHaveAttribute(
      "aria-describedby",
    );
    expect(
      screen.getByRole("textbox", { name: "Task" }),
    ).toHaveAccessibleDescription("What to do.");
  });

  it("renders nothing until a framework is selected", () => {
    vi.mocked(listFrameworks).mockReturnValue(new Promise(() => {}));
    render(
      <AppStateProvider>
        <PromptForm />
      </AppStateProvider>,
    );

    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
