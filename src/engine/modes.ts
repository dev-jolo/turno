/**
 * Game modes modeled as a strategy with one shared interface. The only real
 * divergence between modes is *what happens when a game ends* — everything else
 * (fairness queue, mixing, hold/return) is shared in `helpers.ts`.
 */

import {
  KING_CHALLENGERS_FROM_QUEUE_TOP,
  KING_MAX_CONSECUTIVE_WINS,
  KING_WINNERS_STAY_AS_PARTNERSHIP,
} from "./constants";
import {
  assignEmptyCourts,
  bestSplit,
  bestWinLoseSplit,
  byId,
  playersPerCourt,
  recordHistory,
  releaseFromCourt,
  seatGroup,
  teamSize,
  waitingSorted,
} from "./helpers";
import type { Split } from "./helpers";
import type { Court, GameMode, Player, Rng, SessionState, Winner } from "./types";

export interface GameModeStrategy {
  /** Whether finishing a game in this mode requires recording who won. */
  readonly needsWinner: boolean;
  /**
   * Resolve a finished game on court `courtIndex`. Mutates the draft: records
   * history, advances game counts, and re-seats courts per the mode's rules.
   */
  onGameEnd(s: SessionState, courtIndex: number, winner: Winner | undefined, rng: Rng): void;
}

/** Count a finished game for everyone on the court and record their history. */
function tallyGame(s: SessionState, court: Court): void {
  recordHistory(s, court);
  for (const id of [...court.teamA, ...court.teamB]) {
    const p = byId(s, id);
    if (p) {
      p.games += 1;
      // Tag the round they just played so the selector can keep them out of
      // optional mixing swaps while rested players are available.
      p.lastGameRound = s.round;
    }
  }
}

/**
 * Rotating queue (DEFAULT): when a court's game ends, everyone on it goes to the
 * back of the queue and the next fair group is pulled on. No winner needed.
 */
const rotating: GameModeStrategy = {
  needsWinner: false,
  onGameEnd(s, i, _winner, rng) {
    const court = s.courts[i];
    if (!court) return;
    tallyGame(s, court);
    for (const id of [...court.teamA, ...court.teamB]) releaseFromCourt(s, id);
    s.courts[i] = null;
    // Refill first so the just-finished players are still tagged "this round"
    // and skipped by the optional mixing swaps, then advance the round.
    assignEmptyCourts(s, rng);
    s.round += 1;
  },
};

/**
 * King of the court: winners stay (capped at a max consecutive wins), losers
 * rotate off, and challengers come up from the top of the fairness queue.
 */
const king: GameModeStrategy = {
  needsWinner: true,
  onGameEnd(s, i, winner, rng) {
    const court = s.courts[i];
    if (!court) return;
    tallyGame(s, court);

    // DECISION: if no winner is supplied (shouldn't happen via UI) fall back to
    // rotating everyone off so state never corrupts.
    if (winner !== "A" && winner !== "B") {
      for (const id of [...court.teamA, ...court.teamB]) releaseFromCourt(s, id);
      s.courts[i] = null;
      assignEmptyCourts(s, rng);
      s.round += 1;
      return;
    }

    const winners = winner === "A" ? court.teamA : court.teamB;
    const losers = winner === "A" ? court.teamB : court.teamA;
    const priorStreak = Math.max(0, ...winners.map((id) => byId(s, id)?.streak ?? 0));
    const newStreak = priorStreak + 1;

    // Losers always rotate off.
    for (const id of losers) releaseFromCourt(s, id);

    const need = teamSize(s); // challengers needed to face the staying winners
    const waiting = waitingSorted(s);
    let challengers: string[];
    if (KING_CHALLENGERS_FROM_QUEUE_TOP) {
      challengers = waiting.slice(0, need).map((p) => p.id);
    } else {
      // Random challengers from the waiting pool.
      const pool = waiting.map((p) => p.id);
      for (let k = pool.length - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1));
        [pool[k], pool[j]] = [pool[j], pool[k]];
      }
      challengers = pool.slice(0, need);
    }

    const winnersCapped = newStreak >= KING_MAX_CONSECUTIVE_WINS;
    const winnerWantsOut = winners.some((id) => byId(s, id)?.holdAfter);
    const enoughChallengers = challengers.length === need;

    if (winnersCapped || winnerWantsOut || !enoughChallengers) {
      // Winners rotate off too: hit the cap, asked to step out, or nobody to
      // challenge them. Clear the court and refill fairly.
      for (const id of winners) releaseFromCourt(s, id);
      s.courts[i] = null;
      assignEmptyCourts(s, rng);
      s.round += 1;
      return;
    }

    // Winners stay and challengers come up. By default winners keep their
    // pairing (a partnership); if the flag is off, re-pair winners+challengers
    // for the least-repeat split instead.
    let teamA: string[];
    let teamB: string[];
    if (KING_WINNERS_STAY_AS_PARTNERSHIP || teamSize(s) === 1) {
      teamA = [...winners];
      teamB = challengers;
    } else {
      const split = bestSplit(s, [...winners, ...challengers], rng);
      teamA = split.teamA;
      teamB = split.teamB;
    }
    for (const id of winners) {
      const p = byId(s, id);
      if (p) p.streak = newStreak;
    }
    for (const id of [...teamA, ...teamB]) {
      const p = byId(s, id);
      if (p) {
        p.status = "playing";
        if (!winners.includes(id)) p.streak = 0;
      }
    }
    s.courts[i] = { teamA, teamB };
    // Fill any *other* empty courts (e.g. created elsewhere) fairly, then
    // advance the round (after refilling, so recency tagging stays consistent).
    assignEmptyCourts(s, rng);
    s.round += 1;
  },
};

/**
 * Waiting players belonging to one Win/Lose queue, FIFO — longest-waiting
 * first. Not fairness-weighted (no `games`/`seed`): a player's position here
 * is purely "how long since the result that put them in this queue."
 */
function winLoseQueueSorted(s: SessionState, result: Player["lastResult"]): Player[] {
  return s.players
    .filter((p) => p.status === "waiting" && p.lastResult === result)
    .sort((a, b) => a.enteredAt - b.enteredAt);
}

/**
 * Assemble the next Win/Lose match for one court: two players from the
 * Winners queue, two from the Losers queue. If either queue can't supply its
 * half, the shortfall is backfilled from whichever remaining players — the
 * other queue's overflow, or anyone with no result yet — have waited longest,
 * rather than preferring one source over another. Returns null if there
 * still aren't enough waiting players to fill the court (same convention as
 * rotating mode's `selectGroup`).
 */
function selectWinLoseGroup(s: SessionState, rng: Rng): Split | null {
  const need = playersPerCourt(s);
  const half = need / 2;

  const winners = winLoseQueueSorted(s, "win");
  const losers = winLoseQueueSorted(s, "lose");
  const neutral = winLoseQueueSorted(s, null);

  const chosen = [...winners.slice(0, half), ...losers.slice(0, half)];

  if (chosen.length < need) {
    const used = new Set(chosen.map((p) => p.id));
    const remainder = [...winners.slice(half), ...losers.slice(half), ...neutral]
      .filter((p) => !used.has(p.id))
      .sort((a, b) => a.enteredAt - b.enteredAt);
    chosen.push(...remainder.slice(0, need - chosen.length));
  }

  if (chosen.length < need) return null;
  return bestWinLoseSplit(
    s,
    chosen.map((p) => p.id),
    rng,
  );
}

/** Fill every open court with the next Win/Lose match. */
function assignEmptyCourtsWinLose(s: SessionState, rng: Rng): void {
  for (let i = 0; i < s.courtsCount; i++) {
    if (s.courts[i]) continue;
    const grp = selectWinLoseGroup(s, rng);
    if (!grp) break; // not enough players for another court
    seatGroup(s, i, grp);
  }
}

/**
 * Win/Lose stacking: nobody stays on court. A finished game sends its winners
 * to the back of the Winners queue and its losers to the back of the Losers
 * queue; the just-freed court (and any other currently-open court) is
 * reassembled from both queues, mixing a winner with a loser on every team —
 * see `selectWinLoseGroup`. Stacked pairs are handled by the same hard
 * constraint `bestWinLoseSplit` already applies, same as every other mode.
 */
const winLose: GameModeStrategy = {
  needsWinner: true,
  onGameEnd(s, i, winner, rng) {
    const court = s.courts[i];
    if (!court) return;
    tallyGame(s, court);

    if (winner !== "A" && winner !== "B") {
      // Shouldn't happen via the UI — fall back to a plain release so state
      // never corrupts, the same fallback the king strategy uses.
      for (const id of [...court.teamA, ...court.teamB]) releaseFromCourt(s, id);
      s.courts[i] = null;
      assignEmptyCourtsWinLose(s, rng);
      s.round += 1;
      return;
    }

    const winners = winner === "A" ? court.teamA : court.teamB;
    const losers = winner === "A" ? court.teamB : court.teamA;
    for (const id of winners) {
      const p = byId(s, id);
      if (p) p.lastResult = "win";
      releaseFromCourt(s, id);
    }
    for (const id of losers) {
      const p = byId(s, id);
      if (p) p.lastResult = "lose";
      releaseFromCourt(s, id);
    }
    s.courts[i] = null;
    assignEmptyCourtsWinLose(s, rng);
    s.round += 1;
  },
};

const STRATEGIES: Record<GameMode, GameModeStrategy> = { rotating, king, winLose };

export function strategyFor(mode: GameMode): GameModeStrategy {
  return STRATEGIES[mode];
}
