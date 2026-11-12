/// <reference types="vite/client" />
import { insertPlayerWithRecords, playerWithRecords } from "./testPlayers";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { saturdayWeekStart, isSaturdayUTC } from "./guildRaids";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

// Pinned Saturday noon UTC: the raid-day gate passes and weekStart is stable.
const SATURDAY_NOON = Date.UTC(2026, 9, 17, 12);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(SATURDAY_NOON);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const owner = base.withIdentity({ subject: "raid-owner" });
  const member = base.withIdentity({ subject: "raid-member" });
  const fixture = await owner.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await insertPlayerWithRecords(ctx, {
      anonymousId: "raid-owner-anon",
      name: "Owner",
      authSubject: "raid-owner",
      str: 50,
      dex: 50,
      int: 50,
      luk: 10,
      con: 50,
      gold: 100000,
      totalExperience: 1000,
      rebirthCount: 0,
      rebirthTierThreshold: 5,
      currentTier: 1,
      maxTierReached: 1,
      autoAttackEnabled: true,
      autoStartFightEnabled: false,
      createdAt: now,
      lastUpdated: now,
    });
    const memberId = await insertPlayerWithRecords(ctx, {
      anonymousId: "raid-member-anon",
      name: "Member",
      authSubject: "raid-member",
      str: 50,
      dex: 50,
      int: 50,
      luk: 10,
      con: 50,
      gold: 1000,
      totalExperience: 500,
      rebirthCount: 0,
      rebirthTierThreshold: 5,
      currentTier: 1,
      maxTierReached: 1,
      autoAttackEnabled: true,
      autoStartFightEnabled: false,
      createdAt: now,
      lastUpdated: now,
    });
    await ctx.db.insert("monsters", {
      type: "rat",
      name: "Rat",
      str: 2,
      dex: 4,
      int: 1,
      luk: 2,
      con: 2,
      goldDrop: 10,
      experienceReward: 5,
      baseMsPerAttack: 2000,
      strength: 5,
      createdAt: now,
    });
    await ctx.db.insert("guildBonuses", {
      level: 1,
      goldBonusPercent: 0,
      xpBonusPercent: 0,
      statBonusPercent: 0,
      maxMembers: 10,
      raidSlots: 2,
      createdAt: now,
    });
    return { ownerId, memberId };
  });
  await owner.mutation(api.guilds.createGuild, {
    playerId: fixture.ownerId,
    name: "Raid Guild",
    tag: "RG",
    description: "",
  });
  const invite = await owner.mutation(api.guilds.invitePlayer, {
    playerId: fixture.ownerId,
    targetPlayerId: fixture.memberId,
  });
  if (!invite) throw new Error("Missing invite");
  await member.mutation(api.guilds.acceptInvite, {
    playerId: fixture.memberId,
    applicationId: invite._id,
  });
  return { base, owner, member, ...fixture };
}

async function summonBegin(
  t: Awaited<ReturnType<typeof setup>>,
  summoner: "owner" | "member",
  tier: number
) {
  const caller = summoner === "owner" ? t.owner : t.member;
  const callerId = summoner === "owner" ? t.ownerId : t.memberId;
  const raid = await caller.mutation(api.guildRaids.startRaid, {
    playerId: callerId,
    tier,
  });
  if (!raid) throw new Error("Missing raid");
  const other = summoner === "owner" ? t.member : t.owner;
  const otherId = summoner === "owner" ? t.memberId : t.ownerId;
  await other.mutation(api.guildRaids.joinRaid, {
    playerId: otherId,
    raidId: raid._id,
  });
  // Creator (even a plain member) may begin their own party.
  const begun = await caller.mutation(api.guildRaids.beginRaid, {
    playerId: callerId,
    raidId: raid._id,
  });
  if (!begun) throw new Error("Missing begun raid");
  return begun;
}

/**
 * Automatic combat: advance the fake clock so N rounds come due, then tick.
 * Anyone may tick — there is no manual battling.
 */
async function tick(
  t: Awaited<ReturnType<typeof setup>>,
  who: "owner" | "member",
  raidId: Id<"guildRaids">,
  rounds = 15
): Promise<any> {
  const caller = who === "owner" ? t.owner : t.member;
  const callerId = who === "owner" ? t.ownerId : t.memberId;
  vi.setSystemTime(Date.now() + rounds * 2000);
  return await caller.mutation(api.guildRaids.tickRaid, {
    playerId: callerId,
    raidId,
  });
}

async function tickUntilDone(
  t: Awaited<ReturnType<typeof setup>>,
  raidId: Id<"guildRaids">
): Promise<any> {
  let result: any = null;
  for (let i = 0; i < 10; i += 1) {
    result = await tick(t, i % 2 === 0 ? "owner" : "member", raidId);
    if (
      result.killed ||
      result.wiped ||
      result.stopped ||
      result.status === "completed" ||
      result.status === "failed" ||
      result.status === "superseded"
    ) {
      break;
    }
  }
  return result;
}

test("officer summons and any member can party, join, and begin", async () => {
  const t = await setup();
  const raid = await t.owner.mutation(api.guildRaids.startRaid, {
    playerId: t.ownerId,
    tier: 1,
  });
  expect(raid?.status).toBe("forming");
  expect(raid?.participants.length).toBe(1);

  await t.member.mutation(api.guildRaids.joinRaid, {
    playerId: t.memberId,
    raidId: raid!._id,
  });
  const begun = await t.owner.mutation(api.guildRaids.beginRaid, {
    playerId: t.ownerId,
    raidId: raid!._id,
  });
  expect(begun?.status).toBe("active");
  expect(begun?.participants.length).toBe(2);
  expect(begun?.participants[0].maxHp).toBeGreaterThan(0);
  // Raid dragons get boss defense: 1 per tier times the default 3.
  expect(begun?.dragonDefense).toBe(3);

  // Members can open their own second lobby for the same tier.
  const party = await t.member.mutation(api.guildRaids.createRaidParty, {
    playerId: t.memberId,
    tier: 1,
  });
  expect(party?.status).toBe("forming");
});

test("parties hold at most four hunters", async () => {
  const t = await setup();
  const raid = await t.owner.mutation(api.guildRaids.startRaid, {
    playerId: t.ownerId,
    tier: 1,
  });
  // Three more guildmates join directly (owner + member + 2 = 4).
  const extras = await t.owner.run(async (ctx) => {
    const now = Date.now();
    const guild = await ctx.db.query("guilds").first();
    if (!guild) throw new Error("Missing guild");
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      const pid = await insertPlayerWithRecords(ctx, {
        anonymousId: `extra-${i}`,
        name: `Extra${i}`,
        authSubject: `raid-extra-${i}`,
        str: 10,
        dex: 10,
        int: 10,
        luk: 10,
        con: 10,
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
      await ctx.db.insert("guildMembers", {
        guildId: guild._id,
        playerId: pid,
        role: "member",
        joinedAt: now,
        contributionXp: 0,
        contributionGold: 0,
        lastActiveAt: now,
      });
      ids.push(pid);
    }
    return ids;
  });
  await t.member.mutation(api.guildRaids.joinRaid, {
    playerId: t.memberId,
    raidId: raid!._id,
  });
  for (let i = 0; i < 2; i += 1) {
    const ident = t.base.withIdentity({ subject: `raid-extra-${i}` });
    await ident.mutation(api.guildRaids.joinRaid, {
      playerId: extras[i],
      raidId: raid!._id,
    });
  }
  const full = t.base.withIdentity({ subject: "raid-extra-2" });
  await expect(
    full.mutation(api.guildRaids.joinRaid, {
      playerId: extras[2],
      raidId: raid!._id,
    })
  ).rejects.toThrow();
});

test("ticks kill the dragon and pay boss-tier XP to every damager", async () => {
  const t = await setup();
  const raid = await summonBegin(t, "owner", 1);
  const beforeOwner = await t.owner.run((ctx) => playerWithRecords(ctx, t.ownerId));
  const beforeMember = await t.owner.run((ctx) => playerWithRecords(ctx, t.memberId));
  const result = await tickUntilDone(t, raid._id);
  expect(result?.killed).toBe(true);
  const afterOwner = await t.owner.run((ctx) => playerWithRecords(ctx, t.ownerId));
  const afterMember = await t.owner.run((ctx) => playerWithRecords(ctx, t.memberId));
  expect((afterOwner?.gold ?? 0)).toBeGreaterThan(beforeOwner?.gold ?? 0);
  expect((afterOwner?.totalExperience ?? 0)).toBeGreaterThan(
    beforeOwner?.totalExperience ?? 0
  );
  expect((afterMember?.totalExperience ?? 0)).toBeGreaterThan(
    beforeMember?.totalExperience ?? 0
  );
});

test("kill loot lands in the guild stash, not player inventories", async () => {
  const t = await setup();
  await t.owner.run(async (ctx) => {
    const now = Date.now();
    const itemId = await ctx.db.insert("items", {
      itemId: "dragon-scale",
      name: "Dragon Scale",
      category: "crafting",
      description: "scale",
      stackable: true,
      maxStackSize: 100,
      allowedEquipmentSlots: [],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("lootTables", {
      lootTableId: "raid-t1",
      name: "raid t1",
      sourceType: "boss",
      tier: 1,
      rollCount: 1,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("lootTableEntries", {
      lootTableId: "raid-t1",
      itemId,
      weight: 1,
      dropChance: 1,
      minQuantity: 2,
      maxQuantity: 2,
      guaranteed: true,
      purpose: "augmentation",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("lootSources", {
      sourceType: "boss",
      sourceId: "boss_tier_1",
      tier: 1,
      lootTableId: "raid-t1",
      createdAt: now,
      updatedAt: now,
    });
  });
  const raid = await summonBegin(t, "owner", 1);
  const result = await tickUntilDone(t, raid._id);
  expect(result?.killed).toBe(true);
  const stash = await t.owner.query(api.guildStash.getGuildStash, {
    playerId: t.ownerId,
  });
  expect(stash.length).toBeGreaterThan(0);
  // The table's 2 scales plus 2 per raider for the guild buildings.
  const scales = stash
    .filter((row) => row.itemSlug === "dragon-scale")
    .reduce((sum, row) => sum + row.quantity, 0);
  expect(scales).toBe(2 + 2 * 2);
});

test("a wipe still pays XP and chips the tier for the next lobby", async () => {
  const t = await setup();
  const raid = await summonBegin(t, "owner", 1);
  // Drop everyone to 1 HP with no mitigation: the next automatic rounds
  // wipe the lobby (basic kills the top threat, then the survivor).
  await t.owner.run(async (ctx) => {
    const row = await ctx.db.get(raid._id);
    if (!row) throw new Error("Missing raid");
    await ctx.db.patch(raid._id, {
      participants: row.participants.map((p) => ({
        ...p,
        hp: 1,
        defense: 0,
        magicalDefense: 0,
        ward: 0,
      })),
    });
  });
  const before = await t.owner.run((ctx) => playerWithRecords(ctx, t.ownerId));
  const result: any = await tick(t, "owner", raid._id, 3);
  expect(result.wiped).toBe(true);
  const after = await t.owner.run((ctx) => playerWithRecords(ctx, t.ownerId));
  expect((after?.totalExperience ?? 0)).toBeGreaterThan(
    before?.totalExperience ?? 0
  );
  // Next lobby copies the chipped HP, not a fresh dragon.
  const next = await t.member.mutation(api.guildRaids.createRaidParty, {
    playerId: t.memberId,
    tier: 1,
  });
  expect(next!.bossMaxHp).toBe(raid.bossMaxHp);
  expect(next!.bossHp).toBeLessThan(raid.bossMaxHp);
});

test("first kill wins; other lobbies are told to stop and keep XP only", async () => {
  const t = await setup();
  const lobbyA = await summonBegin(t, "owner", 1);
  const lobbyBRow = await t.member.mutation(api.guildRaids.createRaidParty, {
    playerId: t.memberId,
    tier: 1,
  });
  await t.owner.mutation(api.guildRaids.joinRaid, {
    playerId: t.ownerId,
    raidId: lobbyBRow!._id,
  });
  await t.member.mutation(api.guildRaids.beginRaid, {
    playerId: t.memberId,
    raidId: lobbyBRow!._id,
  });
  let kill: any = null;
  for (let i = 0; i < 4; i += 1) {
    kill = await tick(t, "owner", lobbyA._id);
    if (kill.killed || kill.wiped || kill.stopped) break;
  }
  expect(kill?.killed).toBe(true);
  const stopped: any = await tick(t, "member", lobbyBRow!._id);
  expect(stopped.stopped).toBe(true);
  const lobbyB = await t.owner.run((ctx) => ctx.db.get(lobbyBRow!._id));
  expect(lobbyB?.status).toBe("superseded");
  // Tier 2 unlocks after the tier 1 kill.
  const t2 = await t.owner.mutation(api.guildRaids.startRaid, {
    playerId: t.ownerId,
    tier: 2,
  });
  expect(t2?.tier).toBe(2);
});

test("raid XP pays once per player per tier per week", async () => {
  const t = await setup();
  const lobbyA = await summonBegin(t, "owner", 1);
  const kill = await tickUntilDone(t, lobbyA._id);
  expect(kill?.killed).toBe(true);
  // Same owner fights tier 2 (unlocked by the tier 1 kill) and wipes solo.
  const t2 = await t.owner.mutation(api.guildRaids.startRaid, {
    playerId: t.ownerId,
    tier: 2,
  });
  await t.owner.mutation(api.guildRaids.beginRaid, {
    playerId: t.ownerId,
    raidId: t2!._id,
  });
  await t.owner.run(async (ctx) => {
    const row = await ctx.db.get(t2!._id);
    if (!row) throw new Error("Missing raid");
    await ctx.db.patch(t2!._id, {
      participants: row.participants.map((p) => ({
        ...p,
        hp: 1,
        defense: 0,
        magicalDefense: 0,
        ward: 0,
      })),
    });
  });
  const first: any = await tick(t, "owner", t2!._id, 2);
  expect(first.wiped).toBe(true);
  // A second lobby on the same tier still chips damage but pays no repeat XP.
  const lobbyC = await t.owner.mutation(api.guildRaids.createRaidParty, {
    playerId: t.ownerId,
    tier: 2,
  });
  await t.owner.mutation(api.guildRaids.beginRaid, {
    playerId: t.ownerId,
    raidId: lobbyC!._id,
  });
  await t.owner.run(async (ctx) => {
    const row = await ctx.db.get(lobbyC!._id);
    if (!row) throw new Error("Missing raid");
    await ctx.db.patch(lobbyC!._id, {
      participants: row.participants.map((p) => ({
        ...p,
        hp: 1,
        defense: 0,
        magicalDefense: 0,
        ward: 0,
      })),
    });
  });
  const second: any = await tick(t, "owner", lobbyC!._id, 2);
  expect(second.wiped).toBe(true);
  const grants = await t.owner.run((ctx) =>
    ctx.db
      .query("guildRaidXpGrants")
      .withIndex("by_guild_week_tier_player", (q) =>
        q
          .eq("guildId", t2!.guildId)
          .eq("weekStart", t2!.weekStart!)
          .eq("tier", 2)
          .eq("playerId", t.ownerId)
      )
      .collect()
  );
  expect(grants.length).toBe(1);
});

test("leaderboard ranks the week's highest tier and damage", async () => {
  const t = await setup();
  const raid = await summonBegin(t, "owner", 1);
  await tickUntilDone(t, raid._id);
  const board = await t.owner.query(api.guildRaids.getRaidLeaderboard, {
    playerId: t.ownerId,
  });
  expect(board.length).toBeGreaterThan(0);
  expect(board[0].highestTierKilled).toBeGreaterThanOrEqual(1);
  expect(board[0].totalDamage).toBeGreaterThan(0);
});

test("a not-due poll is cheap: no balance scan, no write", async () => {
  const t = await setup();
  const raid = await summonBegin(t, "owner", 1);
  // Poll immediately without advancing the clock. Nothing is due, so the
  // handler must exit after a few point reads — never scanning gameBalance
  // (100+ rows) and never writing.
  const { result, metrics } = await t.owner.run(async (ctx) => {
    const result = await ctx.runMutation(api.guildRaids.tickRaid, {
      playerId: t.ownerId,
      raidId: raid._id,
    });
    return { result, metrics: await ctx.meta.getTransactionMetrics() };
  });
  expect(result.advanced).toBe(0);
  expect(result.changed).toBe(false);
  expect(metrics.documentsWritten.used).toBe(0);
  expect(metrics.documentsRead.used).toBeLessThanOrEqual(8);
});

test("a due tick advances rounds without scanning gameBalance", async () => {
  const t = await setup();
  const raid = await summonBegin(t, "owner", 1);
  const { result, metrics } = await t.owner.run(async (ctx) => {
    vi.setSystemTime(Date.now() + 3 * 2000);
    const result = await ctx.runMutation(api.guildRaids.tickRaid, {
      playerId: t.ownerId,
      raidId: raid._id,
    });
    return { result, metrics: await ctx.meta.getTransactionMetrics() };
  });
  expect(result.advanced).toBeGreaterThanOrEqual(1);
  expect(result.changed).toBe(true);
  // Frozen tuning + attack come off the row, so a fighting tick stays well
  // under the ~100+ rows a gameBalance collect would read.
  expect(metrics.documentsRead.used).toBeLessThanOrEqual(30);
});

test("raids are gated to Saturday UTC", async () => {
  const t = await setup();
  vi.setSystemTime(Date.UTC(2026, 9, 18, 12)); // Sunday
  await expect(
    t.owner.mutation(api.guildRaids.startRaid, {
      playerId: t.ownerId,
      tier: 1,
    })
  ).rejects.toThrow("Saturday");
});

test("saturday bucket math is stable across the weekend", () => {
  // 2026-10-17 is a Saturday; the whole Sat 00:00Z–Sun 00:00Z window maps
  // to the same weekStart, and Sunday rolls to the same bucket until the
  // next Saturday.
  expect(saturdayWeekStart(Date.UTC(2026, 9, 17, 12))).toBe(
    Date.UTC(2026, 9, 17)
  );
  expect(saturdayWeekStart(Date.UTC(2026, 9, 18, 0, 0, 1))).toBe(
    Date.UTC(2026, 9, 17)
  );
  expect(saturdayWeekStart(Date.UTC(2026, 9, 23, 23))).toBe(
    Date.UTC(2026, 9, 17)
  );
  expect(saturdayWeekStart(Date.UTC(2026, 9, 24, 0, 0, 1))).toBe(
    Date.UTC(2026, 9, 24)
  );
  expect(isSaturdayUTC(Date.UTC(2026, 9, 17, 12))).toBe(true);
  expect(isSaturdayUTC(Date.UTC(2026, 9, 18, 12))).toBe(false);
});

test("weekly objectives track combat and can be claimed", async () => {
  const { owner, ownerId } = await setup();
  const before = await owner.query(api.guildObjectives.getWeeklyObjectives, {
    playerId: ownerId,
  });
  expect(before).not.toBeNull();

  // Seed a completed week row directly, then claim through the mutation
  // (queries cannot write, so preview rows exist until first progress/claim).
  await owner.run(async (ctx) => {
    const membership = await ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", ownerId))
      .first();
    if (!membership) throw new Error("Missing membership");
    const guild = await ctx.db.get(membership.guildId);
    if (!guild) throw new Error("Missing guild");
    const weekStart = (() => {
      const date = new Date(Date.now());
      const day = (date.getUTCDay() + 6) % 7;
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - day);
      return date.getTime();
    })();
    await ctx.db.insert("guildWeeklyObjectives", {
      guildId: membership.guildId,
      weekStart,
      objectives: [
        { objectiveId: "slay_monsters", target: 10, progress: 10, rewardGold: 1000, rewardXp: 500, claimed: false },
        { objectiveId: "earn_gold", target: 10, progress: 0, rewardGold: 2000, rewardXp: 500, claimed: false },
        { objectiveId: "earn_xp", target: 10, progress: 0, rewardGold: 1000, rewardXp: 1000, claimed: false },
      ],
      totalProgress: 10,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    void guild;
  });
  const after = await owner.query(api.guildObjectives.getWeeklyObjectives, {
    playerId: ownerId,
  });
  if (!after || after.preview) throw new Error("Missing objectives row");
  expect(after.objectives[0].progress).toBeGreaterThanOrEqual(after.objectives[0].target);

  const claim = await owner.mutation(api.guildObjectives.claimObjectiveReward, {
    playerId: ownerId,
    objectiveId: "slay_monsters",
  });
  expect(claim.rewardGold).toBeGreaterThan(0);
});

async function seedRaidCaster(
  owner: Awaited<ReturnType<typeof setup>>["owner"],
  playerId: Id<"players">
) {
  await owner.run(async (ctx) => {
    const now = Date.now();
    const staff = await ctx.db.insert("items", {
      itemId: "raid-test-staff",
      name: "Raid Staff",
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
      playerId,
      itemId: staff,
      quantity: 1,
      equippedSlot: "mainHand",
      acquiredAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("abilities", {
      abilityId: "raid_bolt",
      name: "Raid Bolt",
      description: "d",
      type: "attack",
      target: "enemy",
      weaponType: "staff",
      basePower: 15,
      powerScalingPerLevel: 0,
      cooldownMs: 1_000,
      tier: 1,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerAbilities", {
      playerId,
      abilityId: "raid_bolt",
      level: 1,
      experience: 0,
      totalExperience: 0,
      learnedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerEquippedAbilities", {
      playerId,
      slot: 0,
      abilityId: "raid_bolt",
      equippedAt: now,
    });
  });
}

test("raid rounds auto-cast equipped abilities and persist their cooldowns", async () => {
  const t = await setup();
  await seedRaidCaster(t.owner, t.ownerId);
  const begun = await summonBegin(t, "owner", 1);

  const before = await t.owner.run((ctx) => ctx.db.get(begun._id));
  const ownerBefore = before?.participants.find(
    (member) => member.playerId === t.ownerId
  );
  expect(ownerBefore?.abilityState?.runtimes).toHaveLength(1);
  expect(ownerBefore?.abilityState?.runtimes[0].casts).toBe(0);

  await tick(t, "owner", begun._id, 5);

  const after = await t.owner.run((ctx) => ctx.db.get(begun._id));
  const ownerAfter = after?.participants.find(
    (member) => member.playerId === t.ownerId
  );
  expect(ownerAfter?.abilityState?.runtimes[0].casts).toBeGreaterThan(0);
  expect(ownerAfter?.abilityState?.runtimes[0].nextAt).toBeGreaterThan(0);
});

test("raid settlement records a player-prefixed fight history row", async () => {
  const t = await setup();
  const raid = await summonBegin(t, "owner", 1);
  await tickUntilDone(t, raid._id);

  const rows = await t.owner.run((ctx) =>
    ctx.db.query("fightHistory").collect()
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.isBoss).toBe(true);
    // Every settlement key belongs to the player it settles for.
    expect(row.settlementKey?.startsWith(`${row.playerId}:`)).toBe(true);
    expect(row.settlementKey).toContain(":raid:");
  }
});
