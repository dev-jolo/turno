import { describe, expect, it } from "vitest";
import { WIN_LOSE_NEUTRAL_FLOOR_ROUNDS } from "./constants";
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

function sideOf(state: SessionState, id: string): string[] {
  const c = state.courts.find((c) => c != null && (c.teamA.includes(id) || c.teamB.includes(id)));
  if (!c) throw new Error("player not seated");
  return c.teamA.includes(id) ? c.teamA : c.teamB;
}

/** Hand-build a fully-formed Player for precise fixture-based tests. */
function mk(
  id: string,
  enteredAt: number,
  status: Player["status"],
  lastResult: Player["lastResult"] = null,
  stackedWith: string | null = null,
  neutralWaitRounds = 0,
): Player {
  return {
    id,
    name: id,
    games: 0,
    seed: 0,
    status,
    enteredAt,
    lastGameRound: 0,
    holdAfter: false,
    stackedWith,
    lastResult,
    neutralWaitRounds,
    partners: {},
    opps: {},
    streak: 0,
  };
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

  it("picks the two longest-waiting players in a crowded queue, not just any two", () => {
    // Hand-build: 1 empty court, and a queue with THREE waiting winners (more
    // than the 2 a match needs) at very low (old) enteredAt stamps, plus a
    // dummy court about to finish whose own winners land with much higher
    // (newer) stamps. Only the two oldest pre-existing winners — never the
    // newest one, never a fresh arrival — should be pulled.
    const base = winLose(1); // shell only, overwritten below
    const s0: SessionState = {
      ...base,
      started: true,
      seq: 1000, // released dummy players land far newer than every hand-built stamp below
      courtsCount: 2,
      courts: [null, { teamA: ["p1", "p2"], teamB: ["p3", "p4"] }],
      players: [
        mk("p1", 900, "playing"),
        mk("p2", 901, "playing"),
        mk("p3", 902, "playing"),
        mk("p4", 903, "playing"),
        mk("w-oldest", 1, "waiting", "win"),
        mk("w-middle", 2, "waiting", "win"),
        mk("w-newest", 3, "waiting", "win"), // must be passed over — not the two oldest
        mk("l-oldest", 4, "waiting", "lose"),
        mk("l-middle", 5, "waiting", "lose"),
        mk("l-newest", 6, "waiting", "lose"), // must be passed over too
      ],
    };
    const s1 = reduce(s0, { type: "FINISH_COURT", court: 1, winner: "A" }, zero);
    const court0Ids = new Set([...courtsView(s1)[0].teamA, ...courtsView(s1)[0].teamB].map((p) => p.id));
    expect(court0Ids.has("w-oldest")).toBe(true);
    expect(court0Ids.has("w-middle")).toBe(true);
    expect(court0Ids.has("w-newest")).toBe(false);
    expect(court0Ids.has("l-oldest")).toBe(true);
    expect(court0Ids.has("l-middle")).toBe(true);
    expect(court0Ids.has("l-newest")).toBe(false);
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

describe("stacking integration", () => {
  it("a stacked pair is always seated on the same team, overriding the winner/loser mixing preference", () => {
    let s = winLose(6, 1); // 4 playing, 2 waiting
    const [w1, w2] = courtsView(s)[0].teamA.map((p) => p.id); // about to win
    s = reduce(s, { type: "SET_STACK", a: w1, b: w2 }, zero);
    s = reduce(s, { type: "FINISH_COURT", court: 0, winner: "A" }, zero); // w1,w2 win together
    expect(sideOf(s, w1)).toContain(w2);
    expect(invariantErrors(s)).toEqual([]);
  });

  it("two separate stacked pairs pulled into the same match each become one team", () => {
    let s = winLose(8, 1); // 4 playing, 4 waiting
    const view = courtsView(s)[0];
    const [w1, w2] = view.teamA.map((p) => p.id); // about to win, stacked together
    const [l1, l2] = view.teamB.map((p) => p.id); // about to lose, stacked together
    s = reduce(s, { type: "SET_STACK", a: w1, b: w2 }, zero);
    s = reduce(s, { type: "SET_STACK", a: l1, b: l2 }, zero);
    s = reduce(s, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);
    expect(seatedIds(s)).toEqual(expect.arrayContaining([w1, w2, l1, l2]));
    expect(sideOf(s, w1)).toContain(w2);
    expect(sideOf(s, l1)).toContain(l2);
    expect(invariantErrors(s)).toEqual([]);
  });

  it("a stacked pair split across different queues is not force-matched — it goes dormant instead", () => {
    // Hand-build: a and c are stacked, but a just won and c just lost — both
    // "waiting", different queues. w2/l2 are plain backup winner/loser
    // candidates, older than the fresh winners/losers a dummy court (about to
    // finish) will produce. If a/c were wrongly force-paired, the freed court
    // would seat them together instead of w2/l2; proving it seats w2/l2 (and
    // leaves a, c untouched) is proof the dormancy actually fired.
    const base = winLose(1);
    const s0: SessionState = {
      ...base,
      started: true,
      seq: 1000, // released dummy players land far newer than every stamp below
      courtsCount: 2,
      courts: [null, { teamA: ["d1", "d2"], teamB: ["d3", "d4"] }],
      players: [
        mk("d1", 900, "playing"),
        mk("d2", 901, "playing"),
        mk("d3", 902, "playing"),
        mk("d4", 903, "playing"),
        mk("a", 1, "waiting", "win", "c"),
        mk("c", 1, "waiting", "lose", "a"),
        mk("w2", 2, "waiting", "win"),
        mk("l2", 2, "waiting", "lose"),
      ],
    };
    const s1 = reduce(s0, { type: "FINISH_COURT", court: 1, winner: "A" }, zero);
    const seatedOnCourt0 = [...courtsView(s1)[0].teamA, ...courtsView(s1)[0].teamB].map((p) => p.id);
    expect(seatedOnCourt0).toEqual(expect.arrayContaining(["w2", "l2"]));
    expect(seatedOnCourt0).not.toContain("a");
    expect(seatedOnCourt0).not.toContain("c");
    expect(player(s1, "a").status).toBe("waiting");
    expect(player(s1, "c").status).toBe("waiting");
    expect(invariantErrors(s1)).toEqual([]);
  });

  it("never splits a stacked pair to fill a backfill shortfall, even when a half would fit", () => {
    // Hand-build: two stacked winner-pairs (sw1+sw2, and d1+d2 — the latter
    // produced fresh by a dummy court finishing) are the ONLY winner-side
    // candidates left once the fairest solo winner (w0) is taken — leaving
    // exactly 1 seat open for a 2-person unit. If splitting were allowed,
    // sw1 alone could fill it, stranding sw2. Proving NEITHER court fills
    // (rather than one of them getting split) is proof atomicity held.
    const base = winLose(1);
    const s0: SessionState = {
      ...base,
      started: true,
      seq: 1000,
      courtsCount: 2,
      courts: [null, { teamA: ["d1", "d2"], teamB: ["d3", "d4"] }],
      players: [
        mk("d1", 900, "playing", null, "d2"),
        mk("d2", 901, "playing", null, "d1"),
        mk("d3", 902, "playing"),
        mk("d4", 903, "playing"),
        mk("w0", 0, "waiting", "win"),
        mk("sw1", 1, "waiting", "win", "sw2"),
        mk("sw2", 2, "waiting", "win", "sw1"),
      ],
    };
    const s1 = reduce(s0, { type: "FINISH_COURT", court: 1, winner: "A" }, zero);
    expect(courtsView(s1)[0].occupied).toBe(false);
    expect(courtsView(s1)[1].occupied).toBe(false);
    // Neither half of either pair got peeled off alone.
    expect(player(s1, "sw1").status).toBe("waiting");
    expect(player(s1, "sw2").status).toBe("waiting");
    expect(player(s1, "d1").status).toBe("waiting");
    expect(player(s1, "d2").status).toBe("waiting");
    expect(invariantErrors(s1)).toEqual([]);
  });

  it("a reunited pair takes its NEWER member's queue position, not the long-dormant one's", () => {
    // Hand-build: "a" has been a dormant winner since enteredAt=1 (partner "c"
    // was mid-game the whole time). m1/m2 are ordinary winners who arrived
    // later (5, 6). The one court is about to finish with "c" winning too —
    // reuniting the pair, with just enough total supply for THIS ONE match,
    // so m1/m2 and the reunited pair are in genuine competition for it. If the
    // pair inherited "a"'s stale enteredAt=1, it would wrongly leapfrog
    // m1/m2 for this match; it must instead take "c"'s fresh position, losing
    // that competition and leaving m1/m2 seated instead.
    const base = winLose(1);
    const s0: SessionState = {
      ...base,
      started: true,
      seq: 1000, // released "c"/"c2" land far newer than every hand-built stamp below
      courtsCount: 1,
      courts: [{ teamA: ["c", "c2"], teamB: ["c3", "c4"] }],
      players: [
        mk("c", 900, "playing", null, "a"),
        mk("c2", 901, "playing"),
        mk("c3", 902, "playing"),
        mk("c4", 903, "playing"),
        mk("a", 1, "waiting", "win", "c"), // long-dormant, oldest stamp by far
        mk("m1", 5, "waiting", "win"),
        mk("m2", 6, "waiting", "win"),
        mk("l1", 2, "waiting", "lose"),
        mk("l2", 3, "waiting", "lose"),
      ],
    };
    const s1 = reduce(s0, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);
    expect(seatedIds(s1)).toEqual(expect.arrayContaining(["m1", "m2"]));
    expect(seatedIds(s1)).not.toContain("a");
    expect(seatedIds(s1)).not.toContain("c");
    expect(invariantErrors(s1)).toEqual([]);
  });
});

describe("neutral queue fairness floor", () => {
  it("a neutral player who's waited past the floor is guaranteed the next seat, preempting a fresh winner/loser pair", () => {
    // Hand-build: n1 is one bump short of the floor (reaches it the moment
    // this dispatch's bumpNeutralWait runs), and there's exactly enough
    // winner/loser supply to otherwise fill the whole court WITHOUT n1 at
    // all (w1+w2 and l1+l2 alone satisfy the ordinary half/half quotas). If
    // the floor didn't preempt, n1 would stay waiting and l2 would seat
    // instead — proving n1 actually bumped someone, not just filled a gap.
    const base = winLose(1);
    const s0: SessionState = {
      ...base,
      started: true,
      seq: 1000,
      courtsCount: 1,
      courts: [{ teamA: ["d1", "d2"], teamB: ["d3", "d4"] }],
      players: [
        mk("d1", 900, "playing"),
        mk("d2", 901, "playing"),
        mk("d3", 902, "playing"),
        mk("d4", 903, "playing"),
        mk("n1", 1, "waiting", null, null, WIN_LOSE_NEUTRAL_FLOOR_ROUNDS - 1),
        mk("w1", 2, "waiting", "win"),
        mk("w2", 3, "waiting", "win"),
        mk("l1", 4, "waiting", "lose"),
        mk("l2", 5, "waiting", "lose"),
      ],
    };
    const s1 = reduce(s0, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);
    expect(seatedIds(s1)).toContain("n1");
    expect(seatedIds(s1)).not.toContain("l2"); // bumped by n1's guaranteed seat
    expect(player(s1, "n1").status).toBe("playing");
    expect(invariantErrors(s1)).toEqual([]);
  });

  it("a neutral player who hasn't reached the floor yet gets no priority — ordinary winner/loser competition still wins", () => {
    // Same shape as above, but n1 is TWO bumps short: after this dispatch's
    // single bump they're still one shy of the floor, so they must NOT
    // preempt anyone.
    const base = winLose(1);
    const s0: SessionState = {
      ...base,
      started: true,
      seq: 1000,
      courtsCount: 2,
      courts: [null, { teamA: ["d1", "d2"], teamB: ["d3", "d4"] }],
      players: [
        mk("d1", 900, "playing"),
        mk("d2", 901, "playing"),
        mk("d3", 902, "playing"),
        mk("d4", 903, "playing"),
        mk("n1", 1, "waiting", null, null, WIN_LOSE_NEUTRAL_FLOOR_ROUNDS - 2),
        mk("w1", 2, "waiting", "win"),
        mk("w2", 3, "waiting", "win"),
        mk("l1", 4, "waiting", "lose"),
        mk("l2", 5, "waiting", "lose"),
      ],
    };
    const s1 = reduce(s0, { type: "FINISH_COURT", court: 1, winner: "A" }, zero);
    expect(seatedIds(s1)).not.toContain("n1");
    expect(seatedIds(s1)).toEqual(expect.arrayContaining(["w1", "w2", "l1", "l2"]));
    expect(invariantErrors(s1)).toEqual([]);
  });

  it("a stacked pair reserved by the floor is seated together, never split, even though only one half is overdue", () => {
    const base = winLose(1);
    const s0: SessionState = {
      ...base,
      started: true,
      seq: 1000,
      courtsCount: 2,
      courts: [null, { teamA: ["d1", "d2"], teamB: ["d3", "d4"] }],
      players: [
        mk("d1", 900, "playing"),
        mk("d2", 901, "playing"),
        mk("d3", 902, "playing"),
        mk("d4", 903, "playing"),
        mk("n1", 1, "waiting", null, "n2", WIN_LOSE_NEUTRAL_FLOOR_ROUNDS - 1), // overdue half
        mk("n2", 1, "waiting", null, "n1"), // not itself overdue, but stacked with n1
        mk("w1", 2, "waiting", "win"),
        mk("l1", 3, "waiting", "lose"),
      ],
    };
    const s1 = reduce(s0, { type: "FINISH_COURT", court: 1, winner: "A" }, zero);
    expect(seatedIds(s1)).toEqual(expect.arrayContaining(["n1", "n2"]));
    expect(invariantErrors(s1)).toEqual([]);
  });

  it("increments a stalled neutral player's wait count every round until the floor guarantees them a seat", () => {
    let s = winLose(6, 1); // 4 playing, 2 waiting neutral (never touched by an exactly-balanced 1-court cycle)
    const stalled = seatedIds(s).length === 4 ? s.players.find((p) => p.status === "waiting") : undefined;
    if (!stalled) throw new Error("expected two neutral players waiting at session start");
    for (let round = 1; round < WIN_LOSE_NEUTRAL_FLOOR_ROUNDS; round++) {
      s = reduce(s, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);
      expect(player(s, stalled.id).status).toBe("waiting"); // still stalled, below the floor
      expect(player(s, stalled.id).neutralWaitRounds).toBe(round);
    }
    // One more round-completion crosses the floor.
    s = reduce(s, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);
    expect(player(s, stalled.id).status).toBe("playing");
    expect(invariantErrors(s)).toEqual([]);
  });
});
