import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import builtins from "../../../src-tauri/builtins/frameworks.json";
import {
  createFramework,
  deleteFramework,
  latestEntryProject,
  listFrameworks,
  listProjects,
  updateFramework,
} from "../../api";
import type { Framework } from "../../bindings/Framework";
import type { FrameworkInput } from "../../bindings/FrameworkInput";
import { autoTemplate } from "../../frameworks/autoTemplate";
import { AppStateProvider, useAppDispatch } from "../../state/AppState";
import { AppTabs } from "../AppTabs";
import { FrameworkPicker } from "../FrameworkPicker";
import { PromptForm } from "../PromptForm";
import { FrameworksView } from "./FrameworksView";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  createFramework: vi.fn(),
  updateFramework: vi.fn(),
  deleteFramework: vi.fn(),
}));

/** The built-ins as the backend would return them. */
const builtIns: Framework[] = builtins.map((f) => ({
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
const risen = builtIns.find((f) => f.id === "risen")!;

const mineSections = [
  { key: "a", label: "Alpha", helpText: "" },
  { key: "b", label: "Beta", helpText: "" },
  { key: "c", label: "Gamma", helpText: "" },
];
const mine: Framework = {
  id: "0192f000-0000-7000-8000-0000000000aa",
  name: "Mine",
  description: "My own.",
  template: autoTemplate(mineSections),
  summaryKey: "a",
  sections: mineSections,
  isCustom: true,
  deletedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

const NEW_ID = "0192f000-0000-7000-8000-0000000000bb";

function stored(id: string, input: FrameworkInput): Framework {
  return {
    id,
    ...input,
    isCustom: true,
    deletedAt: null,
    createdAt: 2,
    updatedAt: 2,
  };
}

type Seed = { id: string; texts: Record<string, string> };

/** Selects `id` in the Builder and types each of `texts` into its section. */
function SeedDraft({ id, texts }: Seed) {
  const dispatch = useAppDispatch();
  return (
    <button
      type="button"
      onClick={() => {
        dispatch({ type: "selectFramework", id });
        for (const [key, value] of Object.entries(texts)) {
          dispatch({ type: "editSection", key, value });
        }
      }}
    >
      Type a draft
    </button>
  );
}

/**
 * The tabs with the real Frameworks view. The Builder is a stand-in, plus
 * the real form when a draft is seeded.
 */
function renderTabs(seed?: Seed) {
  render(
    <AppStateProvider>
      <AppTabs
        builderTools={<FrameworkPicker />}
        builder={
          <>
            <p>builder pane</p>
            {seed && (
              <>
                <SeedDraft {...seed} />
                <PromptForm />
              </>
            )}
          </>
        }
        history={<p>history pane</p>}
        frameworks={<FrameworksView />}
      />
    </AppStateProvider>,
  );
}

async function openFrameworksTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "Frameworks" }));
  await screen.findByRole("button", { name: "Mine" });
}

function nameField() {
  return screen.getByRole("textbox", { name: "Name" });
}

function labelValues() {
  return screen
    .getAllByRole<HTMLInputElement>("textbox", { name: "Label" })
    .map((field) => field.value);
}

/** The section row whose label field shows `label`. */
function rowOf(label: string): HTMLElement {
  return screen.getByDisplayValue(label).closest("li")!;
}

beforeEach(() => {
  vi.mocked(listFrameworks).mockResolvedValue([...builtIns, mine]);
  vi.mocked(listProjects).mockResolvedValue([]);
  vi.mocked(latestEntryProject).mockResolvedValue(null);
  vi.mocked(createFramework).mockImplementation(async (input) =>
    stored(NEW_ID, input),
  );
  vi.mocked(updateFramework).mockImplementation(async (id, input) =>
    stored(id, input),
  );
  vi.mocked(deleteFramework).mockImplementation(async () => ({
    ...mine,
    deletedAt: 3,
  }));
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("FrameworksView", () => {
  it("shows_a_frameworks_tab", async () => {
    renderTabs();
    const user = userEvent.setup();

    await openFrameworksTab(user);

    expect(screen.getByRole("tab", { name: "Frameworks" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const builtIn = within(screen.getByRole("list", { name: "Built-in" }));
    expect(builtIn.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "CO-STAR",
      "RISEN",
      "RACE",
      "RTF",
    ]);
    const yours = within(screen.getByRole("list", { name: "Yours" }));
    expect(yours.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Mine",
    ]);
    // Nothing is selected on a first visit: a hint and New framework.
    expect(
      screen.getByText(/Select a framework to see it/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New framework" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    // The Builder's pickers are not shown here.
    expect(
      within(screen.getByRole("banner")).queryByRole("combobox"),
    ).toBeNull();
  });

  it("built_ins_are_read_only_with_make_a_copy", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);

    await user.click(screen.getByRole("button", { name: "RISEN" }));

    expect(screen.getByRole("button", { name: "RISEN" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(nameField()).toHaveValue("RISEN");
    expect(nameField()).toHaveAttribute("readonly");
    expect(
      screen.getByRole("textbox", { name: "Description" }),
    ).toHaveAttribute("readonly");
    expect(labelValues()).toEqual([
      "Role",
      "Instructions",
      "Steps",
      "End goal",
      "Narrowing",
    ]);
    for (const field of screen.getAllByRole("textbox", { name: "Label" })) {
      expect(field).toHaveAttribute("readonly");
    }
    expect(
      within(rowOf("Instructions")).getByText("Used for History labels"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Make a copy" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add section" })).toBeNull();
  });

  it("new_framework_can_be_named_given_sections_and_saved", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);

    await user.click(screen.getByRole("button", { name: "New framework" }));

    expect(nameField()).toHaveValue("");
    expect(nameField()).toHaveFocus();
    expect(labelValues()).toEqual([""]);
    await user.type(nameField(), "Review");
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "For reviews.",
    );
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Goal");
    await user.type(
      screen.getByRole("textbox", { name: "Help text" }),
      "What you want",
    );
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const labels = screen.getAllByRole("textbox", { name: "Label" });
    expect(labels[1]).toHaveFocus();
    await user.keyboard("Code{Enter}");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const sections = [
      { key: "goal", label: "Goal", helpText: "What you want" },
      { key: "code", label: "Code", helpText: "" },
    ];
    expect(createFramework).toHaveBeenCalledWith({
      name: "Review",
      description: "For reviews.",
      template: autoTemplate(sections),
      summaryKey: "goal",
      sections,
    });
    expect(updateFramework).not.toHaveBeenCalled();
    // The saved framework is listed under Yours and selected.
    const yours = within(screen.getByRole("list", { name: "Yours" }));
    expect(
      await yours.findByRole("button", { name: "Review" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Delete Review" }),
    ).toBeInTheDocument();
  });

  it("a_label_still_being_typed_is_saved", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "New framework" }));
    await user.type(nameField(), "Review");
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Goal");

    // A click that doesn't move focus, so the label is never blurred.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(createFramework).toHaveBeenCalledWith(
        expect.objectContaining({
          summaryKey: "goal",
          sections: [{ key: "goal", label: "Goal", helpText: "" }],
        }),
      ),
    );
  });

  it("a_saved_framework_appears_in_the_builder_picker", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);

    await user.click(screen.getByRole("button", { name: "New framework" }));
    await user.type(nameField(), "Review");
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Goal");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Delete Review" });

    // Saved, so leaving doesn't ask.
    await user.click(screen.getByRole("tab", { name: "Builder" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Framework" }));

    expect(
      await screen.findByRole("option", { name: "Review" }),
    ).toBeInTheDocument();
  });

  it("save_is_blocked_with_inline_errors", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);

    await user.click(screen.getByRole("button", { name: "New framework" }));

    // A fresh form shows no errors until Save is tried.
    expect(screen.queryByText("Give the framework a name.")).toBeNull();
    expect(screen.queryByText("Give the section a label.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(createFramework).not.toHaveBeenCalled();
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(nameField()).toHaveAccessibleDescription(
      "Give the framework a name.",
    );
    expect(
      screen.getByRole("textbox", { name: "Label" }),
    ).toHaveAccessibleDescription("Give the section a label.");
    expect(screen.getByText("Add at least one section.")).toBeInTheDocument();

    // Errors follow the edits once shown.
    await user.type(nameField(), "mine");
    expect(nameField()).toHaveAccessibleDescription(
      "Another framework already has this name.",
    );
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Goal");
    await user.tab();
    expect(screen.queryByText("Give the section a label.")).toBeNull();
    expect(screen.queryByText("Add at least one section.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(createFramework).not.toHaveBeenCalled();
  });

  it("copying_a_builtin_opens_an_unsaved_copy_named_copy", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "RISEN" }));

    await user.click(screen.getByRole("button", { name: "Make a copy" }));

    expect(nameField()).toHaveValue("RISEN (copy)");
    expect(nameField()).not.toHaveAttribute("readonly");
    expect(nameField()).toHaveFocus();
    // Unsaved: nothing in the list is selected and it can't be deleted.
    expect(screen.getByRole("button", { name: "RISEN" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
    expect(
      within(rowOf("Instructions")).getByText("Used for History labels"),
    ).toBeInTheDocument();
    expect(createFramework).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(createFramework).toHaveBeenCalledWith({
      name: "RISEN (copy)",
      description: risen.description,
      template: risen.template,
      summaryKey: "instructions",
      sections: risen.sections,
    });
  });

  it("copy_of_a_custom_framework_is_labelled_copy", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "Mine" }));

    expect(screen.queryByRole("button", { name: "Make a copy" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(nameField()).toHaveValue("Mine (copy)");
  });

  it("moving_a_section_down_by_keyboard_reorders_it", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "Mine" }));
    expect(labelValues()).toEqual(["Alpha", "Beta", "Gamma"]);

    screen.getByRole("button", { name: "Move Alpha down" }).focus();
    await user.keyboard("{Enter}");

    expect(labelValues()).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(
      screen.getByRole("button", { name: "Move Alpha down" }),
    ).toHaveFocus();

    await user.keyboard(" ");
    expect(labelValues()).toEqual(["Beta", "Gamma", "Alpha"]);
    const atEnd = screen.getByRole("button", { name: "Move Alpha down" });
    expect(atEnd).toHaveFocus();
    expect(atEnd).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("button", { name: "Move Beta up" }),
    ).toHaveAttribute("aria-disabled", "true");

    // The ends ignore clicks.
    await user.keyboard("{Enter}");
    expect(labelValues()).toEqual(["Beta", "Gamma", "Alpha"]);

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateFramework).toHaveBeenCalledWith(
      mine.id,
      expect.objectContaining({
        sections: [mineSections[1], mineSections[2], mineSections[0]],
        summaryKey: "a",
      }),
    );
  });

  it("removing_a_section_with_draft_text_asks_first", async () => {
    renderTabs({ id: mine.id, texts: { a: "kept text", b: "some text" } });
    const user = userEvent.setup();
    await screen.findByRole("combobox", { name: "Framework" });
    await user.click(screen.getByRole("button", { name: "Type a draft" }));
    const builder = screen.getByRole("tabpanel", { name: "Builder" });
    const alpha = screen.getByRole("textbox", { name: "Alpha" });
    expect(alpha).toHaveValue("kept text");
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "Mine" }));

    await user.click(screen.getByRole("button", { name: "Remove Beta" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Remove sections with draft text?");
    expect(dialog).toHaveTextContent(
      "Your Mine draft has text in Beta. Saving will discard it.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(updateFramework).not.toHaveBeenCalled();
    expect(labelValues()).toEqual(["Alpha", "Gamma"]);

    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Save",
      }),
    );

    expect(updateFramework).toHaveBeenCalledWith(
      mine.id,
      expect.objectContaining({
        sections: [mineSections[0], mineSections[2]],
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Beta", hidden: true }),
      ).toBeNull(),
    );

    // The Builder was not remounted: the same form, with the kept text and
    // without the removed section.
    await user.click(screen.getByRole("tab", { name: "Builder" }));
    expect(screen.getByRole("tabpanel", { name: "Builder" })).toBe(builder);
    expect(screen.getByRole("textbox", { name: "Alpha" })).toBe(alpha);
    expect(alpha).toHaveValue("kept text");
    expect(screen.queryByRole("textbox", { name: "Beta" })).toBeNull();
  });

  it("removing_a_section_without_draft_text_saves_at_once", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "Mine" }));

    await user.click(screen.getByRole("button", { name: "Remove Beta" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(updateFramework).toHaveBeenCalledTimes(1);
  });

  it("delete_confirms_and_mentions_history_and_the_draft", async () => {
    renderTabs({ id: mine.id, texts: { b: "some text" } });
    const user = userEvent.setup();
    await screen.findByRole("combobox", { name: "Framework" });
    await user.click(screen.getByRole("button", { name: "Type a draft" }));
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "Mine" }));

    await user.click(screen.getByRole("button", { name: "Delete Mine" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Delete Mine?");
    expect(dialog).toHaveTextContent("Its saved prompts stay in History.");
    expect(dialog).toHaveTextContent("Your Mine draft will be discarded.");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(deleteFramework).toHaveBeenCalledWith(mine.id);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Mine" })).toBeNull(),
    );
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(
      screen.getByText(/Select a framework to see it/),
    ).toBeInTheDocument();
  });

  it("delete_without_a_draft_does_not_mention_one", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "Mine" }));

    await user.click(screen.getByRole("button", { name: "Delete Mine" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).not.toHaveTextContent("draft");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(deleteFramework).not.toHaveBeenCalled();
    expect(nameField()).toHaveValue("Mine");
  });

  it("leaving_the_tab_with_unsaved_changes_asks_and_cancel_stays", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "Mine" }));
    await user.type(nameField(), " 2");

    await user.click(screen.getByRole("tab", { name: "Builder" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Discard changes to Mine 2?");
    expect(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    ).toHaveFocus();
    await user.click(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    );

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("tab", { name: "Frameworks" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(nameField()).toHaveValue("Mine 2");
  });

  it("keep_editing_returns_focus_to_what_asked", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "Mine" }));
    await user.type(nameField(), " 2");

    await user.click(screen.getByRole("button", { name: "RTF" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Keep editing",
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "RTF" })).toHaveFocus(),
    );
    expect(nameField()).toHaveValue("Mine 2");
  });

  it("discarding_for_new_puts_focus_in_name", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "Mine" }));
    await user.type(nameField(), " 2");

    await user.click(screen.getByRole("button", { name: "New framework" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Discard",
      }),
    );

    expect(nameField()).toHaveValue("");
    // Still there once the dialog has finished closing.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(nameField()).toHaveFocus();
  });

  it("cancelling_the_removal_question_returns_focus_to_save", async () => {
    renderTabs({ id: mine.id, texts: { b: "some text" } });
    const user = userEvent.setup();
    await screen.findByRole("combobox", { name: "Framework" });
    await user.click(screen.getByRole("button", { name: "Type a draft" }));
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "Mine" }));
    await user.click(screen.getByRole("button", { name: "Remove Beta" }));

    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toHaveFocus(),
    );
  });

  it("a_create_that_lands_after_new_leaves_the_new_editor_alone", async () => {
    let finish: () => void = () => {};
    vi.mocked(createFramework).mockImplementation(
      (input) =>
        new Promise((resolve) => {
          finish = () => resolve(stored(NEW_ID, input));
        }),
    );
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "New framework" }));
    await user.type(nameField(), "Review");
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Goal");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Still unsaved while the create is under way, so New asks.
    await user.click(screen.getByRole("button", { name: "New framework" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Discard",
      }),
    );
    expect(nameField()).toHaveValue("");
    finish();

    const yours = within(screen.getByRole("list", { name: "Yours" }));
    expect(
      await yours.findByRole("button", { name: "Review" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(nameField()).toHaveValue("");
    expect(labelValues()).toEqual([""]);
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
  });

  it("edits_made_while_saving_stay_unsaved_and_the_next_save_updates", async () => {
    let finish: () => void = () => {};
    vi.mocked(createFramework).mockImplementation(
      (input) =>
        new Promise((resolve) => {
          finish = () => resolve(stored(NEW_ID, input));
        }),
    );
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "New framework" }));
    await user.type(nameField(), "Review");
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Goal");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "Later",
    );
    finish();

    // Now the saved framework, with the later edit kept and still unsaved.
    expect(
      await screen.findByRole("button", { name: "Delete Review" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "Later",
    );
    await user.click(screen.getByRole("tab", { name: "Builder" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Keep editing",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(createFramework).toHaveBeenCalledTimes(1);
    expect(updateFramework).toHaveBeenCalledWith(
      NEW_ID,
      expect.objectContaining({ description: "Later" }),
    );
  });

  it("a_double_click_on_save_saves_once", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "New framework" }));
    await user.type(nameField(), "Review");
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Goal");

    await user.dblClick(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("button", { name: "Delete Review" });
    expect(createFramework).toHaveBeenCalledTimes(1);
  });

  it("selecting_another_framework_with_unsaved_changes_asks", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "New framework" }));
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Goal");

    await user.click(screen.getByRole("button", { name: "RTF" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Discard changes to this framework?");
    await user.click(within(dialog).getByRole("button", { name: "Discard" }));

    expect(nameField()).toHaveValue("RTF");
  });

  it("discarding_leaves_and_forgets_the_changes", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "Mine" }));
    await user.type(nameField(), " 2");

    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Discard",
      }),
    );

    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("history pane")).toBeVisible();

    await openFrameworksTab(user);
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Mine" }));
    expect(nameField()).toHaveValue("Mine");
    expect(updateFramework).not.toHaveBeenCalled();
  });

  it("the_summary_marker_can_move_to_another_section", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "Mine" }));
    expect(
      within(rowOf("Alpha")).getByText("Used for History labels"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Use for History labels: Gamma" }),
    );

    expect(
      within(rowOf("Gamma")).getByText("Used for History labels"),
    ).toBeInTheDocument();
    expect(
      within(rowOf("Alpha")).getByRole("button", {
        name: "Use for History labels: Alpha",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateFramework).toHaveBeenCalledWith(
      mine.id,
      expect.objectContaining({ summaryKey: "c" }),
    );
  });

  it("an_unused_section_warns_and_can_be_added_to_the_template", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([
      ...builtIns,
      { ...mine, template: "{{a}} and {{c}}" },
    ]);
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "Mine" }));

    expect(
      within(rowOf("Beta")).getByText(/Not in the template/),
    ).toBeVisible();
    expect(
      within(rowOf("Alpha")).queryByText(/Not in the template/),
    ).toBeNull();

    await user.click(
      within(rowOf("Beta")).getByRole("button", {
        name: "Add to end of template",
      }),
    );

    expect(within(rowOf("Beta")).queryByText(/Not in the template/)).toBeNull();
  });
});

/** Opens Mine in the Frameworks tab. */
async function openMine(user: ReturnType<typeof userEvent.setup>) {
  await openFrameworksTab(user);
  await user.click(screen.getByRole("button", { name: "Mine" }));
}

function templateField() {
  return screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Template",
  });
}

async function byHand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("radio", { name: "By hand" }));
}

describe("the template editor", () => {
  it("chip_inserts_the_placeholder_at_the_cursor", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openMine(user);
    await byHand(user);
    await user.clear(templateField());
    await user.type(templateField(), "XYZ");
    templateField().setSelectionRange(1, 2);

    await user.click(screen.getByRole("button", { name: "Insert Beta" }));

    expect(templateField()).toHaveValue("X{{b}}Z");
    expect(templateField().selectionStart).toBe(6);
    expect(templateField().selectionEnd).toBe(6);
    expect(templateField()).toHaveFocus();
  });

  it("adding_a_section_by_hand_shows_the_added_note", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openMine(user);
    await byHand(user);

    await user.click(screen.getByRole("button", { name: "Add section" }));
    await user.type(
      screen.getAllByRole("textbox", { name: "Label" })[3],
      "Delta",
    );
    await user.tab();

    expect(
      screen.getByText(
        "Delta was added to the end of the template. Move or reword it as you like.",
      ),
    ).toBeVisible();
    expect(
      templateField().value.endsWith("{{#delta}}# Delta\n{{delta}}{{/delta}}"),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Dismiss note" }));
    expect(screen.queryByText(/was added to the end/)).toBeNull();
  });

  it("sample_prompt_uses_draft_text_then_bracketed_labels", async () => {
    renderTabs({ id: mine.id, texts: { a: "hello" } });
    const user = userEvent.setup();
    await screen.findByRole("combobox", { name: "Framework" });
    await user.click(screen.getByRole("button", { name: "Type a draft" }));
    await openMine(user);
    await byHand(user);

    const sample = screen.getByTestId("sample-prompt");
    expect(sample.textContent).toBe(
      "# Alpha\nhello\n\n# Beta\n[Beta]\n\n# Gamma\n[Gamma]",
    );

    fireEvent.change(templateField(), { target: { value: "{{a" } });
    expect(screen.getByTestId("sample-prompt").textContent).toBe("");
    expect(screen.getByText("Fix the template to see a sample.")).toBeVisible();
  });

  it("template_errors_show_line_and_column", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openMine(user);
    await byHand(user);

    fireEvent.change(templateField(), { target: { value: "ab\n{{a" } });

    expect(
      screen.getByText("Tag is missing its closing }} (line 2, column 1)"),
    ).toBeVisible();
    expect(templateField()).toHaveAttribute("aria-invalid", "true");
  });

  it("reset_to_automatic_asks_then_replaces_the_template", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openMine(user);
    await byHand(user);
    fireEvent.change(templateField(), { target: { value: "{{a}} only" } });

    await user.click(
      screen.getByRole("button", { name: "Reset to automatic" }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByText("Your changes to the template will be lost."),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(templateField()).toHaveValue("{{a}} only");

    await user.click(
      screen.getByRole("button", { name: "Reset to automatic" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Reset",
      }),
    );

    expect(screen.queryByRole("textbox", { name: "Template" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Automatic" })).toBeChecked();
    await byHand(user);
    expect(templateField()).toHaveValue(autoTemplate(mineSections));
  });

  it("switching_to_automatic_with_an_unchanged_template_does_not_ask", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openMine(user);
    await byHand(user);

    await user.click(screen.getByRole("radio", { name: "Automatic" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Template" })).toBeNull();
  });

  it("a_built_in_shows_automatic_and_ignores_the_switch", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openFrameworksTab(user);
    await user.click(screen.getByRole("button", { name: "RISEN" }));

    const byHandItem = screen.getByRole("radio", { name: "By hand" });
    expect(screen.getByRole("radio", { name: "Automatic" })).toBeChecked();
    expect(byHandItem).toHaveAttribute("aria-disabled", "true");
    await user.click(byHandItem);
    expect(screen.queryByRole("textbox", { name: "Template" })).toBeNull();
  });

  it("a_spot_is_shown_after_removing_a_section_used_in_a_sentence", async () => {
    vi.mocked(listFrameworks).mockResolvedValue([
      ...builtIns,
      { ...mine, template: "Intro\nWrite about {{a}} well. {{b}} {{c}}" },
    ]);
    renderTabs();
    const user = userEvent.setup();
    await openMine(user);

    await user.click(screen.getByRole("button", { name: "Remove Alpha" }));

    expect(screen.getByText("Check the wording at line 2")).toBeVisible();
  });

  it("editing_back_to_the_generated_template_keeps_the_textarea_and_focus", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openMine(user);
    await byHand(user);

    await user.click(templateField());
    await user.keyboard("x");
    await user.keyboard("{Backspace}");

    expect(templateField()).toHaveValue(autoTemplate(mineSections));
    expect(templateField()).toHaveFocus();
  });

  it("a_chip_fills_an_empty_template_and_inserts_at_the_end", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openMine(user);
    await byHand(user);
    await user.clear(templateField());

    await user.click(screen.getByRole("button", { name: "Insert Alpha" }));
    expect(templateField()).toHaveValue("{{a}}");
    expect(templateField().selectionStart).toBe(5);

    await user.click(screen.getByRole("button", { name: "Insert Gamma" }));
    expect(templateField()).toHaveValue("{{a}}{{c}}");
    expect(templateField().selectionStart).toBe(10);
  });

  it("the_toggle_asks_when_the_template_was_changed", async () => {
    renderTabs();
    const user = userEvent.setup();
    await openMine(user);
    await byHand(user);
    fireEvent.change(templateField(), { target: { value: "{{a}} only" } });

    await user.click(screen.getByRole("radio", { name: "Automatic" }));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(templateField()).toHaveValue("{{a}} only");
    expect(screen.getByRole("radio", { name: "By hand" })).toBeChecked();
  });
});
