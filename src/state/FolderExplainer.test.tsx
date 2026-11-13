import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  claudeStatus,
  getSettings,
  latestEntryProject,
  listFrameworks,
  listProjects,
  pickFolder,
  setProjectFolder,
} from "../api";
import type { Project } from "../bindings/Project";
import { Toaster } from "../components/Toaster";
import { FolderExplainerDialog } from "../components/terminal/FolderExplainerDialog";
import { startTerminalSession } from "../terminal/terminals";
import { AppStateProvider, useAppActions } from "./AppState";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  claudeStatus: vi.fn(),
  getSettings: vi.fn(),
  pickFolder: vi.fn(),
  setProjectFolder: vi.fn(),
}));
// No xterm: the sessions here are only started.
vi.mock("../terminal/terminals", () => ({
  startTerminalSession: vi.fn(),
  disposeTerminal: vi.fn(),
}));

function project(id: string): Project {
  return { id, name: id, folder: null, createdAt: 1, updatedAt: 1 };
}

const api = project("api");
const web = project("web");

/** Two projects with no folder start at once, as two windows' worth of clicks. */
function StartBoth() {
  const { startSession } = useAppActions();
  return (
    <button
      type="button"
      onClick={() => {
        void startSession(api.id);
        void startSession(web.id);
      }}
    >
      Start both
    </button>
  );
}

beforeEach(() => {
  vi.mocked(listFrameworks).mockResolvedValue([]);
  vi.mocked(listProjects).mockResolvedValue([api, web]);
  vi.mocked(latestEntryProject).mockResolvedValue(null);
  vi.mocked(claudeStatus).mockResolvedValue({
    found: true,
    path: "/bin/claude",
  });
  vi.mocked(getSettings).mockResolvedValue({
    theme: "system",
    sendHintSeen: false,
  });
  vi.mocked(pickFolder).mockResolvedValue("/picked");
  // Web saves only once api's session has started, so the two don't start
  // in the same tick: vitest hands a mocked module's concurrent first
  // dynamic imports the real module.
  let apiStarted!: () => void;
  const apiHasStarted = new Promise<void>((done) => (apiStarted = done));
  vi.mocked(setProjectFolder).mockImplementation(async (id, folder) => {
    if (id === web.id) await apiHasStarted;
    return { ...project(id), folder };
  });
  let n = 0;
  vi.mocked(startTerminalSession).mockImplementation(async () => {
    apiStarted();
    return { id: `s${++n}`, prefilled: false };
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

it("two_starts_that_both_need_the_explainer_open_one_chooser", async () => {
  render(
    <AppStateProvider>
      <StartBoth />
      <FolderExplainerDialog />
      <Toaster />
    </AppStateProvider>,
  );
  const user = userEvent.setup();
  await waitFor(() => expect(listProjects).toHaveBeenCalled());

  await user.click(screen.getByRole("button", { name: "Start both" }));
  const dialog = await screen.findByRole("alertdialog", {
    name: "Choose a folder for Claude Code",
  });
  await user.click(
    within(dialog).getByRole("button", { name: "Choose folder…" }),
  );

  await waitFor(() => expect(startTerminalSession).toHaveBeenCalledTimes(2));
  expect(pickFolder).toHaveBeenCalledExactlyOnceWith("claude");
  // Each project keeps the one folder.
  expect(setProjectFolder).toHaveBeenCalledWith(api.id, "/picked");
  expect(setProjectFolder).toHaveBeenCalledWith(web.id, "/picked");
});
