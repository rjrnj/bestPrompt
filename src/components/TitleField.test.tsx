import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { latestEntryProject, listFrameworks, listProjects } from "../api";
import type { Framework } from "../bindings/Framework";
import { AppStateProvider, useAppState } from "../state/AppState";
import { currentTitle } from "../state/reducer";
import { TitleField } from "./TitleField";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
}));

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

function Title() {
  return <p>title: [{currentTitle(useAppState())}]</p>;
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("TitleField", () => {
  it("is labelled and updates the title", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([rtf]);
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(latestEntryProject).mockResolvedValue(null);
    render(
      <AppStateProvider>
        <TitleField />
        <Title />
      </AppStateProvider>,
    );
    const field = await screen.findByRole("textbox", { name: "Title" });
    expect(field).toHaveAccessibleDescription(
      "Optional. Names the prompt in History; it isn't part of the prompt.",
    );
    expect(field).toHaveValue("");

    await userEvent.type(field, "Release notes");

    expect(screen.getByText("title: [Release notes]")).toBeInTheDocument();
    expect(field).toHaveValue("Release notes");
  });
});
