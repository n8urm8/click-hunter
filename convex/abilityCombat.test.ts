import { describe, expect, test } from "vitest";
import {
  abilityCastsLog,
  castDueAbilities,
  damageWithBuffs,
  mitigateWithBuffs,
  nextAbilityAt,
  type AbilityBuffState,
  type AbilityCombatState,
} from "./abilityCombat";
import { specFromAbility } from "./abilities";
import type { Doc } from "./_generated/dataModel";

type AbilityDoc = Doc<"abilities">;

function ability(overrides: Partial<AbilityDoc> & Pick<AbilityDoc, "abilityId" | "type">): AbilityDoc {
  return {
    _id: "abilities_test" as AbilityDoc["_id"],
    _creationTime: 0,
    name: overrides.abilityId,
    description: "",
    target: overrides.type === "heal" ? "self" : "enemy",
    weaponType: "any",
    basePower: 20,
    powerScalingPerLevel: 0,
    cooldownMs: 1_000,
    tier: 1,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as AbilityDoc;
}

function stateFor(
  specs: Array<{ doc: AbilityDoc; cooldown: number; level?: number }>,
  extras: Partial<AbilityCombatState> = {}
): AbilityCombatState {
  return {
    runtimes: specs.map((entry) => ({
      spec: specFromAbility(entry.doc),
      level: entry.level ?? 1,
      cooldown: entry.cooldown,
      nextAt: 0,
      casts: 0,
    })),
    buffs: [],
    wisdomMultiplier: 1,
    ...extras,
  };
}

const enemyStats = { defense: 0, magicalDefense: 0 };

describe("buff math", () => {
  const buffs: AbilityBuffState[] = [
    { kind: "damage", value: 25, percent: true, until: 10 },
    { kind: "defense", value: 4, percent: false, until: 10 },
  ];

  test("percent and flat buffs apply while active and expire at `until`", () => {
    expect(damageWithBuffs(100, buffs, 5)).toBe(125);
    expect(damageWithBuffs(100, buffs, 10)).toBe(100);
    expect(mitigateWithBuffs(10, buffs, 5)).toBe(6);
    expect(mitigateWithBuffs(10, buffs, 10)).toBe(10);
  });

  test("the first active buff of a kind wins (matches the auto-battle loop)", () => {
    const stacked: AbilityBuffState[] = [
      { kind: "damage", value: 50, percent: true, until: 10 },
      { kind: "damage", value: 999, percent: true, until: 10 },
    ];
    expect(damageWithBuffs(100, stacked, 5)).toBe(150);
  });
});

describe("castDueAbilities", () => {
  test("magic attack uses magical defense mitigation and advances the cooldown", () => {
    const doc = ability({ abilityId: "bolt", type: "attack", element: "fire", weaponType: "staff", basePower: 40 });
    const state = stateFor([{ doc, cooldown: 3_000 }]);
    const out = castDueAbilities({
      state,
      at: 0,
      retryAt: 100,
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 500,
      enemyStats: { defense: 0, magicalDefense: 10 },
      weapon: { weaponType: "staff", element: "fire" },
    });
    // 40 * 1.25 (staff matches fire) - 10 * 0.5 = 45
    expect(out.damageDealt).toBe(45);
    expect(out.enemyHp).toBe(455);
    expect(state.runtimes[0].nextAt).toBe(3_000);
    expect(abilityCastsLog(state)).toEqual([
      { abilityId: "bolt", level: 1, casts: 1 },
    ]);
  });

  test("a non-due ability does not cast", () => {
    const doc = ability({ abilityId: "bolt", type: "attack", basePower: 40 });
    const state = stateFor([{ doc, cooldown: 3_000 }]);
    state.runtimes[0].nextAt = 5_000;
    const out = castDueAbilities({
      state,
      at: 1_000,
      retryAt: 1_100,
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 500,
      enemyStats,
      weapon: null,
    });
    expect(out.casts).toBe(0);
    expect(out.damageDealt).toBe(0);
    expect(nextAbilityAt(state)).toBe(5_000);
  });

  test("heals never overheal: a heal larger than missing HP is deferred", () => {
    const doc = ability({ abilityId: "heal", type: "heal", target: "self", basePower: 50 });
    const state = stateFor([{ doc, cooldown: 4_000 }]);
    const out = castDueAbilities({
      state,
      at: 0,
      retryAt: 250,
      playerHp: 90,
      playerMaxHp: 100,
      enemyHp: 500,
      enemyStats,
      weapon: null,
    });
    expect(out.healing).toBe(0);
    expect(out.playerHp).toBe(90);
    // Deferred to the retry cadence, not the full cooldown.
    expect(state.runtimes[0].nextAt).toBe(250);
  });

  test("heals cast once enough HP is missing and clamp at max", () => {
    const doc = ability({ abilityId: "heal", type: "heal", target: "self", basePower: 50 });
    const state = stateFor([{ doc, cooldown: 4_000 }]);
    const out = castDueAbilities({
      state,
      at: 0,
      retryAt: 250,
      playerHp: 20,
      playerMaxHp: 100,
      enemyHp: 500,
      enemyStats,
      weapon: null,
    });
    expect(out.healing).toBe(50);
    expect(out.playerHp).toBe(70);
    expect(state.runtimes[0].nextAt).toBe(4_000);
  });

  test("ally heals route to the provided sink (raid most-injured)", () => {
    const doc = ability({ abilityId: "mend", type: "heal", target: "ally", basePower: 30 });
    const state = stateFor([{ doc, cooldown: 2_000 }]);
    let healedTarget = 0;
    const out = castDueAbilities({
      state,
      at: 0,
      retryAt: 250,
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 500,
      enemyStats,
      weapon: null,
      allyHeal: (amount) => {
        healedTarget = amount;
        return amount;
      },
    });
    expect(healedTarget).toBe(30);
    expect(out.healing).toBe(30);
    // The caster's own HP is untouched by an ally heal.
    expect(out.playerHp).toBe(100);
  });

  test("ally heal falls back to the caster when no sink is provided (1v1)", () => {
    const doc = ability({ abilityId: "mend", type: "heal", target: "ally", basePower: 30 });
    const state = stateFor([{ doc, cooldown: 2_000 }]);
    const out = castDueAbilities({
      state,
      at: 0,
      retryAt: 250,
      playerHp: 40,
      playerMaxHp: 100,
      enemyHp: 500,
      enemyStats,
      weapon: null,
    });
    expect(out.playerHp).toBe(70);
    expect(out.healing).toBe(30);
  });

  test("buffs store their duration in rounds when durationUnitMs is the round length", () => {
    const doc = ability({
      abilityId: "rage",
      type: "buff_offense",
      buffDurationMs: 5_000,
      basePower: 20,
      buffIsPercent: true,
    });
    const state = stateFor([{ doc, cooldown: 3 }]);
    castDueAbilities({
      state,
      at: 2,
      retryAt: 3,
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 500,
      enemyStats,
      weapon: null,
      durationUnitMs: 2_000,
    });
    expect(state.buffs).toHaveLength(1);
    // 5000ms / 2000ms per round = 3 rounds, from round 2 -> expires at 5.
    expect(state.buffs[0]).toMatchObject({ kind: "damage", value: 20, percent: true, until: 5 });
  });

  test("expired buffs are pruned on the next cast window", () => {
    const doc = ability({ abilityId: "bolt", type: "attack", basePower: 10 });
    const state = stateFor([{ doc, cooldown: 1_000 }]);
    state.buffs.push({ kind: "damage", value: 10, percent: true, until: 5 });
    castDueAbilities({
      state,
      at: 10,
      retryAt: 11,
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 500,
      enemyStats,
      weapon: null,
    });
    expect(state.buffs).toHaveLength(0);
  });

  test("enemy damage multiplier (raid tough-skin) reduces outgoing ability damage", () => {
    const doc = ability({ abilityId: "bolt", type: "attack", basePower: 100 });
    const state = stateFor([{ doc, cooldown: 1_000 }]);
    const out = castDueAbilities({
      state,
      at: 0,
      retryAt: 1,
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 500,
      enemyStats,
      weapon: null,
      enemyDamageMultiplier: 0.5,
    });
    expect(out.damageDealt).toBe(50);
  });

  test("utility abilities are skipped but still advance their cooldown", () => {
    const doc = ability({ abilityId: "utility", type: "utility" });
    const state = stateFor([{ doc, cooldown: 2_000 }]);
    const out = castDueAbilities({
      state,
      at: 0,
      retryAt: 1,
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 500,
      enemyStats,
      weapon: null,
    });
    expect(out.casts).toBe(0);
    expect(state.runtimes[0].nextAt).toBe(2_000);
  });

  test("casts stop once the enemy is dead", () => {
    const first = ability({ abilityId: "a", type: "attack", basePower: 500 });
    const second = ability({ abilityId: "b", type: "attack", basePower: 500 });
    const state = stateFor([
      { doc: first, cooldown: 1_000 },
      { doc: second, cooldown: 1_000 },
    ]);
    const out = castDueAbilities({
      state,
      at: 0,
      retryAt: 1,
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 100,
      enemyStats,
      weapon: null,
    });
    expect(out.enemyHp).toBe(0);
    // Only the first ability resolved; the second saw a dead enemy.
    expect(state.runtimes[1].casts).toBe(0);
  });
});

describe("nextAbilityAt", () => {
  test("returns the soonest pending cast, or null when empty", () => {
    const doc = ability({ abilityId: "bolt", type: "attack" });
    const state = stateFor([
      { doc, cooldown: 1_000 },
      { doc: { ...doc, abilityId: "bolt2" }, cooldown: 1_000 },
    ]);
    state.runtimes[0].nextAt = 500;
    state.runtimes[1].nextAt = 250;
    expect(nextAbilityAt(state)).toBe(250);
    expect(nextAbilityAt({ ...state, runtimes: [] })).toBeNull();
  });
});
