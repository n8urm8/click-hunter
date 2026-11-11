import { insertPlayerWithRecords, patchPlayerWithRecords, playerWithRecords } from "./testPlayers";
/**
 * Simulation harness for AI-prompted automated testing, plus its own tests.
 *
 * Lives in a `.test.ts` file on purpose: Convex skips multi-dot files when
 * bundling deployment modules, and this harness value-imports `convex-test`
 * (which cannot be bundled). Scenario files import `Sim` from here:
 *
 * ```ts
 * import { Sim } from "./simHarness.test";
 * ```
 *
 * `convex-test` scenarios run against a fresh, hermetic database with faked
 * auth identities, so simulated players exercise the REAL public mutations
 * (ownership checks, level gates, gold costs, role permissions) with none of
 * the auth friction of driving a live deployment. See docs/sim-testing.md
 * for prompt recipes.
 */

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import type { TestConvexForDataModel } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { calculateCharacterLevel } from "./characterLevel";
import {
  createRng,
  ensureSkillDefinition,
  grantSimItems,
  insertSkillRows,
  randomSimName,
  resolveSpawnStats,
  validateSpawnSpecs,
  type SimItemSpec,
  type SimSkillSpec,
  type SimStats,
} from "./simShared";
import schema from "./schema";

export type SimClient = TestConvexForDataModel<DataModel>;

type ModulesMap = Record<string, () => Promise<unknown>>;

export type SpawnPlayerOpts = {
  name?: string;
  /**
   * Exact combat stat levels (in this game a combat stat's value IS its
   * level, e.g. `stats: { str: 99 }` means STR 99). Overrides `level` for
   * the stats given; remaining stats fall back to the `level` split.
   */
  stats?: Partial<SimStats>;
  /**
   * Target character level. Each unspecified combat stat is set to
   * `ceil(remaining / 5)`, where `remaining` is the target minus explicit
   * `skills` levels (so `level` + `skills` compose instead of stacking).
   * The returned `level` is the actual `calculateCharacterLevel` result,
   * which can read higher when other enabled skills already exist.
   */
  level?: number;
  /** Combat stat XP pools (progress toward the next stat level). */
  statXp?: Partial<SimStats>;
  gold?: number;
  totalExperience?: number;
  /** Non-combat skill levels, e.g. `{ skillId: "mining", level: 25 }`. */
  skills?: SimSkillSpec[];
  items?: SimItemSpec[];
};

export type SpawnedPlayer = {
  playerId: Id<"players">;
  /** Identity-scoped client: call real mutations as this player. */
  as: SimClient;
  name: string;
  subject: string;
  /** Actual character level after spawn. */
  level: number;
};

export type ApplyResult = {
  player: SpawnedPlayer;
  ok: boolean;
  applicationId?: Id<"guildApplications">;
  error?: string;
};

const SIM_ANON_PREFIX = "sim-test-player-";

export class Sim {
  private constructor(
    readonly client: SimClient,
    private readonly rng: () => number,
    private readonly usedNames: Set<string>,
    private counter: number
  ) {}

  /** Build a fresh sim world. `modules` is always `import.meta.glob([...])`. */
  static async create(
    modules: ModulesMap,
    opts?: { seed?: number }
  ): Promise<Sim> {
    const base = convexTest(schema, modules as never);
    rateLimiterTest.register(base);
    return new Sim(
      base,
      createRng(opts?.seed ?? 0xC10C),
      new Set<string>(),
      0
    );
  }

  /**
   * Spawn one player with an isolated auth identity. Returns the row ID, an
   * identity-scoped client (`as`) for calling real mutations as that player,
   * and the actual character level.
   *
   * Combat skills are the five stats (`stats: { str: 99 }`); non-combat
   * skills go in `skills: [{ skillId: "mining", level: 25 }]`. When `level`
   * is combined with explicit `skills`, the skill levels are subtracted from
   * the target before the remainder is split across unspecified stats.
   */
  async spawnPlayer(opts: SpawnPlayerOpts = {}): Promise<SpawnedPlayer> {
    this.counter += 1;
    const name = opts.name ?? randomSimName(this.rng, this.usedNames);
    const subject = `sim:${name}:${this.counter}`;
    validateSpawnSpecs(opts.stats, opts.skills);
    const stats = resolveSpawnStats(opts.level, opts.stats, opts.skills);
    const statXp = {
      str: 0,
      dex: 0,
      int: 0,
      luk: 0,
      con: 0,
      ...opts.statXp,
    };

    const playerId: Id<"players"> = await this.client.run(async (ctx) => {
      const now = Date.now();
      const id = await insertPlayerWithRecords(ctx, {
        anonymousId: `${SIM_ANON_PREFIX}${this.counter}-${Math.floor(this.rng() * 1e9)}`,
        name,
        authSubject: subject,
        ...stats,
        statXp,
        gold: opts.gold ?? 0,
        totalExperience: opts.totalExperience ?? 0,
        rebirthCount: 0,
        rebirthTierThreshold: 5,
        currentTier: 1,
        maxTierReached: 1,
        autoAttackEnabled: true,
        autoStartFightEnabled: false,
        createdAt: now,
        lastUpdated: now,
      });

      await insertSkillRows(ctx, id, opts.skills ?? []);
      await grantSimItems(ctx, id, opts.items ?? []);
      return id;
    });

    const as = this.client.withIdentity({ subject });
    const level = await this.client.run(async (ctx) => {
      const player = await playerWithRecords(ctx, playerId);
      if (!player) throw new Error("Spawned player not found");
      return await calculateCharacterLevel(ctx, player);
    });
    return { playerId, as, name, subject, level };
  }

  /**
   * Spawn `count` players. Each gets `namePrefix-N` unless `names` is given.
   * `levelRange: [min, max]` rolls a target level per player; `level` applies
   * one target to all; explicit `stats`/`skills`/`gold` apply to all.
   */
  async spawnPlayers(
    count: number,
    opts: SpawnPlayerOpts & {
      namePrefix?: string;
      names?: string[];
      levelRange?: [number, number];
    } = {}
  ): Promise<SpawnedPlayer[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 200) {
      throw new Error("spawnPlayers count must be 1-200");
    }
    const players: SpawnedPlayer[] = [];
    for (let i = 0; i < count; i += 1) {
      const level =
        opts.levelRange !== undefined
          ? Math.floor(
              opts.levelRange[0] +
                this.rng() * (opts.levelRange[1] - opts.levelRange[0] + 1)
            )
          : opts.level;
      players.push(
        await this.spawnPlayer({
          ...opts,
          name:
            opts.names?.[i] ??
            (opts.namePrefix ? `${opts.namePrefix}-${i + 1}` : undefined),
          level,
        })
      );
    }
    return players;
  }

  /** Direct stat/gold/skill edits on an existing player (bypasses gameplay). */
  async setStats(playerId: Id<"players">, stats: Partial<SimStats>) {
    await this.client.run(async (ctx) => {
      await ctx.db.patch(playerId, { ...stats, lastUpdated: Date.now() });
    });
  }

  async setGold(playerId: Id<"players">, gold: number) {
    await this.client.run(async (ctx) => {
      await patchPlayerWithRecords(ctx, playerId, { gold, lastUpdated: Date.now() });
    });
  }

  async setSkillLevel(playerId: Id<"players">, skill: SimSkillSpec) {
    await this.client.run(async (ctx) => {
      await ensureSkillDefinition(ctx, skill);
      const existing = await ctx.db
        .query("playerSkills")
        .withIndex("by_playerId_and_skillId", (q) =>
          q.eq("playerId", playerId).eq("skillId", skill.skillId)
        )
        .first();
      const now = Date.now();
      if (existing) {
        await ctx.db.patch(existing._id, { level: skill.level, updatedAt: now });
      } else {
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
    });
  }

  /** Actual character level for assertions. */
  async characterLevel(playerId: Id<"players">): Promise<number> {
    return await this.client.run(async (ctx) => {
      const player = await playerWithRecords(ctx, playerId);
      if (!player) throw new Error("Player not found");
      return await calculateCharacterLevel(ctx, player);
    });
  }

  /**
   * Spawn an owner (default level 120, 100k gold) and found a guild through
   * the real `createGuild` mutation.
   */
  async spawnGuild(opts: {
    name: string;
    tag: string;
    description?: string;
    owner?: SpawnedPlayer;
    ownerOpts?: SpawnPlayerOpts;
  }) {
    const owner =
      opts.owner ??
      (await this.spawnPlayer({
        name: `${opts.name}-owner`,
        level: 120,
        gold: 100000,
        ...opts.ownerOpts,
      }));
    const guild = await owner.as.mutation(api.guilds.createGuild, {
      playerId: owner.playerId,
      name: opts.name,
      tag: opts.tag,
      description: opts.description ?? "",
    });
    if (!guild) throw new Error("spawnGuild: createGuild returned null");
    return { guild, owner };
  }

  /**
   * Have each player apply to a guild through the real `applyToGuild`
   * mutation (level gates enforced). Never throws per player — check
   * `result.ok` / `result.error`.
   */
  async applyAll(
    players: SpawnedPlayer[],
    guildId: Id<"guilds">,
    message?: string
  ): Promise<ApplyResult[]> {
    const results: ApplyResult[] = [];
    for (const player of players) {
      try {
        const application = await player.as.mutation(api.guilds.applyToGuild, {
          playerId: player.playerId,
          guildId,
          ...(message ? { message } : {}),
        });
        results.push({
          player,
          ok: true,
          applicationId: application?._id,
        });
      } catch (error) {
        results.push({
          player,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }
}

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

test("spawnPlayer hits the requested character level", async () => {
  const sim = await Sim.create(modules, { seed: 1 });
  const player = await sim.spawnPlayer({ name: "Leveler", level: 120 });
  expect(player.level).toBeGreaterThanOrEqual(120);
  expect(await sim.characterLevel(player.playerId)).toBe(player.level);
});

test("combat stats and non-combat skills compose toward the target level", async () => {
  const sim = await Sim.create(modules, { seed: 11 });
  // STR fixed at 30; the remaining 60 (70 target minus mining 10) splits
  // across dex/int/luk/con at 15 each: 30 + 60 + 10 = 100.
  // With wisdom and agility (default 1 each): 30 + 60 + 1 + 1 + 10 = 102.
  const hybrid = await sim.spawnPlayer({
    name: "Hybrid",
    level: 70,
    stats: { str: 30 },
    skills: [{ skillId: "mining", level: 10 }],
  });
  expect(hybrid.level).toBe(102);

  // Pure combat: exact stat levels. Note the +1: the `mining` definition
  // created for Hybrid above is enabled, so it counts 1 level for every
  // player without a mining row — character level includes unstarted skills.
  const bruiser = await sim.spawnPlayer({
    name: "Bruiser",
    stats: { str: 99, dex: 40, int: 1, luk: 1, con: 30 },
  });
  // 5 stats + wisdom (1) + agility (1) + unstarted mining skill (1)
  // = 99+40+1+1+30+1+1+1 = 174
  expect(bruiser.level).toBe(99 + 40 + 1 + 1 + 30 + 1 + 1 + 1);

  await expect(
    sim.spawnPlayer({ name: "Bad", skills: [{ skillId: "mining", level: 0 }] })
  ).rejects.toThrow(/integer >= 1/);
});

test("spawnPlayer supports skills, items, and equipment", async () => {
  const sim = await Sim.create(modules, { seed: 2 });
  await sim.client.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("items", {
      itemId: "sim-test-sword",
      name: "Sim Test Sword",
      category: "equipment",
      description: "A sword for sims",
      stackable: false,
      maxStackSize: 1,
      allowedEquipmentSlots: ["mainHand"],
      baseDamage: 10,
      attackSpeed: 1,
      createdAt: now,
      updatedAt: now,
    });
  });

  const player = await sim.spawnPlayer({
    name: "Geared",
    level: 60,
    skills: [{ skillId: "woodcutting", level: 10 }],
    items: [{ slug: "sim-test-sword", equipSlot: "mainHand" }],
  });
  // 10 per stat (6 stats including wisdom) + 10 woodcutting = 70.
  // But level: 60 sets stats to 10 each for 5 stats, wisdom and agility
  // default to 1. So 5*10 + 1 + 1 + 10 = 62.
  expect(player.level).toBe(62);

  const equipped = await sim.client.run((ctx) =>
    ctx.db
      .query("playerItems")
      .withIndex("by_playerId_and_equippedSlot", (q) =>
        q.eq("playerId", player.playerId).eq("equippedSlot", "mainHand")
      )
      .first()
  );
  expect(equipped).not.toBeNull();
});

test("guild application flow with mixed-level applicants", async () => {
  const sim = await Sim.create(modules, { seed: 3 });
  const { guild, owner } = await sim.spawnGuild({
    name: "Sim Legion",
    tag: "SIML",
  });
  expect(owner.level).toBeGreaterThanOrEqual(100);

  const applicants = await sim.spawnPlayers(6, {
    levelRange: [40, 90],
    namePrefix: "Applicant",
  });
  const results = await sim.applyAll(applicants, guild._id);

  // Below-50 applicants are rejected by the join gate; 50+ succeed.
  for (const result of results) {
    if (result.player.level >= 50) {
      expect(result.ok).toBe(true);
    } else {
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/character level 50/);
    }
  }
  const accepted = results.filter((r) => r.ok);
  expect(accepted.length).toBeGreaterThan(0);

  // Officer accepts every pending application through the real mutation.
  const pending = await owner.as.query(api.guilds.getPendingApplications, {
    playerId: owner.playerId,
    guildId: guild._id,
  });
  expect(pending.length).toBe(accepted.length);
  for (const application of pending) {
    if (!("playerName" in application)) continue;
    await owner.as.mutation(api.guilds.acceptApplication, {
      playerId: owner.playerId,
      applicationId: application._id,
    });
  }

  const roster = await owner.as.query(api.guilds.getGuildMembers, {
    playerId: owner.playerId,
    guildId: guild._id,
  });
  // Owner + every accepted applicant.
  expect(roster.length).toBe(1 + accepted.length);
});
