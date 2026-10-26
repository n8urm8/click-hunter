/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
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

async function seedContent(ctx: MutationCtx) {
  await ctx.db.insert("items", {
    itemId: "worn-staff",
    name: "Worn Staff",
    category: "equipment",
    description: "A starter staff",
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: ["mainHand"],
    baseDamage: 5,
    attackSpeed: 0.8,
    damageStat: "int",
    damageType: "magical",
    createdAt: 0,
    updatedAt: 0,
  });
  await ctx.db.insert("items", {
    itemId: "worn-robe",
    name: "Worn Robe",
    category: "equipment",
    description: "A starter robe",
    stackable: false,
    maxStackSize: 1,
    allowedEquipmentSlots: ["chest"],
    baseDefense: 3,
    createdAt: 0,
    updatedAt: 0,
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
    powerScalingPerLevel: 0.05,
    cooldownMs: 7000,
    tier: 0,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  });
  await ctx.db.insert("abilities", {
    abilityId: "ember_lash",
    name: "Ember Lash",
    description: "A fire spell",
    type: "attack",
    target: "enemy",
    weaponType: "staff",
    element: "fire",
    basePower: 10,
    powerScalingPerLevel: 0.05,
    cooldownMs: 9000,
    tier: 1,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  });
  const book = await ctx.db.insert("items", {
    itemId: "ability_book_arcane_bolt_1",
    name: "Tome of Arcane Bolt",
    category: "abilityBook",
    description: "Grants Arcane Bolt experience",
    stackable: true,
    maxStackSize: 99,
    allowedEquipmentSlots: [],
    effectType: "ability_book",
    effectAmount: 200,
    createdAt: 0,
    updatedAt: 0,
  });
  return { book };
}

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity({ subject: "ability-ui-user" });
  const { book } = await t.run((ctx) => seedContent(ctx));
  const player = await t.mutation(api.players.getOrCreatePlayer, {
    anonymousId: "ability-ui",
    name: "Caster",
    starterId: "staff",
  });
  const playerId = player!._id;
  const bookRowId = await t.run((ctx) =>
    ctx.db.insert("playerItems", {
      playerId,
      itemId: book,
      quantity: 3,
      acquiredAt: 0,
      updatedAt: 0,
    })
  );
  return { base, t, playerId, bookRowId };
}

test("panel exposes slots, learned abilities, wisdom, weapon, and books", async () => {
  const { t, playerId } = await setup();
  const panel = await t.query(api.abilityUi.getAbilityPanel, { playerId });

  expect(panel.weaponType).toBe("staff");
  expect(panel.maxSlots).toBe(1);
  expect(panel.maxPossibleSlots).toBe(4);
  expect(panel.wisdom.level).toBe(1);

  const bolt = panel.known.find((entry) => entry.abilityId === "arcane_bolt");
  expect(bolt).toBeTruthy();
  expect(bolt).toMatchObject({
    equippedSlot: 0,
    level: 1,
    usableWithWeapon: true,
    type: "attack",
  });

  expect(panel.slots[0].locked).toBe(false);
  expect(panel.slots[0].ability?.abilityId).toBe("arcane_bolt");
  expect(panel.slots[1].locked).toBe(true);
  expect(panel.slots[1].ability).toBeNull();

  expect(panel.books).toHaveLength(1);
  expect(panel.books[0]).toMatchObject({
    abilityId: "arcane_bolt",
    quantity: 3,
    xpValue: 200,
  });
});

test("equip and unequip move abilities between slots", async () => {
  const { t, playerId } = await setup();

  await t.mutation(api.abilityUi.unequipAbility, { playerId, slot: 0 });
  let panel = await t.query(api.abilityUi.getAbilityPanel, { playerId });
  expect(panel.slots[0].ability).toBeNull();
  expect(
    panel.known.find((entry) => entry.abilityId === "arcane_bolt")?.equippedSlot
  ).toBeNull();

  await t.mutation(api.abilityUi.equipAbility, {
    playerId,
    abilityId: "arcane_bolt",
    slot: 0,
  });
  panel = await t.query(api.abilityUi.getAbilityPanel, { playerId });
  expect(panel.slots[0].ability?.abilityId).toBe("arcane_bolt");
});

test("equipping swaps the current occupant and rejects locked or unknown abilities", async () => {
  const { t, playerId } = await setup();
  // Learn a second ability directly (books are separately tested).
  await t.run(async (ctx) => {
    await ctx.db.insert("playerAbilities", {
      playerId,
      abilityId: "ember_lash",
      level: 1,
      experience: 0,
      totalExperience: 0,
      learnedAt: 0,
      updatedAt: 0,
    });
  });

  await t.mutation(api.abilityUi.equipAbility, {
    playerId,
    abilityId: "ember_lash",
    slot: 0,
  });
  const panel = await t.query(api.abilityUi.getAbilityPanel, { playerId });
  expect(panel.slots[0].ability?.abilityId).toBe("ember_lash");
  expect(
    panel.known.find((entry) => entry.abilityId === "arcane_bolt")?.equippedSlot
  ).toBeNull();

  await expect(
    t.mutation(api.abilityUi.equipAbility, {
      playerId,
      abilityId: "ember_lash",
      slot: 1,
    })
  ).rejects.toThrow("not unlocked");

  await expect(
    t.mutation(api.abilityUi.equipAbility, {
      playerId,
      abilityId: "not_learned",
      slot: 0,
    })
  ).rejects.toThrow("not learned");
});

test("the slot cap follows the wisdomMaxSlots balance value", async () => {
  const { t, playerId } = await setup();
  // The admin raises the cap: the panel follows the balance, not a constant.
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "wisdomMaxSlots"))
      .first();
    if (!row) {
      await ctx.db.insert("gameBalance", {
        key: "wisdomMaxSlots",
        value: 6,
        description: "Maximum equipped ability slots",
        lastUpdated: 0,
      });
      return;
    }
    await ctx.db.patch(row._id, { value: 6 });
  });

  const panel = await t.query(api.abilityUi.getAbilityPanel, { playerId });
  expect(panel.maxPossibleSlots).toBe(6);
  expect(panel.slots).toHaveLength(6);
  // The player's own unlocked count is unchanged by the cap.
  expect(panel.maxSlots).toBe(1);
});

test("a raised slot cap unlocks the higher slots", async () => {
  const { t, playerId } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("gameBalance", {
      key: "wisdomMaxSlots",
      value: 6,
      description: "Maximum equipped ability slots",
      lastUpdated: 0,
    });
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Missing test player");
    // Enough wisdom for six slots (1 + one per 33 levels).
    await ctx.db.patch(player._id, {
      statXp: {
        str: 0,
        dex: 0,
        int: 0,
        luk: 0,
        con: 0,
        wis: 900_000_000,
      },
    });
  });

  const panel = await t.query(api.abilityUi.getAbilityPanel, { playerId });
  expect(panel.maxSlots).toBe(6);

  // Slot 4 is above the old hardcoded bound of three.
  await t.mutation(api.abilityUi.equipAbility, {
    playerId,
    abilityId: "arcane_bolt",
    slot: 4,
  });
  const after = await t.query(api.abilityUi.getAbilityPanel, { playerId });
  expect(after.slots[4].ability?.abilityId).toBe("arcane_bolt");
});

test("using an ability book consumes a copy and grants ability XP", async () => {
  const { t, playerId, bookRowId } = await setup();
  const granted = await t.mutation(api.abilityUi.useAbilityBook, {
    playerId,
    playerItemId: bookRowId,
    quantity: 1,
  });
  expect(granted).toMatchObject({ abilityId: "arcane_bolt", xpGranted: 200 });

  const remaining = await t.run((ctx) => ctx.db.get(bookRowId));
  expect(remaining?.quantity).toBe(2);
  const learned = await t.run((ctx) =>
    ctx.db
      .query("playerAbilities")
      .withIndex("by_playerId_and_abilityId", (q) =>
        q.eq("playerId", playerId).eq("abilityId", "arcane_bolt")
      )
      .first()
  );
  expect(learned?.totalExperience).toBe(200);
});
