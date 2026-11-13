/// <reference types="vite/client" />
import { testIdentity, ownerFor } from "./testIdentity";
import { insertPlayerWithRecords, playerWithRecords } from "./testPlayers";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { accrueGuildXpFromEarned } from "./guilds";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity(testIdentity("guild-owner"));
  const other = base.withIdentity(testIdentity("guild-member"));
  const fixture = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await insertPlayerWithRecords(ctx, {
      anonymousId: "guild-owner-anon",
      name: "Owner",
      authSubject: ownerFor("guild-owner"),
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
      anonymousId: "guild-member-anon",
      name: "Member",
      authSubject: ownerFor("guild-member"),
      str: 10,
      dex: 10,
      int: 10,
      luk: 10,
      con: 10,
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
    await ctx.db.insert("guildBonuses", {
      level: 1,
      goldBonusPercent: 0,
      xpBonusPercent: 0,
      statBonusPercent: 0,
      maxMembers: 10,
      raidSlots: 1,
      createdAt: now,
    });
    return { ownerId, memberId };
  });
  return { t, other, ...fixture };
}

test("createGuild deducts gold and makes the creator master", async () => {
  const { t, ownerId } = await setup();
  const guild = await t.mutation(api.guilds.createGuild, {
    playerId: ownerId,
    name: "Dragon Slayers",
    tag: "DS",
    description: "We hunt dragons",
  });
  expect(guild?.name).toBe("Dragon Slayers");
  expect(guild?.tag).toBe("DS");

  const mine = await t.query(api.guilds.getMyGuild, { playerId: ownerId });
  expect(mine?.membership.role).toBe("master");
  expect(mine?.memberCount).toBe(1);

  const player = await t.run((ctx) => playerWithRecords(ctx, ownerId));
  expect(player?.gold).toBe(50000);
});

test("createGuild rejects duplicate names and players already in a guild", async () => {
  const { t, other, ownerId, memberId } = await setup();
  await t.mutation(api.guilds.createGuild, {
    playerId: ownerId,
    name: "Dragon Slayers",
    tag: "DS",
    description: "",
  });
  await expect(
    other.mutation(api.guilds.createGuild, {
      playerId: memberId,
      name: "Dragon Slayers",
      tag: "OTHER",
      description: "",
    })
  ).rejects.toThrow(/already exists/);
  await expect(
    t.mutation(api.guilds.createGuild, {
      playerId: ownerId,
      name: "Second Guild",
      tag: "SG",
      description: "",
    })
  ).rejects.toThrow(/already in a guild/);
});

test("invite and accept flow joins a guild as recruit", async () => {
  const { t, other, ownerId, memberId } = await setup();
  await t.mutation(api.guilds.createGuild, {
    playerId: ownerId,
    name: "Dragon Slayers",
    tag: "DS",
    description: "",
  });
  const invite = await t.mutation(api.guilds.invitePlayer, {
    playerId: ownerId,
    targetPlayerId: memberId,
  });
  if (!invite) throw new Error("Missing invite");

  const pending = await other.query(api.guilds.getPendingApplications, {
    playerId: memberId,
  });
  expect(pending.length).toBe(1);

  await other.mutation(api.guilds.acceptInvite, {
    playerId: memberId,
    applicationId: invite._id,
  });
  const mine = await other.query(api.guilds.getMyGuild, { playerId: memberId });
  expect(mine?.membership.role).toBe("recruit");
});

test("officer-gated kick and master-only promote work", async () => {
  const { t, other, ownerId, memberId } = await setup();
  await t.mutation(api.guilds.createGuild, {
    playerId: ownerId,
    name: "Dragon Slayers",
    tag: "DS",
    description: "",
  });
  const invite = await t.mutation(api.guilds.invitePlayer, {
    playerId: ownerId,
    targetPlayerId: memberId,
  });
  if (!invite) throw new Error("Missing invite");
  await other.mutation(api.guilds.acceptInvite, {
    playerId: memberId,
    applicationId: invite._id,
  });

  // Recruit cannot kick.
  await expect(
    other.mutation(api.guilds.kickMember, {
      playerId: memberId,
      targetPlayerId: ownerId,
    })
  ).rejects.toThrow(/Requires officer/);

  await t.mutation(api.guilds.promoteMember, {
    playerId: ownerId,
    targetPlayerId: memberId,
  });
  const promoted = await other.query(api.guilds.getMyGuild, {
    playerId: memberId,
  });
  expect(promoted?.membership.role).toBe("member");
});

test("deposit and withdraw move gold between player and bank", async () => {
  const { t, ownerId } = await setup();
  await t.mutation(api.guilds.createGuild, {
    playerId: ownerId,
    name: "Dragon Slayers",
    tag: "DS",
    description: "",
  });
  await t.mutation(api.guilds.depositGold, { playerId: ownerId, amount: 1000 });
  const afterDeposit = await t.query(api.guilds.getMyGuild, {
    playerId: ownerId,
  });
  expect(afterDeposit?.guild.gold).toBe(1000);

  await t.mutation(api.guilds.withdrawGold, { playerId: ownerId, amount: 400 });
  const afterWithdraw = await t.query(api.guilds.getMyGuild, {
    playerId: ownerId,
  });
  expect(afterWithdraw?.guild.gold).toBe(600);
});

test("guild chat requires membership", async () => {
  const { t, other, ownerId, memberId } = await setup();
  await t.mutation(api.guilds.createGuild, {
    playerId: ownerId,
    name: "Dragon Slayers",
    tag: "DS",
    description: "",
  });
  await expect(
    other.query(api.chat.listMessages, { playerId: memberId, channelType: "guild" })
  ).rejects.toThrow(/not in a guild/);

  const sent = await t.mutation(api.chat.sendMessage, {
    playerId: ownerId,
    channelType: "guild",
    content: "Hello guild",
  });
  expect(sent?.content).toBe("Hello guild");
  const messages = await t.query(api.chat.listMessages, {
    playerId: ownerId,
    channelType: "guild",
  });
  expect(messages.length).toBe(1);
});

test("createGuild rejects founders below the level requirement", async () => {
  const { other, memberId } = await setup();
  // Member is level 50, below the level-100 creation gate.
  await expect(
    other.mutation(api.guilds.createGuild, {
      playerId: memberId,
      name: "Lowbie Guild",
      tag: "LG",
      description: "",
    })
  ).rejects.toThrow(/character level 100/);
});

test("applyToGuild rejects applicants below the level requirement", async () => {
  const { t, ownerId } = await setup();
  const guild = await t.mutation(api.guilds.createGuild, {
    playerId: ownerId,
    name: "Dragon Slayers",
    tag: "DS",
    description: "",
  });
  if (!guild) throw new Error("Missing guild");
  const rookie = t.withIdentity(testIdentity("guild-rookie"));
  const rookieId = await t.run(async (ctx) => {
    const now = Date.now();
    return await insertPlayerWithRecords(ctx, {
      anonymousId: "guild-rookie-anon",
      name: "Rookie",
      authSubject: ownerFor("guild-rookie"),
      str: 1,
      dex: 1,
      int: 1,
      luk: 1,
      con: 1,
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
  });
  await expect(
    rookie.mutation(api.guilds.applyToGuild, {
      playerId: rookieId,
      guildId: guild._id,
    })
  ).rejects.toThrow(/character level 50/);
});

test("guild XP accrues as a bonus without touching player totals", async () => {
  const { t, ownerId } = await setup();
  const guild = await t.mutation(api.guilds.createGuild, {
    playerId: ownerId,
    name: "Dragon Slayers",
    tag: "DS",
    description: "",
  });
  if (!guild) throw new Error("Missing guild");
  await t.run((ctx) =>
    ctx.db.insert("gameBalance", {
      key: "guildActivityXpPercent",
      value: 100,
      description: "test",
      lastUpdated: 0,
    })
  );
  const beforePlayer = await t.run((ctx) => playerWithRecords(ctx, ownerId));
  await t.run((ctx) => accrueGuildXpFromEarned(ctx, ownerId, 500));

  const afterPlayer = await t.run((ctx) => playerWithRecords(ctx, ownerId));
  expect(afterPlayer?.totalExperience).toBe(beforePlayer?.totalExperience);
  expect(afterPlayer?.gold).toBe(beforePlayer?.gold);

  const afterGuild = await t.run((ctx) => ctx.db.get(guild._id));
  expect(afterGuild?.xp).toBe((guild.xp ?? 0) + 500);
  const membership = await t.run((ctx) =>
    ctx.db
      .query("guildMembers")
      .withIndex("by_playerId", (q) => q.eq("playerId", ownerId))
      .first()
  );
  expect(membership?.contributionXp).toBe(500);
});

test("retuneGuildActivityXp only replaces the previous 10% default", async () => {  const { t } = await setup();

  // Missing key is created at 1%.
  expect(await t.mutation(internal.migrations.retuneGuildActivityXp, {})).toEqual(
    { created: true, updated: false }
  );

  // Untouched 10% default is retuned to 1%.
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "guildActivityXpPercent"))
      .first();
    if (!row) throw new Error("Missing balance row");
    await ctx.db.patch(row._id, { value: 10 });
  });
  expect(await t.mutation(internal.migrations.retuneGuildActivityXp, {})).toEqual(
    { created: false, updated: true }
  );
  const retuned = await t.run((ctx) =>
    ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "guildActivityXpPercent"))
      .first()
  );
  expect(retuned?.value).toBe(1);

  // Admin-customized values are left alone.
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "guildActivityXpPercent"))
      .first();
    if (!row) throw new Error("Missing balance row");
    await ctx.db.patch(row._id, { value: 5 });
  });
  expect(await t.mutation(internal.migrations.retuneGuildActivityXp, {})).toEqual(
    { created: false, updated: false }
  );
});

test("gathering XP applies the guild bonus and accrues bonus guild XP", async () => {
  const { t, ownerId } = await setup();
  const guild = await t.mutation(api.guilds.createGuild, {
    playerId: ownerId,
    name: "Dragon Slayers",
    tag: "DS",
    description: "",
  });
  if (!guild) throw new Error("Missing guild");

  // 50% guild XP bonus; default 1% passive accrual (no balance row seeded).
  await t.run(async (ctx) => {
    const bonus = await ctx.db
      .query("guildBonuses")
      .withIndex("by_level", (q) => q.eq("level", 1))
      .first();
    if (!bonus) throw new Error("Missing guild bonus row");
    await ctx.db.patch(bonus._id, { xpBonusPercent: 50 });

    const now = Date.now();
    await ctx.db.insert("skillDefinitions", {
      skillId: "harvesting",
      name: "Harvesting",
      category: "gathering",
      description: "Gather herbs",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("skillTierDefinitions", {
      skillId: "harvesting",
      tier: 1,
      name: "Tier 1",
      description: "Apprentice",
      requiredLevel: 1,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const herb = await ctx.db.insert("items", {
      itemId: "sim-test-herb",
      name: "Sim Herb",
      category: "crafting",
      description: "A test herb",
      stackable: true,
      maxStackSize: 100,
      allowedEquipmentSlots: [],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("gatheringActivities", {
      activityId: "sim-harvest",
      skillId: "harvesting",
      tier: 1,
      name: "Sim Harvest",
      description: "Gather test herbs",
      outputItemId: herb,
      minYield: 1,
      maxYield: 1,
      experienceReward: 100,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("taskDefinitions", {
      taskId: "skill_action",
      name: "Skill action",
      category: "skill",
      description: "Skill task",
      canProgressOffline: true,
      requiresOnline: false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  await t.mutation(api.tasks.enqueueSkillAction, {
    playerId: ownerId,
    actionType: "gathering",
    actionId: "sim-harvest",
    quantity: 2,
  });

  await t.run(async (ctx) => {
    const { advanceSkillActionTask } = await import("./skills");
    const task = await ctx.db
      .query("playerTasks")
      .withIndex("by_playerId_and_status", (q) =>
        q.eq("playerId", ownerId).eq("status", "active")
      )
      .first();
    if (!task) throw new Error("No active skill task");
    await advanceSkillActionTask(ctx, task, 24 * 60 * 60 * 1000, 0, Date.now());
  });

  // 2 actions x 100 XP x 1.5 guild bonus = 300 skill XP.
  const skillRow = await t.run((ctx) =>
    ctx.db
      .query("playerSkills")
      .withIndex("by_playerId_and_skillId", (q) =>
        q.eq("playerId", ownerId).eq("skillId", "harvesting")
      )
      .first()
  );
  expect(skillRow?.totalExperience).toBe(300);

  // 1% of 300 = 3 bonus guild XP; player totals untouched (gathering grants
  // skill XP only, and the guild share is never deducted).
  const afterGuild = await t.run((ctx) => ctx.db.get(guild._id));
  expect(afterGuild?.xp).toBe(3);
  const player = await t.run((ctx) => playerWithRecords(ctx, ownerId));
  expect(player?.totalExperience).toBe(1000);
  expect(player?.gold).toBe(50000);
});
