import { useEffect, useState } from "react";
import { RadixSmokeTest } from "./RadixSmokeTest";
import {
  ApiError,
  getPromptEntry,
  listFrameworks,
  savePromptEntry,
} from "./api";
import type { Framework } from "./bindings/Framework";

function describeError(error: unknown): string {
  return error instanceof ApiError
    ? `${error.kind}: ${error.message}`
    : String(error);
}

// Throwaway: lists the built-ins and round-trips one prompt entry, to prove
// the typed IPC path end to end. The real prompt-building UI replaces it.
function App() {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [status, setStatus] = useState("Loading frameworks…");

  useEffect(() => {
    listFrameworks()
      .then((loaded) => {
        setFrameworks(loaded);
        setStatus(`${loaded.length} frameworks loaded.`);
      })
      .catch((error: unknown) => setStatus(describeError(error)));
  }, []);

  async function saveTestEntry() {
    const framework = frameworks[0];
    if (!framework) return;
    try {
      const saved = await savePromptEntry({
        frameworkId: framework.id,
        sectionValues: Object.fromEntries(
          framework.sections.map((section) => [
            section.key,
            `test ${section.key}`,
          ]),
        ),
        renderedPrompt: `Test entry for ${framework.name}`,
      });
      const read = await getPromptEntry(saved.id);
      setStatus(
        `Saved and read back entry ${read.id} (${read.frameworkSnapshot.name}).`,
      );
    } catch (error) {
      setStatus(describeError(error));
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-900">
      <h1 className="text-4xl font-bold text-sky-400">bestPrompt</h1>
      <ul className="text-slate-200" data-testid="frameworks">
        {frameworks.map((framework) => (
          <li key={framework.id}>
            {framework.name} ({framework.sections.length} sections)
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="rounded bg-sky-600 px-4 py-2 text-white"
        onClick={saveTestEntry}
        disabled={frameworks.length === 0}
      >
        Save a test entry
      </button>
      <p className="text-slate-400" data-testid="status">
        {status}
      </p>
      <RadixSmokeTest />
    </main>
  );
}

export default App;
