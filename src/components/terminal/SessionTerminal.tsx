import { Component, lazy, Suspense, type ReactNode } from "react";
import { primaryButton } from "../styles";
import { importTerminalView } from "./importTerminalView";

function loadTerminalView() {
  return lazy(() =>
    importTerminalView().then((m) => ({ default: m.TerminalView })),
  );
}
// Replaced on a retry: a lazy component keeps a failed load for good.
const terminalView = { current: loadTerminalView() };

/** The session's terminal, loaded on first use. */
export function SessionTerminal({ sessionId }: { sessionId: string }) {
  return (
    <TerminalBoundary>
      {(attempt) => (
        <Suspense key={attempt} fallback={null}>
          <LoadedTerminal sessionId={sessionId} />
        </Suspense>
      )}
    </TerminalBoundary>
  );
}

/**
 * Reads the lazy view when it renders, below the boundary, so a retry
 * renders the fresh one rather than the one that failed.
 */
function LoadedTerminal({ sessionId }: { sessionId: string }) {
  const TerminalView = terminalView.current;
  return <TerminalView sessionId={sessionId} />;
}

/**
 * Keeps a terminal that fails to load, or to render, to the drawer, with
 * a way to try again, rather than taking the whole app down. Each attempt
 * renders its children afresh.
 */
class TerminalBoundary extends Component<
  { children: (attempt: number) => ReactNode },
  { failed: boolean; attempt: number }
> {
  state = { failed: false, attempt: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children(this.state.attempt);
    return (
      <div className="flex flex-wrap items-center gap-3 p-3">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Couldn&apos;t load the terminal.
        </p>
        <button
          type="button"
          className={primaryButton}
          onClick={() => {
            terminalView.current = loadTerminalView();
            this.setState(({ attempt }) => ({
              failed: false,
              attempt: attempt + 1,
            }));
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
