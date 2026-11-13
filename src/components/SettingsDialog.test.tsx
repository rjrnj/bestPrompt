import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import {
  claudeStatus,
  getSettings,
  latestEntryProject,
  listFrameworks,
  listProjects,
  listPromptEntries,
  setSetting,
  startSession,
} from "../api";
import {
  disposeTerminal,
  startTerminalSession,
  terminalFor,
} from "../terminal/terminals";
import { osScheme } from "../test/osScheme";
import { windowMock } from "../test/tauriWindow";
import { resetWindowThemeForTests, THEME_CACHE_KEY } from "../theme";

const { setTheme } = windowMock;
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFrameworks: vi.fn(),
  listProjects: vi.fn(),
  latestEntryProject: vi.fn(),
  listPromptEntries: vi.fn(),
  getSettings: vi.fn(),
  setSetting: vi.fn(),
  startSession: vi.fn(),
  claudeStatus: vi.fn(),
}));

const html = document.documentElement;

beforeEach(() => {
  // The window mock is put back by setup.ts; the API mocks are reset one by
  // one, so the window mock keeps its resolved values.
  for (const fn of [
    listFrameworks,
    listProjects,
    latestEntryProject,
    listPromptEntries,
    getSettings,
    setSetting,
    startSession,
    claudeStatus,
  ]) {
    vi.mocked(fn).mockReset();
  }
  resetWindowThemeForTests();
  localStorage.clear();
  delete html.dataset.theme;
  html.style.colorScheme = "";
  vi.mocked(listFrameworks).mockResolvedValue([]);
  vi.mocked(listProjects).mockResolvedValue([]);
  vi.mocked(latestEntryProject).mockResolvedValue(null);
  vi.mocked(listPromptEntries).mockResolvedValue([]);
  vi.mocked(getSettings).mockResolvedValue({
    theme: "system",
    sendHintSeen: false,
  });
  vi.mocked(setSetting).mockResolvedValue(undefined);
  vi.mocked(claudeStatus).mockResolvedValue({ found: false, path: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Settings" }));
  return screen.findByRole("dialog", { name: "Settings" });
}

describe("Settings", () => {
  it("choosing_dark_sets_the_theme_and_saves_it", async () => {
    osScheme("light");
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(html.dataset.theme).toBe("dark");
    expect(html.style.colorScheme).toBe("dark");
    expect(setSetting).toHaveBeenCalledWith({ theme: "dark" });
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe("dark");
    expect(setTheme).toHaveBeenLastCalledWith("dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  it("system_theme_follows_the_os_and_the_terminal_stays_dark", async () => {
    const os = osScheme("light");
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(html.dataset.theme).toBe("light"));
    expect(setTheme).not.toHaveBeenCalled();
    os.flip("dark");
    expect(html.dataset.theme).toBe("dark");
    os.flip("light");
    expect(html.dataset.theme).toBe("light");

    await openSettings(user);
    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(os.listeners.size).toBe(0);
    os.flip("dark");
    expect(html.dataset.theme).toBe("light");
  });

  it("the_terminal_stays_dark_in_either_theme", async () => {
    const os = osScheme("light");
    vi.mocked(startSession).mockResolvedValue({ id: "t1", prefilled: false });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(html.dataset.theme).toBe("light"));
    await startTerminalSession("/work", () => {});
    const terminal = terminalFor("t1")!;
    const dark = { background: "#0f172a", foreground: "#f1f5f9" };
    expect(terminal.options.theme).toMatchObject(dark);

    os.flip("dark");
    expect(terminal.options.theme).toMatchObject(dark);
    await openSettings(user);
    await user.click(screen.getByRole("radio", { name: "Light" }));
    os.flip("light");
    expect(html.dataset.theme).toBe("light");
    expect(terminal.options.theme).toMatchObject(dark);
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(terminal.options.theme).toMatchObject(dark);
    disposeTerminal("t1");
  });

  it("while_the_settings_are_loading_the_theme_is_left_alone", async () => {
    osScheme("light");
    html.dataset.theme = "dark";
    vi.mocked(getSettings).mockReturnValue(new Promise(() => {}));
    render(<App />);
    await screen.findByRole("button", { name: "Settings" });
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    await Promise.resolve();

    expect(html.dataset.theme).toBe("dark");
    expect(setTheme).not.toHaveBeenCalled();
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBeNull();
  });

  it("a_failed_settings_load_keeps_the_cached_theme", async () => {
    osScheme("light");
    localStorage.setItem(THEME_CACHE_KEY, "dark");
    html.dataset.theme = "dark";
    vi.mocked(getSettings).mockRejectedValue(new Error("no database"));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Settings" });
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    await openSettings(user);
    await screen.findByRole("radio", { name: "System" });

    expect(html.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe("dark");
    expect(setTheme).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(html.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe("light");
    expect(setTheme).toHaveBeenLastCalledWith("light");
  });

  it("the_saved_theme_applies_at_startup", async () => {
    osScheme("dark");
    vi.mocked(getSettings).mockResolvedValue({
      theme: "light",
      sendHintSeen: false,
    });
    render(<App />);
    await waitFor(() => expect(html.dataset.theme).toBe("light"));
  });

  it("settings_opens_from_the_header_and_closes_with_escape", async () => {
    osScheme("light");
    const user = userEvent.setup();
    render(<App />);
    const button = screen.getByRole("button", { name: "Settings" });
    await openSettings(user);
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(
      screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).name),
    ).toEqual(["theme", "theme", "theme"]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(button).toHaveFocus();
  });
});
