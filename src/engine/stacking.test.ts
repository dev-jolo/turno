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

/**
 * Fail loudly if two actively-stacked players (doubles) are EVER both
 * `"playing"` at once without being seated together on the same team of the
 * same court. Only fires when BOTH are currently playing — one continuing a
 * game they were already in while a newly-stacked (or reunifying) partner
 * waits for it to end is legitimate and expected, not a violation; the
 * violation is specifically "both on court right now, but not with each
 * other," whether that's split across teams on one court or split across two
 * different courts entirely.
 */
function assertStackedTogether(state: SessionState): void {
  if (state.format !== "doubles") return;
  for (const p of state.players) {
    if (!p.stackedWith || p.status !== "playing") continue;
    const partner = state.players.find((pl) => pl.id === p.stackedWith);
    if (!partner || partner.status !== "playing") continue;
    const c = state.courts.find((c) => c != null && (c.teamA.includes(p.id) || c.teamB.includes(p.id)));
    if (!c) throw new Error(`${p.id} marked playing but not seated on any court`);
    const team = c.teamA.includes(p.id) ? c.teamA : c.teamB;
    if (!team.includes(partner.id)) {
      throw new Error(`stack split: ${p.id} and ${partner.id} not on the same team`);
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

describe("unstack", () => {
  it("clears the link on both sides", () => {
    let s = session(6);
    s = reduce(s, { type: "SET_STACK", a: "p1", b: "p2" }, zero);
    s = reduce(s, { type: "UNSTACK", id: "p1" }, zero);
    expect(player(s, "p1").stackedWith).toBeNull();
    expect(player(s, "p2").stackedWith).toBeNull();
  });

  it("no-ops for a player who isn't stacked", () => {
    const s0 = session(6);
    expect(reduce(s0, { type: "UNSTACK", id: "p1" }, zero)).toEqual(s0);
  });

  it("no-ops for an unknown id", () => {
    const s0 = session(6);
    expect(reduce(s0, { type: "UNSTACK", id: "does-not-exist" }, zero)).toEqual(s0);
  });
});

describe("removal cleanup", () => {
  it("clears the remaining partner's link when a stacked player is permanently removed", () => {
    let s = session(6);
    s = reduce(s, { type: "SET_STACK", a: "p1", b: "p2" }, zero);
    s = reduce(s, { type: "REMOVE_PLAYER", id: "p1" }, zero);
    expect(s.players.some((p) => p.id === "p1")).toBe(false);
    expect(player(s, "p2").stackedWith).toBeNull();
  });

  it("leaves everyone else's links untouched", () => {
    let s = session(8, { courts: 2 });
    s = reduce(s, { type: "SET_STACK", a: "p1", b: "p2" }, zero);
    s = reduce(s, { type: "SET_STACK", a: "p3", b: "p4" }, zero);
    s = reduce(s, { type: "REMOVE_PLAYER", id: "p1" }, zero);
    expect(player(s, "p2").stackedWith).toBeNull();
    expect(player(s, "p3").stackedWith).toBe("p4");
    expect(player(s, "p4").stackedWith).toBe("p3");
  });

  it("removing a PLAYING stacked player clears the partner's link without corrupting the court", () => {
    let s = session(6); // 4 playing, 2 waiting
    const outId = seatedIds(s)[0];
    const partnerId = seatedIds(s)[1]; // same court
    s = reduce(s, { type: "SET_STACK", a: outId, b: partnerId }, zero);
    const courtIdx = courtIndexOf(s, outId);
    s = reduce(s, { type: "REMOVE_PLAYER", id: outId }, zero);

    expect(s.players.some((p) => p.id === outId)).toBe(false);
    expect(player(s, partnerId).stackedWith).toBeNull();
    // REMOVE_PLAYER doesn't redraw (pre-existing, unrelated to stacking) — the
    // court is left one seat short rather than auto-backfilled. The partner's
    // link cleanup is what this ticket is actually responsible for; confirm
    // it didn't also corrupt the court/roster state around it.
    const court = s.courts[courtIdx];
    expect(court?.teamA.includes(outId)).toBe(false);
    expect(court?.teamB.includes(outId)).toBe(false);
    expect([...(court?.teamA ?? []), ...(court?.teamB ?? [])]).toContain(partnerId);
    expect(invariantErrors(s)).toEqual([]);
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
    assertStackedTogether(s);
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
      assertStackedTogether(s);
    }
    expect(invariantErrors(s)).toEqual([]);
  });

  it("sits the free half out (never solo) while their partner is still playing on another court", () => {
    let s = session(10, { courts: 2 }); // 8 playing across 2 courts, 2 waiting (p9, p10)
    const p1Court = courtIndexOf(s, "p1");
    s = reduce(s, { type: "SET_STACK", a: "p1", b: "p9" }, zero); // p1 playing, p9 waiting
    const otherCourt = p1Court === 0 ? 1 : 0;
    // Free up the OTHER court — p1's partner p9 is fairness-eligible and would
    // normally be an easy pick, but p1 is still mid-game.
    s = reduce(s, { type: "FINISH_COURT", court: otherCourt, winner: "A" }, zero);
    expect(player(s, "p9").status).toBe("waiting");
    expect(seatedIds(s)).not.toContain("p9");
    assertStackedTogether(s);

    // Once p1's own court finishes too, they're both waiting and pair up together.
    s = reduce(s, { type: "FINISH_COURT", court: p1Court, winner: "A" }, zero);
    expect(seatedIds(s)).toContain("p1");
    expect(seatedIds(s)).toContain("p9");
    expect(sideOf(s, "p1")).toContain("p9");
    assertStackedTogether(s);
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
    assertStackedTogether(s);
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
    assertStackedTogether(s2);
  });

  it("skip-and-defer never produces a split pair, across many rounds of a tight-capacity session", () => {
    // 6 players, 1 court (need=4): only 2 seats free up each round, so the
    // "does the stacked pair fit the remaining seats this round" tension
    // recurs on essentially every cycle, not just once.
    let s = session(6, { courts: 1 });
    s = reduce(s, { type: "SET_STACK", a: "p4", b: "p5" }, zero);
    for (let i = 0; i < 40; i++) {
      const occ = courtsView(s)
        .filter((c) => c.occupied)
        .map((c) => c.index);
      if (occ.length === 0) break;
      s = reduce(s, { type: "FINISH_COURT", court: occ[0], winner: "A" }, zero);
      assertStackedTogether(s);
    }
    expect(invariantErrors(s)).toEqual([]);
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

  it("an existing stack link has no effect on the selection algorithm in singles", () => {
    // Same shape as the doubles queue-linking test above, but in singles: if
    // the format gate were broken, p1 (games=0) would get boosted to p2's
    // (games=5) effective position and sort last instead of first.
    const base = session(1, { format: "singles" });
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
      format: "singles",
      courtsCount: 1,
      courts: [null],
      players: [mk("p1", 0, 1, "p2"), mk("p3", 0, 2), mk("p2", 5, 3, "p1")],
    };
    expect(waitingQueue(s0).map((p) => p.id)).toEqual(["p1", "p3", "p2"]);
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
    // Switching format already redraws every court (repoolAndRedraw) — confirm
    // that redraw itself paired them, unconditionally (not "if seated").
    expect(seatedIds(s)).toContain("p1");
    expect(sideOf(s, "p1")).toContain("p2");
    assertStackedTogether(s);
  });
});

describe("mode switch and Mix All composability", () => {
  it("MIX_ALL doesn't break an existing stack", () => {
    let s = session(8, { courts: 2 });
    s = reduce(s, { type: "SET_STACK", a: "p1", b: "p2" }, zero);
    s = reduce(s, { type: "MIX_ALL" }, zero);
    expect(player(s, "p1").stackedWith).toBe("p2");
    assertStackedTogether(s);
  });

  it("switching game modes doesn't break an existing stack", () => {
    let s = session(8, { courts: 2 });
    s = reduce(s, { type: "SET_STACK", a: "p1", b: "p2" }, zero);
    s = reduce(s, { type: "SET_GAME_MODE", gameMode: "king" }, zero);
    expect(player(s, "p1").stackedWith).toBe("p2");
    s = reduce(s, { type: "SET_GAME_MODE", gameMode: "rotating" }, zero);
    expect(player(s, "p1").stackedWith).toBe("p2");
    assertStackedTogether(s);
  });
});

describe("substitution independence", () => {
  it("subbing one half of a stacked pair off court leaves the other half's seat and link untouched", () => {
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
    // The link isn't silently rewired to the incoming substitute — it still
    // points at the (now benched) original partner.
    expect(after.stackedWith).toBe(outId);
  });

  it("the incoming substitute isn't linked as newly stacked with anyone", () => {
    // A roster with an UNRELATED stacked pair already present, so this isn't
    // just proving the field is null by construction — it proves substitution
    // doesn't touch stacking at all, even when stacking is active elsewhere.
    let s = session(10, { courts: 2 }); // 8 playing, 2 waiting
    s = reduce(s, { type: "SET_STACK", a: "p1", b: "p2" }, zero); // unrelated pair
    const outId = seatedIds(s).find((id) => id !== "p1" && id !== "p2");
    if (!outId) throw new Error("expected a non-stacked seated player");
    const incomingId = waitingQueue(s)[0].id;
    s = reduce(s, { type: "SUBSTITUTE_PLAYER", court: courtIndexOf(s, outId), outId }, zero);
    expect(player(s, incomingId).stackedWith).toBeNull();
    // No other player was rewired to reference the substitute either.
    expect(s.players.some((p) => p.stackedWith === incomingId)).toBe(false);
    // The unrelated pair is untouched by any of this.
    expect(player(s, "p1").stackedWith).toBe("p2");
    expect(player(s, "p2").stackedWith).toBe("p1");
  });
});
