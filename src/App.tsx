import { useState } from "react";
import { AppTabs } from "./components/AppTabs";
import { FrameworkPicker } from "./components/FrameworkPicker";
import { FrameworksView } from "./components/frameworks/FrameworksView";
import { HistoryView } from "./components/history/HistoryView";
import { LoadErrorPanel } from "./components/LoadErrorPanel";
import { ProjectPicker } from "./components/ProjectPicker";
import { PromptActions } from "./components/PromptActions";
import { PromptForm } from "./components/PromptForm";
import { PromptPreview } from "./components/PromptPreview";
import { ClaudeDrawer } from "./components/terminal/ClaudeDrawer";
import { NoteAnnouncer } from "./components/terminal/WaitingNote";
import { Toaster } from "./components/Toaster";
import { AppStateProvider, useAppState } from "./state/AppState";
import { HistoryProvider } from "./state/HistoryState";

function App() {
  return (
    <AppStateProvider>
      {/* Above the tabs, so History's filters and selection survive a
          visit to the Builder. */}
      <HistoryProvider>
        <Shell />
      </HistoryProvider>
      <NoteAnnouncer />
      <Toaster />
    </AppStateProvider>
  );
}

/**
 * The tabs, with the framework and project pickers in the header while the
 * Builder shows. The pickers wait for the frameworks: until they load there
 * is nothing to pick for.
 */
function Shell() {
  const { frameworks } = useAppState();
  return (
    <AppTabs
      builderTools={
        frameworks.status === "ready" ? (
          <>
            <FrameworkPicker />
            <ProjectPicker />
          </>
        ) : null
      }
      builder={<Builder />}
      history={<HistoryView />}
      frameworks={<FrameworksView />}
    />
  );
}

/**
 * The form and the live preview side by side, once the frameworks are
 * loaded, with the Claude Code drawer under them.
 */
function Builder() {
  const { frameworks, drawer } = useAppState();
  // State rather than a ref, so the drawer measures it once it is there.
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const drawerFills =
    drawer.open && (drawer.maximized || (drawer.height ?? 0) >= 1);
  if (frameworks.status === "loading") {
    return (
      <p
        role="status"
        className="p-6 text-sm text-slate-500 dark:text-slate-400"
      >
        Loading frameworks…
      </p>
    );
  }
  if (frameworks.status === "error") {
    return <LoadErrorPanel message={frameworks.message} />;
  }
  return (
    <div ref={setArea} className="flex h-full min-w-0 flex-col">
      {/* The panes take what the drawer leaves and never ask for a minimum,
          so the drawer is never pushed; when that is too little for the
          panes' floor, this scrolls them as one. While the drawer fills the
          area, the panes are out of reach. */}
      <div
        data-testid="builder-panes"
        inert={drawerFills}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="grid h-full min-h-60 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-4 p-4">
          {/* Each pane scrolls on its own, so the preview stays in view
            however long the form gets. The explicit row lets a pane shrink
            below its content instead of stretching the row. The form pane
            is padded inside its scroll container so the fields' focus
            rings are not clipped at its edges, with room on the right for
            a scrollbar drawn over the content, as on Linux. */}
          <div className="-m-1 min-h-0 overflow-y-auto p-1 overlay-scrollbars:pr-4">
            <PromptForm />
          </div>
          <PromptPreview actions={<PromptActions />} />
        </div>
      </div>
      <ClaudeDrawer area={area} />
    </div>
  );
}

export default App;
