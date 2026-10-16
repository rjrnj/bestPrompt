import { FrameworkPicker } from "./components/FrameworkPicker";
import { LoadErrorPanel } from "./components/LoadErrorPanel";
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
 * The layout: a header with the app name and the framework picker, then the
 * form and the live preview side by side. The header has room for the
 * history navigation and the settings that come later; the terminal pane
 * will go under the two panes.
 */
function Shell() {
  const { frameworks } = useAppState();
  return (
    <div className="flex h-screen flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h1 className="text-lg font-semibold text-sky-700 dark:text-sky-400">
          bestPrompt
        </h1>
        <FrameworkPicker />
      </header>
      <main className="min-h-0 flex-1">
        {frameworks.status === "loading" && (
          <p
            role="status"
            className="p-6 text-sm text-slate-500 dark:text-slate-400"
          >
            Loading frameworks…
          </p>
        )}
        {frameworks.status === "error" && (
          <LoadErrorPanel message={frameworks.message} />
        )}
        {frameworks.status === "ready" && (
          <div className="grid h-full grid-cols-2 grid-rows-[minmax(0,1fr)] gap-4 p-4">
            {/* Each pane scrolls on its own, so the preview stays in view
                however long the form gets. The explicit row lets a pane shrink
                below its content instead of stretching the row. The form pane
                is padded inside its scroll container so the textareas' focus
                rings are not clipped at its edges. */}
            <div className="-m-1 min-h-0 overflow-y-auto p-1">
              <PromptForm />
            </div>
            <PromptPreview />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
