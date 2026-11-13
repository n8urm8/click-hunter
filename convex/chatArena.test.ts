/// <reference types="vite/client" />
import { testIdentity, ownerFor } from "./testIdentity";
import { insertPlayerWithRecords } from "./testPlayers";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const makePlayer = (subject: string, name: string) =>
    base.run((ctx) =>
      insertPlayerWithRecords(ctx, {
        anonymousId: `chat-${subject}`,
        name,
        authSubject: ownerFor(subject),
        role: "admin",
        str: 12, dex: 12, int: 12, luk: 12, con: 12,
        gold: 0, totalExperience: 0, rebirthCount: 0,
        rebirthTierThreshold: 5, currentTier: 1, maxTierReached: 1,
        autoAttackEnabled: true, autoStartFightEnabled: false,
        createdAt: 0, lastUpdated: 0,
      })
    );
  const [fighter1, spectator, outsider] = await Promise.all([
    makePlayer("chat-one", "ChatterOne"),
    makePlayer("chat-two", "ChatterTwo"),
    makePlayer("chat-three", "Outsider"),
  ]);
  const t = base.withIdentity(testIdentity("chat-one"));
  const t2 = base.withIdentity(testIdentity("chat-two"));
  const t3 = base.withIdentity(testIdentity("chat-three"));
  const makeLobby = (visibility: "general" | "private") =>
    base.run(async (ctx) => {
      const lobbyId = await ctx.db.insert("arenaLobbies", {
        visibility,
        ...(visibility === "private" ? { password: "secret" } : {}),
        status: "waiting",
        creatorId: fighter1,
        fighter1Id: fighter1,
        fighter1Name: "ChatterOne",
        fighter1Stake: 0,
        fighter1Level: 60,
        fighter1Ready: false,
        settlementKey: `chat:lobby:${visibility}`,
        expiresAt: 1_000_000 + 3_600_000,
        createdAt: 1_000_000,
        updatedAt: 1_000_000,
      });
      await ctx.db.insert("arenaSpectators", {
        lobbyId,
        playerId: spectator,
        playerName: "ChatterTwo",
        joinedAt: 1_000_000,
      });
      return lobbyId;
    });
  return { base, t, t2, t3, fighter1, spectator, outsider, makeLobby };
}

test("global arena chat is open to every player", async () => {
  const { t3, outsider } = await setup();
  const sent = await t3.mutation(api.chat.sendMessage, {
    playerId: outsider,
    channelType: "arena",
    content: "Anyone up for a duel?",
  });
  expect(sent?.content).toBe("Anyone up for a duel?");
  const messages = await t3.query(api.chat.listMessages, {
    playerId: outsider,
    channelType: "arena",
  });
  expect(messages.map((m) => m.content)).toContain("Anyone up for a duel?");
});

test("lobby chat admits fighters and spectators, nobody else", async () => {
  const { t, t2, t3, fighter1, spectator, outsider, makeLobby } = await setup();
  const lobbyId: Id<"arenaLobbies"> = await makeLobby("general");

  const fighterSent = await t.mutation(api.chat.sendMessage, {
    playerId: fighter1,
    channelType: "arena",
    lobbyId,
    content: "Gladiators ready?",
  });
  expect(fighterSent?.content).toBe("Gladiators ready?");
  await t2.mutation(api.chat.sendMessage, {
    playerId: spectator,
    channelType: "arena",
    lobbyId,
    content: "Watching from the stands.",
  });
  const seen = await t2.query(api.chat.listMessages, {
    playerId: spectator,
    channelType: "arena",
    lobbyId,
  });
  expect(seen).toHaveLength(2);

  await expect(
    t3.mutation(api.chat.sendMessage, {
      playerId: outsider,
      channelType: "arena",
      lobbyId,
      content: "Let me in!",
    })
  ).rejects.toThrow("Only lobby fighters and spectators");
  await expect(
    t3.query(api.chat.listMessages, {
      playerId: outsider,
      channelType: "arena",
      lobbyId,
    })
  ).rejects.toThrow("Only lobby fighters and spectators");
});

test("private lobbies never leak through lobby chat", async () => {
  const { t, t3, fighter1, outsider, makeLobby } = await setup();
  const lobbyId: Id<"arenaLobbies"> = await makeLobby("private");
  await t.mutation(api.chat.sendMessage, {
    playerId: fighter1,
    channelType: "arena",
    lobbyId,
    content: "Secret plans.",
  });
  await expect(
    t3.query(api.chat.listMessages, {
      playerId: outsider,
      channelType: "arena",
      lobbyId,
    })
  ).rejects.toThrow("Only lobby fighters and spectators");
  // And the global arena channel carries none of it.
  const global = await t3.query(api.chat.listMessages, {
    playerId: outsider,
    channelType: "arena",
  });
  expect(global.map((m) => m.content)).not.toContain("Secret plans.");
});
