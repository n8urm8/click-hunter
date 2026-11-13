/// <reference types="vite/client" />
import { testIdentity, ownerFor } from "./testIdentity";
import { insertPlayerWithRecords } from "./testPlayers";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { getTierClearStatus, recordMonsterClears } from "./tierClears";
import { settleCombatFight } from "./loot";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const ROSTER = [
  { type: "rat", name: "Rat" },
  { type: "goblin", name: "Goblin" },
  { type: "orc", name: "Orc" },
];

async function setup(options: { withKey: boolean }) {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity(testIdentity("tier-clear-user"));
  const playerId = await t.run(async (ctx) => {
    const now = Date.now();
    const id = await insertPlayerWithRecords(ctx, {
      anonymousId: "tier-clear",
      name: "Hunter",
      authSubject: ownerFor("tier-clear-user"),
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
    for (const monster of ROSTER) {
      await ctx.db.insert("monsters", {
        type: monster.type,
        name: monster.name,
        element: "earth",
        str: 2,
        dex: 2,
        int: 1,
        luk: 1,
        con: 2,
        goldDrop: 10,
        experienceReward: 5,
        baseMsPerAttack: 2000,
        strength: 5,
        createdAt: now,
      });
    }
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
    if (options.withKey) {
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
    }
    return id;
  });
  return { t, playerId };
}

async function clearTier(
  t: Awaited<ReturnType<typeof setup>>["t"],
  playerId: Id<"players">,
  tier: number,
  types: string[]
) {
  await t.run((ctx) => recordMonsterClears(ctx, playerId, tier, types));
}

test("a boss stays locked until every monster on the tier is defeated", async () => {
  const { t, playerId } = await setup({ withKey: true });
  await clearTier(t, playerId, 1, ["rat", "goblin"]);

  await expect(
    t.mutation(api.bossFights.startBossFight, { playerId, tier: 1 })
  ).rejects.toThrow("Defeat every monster on Tier 1 first (1 left: Orc)");

  const requirements = await t.query(api.bossFights.getBossRequirements, {
    playerId,
    tier: 1,
  });
  expect(requirements).toEqual({ total: 3, defeated: 2, missingNames: ["Orc"] });
});

test("defeats on another tier do not count toward this one", async () => {
  const { t, playerId } = await setup({ withKey: true });
  await clearTier(t, playerId, 2, ["rat", "goblin", "orc"]);

  await expect(
    t.mutation(api.bossFights.startBossFight, { playerId, tier: 1 })
  ).rejects.toThrow("Defeat every monster on Tier 1 first (3 left");
});

test("a boss opens once the roster is cleared and the key is held", async () => {
  const { t, playerId } = await setup({ withKey: true });
  await clearTier(t, playerId, 1, ["rat", "goblin", "orc"]);

  const session = await t.mutation(api.bossFights.startBossFight, {
    playerId,
    tier: 1,
  });
  expect(session.bossId).toBe("boss_tier_1");
});

test("clearing the roster still needs the boss key", async () => {
  const { t, playerId } = await setup({ withKey: false });
  await clearTier(t, playerId, 1, ["rat", "goblin", "orc"]);

  await expect(
    t.mutation(api.bossFights.startBossFight, { playerId, tier: 1 })
  ).rejects.toThrow("Requires 1x Tier 1 Boss Key");
});

test("a win over a monster records it, a loss does not", async () => {
  const { t, playerId } = await setup({ withKey: false });
  await t.run(async (ctx) => {
    await settleCombatFight(ctx, {
      playerId,
      settlementKey: `${playerId}:win-rat`,
      sourceType: "monster",
      sourceId: "rat",
      tier: 1,
      won: true,
    });
    await settleCombatFight(ctx, {
      playerId,
      settlementKey: `${playerId}:loss-goblin`,
      sourceType: "monster",
      sourceId: "goblin",
      tier: 1,
      won: false,
    });
  });

  const status = await t.run((ctx) => getTierClearStatus(ctx, playerId, 1));
  expect(status.missingNames).toEqual(["Goblin", "Orc"]);
});

test("recording the same monster twice keeps one entry", async () => {
  const { t, playerId } = await setup({ withKey: false });
  await clearTier(t, playerId, 1, ["rat"]);
  await clearTier(t, playerId, 1, ["rat", "rat"]);

  const rows = await t.run((ctx) =>
    ctx.db
      .query("playerTierClears")
      .withIndex("by_playerId_and_tier", (q) =>
        q.eq("playerId", playerId).eq("tier", 1)
      )
      .collect()
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].monsterTypes).toEqual(["rat"]);
});
