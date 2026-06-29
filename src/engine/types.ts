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
 */
export type GameMode = "rotating" | "king";

/** Which side won a king-of-the-court game. */
export type Winner = "A" | "B";

export type PlayerStatus = "waiting" | "playing" | "hold";

export interface Player {
  id: string;
  name: string;
  /** Number of completed games. Drives the fairness queue (fewest first). */
  games: number;
  status: PlayerStatus;
  /** Monotonic order stamp — used as wait time (lower = waiting longer). */
  enteredAt: number;
  /** If true and currently playing: bench this player after the current game. */
  holdAfter: boolean;
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
  | { type: "MIX_ALL" }
  | { type: "RESET" };

/** Pseudo-random source, injected so the reducer is deterministic in tests. */
export type Rng = () => number;
