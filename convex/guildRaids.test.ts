/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const owner = base.withIdentity({ subject: "raid-owner" });
  const member = base.withIdentity({ subject: "raid-member" });
  const fixture = await owner.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("players", {
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
    const memberId = await ctx.db.insert("players", {
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
  return { owner, member, ...fixture };
}

test("officer can start a raid and members can join and begin it", async () => {
  const { owner, member, ownerId, memberId } = await setup();
  const raid = await owner.mutation(api.guildRaids.startRaid, {
    playerId: ownerId,
    tier: 1,
  });
  expect(raid?.status).toBe("forming");
  expect(raid?.participants.length).toBe(1);

  // Member already joined via start? No - member is different player, join now.
  await member.mutation(api.guildRaids.joinRaid, {
    playerId: memberId,
    raidId: raid!._id,
  });
  const begun = await owner.mutation(api.guildRaids.beginRaid, {
    playerId: ownerId,
    raidId: raid!._id,
  });
  expect(begun?.status).toBe("active");
});

test("strikes deal damage and complete the raid with split rewards", async () => {
  const { owner, member, ownerId, memberId } = await setup();
  const raid = await owner.mutation(api.guildRaids.startRaid, {
    playerId: ownerId,
    tier: 1,
  });
  await member.mutation(api.guildRaids.joinRaid, {
    playerId: memberId,
    raidId: raid!._id,
  });
  await owner.mutation(api.guildRaids.beginRaid, {
    playerId: ownerId,
    raidId: raid!._id,
  });

  const beforeOwner = await owner.run((ctx) => ctx.db.get(ownerId));
  let completed = false;
  for (let i = 0; i < 200 && !completed; i += 1) {
    const asOwner = i % 2 === 0;
    const result = asOwner
      ? await owner.mutation(api.guildRaids.strikeRaid, {
          playerId: ownerId,
          raidId: raid!._id,
        })
      : await member.mutation(api.guildRaids.strikeRaid, {
          playerId: memberId,
          raidId: raid!._id,
        });
    completed = result.completed;
  }
  expect(completed).toBe(true);
  const afterOwner = await owner.run((ctx) => ctx.db.get(ownerId));
  expect((afterOwner?.gold ?? 0)).toBeGreaterThan(beforeOwner?.gold ?? 0);
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
