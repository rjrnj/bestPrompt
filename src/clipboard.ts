// The clipboard, through Tauri's clipboard plugin rather than
// navigator.clipboard, which WebKitGTK leaves undefined in the Linux build.
// Components and tests import this module, never the plugin.

import { writeText as pluginWriteText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * Puts `text` on the system clipboard. Rejects with an Error: the plugin
 * rejects with the backend's error text as a bare string, which is wrapped
 * so callers can read `message` either way.
 */
export async function writeText(text: string): Promise<void> {
  try {
    await pluginWriteText(text);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
