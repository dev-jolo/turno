/**
 * React binding for the pure engine. The component tree dispatches actions and
 * renders selector output; it never mutates engine state directly. State is
 * mirrored to localStorage on every change (guarded, best-effort).
 */

import type { Action, SessionState } from "@/engine";
import { reduce } from "@/engine";
import { loadState, saveState } from "@/lib/storage";
import { useCallback, useEffect, useReducer } from "react";

function init(): SessionState {
  return loadState();
}

export interface EngineApi {
  state: SessionState;
  dispatch: (action: Action) => void;
}

export function useEngine(): EngineApi {
  // The engine's `reduce` is already a pure reducer; React just hosts it.
  const [state, dispatch] = useReducer(
    (s: SessionState, a: Action) => reduce(s, a),
    undefined,
    init,
  );

  useEffect(() => {
    saveState(state);
  }, [state]);

  const wrapped = useCallback((action: Action) => dispatch(action), []);

  return { state, dispatch: wrapped };
}
