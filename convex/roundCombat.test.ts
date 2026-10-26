import { describe, expect, test } from "vitest";
import {
  resolveDuelVerdict,
  runRoundExchange,
  type RoundFighter,
  type RoundSide,
} from "./roundCombat";
import type { AbilityCombatState } from "./abilityCombat";
import { specFromAbility } from "./abilities";
import type { Doc } from "./_generated/dataModel";

type AbilityDoc = Doc<"abilities">;

function ability(
  overrides: Partial<AbilityDoc> & Pick<AbilityDoc, "abilityId" | "type">
): AbilityDoc {
  return {
    _id: "abilities_round_test" as AbilityDoc["_id"],
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

/** A fighter that swings for a flat amount and never mitigates. */
function fighter(
  id: string,
  overrides: Partial<RoundFighter> & { hp: number; maxHp: number }
): RoundFighter {
  return {
    id,
    alive: overrides.hp > 0,
    defense: 0,
    magicalDefense: 0,
    planSwing: (opponents) => [
      { target: opponents[0], damage: 10, isCrit: false },
    ],
    ...overrides,
  };
}

const sides = (a: RoundFighter[], b: RoundFighter[]): RoundSide[] => [
  { fighters: a },
  { fighters: b },
];

describe("runRoundExchange", () => {
  test("every fighter casts before anyone swings", () => {
    const bolt = ability({ abilityId: "bolt", type: "attack", basePower: 30 });
    const mend = ability({
      abilityId: "mend",
      type: "heal",
      target: "self",
      basePower: 40,
    });
    const order: string[] = [];
    // The healer is one swing from death: only the heal landing before the
    // enemy's swing keeps it standing.
    const healer = fighter("healer", {
      hp: 50,
      maxHp: 100,
      abilityState: stateFor([{ doc: mend, cooldown: 1 }]),
      planSwing: (opponents) => {
        order.push("heal-swing");
        return [{ target: opponents[0], damage: 5, isCrit: false }];
      },
    });
    const enemy = fighter("enemy", {
      hp: 100,
      maxHp: 100,
      abilityState: stateFor([{ doc: bolt, cooldown: 1 }]),
      planSwing: (opponents) => {
        order.push("enemy-swing");
        return [{ target: opponents[0], damage: 20, isCrit: false }];
      },
    });

    const log = runRoundExchange(sides([healer], [enemy]), {
      round: 1,
      roundIntervalMs: 2_000,
    });

    // Healed to 90, hit for 30 by the enemy's bolt, then 20 by its swing.
    // Without the heal landing first the healer would be dead.
    expect(healer.hp).toBe(40);
    expect(enemy.hp).toBe(95);
    expect(order).toEqual(["heal-swing", "enemy-swing"]);
    expect(log.damage.enemy).toBe(50); // 30 ability + 20 swing
    expect(log.abilityDamage.enemy).toBe(30);
    expect(log.swingDamage.enemy).toBe(20);
    expect(log.swingDamage.healer).toBe(5);
  });

  test("the damage pipeline is attacker buffs, then target mitigation, then the target's own reduction", () => {
    const attacker = fighter("attacker", {
      hp: 100,
      maxHp: 100,
      abilityState: stateFor([], {
        buffs: [{ kind: "damage", value: 50, percent: true, until: 5 }],
      }),
      planSwing: (opponents) => [
        { target: opponents[0], damage: 100, isCrit: true },
      ],
    });
    const target = fighter("target", {
      hp: 500,
      maxHp: 500,
      abilityState: stateFor([], {
        buffs: [{ kind: "defense", value: 20, percent: true, until: 5 }],
      }),
      reduceIncoming: (damage) => Math.max(1, Math.round(damage)),
    });

    const log = runRoundExchange(sides([attacker], [target]), {
      round: 1,
      roundIntervalMs: 2_000,
    });

    // 100 raw → 150 with the attacker's buff → 120 after mitigation → 120.
    expect(log.swingDamage.attacker).toBe(120);
    expect(log.crit.attacker).toBe(true);
    expect(target.hp).toBe(380);
  });

  test("a downed fighter does not act", () => {
    const down = fighter("down", { hp: 0, maxHp: 100 });
    const alive = fighter("alive", { hp: 40, maxHp: 100 });
    let swings = 0;
    alive.planSwing = (opponents) => {
      swings += 1;
      return [{ target: opponents[0], damage: 5, isCrit: false }];
    };

    const log = runRoundExchange(sides([down], [alive]), {
      round: 1,
      roundIntervalMs: 2_000,
    });

    expect(swings).toBe(1);
    expect(log.damage.alive).toBe(5);
  });

  test("a swing at a fallen opponent still counts its damage", () => {
    const attacker = fighter("attacker", { hp: 100, maxHp: 100 });
    const fallen = fighter("fallen", { hp: 0, maxHp: 100 });

    const log = runRoundExchange(sides([attacker], [fallen]), {
      round: 1,
      roundIntervalMs: 2_000,
    });

    expect(log.swingDamage.attacker).toBe(10);
    expect(log.hp.fallen).toBe(0);
  });

  test("ally heals land on the side's sink instead of the caster", () => {
    const mend = ability({
      abilityId: "mend",
      type: "heal",
      target: "ally",
      basePower: 30,
    });
    const healer = fighter("healer", {
      hp: 40,
      maxHp: 100,
      abilityState: stateFor([{ doc: mend, cooldown: 1 }]),
    });
    const hurt = fighter("hurt", { hp: 20, maxHp: 100 });
    const enemy = fighter("enemy", {
      hp: 100,
      maxHp: 100,
      planSwing: () => [],
    });

    const log = runRoundExchange(
      [
        {
          fighters: [healer, hurt],
          // The raid's sink: heal the most-injured member of the side.
          allyHeal: (amount) => {
            hurt.hp = Math.min(hurt.maxHp, hurt.hp + amount);
            return amount;
          },
        },
        { fighters: [enemy] },
      ],
      { round: 1, roundIntervalMs: 2_000 }
    );

    expect(hurt.hp).toBe(50);
    expect(healer.hp).toBe(40);
    // The heal deals no damage; the healer's own swing still lands.
    expect(log.abilityDamage.healer).toBe(0);
    expect(log.swingDamage.healer).toBe(10);
  });

  test("the party and the dragon share one exchange", () => {
    const dragon = fighter("dragon", {
      hp: 300,
      maxHp: 300,
      reduceIncoming: (damage) => Math.max(1, Math.floor(damage / 2)),
      planSwing: (opponents) =>
        opponents.map((target) => ({
          target,
          damage: 20,
          isCrit: false,
        })),
    });
    const hunter = fighter("hunter", {
      hp: 100,
      maxHp: 100,
      planSwing: (opponents) => [
        { target: opponents[0], damage: 40, isCrit: false },
      ],
    });

    const log = runRoundExchange(sides([hunter], [dragon]), {
      round: 1,
      roundIntervalMs: 2_000,
    });

    // The dragon's tough skin halves the hunter's hit.
    expect(log.swingDamage.hunter).toBe(20);
    expect(dragon.hp).toBe(280);
    // The dragon's retaliation lands on the hunter.
    expect(hunter.hp).toBe(80);
  });
});

describe("resolveDuelVerdict", () => {
  const duel = (overrides: Partial<Parameters<typeof resolveDuelVerdict>[0]>) =>
    resolveDuelVerdict({
      hpA: 100,
      maxHpA: 100,
      hpB: 100,
      maxHpB: 100,
      round: 1,
      maxRounds: 10,
      ...overrides,
    });

  test("a living fight is ongoing", () => {
    expect(duel({}).type).toBe("ongoing");
  });

  test("a knockout decides the fight", () => {
    expect(duel({ hpA: 0 })).toEqual({
      type: "win",
      winner: 1,
      reason: "knockout",
    });
    expect(duel({ hpB: 0 })).toEqual({
      type: "win",
      winner: 0,
      reason: "knockout",
    });
  });

  test("both fighters down is a draw", () => {
    expect(duel({ hpA: 0, hpB: 0 }).type).toBe("draw");
  });

  test("the round limit goes to the larger HP fraction", () => {
    expect(
      duel({ hpA: 40, hpB: 90, round: 10, maxRounds: 10 })
    ).toEqual({ type: "win", winner: 1, reason: "rounds" });
    // 30/100 beats 90/400: the fraction decides, not the raw HP.
    expect(
      duel({
        hpA: 30,
        hpB: 90,
        maxHpA: 100,
        maxHpB: 400,
        round: 10,
        maxRounds: 10,
      })
    ).toEqual({ type: "win", winner: 0, reason: "rounds" });
  });

  test("equal fractions draw at the round limit", () => {
    expect(
      duel({ hpA: 50, hpB: 50, round: 10, maxRounds: 10 }).type
    ).toBe("draw");
  });

  test("equal remaining HP draws only when the rule asks for it", () => {
    // Fractions differ (0.5 vs 0.25), so the arena rule decides it.
    expect(
      duel({
        hpA: 50,
        hpB: 50,
        maxHpA: 100,
        maxHpB: 200,
        round: 10,
        maxRounds: 10,
      }).type
    ).toBe("win");
    // The ranked rule draws on equal remaining HP.
    expect(
      duel({
        hpA: 50,
        hpB: 50,
        maxHpA: 100,
        maxHpB: 200,
        round: 10,
        maxRounds: 10,
        drawOnEqualHp: true,
      }).type
    ).toBe("draw");
  });
});
