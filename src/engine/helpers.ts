/**
 * Pure helpers shared by the reducer and the game-mode strategies.
 *
 * Functions whose name starts with a verb that implies change (assign, record,
 * release…) MUTATE the `draft` they are given. The reducer always works on a
 * fresh structural clone, so the public `reduce` stays pure. Selectors that only
 * read state live in `selectors.ts`.
 */

import {
  OPPONENT_WEIGHT,
  PARTNER_WEIGHT,
  SELECTION_WINDOW_SLACK,
} from "./constants";
import type { Court, Player, Rng, SessionState } from "./types";

export function playersPerCourt(s: Pick<SessionState, "format">): number {
  return s.format === "singles" ? 2 : 4;
}

export function teamSize(s: Pick<SessionState, "format">): number {
  return s.format === "singles" ? 1 : 2;
}

export function byId(s: SessionState, id: string): Player | undefined {
  return s.players.find((p) => p.id === id);
}

/** Lowest games-played among players matching `pred` (0 if none match). */
export function minGames(
  s: SessionState,
  pred?: (p: Player) => boolean,
): number {
  const pool = pred ? s.players.filter(pred) : s.players;
  if (pool.length === 0) return 0;
  return Math.min(...pool.map((p) => p.games));
}

/**
 * Fairness queue: waiting players ordered by fewest games first, then longest
 * wait (lowest `enteredAt`). This is the selection order that stops the same
 * people hogging courts.
 */
export function waitingSorted(s: SessionState): Player[] {
  return s.players
    .filter((p) => p.status === "waiting")
    .sort((a, b) => a.games - b.games || a.enteredAt - b.enteredAt);
}

export function isPlaying(s: SessionState, id: string): boolean {
  return s.courts.some(
    (c) => c != null && (c.teamA.includes(id) || c.teamB.includes(id)),
  );
}

/**
 * Cost of a proposed match: heavily penalize repeat partners, lightly penalize
 * repeat opponents. Lower is better.
 */
export function pairCost(
  s: SessionState,
  teamA: string[],
  teamB: string[],
): number {
  const get = (m: Record<string, number>, x: string): number => m[x] ?? 0;
  let cost = 0;
  for (const t of [teamA, teamB]) {
    for (let i = 0; i < t.length; i++) {
      for (let j = i + 1; j < t.length; j++) {
        const a = byId(s, t[i]);
        if (a) cost += PARTNER_WEIGHT * get(a.partners, t[j]);
      }
    }
  }
  for (const a of teamA) {
    const pa = byId(s, a);
    if (!pa) continue;
    for (const b of teamB) cost += OPPONENT_WEIGHT * get(pa.opps, b);
  }
  return cost;
}

export interface Split {
  teamA: string[];
  teamB: string[];
  cost: number;
}

/** The 3 distinct ways to split 4 ids into two pairs (doubles). */
const DOUBLES_SPLITS: ReadonlyArray<readonly [number[], number[]]> = [
  [
    [0, 1],
    [2, 3],
  ],
  [
    [0, 2],
    [1, 3],
  ],
  [
    [0, 3],
    [1, 2],
  ],
];

/**
 * Choose the team split (of a fixed group) that reuses partners/opponents
 * least. Ties are broken randomly via `rng`.
 */
export function bestSplit(s: SessionState, ids: string[], rng: Rng): Split {
  if (teamSize(s) === 1) {
    // Singles: the only split is one player per side.
    return {
      teamA: [ids[0]],
      teamB: [ids[1]],
      cost: pairCost(s, [ids[0]], [ids[1]]),
    };
  }
  let best: Split | null = null;
  for (const [a, b] of DOUBLES_SPLITS) {
    const teamA = [ids[a[0]], ids[a[1]]];
    const teamB = [ids[b[0]], ids[b[1]]];
    const cost = pairCost(s, teamA, teamB);
    if (best == null || cost < best.cost || (cost === best.cost && rng() < 0.5)) {
      best = { teamA, teamB, cost };
    }
  }
  // best is always set (DOUBLES_SPLITS is non-empty).
  return best as Split;
}

/** All k-combinations of `arr` (order preserved). */
export function combinations<T>(arr: T[], k: number): T[][] {
  const res: T[][] = [];
  const n = arr.length;
  const go = (start: number, combo: T[]): void => {
    if (combo.length === k) {
      res.push(combo.slice());
      return;
    }
    for (let i = start; i < n; i++) {
      combo.push(arr[i]);
      go(i + 1, combo);
      combo.pop();
    }
  };
  go(0, []);
  return res;
}

/**
 * Pick the next group for ONE court: strict fairness first, then same-fairness
 * swaps to improve partner/opponent mixing. Returns `null` if not enough
 * waiting players. Never selects a group whose total games-played exceeds the
 * strict fairness pick (so mixing never costs fairness).
 */
export function selectGroup(s: SessionState, rng: Rng): Split | null {
  const w = waitingSorted(s);
  const need = playersPerCourt(s);
  if (w.length < need) return null;

  const base = w.slice(0, need);
  const baseGames = base.reduce((sum, p) => sum + p.games, 0);
  const windowIds = w
    .slice(0, Math.min(w.length, need + SELECTION_WINDOW_SLACK))
    .map((p) => p.id);

  let best = bestSplit(s, base.map((p) => p.id), rng);
  for (const combo of combinations(windowIds, need)) {
    const games = combo.reduce((sum, id) => sum + (byId(s, id)?.games ?? 0), 0);
    if (games > baseGames) continue; // never accept a less-fair group
    const split = bestSplit(s, combo, rng);
    if (split.cost < best.cost) best = split;
  }
  return best;
}

/** Mark a set of players as playing on the given court. */
export function seatGroup(s: SessionState, courtIndex: number, split: Split): void {
  for (const id of [...split.teamA, ...split.teamB]) {
    const p = byId(s, id);
    if (p) {
      p.status = "playing";
      p.streak = 0;
    }
  }
  s.courts[courtIndex] = { teamA: split.teamA, teamB: split.teamB };
}

/** Fill every open court (rotating-style) with the next fair group. */
export function assignEmptyCourts(s: SessionState, rng: Rng): void {
  for (let i = 0; i < s.courtsCount; i++) {
    if (s.courts[i]) continue;
    const grp = selectGroup(s, rng);
    if (!grp) break; // not enough players for another court
    seatGroup(s, i, grp);
  }
}

/** Record partner + opponent history for a completed game on `court`. */
export function recordHistory(s: SessionState, court: Court): void {
  const bump = (m: Record<string, number>, x: string): void => {
    m[x] = (m[x] ?? 0) + 1;
  };
  for (const t of [court.teamA, court.teamB]) {
    for (let a = 0; a < t.length; a++) {
      for (let b = 0; b < t.length; b++) {
        if (a === b) continue;
        const pa = byId(s, t[a]);
        if (pa) bump(pa.partners, t[b]);
      }
    }
  }
  for (const a of court.teamA) {
    for (const b of court.teamB) {
      const pa = byId(s, a);
      const pb = byId(s, b);
      if (pa) bump(pa.opps, b);
      if (pb) bump(pb.opps, a);
    }
  }
}

/**
 * Send a player off a court after their game finished: bench them if they were
 * flagged to hold, otherwise return them to the back of the waiting queue.
 */
export function releaseFromCourt(s: SessionState, id: string): void {
  const p = byId(s, id);
  if (!p) return;
  p.streak = 0;
  if (p.holdAfter) {
    p.status = "hold";
    p.holdAfter = false;
  } else {
    p.status = "waiting";
    p.enteredAt = s.seq++;
  }
}
