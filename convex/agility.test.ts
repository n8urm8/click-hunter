/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { applyCombatStatXp } from "./loot";
import { qualifyingRebirthStats } from "./rebirth";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const ONES = { str: 1, dex: 1, int: 1, luk: 1, con: 1 };

test("every weapon puts 15% of fight XP into agility", () => {
  for (const [stat, main] of [["str", "str"], ["dex", "dex"], ["int", "int"]] as const) {
    const { statXp } = applyCombatStatXp(ONES, undefined, stat, 100, 1_000_000);
    expect(statXp[main]).toBeCloseTo(70);
    expect(statXp.agi).toBeCloseTo(15);
    expect(statXp.con).toBeCloseTo(15);
  }
  const unarmed = applyCombatStatXp(ONES, undefined, null, 100, 1_000_000).statXp;
  expect([unarmed.str, unarmed.dex, unarmed.agi, unarmed.con]).toEqual([30, 30, 15, 25]);
});

test("agility levels up from 1 on rows that never had it", () => {
  // Level 1 needs 1 000 XP at base 1 000; 15% of 10 000 is 1 500.
  const { levels } = applyCombatStatXp(ONES, undefined, "str", 10_000, 1_000);
  expect(levels.agi).toBe(2);
});

test("agility at the rebirth requirement counts toward a rebirth", () => {
  const player = { ...ONES, wis: 1, agi: 99 } as unknown as Doc<"players">;
  expect(qualifyingRebirthStats(player, 99)).toEqual(["agi"]);
});

test("the agility migration moves boots to AGI and retunes weapons and heavy armor", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.init.default, {});
  // Put seeded rows back to their pre-agility values.
  await t.run(async (ctx) => {
    const byId = async (itemId: string) =>
      (await ctx.db.query("items").withIndex("by_itemId", (q) => q.eq("itemId", itemId)).first())!;
    await ctx.db.patch((await byId("moonstone-boots"))._id, { effectStat: "dex", speedPenalty: 0.02 });
    await ctx.db.patch((await byId("moonstone-sword"))._id, { baseDamage: 10 });
    await ctx.db.patch((await byId("moonstone-mail"))._id, { speedPenalty: 0.08 });
  });
  const result = await t.mutation(internal.migrations.applyAgilityRebalance, {});
  expect(result.patched).toBe(3);
  const rows = await t.run(async (ctx) => {
    const byId = async (itemId: string) =>
      (await ctx.db.query("items").withIndex("by_itemId", (q) => q.eq("itemId", itemId)).first())!;
    return {
      boots: await byId("moonstone-boots"),
      sword: await byId("moonstone-sword"),
      mail: await byId("moonstone-mail"),
    };
  });
  expect(rows.boots.effectStat).toBe("agi");
  expect(rows.boots.speedPenalty).toBe(0.01);
  expect(rows.sword.baseDamage).toBe(12);
  expect(rows.mail.speedPenalty).toBe(0.04);
  // A second run finds nothing to change.
  expect((await t.mutation(internal.migrations.applyAgilityRebalance, {})).patched).toBe(0);
});
