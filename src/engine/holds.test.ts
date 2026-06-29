import { describe, expect, it } from "vitest";
import { minGames } from "./helpers";
import { reduce } from "./reducer";
import { courtsView, onHold, waitingQueue } from "./selectors";
import { makeRng, startSession } from "./sim";
import type { SessionState } from "./types";
import { invariantErrors, roster, seatedIds } from "./test-utils";

const zero = () => 0;

/** Play `n` balanced games (round-robin court finishing). */
function playGames(s: SessionState, n: number, rng = makeRng(3)): SessionState {
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const occ = courtsView(s)
      .filter((c) => c.occupied)
      .map((c) => c.index);
    if (occ.length === 0) break;
    const court = occ[cursor++ % occ.length];
    s = reduce(s, { type: "FINISH_COURT", court, winner: "A" }, rng);
  }
  return s;
}

function session(players: number, courts = 2): SessionState {
  return startSession(
    { courts, format: "doubles", gameMode: "rotating", playerNames: roster(players) },
    zero,
  );
}

describe("hold", () => {
  it("a waiting player leaves the queue immediately", () => {
    const s0 = session(10); // 8 playing, 2 waiting
    const target = waitingQueue(s0)[0].id;
    const s1 = reduce(s0, { type: "HOLD_PLAYER", id: target }, zero);
    expect(waitingQueue(s1).map((p) => p.id)).not.toContain(target);
    expect(onHold(s1).map((p) => p.id)).toContain(target);
  });

  it("a playing player finishes the game, then benches", () => {
    const s0 = session(8); // exactly 2 courts full, nobody waiting
    const target = seatedIds(s0)[0];
    const s1 = reduce(s0, { type: "HOLD_PLAYER", id: target }, zero);
    // Still on court until the game ends.
    expect(seatedIds(s1)).toContain(target);
    expect(onHold(s1).map((p) => p.id)).not.toContain(target);
    // Finish the court the target is on.
    const courtIdx = courtsView(s1).findIndex(
      (c) => c.occupied && [...c.teamA, ...c.teamB].some((p) => p.id === target),
    );
    const s2 = reduce(s1, { type: "FINISH_COURT", court: courtIdx, winner: "A" }, zero);
    expect(onHold(s2).map((p) => p.id)).toContain(target);
    expect(seatedIds(s2)).not.toContain(target);
  });
});

describe("return re-slots fairly", () => {
  it("returns at the current waiting minimum, at the back of that tier", () => {
    let s = session(11);
    s = playGames(s, 16);
    // Hold someone who is waiting, then let the field pull ahead.
    const held = waitingQueue(s)[0].id;
    s = reduce(s, { type: "HOLD_PLAYER", id: held }, zero);
    const heldGamesWhenBenched = s.players.find((p) => p.id === held)?.games ?? 0;
    s = playGames(s, 12);

    const waitingMin = minGames(s, (p) => p.status === "waiting");
    s = reduce(s, { type: "RETURN_PLAYER", id: held }, zero);

    const back = s.players.find((p) => p.id === held);
    if (!back) throw new Error("player vanished");
    // Not buried below the field, not leapfrogging it: matches the min.
    expect(back.games).toBe(Math.max(heldGamesWhenBenched, waitingMin));
    expect(back.status).toBe("waiting");

    // Back of the tier: among waiting players with the same games, returner is
    // last (largest enteredAt) — so they don't cut the line.
    const sameTier = s.players.filter(
      (p) => p.status === "waiting" && p.games === back.games,
    );
    const maxEntered = Math.max(...sameTier.map((p) => p.enteredAt));
    expect(back.enteredAt).toBe(maxEntered);
    expect(invariantErrors(s)).toEqual([]);
  });
});

describe("latecomers", () => {
  it("start at the current minimum game count", () => {
    let s = session(9);
    s = playGames(s, 20);
    const expected = minGames(s, (p) => p.status !== "hold");
    expect(expected).toBeGreaterThan(0); // session has progressed
    s = reduce(s, { type: "ADD_PLAYERS", names: ["Latecomer"] }, zero);
    const late = s.players.find((p) => p.name === "Latecomer");
    expect(late?.games).toBe(expected);
  });

  it("pre-session players all start at zero", () => {
    const s = session(6);
    expect(s.players.every((p) => p.games === 0)).toBe(true);
  });
});
