import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import builtins from "../src-tauri/builtins/frameworks.json";
import App from "./App";
import {
  ApiError,
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

    expect(screen.queryByRole("combobox")).toBeNull();
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
