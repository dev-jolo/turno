/**
 * Guarded localStorage persistence. The in-memory engine state is always the
 * source of truth; this only mirrors it so a phone refresh or reopen keeps the
 * session. Everything is feature-detected and wrapped in try/catch so the app
 * degrades to in-memory if storage is blocked (private mode, sandbox, etc.).
 */

import { initialState } from "@/engine";
import type { SessionState } from "@/engine";

const KEY = "turno_state_v1";

const available: boolean = (() => {
  try {
    const k = "__turno_probe__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
})();

/** Minimal structural check so a corrupt or old payload can't crash the app. */
function isSessionState(value: unknown): value is SessionState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.started === "boolean" &&
    typeof v.courtsCount === "number" &&
    (v.format === "doubles" || v.format === "singles") &&
    (v.gameMode === "rotating" || v.gameMode === "king") &&
    Array.isArray(v.players) &&
    Array.isArray(v.courts) &&
    typeof v.seq === "number"
  );
}

export function loadState(): SessionState {
  if (!available) return initialState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialState();
    const parsed: unknown = JSON.parse(raw);
    if (isSessionState(parsed)) return parsed;
  } catch {
    // fall through to a fresh state
  }
  return initialState();
}

export function saveState(state: SessionState): void {
  if (!available) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore: storage full or blocked — in-memory state still works
  }
}

export function clearState(): void {
  if (!available) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
