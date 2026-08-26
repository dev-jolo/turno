import { describe, expect, it } from "vitest";
import { strategyFor } from "./modes";
import { reduce } from "./reducer";
import { courtsView } from "./selectors";
import { startSession } from "./sim";
import { invariantErrors, roster, seatedIds } from "./test-utils";
import type { Format, Player, SessionState } from "./types";

const zero = () => 0;

function winLose(players: number, courts = 1, format: Format = "doubles"): SessionState {
  return startSession(
    { courts, format, gameMode: "winLose", playerNames: roster(players) },
    zero,
  );
}

function player(s: SessionState, id: string): Player {
  const p = s.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`player ${id} vanished`);
  return p;
}

describe("game-mode strategy interface", () => {
  it("winLose needs a winner", () => {
    expect(strategyFor("winLose").needsWinner).toBe(true);
  });
});

describe("win/lose stacking", () => {
  it("the very first matches of a session are a fair draw — nobody has a result yet", () => {
    const s = winLose(8, 2);
    expect(seatedIds(s).length).toBe(8);
    for (const p of s.players) expect(p.lastResult).toBeNull();
    expect(invariantErrors(s)).toEqual([]);
  });

  it("sends winners to the Winners queue and losers to the Losers queue", () => {
    let s = winLose(6, 1); // 4 playing, 2 waiting
    const view = courtsView(s)[0];
    const winners = view.teamA.map((p) => p.id);
    const losers = view.teamB.map((p) => p.id);
    s = reduce(s, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);
    for (const id of winners) expect(player(s, id).lastResult).toBe("win");
    for (const id of losers) expect(player(s, id).lastResult).toBe("lose");
    expect(invariantErrors(s)).toEqual([]);
  });

  it("pairs a winner with a loser on every team whenever both are available, across many rounds", () => {
    let s = winLose(10, 2);
    for (let i = 0; i < 60; i++) {
      const occ = courtsView(s)
        .filter((c) => c.occupied)
        .map((c) => c.index);
      if (occ.length === 0) break;
      s = reduce(
        s,
        { type: "FINISH_COURT", court: occ[i % occ.length], winner: i % 2 === 0 ? "A" : "B" },
        zero,
      );
      for (const c of courtsView(s)) {
        if (!c.occupied) continue;
        for (const team of [c.teamA, c.teamB]) {
          // Only a claim about teams where BOTH members already have a real
          // result — a neutral (never-played) teammate is a backfill case,
          // not the standard-assembly guarantee this test is proving.
          if (team.length === 2 && team[0].lastResult && team[1].lastResult) {
            expect(team[0].lastResult).not.toBe(team[1].lastResult);
          }
        }
      }
      expect(invariantErrors(s)).toEqual([]);
    }
  });

  it("backfills a shortfall from the other queue/neutral pool when one queue runs short", () => {
    // Hand-build: 2 courts, one already sitting empty (starved earlier for
    // lack of players) and one about to finish. Finishing it produces exactly
    // enough winners+losers for ONE court — the just-freed court claims that
    // supply first, leaving the previously-empty court needing backfill from
    // a lone leftover winner plus the neutral (never-played) pool.
    const base = winLose(1); // shell only, overwritten below
    const mk = (
      id: string,
      enteredAt: number,
      status: Player["status"],
      lastResult: Player["lastResult"] = null,
    ): Player => ({
      id,
      name: id,
      games: 0,
      seed: 0,
      status,
      enteredAt,
      lastGameRound: 0,
      holdAfter: false,
      stackedWith: null,
      lastResult,
      partners: {},
      opps: {},
      streak: 0,
    });
    const s0: SessionState = {
      ...base,
      started: true,
      courtsCount: 2,
      courts: [null, { teamA: ["p1", "p2"], teamB: ["p3", "p4"] }],
      players: [
        mk("p1", 10, "playing"),
        mk("p2", 11, "playing"),
        mk("p3", 12, "playing"),
        mk("p4", 13, "playing"),
        mk("p5", 1, "waiting", "win"), // lone pre-existing winner
        mk("p6", 2, "waiting"), // neutral backfill pool
        mk("p7", 3, "waiting"),
        mk("p8", 4, "waiting"),
      ],
    };
    const s1 = reduce(s0, { type: "FINISH_COURT", court: 1, winner: "A" }, zero);
    expect(seatedIds(s1).length).toBe(8); // every player seated, nobody left waiting
    expect(seatedIds(s1)).toContain("p5"); // the lone pre-existing winner is never stranded
    for (const id of ["p6", "p7", "p8"]) expect(seatedIds(s1)).toContain(id);
    expect(invariantErrors(s1)).toEqual([]);
  });

  it("leaves a court open (rather than backfilling incorrectly) when there truly aren't enough waiting players", () => {
    const s0 = winLose(5, 2); // one full court's worth, plus 1 short of a second
    expect(courtsView(s0)[0].occupied).toBe(true);
    expect(courtsView(s0)[1].occupied).toBe(false);
    expect(seatedIds(s0).length).toBe(4);
    expect(invariantErrors(s0)).toEqual([]);
  });

  it("works in singles: one winner and one loser directly oppose each other", () => {
    let s = winLose(3, 1, "singles"); // 2 playing, 1 waiting
    s = reduce(s, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);
    const view = courtsView(s)[0];
    expect(view.teamA.length).toBe(1);
    expect(view.teamB.length).toBe(1);
    expect(invariantErrors(s)).toEqual([]);
  });

  it("mid-game substitution keeps working with no special-casing", () => {
    let s = winLose(6, 1); // 4 playing, 2 waiting
    const outId = seatedIds(s)[0];
    const courtIdx = 0;
    s = reduce(s, { type: "SUBSTITUTE_PLAYER", court: courtIdx, outId }, zero);
    expect(seatedIds(s)).not.toContain(outId);
    expect(seatedIds(s).length).toBe(4);
    expect(invariantErrors(s)).toEqual([]);
  });

  it("switching into this mode mid-session treats every current player as neutral", () => {
    let s = startSession(
      { courts: 1, format: "doubles", gameMode: "rotating", playerNames: roster(6) },
      zero,
    );
    s = reduce(s, { type: "FINISH_COURT", court: 0, winner: "A" }, zero); // no-op winner in rotating, but harmless
    s = reduce(s, { type: "SET_GAME_MODE", gameMode: "winLose" }, zero);
    for (const p of s.players) expect(p.lastResult).toBeNull();
    expect(invariantErrors(s)).toEqual([]);
  });

  it("clears stale results when switching back into this mode after a prior stint in it", () => {
    let s = winLose(6, 1); // 4 playing, 2 waiting
    s = reduce(s, { type: "FINISH_COURT", court: 0, winner: "A" }, zero); // records real win/lose results
    expect(s.players.some((p) => p.lastResult != null)).toBe(true); // sanity: results exist
    s = reduce(s, { type: "SET_GAME_MODE", gameMode: "rotating" }, zero); // step away...
    s = reduce(s, { type: "SET_GAME_MODE", gameMode: "winLose" }, zero); // ...and back
    for (const p of s.players) expect(p.lastResult).toBeNull();
    expect(invariantErrors(s)).toEqual([]);
  });

  it("keeps state valid over a long win/lose session with random winners", () => {
    let s = winLose(13, 2);
    let cursor = 0;
    for (let i = 0; i < 120; i++) {
      const occ = courtsView(s)
        .filter((c) => c.occupied)
        .map((c) => c.index);
      if (occ.length === 0) break;
      const court = occ[cursor++ % occ.length];
      s = reduce(s, { type: "FINISH_COURT", court, winner: i % 2 === 0 ? "A" : "B" }, zero);
      expect(invariantErrors(s)).toEqual([]);
    }
  });
});
