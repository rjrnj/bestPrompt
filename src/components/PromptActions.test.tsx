import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  latestEntryProject,
  listFrameworks,
  listProjects,
  savePromptEntry,
} from "../api";
import type { Framework } from "../bindings/Framework";
import type { PromptEntry } from "../bindings/PromptEntry";
import { writeText } from "../clipboard";
import { AppStateProvider } from "../state/AppState";
import { PromptActions } from "./PromptActions";
import { PromptForm } from "./PromptForm";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  savePromptEntry: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
}));
vi.mock("../clipboard", () => ({ writeText: vi.fn() }));

const rtf: Framework = {
  id: "rtf",
  name: "RTF",
  description: "",
  template:
    "{{#role}}# Role\n{{role}}{{/role}}\n\n{{#task}}# Task\n{{task}}{{/task}}",
  summaryKey: null,
  isCustom: false,
  sections: [
    { key: "role", label: "Role", helpText: "" },
    { key: "task", label: "Task", helpText: "" },
  ],
  createdAt: 1,
  updatedAt: 1,
};

const broken: Framework = {
  ...rtf,
  template: "{{#role}} never closed",
};

async function renderActions(framework: Framework = rtf) {
  vi.mocked(listFrameworks).mockResolvedValue([framework]);
  render(
    <AppStateProvider>
      <PromptForm />
      <PromptActions />
    </AppStateProvider>,
  );
  return {
    copy: await screen.findByRole("button", { name: "Copy" }),
    save: screen.getByRole("button", { name: "Save" }),
    clear: screen.getByRole("button", { name: "Clear" }),
    role: screen.getByRole("textbox", { name: "Role" }),
    task: screen.getByRole("textbox", { name: "Task" }),
  };
}

function stored(): PromptEntry {
  return {
    id: "entry",
    frameworkId: "rtf",
    frameworkSnapshot: {
      name: rtf.name,
      template: rtf.template,
      summaryKey: rtf.summaryKey,
      sections: rtf.sections,
    },
    sectionValues: {},
    renderedPrompt: "",
    title: null,
    projectId: null,
    createdAt: 1,
  };
}

beforeEach(() => {
  vi.mocked(listProjects).mockResolvedValue([]);
  vi.mocked(latestEntryProject).mockResolvedValue(null);
});

afterEach(() => {
  vi.resetAllMocks();
});

// The buttons are marked unavailable with aria-disabled rather than
// disabled, so a button that becomes unavailable while focused keeps focus.
function expectOff(...buttons: HTMLElement[]) {
  for (const button of buttons) {
    expect(button).toHaveAttribute("aria-disabled", "true");
  }
}

function expectOn(...buttons: HTMLElement[]) {
  for (const button of buttons) {
    expect(button).not.toHaveAttribute("aria-disabled", "true");
  }
}

describe("PromptActions", () => {
  it("marks every button unavailable while the draft is empty", async () => {
    const { copy, save, clear } = await renderActions();

    expectOff(copy, save, clear);
  });

  it("ignores Copy and Save while they are unavailable", async () => {
    const { copy, save } = await renderActions();

    await userEvent.click(copy);
    await userEvent.click(save);

    expect(writeText).not.toHaveBeenCalled();
    expect(savePromptEntry).not.toHaveBeenCalled();
  });

  it("offers every button once a section has text", async () => {
    const { copy, save, clear, role } = await renderActions();

    await userEvent.type(role, "a reviewer");

    expectOn(copy, save, clear);
  });

  it("offers only Clear for a draft of whitespace", async () => {
    const { copy, save, clear, role } = await renderActions();

    await userEvent.type(role, "   ");

    expectOff(copy, save);
    expectOn(clear);
  });

  it("offers only Clear when the template renders nothing", async () => {
    const { copy, save, clear, role } = await renderActions(broken);

    await userEvent.type(role, "a reviewer");

    expectOff(copy, save);
    expectOn(clear);
  });

  it("clears the draft and keeps focus on Clear", async () => {
    const { clear, role } = await renderActions();
    await userEvent.type(role, "a reviewer");

    await userEvent.click(clear);

    expect(role).toHaveValue("");
    expectOff(clear);
    expect(clear).toHaveFocus();
  });

  it("copies the rendered prompt and saves it with every section", async () => {
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry).mockResolvedValue(stored());
    const { copy, role } = await renderActions();
    await userEvent.type(role, "a reviewer");

    await userEvent.click(copy);

    expect(writeText).toHaveBeenCalledWith("# Role\na reviewer");
    expect(savePromptEntry).toHaveBeenCalledExactlyOnceWith({
      frameworkId: "rtf",
      sectionValues: { role: "a reviewer", task: "" },
      renderedPrompt: "# Role\na reviewer",
      title: null,
      projectId: null,
    });
  });

  it("saves under the selected project", async () => {
    vi.mocked(savePromptEntry).mockResolvedValue(stored());
    vi.mocked(listProjects).mockResolvedValue([
      { id: "p-api", name: "api", createdAt: 1, updatedAt: 1 },
    ]);
    vi.mocked(latestEntryProject).mockResolvedValue("p-api");
    const { save, role } = await renderActions();
    await userEvent.type(role, "a reviewer");
    await vi.waitFor(() => expect(latestEntryProject).toHaveBeenCalled());

    await userEvent.click(save);

    expect(savePromptEntry).toHaveBeenCalledWith(
      expect.objectContaining({ title: null, projectId: "p-api" }),
    );
  });

  it("saves without copying", async () => {
    vi.mocked(savePromptEntry).mockResolvedValue(stored());
    const { save, task } = await renderActions();
    await userEvent.type(task, "review this");

    await userEvent.click(save);

    expect(writeText).not.toHaveBeenCalled();
    expect(savePromptEntry).toHaveBeenCalledExactlyOnceWith({
      frameworkId: "rtf",
      sectionValues: { role: "", task: "review this" },
      renderedPrompt: "# Task\nreview this",
      title: null,
      projectId: null,
    });
  });

  it("marks Copy and Save unavailable while a save is running", async () => {
    let finish!: (entry: PromptEntry) => void;
    vi.mocked(savePromptEntry).mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    const { copy, save, clear, role } = await renderActions();
    await userEvent.type(role, "a reviewer");

    await userEvent.click(save);

    expectOff(copy, save);
    expectOn(clear);
    expect(save).toHaveFocus();
    await act(async () => finish(stored()));
    expectOn(save);
  });
});
