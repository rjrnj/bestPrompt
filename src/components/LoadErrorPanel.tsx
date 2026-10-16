import { useAppActions } from "../state/AppState";

/**
 * Replaces the shell when the frameworks could not be loaded: nothing works
 * without them, so there is no point showing an empty picker.
 */
export function LoadErrorPanel({ message }: { message: string }) {
  const { loadFrameworks } = useAppActions();
  return (
    <div
      role="alert"
      className="mx-auto mt-16 max-w-md rounded-lg border border-red-300 bg-red-50 p-6 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
    >
      <h2 className="text-lg font-semibold">Couldn't load the frameworks</h2>
      <p className="mt-2 text-sm">{message}</p>
      <button
        type="button"
        className="mt-4 rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:bg-red-600 dark:hover:bg-red-500"
        onClick={() => void loadFrameworks()}
      >
        Retry
      </button>
    </div>
  );
}
