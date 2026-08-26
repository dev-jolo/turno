import { describe, expect, it } from "vitest";
import { reduce } from "./reducer";
import { courtsView, onHold, waitingQueue } from "./selectors";
import { startSession } from "./sim";
import { invariantErrors, roster, seatedIds } from "./test-utils";
import type { Format, GameMode, SessionState } from "./types";

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

/** Play `n` games, round-robin finishing whichever courts are occupied. */
function playGames(start: SessionState, n: number): SessionState {
  let state = start;
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const occ = courtsView(state)
      .filter((c) => c.occupied)
      .map((c) => c.index);
    if (occ.length === 0) break;
    const court = occ[cursor++ % occ.length];
    state = reduce(state, { type: "FINISH_COURT", court, winner: "A" }, zero);
  }
  return state;
}

function courtIndexOf(state: SessionState, id: string): number {
  return courtsView(state).findIndex(
    (c) => c.occupied && [...c.teamA, ...c.teamB].some((p) => p.id === id),
  );
}

function sideOf(state: SessionState, id: string): "teamA" | "teamB" {
  const c = state.courts.find((c) => c != null && (c.teamA.includes(id) || c.teamB.includes(id)));
  if (!c) throw new Error("player not seated");
  return c.teamA.includes(id) ? "teamA" : "teamB";
}

describe("substitute (automatic)", () => {
  it("fills the vacated seat with the fairest currently-waiting player", () => {
    const s0 = session(6); // 4 playing, 2 waiting
    const outId = seatedIds(s0)[0];
    const expectedIn = waitingQueue(s0)[0].id;
    const s1 = reduce(s0, { type: "SUBSTITUTE_PLAYER", court: courtIndexOf(s0, outId), outId }, zero);
    expect(seatedIds(s1)).toContain(expectedIn);
    expect(seatedIds(s1)).not.toContain(outId);
    expect(invariantErrors(s1)).toEqual([]);
  });

  it("benches the outgoing player immediately, not deferred", () => {
    const s0 = session(6);
    const outId = seatedIds(s0)[0];
    const s1 = reduce(s0, { type: "SUBSTITUTE_PLAYER", court: courtIndexOf(s0, outId), outId }, zero);
    const out = s1.players.find((p) => p.id === outId);
    if (!out) throw new Error("player vanished");
    expect(out.status).toBe("hold");
    expect(out.holdAfter).toBe(false);
    expect(out.streak).toBe(0);
    expect(onHold(s1).map((p) => p.id)).toContain(outId);
  });

  it("seats the substitute on the exact side the outgoing player vacated", () => {
    const s0 = session(6);
    const outId = seatedIds(s0)[0];
    const side = sideOf(s0, outId);
    const expectedIn = waitingQueue(s0)[0].id;
    const s1 = reduce(s0, { type: "SUBSTITUTE_PLAYER", court: courtIndexOf(s0, outId), outId }, zero);
    expect(sideOf(s1, expectedIn)).toBe(side);
    const inPlayer = s1.players.find((p) => p.id === expectedIn);
    if (!inPlayer) throw new Error("player vanished");
    expect(inPlayer.status).toBe("playing");
    expect(inPlayer.streak).toBe(0);
  });

  it("leaves the substitute's fairness stats untouched until the game finishes", () => {
    const s0 = playGames(session(6), 6); // give games/history a chance to become nonzero
    const outId = seatedIds(s0)[0];
    const incoming = waitingQueue(s0)[0];
    expect(incoming.games).toBeGreaterThan(0); // otherwise this test can't catch a reset-to-0 bug
    const s1 = reduce(s0, { type: "SUBSTITUTE_PLAYER", court: courtIndexOf(s0, outId), outId }, zero);
    const after = s1.players.find((p) => p.id === incoming.id);
    if (!after) throw new Error("player vanished");
    expect(after.games).toBe(incoming.games);
    expect(after.seed).toBe(incoming.seed);
    expect(after.partners).toEqual(incoming.partners);
    expect(after.opps).toEqual(incoming.opps);
  });

  it("leaves the other players on the court untouched", () => {
    const s0 = session(6);
    const outId = seatedIds(s0)[0];
    const courtIdx = courtIndexOf(s0, outId);
    const others = seatedIds(s0).filter((id) => id !== outId);
    const beforeOthers = others.map((id) => s0.players.find((p) => p.id === id));
    const s1 = reduce(s0, { type: "SUBSTITUTE_PLAYER", court: courtIdx, outId }, zero);
    for (const id of others) {
      expect(seatedIds(s1)).toContain(id);
      const before = beforeOthers.find((p) => p?.id === id);
      const after = s1.players.find((p) => p.id === id);
      expect(after?.status).toBe(before?.status);
      expect(after?.partners).toEqual(before?.partners);
      expect(after?.opps).toEqual(before?.opps);
    }
  });

  it("no-ops when there is nobody waiting to sub in", () => {
    const s0 = session(4); // exactly fills the one court, nobody waiting
    const outId = seatedIds(s0)[0];
    const s1 = reduce(s0, { type: "SUBSTITUTE_PLAYER", court: courtIndexOf(s0, outId), outId }, zero);
    expect(s1).toEqual(s0);
  });

  it("works for singles", () => {
    const s0 = session(3, { format: "singles" }); // 2 playing, 1 waiting
    const outId = seatedIds(s0)[0];
    const expectedIn = waitingQueue(s0)[0].id;
    const s1 = reduce(s0, { type: "SUBSTITUTE_PLAYER", court: courtIndexOf(s0, outId), outId }, zero);
    expect(seatedIds(s1)).toContain(expectedIn);
    expect(invariantErrors(s1)).toEqual([]);
  });

  it("works for king mode", () => {
    const s0 = session(6, { gameMode: "king" });
    const outId = seatedIds(s0)[0];
    const expectedIn = waitingQueue(s0)[0].id;
    const s1 = reduce(s0, { type: "SUBSTITUTE_PLAYER", court: courtIndexOf(s0, outId), outId }, zero);
    expect(seatedIds(s1)).toContain(expectedIn);
    expect(invariantErrors(s1)).toEqual([]);
  });

  it("tallies normally for the substitute once the court's game finishes", () => {
    const s0 = session(6);
    const outId = seatedIds(s0)[0];
    const incomingId = waitingQueue(s0)[0].id;
    const courtIdx = courtIndexOf(s0, outId);
    const s1 = reduce(s0, { type: "SUBSTITUTE_PLAYER", court: courtIdx, outId }, zero);
    const before = s1.players.find((p) => p.id === incomingId);
    if (!before) throw new Error("player vanished");
    const s2 = reduce(s1, { type: "FINISH_COURT", court: courtIdx, winner: "A" }, zero);
    const after = s2.players.find((p) => p.id === incomingId);
    if (!after) throw new Error("player vanished");
    expect(after.games).toBe(before.games + 1);
    expect(invariantErrors(s2)).toEqual([]);
  });
});

describe("substitute (manual)", () => {
  it("fills the vacated seat with the specified waiting player", () => {
    const s0 = session(6); // 4 playing, 2 waiting
    const outId = seatedIds(s0)[0];
    const chosen = waitingQueue(s0)[1].id; // not the fairest pick — a deliberate choice
    const s1 = reduce(
      s0,
      { type: "SUBSTITUTE_PLAYER", court: courtIndexOf(s0, outId), outId, inId: chosen },
      zero,
    );
    expect(seatedIds(s1)).toContain(chosen);
    expect(seatedIds(s1)).not.toContain(outId);
    const in1 = s1.players.find((p) => p.id === chosen);
    expect(in1?.status).toBe("playing");
    const out1 = s1.players.find((p) => p.id === outId);
    expect(out1?.status).toBe("hold");
    expect(invariantErrors(s1)).toEqual([]);
  });

  it("no-ops when the chosen target is on hold, not waiting", () => {
    const s0 = session(6);
    const outId = seatedIds(s0)[0];
    const heldId = waitingQueue(s0)[0].id;
    const s0Held = reduce(s0, { type: "HOLD_PLAYER", id: heldId }, zero);
    const s1 = reduce(
      s0Held,
      { type: "SUBSTITUTE_PLAYER", court: courtIndexOf(s0Held, outId), outId, inId: heldId },
      zero,
    );
    expect(s1).toEqual(s0Held);
  });

  it("no-ops when the chosen target is already playing on another court", () => {
    const s0 = session(10, { courts: 2 }); // 8 playing across 2 courts, 2 waiting
    const outId = seatedIds(s0)[0];
    const courtIdx = courtIndexOf(s0, outId);
    const otherPlaying = seatedIds(s0).find(
      (id) => id !== outId && courtIndexOf(s0, id) !== courtIdx,
    );
    if (!otherPlaying) throw new Error("expected a player on another court");
    const s1 = reduce(
      s0,
      { type: "SUBSTITUTE_PLAYER", court: courtIdx, outId, inId: otherPlaying },
      zero,
    );
    expect(s1).toEqual(s0);
  });

  it("leaves the manually-chosen substitute's fairness stats untouched", () => {
    const s0 = playGames(session(6), 6); // give games/history a chance to become nonzero
    const outId = seatedIds(s0)[0];
    const chosen = waitingQueue(s0)[1];
    expect(chosen.games).toBeGreaterThan(0); // otherwise this test can't catch a reset-to-0 bug
    const s1 = reduce(
      s0,
      { type: "SUBSTITUTE_PLAYER", court: courtIndexOf(s0, outId), outId, inId: chosen.id },
      zero,
    );
    const after = s1.players.find((p) => p.id === chosen.id);
    if (!after) throw new Error("player vanished");
    expect(after.games).toBe(chosen.games);
    expect(after.seed).toBe(chosen.seed);
  });
});
