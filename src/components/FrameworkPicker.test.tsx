import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listFrameworks } from "../api";
import type { Framework } from "../bindings/Framework";
import { AppStateProvider, useAppState } from "../state/AppState";
import { FrameworkPicker } from "./FrameworkPicker";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
}));

function framework(id: string, name: string, description: string): Framework {
  return {
    id,
    name,
    description,
    template: "",
    summaryKey: null,
    isCustom: false,
    deletedAt: null,
    sections: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

const costar = framework("costar", "CO-STAR", "Six sections for writing.");
const rtf = framework("rtf", "RTF", "Three sections, quick requests.");

function Selected() {
  return <p>selected: {useAppState().selectedId ?? "none"}</p>;
}

async function renderPicker() {
  vi.mocked(listFrameworks).mockResolvedValue([costar, rtf]);
  render(
    <AppStateProvider>
      <FrameworkPicker />
      <Selected />
    </AppStateProvider>,
  );
  await screen.findByText("selected: costar");
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("FrameworkPicker", () => {
  it("shows the selected framework's name and description", async () => {
    await renderPicker();

    const trigger = screen.getByRole("combobox", { name: "Framework" });
    expect(trigger).toHaveTextContent("CO-STAR");
    expect(trigger).toHaveAccessibleDescription("Six sections for writing.");
  });

  it("selects another framework from the list", async () => {
    await renderPicker();
    const user = userEvent.setup();

    await user.click(screen.getByRole("combobox", { name: "Framework" }));
    await user.click(await screen.findByRole("option", { name: "RTF" }));

    expect(await screen.findByText("selected: rtf")).toBeInTheDocument();
    const trigger = screen.getByRole("combobox", { name: "Framework" });
    expect(trigger).toHaveTextContent("RTF");
    expect(trigger).toHaveAccessibleDescription(
      "Three sections, quick requests.",
    );
  });

  it("selects another framework with the keyboard", async () => {
    await renderPicker();
    const user = userEvent.setup();

    await user.tab();
    expect(screen.getByRole("combobox", { name: "Framework" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("option", { name: "RTF" });
    await user.keyboard("{ArrowDown}{Enter}");

    expect(await screen.findByText("selected: rtf")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Framework" })).toHaveFocus();
  });

  it("omits the description when the framework has none", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([
      framework("bare", "Bare", ""),
    ]);
    render(
      <AppStateProvider>
        <FrameworkPicker />
      </AppStateProvider>,
    );

    const trigger = await screen.findByRole("combobox", { name: "Framework" });
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  it("renders nothing until the frameworks are loaded", () => {
    vi.mocked(listFrameworks).mockReturnValue(new Promise(() => {}));
    render(
      <AppStateProvider>
        <FrameworkPicker />
      </AppStateProvider>,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
