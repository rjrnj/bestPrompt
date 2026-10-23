import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listFrameworks } from "../api";
import type { Framework } from "../bindings/Framework";
import type { ReactNode } from "react";
import { AppStateProvider, useAppDispatch } from "../state/AppState";
import { PromptPreview } from "./PromptPreview";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
}));

const rtf: Framework = {
  id: "rtf",
  name: "RTF",
  description: "",
  template:
    "{{#role}}# Role\n{{role}}{{/role}}\n\n{{#task}}# Task\n{{task}}{{/task}}",
  summaryKey: null,
  isCustom: false,
  deletedAt: null,
  sections: [
    { key: "role", label: "Role", helpText: "" },
    { key: "task", label: "Task", helpText: "" },
  ],
  createdAt: 1,
  updatedAt: 1,
};

/** Edits a section through the reducer, standing in for the form. */
function Editor({ section }: { section: string }) {
  const dispatch = useAppDispatch();
  return (
    <input
      aria-label={section}
      onChange={(event) =>
        dispatch({
          type: "editSection",
          key: section,
          value: event.target.value,
        })
      }
    />
  );
}

const broken: Framework = {
  ...rtf,
  id: "broken",
  name: "Broken",
  template: "{{#role}} never closed",
};

/** Switches to another framework through the reducer, standing in for the picker. */
function Switch({ to }: { to: string }) {
  const dispatch = useAppDispatch();
  return (
    <button onClick={() => dispatch({ type: "selectFramework", id: to })}>
      switch to {to}
    </button>
  );
}

async function renderPreview(actions?: ReactNode) {
  vi.mocked(listFrameworks).mockResolvedValue([rtf, broken]);
  render(
    <AppStateProvider>
      <PromptPreview actions={actions} />
      <Editor section="role" />
      <Editor section="task" />
      <Switch to="broken" />
      <Switch to="rtf" />
    </AppStateProvider>,
  );
  return screen.findByRole("region", { name: "Preview" });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("PromptPreview", () => {
  it("invites the user to fill in a section while every section is blank", async () => {
    const region = await renderPreview();

    expect(region).toHaveTextContent("Fill in a section to see the prompt.");
    expect(within(region).queryByTestId("rendered-prompt")).toBeNull();
  });

  it("renders the template with the draft and follows every keystroke", async () => {
    const region = await renderPreview();

    await userEvent.type(screen.getByRole("textbox", { name: "role" }), "a");
    expect(within(region).getByTestId("rendered-prompt")).toHaveTextContent(
      /^# Role a$/,
    );

    await userEvent.type(screen.getByRole("textbox", { name: "task" }), "go");
    const rendered = within(region).getByTestId("rendered-prompt");
    expect(rendered.textContent).toBe("# Role\na\n\n# Task\ngo");
  });

  it("goes back to the invitation when the draft is emptied again", async () => {
    const region = await renderPreview();
    const role = screen.getByRole("textbox", { name: "role" });
    await userEvent.type(role, "a");

    await userEvent.clear(role);

    expect(region).toHaveTextContent("Fill in a section to see the prompt.");
  });

  it("follows a switch to another framework and back", async () => {
    const region = await renderPreview();
    await userEvent.type(screen.getByRole("textbox", { name: "role" }), "a");

    await userEvent.click(
      screen.getByRole("button", { name: "switch to broken" }),
    );
    expect(region).toHaveTextContent("Fill in a section to see the prompt.");

    await userEvent.click(
      screen.getByRole("button", { name: "switch to rtf" }),
    );
    expect(within(region).getByTestId("rendered-prompt")).toHaveTextContent(
      /^# Role a$/,
    );
  });

  it("shows the invitation rather than throwing when the template does not parse", async () => {
    const region = await renderPreview();
    await userEvent.click(
      screen.getByRole("button", { name: "switch to broken" }),
    );

    await userEvent.type(screen.getByRole("textbox", { name: "role" }), "a");

    expect(region).toHaveTextContent("Fill in a section to see the prompt.");
    expect(within(region).queryByTestId("rendered-prompt")).toBeNull();
  });

  it("places the actions in its header next to the title", async () => {
    const region = await renderPreview(<button>Copy</button>);

    expect(
      within(region).getByRole("heading", { name: "Preview" }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
  });

  it("renders nothing until a framework is selected", () => {
    vi.mocked(listFrameworks).mockReturnValue(new Promise(() => {}));
    render(
      <AppStateProvider>
        <PromptPreview />
      </AppStateProvider>,
    );

    expect(screen.queryByRole("region")).toBeNull();
  });
});
