import { useMemo } from "react";
import type { Framework } from "../bindings/Framework";
import { useAppState } from "./AppState";
import { draftOf, renderPrompt, selectedFramework } from "./reducer";

export type CurrentPrompt = {
  framework: Framework;
  /** The draft with every section present, empty when unset. */
  draft: Record<string, string>;
  /** The rendered prompt; empty when the template does not parse. */
  prompt: string;
  /**
   * True when there is a prompt to show, copy and save: some section has
   * visible text and the template rendered something from it.
   */
  hasPrompt: boolean;
};

/**
 * The selected framework, its draft and the prompt rendered from them, or
 * null before a framework is selected. Memoized on the framework and its
 * stored draft rather than the whole state, so a toast or the save flag
 * doesn't re-render the template.
 */
export function useCurrentPrompt(): CurrentPrompt | null {
  const state = useAppState();
  const framework = selectedFramework(state);
  const stored = framework === null ? undefined : state.drafts[framework.id];
  return useMemo(() => {
    if (framework === null) return null;
    const draft = draftOf(framework, stored);
    const prompt = renderPrompt(framework, draft);
    const blank = Object.values(draft).every((value) => value.trim() === "");
    return { framework, draft, prompt, hasPrompt: !blank && prompt !== "" };
  }, [framework, stored]);
}
