import { useEffect, useRef } from "react";
import { hasOwn } from "../hasOwn";
import { focusIsInTerminal, terminalInput } from "../terminal/terminalDom";
import { useAppState } from "./AppState";
import { NO_PROJECT_KEY } from "./reducer";

const PANES = "[data-builder-panes]";
const DRAWER = "[data-claude-drawer]";
const FIELDS = ["input", "textarea", "select", "button"]
  .map((tag) => `${PANES} ${tag}`)
  .join(", ");

function usable(el: Element | null): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.isConnected &&
    el.closest("[inert]") === null &&
    el.getAttribute("aria-disabled") !== "true" &&
    !el.matches(":disabled")
  );
}

/**
 * F6 moves the focus between Claude Code's terminal and the Builder, which
 * Tab and Escape can't: the terminal keeps both for Claude. From the
 * terminal it goes to the Builder field that last had the focus, or the
 * first one. From anywhere else on the Builder it goes to the session's
 * terminal, or without one (or with one that has ended) to the drawer's
 * first button. While the drawer fills the Builder the fields are out of
 * reach, so from the terminal it goes to the drawer's header. It does
 * nothing with the drawer hidden, on the other tabs or with a modifier or a
 * dialog open, and never sends anything to a session.
 */
export function useF6(): void {
  const state = useAppState();
  const latest = useRef(state);
  const lastField = useRef<HTMLElement | null>(null);
  useEffect(() => {
    latest.current = state;
  });

  useEffect(() => {
    // Recorded for the whole document: the panes may mount later, and
    // only a target inside them counts.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(PANES)) {
        lastField.current = target;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const { view, drawer, sessions, selectedProjectId } = latest.current;
      if (event.key !== "F6" || event.defaultPrevented) return;
      if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
        return;
      }
      if (view !== "builder" || !drawer.open) return;
      // A modal owns the keyboard while it is open.
      if (
        document.activeElement?.closest('[role="dialog"], [role="alertdialog"]')
      ) {
        return;
      }
      const key = selectedProjectId ?? NO_PROJECT_KEY;
      const session = hasOwn(sessions, key) ? sessions[key] : null;
      const drawerEl = document.querySelector<HTMLElement>(DRAWER);
      const bodyButton = drawerEl?.querySelector<HTMLElement>(
        "[data-drawer-body] button",
      );
      const headerButton = () =>
        drawerEl?.querySelector<HTMLElement>(
          latest.current.drawer.maximized
            ? "[data-drawer-maximize]"
            : "[data-drawer-header] button",
        );
      event.preventDefault();

      if (focusIsInTerminal(drawerEl)) {
        const filled = document.querySelector(PANES)?.closest("[inert]");
        if (filled !== null && filled !== undefined) {
          // Full height: the fields are out of reach, so the header it is.
          (headerButton() ?? bodyButton)?.focus();
          return;
        }
        const remembered = lastField.current;
        const target = usable(remembered)
          ? remembered
          : Array.from(document.querySelectorAll<HTMLElement>(FIELDS)).find(
              usable,
            );
        target?.focus();
        return;
      }
      const input =
        session?.state === "exited" ? null : terminalInput(drawerEl);
      if (input !== null) {
        input.focus();
        return;
      }
      (bodyButton ?? drawerEl?.querySelector<HTMLElement>("button"))?.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
