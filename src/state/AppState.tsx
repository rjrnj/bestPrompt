// The app's state provider. The reducer in reducer.ts is synchronous; this
// is where the async work lives (loading frameworks, later saving), each
// step dispatching a start, success or failure action.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Context,
  type Dispatch,
  type ReactNode,
} from "react";
import { listFrameworks } from "../api";
import type { Framework } from "../bindings/Framework";
import { initialState, reducer, type Action, type State } from "./reducer";

/** The async operations components can start. */
export type AppActions = {
  loadFrameworks: () => Promise<void>;
};

const StateContext = createContext<State | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);
const ActionsContext = createContext<AppActions | null>(null);

// api.ts rejects with an ApiError, so the fallback only matters if that
// contract breaks; it keeps the failure path from ever throwing itself.
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  // Each load takes a number; a result is applied only if no later load has
  // started since, so overlapping loads can't finish out of order.
  const loadCount = useRef(0);

  const loadFrameworks = useCallback(async () => {
    const mine = ++loadCount.current;
    dispatch({ type: "frameworksLoading" });
    let frameworks: Framework[];
    try {
      frameworks = await listFrameworks();
    } catch (error) {
      if (mine === loadCount.current) {
        dispatch({ type: "frameworksFailed", message: messageOf(error) });
      }
      return;
    }
    if (mine === loadCount.current) {
      dispatch({ type: "frameworksLoaded", frameworks });
    }
  }, []);

  useEffect(() => {
    void loadFrameworks();
  }, [loadFrameworks]);

  const actions = useMemo<AppActions>(
    () => ({ loadFrameworks }),
    [loadFrameworks],
  );

  return (
    <StateContext value={state}>
      <DispatchContext value={dispatch}>
        <ActionsContext value={actions}>{children}</ActionsContext>
      </DispatchContext>
    </StateContext>
  );
}

function useRequired<T>(context: Context<T | null>, hook: string): T {
  const value = useContext(context);
  if (value === null) {
    throw new Error(`${hook} must be used inside an AppStateProvider`);
  }
  return value;
}

export function useAppState(): State {
  return useRequired(StateContext, "useAppState");
}

export function useAppDispatch(): Dispatch<Action> {
  return useRequired(DispatchContext, "useAppDispatch");
}

export function useAppActions(): AppActions {
  return useRequired(ActionsContext, "useAppActions");
}
