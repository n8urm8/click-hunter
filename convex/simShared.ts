/**
 * Shared simulation helpers for the hermetic harness (`simHarness.ts`) and
 * the live-database harness (`simLive.ts`).
 *
 * Deployment-safe: this module never imports `convex-test`, so it can ship
 * in the Convex bundle. Pure logic (names, RNG, stat math) plus tiny
 * context helpers live here; client/server orchestration stays in the two
 * harness files.
 */

import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { grantItemToInventory } from "./items";

export type SimStats = {
  str: number;
  dex: number;
  int: number;
  luk: number;
  con: number;
};

export type SimSkillSpec = {
  skillId: string;
  level: number;
  category?: "gathering" | "crafting";
  name?: string;
};

export type SimItemSpec = {
  /** Stable item slug, e.g. `essence-tier-1` or a seeded equipment ID. */
  slug: string;
  quantity?: number;
  /** Equipment slot to equip into after granting, e.g. `mainHand`. */
  equipSlot?: string;
};

export const SIM_STAT_KEYS = ["str", "dex", "int", "luk", "con"] as const;

const SIM_NAMES = [
  "Ash", "Birch", "Cinder", "Dusk", "Ember", "Flint", "Gale", "Hazel",
  "Ivy", "Juniper", "Kael", "Lark", "Moss", "Nix", "Onyx", "Pip",
  "Quill", "Rowan", "Sage", "Tarn", "Ulma", "Vex", "Wren", "Yara", "Zeph",
];

/** Deterministic PRNG (mulberry32) so sims are reproducible from a seed. */
export function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSimName(rng: () => number, used: Set<string>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const name = `${SIM_NAMES[Math.floor(rng() * SIM_NAMES.length)]}-${Math.floor(rng() * 1000)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `Sim-${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

export function validateSpawnSpecs(
  stats?: Partial<SimStats>,
  skills?: SimSkillSpec[]
) {
  for (const [stat, value] of Object.entries(stats ?? {})) {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
      throw new Error(`spawnPlayer: stat "${stat}" must be an integer >= 1`);
    }
  }
  for (const skill of skills ?? []) {
    if (!Number.isSafeInteger(skill.level) || skill.level < 1) {
      throw new Error(
        `spawnPlayer: skill "${skill.skillId}" level must be an integer >= 1`
      );
    }
  }
}

/**
 * Resolve final combat stats from an optional target level, explicit stats,
 * and explicit skill levels. Explicit skill levels are subtracted from the
 * target first; the remainder splits across unspecified stats.
 */
export function resolveSpawnStats(
  level: number | undefined,
  stats: Partial<SimStats> | undefined,
  skills: SimSkillSpec[] | undefined
): SimStats {
  const explicitSkillTotal = (skills ?? []).reduce(
    (sum, skill) => sum + Math.max(0, Math.floor(skill.level)),
    0
  );
  const unspecifiedCount =
    SIM_STAT_KEYS.filter((stat) => stats?.[stat] === undefined).length || 1;
  const perStat =
    level !== undefined
      ? Math.max(
          1,
          Math.ceil(
            Math.max(0, level - explicitSkillTotal) / unspecifiedCount
          )
        )
      : undefined;
  return {
    str: stats?.str ?? perStat ?? 1,
    dex: stats?.dex ?? perStat ?? 1,
    int: stats?.int ?? perStat ?? 1,
    luk: stats?.luk ?? perStat ?? 1,
    con: stats?.con ?? perStat ?? 1,
  };
}

export async function ensureSkillDefinition(
  ctx: MutationCtx,
  spec: SimSkillSpec
) {  const existing = await ctx.db
    .query("skillDefinitions")
    .withIndex("by_skillId", (q) => q.eq("skillId", spec.skillId))
    .first();
  if (existing) return existing;
  const now = Date.now();
  const id = await ctx.db.insert("skillDefinitions", {
    skillId: spec.skillId,
    name: spec.name ?? spec.skillId,
    category: spec.category ?? "gathering",
    description: `Simulated skill ${spec.skillId}`,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error(`Could not create skill ${spec.skillId}`);
  return created;
}

async function lookupItemBySlug(ctx: MutationCtx, slug: string) {
  const item = await ctx.db
    .query("items")
    .withIndex("by_itemId", (q) => q.eq("itemId", slug))
    .first();
  if (!item) {
    throw new Error(
      `Unknown item slug "${slug}". Seed items first (seed:populateAll) or check the slug.`
    );
  }
  return item;
}

/** Grant sim items by slug, optionally equipping into a slot. */
export async function grantSimItems(  ctx: MutationCtx,
  playerId: Id<"players">,
  items: SimItemSpec[]
) {
  const now = Date.now();
  for (const item of items) {
    const def = await lookupItemBySlug(ctx, item.slug);
    await grantItemToInventory(ctx, {
      playerId,
      itemId: def._id,
      quantity: item.quantity ?? 1,
      overflowSource: {
        sourceType: "crafting",
        sourceId: item.slug,
        settlementKey: `sim:${String(playerId)}:${item.slug}`,
      },
    });
    if (item.equipSlot) {
      const owned = await ctx.db
        .query("playerItems")
        .withIndex("by_playerId_and_itemId", (q) =>
          q.eq("playerId", playerId).eq("itemId", def._id)
        )
        .first();
      if (!owned) throw new Error(`Granted item ${item.slug} not found`);
      await ctx.db.patch(owned._id, {
        equippedSlot: item.equipSlot as Doc<"playerItems">["equippedSlot"],
        updatedAt: now,
      });
    }
  }
}

/** Create skill definitions (if missing) and player skill rows. */
export async function insertSkillRows(
  ctx: MutationCtx,
  playerId: Id<"players">,
  skills: SimSkillSpec[]
) {
  const now = Date.now();
  for (const skill of skills) {
    await ensureSkillDefinition(ctx, skill);
    await ctx.db.insert("playerSkills", {
      playerId,
      skillId: skill.skillId,
      level: skill.level,
      experience: 0,
      totalExperience: 0,
      actionsCompleted: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
}
