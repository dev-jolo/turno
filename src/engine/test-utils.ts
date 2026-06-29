/**
 * Shared helpers for engine tests: invariant checkers and roster builders.
 * Not a test file itself (no `.test.ts`), just imported by the suites.
 */

import { playersPerCourt, teamSize } from "./helpers";
import { courtsView } from "./selectors";
import type { SessionState } from "./types";

export function roster(n: number, prefix = "P"): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

/** Every id seated on a court, across all courts. */
export function seatedIds(state: SessionState): string[] {
  const ids: string[] = [];
  for (const c of state.courts) {
    if (c) ids.push(...c.teamA, ...c.teamB);
  }
  return ids;
}

/**
 * Assert the structural invariants that must ALWAYS hold, in any mode/format.
 * Throws (via the returned error list being non-empty) so tests can assert it's
 * empty for a precise failure message.
 */
export function invariantErrors(state: SessionState): string[] {
  const errors: string[] = [];
  const seated = seatedIds(state);

  // No player on two courts at once.
  const seen = new Set<string>();
  for (const id of seated) {
    if (seen.has(id)) errors.push(`player ${id} is seated on more than one court`);
    seen.add(id);
  }

  const ts = teamSize(state);
  const per = playersPerCourt(state);
  for (const c of courtsView(state)) {
    if (!c.occupied) continue;
    // No court exceeds capacity.
    if (c.teamA.length > ts) errors.push(`court ${c.index} team A over capacity`);
    if (c.teamB.length > ts) errors.push(`court ${c.index} team B over capacity`);
    if (c.teamA.length + c.teamB.length > per) {
      errors.push(`court ${c.index} exceeds ${per} players`);
    }
  }

  // Status must match seating.
  const seatedSet = new Set(seated);
  for (const p of state.players) {
    if (p.status === "playing" && !seatedSet.has(p.id)) {
      errors.push(`player ${p.id} is 'playing' but not seated`);
    }
    if (p.status !== "playing" && seatedSet.has(p.id)) {
      errors.push(`player ${p.id} is seated but status is '${p.status}'`);
    }
    if (p.games < 0) errors.push(`player ${p.id} has negative games`);
  }

  // Reference integrity: every seated id is a real player.
  const ids = new Set(state.players.map((p) => p.id));
  for (const id of seated) {
    if (!ids.has(id)) errors.push(`seated id ${id} is not a known player`);
  }

  return errors;
}

/** Max gap in games played among active (non-hold) players. */
export function activeGamesGap(state: SessionState): number {
  const counts = state.players
    .filter((p) => p.status !== "hold")
    .map((p) => p.games);
  if (counts.length === 0) return 0;
  return Math.max(...counts) - Math.min(...counts);
}

/** Total partner-repeat + opponent-repeat incidents recorded so far. */
export function repeatTotals(state: SessionState): {
  partnerRepeats: number;
  opponentRepeats: number;
} {
  let partnerRepeats = 0;
  let opponentRepeats = 0;
  for (const p of state.players) {
    for (const v of Object.values(p.partners)) if (v > 1) partnerRepeats += v - 1;
    for (const v of Object.values(p.opps)) if (v > 1) opponentRepeats += v - 1;
  }
  // Each pair counted from both members.
  return {
    partnerRepeats: partnerRepeats / 2,
    opponentRepeats: opponentRepeats / 2,
  };
}
