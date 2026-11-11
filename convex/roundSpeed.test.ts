import { afterEach, describe, expect, test, vi } from "vitest";
import { MAX_SWINGS_PER_ROUND, runRoundExchange, swingsInRound } from "./roundCombat";
import { duelFighter, type FighterSnapshot } from "./pvpSnapshot";

function swingsOver(rounds: number, speed: number | undefined, intervalMs = 2000) {
  const perRound: number[] = [];
  for (let r = 1; r <= rounds; r += 1) perRound.push(swingsInRound(r, speed, intervalMs));
  return perRound;
}

describe("swingsInRound", () => {
  test("the default 0.5 attacks a second is one swing per 2s round", () => {
    expect(swingsOver(5, 0.5)).toEqual([1, 1, 1, 1, 1]);
  });

  test("fractional speed carries over between rounds", () => {
    // 0.8/s × 2s = 1.6 swings a round: 8 swings over 5 rounds.
    const swings = swingsOver(5, 0.8);
    expect(swings).toEqual([1, 2, 1, 2, 2]);
    expect(swings.reduce((a, b) => a + b, 0)).toBe(8);
    // 0.25/s × 2s = half a swing: every other round.
    expect(swingsOver(4, 0.25)).toEqual([0, 1, 0, 1]);
  });

  test("float error never drops a swing", () => {
    // 0.35 × 2 = 0.7 swings a round, 7 over 10 rounds.
    expect(swingsOver(10, 0.35).reduce((a, b) => a + b, 0)).toBe(7);
  });

  test("older snapshots without a speed swing once, and speed is capped", () => {
    expect(swingsOver(3, undefined)).toEqual([1, 1, 1]);
    expect(swingsInRound(1, 1_000, 2000)).toBe(MAX_SWINGS_PER_ROUND);
  });
});

const snapshot = (overrides: Partial<FighterSnapshot> = {}): FighterSnapshot => ({
  maxHp: 10_000,
  attack: 10,
  defense: 0,
  magicalDefense: 0,
  critChance: 0,
  critDamageMultiplier: 1.5,
  damageType: "physical",
  ward: 0,
  level: 1,
  handicap: 1,
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("a duelist twice as fast deals twice the swing damage each round", () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const fast = snapshot({ attackSpeed: 1 });
  const slow = snapshot({ attackSpeed: 0.5 });
  const a = duelFighter({ id: "fast", self: fast, opponent: slow, hp: fast.maxHp, roundIntervalMs: 2000 });
  const b = duelFighter({ id: "slow", self: slow, opponent: fast, hp: slow.maxHp, roundIntervalMs: 2000 });
  const sides = [{ fighters: [a] }, { fighters: [b] }];
  let fastDamage = 0;
  let slowDamage = 0;
  for (let round = 1; round <= 10; round += 1) {
    const log = runRoundExchange(sides, { round, roundIntervalMs: 2000 });
    fastDamage += log.swingDamage.fast ?? 0;
    slowDamage += log.swingDamage.slow ?? 0;
  }
  expect(fastDamage).toBe(slowDamage * 2);
});
