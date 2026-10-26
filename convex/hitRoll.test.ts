import { afterEach, describe, expect, test, vi } from "vitest";
import { rollAttackHit, rollPowerHit } from "./hitRoll";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Math.random() in [0,1) -> a fixed value, so rolls are deterministic. */
function mockRandom(value: number) {
  vi.spyOn(Math, "random").mockReturnValue(value);
}

describe("rollAttackHit", () => {
  test("a crit multiplies the attack, and the roll reports it", () => {
    mockRandom(0.5);
    // variance 0.9 + 0.5 * 0.2 = 1
    const crit = rollAttackHit({
      attack: 100,
      critChance: 51,
      critMultiplier: 2,
    });
    expect(crit.isCrit).toBe(true);
    expect(crit.damage).toBe(200);

    mockRandom(0.99);
    const miss = rollAttackHit({
      attack: 100,
      critChance: 50,
      critMultiplier: 2,
    });
    expect(miss.isCrit).toBe(false);
    // variance 0.9 + 0.99 * 0.2 = 1.098
    expect(miss.damage).toBe(110);
  });

  test("mitigation is subtracted after the roll", () => {
    mockRandom(0.5);
    const hit = rollAttackHit({
      attack: 100,
      critChance: 0,
      critMultiplier: 1,
      mitigation: 30,
    });
    expect(hit.damage).toBe(70);
  });

  test("an extra multiplier applies before the mitigation", () => {
    mockRandom(0.5);
    const hit = rollAttackHit({
      attack: 100,
      critChance: 0,
      critMultiplier: 1,
      multiplier: 0.5,
      mitigation: 10,
    });
    expect(hit.damage).toBe(40);
  });

  test("damage never falls below the floor", () => {
    mockRandom(0.5);
    expect(
      rollAttackHit({
        attack: 10,
        critChance: 0,
        critMultiplier: 1,
        mitigation: 500,
      }).damage
    ).toBe(1);
    expect(
      rollAttackHit({
        attack: 10,
        critChance: 0,
        critMultiplier: 1,
        mitigation: 500,
        minimum: 0,
      }).damage
    ).toBe(0);
  });

  test("the variance band swings the damage by ten percent either way", () => {
    mockRandom(0);
    const low = rollAttackHit({ attack: 100, critChance: 0, critMultiplier: 1 });
    mockRandom(0.999);
    const high = rollAttackHit({
      attack: 100,
      critChance: 0,
      critMultiplier: 1,
    });
    expect(low.damage).toBe(90);
    expect(high.damage).toBe(110);
  });
});

describe("rollPowerHit", () => {
  test("the roll is the power plus a slice of itself", () => {
    mockRandom(0);
    expect(rollPowerHit({ power: 100 })).toBe(100);
    mockRandom(0.999);
    expect(rollPowerHit({ power: 100 })).toBe(149);
  });

  test("mitigation is subtracted and the floor is respected", () => {
    mockRandom(0);
    expect(rollPowerHit({ power: 100, mitigation: 40 })).toBe(60);
    expect(rollPowerHit({ power: 100, mitigation: 500 })).toBe(1);
    expect(
      rollPowerHit({ power: 100, mitigation: 500, minimum: 0 })
    ).toBe(0);
  });
});
