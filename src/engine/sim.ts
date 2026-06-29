/**
 * Simulation helpers for property-style tests. These drive the engine through
 * many random game completions so invariants can be asserted across long
 * sessions, not just single cases. Everything here is deterministic given a
 * seed.
 */

import { reduce } from "./reducer";
import { courtsView } from "./selectors";
import type { Format, GameMode, Rng, SessionState, Winner } from "./types";

/** Small, fast, seedable PRNG (mulberry32). Deterministic per seed. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimConfig {
  courts: number;
  format: Format;
  gameMode: GameMode;
  playerNames: string[];
  seed?: number;
}

/** Build a started session from a config (no games played yet). */
export function startSession(config: SimConfig, rng: Rng): SessionState {
  let s = reduce(undefined as never, { type: "RESET" }, rng);
  s = reduce(s, { type: "SET_FORMAT", format: config.format }, rng);
  s = reduce(s, { type: "SET_GAME_MODE", gameMode: config.gameMode }, rng);
  s = reduce(s, { type: "SET_COURTS", count: config.courts }, rng);
  s = reduce(s, { type: "ADD_PLAYERS", names: config.playerNames }, rng);
  s = reduce(s, { type: "START_SESSION" }, rng);
  return s;
}

export interface SimResult {
  state: SessionState;
  gamesCompleted: number;
}

/**
 * Drive `state` through up to `rounds` random game completions, finishing a
 * randomly-chosen occupied court each step. King mode picks a random winner.
 * `mutate` lets a test inject hold/return/add actions partway through.
 */
export function runRandomGames(
  start: SessionState,
  rounds: number,
  rng: Rng,
  mutate?: (state: SessionState, step: number, rng: Rng) => SessionState,
): SimResult {
  let state = start;
  let completed = 0;
  for (let step = 0; step < rounds; step++) {
    if (mutate) state = mutate(state, step, rng);
    const occupied = courtsView(state)
      .filter((c) => c.occupied)
      .map((c) => c.index);
    if (occupied.length === 0) break;
    const court = occupied[Math.floor(rng() * occupied.length)];
    const winner: Winner = rng() < 0.5 ? "A" : "B";
    state = reduce(state, { type: "FINISH_COURT", court, winner }, rng);
    completed += 1;
  }
  return { state, gamesCompleted: completed };
}

/** Convenience: build and run a session in one call. */
export function simulate(config: SimConfig, rounds: number): SimResult {
  const rng = makeRng(config.seed ?? 1);
  const start = startSession(config, rng);
  return runRandomGames(start, rounds, rng);
}
