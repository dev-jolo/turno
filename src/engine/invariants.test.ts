import { describe, expect, it } from "vitest";
import { reduce } from "./reducer";
import { courtsView } from "./selectors";
import { makeRng, startSession } from "./sim";
import type { Format, GameMode, Winner } from "./types";
import { activeGamesGap, invariantErrors, roster } from "./test-utils";

const FORMATS: Format[] = ["doubles", "singles"];
const MODES: GameMode[] = ["rotating", "king"];
const COURT_COUNTS = [1, 2, 3, 4];
// Below one court, partial, exact-fill, and large rosters.
const PLAYER_COUNTS = [2, 3, 5, 7, 8, 9, 11, 16, 23, 40];

interface Config {
  courts: number;
  format: Format;
  gameMode: GameMode;
  players: number;
}

function* configs(): Generator<Config> {
  for (const courts of COURT_COUNTS) {
    for (const format of FORMATS) {
      for (const gameMode of MODES) {
        for (const players of PLAYER_COUNTS) {
          yield { courts, format, gameMode, players };
        }
      }
    }
  }
}

/**
 * Step the engine through `rounds` finishes, checking invariants every step.
 * `order` controls which occupied court finishes next:
 *  - "random": pathological turnover (stress test for structural invariants).
 *  - "balanced": round-robin, modeling comparable game lengths across courts
 *    (the fair test of the *selection* algorithm).
 */
function drive(cfg: Config, seed: number, rounds: number, order: "random" | "balanced" = "random") {
  const rng = makeRng(seed);
  let state = startSession(
    {
      courts: cfg.courts,
      format: cfg.format,
      gameMode: cfg.gameMode,
      playerNames: roster(cfg.players),
    },
    rng,
  );

  expect(invariantErrors(state)).toEqual([]);

  let maxGap = activeGamesGap(state);
  let completed = 0;
  let cursor = 0;
  for (let i = 0; i < rounds; i++) {
    const occupied = courtsView(state)
      .filter((c) => c.occupied)
      .map((c) => c.index);
    if (occupied.length === 0) break;
    const court =
      order === "balanced"
        ? occupied[cursor++ % occupied.length]
        : occupied[Math.floor(rng() * occupied.length)];
    const winner: Winner = rng() < 0.5 ? "A" : "B";
    state = reduce(state, { type: "FINISH_COURT", court, winner }, rng);
    const errs = invariantErrors(state);
    expect(errs, `config ${JSON.stringify(cfg)} step ${i}`).toEqual([]);
    maxGap = Math.max(maxGap, activeGamesGap(state));
    completed += 1;
  }
  return { state, maxGap, completed };
}

describe("structural invariants hold across all configs", () => {
  for (const cfg of configs()) {
    const enoughForACourt = cfg.players >= (cfg.format === "singles" ? 2 : 4);
    it(`no double-booking / capacity — ${JSON.stringify(cfg)}`, () => {
      const { state, completed } = drive(cfg, 12345, 60);
      // Sessions that can field at least one court should complete games.
      if (enoughForACourt) expect(completed).toBeGreaterThan(0);
      expect(invariantErrors(state)).toEqual([]);
    });
  }
});

describe("fairness: games-played spread stays bounded", () => {
  // Use rosters with spare players so the fairness queue can actually balance
  // (an exact-fill roster locks players onto a court — that's what Mix All is
  // for, and is asserted separately).
  const balanceable: Config[] = [];
  for (const cfg of configs()) {
    const per = cfg.format === "singles" ? 2 : 4;
    const cap = cfg.courts * per;
    if (cfg.players > cap && cfg.players >= per) balanceable.push(cfg);
  }

  it("gap stays within a small bound over a long session", () => {
    let worst = 0;
    for (const cfg of balanceable) {
      for (const seed of [1, 7, 99]) {
        const { maxGap } = drive(cfg, seed, 200, "balanced");
        worst = Math.max(worst, maxGap);
        expect(
          maxGap,
          `gap too large for ${JSON.stringify(cfg)} (seed ${seed})`,
        ).toBeLessThanOrEqual(2);
      }
    }
    // Sanity: the bound is meaningful (something actually accumulated games).
    expect(worst).toBeGreaterThan(0);
  });
});
