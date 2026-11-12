/// <reference types="vite/client" />
/**
 * Balance simulation for the biome world. Drives the real combat code
 * (`loadBattleContext` + `rollEncounter`) and the real stat-XP curve through
 * a sword player's life, then reports:
 *
 * 1. Pacing: hours of auto-battle before each tier can be farmed (>= 90%
 *    wins in a chained hunt), and the stat levels at that point.
 * 2. The endgame wall: tier 8 vs tier 9 win rates for an end-of-life player
 *    (STR 99, tier 8 gear, +8 enchants) at 0–6 rebirths.
 * 2b. The Blighted ladder: win rates at tiers 9–16 with gear of that tier.
 *     (A guard below checks bosses: gear of the tier wins, a tier behind loses.)
 * 3. Material income vs costs: hours of hard-zone hunting per trophy, per
 *    boss key, per talisman, per leather/forged set, per enchant level.
 *
 * Opt-in (slow): BALANCE_SIM=1 npx vitest run convex/balanceSim.test.ts
 * The always-on guard tests at the bottom keep the headline properties true.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { expect, test } from "vitest";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { insertPlayerWithRecords } from "./testPlayers";
import { populateGameBalance, populateMonsters } from "./seed";
import { blightedGearItemId, seedForestCraftingContent } from "./forestCraftingSeed";
import { loadBattleContext, rollEncounter } from "./combat";
import { applyCombatStatXp } from "./loot";
import { readSkillXpBase } from "./skillProgression";
import { readBalanceValue } from "./balance";
import {
  ARCHETYPES,
  biomeMonsterSeeds,
  encounterWeights,
  materialItemIdForTier,
  monsterDropsForTier,
  monstersForTier,
  type MaterialKind,
} from "./biomes";
import { monstersInZone, type CombatZone } from "./zones";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const RUN_REPORT =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.BALANCE_SIM === "1";

const FORGE_PREFIXES = [
  "moonstone", "ambersteel", "root-iron", "emberstone",
  "stormsilver", "voidquartz", "nightsteel", "starforged",
];
const GEAR = [
  ["sword", "mainHand"],
  ["helm", "head"],
  ["mail", "chest"],
  ["greaves", "legs"],
  ["boots", "feet"],
] as const;

type Stats = { str: number; dex: number; int: number; luk: number; con: number; agi: number };

async function createWorld() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  await base.run(async (ctx) => {
    await populateGameBalance(ctx);
    await populateMonsters(ctx);
    await seedForestCraftingContent(ctx);
  });
  return base;
}

async function spawn(ctx: MutationCtx, stats: Stats, rebirths = 0) {
  return await insertPlayerWithRecords(ctx, {
    anonymousId: `balance-${Math.random()}`,
    name: "Balance",
    ...stats,
    wis: 1,
    gold: 0,
    totalExperience: 0,
    rebirthCount: rebirths,
    rebirthTierThreshold: 5,
    currentTier: 1,
    maxTierReached: 1,
    rebirthStatBonuses: { str: rebirths, dex: 0, int: 0, luk: 0, con: rebirths, agi: rebirths },
    autoAttackEnabled: true,
    autoStartFightEnabled: false,
    createdAt: 0,
    lastUpdated: 0,
  });
}

async function equipGearTier(
  ctx: MutationCtx,
  playerId: Id<"players">,
  tier: number,
  enchantLevel = 0
) {
  for (const row of await ctx.db
    .query("playerItems")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect()) {
    await ctx.db.delete(row._id);
  }
  const prefix = FORGE_PREFIXES[Math.min(8, Math.max(1, tier)) - 1];
  for (const [piece, slot] of GEAR) {
    // Past tier 8 the forged set climbs the Blighted ladder.
    const slug = tier > 8 ? blightedGearItemId(`${prefix}-${piece}`, tier) : `${prefix}-${piece}`;
    const item = await ctx.db
      .query("items")
      .withIndex("by_itemId", (q) => q.eq("itemId", slug))
      .first();
    if (!item) throw new Error(`missing ${slug}`);
    await ctx.db.insert("playerItems", {
      playerId,
      itemId: item._id,
      quantity: 1,
      equippedSlot: slot,
      ...(enchantLevel > 0 ? { enchantLevel } : {}),
      acquiredAt: 0,
      updatedAt: 0,
    });
  }
}

type HuntResult = {
  fights: number;
  wins: number;
  deaths: number;
  ms: number;
  xp: number;
};

/** A chained auto-battle hunt: HP carries over, a loss costs the respawn wait. */
async function hunt(
  ctx: MutationCtx,
  playerId: Id<"players">,
  tier: number,
  fights: number,
  zone?: CombatZone
): Promise<HuntResult> {
  const player = (await ctx.db.get(playerId)) as Doc<"players">;
  const battle = await loadBattleContext(ctx, player, tier, { zone, now: 0 });
  const respawnMs = Number(await readBalanceValue(ctx, "respawnTimeMs")) || 5000;
  const result: HuntResult = { fights: 0, wins: 0, deaths: 0, ms: 0, xp: 0 };
  let hp: number | undefined;
  let cooldowns: NonNullable<Parameters<typeof rollEncounter>[1]>["abilityCooldowns"];
  for (let i = 0; i < fights; i += 1) {
    const fight = rollEncounter(battle, { startingHp: hp, abilityCooldowns: cooldowns });
    result.fights += 1;
    result.ms += fight.durationMs;
    cooldowns = fight.abilityCooldowns;
    if (fight.won) {
      result.wins += 1;
      result.xp += fight.experienceEarned ?? 0;
      hp = fight.playerEndingHp;
    } else {
      result.deaths += 1;
      result.ms += respawnMs;
      hp = undefined; // rested back to full during the respawn wait
    }
  }
  return result;
}

const winRate = (result: HuntResult) => result.wins / Math.max(1, result.fights);

type PacingRow = {
  tier: number;
  hours: number;
  str: number;
  con: number;
  agi: number;
  xpPerHour: number;
};

/** Play one life with a sword: farm the highest tier whose hard zone wins >= 80%. */
async function simulateLife(
  ctx: MutationCtx,
  maxTier: number,
  gear: "matched" | "starter" = "matched",
  hourCap = 2000
) {
  const gearFor = (tier: number) => (gear === "matched" ? tier : 1);
  const stats: Stats = { str: 1, dex: 1, int: 1, luk: 1, con: 1, agi: 1 };
  const playerId = await spawn(ctx, stats);
  await equipGearTier(ctx, playerId, 1);
  const xpBase = readSkillXpBase(await readBalanceValue(ctx, "skillXpPerLevel"));
  let statXp: Doc<"playerProgress">["statXp"] = { str: 0, dex: 0, int: 0, luk: 0, con: 0, agi: 0, wis: 0 };
  let tier = 1;
  let hours = 0;
  const pacing: PacingRow[] = [{ tier: 1, hours: 0, str: 1, con: 1, agi: 1, xpPerHour: 0 }];
  const CHUNK_FIGHTS = 120;
  while (hours < hourCap && stats.str < 99) {
    // Step up while the next tier is farmable.
    while (tier < maxTier) {
      await equipGearTier(ctx, playerId, gearFor(tier + 1));
      // Reached = the hard zone is farmable (the boss needs every monster).
      if (winRate(await hunt(ctx, playerId, tier + 1, 60, "hard")) >= 0.8) {
        tier += 1;
        const player = (await ctx.db.get(playerId)) as Doc<"players">;
        pacing.push({ tier, hours, str: player.str, con: player.con, agi: player.agi ?? 1, xpPerHour: 0 });
      } else {
        await equipGearTier(ctx, playerId, gearFor(tier));
        break;
      }
    }
    const chunk = await hunt(ctx, playerId, tier, CHUNK_FIGHTS);
    hours += chunk.ms / 3_600_000;
    const row = pacing.find((entry) => entry.tier === tier);
    if (row && row.xpPerHour === 0) row.xpPerHour = Math.round(chunk.xp / (chunk.ms / 3_600_000));
    const player = (await ctx.db.get(playerId)) as Doc<"players">;
    const applied = applyCombatStatXp(player, statXp, "str", chunk.xp, xpBase);
    statXp = applied.statXp;
    if (Object.keys(applied.levels).length > 0) {
      Object.assign(stats, applied.levels);
      await ctx.db.patch(playerId, applied.levels);
    }
  }
  const player = (await ctx.db.get(playerId)) as Doc<"players">;
  return { pacing, hours, tier, stats: { str: player.str, con: player.con, agi: player.agi } };
}

/** Expected drops per fight of each material kind in a tier's zone. */
function expectedDropsPerFight(tier: number, zone: CombatZone) {
  const pool = monstersInZone(
    monstersForTier(biomeMonsterSeeds().map((m) => ({ ...m, createdAt: 0 })) as unknown as Doc<"monsters">[], tier),
    zone
  );
  const weights = encounterWeights(pool);
  const total = weights.reduce((a, b) => a + b, 0);
  const perKind: Partial<Record<MaterialKind | "shard", number>> = {};
  pool.forEach((monster, index) => {
    const drops = monsterDropsForTier(
      { archetype: monster.archetype as (typeof ARCHETYPES)[number]["id"], biomeTier: monster.biomeTier! },
      tier
    );
    for (const drop of drops) {
      const kind = (drop.itemId === "rift-shard" ? "shard" : drop.itemId.split("-").pop()) as MaterialKind | "shard";
      perKind[kind] = (perKind[kind] ?? 0) + (weights[index] / total) * drop.chance;
    }
  });
  return perKind;
}

test.skipIf(!RUN_REPORT)("balance report", { timeout: 600_000 }, async () => {
  const t = await createWorld();
  await t.run(async (ctx) => {
    const lines: string[] = [];
    const log = (line = "") => lines.push(line);

    // 1. Pacing through the main game.
    const starterLife = await simulateLife(ctx, 8, "starter", 800);
    log("== Pacing with tier 1 gear only (no crafting)");
    log("tier | first farmable at (h) | STR | CON | AGI");
    for (const row of starterLife.pacing) {
      log(`${row.tier} | ${row.hours.toFixed(1)} | ${row.str} | ${row.con} | ${row.agi}`);
    }
    log("");
    const life = await simulateLife(ctx, 8);
    log("== Pacing (sword, forged gear of the hunted tier, no enchants/potions/passives)");
    log("tier | first farmable at (h) | STR | CON | AGI | XP/h on arrival");
    for (const row of life.pacing) {
      log(`${row.tier} | ${row.hours.toFixed(1)} | ${row.str} | ${row.con} | ${row.agi} | ${row.xpPerHour}`);
    }
    log(`life end: ${life.hours.toFixed(1)} h, tier ${life.tier}, stats ${JSON.stringify(life.stats)}`);

    // 2. The endgame wall for an end-of-life player.
    log("");
    log("== Endgame wall (STR/CON/AGI from the life above, tier 8 gear)");
    log("rebirths | enchant | T8 full | T8 hard | T9 full | T9 easy | T10 full");
    for (const enchant of [0, 8]) {
      for (const rebirths of [0, 3, 6]) {
        const playerId = await spawn(
          ctx,
          { str: life.stats.str, dex: 1, int: 1, luk: 1, con: life.stats.con, agi: life.stats.agi ?? 1 },
          rebirths
        );
        await equipGearTier(ctx, playerId, 8, enchant);
        const rate = async (tier: number, zone?: CombatZone) =>
          `${Math.round(winRate(await hunt(ctx, playerId, tier, 80, zone)) * 100)}%`;
        log(`${rebirths} | +${enchant} | ${await rate(8)} | ${await rate(8, "hard")} | ${await rate(9)} | ${await rate(9, "easy")} | ${await rate(10)}`);
      }
    }

    // 2b. The Blighted ladder: gear of the hunted tier, +8 enchants.
    log("");
    log("== Blighted ladder (life-end stats, forged gear of the hunted tier, +8 enchants)");
    log("rebirths | tier | full | easy | hard");
    for (const rebirths of [3, 6, 10]) {
      const playerId = await spawn(
        ctx,
        { str: life.stats.str, dex: 1, int: 1, luk: 1, con: life.stats.con, agi: life.stats.agi ?? 1 },
        rebirths
      );
      for (const tier of [9, 10, 11, 12, 13, 14, 15, 16]) {
        await equipGearTier(ctx, playerId, tier, 8);
        const rate = async (zone?: CombatZone) =>
          `${Math.round(winRate(await hunt(ctx, playerId, tier, 60, zone)) * 100)}%`;
        log(`${rebirths} | ${tier} | ${await rate()} | ${await rate("easy")} | ${await rate("hard")}`);
      }
    }

    // 3. Material income vs costs, hunting the hard zone at an even match.
    log("");
    log("== Material income (hard zone, end-of-life player at the tier) vs costs");
    log("tier | zone | fights/h | hide/h | bone/h | ichor/h | trophy/h");
    const endPlayer = await spawn(
      ctx,
      { str: life.stats.str, dex: 1, int: 1, luk: 1, con: life.stats.con, agi: life.stats.agi ?? 1 },
      0
    );
    for (const tier of [1, 2, 3, 4, 5, 6, 7, 8]) {
      // Use the pacing row's stats for that tier so the fight speed is realistic.
      const row = life.pacing.find((entry) => entry.tier === tier) ?? life.pacing[life.pacing.length - 1];
      await ctx.db.patch(endPlayer, { str: Math.max(row.str, 1), con: Math.max(row.con, 1), agi: Math.max(row.agi, 1) });
      await equipGearTier(ctx, endPlayer, tier);
      for (const zone of ["easy", "medium", "hard"] as const) {
        const result = await hunt(ctx, endPlayer, tier, 120, zone);
        const fightsPerHour = result.fights / (result.ms / 3_600_000);
        const drops = expectedDropsPerFight(tier, zone);
        const perHour = (kind: MaterialKind) => ((drops[kind] ?? 0) * fightsPerHour).toFixed(2);
        log(`${tier} | ${zone} | ${Math.round(fightsPerHour)} | ${perHour("hide")} | ${perHour("bone")} | ${perHour("ichor")} | ${perHour("trophy")}`);
      }
    }
    log("Costs: boss key 1 trophy; talisman 3 trophies; leather set ~30 hide (+bone/ichor); forged set 10 bone; woodworked set 12 hide; enchant level 10 bone or hide; Blighted piece 4 Blighted bone or hide + 3 tier 8 ingots.");
    log(`(win rate in those hard-zone hunts is not 100%: deaths are counted in the hours)`);
    console.log(lines.join("\n"));
    void materialItemIdForTier;
  });
});

// ─── Always-on guards ───────────────────────────────────────────────────────

test("the tier 9 jump makes tier 9 much harder than tier 8 for the same player", async () => {
  const t = await createWorld();
  await t.run(async (ctx) => {
    const playerId = await spawn(ctx, { str: 99, dex: 1, int: 1, luk: 1, con: 60, agi: 40 });
    await equipGearTier(ctx, playerId, 8);
    const player = (await ctx.db.get(playerId)) as Doc<"players">;
    const t8 = await loadBattleContext(ctx, player, 8, { zone: "hard", now: 0 });
    const t9 = await loadBattleContext(ctx, player, 9, { zone: "hard", now: 0 });
    const health = (battle: typeof t8) => {
      const fight = rollEncounter(battle);
      return fight.monsterMaxHealth;
    };
    // Blighted Grove is the Grove roster: the gap is tier scale × the jump.
    expect(health(t9)).toBeGreaterThan(health(t8) * 1.4 * 2);
  });
});

test("Blighted gear of the hunted tier keeps the easy zone farmable at 3 rebirths", { timeout: 60_000 }, async () => {
  const t = await createWorld();
  await t.run(async (ctx) => {
    const playerId = await spawn(ctx, { str: 99, dex: 1, int: 1, luk: 1, con: 59, agi: 59 }, 3);
    for (const tier of [9, 13, 16]) {
      await equipGearTier(ctx, playerId, tier, 8);
      expect(winRate(await hunt(ctx, playerId, tier, 40, "easy"))).toBeGreaterThanOrEqual(0.8);
    }
    // Without the ladder, tier 8 gear can't hold tier 13.
    await equipGearTier(ctx, playerId, 8, 8);
    expect(winRate(await hunt(ctx, playerId, 13, 40, "easy"))).toBeLessThan(0.2);
  });
});

test("a boss falls to gear of its tier but not to gear a tier behind", { timeout: 60_000 }, async () => {
  const t = await createWorld();
  await t.run(async (ctx) => {
    const playerId = await spawn(ctx, { str: 99, dex: 1, int: 1, luk: 1, con: 59, agi: 59 }, 3);
    const mult = Number(await readBalanceValue(ctx, "bossStatMultiplier"));
    // Proxy: the tier's apex at the boss multiplier, through the regular resolver.
    const bossWins = async (tier: number, gear: number) => {
      await equipGearTier(ctx, playerId, gear, 8);
      const player = (await ctx.db.get(playerId)) as Doc<"players">;
      const battle = await loadBattleContext(ctx, player, tier, { zone: "hard", now: 0 });
      const apex = battle.pool.reduce((a, b) => (b.strength > a.strength ? b : a));
      battle.pool = [{ ...apex, str: apex.str * mult, dex: apex.dex * mult, int: apex.int * mult, con: apex.con * mult }];
      let wins = 0;
      for (let i = 0; i < 10; i += 1) if (rollEncounter(battle).won) wins += 1;
      return wins / 10;
    };
    expect(mult).toBe(1.6);
    for (const tier of [8, 9, 12]) expect(await bossWins(tier, tier)).toBeGreaterThanOrEqual(0.8);
    expect(await bossWins(10, 9)).toBeLessThan(0.2);
  });
});
