import { describe, expect, it } from "vitest";
import { KING_MAX_CONSECUTIVE_WINS } from "./constants";
import { strategyFor } from "./modes";
import { reduce } from "./reducer";
import { courtsView, onHold } from "./selectors";
import { makeRng, startSession } from "./sim";
import type { SessionState } from "./types";
import { invariantErrors, roster, seatedIds } from "./test-utils";

const zero = () => 0;

function king(players: number, courts = 1): SessionState {
  return startSession(
    {
      courts,
      format: "doubles",
      gameMode: "king",
      playerNames: roster(players),
    },
    zero,
  );
}

describe("game-mode strategy interface", () => {
  it("king needs a winner; rotating does not", () => {
    expect(strategyFor("king").needsWinner).toBe(true);
    expect(strategyFor("rotating").needsWinner).toBe(false);
  });
});

describe("king of the court", () => {
  it("winners stay (streak 1) and losers leave after one game", () => {
    let s = king(6);
    const view = courtsView(s)[0];
    const winners = view.teamA.map((p) => p.id);
    const losers = view.teamB.map((p) => p.id);

    s = reduce(s, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);

    const seated = new Set(seatedIds(s));
    for (const id of winners) expect(seated.has(id), `winner ${id} stays`).toBe(true);
    for (const id of losers) expect(seated.has(id), `loser ${id} leaves`).toBe(false);
    expect(courtsView(s)[0].streak).toBe(1);
    expect(invariantErrors(s)).toEqual([]);
  });

  it("winners rotate off once they hit the consecutive-win cap", () => {
    let s = king(6);
    const winners = courtsView(s)[0].teamA.map((p) => p.id);

    // Win repeatedly; winners stay as team A each time until the cap.
    for (let i = 0; i < KING_MAX_CONSECUTIVE_WINS; i++) {
      expect(courtsView(s)[0].teamA.map((p) => p.id)).toEqual(winners);
      s = reduce(s, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);
    }

    // After hitting the cap they must no longer be seated (highest game count,
    // so fairness won't re-seat them immediately either).
    const seated = new Set(seatedIds(s));
    for (const id of winners) {
      expect(seated.has(id), `capped winner ${id} rotated off`).toBe(false);
    }
    expect(invariantErrors(s)).toEqual([]);
  });

  it("singles: the single winner stays, challenger comes up", () => {
    let s = startSession(
      { courts: 1, format: "singles", gameMode: "king", playerNames: roster(4) },
      zero,
    );
    const winner = courtsView(s)[0].teamA.map((p) => p.id);
    s = reduce(s, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);
    expect(seatedIds(s)).toContain(winner[0]);
    expect(courtsView(s)[0].teamA.length).toBe(1);
    expect(courtsView(s)[0].teamB.length).toBe(1);
  });

  it("a winner flagged to hold rotates off instead of staying", () => {
    let s = king(6);
    const winners = courtsView(s)[0].teamA.map((p) => p.id);
    s = reduce(s, { type: "HOLD_PLAYER", id: winners[0] }, zero); // hold mid-game
    s = reduce(s, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);
    // The held winner is benched...
    expect(onHold(s).map((p) => p.id)).toContain(winners[0]);
    // ...and the partnership is broken, so the other winner isn't kept up as a
    // lone staying player on a fresh court.
    expect(courtsView(s)[0].streak).toBe(0);
    expect(invariantErrors(s)).toEqual([]);
  });

  it("keeps state valid over a long king session with random winners", () => {
    const rng = makeRng(42);
    let s = king(13, 2);
    let cursor = 0;
    for (let i = 0; i < 120; i++) {
      const occ = courtsView(s)
        .filter((c) => c.occupied)
        .map((c) => c.index);
      if (occ.length === 0) break;
      const court = occ[cursor++ % occ.length];
      s = reduce(s, { type: "FINISH_COURT", court, winner: rng() < 0.5 ? "A" : "B" }, rng);
      expect(invariantErrors(s)).toEqual([]);
      // Nobody may exceed the consecutive-win cap.
      for (const c of courtsView(s)) {
        expect(c.streak).toBeLessThan(KING_MAX_CONSECUTIVE_WINS);
      }
    }
  });
});
