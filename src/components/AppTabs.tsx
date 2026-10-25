import * as Tabs from "@radix-ui/react-tabs";
import { useRef, useState, type ReactNode } from "react";
import { useAppDispatch, useAppState } from "../state/AppState";
import type { State } from "../state/reducer";
import { DiscardChangesDialog } from "./frameworks/DiscardChangesDialog";

type Props = {
  /** Header controls that belong to the Builder, hidden on the other tabs. */
  builderTools: ReactNode;
  builder: ReactNode;
  history: ReactNode;
  frameworks: ReactNode;
};

const trigger =
  "rounded px-3 py-1 text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 data-[state=active]:bg-sky-100 data-[state=active]:text-sky-900 dark:text-slate-400 dark:hover:text-slate-100 dark:data-[state=active]:bg-sky-900 dark:data-[state=active]:text-sky-100";

function isView(value: string): value is State["view"] {
  return value === "builder" || value === "history" || value === "frameworks";
}

/**
 * The window: a header with the app name, the Builder | History |
 * Frameworks tabs and, on the Builder, its tools; then the open tab's
 * content. The tab shown is the state's `view`, so opening a saved prompt
 * can switch to the Builder. Leaving Frameworks with unsaved changes asks
 * first. The header has room for the settings that come later.
 */
export function AppTabs({ builderTools, builder, history, frameworks }: Props) {
  const { view, editingFramework } = useAppState();
  const dispatch = useAppDispatch();
  const [leavingTo, setLeavingTo] = useState<State["view"] | null>(null);
  // The name asked about, kept from when the question opened: the editor's
  // own name is gone while the dialog closes.
  const [askedAbout, setAskedAbout] = useState("");
  const tabList = useRef<HTMLDivElement>(null);

  return (
    <Tabs.Root
      value={view}
      onValueChange={(value) => {
        if (!isView(value)) return;
        // A save or delete is running: Frameworks stays until it settles.
        if (view === "frameworks" && editingFramework?.busy) return;
        if (view === "frameworks" && editingFramework?.dirty) {
          setAskedAbout(editingFramework.name);
          setLeavingTo(value);
        } else {
          dispatch({ type: "viewChanged", view: value });
        }
      }}
      className="flex h-screen flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100"
    >
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h1 className="text-lg font-semibold text-sky-700 dark:text-sky-400">
          bestPrompt
        </h1>
        <Tabs.List
          ref={tabList}
          aria-label="Views"
          className="flex gap-0.5 rounded-md border border-slate-300 p-0.5 dark:border-slate-700"
        >
          <Tabs.Trigger value="builder" className={trigger}>
            Builder
          </Tabs.Trigger>
          <Tabs.Trigger value="history" className={trigger}>
            History
          </Tabs.Trigger>
          <Tabs.Trigger value="frameworks" className={trigger}>
            Frameworks
          </Tabs.Trigger>
        </Tabs.List>
        {view === "builder" && builderTools}
      </header>
      <main className="min-h-0 flex-1">
        {/* The Builder stays mounted while History shows, so coming back
            finds the form scrolled where it was and each field's undo
            history intact. Its first field follows the header's pickers, so
            the panel itself is left out of the tab order. */}
        <Tabs.Content
          value="builder"
          forceMount
          hidden={view !== "builder"}
          tabIndex={-1}
          className="h-full outline-none"
        >
          {builder}
        </Tabs.Content>
        <Tabs.Content
          value="history"
          className="h-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500"
        >
          {history}
        </Tabs.Content>
        {/* Not kept mounted: leaving the tab is what discards the editor's
            unsaved changes, and each visit starts with nothing selected. */}
        <Tabs.Content
          value="frameworks"
          className="h-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500"
        >
          {frameworks}
        </Tabs.Content>
      </main>
      <DiscardChangesDialog
        open={leavingTo !== null}
        name={askedAbout}
        onKeep={() => setLeavingTo(null)}
        onDiscard={() => {
          if (leavingTo !== null) {
            dispatch({ type: "viewChanged", view: leavingTo });
          }
          setLeavingTo(null);
        }}
        onCloseAutoFocus={(event) => {
          // To the tab now showing. Returning focus to the tab that asked
          // would select it, and ask again, when it was reached by arrow key.
          event.preventDefault();
          tabList.current
            ?.querySelector<HTMLElement>('[aria-selected="true"]')
            ?.focus();
        }}
      />
    </Tabs.Root>
  );
}
