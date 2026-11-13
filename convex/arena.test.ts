/// <reference types="vite/client" />
import { testIdentity, ownerFor } from "./testIdentity";
import { insertPlayerWithRecords, patchPlayerWithRecords, playerWithRecords } from "./testPlayers";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
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

async function setupPlayer(
  base: ReturnType<typeof convexTest>,
  subject: string,
  name: string,
  stats: { str: number; dex: number; int: number; luk: number; con: number },
  gold = 10_000
) {
  return await base.run(async (ctx) => {
    const playerId = await insertPlayerWithRecords(ctx, {
      anonymousId: `arena-${subject}`,
      name,
      authSubject: ownerFor(subject),
      role: "admin",
      str: stats.str,
      dex: stats.dex,
      int: stats.int,
      luk: stats.luk,
      con: stats.con,
      gold,
      totalExperience: 0,
      rebirthCount: 0,
      rebirthTierThreshold: 5,
      currentTier: 1,
      maxTierReached: 1,
      autoAttackEnabled: true,
      autoStartFightEnabled: false,
      createdAt: 0,
      lastUpdated: 0,
    });
    return playerId;
  });
}

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const t = base.withIdentity(testIdentity("arena-user"));
  // Level 60 fighters (combat sum; no skills seeded in tests).
  const strong = { str: 200, dex: 12, int: 12, luk: 12, con: 200 };
  const average = { str: 12, dex: 12, int: 12, luk: 12, con: 12 };
  const [fighter1, fighter2, spectator] = await Promise.all([
    setupPlayer(base, "arena-user", "FighterOne", strong),
    setupPlayer(base, "arena-user-2", "FighterTwo", average),
    setupPlayer(base, "arena-user-3", "Watcher", average),
  ]);
  const t2 = base.withIdentity(testIdentity("arena-user-2"));
  const t3 = base.withIdentity(testIdentity("arena-user-3"));
  return { base, t, t2, t3, fighter1, fighter2, spectator };
}

async function goldOf(
  base: ReturnType<typeof convexTest>,
  playerId: Id<"players">
): Promise<number> {
  const row: Awaited<ReturnType<typeof playerWithRecords>> = await base.run((ctx) => playerWithRecords(ctx, playerId)
  );
  if (!row) throw new Error("Missing test player");
  return row.gold ?? 0;
}

/** Both fighters ready up and the countdown is ticked through to active. */
async function readyUpAndStart(
  t: Awaited<ReturnType<typeof setup>>["t"],
  t2: Awaited<ReturnType<typeof setup>>["t2"],
  lobbyId: Id<"arenaLobbies">,
  fighter1: Id<"players">,
  fighter2: Id<"players">
) {
  await t.mutation(api.arena.setReady, {
    playerId: fighter1,
    lobbyId,
    ready: true,
  });
  await t2.mutation(api.arena.setReady, {
    playerId: fighter2,
    lobbyId,
    ready: true,
  });
  vi.setSystemTime(Date.now() + 60_000);
  return await t.mutation(api.arena.tickFight, {
    playerId: fighter1,
    lobbyId,
  });
}

test("fighters below the configured level cannot open or join lobbies", async () => {
  const { base, t } = await setup();
  const rookie = await setupPlayer(
    base,
    "arena-rookie",
    "Rookie",
    { str: 1, dex: 1, int: 1, luk: 1, con: 1 },
  );
  const rookieCtx = t.withIdentity(testIdentity("arena-rookie"));
  await expect(
    rookieCtx.mutation(api.arena.createLobby, {
      playerId: rookie,
      visibility: "general",
      stake: 0,
    })
  ).rejects.toThrow("character level 50");
});

test("both-readies start a countdown that a tick completes", async () => {
  const { base, t, t2, fighter1, fighter2 } = await setup();
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 100,
  });
  expect(lobby.status).toBe("waiting");
  expect(lobby.locked).toBe(false);
  expect("password" in lobby).toBe(false);
  expect(await goldOf(base, fighter1)).toBe(9_900);

  const joined = await t2.mutation(api.arena.joinLobbyAsFighter, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  expect(joined.fighter2Id).toBe(fighter2);
  // Symmetric stakes: the challenger matches the creator's 100g.
  expect(joined.fighter2Stake).toBe(100);
  expect(await goldOf(base, fighter2)).toBe(9_900);

  const ready1 = await t.mutation(api.arena.setReady, {
    playerId: fighter1,
    lobbyId: lobby._id,
    ready: true,
  });
  expect(ready1.countingDown).toBe(false);
  expect(ready1.countdownEndsAt).toBeUndefined();
  const ready2 = await t2.mutation(api.arena.setReady, {
    playerId: fighter2,
    lobbyId: lobby._id,
    ready: true,
  });
  // Still waiting: the 8s countdown runs before the fight opens.
  expect(ready2.countingDown).toBe(true);
  expect(ready2.status).toBe("waiting");
  expect(ready2.countdownEndsAt).toBe(1_000_000 + 8_000);

  // Ticking early does not start the fight.
  vi.setSystemTime(1_000_000 + 7_999);
  const early = await t.mutation(api.arena.tickFight, {
    playerId: fighter1,
    lobbyId: lobby._id,
  });
  expect(early.started).toBe(false);
  expect(early.status).toBe("waiting");

  // Once the countdown passes, any viewer's tick opens the fight.
  vi.setSystemTime(1_000_000 + 8_000);
  const started = await t.mutation(api.arena.tickFight, {
    playerId: fighter1,
    lobbyId: lobby._id,
  });
  expect(started.started).toBe(true);
  expect(started.status).toBe("active");
  expect(started.fighter1Hp).toBe(started.fighter1MaxHp);
  expect(started.fighter2Hp).toBe(started.fighter2MaxHp);
  expect(started.fighter1Snapshot?.handicap).toBe(1);
  expect(started.countdownEndsAt).toBeUndefined();
});

test("either unready cancels the countdown", async () => {
  const { t, t2, fighter1, fighter2 } = await setup();
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 0,
  });
  await t2.mutation(api.arena.joinLobbyAsFighter, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  await t.mutation(api.arena.setReady, {
    playerId: fighter1,
    lobbyId: lobby._id,
    ready: true,
  });
  await t2.mutation(api.arena.setReady, {
    playerId: fighter2,
    lobbyId: lobby._id,
    ready: true,
  });
  const undone = await t.mutation(api.arena.setReady, {
    playerId: fighter1,
    lobbyId: lobby._id,
    ready: false,
  });
  expect(undone.countingDown).toBe(false);
  expect(undone.countdownEndsAt).toBeUndefined();
  expect(undone.status).toBe("waiting");

  // Letting the old deadline pass starts nothing now.
  vi.setSystemTime(1_000_000 + 60_000);
  const ticked = await t.mutation(api.arena.tickFight, {
    playerId: fighter1,
    lobbyId: lobby._id,
  });
  expect(ticked.started).toBe(false);
  expect(ticked.status).toBe("waiting");
});

test("turn-based ticks resolve the fight and pay the pot minus tax", async () => {
  const { base, t, t2, fighter1, fighter2 } = await setup();
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 100,
  });
  await t2.mutation(api.arena.joinLobbyAsFighter, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  await readyUpAndStart(t, t2, lobby._id, fighter1, fighter2);

  // Overwhelming stat gap: fighter one ends it almost immediately.
  let state = await t.query(api.arena.getLobby, {
    playerId: fighter1,
    lobbyId: lobby._id,
  });
  for (let i = 0; i < 10 && state?.status === "active"; i += 1) {
    vi.setSystemTime(Date.now() + 60_000);
    await t.mutation(api.arena.tickFight, {
      playerId: fighter1,
      lobbyId: lobby._id,
    });
    state = await t.query(api.arena.getLobby, {
      playerId: fighter1,
      lobbyId: lobby._id,
    });
  }
  expect(state?.status).toBe("completed");
  expect(state?.winnerId).toBe(fighter1);
  expect(state?.endReason).toBe("knockout");
  // Symmetric 100g stakes: pot 200, 5% tax = 10 burned, winner takes 190.
  expect(state?.taxPaid).toBe(10);
  expect(state?.potPaid).toBe(190);
  expect(await goldOf(base, fighter1)).toBe(9_900 + 190);
  expect(await goldOf(base, fighter2)).toBe(9_900);
  expect((state?.recentRounds ?? []).length).toBeGreaterThan(0);
});

test("joining matches the seated stake, or the minimum in an empty room", async () => {
  const { base, t, t2, t3, fighter1, fighter2, spectator } = await setup();
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 400,
  });
  const joined = await t2.mutation(api.arena.joinLobbyAsFighter, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  expect(joined.fighter2Stake).toBe(400);
  expect(await goldOf(base, fighter2)).toBe(10_000 - 400);

  // Both fighters out, spectator inherits the empty room: the next join
  // stakes the minimum instead of matching nobody.
  await t3.mutation(api.arena.joinAsSpectator, {
    playerId: spectator,
    lobbyId: lobby._id,
  });
  await t.mutation(api.arena.leaveLobby, {
    playerId: fighter1,
    lobbyId: lobby._id,
  });
  await t2.mutation(api.arena.leaveLobby, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  const fresh = await t3.mutation(api.arena.joinLobbyAsFighter, {
    playerId: spectator,
    lobbyId: lobby._id,
  });
  expect(fresh.fighter1Id).toBe(spectator);
  expect(fresh.fighter1Stake).toBe(0);
  expect(fresh.spectatorCount).toBe(0);
  expect(await goldOf(base, spectator)).toBe(10_000);
});

test("private lobbies enforce the creator password", async () => {
  const { base, t, t2, fighter1, fighter2 } = await setup();
  await expect(
    t.mutation(api.arena.createLobby, {
      playerId: fighter1,
      visibility: "private",
      stake: 0,
    })
  ).rejects.toThrow("password");
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "private",
    password: "abc123",
    stake: 0,
  });
  expect(lobby.locked).toBe(true);
  expect("password" in lobby).toBe(false);
  await expect(
    t2.mutation(api.arena.joinLobbyAsFighter, {
      playerId: fighter2,
      lobbyId: lobby._id,
      password: "wrong",
    })
  ).rejects.toThrow("Incorrect lobby password");
  const joined = await t2.mutation(api.arena.joinLobbyAsFighter, {
    playerId: fighter2,
    lobbyId: lobby._id,
    password: "abc123",
  });
  expect(joined.fighter2Id).toBe(fighter2);
});

test("spectators can watch without fighting, and the password stays hidden", async () => {
  const { base, t, t3, fighter1, spectator } = await setup();
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "private",
    password: "secret",
    stake: 50,
  });
  const watched = await t3.mutation(api.arena.joinAsSpectator, {
    playerId: spectator,
    lobbyId: lobby._id,
  });
  expect(watched.spectatorCount).toBe(1);
  expect(watched.spectators[0].playerName).toBe("Watcher");
  expect("password" in watched).toBe(false);
  const open = await t3.query(api.arena.getOpenLobbies, {
    playerId: spectator,
  });
  const listed = open.find((row) => String(row._id) === String(lobby._id));
  expect(listed?.locked).toBe(true);
  expect("password" in (listed ?? {})).toBe(false);
});

test("forfeit pays the opponent", async () => {
  const { base, t, t2, fighter1, fighter2 } = await setup();
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 100,
  });
  await t2.mutation(api.arena.joinLobbyAsFighter, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  const started = await readyUpAndStart(t, t2, lobby._id, fighter1, fighter2);
  expect(started.status).toBe("active");
  const settled = await t2.mutation(api.arena.forfeitFight, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  expect(settled.status).toBe("completed");
  expect(settled.winnerId).toBe(fighter1);
  expect(settled.endReason).toBe("forfeit");
  // Pot 200, tax 10, winner nets +90 over the escrowed 100.
  expect(await goldOf(base, fighter1)).toBe(10_000 - 100 + 190);
  expect(await goldOf(base, fighter2)).toBe(9_900);
});

test("leaving before the fight refunds only the leaver", async () => {
  const { base, t, t2, fighter1, fighter2 } = await setup();
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 500,
  });
  await t2.mutation(api.arena.joinLobbyAsFighter, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  // Non-creator leaves: refunded, lobby stays open for the creator.
  await t2.mutation(api.arena.leaveLobby, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  const remaining = await t.query(api.arena.getLobby, {
    playerId: fighter1,
    lobbyId: lobby._id,
  });
  expect(remaining?.status).toBe("waiting");
  expect(remaining?.fighter1Id).toBe(fighter1);
  expect(remaining?.fighter2Id).toBeUndefined();
  expect(remaining?.creatorId).toBe(fighter1);
  expect(await goldOf(base, fighter2)).toBe(10_000);
  expect(await goldOf(base, fighter1)).toBe(9_500);
});

test("creator departure transfers the lobby or discards it when empty", async () => {
  const { base, t, t2, t3, fighter1, fighter2, spectator } = await setup();
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 500,
  });
  await t2.mutation(api.arena.joinLobbyAsFighter, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  await t3.mutation(api.arena.joinAsSpectator, {
    playerId: spectator,
    lobbyId: lobby._id,
  });
  // Creator leaves with others present: opponent inherits, stake refunded.
  await t.mutation(api.arena.leaveLobby, {
    playerId: fighter1,
    lobbyId: lobby._id,
  });
  const transferred = await t2.query(api.arena.getLobby, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  expect(transferred?.status).toBe("waiting");
  expect(transferred?.creatorId).toBe(fighter2);
  expect(transferred?.fighter2Id).toBe(fighter2);
  expect(transferred?.fighter1Id).toBeUndefined();
  expect(await goldOf(base, fighter1)).toBe(10_000);

  // New creator leaves with only a spectator left: the watcher inherits an
  // empty room instead of it being discarded.
  await t2.mutation(api.arena.leaveLobby, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  const inherited = await t3.query(api.arena.getLobby, {
    playerId: spectator,
    lobbyId: lobby._id,
  });
  expect(inherited?.status).toBe("waiting");
  expect(inherited?.creatorId).toBe(spectator);
  expect(inherited?.fighter1Id).toBeUndefined();
  expect(inherited?.fighter2Id).toBeUndefined();
  expect(await goldOf(base, fighter2)).toBe(10_000);

  // Last occupant out: the lobby is discarded.
  await t3.mutation(api.arena.leaveLobby, {
    playerId: spectator,
    lobbyId: lobby._id,
  });
  const discarded = await t3.query(api.arena.getLobby, {
    playerId: spectator,
    lobbyId: lobby._id,
  });
  expect(discarded?.status).toBe("cancelled");
});

test("creator can kick fighters and spectators before the fight", async () => {
  const { base, t, t2, t3, fighter1, fighter2, spectator } = await setup();
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 300,
  });
  await t2.mutation(api.arena.joinLobbyAsFighter, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  await t3.mutation(api.arena.joinAsSpectator, {
    playerId: spectator,
    lobbyId: lobby._id,
  });
  await t.mutation(api.arena.setReady, {
    playerId: fighter1,
    lobbyId: lobby._id,
    ready: true,
  });

  // Non-creators cannot kick.
  await expect(
    t2.mutation(api.arena.kickFromLobby, {
      playerId: fighter2,
      lobbyId: lobby._id,
      targetPlayerId: fighter1,
    })
  ).rejects.toThrow("Only the lobby creator");

  // Kicking the opponent refunds them, opens the corner, voids readies.
  const kicked = await t.mutation(api.arena.kickFromLobby, {
    playerId: fighter1,
    lobbyId: lobby._id,
    targetPlayerId: fighter2,
  });
  expect(kicked.fighter2Id).toBeUndefined();
  expect(kicked.fighter1Ready).toBe(false);
  expect(kicked.countdownEndsAt).toBeUndefined();
  expect(await goldOf(base, fighter2)).toBe(10_000);

  // Kicking a spectator just removes them.
  const unseated = await t.mutation(api.arena.kickFromLobby, {
    playerId: fighter1,
    lobbyId: lobby._id,
    targetPlayerId: spectator,
  });
  expect(unseated.spectatorCount).toBe(0);

  // Kicking a stranger fails.
  await expect(
    t.mutation(api.arena.kickFromLobby, {
      playerId: fighter1,
      lobbyId: lobby._id,
      targetPlayerId: spectator,
    })
  ).rejects.toThrow("not in this lobby");
});

test("kicked and empty corners reopen for newcomers", async () => {
  const { t, t2, t3, fighter1, fighter2, spectator } = await setup();
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 0,
  });
  await t2.mutation(api.arena.joinLobbyAsFighter, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  await t.mutation(api.arena.kickFromLobby, {
    playerId: fighter1,
    lobbyId: lobby._id,
    targetPlayerId: fighter2,
  });
  // A newcomer takes the open corner.
  const rejoined = await t3.mutation(api.arena.joinLobbyAsFighter, {
    playerId: spectator,
    lobbyId: lobby._id,
  });
  expect(rejoined.fighter2Id).toBe(spectator);
  expect(rejoined.spectatorCount).toBe(0);
});

test("fighters cannot be kicked once the fight has started", async () => {
  const { t, t2, fighter1, fighter2 } = await setup();
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 0,
  });
  await t2.mutation(api.arena.joinLobbyAsFighter, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  const started = await readyUpAndStart(t, t2, lobby._id, fighter1, fighter2);
  expect(started.status).toBe("active");
  await expect(
    t.mutation(api.arena.kickFromLobby, {
      playerId: fighter1,
      lobbyId: lobby._id,
      targetPlayerId: fighter2,
    })
  ).rejects.toThrow("only be kicked before the fight starts");
});

test("quick match opens a minimum-stake lobby when none is open", async () => {
  const { base, t, fighter1 } = await setup();
  const first = await t.mutation(api.arena.quickMatch, {
    playerId: fighter1,
  });
  expect(first.joined).toBe(false);
  expect(first.fighter1Stake).toBe(0);
  expect(await goldOf(base, fighter1)).toBe(10_000);
});

test("quick match joins the closest combat level at its stake", async () => {
  const { base, t, t2, t3, fighter1, fighter2, spectator } = await setup();
  // Far table (combat 448) and near table (combat 60, stake 70).
  const far = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 500,
  });
  const near = await t3.mutation(api.arena.createLobby, {
    playerId: spectator,
    visibility: "general",
    stake: 70,
  });
  // Combat 60 fighter pairs with the combat 60 table, staking its 70g.
  const matched = await t2.mutation(api.arena.quickMatch, {
    playerId: fighter2,
  });
  expect(matched.joined).toBe(true);
  expect(String(matched._id)).toBe(String(near._id));
  expect(String(matched._id)).not.toBe(String(far._id));
  expect(matched.fighter2Stake).toBe(70);
  expect(await goldOf(base, fighter2)).toBe(10_000 - 70);
});

test("quick match widens the level band until distant fighters pair", async () => {
  const { base, t, t2, fighter1, fighter2 } = await setup();
  await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 100,
  });
  // Combat 60 vs 448 is ~650% apart: far outside the opening ±10% band.
  const matched = await t2.mutation(api.arena.quickMatch, {
    playerId: fighter2,
  });
  expect(matched.joined).toBe(true);
  expect(matched.fighter2Stake).toBe(100);
  expect(await goldOf(base, fighter2)).toBe(10_000 - 100);
});

test("quick match skips tables you cannot afford", async () => {
  const { base, t, t2, fighter1, fighter2 } = await setup();
  await base.run((ctx) => patchPlayerWithRecords(ctx, fighter1, { gold: 50_000 }));
  await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 20_000,
  });
  // 10k gold can't cover the 20k table: opens a minimum-stake lobby instead.
  const matched = await t2.mutation(api.arena.quickMatch, {
    playerId: fighter2,
  });
  expect(matched.joined).toBe(false);
  expect(matched.fighter1Stake).toBe(0);
  expect(await goldOf(base, fighter2)).toBe(10_000);
});

test("arena balance backfill is idempotent", async () => {
  const { base, t } = await setup();
  const first = await t.mutation(internal.migrations.backfillArenaBalance, {});
  expect(first.created).toBe(10);
  expect(await t.mutation(internal.migrations.backfillArenaBalance, {})).toEqual({
    created: 0,
  });
});

test("admin rejects malformed arena balance values", async () => {
  const { base, t, fighter1 } = await setup();
  await t.mutation(internal.migrations.backfillArenaBalance, {});
  const row = await t.query((ctx) =>
    ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "pvpTaxPercent"))
      .unique()
  );
  if (!row) throw new Error("Missing arena balance row");
  await expect(
    t.mutation(api.admin.updateGameBalance, {
      playerId: fighter1,
      balanceId: row._id,
      value: 101,
      description: "Too high",
    })
  ).rejects.toThrow("between 0 and 100");
});

async function seedArenaStaff(
  t: Awaited<ReturnType<typeof setup>>["t"],
  playerId: Id<"players">,
  withAbility: boolean
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const staff = await ctx.db.insert("items", {
      itemId: "arena-test-staff",
      name: "Arena Staff",
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
    if (!withAbility) return;
    await ctx.db.insert("abilities", {
      abilityId: "arena_bolt",
      name: "Arena Bolt",
      description: "d",
      type: "attack",
      target: "enemy",
      weaponType: "staff",
      basePower: 20,
      powerScalingPerLevel: 0,
      cooldownMs: 1_000,
      tier: 1,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerAbilities", {
      playerId,
      abilityId: "arena_bolt",
      level: 1,
      experience: 0,
      totalExperience: 0,
      learnedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("playerEquippedAbilities", {
      playerId,
      slot: 0,
      abilityId: "arena_bolt",
      equippedAt: now,
    });
  });
}

async function fightOneArenaRound(withAbility: boolean) {
  const { t, t2, fighter1, fighter2 } = await setup();
  await seedArenaStaff(t, fighter1, withAbility);
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 0,
  });
  await t2.mutation(api.arena.joinLobbyAsFighter, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  // Equalize both corners after the level gate so auto-attack damage is
  // identical between the control and ability runs; only the cast differs.
  await t.run(async (ctx) => {
    const equal = { str: 20, dex: 20, int: 20, luk: 20, con: 200 };
    await ctx.db.patch(fighter1, equal);
    await ctx.db.patch(fighter2, equal);
  });
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  await readyUpAndStart(t, t2, lobby._id, fighter1, fighter2);

  vi.setSystemTime(Date.now() + 2_000);
  const ticked = await t.mutation(api.arena.tickFight, {
    playerId: fighter1,
    lobbyId: lobby._id,
  });
  const stored = await t.run((ctx) => ctx.db.get(lobby._id));
  const state = await t.query(api.arena.getLobby, {
    playerId: fighter1,
    lobbyId: lobby._id,
  });
  return { stored, firstRound: state?.recentRounds?.[0], ticked };
}

test("arena rounds auto-cast equipped abilities into the round damage", async () => {
  const control = await fightOneArenaRound(false);
  const boosted = await fightOneArenaRound(true);

  expect(control.stored?.fighter1AbilityState).toBeUndefined();
  expect(boosted.stored?.fighter1AbilityState?.runtimes).toHaveLength(1);
  expect(boosted.stored?.fighter1AbilityState?.runtimes[0]).toMatchObject({
    casts: 1,
    nextAt: 2,
  });

  expect(control.firstRound).toBeTruthy();
  expect(boosted.firstRound).toBeTruthy();
  // Same RNG and identical snapshots: the only extra damage is the cast.
  const extra =
    boosted.firstRound!.damage1to2 - control.firstRound!.damage1to2;
  expect(extra).toBeGreaterThan(0);
});

test("lobbies no longer carry a settlement key", async () => {
  const { base, t, fighter1 } = await setup();
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 0,
  });
  const stored = await base.run((ctx) => ctx.db.get(lobby._id));
  expect(stored?.settlementKey).toBeUndefined();
});

test("the arena settlement key migration clears legacy lobbies", async () => {
  const { base, t, fighter1 } = await setup();
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 0,
  });
  // Simulate a lobby row written before the key stopped being written.
  await base.run(async (ctx) => {
    await ctx.db.patch(lobby._id, { settlementKey: "legacy:pvp:key" });
  });

  const first = await t.mutation(internal.migrations.dropArenaLobbySettlementKeys, {});
  expect(first.cleared).toBe(1);
  const stored = await base.run((ctx) => ctx.db.get(lobby._id));
  expect(stored?.settlementKey).toBeUndefined();

  // Idempotent: a second run finds nothing left to clear.
  const second = await t.mutation(internal.migrations.dropArenaLobbySettlementKeys, {});
  expect(second.cleared).toBe(0);
});
