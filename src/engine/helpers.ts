/**
 * Pure helpers shared by the reducer and the game-mode strategies.
 *
 * Functions whose name starts with a verb that implies change (assign, record,
 * release…) MUTATE the `draft` they are given. The reducer always works on a
 * fresh structural clone, so the public `reduce` stays pure. Selectors that only
 * read state live in `selectors.ts`.
 */

import { OPPONENT_WEIGHT, PARTNER_WEIGHT, SELECTION_WINDOW_SLACK } from "./constants";
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

/**
 * A player's position in the fairness queue: real games played plus their
 * handicap. Lower means more deserving of the next court. Decoupling this from
 * the raw `games` count lets a latecomer slot in fairly while still honestly
 * showing the few (or zero) games they've actually played.
 */
export function queueGames(p: Player): number {
  return p.games + p.seed;
}

/** Lowest queue position among players matching `pred` (0 if none match). */
export function minQueueGames(s: SessionState, pred?: (p: Player) => boolean): number {
  const pool = pred ? s.players.filter(pred) : s.players;
  if (pool.length === 0) return 0;
  return Math.min(...pool.map(queueGames));
}

/**
 * A player's active stack partner right now, or undefined if stacking has no
 * effect for them: no format-agnostic doubles seat to pin them into (singles),
 * no link set, the link points nowhere, or either half isn't currently
 * `"waiting"`. The stack link itself (`stackedWith`) persists regardless — this
 * is the single place that decides whether it's currently ACTIVE.
 */
export function activeStackPartner(s: SessionState, p: Player): Player | undefined {
  if (s.format !== "doubles") return undefined;
  if (p.status !== "waiting" || !p.stackedWith) return undefined;
  const partner = byId(s, p.stackedWith);
  if (!partner || partner.status !== "waiting") return undefined;
  return partner;
}

/**
 * Sort key for the fairness queue: a stacked pair (both currently waiting)
 * shares the less-caught-up member's position, so neither can leapfrog nor
 * bury the other. Everyone else's own `queueGames` is unchanged.
 */
function effectiveQueueGames(s: SessionState, p: Player): number {
  const partner = activeStackPartner(s, p);
  return partner ? Math.max(queueGames(p), queueGames(partner)) : queueGames(p);
}

/**
 * Fairness queue: waiting players ordered by fewest (effective) games first,
 * then longest wait (lowest `enteredAt`). This is the selection order that
 * stops the same people hogging courts. A stacked pair sorts adjacent to each
 * other (same effective position) — see `waitingUnits` for how they're then
 * treated as one unit rather than two independent picks.
 */
export function waitingSorted(s: SessionState): Player[] {
  return s.players
    .filter((p) => p.status === "waiting")
    .sort((a, b) => effectiveQueueGames(s, a) - effectiveQueueGames(s, b) || a.enteredAt - b.enteredAt);
}

export function isPlaying(s: SessionState, id: string): boolean {
  return s.courts.some((c) => c != null && (c.teamA.includes(id) || c.teamB.includes(id)));
}

/** One or two waiting players who must be selected together, never split. */
export interface Unit {
  ids: string[];
}

/**
 * Group an already fairness-sorted waiting list into selection units: a
 * stacked pair (both currently active, see `activeStackPartner`) becomes one
 * 2-person unit, everyone else stays a 1-person unit. Order is preserved — a
 * unit appears at the position of its first not-yet-consumed member, so the
 * result stays fairness-sorted.
 */
export function waitingUnits(s: SessionState, w: Player[]): Unit[] {
  const units: Unit[] = [];
  const consumed = new Set<string>();
  for (const p of w) {
    if (consumed.has(p.id)) continue;
    const partner = activeStackPartner(s, p);
    if (partner && !consumed.has(partner.id)) {
      units.push({ ids: [p.id, partner.id] });
      consumed.add(partner.id);
    } else {
      units.push({ ids: [p.id] });
    }
    consumed.add(p.id);
  }
  return units;
}

function unitRested(s: SessionState, u: Unit): boolean {
  return u.ids.every((id) => {
    const p = byId(s, id);
    return p ? p.lastGameRound !== s.round : true;
  });
}

/** All subsets of `units` whose combined player count is exactly `need`. A
 * unit is always taken whole — this is what keeps a stacked pair from ever
 * being split by the optional-mixing search. The window is small (bounded by
 * `need + SELECTION_WINDOW_SLACK` players), so an exhaustive subset search is
 * cheap. */
function unitCombinations(units: Unit[], need: number): Unit[][] {
  const res: Unit[][] = [];
  const go = (start: number, chosen: Unit[], size: number): void => {
    if (size === need) {
      res.push(chosen.slice());
      return;
    }
    if (size > need) return;
    for (let i = start; i < units.length; i++) {
      chosen.push(units[i]);
      go(i + 1, chosen, size + units[i].ids.length);
      chosen.pop();
    }
  };
  go(0, [], 0);
  return res;
}

function flattenUnits(units: Unit[]): string[] {
  return units.flatMap((u) => u.ids);
}

/**
 * Greedily fill `need` seats from fairness-ordered `units`, taking whole units
 * only. A unit that doesn't fit the remaining seats is skipped (not split) —
 * the search continues past it for a smaller unit that does fit. A skipped
 * unit isn't penalized: it stayed at the front of the fairness order, so it's
 * the natural next pick once a court opens with enough room.
 */
function pickBaseUnits(units: Unit[], need: number): Unit[] {
  const chosen: Unit[] = [];
  let filled = 0;
  for (const u of units) {
    if (filled >= need) break;
    if (filled + u.ids.length > need) continue;
    chosen.push(u);
    filled += u.ids.length;
  }
  return chosen;
}

/**
 * Cost of a proposed match: heavily penalize repeat partners, lightly penalize
 * repeat opponents. Lower is better.
 */
export function pairCost(s: SessionState, teamA: string[], teamB: string[]): number {
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

/** True if this split puts a stacked pair on opposite teams. */
function splitSeparatesStack(s: SessionState, teamA: string[], teamB: string[]): boolean {
  return teamA.some((id) => {
    const p = byId(s, id);
    return p?.stackedWith != null && teamB.includes(p.stackedWith);
  });
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
 * least, never separating a stacked pair (a hard constraint, not an added
 * cost — callers only ever pass whole units in, so at most one pair can be
 * present, and exactly one of the 3 splits keeps any given pair together).
 * Ties among the remaining valid splits are broken randomly via `rng`.
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
    if (splitSeparatesStack(s, teamA, teamB)) continue;
    const cost = pairCost(s, teamA, teamB);
    if (best == null || cost < best.cost || (cost === best.cost && rng() < 0.5)) {
      best = { teamA, teamB, cost };
    }
  }
  if (best) return best;
  // Unreachable given unit-respecting input (every group of 4 has exactly one
  // valid split per stacked pair present) — fall back rather than throw.
  const [a, b] = DOUBLES_SPLITS[0];
  const teamA = [ids[a[0]], ids[a[1]]];
  const teamB = [ids[b[0]], ids[b[1]]];
  return { teamA, teamB, cost: pairCost(s, teamA, teamB) };
}

/**
 * Pick the next group for ONE court: strict fairness first, then same-fairness
 * swaps to improve partner/opponent mixing. Returns `null` if not enough
 * waiting players. Never selects a group whose total queue position exceeds the
 * strict fairness pick (so mixing never costs fairness).
 *
 * The strict `base` (the fairest `need` players, consumed in stacking-aware
 * UNITS — see `waitingUnits`/`pickBaseUnits`) always plays — that's where a
 * forced back-to-back legitimately comes from when there aren't enough players
 * to rotate. The optional mixing swaps, however, only consider RESTED players
 * (ones who didn't just come off a court this round). That way the partner
 * optimizer never manufactures an avoidable back-to-back: a just-finished
 * player only replays immediately when the strict fairness pick itself requires
 * them (i.e. there genuinely aren't enough other players waiting).
 */
export function selectGroup(s: SessionState, rng: Rng): Split | null {
  const w = waitingSorted(s);
  const need = playersPerCourt(s);
  if (w.length < need) return null;

  const units = waitingUnits(s, w);

  // The strict fairness pick ALWAYS comes first and is never reshuffled by
  // recency — skipping the fairest players would inflate the games gap. A
  // forced back-to-back (not enough players to rotate) legitimately lives here.
  const base = pickBaseUnits(units, need);
  const baseIds = flattenUnits(base);
  if (baseIds.length < need) return null; // no combination of units fills the court fairly
  const baseIdSet = new Set(baseIds);
  const baseGames = baseIds.reduce((sum, id) => {
    const p = byId(s, id);
    return sum + (p ? queueGames(p) : 0);
  }, 0);

  // Optional mixing extras: unit candidates beyond the base that the partner
  // optimizer may swap in. Prefer RESTED units (no member came off a court
  // this round) so we never manufacture an AVOIDABLE back-to-back. Only when
  // rested players are too few to fill a court (e.g. right after Mix All, when
  // everyone just played) do we let just-finished units in as extras — they're
  // going to replay regardless, so mixing among them is free.
  const restedCount = w.reduce((n, p) => n + (p.lastGameRound !== s.round ? 1 : 0), 0);
  const notInBase = (u: Unit): boolean => !u.ids.some((id) => baseIdSet.has(id));
  const extraUnits =
    restedCount >= need
      ? units.filter((u) => notInBase(u) && unitRested(s, u))
      : units.filter(notInBase);

  const windowUnits: Unit[] = [];
  let windowPlayers = 0;
  for (const u of [...base, ...extraUnits]) {
    if (windowPlayers >= need + SELECTION_WINDOW_SLACK) break;
    windowUnits.push(u);
    windowPlayers += u.ids.length;
  }

  let best = bestSplit(s, baseIds, rng);
  for (const comboUnits of unitCombinations(windowUnits, need)) {
    const comboIds = flattenUnits(comboUnits);
    const games = comboIds.reduce((sum, id) => {
      const p = byId(s, id);
      return sum + (p ? queueGames(p) : 0);
    }, 0);
    if (games > baseGames) continue; // never accept a less-fair group
    const split = bestSplit(s, comboIds, rng);
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
