/**
 * Engine tuning constants.
 *
 * These are deliberately surfaced as named constants so they are trivial to
 * change without touching algorithm code.
 */

/**
 * Partner/opponent repeat weights used when scoring a proposed team split.
 * Repeating a *partner* is penalized heavily; repeating an *opponent* lightly.
 */
export const PARTNER_WEIGHT = 3;
export const OPPONENT_WEIGHT = 1;

/**
 * When pulling the next group for a court we look at a small window of the
 * waiting queue — `playersPerCourt + SELECTION_WINDOW_SLACK` — and choose the
 * subset+split with the lowest repeat score, without ever picking a less-fair
 * group (we never raise the total games-played above the strict fairness pick).
 */
export const SELECTION_WINDOW_SLACK = 3;

/* ------------------------------------------------------------------ *
 * King-of-the-court defaults.
 * DECISION: these are product defaults — confirm with product owner.
 * ------------------------------------------------------------------ */

/**
 * Winners stay, but capped at this many consecutive wins, then they rotate off
 * so one strong pair can't own a court all night.
 * confirm with product owner
 */
export const KING_MAX_CONSECUTIVE_WINS = 2;

/**
 * In doubles, winners stay together as a partnership (not re-paired).
 * confirm with product owner
 */
export const KING_WINNERS_STAY_AS_PARTNERSHIP = true;

/**
 * Challengers are drawn from the top of the fairness queue (not random).
 * confirm with product owner
 */
export const KING_CHALLENGERS_FROM_QUEUE_TOP = true;

/** Allowed court range. */
export const MIN_COURTS = 1;
export const MAX_COURTS = 4;

/* ------------------------------------------------------------------ *
 * Win/Lose neutral-queue fairness floor.
 * DECISION: this is a product default — confirm with product owner.
 * ------------------------------------------------------------------ */

/**
 * A neutral-queue player (never had a result yet) who has waited through
 * this many round-completions without a result is guaranteed the next open
 * seat, ahead of continuing to pull fresh Winners/Losers pairs — so a
 * genuine newcomer can never be passed over indefinitely.
 */
export const WIN_LOSE_NEUTRAL_FLOOR_ROUNDS = 3;
