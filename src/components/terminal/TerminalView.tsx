import { useEffect, useRef } from "react";
import {
  fitFor,
  resizeTerminalSession,
  terminalFor,
} from "../../terminal/terminals";

/**
 * Shows the session's terminal. The terminal belongs to the registry: this
 * only attaches its element while mounted, fits it to the box and tells the
 * session the size. It never starts or closes a session.
 */
export function TerminalView({ sessionId }: { sessionId: string }) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = terminalFor(sessionId);

  useEffect(() => {
    const box = container.current;
    const term = terminalFor(sessionId);
    const fit = fitFor(sessionId);
    if (!box || !term || !fit) return;

    if (term.element) {
      box.appendChild(term.element);
    } else {
      term.open(box);
    }
    term.focus();

    let cols = term.cols;
    let rows = term.rows;
    const observer = new ResizeObserver(() => {
      // A hidden or collapsed box has no size to fit to.
      if (box.clientWidth === 0 || box.clientHeight === 0) return;
      fit.fit();
      if (term.cols === cols && term.rows === rows) return;
      cols = term.cols;
      rows = term.rows;
      resizeTerminalSession(sessionId, cols, rows);
    });
    observer.observe(box);

    return () => {
      observer.disconnect();
      term.element?.remove();
    };
  }, [sessionId]);

  if (!terminal) return null;
  return (
    // The padding is out here: FitAddon measures the box xterm opens in, and
    // that size includes any padding the box has. It shares the terminal's
    // always-dark background, so no light edge shows around it.
    <div className="h-full w-full bg-slate-900 p-2">
      <div ref={container} className="h-full w-full" />
    </div>
  );
}
