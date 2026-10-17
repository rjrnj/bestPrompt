import * as Tabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { useAppDispatch, useAppState } from "../state/AppState";
import type { State } from "../state/reducer";

type Props = {
  /** Header controls that belong to the Builder, hidden on History. */
  builderTools: ReactNode;
  builder: ReactNode;
  history: ReactNode;
};

const trigger =
  "rounded px-3 py-1 text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 data-[state=active]:bg-sky-100 data-[state=active]:text-sky-900 dark:text-slate-400 dark:hover:text-slate-100 dark:data-[state=active]:bg-sky-900 dark:data-[state=active]:text-sky-100";

function isView(value: string): value is State["view"] {
  return value === "builder" || value === "history";
}

/**
 * The window: a header with the app name, the Builder | History tabs and,
 * on the Builder, its tools; then the open tab's content. The tab shown is
 * the state's `view`, so opening a saved prompt can switch to the Builder.
 * The header has room for the settings that come later.
 */
export function AppTabs({ builderTools, builder, history }: Props) {
  const { view } = useAppState();
  const dispatch = useAppDispatch();

  return (
    <Tabs.Root
      value={view}
      onValueChange={(value) => {
        if (isView(value)) dispatch({ type: "viewChanged", view: value });
      }}
      className="flex h-screen flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100"
    >
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h1 className="text-lg font-semibold text-sky-700 dark:text-sky-400">
          bestPrompt
        </h1>
        <Tabs.List
          aria-label="Views"
          className="flex gap-0.5 rounded-md border border-slate-300 p-0.5 dark:border-slate-700"
        >
          <Tabs.Trigger value="builder" className={trigger}>
            Builder
          </Tabs.Trigger>
          <Tabs.Trigger value="history" className={trigger}>
            History
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
      </main>
    </Tabs.Root>
  );
}
