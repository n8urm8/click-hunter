/// <reference types="vite/client" />
import { insertPlayerWithRecords } from "./testPlayers";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function setup(enabled = true) {
  const t = convexTest(schema, modules);
  if (enabled) {
    await t.run((ctx) =>
      ctx.db.insert("gameBalance", {
        key: "simLiveEnabled",
        value: true,
        description: "test",
        lastUpdated: 0,
      })
    );
  }
  return { t };
}

test("live harness refuses to run while disabled", async () => {
  const { t } = await setup(false);
  await expect(
    t.mutation(internal.simLive.spawnPlayers, { count: 1 })
  ).rejects.toThrow(/disabled/);
});

test("live spawn/apply/accept/status/cleanup round trip", async () => {
  const { t } = await setup();

  const guild = await t.mutation(internal.simLive.spawnGuild, {
    name: "Live Legion",
    tag: "LIVE",
  });
  expect(guild?.name).toBe("Live Legion");
  if (!guild) throw new Error("Missing guild");

  const players = await t.mutation(internal.simLive.spawnPlayers, {
    count: 4,
    namePrefix: "LiveApplicant",
    levelRange: { min: 40, max: 90 },
    seed: 9,
  });
  expect(players).toHaveLength(4);
  expect(
    players.every((p) => p.characterLevel >= 40 && p.characterLevel <= 91)
  ).toBe(true);

  const applications = await t.mutation(internal.simLive.applyAll, {
    guildId: guild._id,
  });
  expect(applications).toHaveLength(4);
  const succeeded = applications.filter((r) => r.ok);
  expect(succeeded.length).toBeGreaterThan(0);

  const ownerMembership = await t.run((ctx) =>
    ctx.db
      .query("guildMembers")
      .withIndex("by_guildId", (q) => q.eq("guildId", guild._id))
      .first()
  );
  if (!ownerMembership) throw new Error("Missing owner membership");
  const acceptances = await t.mutation(internal.simLive.acceptAll, {
    guildId: guild._id,
    officerPlayerId: ownerMembership.playerId,
  });
  expect(acceptances.every((r) => r.ok)).toBe(true);

  const before = await t.query(internal.simLive.status, {});
  expect(before.simPlayerCount).toBe(5);
  expect(before.guilds).toHaveLength(1);
  expect(before.guilds[0].memberCount).toBe(1 + succeeded.length);

  // Direct edits refuse real players but allow sim players.
  const realId = await t.run((ctx) =>
    insertPlayerWithRecords(ctx, {
      anonymousId: "real-player",
      name: "Real",
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
      createdAt: 0,
      lastUpdated: 0,
    })
  );
  await expect(
    t.mutation(internal.simLive.setGold, { playerId: realId, gold: 999 })
  ).rejects.toThrow(/non-simulated/);

  const cleaned = await t.mutation(internal.simLive.cleanup, {});
  expect(cleaned.removedPlayers).toBe(5);
  expect(cleaned.removedGuilds).toBe(1);

  const after = await t.query(internal.simLive.status, {});
  expect(after.simPlayerCount).toBe(0);
  expect(after.guilds).toHaveLength(0);
  // The real player survives cleanup.
  expect(await t.run((ctx) => ctx.db.get(realId))).not.toBeNull();
});
