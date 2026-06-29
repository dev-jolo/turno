import { describe, expect, it } from "vitest";
import { initialState, reduce } from "./reducer";
import { courtsView, playingCount, waitingQueue } from "./selectors";
import { makeRng, startSession } from "./sim";
import { invariantErrors, roster, seatedIds } from "./test-utils";
import type { SessionState } from "./types";

const zero = () => 0;

function play(start: SessionState, n: number, rng = makeRng(5)): SessionState {
  let state = start;
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const occ = courtsView(state)
      .filter((c) => c.occupied)
      .map((c) => c.index);
    if (occ.length === 0) break;
    const court = occ[cursor++ % occ.length];
    state = reduce(state, { type: "FINISH_COURT", court, winner: "A" }, rng);
  }
  return state;
}

describe("reducer purity", () => {
  it("does not mutate the input state", () => {
    const s0 = startSession(
      { courts: 2, format: "doubles", gameMode: "rotating", playerNames: roster(8) },
      zero,
    );
    const snapshot = structuredClone(s0);
    reduce(s0, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);
    reduce(s0, { type: "MIX_ALL" }, zero);
    reduce(s0, { type: "ADD_PLAYERS", names: ["X"] }, zero);
    expect(s0).toEqual(snapshot);
  });

  it("RESET returns a fresh initial state", () => {
    let s = startSession(
      { courts: 3, format: "singles", gameMode: "king", playerNames: roster(6) },
      zero,
    );
    s = reduce(s, { type: "RESET" }, zero);
    expect(s).toEqual(initialState());
  });
});

describe("format switch mid-session", () => {
  it("doubles -> singles re-pools without corrupting state", () => {
    let s = startSession(
      { courts: 2, format: "doubles", gameMode: "rotating", playerNames: roster(10) },
      zero,
    );
    s = play(s, 8);
    s = reduce(s, { type: "SET_FORMAT", format: "singles" }, zero);
    expect(s.format).toBe("singles");
    expect(invariantErrors(s)).toEqual([]);
    // Singles: each occupied court has exactly one player per side.
    for (const c of courtsView(s)) {
      if (!c.occupied) continue;
      expect(c.teamA.length).toBe(1);
      expect(c.teamB.length).toBe(1);
    }
    // Round-trip back to doubles.
    s = reduce(s, { type: "SET_FORMAT", format: "doubles" }, zero);
    expect(invariantErrors(s)).toEqual([]);
  });
});

describe("game-mode switch mid-session", () => {
  it("rotating -> king re-pools and stays valid", () => {
    let s = startSession(
      { courts: 2, format: "doubles", gameMode: "rotating", playerNames: roster(12) },
      zero,
    );
    s = play(s, 10);
    const playersBefore = s.players.length;
    s = reduce(s, { type: "SET_GAME_MODE", gameMode: "king" }, zero);
    expect(s.gameMode).toBe("king");
    expect(s.players.length).toBe(playersBefore);
    expect(invariantErrors(s)).toEqual([]);
    // Game can proceed in the new mode with a winner.
    s = reduce(s, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);
    expect(invariantErrors(s)).toEqual([]);
  });
});

describe("court count changes mid-session", () => {
  it("grows and shrinks without losing or duplicating players", () => {
    let s = startSession(
      { courts: 1, format: "doubles", gameMode: "rotating", playerNames: roster(16) },
      zero,
    );
    s = reduce(s, { type: "SET_COURTS", count: 4 }, zero);
    expect(s.courtsCount).toBe(4);
    expect(playingCount(s)).toBe(16);
    expect(invariantErrors(s)).toEqual([]);

    s = reduce(s, { type: "SET_COURTS", count: 2 }, zero);
    expect(s.courtsCount).toBe(2);
    expect(seatedIds(s).length).toBe(8);
    expect(invariantErrors(s)).toEqual([]);
    // Everyone is accounted for: seated + waiting + hold == roster.
    expect(seatedIds(s).length + waitingQueue(s).length).toBe(16);
  });

  it("clamps to the allowed 1..4 range", () => {
    let s = startSession(
      { courts: 2, format: "doubles", gameMode: "rotating", playerNames: roster(8) },
      zero,
    );
    s = reduce(s, { type: "SET_COURTS", count: 99 }, zero);
    expect(s.courtsCount).toBe(4);
    s = reduce(s, { type: "SET_COURTS", count: 0 }, zero);
    expect(s.courtsCount).toBe(1);
  });
});

describe("mix all courts", () => {
  it("counts in-progress games and redraws everyone", () => {
    let s = startSession(
      { courts: 2, format: "doubles", gameMode: "rotating", playerNames: roster(8) },
      zero,
    );
    const before = new Map(s.players.map((p) => [p.id, p.games]));
    s = reduce(s, { type: "MIX_ALL" }, zero);
    // Everyone who was on a court got a game counted (all 8 were playing).
    for (const p of s.players) {
      expect(p.games).toBe((before.get(p.id) ?? 0) + 1);
    }
    expect(invariantErrors(s)).toEqual([]);
  });

  it("breaks fixed foursomes that independent rotation can't mix", () => {
    // 8 players / 2 courts doubles exactly fills both courts: with independent
    // rotation each foursome is locked. Mix All must cross-pollinate.
    const rng = makeRng(9);
    let s = startSession(
      { courts: 2, format: "doubles", gameMode: "rotating", playerNames: roster(8) },
      rng,
    );
    const initialCourt = new Map<string, number>();
    for (const c of courtsView(s)) {
      for (const p of [...c.teamA, ...c.teamB]) initialCourt.set(p.id, c.index);
    }

    // Several synchronized mix rounds.
    for (let r = 0; r < 6; r++) s = reduce(s, { type: "MIX_ALL" }, rng);

    // At least one player has now partnered with someone from the *other*
    // starting court — impossible under locked independent rotation.
    let crossMixed = false;
    for (const p of s.players) {
      const home = initialCourt.get(p.id);
      for (const partnerId of Object.keys(p.partners)) {
        if (initialCourt.get(partnerId) !== home) {
          crossMixed = true;
          break;
        }
      }
      if (crossMixed) break;
    }
    expect(crossMixed).toBe(true);
    expect(invariantErrors(s)).toEqual([]);
  });
});
