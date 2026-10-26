/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity({ subject: "boss-ability-user" });
  const playerId = await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("players", {
      anonymousId: "boss-ability",
      name: "Caster",
      authSubject: "boss-ability-user",
      str: 10,
      dex: 10,
      int: 10,
      luk: 5,
      con: 200,
      gold: 0,
      totalExperience: 0,
      rebirthCount: 0,
      rebirthTierThreshold: 5,
      currentTier: 1,
      maxTierReached: 1,
      autoAttackEnabled: true,
      autoStartFightEnabled: false,
      createdAt: now,
      lastUpdated: now,
    });

    // A staff enables the arcane bolt below.
    const staff = await ctx.db.insert("items", {
      itemId: "test-staff",
      name: "Test Staff",
      category: "equipment",
      description: "d",
      stackable: false,
      maxStackSize: 1,
      allowedEquipmentSlots: ["mainHand"],
      rarityLevel: 10,
      baseDamage: 5,
      attackSpeed: 1,
      damageStat: "int",
      damageType: "magical",
      weaponType: "staff",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerItems", {
      playerId: id,
      itemId: staff,
      quantity: 1,
      equippedSlot: "mainHand",
      acquiredAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("bosses", {
      bossId: "boss_tier_1",
      tier: 1,
      name: "B1",
      str: 1,
      dex: 1,
      int: 1,
      luk: 1,
      con: 1,
      rewardMultiplier: 1,
      createdAt: now,
    });
    const key = await ctx.db.insert("items", {
      itemId: "boss-key-tier-1",
      name: "Key 1",
      category: "crafting",
      description: "d",
      stackable: true,
      maxStackSize: 25,
      allowedEquipmentSlots: [],
      rarityLevel: 10,
      itemFamily: "boss-key",
      craftingSkillId: "infusion",
      craftingTier: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerItems", {
      playerId: id,
      itemId: key,
      quantity: 1,
      acquiredAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("abilities", {
      abilityId: "arcane_bolt",
      name: "Arcane Bolt",
      description: "Starter spell",
      type: "attack",
      target: "enemy",
      weaponType: "staff",
      element: "arcane",
      basePower: 4,
      powerScalingPerLevel: 0,
      cooldownMs: 7_000,
      tier: 0,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerAbilities", {
      playerId: id,
      abilityId: "arcane_bolt",
      level: 1,
      experience: 0,
      totalExperience: 0,
      learnedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerEquippedAbilities", {
      playerId: id,
      slot: 0,
      abilityId: "arcane_bolt",
      equippedAt: now,
    });
    return id;
  });
  return { t, playerId };
}

test("boss fights auto-cast equipped abilities and win when the ability lands the kill", async () => {
  const { t, playerId } = await setup();
  // No loot drops, and deterministic monster swings.
  vi.spyOn(Math, "random").mockReturnValue(0.99);

  const session = await t.mutation(api.bossFights.startBossFight, {
    playerId,
    tier: 1,
  });
  expect(session.status).toBe("open");
  expect(session.monsterHp).toBe(12);

  const stored = await t.run((ctx) => ctx.db.get(session.sessionId));
  expect(stored?.abilityState?.runtimes).toHaveLength(1);
  expect(stored?.abilityState?.runtimes[0].spec.abilityId).toBe("arcane_bolt");

  // Three 7s cooldowns at 4 damage each take the 12 HP boss to zero.
  vi.setSystemTime(30_000);
  const result = await t.mutation(api.bossFights.checkBossFight, {
    playerId,
    sessionId: session.sessionId,
  });
  expect(result.status).toBe("won");
  expect(result.monsterHp).toBe(0);

  const after = await t.run((ctx) => ctx.db.get(playerId));
  // 3 casts * 10 base wisdom XP per use.
  expect(after?.statXp?.wis).toBe(30);

  const fight = await t.run((ctx) =>
    ctx.db
      .query("fightHistory")
      .withIndex("by_settlementKey", (q) =>
        q.eq("settlementKey", session.settlementKey)
      )
      .first()
  );
  expect(fight?.won).toBe(true);
  expect(fight?.isBoss).toBe(true);
});

test("a loss still closes the session and awards wisdom XP for casts made", async () => {
  const { t, playerId } = await setup();
  vi.spyOn(Math, "random").mockReturnValue(0.99);
  // A glass cannon: the player dies to the first swing, but the t=0 auto-cast
  // still resolves (and earns wisdom XP for the use).
  await t.run(async (ctx) => {
    await ctx.db.patch(playerId, {
      con: 1,
      statXp: { str: 0, dex: 0, int: 0, luk: 0, con: 0, wis: 0 },
    });
    const boss = await ctx.db
      .query("bosses")
      .withIndex("by_tier", (q) => q.eq("tier", 1))
      .first();
    if (boss) {
      await ctx.db.patch(boss._id, {
        con: 1_000,
        str: 100,
        statsTierScaled: true,
      });
    }
  });
  const session = await t.mutation(api.bossFights.startBossFight, {
    playerId,
    tier: 1,
  });
  vi.setSystemTime(120_000);
  const result = await t.mutation(api.bossFights.checkBossFight, {
    playerId,
    sessionId: session.sessionId,
  });
  expect(result.status).toBe("lost");
  expect(result.playerHp).toBe(0);
  const closed = await t.run((ctx) => ctx.db.get(session.sessionId));
  expect(closed?.status).toBe("lost");
  const after = await t.run((ctx) => ctx.db.get(playerId));
  // One cast landed at t=0 before the lethal swing.
  expect(after?.statXp?.wis).toBe(10);
});
