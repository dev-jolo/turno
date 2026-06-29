import { describe, expect, it } from "vitest";
import { reduce } from "./reducer";
import { courtsView } from "./selectors";
import { makeRng, startSession } from "./sim";
import { roster, seatedIds } from "./test-utils";
import type { SessionState } from "./types";

/**
 * Count how many players who were on a court when it finished are immediately
 * re-seated on the very next refill (i.e. forced to play back-to-back).
 */
function backToBackOverSession(state: SessionState, rounds: number, rng = makeRng(42)) {
  let s = state;
  let cursor = 0;
  let replays = 0;
  let finishes = 0;
  for (let i = 0; i < rounds; i++) {
    const occ = courtsView(s)
      .filter((c) => c.occupied)
      .map((c) => c.index);
    if (occ.length === 0) break;
    const court = occ[cursor++ % occ.length];
    const c = s.courts[court];
    const before = new Set(c ? [...c.teamA, ...c.teamB] : []);
    s = reduce(s, { type: "FINISH_COURT", court }, rng);
    finishes += 1;
    const after = new Set(seatedIds(s));
    for (const id of before) if (after.has(id)) replays += 1;
  }
  return { replays, finishes };
}

function rotating(players: number, courts: number): SessionState {
  return startSession(
    { courts, format: "doubles", gameMode: "rotating", playerNames: roster(players) },
    makeRng(42),
  );
}

describe("consecutive games happen only when there aren't enough players to rotate", () => {
  it("never seats a just-finished player back-to-back when spares can fill the court", () => {
    // 2 courts need 8 on court; a full extra court of spares (16 players) means
    // every freed court can be filled entirely by rested players.
    const { replays } = backToBackOverSession(rotating(16, 2), 200);
    expect(replays).toBe(0);
  });

  it("a single court with exactly one foursome must reuse everyone (no one to rotate in)", () => {
    const { replays, finishes } = backToBackOverSession(rotating(4, 1), 50);
    // Every finish re-seats the same 4 — unavoidable, this is the allowed case.
    expect(replays).toBe(finishes * 4);
  });

  it("with one spare court the freed court fills from rested players only", () => {
    // 2 courts (8 on court) + 4 spares = exactly one court of rest. After a
    // court frees, the 4 rested spares fill it; nobody plays back-to-back.
    const { replays } = backToBackOverSession(rotating(12, 2), 200);
    expect(replays).toBe(0);
  });
});
