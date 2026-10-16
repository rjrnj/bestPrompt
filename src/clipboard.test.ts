import { writeText as pluginWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeText } from "./clipboard";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(),
}));

afterEach(() => {
  vi.resetAllMocks();
});

describe("writeText", () => {
  it("hands the text to the clipboard plugin", async () => {
    vi.mocked(pluginWriteText).mockResolvedValue();

    await writeText("# Role\na reviewer");

    expect(pluginWriteText).toHaveBeenCalledWith("# Role\na reviewer");
  });

  // The plugin rejects with the backend's error text as a bare string.
  it("turns a string rejection into an Error with that message", async () => {
    vi.mocked(pluginWriteText).mockRejectedValue("clipboard unavailable");

    const failure = writeText("text");

    await expect(failure).rejects.toThrow(Error);
    await expect(failure).rejects.toThrow("clipboard unavailable");
  });

  it("passes an Error rejection through unchanged", async () => {
    const error = new Error("denied");
    vi.mocked(pluginWriteText).mockRejectedValue(error);

    await expect(writeText("text")).rejects.toBe(error);
  });
});
