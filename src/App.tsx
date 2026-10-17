import { AppTabs } from "./components/AppTabs";
import { FrameworkPicker } from "./components/FrameworkPicker";
import { HistoryView } from "./components/history/HistoryView";
import { LoadErrorPanel } from "./components/LoadErrorPanel";
import { ProjectPicker } from "./components/ProjectPicker";
import { PromptActions } from "./components/PromptActions";
import { PromptForm } from "./components/PromptForm";
import { PromptPreview } from "./components/PromptPreview";
import { Toaster } from "./components/Toaster";
import { AppStateProvider, useAppState } from "./state/AppState";

function App() {
  return (
    <AppStateProvider>
      <Shell />
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
    />
  );
}

/**
 * The form and the live preview side by side, once the frameworks are
 * loaded. The terminal pane will go under the two panes.
 */
function Builder() {
  const { frameworks } = useAppState();
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
    <div className="grid h-full grid-cols-2 grid-rows-[minmax(0,1fr)] gap-4 p-4">
      {/* Each pane scrolls on its own, so the preview stays in view
          however long the form gets. The explicit row lets a pane shrink
          below its content instead of stretching the row. The form pane
          is padded inside its scroll container so the fields' focus
          rings are not clipped at its edges. */}
      <div className="-m-1 min-h-0 overflow-y-auto p-1">
        <PromptForm />
      </div>
      <PromptPreview actions={<PromptActions />} />
    </div>
  );
}

export default App;
