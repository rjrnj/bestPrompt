// What to run to install Claude Code, shown when it isn't found. Kept apart
// from the terminal code so showing it doesn't load xterm.

/** The shell to run `command` in, and the command, for `platform`. */
export function installCommand(platform: "windows" | "linux"): {
  shell: string;
  command: string;
} {
  return platform === "windows"
    ? {
        shell: "PowerShell",
        command: "irm https://claude.ai/install.ps1 | iex",
      }
    : {
        shell: "Terminal",
        command: "curl -fsSL https://claude.ai/install.sh | bash",
      };
}
