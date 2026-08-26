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
  flattenUnits,
  pickBaseUnits,
  playersPerCourt,
  recordHistory,
  releaseFromCourt,
  seatGroup,
  teamSize,
  waitingSorted,
} from "./helpers";
import type { Split, Unit } from "./helpers";
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
 * Win/Lose analogue of `activeStackPartner`: both currently waiting AND
 * sharing the SAME queue (`lastResult`) — a stacked pair split across
 * different results doesn't force-pair here, see `winLoseStackPartnerUnavailable`.
 */
function activeWinLoseStackPartner(s: SessionState, p: Player): Player | undefined {
  if (s.format !== "doubles" || p.status !== "waiting" || !p.stackedWith) return undefined;
  const partner = byId(s, p.stackedWith);
  if (!partner || partner.status !== "waiting" || partner.lastResult !== p.lastResult) {
    return undefined;
  }
  return partner;
}

/**
 * A stacked pair's shared queue position: the LATER of the two members'
 * `enteredAt` stamps, same "less caught-up member decides" spirit as
 * `effectiveQueueGames` for the fairness queue. Without this, a pair that
 * just reunited (one half freshly arrived, the other long-dormant waiting
 * for them) would inherit the dormant half's stale, much-older stamp and
 * leapfrog everyone who'd been waiting in between — exactly the kind of
 * queue-jump `effectiveQueueGames`'s own `Math.max` exists to prevent.
 */
function effectiveWinLoseEnteredAt(s: SessionState, p: Player): number {
  const partner = activeWinLoseStackPartner(s, p);
  return partner ? Math.max(p.enteredAt, partner.enteredAt) : p.enteredAt;
}

/**
 * Waiting players belonging to one Win/Lose queue, FIFO — longest-waiting
 * first. Not fairness-weighted by games/seed like the main queue; a solo
 * player's position is purely "how long since the result that put them in
 * this queue," and a stacked pair's is `effectiveWinLoseEnteredAt`.
 */
function winLoseQueueSorted(s: SessionState, result: Player["lastResult"]): Player[] {
  return s.players
    .filter((p) => p.status === "waiting" && p.lastResult === result)
    .sort((a, b) => effectiveWinLoseEnteredAt(s, a) - effectiveWinLoseEnteredAt(s, b));
}

/**
 * True if a waiting player's stack partner is unavailable to pair with them
 * for Win/Lose selection right now: playing elsewhere, or waiting in a
 * DIFFERENT queue (a winner stacked with a player who just lost, say). Either
 * way this player sits out selection entirely rather than being picked solo —
 * the same "dormant until reunited" guarantee the base stacking feature
 * already gives a partner who's mid-game (see `stackPartnerPlaying`).
 */
function winLoseStackPartnerUnavailable(s: SessionState, p: Player): boolean {
  if (s.format !== "doubles" || !p.stackedWith) return false;
  const partner = byId(s, p.stackedWith);
  if (!partner) return false;
  if (partner.status === "playing") return true;
  return partner.status === "waiting" && partner.lastResult !== p.lastResult;
}

/**
 * Group one Win/Lose queue (already FIFO-sorted) into selection units: an
 * active stacked pair (see `activeWinLoseStackPartner`) becomes one 2-person
 * unit, everyone else a 1-person unit — same "never split" guarantee
 * `waitingUnits` gives the fairness queue, just scoped to one Win/Lose queue
 * at a time. Order is preserved (a unit sits at its first member's position),
 * so units come out still FIFO-sorted.
 */
function winLoseUnits(s: SessionState, result: Player["lastResult"]): Unit[] {
  const w = winLoseQueueSorted(s, result);
  const units: Unit[] = [];
  const consumed = new Set<string>();
  for (const p of w) {
    if (consumed.has(p.id)) continue;
    const partner = activeWinLoseStackPartner(s, p);
    if (partner && !consumed.has(partner.id)) {
      units.push({ ids: [p.id, partner.id] });
      consumed.add(partner.id);
    } else if (!winLoseStackPartnerUnavailable(s, p)) {
      units.push({ ids: [p.id] });
    }
    // else: partner is mid-game or in the other queue — sit this player out
    // until they're next reunited with their partner in the same queue.
    consumed.add(p.id);
  }
  return units;
}

/**
 * Assemble the next Win/Lose match for one court: two players from the
 * Winners queue, two from the Losers queue, taken in stacking-respecting
 * UNITS (a stacked pair is always pulled — and later seated — together, see
 * `bestWinLoseSplit`). If either queue can't supply its half, the shortfall
 * is backfilled from whichever remaining units — the other queue's overflow,
 * or anyone with no result yet — have waited longest, rather than preferring
 * one source over another; a unit that doesn't fit the remaining seats is
 * skipped, not split, same as `pickBaseUnits`. Returns null if there still
 * aren't enough waiting players to fill the court (same convention as
 * rotating mode's `selectGroup`).
 */
function selectWinLoseGroup(s: SessionState, rng: Rng): Split | null {
  const need = playersPerCourt(s);
  const half = need / 2;

  const winnerUnits = winLoseUnits(s, "win");
  const loserUnits = winLoseUnits(s, "lose");
  const neutralUnits = winLoseUnits(s, null);

  const winnerBase = pickBaseUnits(winnerUnits, half);
  const loserBase = pickBaseUnits(loserUnits, half);
  const chosen = [...winnerBase, ...loserBase];
  let filled = flattenUnits(chosen).length;

  if (filled < need) {
    const usedIds = new Set(flattenUnits(chosen));
    const enteredAtOf = (id: string): number => byId(s, id)?.enteredAt ?? Infinity;
    const remainderUnits = [...winnerUnits, ...loserUnits, ...neutralUnits]
      .filter((u) => !u.ids.some((id) => usedIds.has(id)))
      .sort((a, b) => Math.min(...a.ids.map(enteredAtOf)) - Math.min(...b.ids.map(enteredAtOf)));
    let remaining = need - filled;
    for (const u of remainderUnits) {
      if (remaining <= 0) break;
      if (u.ids.length > remaining) continue; // doesn't fit — skip, don't split it
      chosen.push(u);
      remaining -= u.ids.length;
    }
    filled = need - remaining;
  }

  if (filled < need) return null;
  return bestWinLoseSplit(s, flattenUnits(chosen), rng);
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
