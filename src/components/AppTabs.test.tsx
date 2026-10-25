import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latestEntryProject, listFrameworks, listProjects } from "../api";
import { useEffect } from "react";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../state/AppState";
import { AppTabs } from "./AppTabs";

// Only the commands are mocked; ApiError stays the real class.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
}));

function View() {
  return <p>view: {useAppState().view}</p>;
}

/** A stand-in for the Frameworks view with unsaved changes to `name`. */
function DirtyEditor({ name }: { name: string }) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch({ type: "editingChanged", editing: { dirty: true, name } });
    return () => dispatch({ type: "editingChanged", editing: null });
  }, [dispatch, name]);
  return <p>frameworks pane</p>;
}

function renderTabs(frameworks = <p>frameworks pane</p>) {
  render(
    <AppStateProvider>
      <AppTabs
        builderTools={<p>builder tools</p>}
        builder={<p>builder pane</p>}
        history={<p>history pane</p>}
        frameworks={frameworks}
      />
      <View />
    </AppStateProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listFrameworks).mockReturnValue(new Promise(() => {}));
  vi.mocked(listProjects).mockReturnValue(new Promise(() => {}));
  vi.mocked(latestEntryProject).mockResolvedValue(null);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("AppTabs", () => {
  it("shows the app name and opens on the Builder", () => {
    renderTabs();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "bestPrompt",
    );
    expect(screen.getByRole("tab", { name: "Builder" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("builder pane");
    expect(screen.getByText("builder tools")).toBeInTheDocument();
  });

  it("switches between the Builder and History by mouse and keyboard", async () => {
    renderTabs();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.getByText("view: history")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel", { name: "History" })).toHaveTextContent(
      "history pane",
    );
    expect(screen.getByText("builder pane")).not.toBeVisible();

    await user.keyboard("{ArrowLeft}");

    expect(screen.getByRole("tab", { name: "Builder" })).toHaveFocus();
    expect(screen.getByText("view: builder")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Builder" })).toHaveTextContent(
      "builder pane",
    );
    expect(screen.queryByText("history pane")).toBeNull();

    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "History" })).toHaveFocus();
    expect(screen.getByText("view: history")).toBeInTheDocument();
  });

  it("shows the builder tools only on the Builder tab", async () => {
    renderTabs();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.queryByText("builder tools")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Builder" }));
    expect(screen.getByText("builder tools")).toBeInTheDocument();
  });

  it("keeps the Builder mounted while History shows", async () => {
    renderTabs();
    const user = userEvent.setup();
    const pane = screen.getByText("builder pane");

    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(screen.getByRole("tab", { name: "Builder" }));

    expect(screen.getByText("builder pane")).toBe(pane);
  });

  it("shows the Frameworks tab without the builder tools", async () => {
    renderTabs();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Frameworks" }));

    expect(screen.getByText("view: frameworks")).toBeInTheDocument();
    expect(
      screen.getByRole("tabpanel", { name: "Frameworks" }),
    ).toHaveTextContent("frameworks pane");
    expect(screen.queryByText("builder tools")).toBeNull();
  });

  it("asks before leaving the Frameworks tab with unsaved changes", async () => {
    renderTabs(<DirtyEditor name="Review" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Frameworks" }));

    await user.click(screen.getByRole("tab", { name: "History" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Discard changes to Review?");
    await user.click(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    );
    expect(screen.getByText("view: frameworks")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Discard",
      }),
    );
    expect(screen.getByText("view: history")).toBeInTheDocument();
    expect(screen.queryByText("frameworks pane")).toBeNull();
  });
});
