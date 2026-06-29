/**
 * Pure selectors over engine state. The React shell renders these; it never
 * reaches into `SessionState` directly.
 */

import { byId, playersPerCourt, waitingSorted } from "./helpers";
import type { Player, SessionState } from "./types";

export { playersPerCourt, teamSize } from "./helpers";

/** The fairness queue: who is waiting, in the order they'll be pulled on. */
export function waitingQueue(state: SessionState): Player[] {
  return waitingSorted(state);
}

/** The next group most likely to take the next freed court. */
export function whoIsUpNext(state: SessionState): Player[] {
  return waitingSorted(state).slice(0, playersPerCourt(state));
}

/** Players currently benched (on hold). */
export function onHold(state: SessionState): Player[] {
  return state.players.filter((p) => p.status === "hold");
}

export interface CourtView {
  index: number;
  occupied: boolean;
  teamA: Player[];
  teamB: Player[];
  /** King-of-the-court consecutive wins of the staying side (0 otherwise). */
  streak: number;
}

function resolve(state: SessionState, ids: string[]): Player[] {
  const out: Player[] = [];
  for (const id of ids) {
    const p = byId(state, id);
    if (p) out.push(p);
  }
  return out;
}

export function courtsView(state: SessionState): CourtView[] {
  const views: CourtView[] = [];
  for (let i = 0; i < state.courtsCount; i++) {
    const c = state.courts[i] ?? null;
    const teamA = c ? resolve(state, c.teamA) : [];
    const teamB = c ? resolve(state, c.teamB) : [];
    const streak = Math.max(0, ...[...teamA, ...teamB].map((p) => p.streak));
    views.push({ index: i, occupied: c != null, teamA, teamB, streak });
  }
  return views;
}

export function playingCount(state: SessionState): number {
  return state.courts.reduce((sum, c) => sum + (c ? c.teamA.length + c.teamB.length : 0), 0);
}

export function canStart(state: SessionState): boolean {
  return !state.started && state.players.length >= playersPerCourt(state);
}

/** Spread of games played across active players — powers fairness assertions. */
export function gamesSpread(state: SessionState): {
  min: number;
  max: number;
  gap: number;
} {
  const active = state.players.filter((p) => p.status !== "hold");
  if (active.length === 0) return { min: 0, max: 0, gap: 0 };
  const counts = active.map((p) => p.games);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return { min, max, gap: max - min };
}

/** How many courts will fill and how many players wait, for the setup hint. */
export function startSummary(state: SessionState): {
  onCourt: number;
  waiting: number;
  courtsFilled: number;
} {
  const per = playersPerCourt(state);
  const n = state.players.length;
  const courtsFilled = Math.min(state.courtsCount, Math.floor(n / per));
  const onCourt = courtsFilled * per;
  return { onCourt, waiting: n - onCourt, courtsFilled };
}
