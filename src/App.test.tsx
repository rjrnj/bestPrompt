import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import builtins from "../src-tauri/builtins/frameworks.json";
import App from "./App";
import { ApiError, listFrameworks, savePromptEntry } from "./api";
import type { Framework } from "./bindings/Framework";
import type { PromptEntry } from "./bindings/PromptEntry";
import { writeText } from "./clipboard";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listFrameworks: vi.fn(),
  savePromptEntry: vi.fn(),
}));
vi.mock("./clipboard", () => ({ writeText: vi.fn() }));

/** The built-ins as the backend would return them. */
const frameworks: Framework[] = builtins.map((f) => ({
  id: f.id,
  name: f.name,
  description: f.description,
  template: f.template,
  sections: f.sections,
  isCustom: false,
  createdAt: 1,
  updatedAt: 1,
}));

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
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
    expect(screen.getByRole("region", { name: "Preview" })).toHaveTextContent(
      "Fill in a section to see the prompt.",
    );
    expect(screen.queryByRole("status")).toBeNull();
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
          frameworkSnapshot: { name: "CO-STAR", template: "", sections: [] },
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
    const notifications = screen.getByRole("region", {
      name: /notifications/i,
    });
    // The toast is added once the save resolves, after the click, and Radix
    // portals it into the viewport a render later still.
    expect(
      await within(notifications).findByText("Copied and saved"),
    ).toBeInTheDocument();
  });
});
