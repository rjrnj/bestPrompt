import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import builtins from "../src-tauri/builtins/frameworks.json";
import App from "./App";
import {
  ApiError,
  deletePromptEntry,
  latestEntryProject,
  listFrameworks,
  listProjects,
  listPromptEntries,
  savePromptEntry,
} from "./api";
import type { Framework } from "./bindings/Framework";
import type { PromptEntry } from "./bindings/PromptEntry";
import { writeText } from "./clipboard";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listFrameworks: vi.fn(),
  savePromptEntry: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  listPromptEntries: vi.fn(),
  deletePromptEntry: vi.fn(),
}));
vi.mock("./clipboard", () => ({ writeText: vi.fn() }));

/** The built-ins as the backend would return them. */
const frameworks: Framework[] = builtins.map((f) => ({
  id: f.id,
  name: f.name,
  description: f.description,
  template: f.template,
  summaryKey: f.summaryKey,
  sections: f.sections,
  isCustom: false,
  deletedAt: null,
  createdAt: 1,
  updatedAt: 1,
}));

beforeEach(() => {
  vi.mocked(listProjects).mockResolvedValue([]);
  vi.mocked(latestEntryProject).mockResolvedValue(null);
  vi.mocked(listPromptEntries).mockResolvedValue([]);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("App", () => {
  it("announces that the frameworks are loading", () => {
    vi.mocked(listFrameworks).mockReturnValue(new Promise(() => {}));

    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading frameworks");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "bestPrompt",
    );
  });

  it("shows the error panel when the frameworks cannot be loaded", async () => {
    vi.mocked(listFrameworks).mockRejectedValue(
      new ApiError("database", "no db"),
    );

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("no db");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows the picker, the form and the preview once loaded", async () => {
    vi.mocked(listFrameworks).mockResolvedValue(frameworks);

    render(<App />);

    const picker = await screen.findByRole("combobox", { name: "Framework" });
    expect(picker).toHaveTextContent("CO-STAR");
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent(
      "No project",
    );
    // The title, then CO-STAR's six sections.
    expect(screen.getAllByRole("textbox")).toHaveLength(7);
    expect(screen.getByRole("region", { name: "Preview" })).toHaveTextContent(
      "Fill in a section to see the prompt.",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("hides the Builder's pickers on the History tab", async () => {
    vi.mocked(listFrameworks).mockResolvedValue(frameworks);
    render(<App />);
    await screen.findByRole("combobox", { name: "Framework" });
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "History" }));

    expect(
      within(screen.getByRole("banner")).queryByRole("combobox"),
    ).toBeNull();
    expect(screen.queryByText(builtins[0].description)).toBeNull();
    expect(screen.queryByRole("region", { name: "Preview" })).toBeNull();
    expect(screen.getByRole("tabpanel", { name: "History" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Builder" }));

    expect(
      screen.getByRole("combobox", { name: "Framework" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Project" }),
    ).toBeInTheDocument();
  });

  it("renders what is typed through the framework's template", async () => {
    vi.mocked(listFrameworks).mockResolvedValue(frameworks);
    render(<App />);
    await screen.findByRole("combobox", { name: "Framework" });

    await userEvent.type(
      screen.getByRole("textbox", { name: "Objective" }),
      "Write a README section.",
    );

    const preview = screen.getByRole("region", { name: "Preview" });
    expect(within(preview).getByTestId("rendered-prompt").textContent).toBe(
      "# Objective\nWrite a README section.",
    );
  });

  it("copies and saves from the preview's buttons, with a toast", async () => {
    vi.mocked(listFrameworks).mockResolvedValue(frameworks);
    vi.mocked(writeText).mockResolvedValue();
    vi.mocked(savePromptEntry).mockImplementation(
      async (entry) =>
        ({
          ...entry,
          id: "entry",
          frameworkSnapshot: {
            name: "CO-STAR",
            template: "",
            summaryKey: null,
            sections: [],
          },
          createdAt: 1,
          version: 0,
        }) satisfies PromptEntry,
    );
    render(<App />);
    await screen.findByRole("combobox", { name: "Framework" });
    await userEvent.type(
      screen.getByRole("textbox", { name: "Objective" }),
      "Write a README section.",
    );

    const preview = screen.getByRole("region", { name: "Preview" });
    await userEvent.click(
      within(preview).getByRole("button", { name: "Copy" }),
    );

    expect(writeText).toHaveBeenCalledWith(
      "# Objective\nWrite a README section.",
    );
    // The toast is added once the save resolves, after the click, and Radix
    // portals it into the viewport a render later still. The Toaster mounts
    // with the first toast, so the region is awaited too.
    const notifications = await screen.findByRole("region", {
      name: /notifications/i,
    });
    expect(
      await within(notifications).findByText("Copied and saved"),
    ).toBeInTheDocument();
  });

  it("copying_the_opened_prompt_unchanged_saves_nothing", async () => {
    vi.mocked(listFrameworks).mockResolvedValue(frameworks);
    vi.mocked(writeText).mockResolvedValue();
    const costar = frameworks[0];
    const entry: PromptEntry = {
      id: "e1",
      frameworkId: costar.id,
      frameworkSnapshot: {
        name: costar.name,
        template: costar.template,
        summaryKey: costar.summaryKey,
        sections: costar.sections,
      },
      sectionValues: { objective: "Write a README section." },
      renderedPrompt: "# Objective\nWrite a README section.",
      title: null,
      projectId: null,
      createdAt: 1,
      version: 0,
    };
    vi.mocked(listPromptEntries).mockResolvedValue([entry]);
    render(<App />);
    await screen.findByRole("combobox", { name: "Framework" });
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(
      await screen.findByRole("button", { name: /Write a README section/ }),
    );
    await user.click(screen.getByRole("button", { name: "Open in Builder" }));

    expect(
      await screen.findByRole("textbox", { name: "Objective" }),
    ).toHaveValue("Write a README section.");
    const preview = screen.getByRole("region", { name: "Preview" });
    await user.click(within(preview).getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(entry.renderedPrompt);
    const notifications = await screen.findByRole("region", {
      name: /notifications/i,
    });
    expect(
      await within(notifications).findByText("Copied"),
    ).toBeInTheDocument();
    expect(savePromptEntry).not.toHaveBeenCalled();
  });

  it("opening a saved prompt puts focus in the Builder's title", async () => {
    vi.mocked(listFrameworks).mockResolvedValue(frameworks);
    const costar = frameworks[0];
    const entry: PromptEntry = {
      id: "e1",
      frameworkId: costar.id,
      frameworkSnapshot: {
        name: costar.name,
        template: costar.template,
        summaryKey: costar.summaryKey,
        sections: costar.sections,
      },
      sectionValues: { objective: "Write a README section." },
      renderedPrompt: "# Objective\nWrite a README section.",
      title: "Readme",
      projectId: null,
      createdAt: 1,
      version: 0,
    };
    vi.mocked(listPromptEntries).mockResolvedValue([entry]);
    render(<App />);
    await screen.findByRole("combobox", { name: "Framework" });
    const user = userEvent.setup();
    const openFromHistory = async () => {
      await user.click(screen.getByRole("tab", { name: "History" }));
      await user.click(await screen.findByRole("button", { name: /^Readme/ }));
      await user.click(screen.getByRole("button", { name: "Open in Builder" }));
    };
    /** The title has focus, and still has it once pending focus moves ran. */
    const expectTitleFocused = async () => {
      const title = screen.getByRole("textbox", { name: "Title" });
      await waitFor(() => expect(title).toHaveFocus());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(title).toHaveFocus();
    };

    await openFromHistory();
    await expectTitleFocused();

    // The draft now has text, so opening again asks first.
    await openFromHistory();
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Open",
      }),
    );
    await expectTitleFocused();
  });

  it("saves again after the saved entry is deleted in History", async () => {
    vi.mocked(listFrameworks).mockResolvedValue(frameworks);
    vi.mocked(deletePromptEntry).mockResolvedValue();
    const costar = frameworks[0];
    vi.mocked(savePromptEntry).mockImplementation(
      async (entry) =>
        ({
          ...entry,
          id: "entry",
          frameworkSnapshot: {
            name: costar.name,
            template: costar.template,
            summaryKey: costar.summaryKey,
            sections: costar.sections,
          },
          createdAt: 1,
          version: 0,
        }) satisfies PromptEntry,
    );
    render(<App />);
    await screen.findByRole("combobox", { name: "Framework" });
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Objective" }),
      "Write a README section.",
    );
    const save = () =>
      user.click(
        within(screen.getByRole("region", { name: "Preview" })).getByRole(
          "button",
          { name: "Save" },
        ),
      );
    await save();
    const notifications = await screen.findByRole("region", {
      name: /notifications/i,
    });
    expect(await within(notifications).findByText("Saved")).toBeInTheDocument();
    const saved = await vi.mocked(savePromptEntry).mock.results[0].value;
    vi.mocked(listPromptEntries).mockResolvedValue([saved]);

    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(
      await screen.findByRole("button", { name: /Write a README section/ }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() =>
      expect(deletePromptEntry).toHaveBeenCalledWith("entry"),
    );
    await user.click(screen.getByRole("tab", { name: "Builder" }));
    await save();

    await waitFor(() => expect(savePromptEntry).toHaveBeenCalledTimes(2));
    expect(within(notifications).queryByText("Already saved")).toBeNull();
    expect(within(notifications).getAllByText("Saved")).not.toHaveLength(0);
  });

  it("shows an error toast and keeps the draft when the save fails", async () => {
    vi.mocked(listFrameworks).mockResolvedValue(frameworks);
    vi.mocked(savePromptEntry).mockRejectedValue(
      new ApiError("database", "disk full"),
    );
    render(<App />);
    await screen.findByRole("combobox", { name: "Framework" });
    const objective = screen.getByRole("textbox", { name: "Objective" });
    await userEvent.type(objective, "Write a README section.");

    const preview = screen.getByRole("region", { name: "Preview" });
    const save = within(preview).getByRole("button", { name: "Save" });
    await userEvent.click(save);

    // The Toaster mounts with the first toast, so the region is awaited too.
    const notifications = await screen.findByRole("region", {
      name: /notifications/i,
    });
    expect(
      await within(notifications).findByText("Couldn't save: disk full"),
    ).toBeInTheDocument();
    expect(objective).toHaveValue("Write a README section.");
    expect(save).not.toHaveAttribute("aria-disabled", "true");
    expect(writeText).not.toHaveBeenCalled();
  });
});
