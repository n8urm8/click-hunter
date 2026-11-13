/// <reference types="vite/client" />
import { testIdentity, ownerFor } from "./testIdentity";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";
import { insertPlayerWithRecords } from "./testPlayers";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const START = 1_000_000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function insertCharacter(
  ctx: MutationCtx,
  authSubject: string,
  name: string,
  role?: "admin" | "player"
) {
  return insertPlayerWithRecords(ctx, {
    anonymousId: `anon-${authSubject}`,
    name,
    authSubject: ownerFor(authSubject),
    ...(role ? { role } : {}),
    str: 12, dex: 12, int: 12, luk: 12, con: 12,
    gold: 0, totalExperience: 0,
    rebirthCount: 0, rebirthTierThreshold: 5, currentTier: 1, maxTierReached: 1,
    autoAttackEnabled: true, autoStartFightEnabled: false,
    createdAt: START, lastUpdated: START,
  });
}

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const ids = await base.run(async (ctx) => ({
    adminId: await insertCharacter(ctx, "admin-user", "Warden", "admin"),
    targetId: await insertCharacter(ctx, "target-user", "Troll"),
    reporterId: await insertCharacter(ctx, "reporter-user", "Tattler"),
    otherAdminId: await insertCharacter(ctx, "other-admin", "Overseer", "admin"),
  }));
  return {
    base,
    ...ids,
    admin: base.withIdentity(testIdentity("admin-user")),
    target: base.withIdentity(testIdentity("target-user")),
    reporter: base.withIdentity(testIdentity("reporter-user")),
  };
}

const say = (
  speaker: { mutation: (...args: any[]) => Promise<any> },
  playerId: Id<"players">,
  content: string
) => speaker.mutation(api.chat.sendMessage, { playerId, channelType: "world", content });

test("a mute stops chat until it lapses but leaves the game open", async () => {
  const { admin, adminId, target, targetId } = await setup();

  await admin.mutation(api.moderation.applyModeration, {
    playerId: adminId,
    targetPlayerId: targetId,
    action: { kind: "mute", minutes: 30 },
    reason: "Spam in world chat",
  });

  await expect(say(target, targetId, "hello")).rejects.toThrow(
    /muted until .*Reason: Spam in world chat/
  );
  await expect(target.query(api.players.getCurrentPlayer, {})).resolves.toMatchObject({
    _id: targetId,
  });

  vi.setSystemTime(START + 31 * MINUTE);
  await expect(say(target, targetId, "hello")).resolves.toMatchObject({ content: "hello" });
});

test("a ban locks every character call until it is lifted", async () => {
  const { admin, adminId, target, targetId } = await setup();

  await admin.mutation(api.moderation.applyModeration, {
    playerId: adminId,
    targetPlayerId: targetId,
    action: { kind: "ban", days: 7 },
    reason: "Harassment",
  });

  await expect(target.query(api.players.getCurrentPlayer, {})).rejects.toThrow(
    /suspended until .*Reason: Harassment/
  );
  await expect(say(target, targetId, "hello")).rejects.toThrow(/suspended/);
  // The status query stays open, so the client can explain the suspension.
  expect(await target.query(api.accounts.getAccountStatus, {})).toMatchObject({
    bannedUntil: START + 7 * DAY,
    banReason: "Harassment",
  });
  expect(await admin.query(api.moderation.getPlayerModeration, {
    playerId: adminId,
    targetPlayerId: targetId,
  })).toMatchObject({ bannedUntil: START + 7 * DAY, banReason: "Harassment" });

  await admin.mutation(api.moderation.liftModeration, {
    playerId: adminId,
    targetPlayerId: targetId,
    kind: "ban",
  });
  await expect(target.query(api.players.getCurrentPlayer, {})).resolves.toMatchObject({
    _id: targetId,
  });
});

test("a lapsed ban is cleared by the expiry job; a permanent ban is not", async () => {
  const { base, admin, adminId, target, targetId, reporterId, reporter } = await setup();

  await admin.mutation(api.moderation.applyModeration, {
    playerId: adminId,
    targetPlayerId: targetId,
    action: { kind: "ban", days: 1 },
    reason: "Cheating",
  });
  vi.setSystemTime(START + DAY + MINUTE);
  // Bans are checked without the clock, so the lapsed ban holds until the job runs.
  await expect(target.query(api.players.getCurrentPlayer, {})).rejects.toThrow(/suspended/);
  await base.mutation(internal.moderation.expireBans, {});
  await expect(target.query(api.players.getCurrentPlayer, {})).resolves.toMatchObject({
    _id: targetId,
  });

  await admin.mutation(api.moderation.applyModeration, {
    playerId: adminId,
    targetPlayerId: reporterId,
    action: { kind: "ban" },
    reason: "Account for sale",
  });
  vi.setSystemTime(START + 1000 * DAY);
  await base.mutation(internal.moderation.expireBans, {});
  await expect(reporter.query(api.players.getCurrentPlayer, {})).rejects.toThrow(
    /permanently.*Account for sale/
  );
});

test("only admins moderate, never admins or themselves, and inputs are bounded", async () => {
  const { admin, adminId, otherAdminId, reporter, reporterId, targetId } = await setup();
  const apply = (
    caller: typeof admin,
    playerId: Id<"players">,
    targetPlayerId: Id<"players">,
    action: { kind: "mute"; minutes: number } | { kind: "ban"; days?: number },
    reason = "Reason"
  ) => caller.mutation(api.moderation.applyModeration, { playerId, targetPlayerId, action, reason });

  await expect(apply(reporter, reporterId, targetId, { kind: "mute", minutes: 5 })).rejects.toThrow(
    /admin role required/
  );
  await expect(apply(admin, adminId, adminId, { kind: "mute", minutes: 5 })).rejects.toThrow(
    /your own character/
  );
  await expect(apply(admin, adminId, otherAdminId, { kind: "ban", days: 1 })).rejects.toThrow(
    /Admin characters cannot/
  );
  await expect(apply(admin, adminId, targetId, { kind: "mute", minutes: 0 })).rejects.toThrow(
    /whole number from 1 to 43200/
  );
  await expect(apply(admin, adminId, targetId, { kind: "ban", days: 4000 })).rejects.toThrow(
    /whole number from 1 to 3650/
  );
  await expect(apply(admin, adminId, targetId, { kind: "mute", minutes: 5 }, "   ")).rejects.toThrow(
    /Add a reason/
  );
  await expect(
    admin.mutation(api.moderation.liftModeration, {
      playerId: adminId,
      targetPlayerId: targetId,
      kind: "mute",
    })
  ).rejects.toThrow(/not currently muted/);
});

test("an actioned report applies its sanction once and is logged against the report", async () => {
  const { admin, adminId, reporter, reporterId, target, targetId } = await setup();
  const message = await say(target, targetId, "buy gold cheap");
  const { reportId } = await reporter.mutation(api.chat.reportMessage, {
    playerId: reporterId,
    messageId: message!._id,
    reason: "spam",
  });

  await expect(
    admin.mutation(api.chat.resolveReport, {
      playerId: adminId,
      reportId,
      status: "dismissed",
      action: { kind: "mute", minutes: 5 },
    })
  ).rejects.toThrow(/Mark the report actioned/);

  await admin.mutation(api.chat.resolveReport, {
    playerId: adminId,
    reportId,
    status: "actioned",
    action: { kind: "mute", minutes: 60 },
  });
  await expect(say(target, targetId, "still here")).rejects.toThrow(/muted/);

  await expect(
    admin.mutation(api.chat.resolveReport, {
      playerId: adminId,
      reportId,
      status: "actioned",
      action: { kind: "ban", days: 1 },
    })
  ).rejects.toThrow(/already resolved/);

  const log = await admin.query(api.moderation.listModerationLog, {
    playerId: adminId,
    targetPlayerId: targetId,
  });
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({
    action: "mute",
    reason: "Reported for Spam",
    reportId,
    actorName: "Warden",
    targetName: "Troll",
  });
});

test("a report closed without an action changes nothing on the account", async () => {
  const { admin, adminId, reporter, reporterId, target, targetId } = await setup();
  const message = await say(target, targetId, "fine message");
  const { reportId } = await reporter.mutation(api.chat.reportMessage, {
    playerId: reporterId,
    messageId: message!._id,
    reason: "other",
  });

  await admin.mutation(api.chat.resolveReport, {
    playerId: adminId,
    reportId,
    status: "dismissed",
  });
  await expect(say(target, targetId, "still fine")).resolves.toMatchObject({
    content: "still fine",
  });
  expect(await admin.query(api.moderation.listModerationLog, { playerId: adminId })).toEqual([]);
});
