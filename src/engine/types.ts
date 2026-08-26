/**
 * Core domain types for the Turno rotation engine.
 *
 * This module is pure data — zero React, zero DOM. A roster is just an array of
 * `Player` objects today; the same shape can later be loaded from storage or a
 * backend without changing the engine (see v2 notes in the spec).
 */

/** Court format: doubles (4 per court) or singles (2 per court). */
export type Format = "doubles" | "singles";

/**
 * Session game mode.
 * - `rotating`: courts run independently; when a game ends everyone on it goes
 *   to the back of the queue and the next fair group is pulled on. The DEFAULT.
 * - `king`: winners stay (capped), losers rotate off, challengers come up. This
 *   mode records who won each game.
 * - `winLose`: nobody stays — a finished game sends its winners to the back of
 *   a Winners queue and its losers to the back of a Losers queue, and the next
 *   match pulls two from each, pairing a winner with a loser on every team.
 *   Named apart from "stack"/"stacked" (the pinned-partner feature) on purpose
 *   — the two concepts are unrelated and the names must not be confusable.
 */
export type GameMode = "rotating" | "king" | "winLose";

/** Which side won a king-of-the-court game. */
export type Winner = "A" | "B";

export type PlayerStatus = "waiting" | "playing" | "hold";

export interface Player {
  id: string;
  name: string;
  /**
   * Number of games this player has actually completed. This is the real,
   * user-facing stat — it starts at 0 for everyone and only ever goes up when a
   * game they were in finishes. It is NOT used directly for queue fairness; see
   * `seed`.
   */
  games: number;
  /**
   * Fairness handicap. Mid-session joiners and returners are seeded so they
   * don't leapfrog (or get buried under) the field, without faking their real
   * `games` count. The fairness queue orders by `games + seed` (see
   * `queueGames`), so a latecomer can show "0 games played" yet still slot in
   * fairly. 0 for everyone who was present at the start.
   */
  seed: number;
  status: PlayerStatus;
  /** Monotonic order stamp — used as wait time (lower = waiting longer). */
  enteredAt: number;
  /**
   * The `round` in which this player last completed a game (0 if never). Used to
   * avoid avoidable back-to-back games: a player who just came off a court is
   * kept out of the optional partner-mixing swaps while rested players are free.
   */
  lastGameRound: number;
  /** If true and currently playing: bench this player after the current game. */
  holdAfter: boolean;
  /**
   * Stacking: the id of this player's pinned partner, or null. Symmetric — if
   * A.stackedWith is B, B.stackedWith is always A. Persists even while one of
   * the pair is on hold, removed-from-the-effect (singles format), or the
   * partner id no longer resolves; the SELECTION algorithm is what decides
   * whether the link is currently "active" (see `helpers.ts`), not this field.
   */
  stackedWith: string | null;
  /**
   * Win/Lose mode only: this player's most recent match result, or null if
   * they haven't played one yet (in this mode) — which queue they currently
   * belong to is derived from this, not stored separately. Never written by
   * rotating or king mode, so switching into Win/Lose mode always starts
   * everyone fresh, the same as a brand-new joiner.
   */
  lastResult: "win" | "lose" | null;
  /**
   * Win/Lose mode only: consecutive round-completions this player has spent
   * waiting with no result yet (`lastResult === null`) — powers the neutral
   * queue's fairness floor (see `WIN_LOSE_NEUTRAL_FLOOR_ROUNDS`). Reset to 0
   * the moment they get seated or get a result; never written by rotating or
   * king mode.
   */
  neutralWaitRounds: number;
  /** Map of partnerId -> times partnered. */
  partners: Record<string, number>;
  /** Map of opponentId -> times opposed. */
  opps: Record<string, number>;
  /** King-of-the-court: consecutive wins while staying on the current court. */
  streak: number;
}

export interface Court {
  teamA: string[];
  teamB: string[];
}

export interface SessionState {
  started: boolean;
  courtsCount: number;
  format: Format;
  gameMode: GameMode;
  round: number;
  /** Monotonic counter, kept in state so the reducer stays pure. */
  seq: number;
  players: Player[];
  /** One slot per reserved court; `null` when the court is open. */
  courts: (Court | null)[];
}

export type Action =
  | { type: "ADD_PLAYERS"; names: string[] }
  | { type: "REMOVE_PLAYER"; id: string }
  | { type: "HOLD_PLAYER"; id: string }
  | { type: "RETURN_PLAYER"; id: string }
  | { type: "SET_COURTS"; count: number }
  | { type: "SET_FORMAT"; format: Format }
  | { type: "SET_GAME_MODE"; gameMode: GameMode }
  | { type: "START_SESSION" }
  | { type: "FINISH_COURT"; court: number; winner?: Winner }
  | { type: "CLEAR_COURT"; court: number }
  | { type: "SUBSTITUTE_PLAYER"; court: number; outId: string; inId?: string }
  | { type: "SET_STACK"; a: string; b: string }
  | { type: "UNSTACK"; id: string }
  | { type: "MIX_ALL" }
  | { type: "RESET" };

/** Pseudo-random source, injected so the reducer is deterministic in tests. */
export type Rng = () => number;
