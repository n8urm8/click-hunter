/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { seedForestCraftingContent } from "./forestCraftingSeed";
import { infusionSuccessFor } from "./infusion";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const SUBJECT = "infusion-user";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity({ subject: SUBJECT });
  const ids = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert("players", {
      anonymousId: "infusion", name: "Infuser", authSubject: SUBJECT,
      str: 5, dex: 5, int: 5, luk: 5, con: 10,
      gold: 0, totalExperience: 0, rebirthCount: 0,
      rebirthTierThreshold: 5, currentTier: 1, maxTierReached: 1,
      autoAttackEnabled: false, autoStartFightEnabled: false,
      createdAt: 0, lastUpdated: 0,
    });
    await ctx.db.insert("skillDefinitions", {
      skillId: "infusion", name: "Infusion", category: "crafting",
      description: "d", enabled: true, createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("bosses", {
      bossId: "boss_tier_1", tier: 1, name: "B1",
      str: 1, dex: 1, int: 1, luk: 1, con: 1, rewardMultiplier: 1, createdAt: 0,
    });
    const weaponDef = await ctx.db.insert("items", {
      itemId: "test-sword", name: "Test Sword", category: "equipment",
      description: "d", stackable: false, maxStackSize: 1,
      allowedEquipmentSlots: ["mainHand"], rarityLevel: 10,
      baseDamage: 8, attackSpeed: 1, damageStat: "str", damageType: "physical",
      createdAt: 0, updatedAt: 0,
    });
    const weaponRow = await ctx.db.insert("playerItems", {
      playerId, itemId: weaponDef, quantity: 1, equippedSlot: "mainHand",
      acquiredAt: 0, updatedAt: 0,
    });
    return { playerId, weaponRow };
  });
  return { t, ...ids };
}

test("infusion curve: at-tier is reliable, T5 at level 1 is ~7%", () => {
  const atTier = infusionSuccessFor(1, 1, {
    infusionBaseRate: 0.95, infusionFalloffPerTierGap: 0.22,
    infusionMinRate: 0.01, infusionMaxRate: 0.95,
  });
  expect(atTier).toBe(0.95);
  const t5at1 = infusionSuccessFor(1, 5, {
    infusionBaseRate: 0.95, infusionFalloffPerTierGap: 0.22,
    infusionMinRate: 0.01, infusionMaxRate: 0.95,
  });
  expect(t5at1).toBeCloseTo(0.07, 2);
  const t12at1 = infusionSuccessFor(1, 12, {
    infusionBaseRate: 0.95, infusionFalloffPerTierGap: 0.22,
    infusionMinRate: 0.01, infusionMaxRate: 0.95,
  });
  expect(t12at1).toBe(0.01);
});

test("seed plants chained boss-token augment lines", async () => {
  const { t } = await setup();
  await t.run((ctx) => seedForestCraftingContent(ctx));
  const rows = await t.run(async (ctx) => {
    const defs = await ctx.db.query("augmentationDefinitions").collect();
    const chained = defs.filter((def) => def.skillId === "infusion");
    const legacy = defs.filter((def) =>
      def.augmentationId.startsWith("augment-rat")
    );
    const weapon1 = defs.find(
      (def) => def.augmentationId === "augment-weapon-tier-1"
    );
    const armor2 = defs.find(
      (def) => def.augmentationId === "augment-armor-tier-2"
    );
    return { chained, legacy, weapon1, armor2 };
  });
  expect(rows.chained.length).toBe(40);
  expect(rows.legacy.every((def) => def.enabled === false)).toBe(true);
  expect(rows.weapon1).toMatchObject({
    tier: 1,
    effectType: "damage-bonus",
    effectElement: "light",
    effectAmount: 3,
    requiredMaterialQuantity: 1,
    requiresPreviousTier: false,
  });
  expect(rows.armor2).toMatchObject({
    tier: 2,
    effectType: "defense-bonus",
    effectElement: "dark",
    effectAmount: 6,
    requiresPreviousTier: true,
  });
});

test("seed plants infusion skill, essence, keys, and chained key recipes", async () => {
  const { t } = await setup();
  await t.run((ctx) => seedForestCraftingContent(ctx));
  const rows = await t.run(async (ctx) => {
    const skill = await ctx.db
      .query("skillDefinitions")
      .withIndex("by_skillId", (q) => q.eq("skillId", "infusion"))
      .first();
    const tiers = await ctx.db
      .query("skillTierDefinitions")
      .withIndex("by_skillId", (q) => q.eq("skillId", "infusion"))
      .collect();
    const essence = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", "essence-tier-1"))
      .first();
    const key = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", "boss-key-tier-1"))
      .first();
    const recipe1 = await ctx.db
      .query("recipes")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", "infuse-boss-key-tier-1"))
      .first();
    const recipe2 = await ctx.db
      .query("recipes")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", "infuse-boss-key-tier-2"))
      .first();
    const ingredients2 = recipe2
      ? await ctx.db
          .query("recipeIngredients")
          .withIndex("by_recipeId", (q) => q.eq("recipeId", recipe2.recipeId))
          .collect()
      : [];
    return { skill, tiers, essence, key, recipe1, recipe2, ingredients2 };
  });
  expect(rows.skill?.enabled).toBe(true);
  expect(rows.tiers.length).toBe(20);
  expect(rows.tiers.every((tier) => tier.requiredLevel === 1)).toBe(true);
  expect(rows.essence?.maxStackSize).toBe(10000);
  expect(rows.key?.itemFamily).toBe("boss-key");
  expect(rows.recipe1?.skillId).toBe("infusion");
  // Tier 2 chains the previous key.
  expect(rows.ingredients2.length).toBe(2);
  expect(rows.ingredients2.map((row) => row.quantity).sort()).toEqual([1, 100]);
});

test("enchanting consumes tier-matched essence and raises base damage", async () => {
  const { t, playerId, weaponRow } = await setup();
  await t.run(async (ctx) => {
    const essence = await ctx.db.insert("items", {
      itemId: "essence-tier-1", name: "Essence 1", category: "crafting",
      description: "d", stackable: true, maxStackSize: 10000,
      allowedEquipmentSlots: [], rarityLevel: 10,
      itemFamily: "monster-material", craftingSkillId: "infusion",
      craftingTier: 1, createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("playerItems", {
      playerId, itemId: essence, quantity: 100, acquiredAt: 0, updatedAt: 0,
    });
  });
  vi.spyOn(Math, "random").mockReturnValue(0);
  const result = await t.mutation(api.infusion.enchantEquipment, {
    playerId, playerItemId: weaponRow,
  });
  expect(result.success).toBe(true);
  expect(result.enchantLevel).toBe(1);
  const owned = await t.run((ctx) => ctx.db.get(weaponRow));
  expect(owned?.enchantLevel).toBe(1);
  const weapon = await t.run(async (ctx) => {
    const { getEquippedWeapon } = await import("./items");
    return getEquippedWeapon(ctx, playerId);
  });
  expect(weapon?.baseDamage).toBe(10);
});

test("failed enchants burn essence but grant half XP", async () => {
  const { t, playerId, weaponRow } = await setup();
  await t.run(async (ctx) => {
    const essence = await ctx.db.insert("items", {
      itemId: "essence-tier-1", name: "Essence 1", category: "crafting",
      description: "d", stackable: true, maxStackSize: 10000,
      allowedEquipmentSlots: [], rarityLevel: 10,
      itemFamily: "monster-material", craftingSkillId: "infusion",
      craftingTier: 1, createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("playerItems", {
      playerId, itemId: essence, quantity: 100, acquiredAt: 0, updatedAt: 0,
    });
  });
  vi.spyOn(Math, "random").mockReturnValue(0.999);
  const result = await t.mutation(api.infusion.enchantEquipment, {
    playerId, playerItemId: weaponRow,
  });
  expect(result.success).toBe(false);
  expect(result.experienceEarned).toBe(25);
  expect((await t.run((ctx) => ctx.db.get(weaponRow)))?.enchantLevel).toBeUndefined();
  const stacks = await t.run((ctx) =>
    ctx.db
      .query("playerItems")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect()
  );
  expect(stacks.every((row) => row.itemId !== undefined)).toBe(true);
});

test("trophy talismans sink 1000 dead drops into accessories", async () => {
  const { t, playerId } = await setup();
  await t.run((ctx) => seedForestCraftingContent(ctx));
  const rows = await t.run(async (ctx) => {
    const items = await Promise.all(
      [
        "rat-fang-talisman",
        "goblin-thorn-talisman",
        "heartwood-talisman",
        "ember-scale-talisman",
      ].map((slug) =>
        ctx.db
          .query("items")
          .withIndex("by_itemId", (q) => q.eq("itemId", slug))
          .first()
      )
    );
    const recipe = await ctx.db
      .query("recipes")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", "forge-rat-fang-talisman"))
      .first();
    const fang = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", "moonlit-rat-fang"))
      .first();
    const tonic = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", "verdant-tonic"))
      .first();
    const ingredients = recipe
      ? await ctx.db
          .query("recipeIngredients")
          .withIndex("by_recipeId", (q) => q.eq("recipeId", recipe.recipeId))
          .collect()
      : [];
    return { items, recipe, ingredients, fang, tonic };
  });
  expect(rows.items.every((item) => item?.category === "equipment")).toBe(true);
  expect(
    rows.items.every((item) =>
      item?.allowedEquipmentSlots.includes("accessory1")
    )
  ).toBe(true);
  expect(
    rows.items.map((item) => [item?.craftingTier, item?.effectStat, item?.effectAmount])
  ).toEqual([
    [4, "luk", 6],
    [5, "dex", 8],
    [6, "str", 9],
    [7, "con", 11],
  ]);
  expect(rows.recipe?.skillId).toBe("forging");
  expect(rows.fang?.maxStackSize).toBe(1000);
  expect(rows.tonic?.maxStackSize).toBe(1000);
  expect(
    rows.ingredients.map((row) => row.quantity).sort((a, b) => a - b)
  ).toEqual([2, 1000]);

  // 999 fangs is not enough; 1000 queues.
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("taskDefinitions", {
      taskId: "skill_action", name: "Skill action", category: "skill",
      description: "d", canProgressOffline: true, requiresOnline: false,
      enabled: true, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("playerSkills", {
      playerId, skillId: "forging", level: 39, experience: 0,
      totalExperience: 0, actionsCompleted: 0, createdAt: now, updatedAt: now,
    });
    const fang = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", "moonlit-rat-fang"))
      .first();
    const ingot = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", "emberstone-ingot"))
      .first();
    if (!fang || !ingot) throw new Error("Seed materials missing");
    await ctx.db.insert("playerItems", {
      playerId, itemId: fang._id, quantity: 999, acquiredAt: now, updatedAt: now,
    });
    await ctx.db.insert("playerItems", {
      playerId, itemId: ingot._id, quantity: 2, acquiredAt: now, updatedAt: now,
    });
  });
  await expect(
    t.mutation(api.tasks.enqueueSkillAction, {
      playerId, actionType: "crafting",
      actionId: "forge-rat-fang-talisman", quantity: 1,
    })
  ).rejects.toThrow("Insufficient crafting materials");
  await t.run(async (ctx) => {
    const fang = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", "moonlit-rat-fang"))
      .first();
    if (!fang) throw new Error("Seed fang missing");
    await ctx.db.insert("playerItems", {
      playerId, itemId: fang._id, quantity: 1,
      acquiredAt: Date.now(), updatedAt: Date.now(),
    });
  });
  const queued = await t.mutation(api.tasks.enqueueSkillAction, {
    playerId, actionType: "crafting",
    actionId: "forge-rat-fang-talisman", quantity: 1,
  });
  expect(queued).toBeDefined();
});

test("elemental ward mitigates matching-element hits", async () => {
  const { t, playerId } = await setup();
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("monsters", {
      type: "cinder", name: "Cinder Imp", element: "fire",
      str: 10, dex: 10, int: 10, luk: 1, con: 10,
      goldDrop: 10, experienceReward: 5, baseMsPerAttack: 2000,
      strength: 1, createdAt: now,
    });
    const armor = await ctx.db.insert("items", {
      itemId: "test-mail", name: "Test Mail", category: "equipment",
      description: "d", stackable: false, maxStackSize: 1,
      allowedEquipmentSlots: ["chest"], rarityLevel: 10, baseDefense: 0,
      createdAt: now, updatedAt: now,
    });
    const row = await ctx.db.insert("playerItems", {
      playerId, itemId: armor, quantity: 1, equippedSlot: "chest",
      acquiredAt: now, updatedAt: now,
    });
    return { row };
  });
  const { simulateRegularBattle } = await import("./combat");
  const plain = await t.run(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing player");
    return simulateRegularBattle(ctx, player, 1);
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("playerItemAugments", {
      playerId, playerItemId: ids.row, augmentationId: "augment-armor-tier-2",
      name: "Tier 2 Armor Infusion", effectType: "defense-bonus",
      effectElement: "fire", tier: 2, effectAmount: 6, appliedAt: Date.now(),
    });
  });
  const warded = await t.run(async (ctx) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing player");
    return simulateRegularBattle(ctx, player, 1);
  });
  // +6 flat defense and a 6 fire ward: 17 - 6 - 6 = 5.
  expect(warded.attackTiming?.monsterDamagePerHit).toBeCloseTo(
    (plain.attackTiming?.monsterDamagePerHit ?? 0) - 12,
    5
  );
});

test("boss sessions record element and attuned ward", async () => {
  const { t, playerId } = await setup();
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("bosses", {
      bossId: "boss_tier_1", tier: 1, name: "B1",
      str: 1, dex: 1, int: 1, luk: 1, con: 1, rewardMultiplier: 1, createdAt: now,
    });
    const keyDef = await ctx.db.insert("items", {
      itemId: "boss-key-tier-1", name: "Key 1", category: "crafting",
      description: "d", stackable: true, maxStackSize: 25,
      allowedEquipmentSlots: [], rarityLevel: 10, itemFamily: "boss-key",
      craftingSkillId: "infusion", craftingTier: 1,
      createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("playerItems", {
      playerId, itemId: keyDef, quantity: 1, acquiredAt: now, updatedAt: now,
    });
    // Tier-1 bosses deal light: attune light armor for a ward of 3.
    const armor = await ctx.db.insert("items", {
      itemId: "test-helm", name: "Test Helm", category: "equipment",
      description: "d", stackable: false, maxStackSize: 1,
      allowedEquipmentSlots: ["head"], rarityLevel: 10, baseDefense: 0,
      createdAt: now, updatedAt: now,
    });
    const row = await ctx.db.insert("playerItems", {
      playerId, itemId: armor, quantity: 1, equippedSlot: "head",
      acquiredAt: now, updatedAt: now,
    });
    await ctx.db.insert("playerItemAugments", {
      playerId, playerItemId: row, augmentationId: "augment-armor-tier-1",
      name: "Tier 1 Armor Infusion", effectType: "defense-bonus",
      effectElement: "light", tier: 1, effectAmount: 3, appliedAt: now,
    });
  });
  const session = await t.mutation(api.bossFights.startBossFight, {
    playerId, tier: 1,
  });
  expect(session.monsterElement).toBe("light");
  const stored = await t.run((ctx) =>
    ctx.db
      .query("bossSessions")
      .withIndex("by_settlementKey", (q) =>
        q.eq("settlementKey", session.settlementKey)
      )
      .first()
  );
  expect(stored?.monsterWard).toBe(3);
});

test("boss fights require and consume the tier key", async () => {
  const { t, playerId } = await setup();
  await expect(
    t.mutation(api.bossFights.startBossFight, { playerId, tier: 1 })
  ).rejects.toThrow("Boss Key");
  await t.run(async (ctx) => {
    const now = Date.now();
    const keyId = await ctx.db.insert("items", {
      itemId: "boss-key-tier-1", name: "Key 1", category: "crafting",
      description: "d", stackable: true, maxStackSize: 25,
      allowedEquipmentSlots: [], rarityLevel: 10,
      itemFamily: "boss-key", craftingSkillId: "infusion",
      craftingTier: 1, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("playerItems", {
      playerId, itemId: keyId, quantity: 1, acquiredAt: now, updatedAt: now,
    });
  });
  const session = await t.mutation(api.bossFights.startBossFight, {
    playerId, tier: 1,
  });
  expect(session.status).toBe("open");
  const remaining = await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("playerItems")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect();
    const defs = await Promise.all(rows.map((row) => ctx.db.get(row.itemId)));
    return rows.filter((_, index) => defs[index]?.itemId === "boss-key-tier-1");
  });
  expect(remaining.length).toBe(0);
});

async function setupChainedAugmentFixture() {
  const { t, playerId, weaponRow } = await setup();
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    // Free mainHand: the shared setup blade would otherwise collide.
    await ctx.db.patch(weaponRow, { equippedSlot: undefined, updatedAt: now });
    await ctx.db.insert("taskDefinitions", {
      taskId: "skill_action", name: "Skill action", category: "skill",
      description: "d", canProgressOffline: true, requiresOnline: false,
      enabled: true, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("playerSkills", {
      playerId, skillId: "infusion", level: 5, experience: 0,
      totalExperience: 0, actionsCompleted: 0, createdAt: now, updatedAt: now,
    });
    const token1 = await ctx.db.insert("items", {
      itemId: "forest-boss-token-1", name: "Token 1", category: "crafting",
      description: "d", stackable: true, maxStackSize: 25,
      allowedEquipmentSlots: [], rarityLevel: 30, itemFamily: "boss-catalyst",
      createdAt: now, updatedAt: now,
    });
    const token2 = await ctx.db.insert("items", {
      itemId: "forest-boss-token-2", name: "Token 2", category: "crafting",
      description: "d", stackable: true, maxStackSize: 25,
      allowedEquipmentSlots: [], rarityLevel: 30, itemFamily: "boss-catalyst",
      createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("playerItems", {
      playerId, itemId: token1, quantity: 5, acquiredAt: now, updatedAt: now,
    });
    await ctx.db.insert("playerItems", {
      playerId, itemId: token2, quantity: 5, acquiredAt: now, updatedAt: now,
    });
    const sword1 = await ctx.db.insert("items", {
      itemId: "tier1-sword", name: "Tier 1 Sword", category: "equipment",
      description: "d", stackable: false, maxStackSize: 1,
      allowedEquipmentSlots: ["mainHand"], rarityLevel: 10,
      craftingSkillId: "forging", craftingTier: 1, augmentSlots: 1,
      baseDamage: 10, attackSpeed: 1, damageStat: "str",
      damageType: "physical", createdAt: now, updatedAt: now,
    });
    const sword2 = await ctx.db.insert("items", {
      itemId: "tier2-sword", name: "Tier 2 Sword", category: "equipment",
      description: "d", stackable: false, maxStackSize: 1,
      allowedEquipmentSlots: ["mainHand"], rarityLevel: 20,
      craftingSkillId: "forging", craftingTier: 2, augmentSlots: 1,
      baseDamage: 20, attackSpeed: 1, damageStat: "str",
      damageType: "physical", createdAt: now, updatedAt: now,
    });
    const swordRow1 = await ctx.db.insert("playerItems", {
      playerId, itemId: sword1, quantity: 1, equippedSlot: "mainHand",
      acquiredAt: now, updatedAt: now,
    });
    const swordRow2 = await ctx.db.insert("playerItems", {
      playerId, itemId: sword2, quantity: 1, acquiredAt: now, updatedAt: now,
    });
    const def1 = await ctx.db.insert("augmentationDefinitions", {
      augmentationId: "augment-weapon-tier-1", skillId: "infusion", tier: 1,
      name: "Tier 1 Weapon Infusion", description: "d",
      allowedEquipmentSlots: ["mainHand"],
      requiredMaterialItemId: token1, requiredMaterialQuantity: 1,
      effectType: "damage-bonus", effectElement: "light", effectAmount: 3,
      requiresPreviousTier: false, enabled: true,
      createdAt: now, updatedAt: now,
    });
    const def2 = await ctx.db.insert("augmentationDefinitions", {
      augmentationId: "augment-weapon-tier-2", skillId: "infusion", tier: 2,
      name: "Tier 2 Weapon Infusion", description: "d",
      allowedEquipmentSlots: ["mainHand"],
      requiredMaterialItemId: token2, requiredMaterialQuantity: 1,
      effectType: "damage-bonus", effectElement: "dark", effectAmount: 6,
      requiresPreviousTier: true, enabled: true,
      createdAt: now, updatedAt: now,
    });
    return { swordRow1, swordRow2, def1, def2 };
  });
  return { t, playerId, ...ids };
}

type FixtureT = Awaited<ReturnType<typeof setupChainedAugmentFixture>>;

async function advanceLatestSkillTask(fixture: FixtureT) {
  const { t, playerId } = fixture;
  await t.run(async (ctx) => {
    const { advanceSkillActionTask } = await import("./skills");
    const tasks = await ctx.db
      .query("playerTasks")
      .withIndex("by_playerId_and_status", (q) =>
        q.eq("playerId", playerId).eq("status", "active")
      )
      .collect();
    const queued = await ctx.db
      .query("playerTasks")
      .withIndex("by_playerId_and_status", (q) =>
        q.eq("playerId", playerId).eq("status", "queued")
      )
      .collect();
    const task = [...tasks, ...queued].pop();
    if (!task) throw new Error("No skill task queued");
    await advanceSkillActionTask(
      ctx, task, 24 * 60 * 60 * 1000, 0, Date.now()
    );
    // Direct advance bypasses settlement: drop the row to simulate it.
    await ctx.db.delete(task._id);
  });
}

test("chained augments require the predecessor on the same item", async () => {
  const { t, playerId, swordRow1, swordRow2 } = await setupChainedAugmentFixture();
  // Tier-2 augment without the tier-1 predecessor, on either gear tier.
  await expect(
    t.mutation(api.tasks.enqueueSkillAction, {
      playerId, actionType: "augmentation",
      actionId: "augment-weapon-tier-2", targetPlayerItemId: swordRow1,
    })
  ).rejects.toThrow("tier 1 augment first");
  // Tier-2 augment on tier-2 gear without the tier-1 augment.
  await expect(
    t.mutation(api.tasks.enqueueSkillAction, {
      playerId, actionType: "augmentation",
      actionId: "augment-weapon-tier-2", targetPlayerItemId: swordRow2,
    })
  ).rejects.toThrow("tier 1 augment first");
  // Tier-1 on tier-1 gear queues fine.
  const queued = await t.mutation(api.tasks.enqueueSkillAction, {
    playerId, actionType: "augmentation",
    actionId: "augment-weapon-tier-1", targetPlayerItemId: swordRow1,
  });
  expect(queued).toBeDefined();
});

test("augment upgrades replace the predecessor and raise base damage", async () => {
  const fixture = await setupChainedAugmentFixture();
  const { t, playerId, swordRow1 } = fixture;
  vi.spyOn(Math, "random").mockReturnValue(0);
  await t.mutation(api.tasks.enqueueSkillAction, {
    playerId, actionType: "augmentation",
    actionId: "augment-weapon-tier-1", targetPlayerItemId: swordRow1,
  });
  await advanceLatestSkillTask(fixture);
  let augments = await t.run((ctx) =>
    ctx.db
      .query("playerItemAugments")
      .withIndex("by_playerItemId", (q) => q.eq("playerItemId", swordRow1))
      .collect()
  );
  expect(augments.length).toBe(1);
  expect(augments[0]).toMatchObject({
    tier: 1, effectType: "damage-bonus", effectElement: "light", effectAmount: 3,
  });
  const weapon = await t.run(async (ctx) => {
    const { getEquippedWeapon } = await import("./items");
    return getEquippedWeapon(ctx, playerId);
  });
  // 10 base + 3 augment (no enchant on this row).
  expect(weapon?.baseDamage).toBe(13);
  expect(weapon?.element).toBe("light");

  // Tier 2 replaces tier 1 in the single slot.
  await t.mutation(api.tasks.enqueueSkillAction, {
    playerId, actionType: "augmentation",
    actionId: "augment-weapon-tier-2", targetPlayerItemId: swordRow1,
  });
  await advanceLatestSkillTask(fixture);
  augments = await t.run((ctx) =>
    ctx.db
      .query("playerItemAugments")
      .withIndex("by_playerItemId", (q) => q.eq("playerItemId", swordRow1))
      .collect()
  );
  expect(augments.length).toBe(1);
  expect(augments[0]).toMatchObject({ tier: 2, effectAmount: 6 });
  const upgraded = await t.run(async (ctx) => {
    const { getEquippedWeapon } = await import("./items");
    return getEquippedWeapon(ctx, playerId);
  });
  expect(upgraded?.baseDamage).toBe(16);
});
