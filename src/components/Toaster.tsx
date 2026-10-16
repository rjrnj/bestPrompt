import * as Toast from "@radix-ui/react-toast";
import { useAppDispatch, useAppState } from "../state/AppState";
import type { Toast as ToastData } from "../state/reducer";

// Errors stay up longer: they usually need reading, "Copied" does not.
const DURATION: Record<ToastData["kind"], number> = {
  info: 4000,
  error: 8000,
};

/**
 * The toasts in state, stacked in the bottom-right corner. Each one closes
 * itself after its duration or on its close button (or a swipe, or Escape
 * while focused), and closing removes it from state. Radix pauses the timers
 * while the pointer or focus is on the stack.
 */
export function Toaster() {
  const { toasts } = useAppState();
  const dispatch = useAppDispatch();

  // Unmounted while empty, so each run of toasts gets a fresh provider.
  // Radix resumes paused timers on pointerleave or focusout but stops
  // listening once no toast is left, and closing the last one by hand always
  // happens with the pointer or focus on the stack: a provider kept mounted
  // would never time out another toast. It also keeps F8 from focusing an
  // empty, invisible list.
  if (toasts.length === 0) return null;

  return (
    <Toast.Provider swipeDirection="right">
      {toasts.map((toast) => (
        <Toast.Root
          key={toast.id}
          // Foreground toasts are announced assertively, background politely.
          type={toast.kind === "error" ? "foreground" : "background"}
          duration={DURATION[toast.kind]}
          onOpenChange={(open) => {
            if (!open) dispatch({ type: "toastDismissed", id: toast.id });
          }}
          className={`pointer-events-auto flex items-start gap-3 rounded-md border px-4 py-3 text-sm shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) ${
            toast.kind === "error"
              ? "border-red-300 bg-red-50 text-red-900 focus-visible:outline-red-500 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
              : "border-slate-200 bg-white text-slate-900 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          }`}
        >
          <Toast.Description className="min-w-0 flex-1 wrap-break-word">
            {toast.message}
          </Toast.Description>
          <Toast.Close
            aria-label="Dismiss"
            className="-m-1 shrink-0 rounded p-1 opacity-70 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-sky-500"
          >
            <Cross />
          </Toast.Close>
        </Toast.Root>
      ))}
      {/* The viewport's padding and gaps let the pointer through to the
          preview underneath; only the toasts themselves catch it. */}
      <Toast.Viewport className="pointer-events-none fixed right-0 bottom-0 z-50 m-0 flex w-96 max-w-full list-none flex-col gap-2 p-4 outline-none" />
    </Toast.Provider>
  );
}

function Cross() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M2 2l8 8M10 2l-8 8" />
    </svg>
  );
}
