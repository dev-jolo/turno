import { describe, expect, it } from "vitest";
import { PARTNER_WEIGHT } from "./constants";
import { bestSplit, pairCost } from "./helpers";
import { initialState, reduce } from "./reducer";
import { courtsView } from "./selectors";
import { makeRng, startSession } from "./sim";
import { repeatTotals, roster } from "./test-utils";
import type { Rng } from "./types";

describe("bestSplit / pairCost", () => {
  it("picks the lowest-cost split of four players", () => {
    // Seed history so one pairing is clearly worse than the others.
    let s = initialState();
    s = reduce(s, { type: "ADD_PLAYERS", names: ["A", "B", "C", "D"] });
    const [a, b, c, d] = s.players.map((p) => p.id);
    // A & B have partnered 5 times before.
    const pa = s.players[0];
    const pb = s.players[1];
    pa.partners[b] = 5;
    pb.partners[a] = 5;

    const split = bestSplit(s, [a, b, c, d], () => 0);
    // A and B must not be on the same team.
    const together =
      (split.teamA.includes(a) && split.teamA.includes(b)) ||
      (split.teamB.includes(a) && split.teamB.includes(b));
    expect(together).toBe(false);
    expect(split.cost).toBeLessThanOrEqual(pairCost(s, [a, c], [b, d]));
  });

  it("weights partner repeats more heavily than opponent repeats", () => {
    let s = initialState();
    s = reduce(s, { type: "ADD_PLAYERS", names: ["A", "B"] });
    const [a, b] = s.players.map((p) => p.id);
    s.players[0].partners[b] = 1;
    s.players[1].partners[a] = 1;
    expect(pairCost(s, [a], [b])).toBe(0); // opponents here, no partner cost
    expect(pairCost(s, [a, b], [])).toBe(PARTNER_WEIGHT);
  });
});

/**
 * Naive baseline: identical fairness rotation (doubles) but teams are split
 * RANDOMLY with no mixing optimization. Returns total partner-repeat incidents.
 */
function naiveBaselinePartnerRepeats(
  names: string[],
  courts: number,
  rounds: number,
  rng: Rng,
): number {
  interface P {
    id: string;
    games: number;
    enteredAt: number;
    seated: boolean;
  }
  const players: P[] = names.map((id, i) => ({
    id,
    games: 0,
    enteredAt: i,
    seated: false,
  }));
  let seq = players.length;
  const partners = new Map<string, number>();
  const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const byId = (id: string) => players.find((p) => p.id === id) as P;
  const courtGroups: (string[] | null)[] = new Array(courts).fill(null);

  const waiting = () =>
    players.filter((p) => !p.seated).sort((a, b) => a.games - b.games || a.enteredAt - b.enteredAt);

  const fill = () => {
    for (let i = 0; i < courts; i++) {
      if (courtGroups[i]) continue;
      const w = waiting();
      if (w.length < 4) break;
      const group = w.slice(0, 4).map((p) => p.id);
      // Random split.
      for (let k = group.length - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1));
        [group[k], group[j]] = [group[j], group[k]];
      }
      for (const id of group) byId(id).seated = true;
      courtGroups[i] = group;
    }
  };

  fill();
  let cursor = 0;
  for (let r = 0; r < rounds; r++) {
    const occupied = courtGroups.map((g, i) => (g ? i : -1)).filter((i) => i >= 0);
    if (occupied.length === 0) break;
    const i = occupied[cursor++ % occupied.length];
    const group = courtGroups[i] as string[];
    // teamA = [0,1], teamB = [2,3]
    for (const [x, y] of [
      [group[0], group[1]],
      [group[2], group[3]],
    ]) {
      partners.set(key(x, y), (partners.get(key(x, y)) ?? 0) + 1);
    }
    for (const id of group) {
      const p = byId(id);
      p.games += 1;
      p.seated = false;
      p.enteredAt = seq++;
    }
    courtGroups[i] = null;
    fill();
  }

  let repeats = 0;
  for (const v of partners.values()) if (v > 1) repeats += v - 1;
  return repeats;
}

function enginePartnerRepeats(names: string[], courts: number, rounds: number, rng: Rng): number {
  let state = startSession(
    { courts, format: "doubles", gameMode: "rotating", playerNames: names },
    rng,
  );
  let cursor = 0;
  for (let r = 0; r < rounds; r++) {
    const occupied = courtsView(state)
      .filter((c) => c.occupied)
      .map((c) => c.index);
    if (occupied.length === 0) break;
    const court = occupied[cursor++ % occupied.length];
    state = reduce(state, { type: "FINISH_COURT", court }, rng);
  }
  return repeatTotals(state).partnerRepeats;
}

describe("partner mixing reduces repeats vs a naive random baseline", () => {
  it("engine accumulates fewer partner repeats over a long session", () => {
    // 16 players / 2 courts leaves a full court of spares, so the optimizer has
    // rested players to mix with WITHOUT ever forcing a back-to-back. (At an
    // exact one-court surplus like 12/2, no-back-to-back and partner variety
    // genuinely conflict — we deliberately favor no-back-to-back there.)
    const names = roster(16);
    let engineTotal = 0;
    let baselineTotal = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      engineTotal += enginePartnerRepeats(names, 2, 150, makeRng(seed));
      baselineTotal += naiveBaselinePartnerRepeats(names, 2, 150, makeRng(seed));
    }
    expect(engineTotal).toBeLessThan(baselineTotal);
  });
});
