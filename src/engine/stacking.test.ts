import { describe, expect, it } from "vitest";
import { reduce } from "./reducer";
import { courtsView, waitingQueue } from "./selectors";
import { startSession } from "./sim";
import { invariantErrors, roster, seatedIds } from "./test-utils";
import type { Format, GameMode, Player, SessionState } from "./types";

const zero = () => 0;

function session(
  players: number,
  opts: { courts?: number; format?: Format; gameMode?: GameMode } = {},
): SessionState {
  return startSession(
    {
      courts: opts.courts ?? 1,
      format: opts.format ?? "doubles",
      gameMode: opts.gameMode ?? "rotating",
      playerNames: roster(players),
    },
    zero,
  );
}

function player(s: SessionState, id: string): Player {
  const p = s.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`player ${id} vanished`);
  return p;
}

function courtIndexOf(state: SessionState, id: string): number {
  return courtsView(state).findIndex(
    (c) => c.occupied && [...c.teamA, ...c.teamB].some((p) => p.id === id),
  );
}

function sideOf(state: SessionState, id: string): string[] {
  const c = state.courts.find((c) => c != null && (c.teamA.includes(id) || c.teamB.includes(id)));
  if (!c) throw new Error("player not seated");
  return c.teamA.includes(id) ? c.teamA : c.teamB;
}

/** Fail loudly if any seated stacked player's partner ends up on the OTHER team. */
function assertNoStackSplit(state: SessionState): void {
  for (const c of state.courts) {
    if (!c) continue;
    for (const id of [...c.teamA, ...c.teamB]) {
      const p = state.players.find((pl) => pl.id === id);
      if (!p?.stackedWith) continue;
      const onA = c.teamA.includes(id);
      const otherTeam = onA ? c.teamB : c.teamA;
      if (otherTeam.includes(p.stackedWith)) {
        throw new Error(`stack split: ${id} and ${p.stackedWith} on opposite teams`);
      }
    }
  }
}

describe("set stack", () => {
  it("links two players symmetrically", () => {
    const s0 = session(6);
    const s1 = reduce(s0, { type: "SET_STACK", a: "p1", b: "p2" }, zero);
    expect(player(s1, "p1").stackedWith).toBe("p2");
    expect(player(s1, "p2").stackedWith).toBe("p1");
  });

  it("reassigning a player's stack clears the old partner's link on both sides", () => {
    let s = session(6);
    s = reduce(s, { type: "SET_STACK", a: "p1", b: "p2" }, zero);
    s = reduce(s, { type: "SET_STACK", a: "p1", b: "p3" }, zero);
    expect(player(s, "p1").stackedWith).toBe("p3");
    expect(player(s, "p3").stackedWith).toBe("p1");
    expect(player(s, "p2").stackedWith).toBeNull();
  });

  it("no-ops in singles format", () => {
    const s0 = session(6, { format: "singles" });
    const s1 = reduce(s0, { type: "SET_STACK", a: "p1", b: "p2" }, zero);
    expect(s1).toEqual(s0);
  });

  it("no-ops for a self-pair or an unknown id", () => {
    const s0 = session(6);
    expect(reduce(s0, { type: "SET_STACK", a: "p1", b: "p1" }, zero)).toEqual(s0);
    expect(reduce(s0, { type: "SET_STACK", a: "p1", b: "does-not-exist" }, zero)).toEqual(s0);
  });
});

describe("guaranteed pairing", () => {
  it("a stacked pair is always selected together, never one without the other", () => {
    const s0 = session(6); // 4 playing, 2 waiting
    const target = waitingQueue(s0)[0].id; // currently waiting
    const partner = waitingQueue(s0)[1].id; // also currently waiting
    // Re-trigger assignment: they were already seated from START_SESSION, so
    // stack two of the CURRENTLY WAITING players and confirm they get pulled
    // together once a court frees up.
    let s = reduce(s0, { type: "SET_STACK", a: target, b: partner }, zero);
    const courtIdx = 0;
    s = reduce(s, { type: "FINISH_COURT", court: courtIdx, winner: "A" }, zero);
    expect(seatedIds(s)).toContain(target);
    expect(seatedIds(s)).toContain(partner);
    assertNoStackSplit(s);
  });

  it("a stacked pair is never split across teams, across many rounds", () => {
    let s = session(10, { courts: 2 });
    s = reduce(s, { type: "SET_STACK", a: "p3", b: "p6" }, zero);
    s = reduce(s, { type: "SET_STACK", a: "p2", b: "p9" }, zero);
    for (let i = 0; i < 60; i++) {
      const occ = courtsView(s)
        .filter((c) => c.occupied)
        .map((c) => c.index);
      if (occ.length === 0) break;
      s = reduce(s, { type: "FINISH_COURT", court: occ[i % occ.length], winner: "A" }, zero);
      assertNoStackSplit(s);
    }
    expect(invariantErrors(s)).toEqual([]);
  });

  it("two stacked pairs can fill one doubles court together", () => {
    // 8 players, 1 court: p1-p4 seat immediately, p5-p8 start out waiting.
    let s = session(8, { courts: 1 });
    s = reduce(s, { type: "SET_STACK", a: "p5", b: "p6" }, zero);
    s = reduce(s, { type: "SET_STACK", a: "p7", b: "p8" }, zero);
    // Free up the court so the stacked (currently-waiting) foursome seats.
    s = reduce(s, { type: "CLEAR_COURT", court: 0 }, zero);
    expect(sideOf(s, "p5")).toContain("p6");
    expect(sideOf(s, "p7")).toContain("p8");
    assertNoStackSplit(s);
  });

  it("skips a stacked pair that doesn't fit the last remaining seat, then picks them up next round", () => {
    // Hand-build state: P1,P2,P3 solo (fairest, join order), P4+P5 stacked
    // (next fairest), P6 solo (least fair). need=4 for one doubles court.
    const base = session(1); // just to get a valid shell; overwritten below
    const mk = (id: string, enteredAt: number, stackedWith: string | null = null): Player => ({
      id,
      name: id,
      games: 0,
      seed: 0,
      status: "waiting",
      enteredAt,
      lastGameRound: 0,
      holdAfter: false,
      stackedWith,
      partners: {},
      opps: {},
      streak: 0,
    });
    const s0: SessionState = {
      ...base,
      started: true,
      courtsCount: 1,
      courts: [null],
      players: [
        mk("p1", 1),
        mk("p2", 2),
        mk("p3", 3),
        mk("p4", 4, "p5"),
        mk("p5", 5, "p4"),
        mk("p6", 6),
      ],
    };
    // ADD_PLAYERS with an empty list just re-triggers assignEmptyCourts.
    const s1 = reduce(s0, { type: "ADD_PLAYERS", names: [] }, zero);
    expect(seatedIds(s1).sort()).toEqual(["p1", "p2", "p3", "p6"]);
    expect(player(s1, "p4").status).toBe("waiting");
    expect(player(s1, "p5").status).toBe("waiting");

    // Next opening: the deferred pair is the fairest remaining and gets seated together.
    const s2 = reduce(s1, { type: "FINISH_COURT", court: 0, winner: "A" }, zero);
    expect(seatedIds(s2)).toContain("p4");
    expect(seatedIds(s2)).toContain("p5");
    assertNoStackSplit(s2);
  });

  it("a stacked pair's queue position moves together in the waiting order", () => {
    // Hand-build 3 waiting players with distinct, controlled queue positions:
    // p1 (fairest, games=0), p2 (middle, games=1), p3 (least fair, games=2).
    const base = session(1);
    const mk = (id: string, games: number, enteredAt: number, stackedWith: string | null = null): Player => ({
      id,
      name: id,
      games,
      seed: 0,
      status: "waiting",
      enteredAt,
      lastGameRound: 0,
      holdAfter: false,
      stackedWith,
      partners: {},
      opps: {},
      streak: 0,
    });
    const s0: SessionState = {
      ...base,
      started: true,
      courtsCount: 1,
      courts: [null],
      players: [mk("p1", 0, 1), mk("p2", 1, 2), mk("p3", 2, 3)],
    };
    expect(waitingQueue(s0).map((p) => p.id)).toEqual(["p1", "p2", "p3"]);

    // Stack the fairest (p1) with the least fair (p3): p1 should now sort at
    // p3's (worse) position, landing adjacent to p3 with p2 pushed ahead of both.
    const s1 = reduce(s0, { type: "SET_STACK", a: "p1", b: "p3" }, zero);
    const order = waitingQueue(s1).map((p) => p.id);
    expect(order).toEqual(["p2", "p1", "p3"]);
  });
});

describe("format switching", () => {
  it("has no effect in singles, and resumes once back in doubles", () => {
    let s = session(6, { format: "doubles" });
    s = reduce(s, { type: "SET_STACK", a: "p1", b: "p2" }, zero);
    s = reduce(s, { type: "SET_FORMAT", format: "singles" }, zero);
    // Link survives, inert.
    expect(player(s, "p1").stackedWith).toBe("p2");
    s = reduce(s, { type: "SET_FORMAT", format: "doubles" }, zero);
    expect(player(s, "p1").stackedWith).toBe("p2");
    // Force a fresh redraw and confirm they're paired again.
    s = reduce(s, { type: "CLEAR_COURT", court: 0 }, zero);
    if (seatedIds(s).includes("p1")) {
      expect(sideOf(s, "p1")).toContain("p2");
    }
  });
});

describe("mode switch and Mix All composability", () => {
  it("MIX_ALL doesn't break an existing stack", () => {
    let s = session(8, { courts: 2 });
    s = reduce(s, { type: "SET_STACK", a: "p1", b: "p2" }, zero);
    s = reduce(s, { type: "MIX_ALL" }, zero);
    expect(player(s, "p1").stackedWith).toBe("p2");
    assertNoStackSplit(s);
  });

  it("switching game modes doesn't break an existing stack", () => {
    let s = session(8, { courts: 2 });
    s = reduce(s, { type: "SET_STACK", a: "p1", b: "p2" }, zero);
    s = reduce(s, { type: "SET_GAME_MODE", gameMode: "king" }, zero);
    expect(player(s, "p1").stackedWith).toBe("p2");
    s = reduce(s, { type: "SET_GAME_MODE", gameMode: "rotating" }, zero);
    expect(player(s, "p1").stackedWith).toBe("p2");
    assertNoStackSplit(s);
  });
});

describe("substitution independence", () => {
  it("subbing one half of a stacked pair off court leaves the other half's seat untouched", () => {
    let s = session(6);
    const outId = seatedIds(s)[0];
    const partnerId = seatedIds(s)[1]; // same court
    s = reduce(s, { type: "SET_STACK", a: outId, b: partnerId }, zero);
    const courtIdx = courtIndexOf(s, outId);
    const before = player(s, partnerId);
    s = reduce(s, { type: "SUBSTITUTE_PLAYER", court: courtIdx, outId }, zero);
    const after = player(s, partnerId);
    expect(after.status).toBe(before.status);
    expect(seatedIds(s)).toContain(partnerId);
  });

  it("the incoming substitute isn't linked as newly stacked", () => {
    let s = session(6);
    const outId = seatedIds(s)[0];
    const incomingId = waitingQueue(s)[0].id;
    s = reduce(s, { type: "SUBSTITUTE_PLAYER", court: courtIndexOf(s, outId), outId }, zero);
    expect(player(s, incomingId).stackedWith).toBeNull();
  });
});
