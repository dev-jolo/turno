/**
 * The rotation engine: a pure reducer `(state, action) => state`.
 *
 * `reduce` never mutates its input — it clones the state and applies the action
 * to the draft, so the whole engine is trivially testable in Vitest without a
 * browser. Randomness is injected via `rng` (defaults to `Math.random`) so
 * tests can be fully deterministic.
 */

import { MAX_COURTS, MIN_COURTS } from "./constants";
import {
  assignEmptyCourts,
  byId,
  isPlaying,
  minQueueGames,
  playersPerCourt,
  queueGames,
  recordHistory,
} from "./helpers";
import { strategyFor } from "./modes";
import type { Action, Format, Player, Rng, SessionState } from "./types";

export function initialState(): SessionState {
  return {
    started: false,
    courtsCount: 2,
    format: "doubles",
    gameMode: "rotating",
    round: 1,
    seq: 1,
    players: [],
    courts: [],
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function newPlayer(s: SessionState, name: string): Player {
  // Mid-session joiners are seeded to the current min queue position among
  // active players so they catch up without hogging — but their real `games`
  // count stays 0, so the UI honestly shows they just joined. Pre-start,
  // everyone starts level with no handicap.
  const base = s.started ? minQueueGames(s, (p) => p.status !== "hold") : 0;
  const stamp = s.seq++;
  return {
    id: `p${stamp}`,
    name,
    games: 0,
    seed: base,
    status: "waiting",
    enteredAt: stamp,
    lastGameRound: 0,
    holdAfter: false,
    partners: {},
    opps: {},
    streak: 0,
  };
}

function addPlayers(s: SessionState, names: string[]): void {
  for (const raw of names) {
    const name = raw.trim();
    if (name) s.players.push(newPlayer(s, name));
  }
}

function removePlayer(s: SessionState, id: string): void {
  for (const c of s.courts) {
    if (c) {
      c.teamA = c.teamA.filter((x) => x !== id);
      c.teamB = c.teamB.filter((x) => x !== id);
    }
  }
  s.players = s.players.filter((p) => p.id !== id);
}

function holdPlayer(s: SessionState, id: string): void {
  const p = byId(s, id);
  if (!p) return;
  if (isPlaying(s, id)) {
    p.holdAfter = true; // finish the current game, then bench
  } else {
    p.status = "hold";
    p.holdAfter = false;
  }
}

function returnPlayer(s: SessionState, id: string): void {
  const p = byId(s, id);
  if (!p) return;
  p.holdAfter = false;
  p.status = "waiting";
  // Slot back in fairly: don't leapfrog everyone, don't get buried — match the
  // current waiting minimum, then go to the back of that tier. We bump the
  // fairness handicap (`seed`), never the real `games` count, so a player who
  // stepped out doesn't appear to have played games they didn't.
  const targetQueue = Math.max(
    queueGames(p),
    minQueueGames(s, (q) => q.status === "waiting" && q.id !== id),
  );
  p.seed = targetQueue - p.games;
  p.enteredAt = s.seq++;
  p.streak = 0;
}

function setCourts(s: SessionState, count: number, rng: Rng): void {
  const next = clamp(count, MIN_COURTS, MAX_COURTS);
  s.courtsCount = next;
  if (!s.started) return;
  // Grow or shrink the live court list, releasing any players on dropped courts.
  while (s.courts.length < next) s.courts.push(null);
  if (s.courts.length > next) {
    for (let i = next; i < s.courts.length; i++) {
      const c = s.courts[i];
      if (c) {
        for (const id of [...c.teamA, ...c.teamB]) {
          const p = byId(s, id);
          if (p) {
            p.status = "waiting";
            p.enteredAt = s.seq++;
            p.streak = 0;
          }
        }
      }
    }
    s.courts.length = next;
  }
  assignEmptyCourts(s, rng);
}

function setFormat(s: SessionState, format: Format, rng: Rng): void {
  if (s.format === format) return;
  s.format = format;
  if (!s.started) return;
  // Re-pool everyone and rebuild courts for the new format.
  repoolAndRedraw(s, rng);
}

/** Send all playing players back to the queue and redraw every court. */
function repoolAndRedraw(s: SessionState, rng: Rng): void {
  for (const p of s.players) {
    if (p.status === "playing") {
      p.status = "waiting";
      p.enteredAt = s.seq++;
      p.streak = 0;
    }
  }
  s.courts = new Array<null>(s.courtsCount).fill(null);
  assignEmptyCourts(s, rng);
}

function startSession(s: SessionState, rng: Rng): void {
  s.started = true;
  s.round = 1;
  s.courts = new Array<null>(s.courtsCount).fill(null);
  assignEmptyCourts(s, rng);
}

function clearCourt(s: SessionState, i: number, rng: Rng): void {
  const c = s.courts[i];
  if (c) {
    for (const id of [...c.teamA, ...c.teamB]) {
      const p = byId(s, id);
      if (p) {
        p.status = p.holdAfter ? "hold" : "waiting";
        p.holdAfter = false;
        p.enteredAt = s.seq++;
        p.streak = 0;
      }
    }
  }
  s.courts[i] = null;
  assignEmptyCourts(s, rng);
}

/**
 * Mix all courts: count every in-progress game as done, re-pool everyone, and
 * redraw all courts together for maximum cross-court mixing.
 */
function mixAll(s: SessionState, rng: Rng): void {
  for (const c of s.courts) {
    if (!c) continue;
    recordHistory(s, c);
    for (const id of [...c.teamA, ...c.teamB]) {
      const p = byId(s, id);
      if (!p) continue;
      p.games += 1;
      p.lastGameRound = s.round;
      if (p.holdAfter) {
        p.status = "hold";
        p.holdAfter = false;
      } else {
        p.status = "waiting";
        p.enteredAt = s.seq++;
      }
      p.streak = 0;
    }
  }
  s.courts = new Array<null>(s.courtsCount).fill(null);
  // Refill before bumping the round so the just-finished players are still
  // tagged as "this round" and excluded from optional mixing swaps.
  assignEmptyCourts(s, rng);
  s.round += 1;
}

export function reduce(state: SessionState, action: Action, rng: Rng = Math.random): SessionState {
  if (action.type === "RESET") return initialState();

  const s = structuredClone(state);
  switch (action.type) {
    case "ADD_PLAYERS":
      addPlayers(s, action.names);
      if (s.started) assignEmptyCourts(s, rng);
      break;
    case "REMOVE_PLAYER":
      removePlayer(s, action.id);
      break;
    case "HOLD_PLAYER":
      holdPlayer(s, action.id);
      break;
    case "RETURN_PLAYER":
      returnPlayer(s, action.id);
      if (s.started) assignEmptyCourts(s, rng);
      break;
    case "SET_COURTS":
      setCourts(s, action.count, rng);
      break;
    case "SET_FORMAT":
      setFormat(s, action.format, rng);
      break;
    case "SET_GAME_MODE":
      // Switching modes mid-session re-pools and redraws so state stays valid.
      if (s.gameMode !== action.gameMode) {
        s.gameMode = action.gameMode;
        if (s.started) repoolAndRedraw(s, rng);
      }
      break;
    case "START_SESSION":
      if (!s.started && s.players.length >= playersPerCourt(s)) startSession(s, rng);
      break;
    case "FINISH_COURT":
      strategyFor(s.gameMode).onGameEnd(s, action.court, action.winner, rng);
      break;
    case "CLEAR_COURT":
      clearCourt(s, action.court, rng);
      break;
    case "MIX_ALL":
      mixAll(s, rng);
      break;
    default: {
      // Exhaustiveness guard.
      const _never: never = action;
      return _never;
    }
  }
  return s;
}
