/// <reference types="vite/client" />
import { testIdentity, ownerFor } from "./testIdentity";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";
import { insertPlayerWithRecords } from "./testPlayers";
import { MAX_BLOCKED_PLAYERS } from "./playerBlocks";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const START = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function insertCharacter(ctx: MutationCtx, authSubject: string, name: string) {
  return insertPlayerWithRecords(ctx, {
    anonymousId: `anon-${authSubject}`,
    name,
    authSubject: ownerFor(authSubject),
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
    viewerId: await insertCharacter(ctx, "viewer-user", "Viewer"),
    pestId: await insertCharacter(ctx, "pest-user", "Pest"),
    friendId: await insertCharacter(ctx, "friend-user", "Friend"),
  }));
  return {
    base,
    ...ids,
    viewer: base.withIdentity(testIdentity("viewer-user")),
    pest: base.withIdentity(testIdentity("pest-user")),
    friend: base.withIdentity(testIdentity("friend-user")),
  };
}

const worldChat = (
  caller: { mutation: (...args: any[]) => Promise<any> },
  playerId: Id<"players">,
  content: string
) => caller.mutation(api.chat.sendMessage, { playerId, channelType: "world", content });

const whisper = (
  caller: { mutation: (...args: any[]) => Promise<any> },
  playerId: Id<"players">,
  recipientId: Id<"players">,
  content: string
) => caller.mutation(api.chat.sendMessage, { playerId, channelType: "private", recipientId, content });

const contentsSeenBy = async (
  caller: { query: (...args: any[]) => Promise<any> },
  playerId: Id<"players">
) => {
  const rows: Array<{ content: string }> = await caller.query(api.chat.listMessages, {
    playerId,
    channelType: "world",
  });
  return rows.map((row) => row.content);
};

test("a blocked player's messages disappear for the blocker only", async () => {
  const { viewer, viewerId, pest, pestId, friend, friendId } = await setup();
  await worldChat(pest, pestId, "buy gold");
  await worldChat(friend, friendId, "hello all");

  await viewer.mutation(api.playerBlocks.blockPlayer, {
    playerId: viewerId,
    targetPlayerId: pestId,
  });

  expect(await contentsSeenBy(viewer, viewerId)).toEqual(["hello all"]);
  expect(await contentsSeenBy(friend, friendId)).toEqual(["buy gold", "hello all"]);
});

test("a flood from a blocked player does not empty the view", async () => {
  const { base, viewer, viewerId, pestId, friendId } = await setup();
  await base.run(async (ctx) => {
    for (let index = 0; index < 40; index += 1) {
      await ctx.db.insert("chatMessages", {
        channelType: "world", channelId: "world", senderId: friendId,
        senderName: "Friend", content: `friend ${index}`, createdAt: START + index,
      });
    }
    for (let index = 0; index < 60; index += 1) {
      await ctx.db.insert("chatMessages", {
        channelType: "world", channelId: "world", senderId: pestId,
        senderName: "Pest", content: `pest ${index}`, createdAt: START + 100 + index,
      });
    }
  });
  await viewer.mutation(api.playerBlocks.blockPlayer, {
    playerId: viewerId,
    targetPlayerId: pestId,
  });

  const seen = await contentsSeenBy(viewer, viewerId);
  expect(seen).toHaveLength(40);
  expect(seen.every((content) => content.startsWith("friend"))).toBe(true);
});

test("private chats: blocked pairs cannot message and drop out of the list", async () => {
  const { viewer, viewerId, pest, pestId, friend, friendId } = await setup();
  await whisper(pest, pestId, viewerId, "psst");
  await whisper(friend, friendId, viewerId, "hi there");

  const chatsBefore = await viewer.query(api.chat.listPrivateChats, { playerId: viewerId });
  expect(chatsBefore.map((chat) => chat.playerName).sort()).toEqual(["Friend", "Pest"]);

  await viewer.mutation(api.playerBlocks.blockPlayer, {
    playerId: viewerId,
    targetPlayerId: pestId,
  });

  const chatsAfter = await viewer.query(api.chat.listPrivateChats, { playerId: viewerId });
  expect(chatsAfter.map((chat) => chat.playerName)).toEqual(["Friend"]);
  await expect(whisper(viewer, viewerId, pestId, "hey")).rejects.toThrow(
    /You have blocked this player/
  );
  await expect(whisper(pest, pestId, viewerId, "still there?")).rejects.toThrow(
    /not accepting messages/
  );
  // Blocking one player does not touch anyone else's conversation.
  await expect(whisper(friend, friendId, viewerId, "ok")).resolves.toMatchObject({
    content: "ok",
  });

  await viewer.mutation(api.playerBlocks.unblockPlayer, {
    playerId: viewerId,
    targetPlayerId: pestId,
  });
  await expect(whisper(viewer, viewerId, pestId, "back again")).resolves.toMatchObject({
    content: "back again",
  });
  expect(await viewer.query(api.chat.listPrivateChats, { playerId: viewerId })).toHaveLength(2);
});

test("the block list shows names newest first, ignores repeats, and refuses self", async () => {
  const { viewer, viewerId, pestId, friendId } = await setup();
  await viewer.mutation(api.playerBlocks.blockPlayer, { playerId: viewerId, targetPlayerId: friendId });
  vi.setSystemTime(START + 5_000);
  await viewer.mutation(api.playerBlocks.blockPlayer, { playerId: viewerId, targetPlayerId: pestId });
  // A repeat is a no-op and keeps the original time.
  await viewer.mutation(api.playerBlocks.blockPlayer, { playerId: viewerId, targetPlayerId: pestId });

  expect(await viewer.query(api.playerBlocks.listBlockedPlayers, { playerId: viewerId })).toEqual([
    { playerId: pestId, name: "Pest", blockedAt: START + 5_000 },
    { playerId: friendId, name: "Friend", blockedAt: START },
  ]);
  await expect(
    viewer.mutation(api.playerBlocks.blockPlayer, { playerId: viewerId, targetPlayerId: viewerId })
  ).rejects.toThrow(/own character/);
});

test("the block list is capped and only its owner can change it", async () => {
  const { base, viewer, viewerId, pestId } = await setup();
  await base.run(async (ctx) => {
    for (let index = 0; index < MAX_BLOCKED_PLAYERS; index += 1) {
      const blockedId = await insertCharacter(ctx, `filler-${index}`, `Filler ${index}`);
      await ctx.db.insert("playerBlocks", {
        blockerId: viewerId,
        blockedId,
        blockedName: `Filler ${index}`,
        createdAt: START,
      });
    }
  });

  await expect(
    viewer.mutation(api.playerBlocks.blockPlayer, { playerId: viewerId, targetPlayerId: pestId })
  ).rejects.toThrow(/block list is full/);

  // Another account cannot block or unblock on this character's behalf.
  const stranger = base.withIdentity(testIdentity("stranger-user"));
  await expect(
    stranger.mutation(api.playerBlocks.unblockPlayer, { playerId: viewerId, targetPlayerId: pestId })
  ).rejects.toThrow(/belongs to a different signed-in session/);
});
