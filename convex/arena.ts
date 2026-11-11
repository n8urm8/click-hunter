import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { components } from "./_generated/api";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { requirePlayer, requirePlayerRead, requirePlayerOwner } from "./playerAuth";
import { calculateCharacterLevel, calculateCombatLevel } from "./characterLevel";
import { readPlayerCombatProfile } from "./combat";
import {
  abilityWeaponFrom,
  buildAbilityCombatState,
} from "./abilityCombat";
import {
  resolveDuelVerdict,
  runRoundExchange,
  type RoundSide,
} from "./roundCombat";
import { readBalanceMap } from "./balance";
import {
  resolvePvpEquipment,
  snapshotPvpGear,
  type PvpEquipmentBundle,
} from "./pvpLoadout";
import { duelFighter, snapshotFighter } from "./pvpSnapshot";
import { settleTasksBeforeInteraction } from "./taskSettlement";
import {
  patchPlayerProgress,
  readPlayerProgress,
  readPlayerProgressOrNull,
} from "./playerProgress";

type DatabaseCtx = QueryCtx | MutationCtx;
type ArenaLobby = Doc<"arenaLobbies">;

const rateLimiter = new RateLimiter(components.rateLimiter, {});

// ─── Balance configuration ────────────────────────────────────────────────────
// All tunable arena values live here: seeded in seed.ts, backfilled for
// existing deployments in migrations.ts, editable in the admin General tab.

export const PVP_ARENA_BALANCE_DEFAULTS = [
  {
    key: "pvpMinLevel",
    value: 50,
    description:
      "Minimum character level required to fight in the PvP arena (spectating is open to everyone)",
  },
  {
    key: "pvpRoundIntervalMs",
    value: 2000,
    description: "Milliseconds between turn-based PvP arena rounds",
  },
  {
    key: "pvpMaxRounds",
    value: 100,
    description:
      "Maximum rounds in a PvP arena fight before the higher HP fraction wins",
  },
  {
    key: "pvpTaxPercent",
    value: 5,
    description:
      "Percent of the PvP arena pot burned as tax on a decided fight (rounded down)",
  },
  {
    key: "pvpMinStake",
    value: 0,
    description: "Minimum gold stake per PvP arena fighter",
  },
  {
    key: "pvpMaxStake",
    value: 1000000,
    description: "Maximum gold stake per PvP arena fighter",
  },
  {
    key: "pvpLobbyExpiryHours",
    value: 2,
    description:
      "Hours a waiting PvP arena lobby stays open before stakes are refunded",
  },
  {
    key: "pvpFightExpiryMinutes",
    value: 30,
    description:
      "Minutes an active PvP arena fight may go without a round tick before stakes are refunded",
  },
  {
    key: "pvpMaxSpectators",
    value: 50,
    description: "Maximum spectators per PvP arena lobby",
  },
  {
    key: "pvpCountdownMs",
    value: 8000,
    description:
      "Milliseconds both PvP arena fighters stay ready before the fight starts (either unready cancels it)",
  },
] as const;

// Fallbacks match the seeded defaults; used only when a row is missing or
// malformed so fights never hard-fail on bad admin input.
const FALLBACKS = {
  minLevel: 50,
  roundIntervalMs: 2000,
  maxRounds: 100,
  taxPercent: 5,
  minStake: 0,
  maxStake: 1000000,
  lobbyExpiryHours: 2,
  fightExpiryMinutes: 30,
  maxSpectators: 50,
  countdownMs: 8000,
} as const;

const MAX_RECENT_ROUNDS = 30;
const MAX_ROUNDS_PER_TICK = 25;
const OPEN_LIST_LIMIT = 50;
const PASSWORD_MAX_LENGTH = 16;

type ArenaConfig = {
  minLevel: number;
  roundIntervalMs: number;
  maxRounds: number;
  taxPercent: number;
  minStake: number;
  maxStake: number;
  lobbyExpiryMs: number;
  fightExpiryMs: number;
  maxSpectators: number;
  countdownMs: number;
};

function readInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

export async function readArenaConfig(
  ctx: DatabaseCtx
): Promise<ArenaConfig> {
  const map = await readBalanceMap(
    ctx,
    PVP_ARENA_BALANCE_DEFAULTS.map((entry) => entry.key)
  );
  const get = (key: string) => map.get(key);
  const taxPercent = readInt(get("pvpTaxPercent"), FALLBACKS.taxPercent, 0, 100);
  const minStake = readInt(get("pvpMinStake"), FALLBACKS.minStake, 0, 1_000_000_000);
  const maxStake = readInt(
    get("pvpMaxStake"),
    FALLBACKS.maxStake,
    minStake,
    1_000_000_000
  );
  return {
    minLevel: readInt(get("pvpMinLevel"), FALLBACKS.minLevel, 1, 100000),
    roundIntervalMs: readInt(
      get("pvpRoundIntervalMs"),
      FALLBACKS.roundIntervalMs,
      250,
      60000
    ),
    maxRounds: readInt(get("pvpMaxRounds"), FALLBACKS.maxRounds, 1, 10000),
    taxPercent,
    minStake,
    maxStake,
    lobbyExpiryMs:
      readInt(
        get("pvpLobbyExpiryHours"),
        FALLBACKS.lobbyExpiryHours,
        1,
        168
      ) *
      60 *
      60 *
      1000,
    fightExpiryMs:
      readInt(
        get("pvpFightExpiryMinutes"),
        FALLBACKS.fightExpiryMinutes,
        1,
        24 * 60
      ) *
      60 *
      1000,
    maxSpectators: readInt(
      get("pvpMaxSpectators"),
      FALLBACKS.maxSpectators,
      0,
      1000
    ),
    countdownMs: readInt(
      get("pvpCountdownMs"),
      FALLBACKS.countdownMs,
      1000,
      120000
    ),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isFighter(lobby: ArenaLobby, playerId: Id<"players">): boolean {
  return lobby.fighter1Id === playerId || lobby.fighter2Id === playerId;
}

function validateStake(stake: number, config: ArenaConfig): number {
  if (!Number.isSafeInteger(stake)) {
    throw new Error("Stake must be a whole number of gold");
  }
  if (stake < config.minStake || stake > config.maxStake) {
    throw new Error(
      `Stake must be between ${config.minStake} and ${config.maxStake} gold`
    );
  }
  return stake;
}

function validatePassword(
  visibility: "general" | "private",
  password: string | undefined
): string | undefined {
  if (visibility === "general") {
    if (password !== undefined && password.trim() !== "") {
      throw new Error("General lobbies cannot have a password");
    }
    return undefined;
  }
  const clean = (password ?? "").trim();
  if (clean.length < 1 || clean.length > PASSWORD_MAX_LENGTH) {
    throw new Error(
      `Private lobbies need a short password (1-${PASSWORD_MAX_LENGTH} characters)`
    );
  }
  return clean;
}

/** Character level gate for fighters. Spectating is open to everyone. */
async function requireFighterLevel(
  ctx: DatabaseCtx,
  player: Doc<"players">,
  config: ArenaConfig
): Promise<number> {
  const level = await calculateCharacterLevel(ctx, player);
  if (level < config.minLevel) {
    throw new Error(
      `Fighting in the arena requires character level ${config.minLevel} (you are ${level})`
    );
  }
  return level;
}

/**
 * Settle before escrowing, but only when the player actually has task rows —
 * same rationale as the guild spending paths.
 */
async function settleIfTasksExist(ctx: MutationCtx, playerId: Id<"players">) {
  const active = await ctx.db
    .query("playerTasks")
    .withIndex("by_playerId_and_status", (q) =>
      q.eq("playerId", playerId).eq("status", "active")
    )
    .first();
  const queued =
    active ??
    (await ctx.db
      .query("playerTasks")
      .withIndex("by_playerId_and_status", (q) =>
        q.eq("playerId", playerId).eq("status", "queued")
      )
      .first());
  if (queued) {
    await settleTasksBeforeInteraction(ctx, playerId);
  }
}

type ViewerRole = "fighter" | "spectator" | "none";

/** Waiting/active lobby where the caller already holds a seat, if any. */
async function findMyLobby(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<{ lobby: ArenaLobby; role: ViewerRole } | null> {
  const [waiting, active] = await Promise.all([
    ctx.db
      .query("arenaLobbies")
      .withIndex("by_status", (q) => q.eq("status", "waiting"))
      .take(100),
    ctx.db
      .query("arenaLobbies")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(100),
  ]);
  for (const lobby of [...waiting, ...active]) {
    if (isFighter(lobby, playerId)) {
      return { lobby, role: "fighter" };
    }
  }
  const spectating = await ctx.db
    .query("arenaSpectators")
    .withIndex("by_player", (q) => q.eq("playerId", playerId))
    .take(50);
  for (const row of spectating) {
    const lobby = await ctx.db.get(row.lobbyId);
    if (
      lobby &&
      (lobby.status === "waiting" || lobby.status === "active") &&
      !isFighter(lobby, playerId)
    ) {
      return { lobby, role: "spectator" };
    }
  }
  return null;
}

async function spectatorCount(
  ctx: DatabaseCtx,
  lobbyId: Id<"arenaLobbies">
): Promise<number> {
  const rows = await ctx.db
    .query("arenaSpectators")
    .withIndex("by_lobby", (q) => q.eq("lobbyId", lobbyId))
    .take(1000);
  return rows.length;
}

/** Public projection. The password is never returned. */
async function toPublicLobby(ctx: DatabaseCtx, lobby: ArenaLobby) {
  const spectators = await ctx.db
    .query("arenaSpectators")
    .withIndex("by_lobby", (q) => q.eq("lobbyId", lobby._id))
    .take(1000);
  const {
    password: _password,
    ...rest
  } = lobby;
  void _password;
  return {
    ...rest,
    locked: lobby.password !== undefined,
    spectatorCount: spectators.length,
    spectators: spectators
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((row) => ({ playerId: row.playerId, playerName: row.playerName })),
  };
}

export type PublicLobby = Awaited<ReturnType<typeof toPublicLobby>>;

/** Refund escrowed stakes in full. No-op for empty slots. */
async function refundStakes(ctx: MutationCtx, lobby: ArenaLobby) {
  const refunds: Array<{ playerId: Id<"players">; stake: number }> = [];
  if (lobby.fighter1Id !== undefined && (lobby.fighter1Stake ?? 0) > 0) {
    refunds.push({ playerId: lobby.fighter1Id, stake: lobby.fighter1Stake ?? 0 });
  }
  if (lobby.fighter2Id !== undefined && (lobby.fighter2Stake ?? 0) > 0) {
    refunds.push({ playerId: lobby.fighter2Id, stake: lobby.fighter2Stake ?? 0 });
  }
  for (const refund of refunds) {
    const fighter = await readPlayerProgressOrNull(ctx, refund.playerId);
    if (fighter) {
      await patchPlayerProgress(ctx, fighter, { gold: fighter.gold + refund.stake });
    }
  }
}

/** Refund one fighter's escrowed stake in full. */
async function refundFighterStake(
  ctx: MutationCtx,
  playerId: Id<"players">,
  stake: number
) {
  if (stake <= 0) return;
  const fighter = await readPlayerProgressOrNull(ctx, playerId);
  if (!fighter) return;
  await patchPlayerProgress(ctx, fighter, { gold: fighter.gold + stake });
}

type SpectatorRow = Doc<"arenaSpectators">;

async function orderedSpectators(
  ctx: DatabaseCtx,
  lobbyId: Id<"arenaLobbies">
): Promise<SpectatorRow[]> {
  const rows = await ctx.db
    .query("arenaSpectators")
    .withIndex("by_lobby", (q) => q.eq("lobbyId", lobbyId))
    .take(1000);
  return rows.sort((a, b) => a.joinedAt - b.joinedAt);
}

/**
 * Lobby roster in succession order: fighter slots first, then spectators by
 * arrival. The next creator is the first entry that isn't leaving.
 */
function successionOrder(
  lobby: ArenaLobby,
  spectators: SpectatorRow[]
): Id<"players">[] {
  const order: Id<"players">[] = [];
  if (lobby.fighter1Id !== undefined) order.push(lobby.fighter1Id);
  if (
    lobby.fighter2Id !== undefined &&
    lobby.fighter2Id !== lobby.fighter1Id
  ) {
    order.push(lobby.fighter2Id);
  }
  for (const row of spectators) {
    if (!order.includes(row.playerId)) order.push(row.playerId);
  }
  return order;
}

/** Clear one fighter slot (escrow must be refunded by the caller first). */
async function clearFighterSlot(
  ctx: MutationCtx,
  lobbyId: Id<"arenaLobbies">,
  slot: "fighter1" | "fighter2"
) {
  if (slot === "fighter1") {
    await ctx.db.patch(lobbyId, {
      fighter1Id: undefined,
      fighter1Name: undefined,
      fighter1Stake: undefined,
      fighter1Level: undefined,
      fighter1CombatLevel: undefined,
      fighter1Ready: undefined,
    });
  } else {
    await ctx.db.patch(lobbyId, {
      fighter2Id: undefined,
      fighter2Name: undefined,
      fighter2Stake: undefined,
      fighter2Level: undefined,
      fighter2CombatLevel: undefined,
      fighter2Ready: undefined,
    });
  }
}

/**
 * Reset both readies and cancel any countdown. Called whenever the lineup
 * changes (join/leave/kick) so a stale ready can never start a new pairing.
 */
async function resetReadies(ctx: MutationCtx, lobbyId: Id<"arenaLobbies">) {
  await ctx.db.patch(lobbyId, {
    fighter1Ready: false,
    fighter2Ready: false,
    countdownEndsAt: undefined,
    updatedAt: Date.now(),
  });
}

/**
 * Mark a waiting/active lobby expired when its clock ran out, refunding both
 * stakes. Returns true when the caller must treat the lobby as expired.
 */
async function expireIfStale(
  ctx: MutationCtx,
  lobby: ArenaLobby,
  now: number
): Promise<boolean> {
  if (
    (lobby.status !== "waiting" && lobby.status !== "active") ||
    now <= lobby.expiresAt
  ) {
    return false;
  }
  await refundStakes(ctx, lobby);
  await ctx.db.patch(lobby._id, {
    status: "expired",
    endedAt: now,
    updatedAt: now,
  });
  return true;
}

type FightOutcome =
  | { type: "win"; winnerId: Id<"players">; reason: "knockout" | "rounds" | "forfeit" }
  | { type: "draw" };

/** Settle a finished fight exactly once: winner takes the pot minus tax. */
async function settleFight(
  ctx: MutationCtx,
  lobby: ArenaLobby,
  outcome: FightOutcome,
  taxPercent: number,
  now: number
) {
  const stake1 = lobby.fighter1Stake ?? 0;
  const stake2 = lobby.fighter2Stake ?? 0;
  if (outcome.type === "draw") {
    await refundStakes(ctx, lobby);
    await ctx.db.patch(lobby._id, {
      status: "completed",
      endReason: "draw",
      taxPaid: 0,
      potPaid: 0,
      endedAt: now,
      updatedAt: now,
    });
    return;
  }
  const pot = stake1 + stake2;
  const tax = Math.floor((pot * taxPercent) / 100);
  const payout = pot - tax;
  const winner = await readPlayerProgress(ctx, outcome.winnerId);
  await patchPlayerProgress(ctx, winner, { gold: winner.gold + payout });
  await ctx.db.patch(lobby._id, {
    status: "completed",
    winnerId: outcome.winnerId,
    endReason: outcome.reason,
    taxPaid: tax,
    potPaid: payout,
    endedAt: now,
    updatedAt: now,
  });
}

/**
 * Shared fight-start core: freeze both combat snapshots at full HP and open
 * the round clock. Stakes were already escrowed on create/join.
 */
async function startFightCore(
  ctx: MutationCtx,
  lobby: ArenaLobby,
  config: ArenaConfig,
  now: number
): Promise<ArenaLobby> {
  if (lobby.fighter1Id === undefined || lobby.fighter2Id === undefined) {
    throw new Error("Two fighters must join before the fight can start");
  }
  const [fighter1, fighter2] = await Promise.all([
    ctx.db.get(lobby.fighter1Id),
    ctx.db.get(lobby.fighter2Id),
  ]);
  if (!fighter1 || !fighter2) throw new Error("Fighter not found");
  // PvP fights snapshot from each fighter's saved loadout (falling back to
  // currently equipped gear), resolved once so both corners share it.
  const [equipment1, equipment2] = await Promise.all([
    resolvePvpEquipment(ctx, fighter1._id),
    resolvePvpEquipment(ctx, fighter2._id),
  ]);
  const [gear1, gear2] = await Promise.all([
    snapshotPvpGear(ctx, fighter1._id),
    snapshotPvpGear(ctx, fighter2._id),
  ]);
  const [snapshot1, snapshot2] = await Promise.all([
    snapshotFighter(
      ctx,
      fighter1,
      now,
      equipment2.weapon?.element ?? undefined,
      equipment1
    ),
    snapshotFighter(
      ctx,
      fighter2,
      now,
      equipment1.weapon?.element ?? undefined,
      equipment2
    ),
  ]);
  // Freeze each corner's equipped abilities with cooldowns in rounds, so
  // auto-cast resolves on the same round clock as the fight itself.
  const [abilityState1, abilityState2] = await Promise.all([
    buildAbilityCombatState(
      ctx,
      fighter1._id,
      abilityWeaponFrom(equipment1.weapon),
      { unit: "rounds", roundIntervalMs: config.roundIntervalMs }
    ),
    buildAbilityCombatState(
      ctx,
      fighter2._id,
      abilityWeaponFrom(equipment2.weapon),
      { unit: "rounds", roundIntervalMs: config.roundIntervalMs }
    ),
  ]);
  await ctx.db.patch(lobby._id, {
    status: "active",
    fighter1Hp: snapshot1.maxHp,
    fighter1MaxHp: snapshot1.maxHp,
    fighter2Hp: snapshot2.maxHp,
    fighter2MaxHp: snapshot2.maxHp,
    fighter1Snapshot: snapshot1,
    fighter2Snapshot: snapshot2,
    fighter1Gear: gear1,
    fighter2Gear: gear2,
    ...(abilityState1.runtimes.length > 0
      ? { fighter1AbilityState: abilityState1 }
      : {}),
    ...(abilityState2.runtimes.length > 0
      ? { fighter2AbilityState: abilityState2 }
      : {}),
    round: 0,
    lastRoundAt: now,
    roundIntervalMs: config.roundIntervalMs,
    maxRounds: config.maxRounds,
    recentRounds: [],
    countdownEndsAt: undefined,
    startedAt: now,
    expiresAt: now + config.fightExpiryMs,
    updatedAt: now,
  });
  const started = await ctx.db.get(lobby._id);
  if (!started) throw new Error("Arena lobby not found");
  return started;
}

/** Shared create core used by createLobby and quickMatch. */
async function createLobbyCore(
  ctx: MutationCtx,
  player: Doc<"players">,
  args: {
    visibility: "general" | "private";
    password?: string;
    stake: number;
  },
  config: ArenaConfig,
  now: number
): Promise<ArenaLobby> {
  const cleanPassword = validatePassword(args.visibility, args.password);
  const stake = validateStake(args.stake, config);
  const level = await requireFighterLevel(ctx, player, config);
  const existing = await findMyLobby(ctx, player._id);
  if (existing?.role === "fighter") {
    throw new Error("You are already fighting or waiting in another lobby");
  }
  await settleIfTasksExist(ctx, player._id);
  const fresh = await readPlayerProgress(ctx, player._id);
  if (fresh.gold < stake) throw new Error("Insufficient gold for that stake");
  await patchPlayerProgress(ctx, fresh, { gold: fresh.gold - stake });
  const lobbyId = await ctx.db.insert("arenaLobbies", {
    visibility: args.visibility,
    ...(cleanPassword === undefined ? {} : { password: cleanPassword }),
    status: "waiting",
    creatorId: player._id,
    fighter1Id: player._id,
    fighter1Name: player.name,
    fighter1Stake: stake,
    fighter1Level: level,
    fighter1CombatLevel: calculateCombatLevel(player),
    fighter1Ready: false,
    expiresAt: now + config.lobbyExpiryMs,
    createdAt: now,
    updatedAt: now,
  });
  const lobby = await ctx.db.get(lobbyId);
  if (!lobby) throw new Error("Arena lobby could not be created");
  return lobby;
}

/** Shared join-as-fighter core used by joinLobbyAsFighter and quickMatch.
 * Stakes are always symmetric: the newcomer matches the seated fighter's
 * stake (or the minimum stake when taking an empty room). */
async function joinLobbyCore(
  ctx: MutationCtx,
  player: Doc<"players">,
  lobby: ArenaLobby,
  args: { password?: string },
  config: ArenaConfig,
  now: number
): Promise<ArenaLobby> {
  if (await expireIfStale(ctx, lobby, now)) {
    throw new Error("That lobby has expired");
  }
  if (lobby.status !== "waiting") {
    throw new Error("That lobby is no longer open");
  }
  if (isFighter(lobby, player._id)) {
    throw new Error("You are already fighting in this lobby");
  }
  const slot =
    lobby.fighter1Id === undefined
      ? ("fighter1" as const)
      : lobby.fighter2Id === undefined
        ? ("fighter2" as const)
        : null;
  if (slot === null) {
    throw new Error("That lobby is already full");
  }
  if (lobby.visibility === "private") {
    if ((args.password ?? "").trim() !== (lobby.password ?? "")) {
      throw new Error("Incorrect lobby password");
    }
  }
  // Symmetric stakes: match the seated fighter, or the minimum when the
  // room is empty.
  const seatedStake =
    lobby.fighter1Id !== undefined
      ? (lobby.fighter1Stake ?? 0)
      : lobby.fighter2Id !== undefined
        ? (lobby.fighter2Stake ?? 0)
        : config.minStake;
  const stake = validateStake(seatedStake, config);
  const level = await requireFighterLevel(ctx, player, config);
  const existing = await findMyLobby(ctx, player._id);
  if (existing?.role === "fighter") {
    throw new Error("You are already fighting or waiting in another lobby");
  }
  await settleIfTasksExist(ctx, player._id);
  const fresh = await readPlayerProgress(ctx, player._id);
  if (fresh.gold < stake) throw new Error("Insufficient gold for that stake");
  await patchPlayerProgress(ctx, fresh, { gold: fresh.gold - stake });
  // A spectator taking a corner stops spectating.
  const watching = await ctx.db
    .query("arenaSpectators")
    .withIndex("by_lobby_and_player", (q) =>
      q.eq("lobbyId", lobby._id).eq("playerId", player._id)
    )
    .first();
  if (watching) await ctx.db.delete(watching._id);
  if (slot === "fighter1") {
    await ctx.db.patch(lobby._id, {
      fighter1Id: player._id,
      fighter1Name: player.name,
      fighter1Stake: stake,
      fighter1Level: level,
      fighter1CombatLevel: calculateCombatLevel(player),
      fighter1Ready: false,
      updatedAt: now,
    });
  } else {
    await ctx.db.patch(lobby._id, {
      fighter2Id: player._id,
      fighter2Name: player.name,
      fighter2Stake: stake,
      fighter2Level: level,
      fighter2CombatLevel: calculateCombatLevel(player),
      fighter2Ready: false,
      updatedAt: now,
    });
  }
  // The lineup changed: no stale ready (or countdown) survives it.
  await resetReadies(ctx, lobby._id);
  const updated = await ctx.db.get(lobby._id);
  if (!updated) throw new Error("Arena lobby not found");
  return updated;
}

// ─── Mutations: lobby lifecycle ───────────────────────────────────────────────

export const createLobby = mutation({
  args: {
    playerId: v.id("players"),
    visibility: v.union(v.literal("general"), v.literal("private")),
    password: v.optional(v.string()),
    stake: v.number(),
  },
  handler: async (ctx, { playerId, visibility, password, stake }) => {
    const player = await requirePlayer(ctx, playerId);
    const config = await readArenaConfig(ctx);
    const lobby = await createLobbyCore(
      ctx,
      player,
      { visibility, password, stake },
      config,
      Date.now()
    );
    return await toPublicLobby(ctx, lobby);
  },
});

export const joinLobbyAsFighter = mutation({
  args: {
    playerId: v.id("players"),
    lobbyId: v.id("arenaLobbies"),
    password: v.optional(v.string()),
  },
  handler: async (ctx, { playerId, lobbyId, password }) => {
    const player = await requirePlayer(ctx, playerId);
    const lobby = await ctx.db.get(lobbyId);
    if (!lobby) throw new Error("Arena lobby not found");
    const config = await readArenaConfig(ctx);
    const updated = await joinLobbyCore(
      ctx,
      player,
      lobby,
      { password },
      config,
      Date.now()
    );
    return await toPublicLobby(ctx, updated);
  },
});

/**
 * Join the general lobby with the closest combat level, or open a minimum-
 * stake lobby when none is waiting. Matching runs on combat level only
 * (the combat stats, no skills): ±10% first, widening by 10 points until
 * something fits. The joiner always matches the seated fighter's stake —
 * there is no stake input on quick match.
 */
export const quickMatch = mutation({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    const player = await requirePlayer(ctx, playerId);
    const progress = await readPlayerProgress(ctx, playerId);
    const config = await readArenaConfig(ctx);
    const now = Date.now();
    const waiting = await ctx.db
      .query("arenaLobbies")
      .withIndex("by_status_and_visibility", (q) =>
        q.eq("status", "waiting").eq("visibility", "general")
      )
      .take(OPEN_LIST_LIMIT);
    // Exactly one corner taken: a real opponent is guaranteed, and their
    // stake is the price of admission.
    const open = waiting.filter(
      (lobby) =>
        (lobby.fighter1Id === undefined) !==
          (lobby.fighter2Id === undefined) &&
        lobby.fighter1Id !== playerId &&
        lobby.fighter2Id !== playerId &&
        now <= lobby.expiresAt
    );
    const mine = Math.max(1, calculateCombatLevel(player));
    type Candidate = {
      lobby: (typeof open)[number];
      combat: number;
      stake: number;
      diff: number;
    };
    const candidates: Array<Omit<Candidate, "diff">> = [];
    for (const lobby of open) {
      const firstSeatTaken = lobby.fighter1Id !== undefined;
      const occupantId = firstSeatTaken ? lobby.fighter1Id! : lobby.fighter2Id!;
      let combat = firstSeatTaken
        ? lobby.fighter1CombatLevel
        : lobby.fighter2CombatLevel;
      if (combat === undefined) {
        // Rows recorded before combat snapshots existed: resolve live.
        const occupant = await ctx.db.get(occupantId);
        if (!occupant) continue;
        combat = calculateCombatLevel(occupant);
      }
      const stake = firstSeatTaken
        ? (lobby.fighter1Stake ?? 0)
        : (lobby.fighter2Stake ?? 0);
      // Skip tables whose stake is no longer legal or affordable; the join
      // itself re-checks gold after settling tasks.
      if (stake < config.minStake || stake > config.maxStake) continue;
      if (progress.gold < stake) continue;
      candidates.push({ lobby, combat, stake });
    }
    let pick: Candidate | null = null;
    for (let band = 10; pick === null && band <= 100000; band += 10) {
      for (const candidate of candidates) {
        const diff = Math.abs(candidate.combat - mine);
        if (diff * 100 > band * mine) continue;
        if (
          pick === null ||
          diff < pick.diff ||
          (diff === pick.diff &&
            candidate.lobby.createdAt < pick.lobby.createdAt)
        ) {
          pick = { ...candidate, diff };
        }
      }
    }
    if (pick !== null) {
      const updated = await joinLobbyCore(
        ctx,
        player,
        pick.lobby,
        {},
        config,
        now
      );
      return { ...(await toPublicLobby(ctx, updated)), joined: true as const };
    }
    const created = await createLobbyCore(
      ctx,
      player,
      { visibility: "general", stake: config.minStake },
      config,
      now
    );
    return { ...(await toPublicLobby(ctx, created)), joined: false as const };
  },
});

/**
 * Leave whatever seat the caller holds. Fighters leaving a waiting lobby
 * cancel it (both stakes refunded); fighters leaving an active fight forfeit
 * (the opponent takes the pot); spectators just walk away.
 */
export const leaveLobby = mutation({
  args: {
    playerId: v.id("players"),
    lobbyId: v.id("arenaLobbies"),
  },
  handler: async (ctx, { playerId, lobbyId }) => {
    await requirePlayerOwner(ctx, playerId);
    const lobby = await ctx.db.get(lobbyId);
    if (!lobby) throw new Error("Arena lobby not found");
    const now = Date.now();
    if (await expireIfStale(ctx, lobby, now)) {
      return await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!);
    }
    const spectator = await ctx.db
      .query("arenaSpectators")
      .withIndex("by_lobby_and_player", (q) =>
        q.eq("lobbyId", lobbyId).eq("playerId", playerId)
      )
      .first();
    if (!isFighter(lobby, playerId) && lobby.creatorId !== playerId) {
      if (spectator) await ctx.db.delete(spectator._id);
      return await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!);
    }
    if (lobby.status === "waiting") {
      // Leaving before the fight: the leaver's escrowed stake is refunded,
      // their corner opens up, and any ready/countdown is voided. When the
      // creator leaves, the next occupant in line inherits the lobby; an
      // empty lobby is discarded.
      const slot =
        lobby.fighter1Id === playerId
          ? ("fighter1" as const)
          : lobby.fighter2Id === playerId
            ? ("fighter2" as const)
            : null;
      if (slot !== null) {
        await refundFighterStake(
          ctx,
          playerId,
          slot === "fighter1"
            ? (lobby.fighter1Stake ?? 0)
            : (lobby.fighter2Stake ?? 0)
        );
        await clearFighterSlot(ctx, lobby._id, slot);
      }
      if (spectator) await ctx.db.delete(spectator._id);
      const fresh = await ctx.db.get(lobby._id);
      if (!fresh) throw new Error("Arena lobby not found");
      if (lobby.creatorId === playerId) {
        const next = successionOrder(
          fresh,
          await orderedSpectators(ctx, lobby._id)
        ).filter((id) => id !== playerId);
        if (next.length === 0) {
          await ctx.db.patch(lobby._id, {
            status: "cancelled",
            endedAt: now,
            updatedAt: now,
          });
        } else {
          await ctx.db.patch(lobby._id, {
            creatorId: next[0],
            updatedAt: now,
          });
        }
      }
      await resetReadies(ctx, lobby._id);
      return await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!);
    }
    if (lobby.status === "active") {
      if (!isFighter(lobby, playerId)) {
        if (spectator) await ctx.db.delete(spectator._id);
        return await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!);
      }
      const config = await readArenaConfig(ctx);
      const opponentId =
        lobby.fighter1Id === playerId ? lobby.fighter2Id : lobby.fighter1Id;
      if (!opponentId) throw new Error("Arena fight has no opponent");
      await settleFight(
        ctx,
        lobby,
        { type: "win", winnerId: opponentId, reason: "forfeit" },
        config.taxPercent,
        now
      );
      return await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!);
    }
    if (spectator) await ctx.db.delete(spectator._id);
    return await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!);
  },
});

/** Creator cancels a waiting lobby; both escrowed stakes are refunded. */
export const cancelLobby = mutation({
  args: {
    playerId: v.id("players"),
    lobbyId: v.id("arenaLobbies"),
  },
  handler: async (ctx, { playerId, lobbyId }) => {
    await requirePlayerOwner(ctx, playerId);
    const lobby = await ctx.db.get(lobbyId);
    if (!lobby) throw new Error("Arena lobby not found");
    if (lobby.creatorId !== playerId) {
      throw new Error("Only the lobby creator can cancel it");
    }
    if (lobby.status !== "waiting") {
      throw new Error("Only waiting lobbies can be cancelled");
    }
    const now = Date.now();
    await refundStakes(ctx, lobby);
    await ctx.db.patch(lobby._id, {
      status: "cancelled",
      endedAt: now,
      updatedAt: now,
    });
    return await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!);
  },
});

/** Creator removes another occupant. Fighters only before the fight starts
 * (their escrowed stake is refunded); spectators any time while open. */
export const kickFromLobby = mutation({
  args: {
    playerId: v.id("players"),
    lobbyId: v.id("arenaLobbies"),
    targetPlayerId: v.id("players"),
  },
  handler: async (ctx, { playerId, lobbyId, targetPlayerId }) => {
    await requirePlayerOwner(ctx, playerId);
    const lobby = await ctx.db.get(lobbyId);
    if (!lobby) throw new Error("Arena lobby not found");
    if (lobby.creatorId !== playerId) {
      throw new Error("Only the lobby creator can kick players");
    }
    if (targetPlayerId === playerId) {
      throw new Error("You cannot kick yourself");
    }
    const now = Date.now();
    if (await expireIfStale(ctx, lobby, now)) {
      throw new Error("That lobby has expired");
    }
    const slot =
      lobby.fighter1Id === targetPlayerId
        ? ("fighter1" as const)
        : lobby.fighter2Id === targetPlayerId
          ? ("fighter2" as const)
          : null;
    if (slot !== null) {
      if (lobby.status !== "waiting") {
        throw new Error("Fighters can only be kicked before the fight starts");
      }
      await refundFighterStake(
        ctx,
        targetPlayerId,
        slot === "fighter1"
          ? (lobby.fighter1Stake ?? 0)
          : (lobby.fighter2Stake ?? 0)
      );
      await clearFighterSlot(ctx, lobby._id, slot);
      await resetReadies(ctx, lobby._id);
      return await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!);
    }
    const row = await ctx.db
      .query("arenaSpectators")
      .withIndex("by_lobby_and_player", (q) =>
        q.eq("lobbyId", lobbyId).eq("playerId", targetPlayerId)
      )
      .first();
    if (!row) throw new Error("That player is not in this lobby");
    if (lobby.status !== "waiting" && lobby.status !== "active") {
      throw new Error("That lobby is over");
    }
    await ctx.db.delete(row._id);
    return await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!);
  },
});

export const joinAsSpectator = mutation({
  args: {
    playerId: v.id("players"),
    lobbyId: v.id("arenaLobbies"),
  },
  handler: async (ctx, { playerId, lobbyId }) => {
    const player = await requirePlayer(ctx, playerId);
    const lobby = await ctx.db.get(lobbyId);
    if (!lobby) throw new Error("Arena lobby not found");
    const now = Date.now();
    if (await expireIfStale(ctx, lobby, now)) {
      throw new Error("That lobby has expired");
    }
    if (lobby.status !== "waiting" && lobby.status !== "active") {
      throw new Error("That lobby is over");
    }
    if (isFighter(lobby, playerId)) {
      throw new Error("Fighters already see the fight");
    }
    const config = await readArenaConfig(ctx);
    const existing = await ctx.db
      .query("arenaSpectators")
      .withIndex("by_lobby_and_player", (q) =>
        q.eq("lobbyId", lobbyId).eq("playerId", playerId)
      )
      .first();
    if (existing) return await toPublicLobby(ctx, lobby);
    if ((await spectatorCount(ctx, lobbyId)) >= config.maxSpectators) {
      throw new Error("The spectator stands are full");
    }
    await ctx.db.insert("arenaSpectators", {
      lobbyId,
      playerId,
      playerName: player.name,
      joinedAt: now,
    });
    return await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!);
  },
});

// ─── Mutations: ready & start ─────────────────────────────────────────────────

/**
 * Fighters signal readiness. When both corners are ready an 8-second
 * (balance-configured) countdown starts; either unready cancels it. The
 * fight itself begins once the countdown passes (see tickFight) — nobody
 * can force-start it early.
 */
export const setReady = mutation({
  args: {
    playerId: v.id("players"),
    lobbyId: v.id("arenaLobbies"),
    ready: v.boolean(),
  },
  handler: async (ctx, { playerId, lobbyId, ready }) => {
    await requirePlayerOwner(ctx, playerId);
    const lobby = await ctx.db.get(lobbyId);
    if (!lobby) throw new Error("Arena lobby not found");
    const now = Date.now();
    if (await expireIfStale(ctx, lobby, now)) {
      throw new Error("That lobby has expired");
    }
    if (lobby.status !== "waiting") {
      throw new Error("That lobby is no longer waiting");
    }
    const patch: Partial<ArenaLobby> | null =
      lobby.fighter1Id === playerId
        ? { fighter1Ready: ready }
        : lobby.fighter2Id === playerId
          ? { fighter2Ready: ready }
          : null;
    if (patch === null) throw new Error("Only fighters can ready up");
    await ctx.db.patch(lobby._id, { ...patch, updatedAt: now });
    const current = (await ctx.db.get(lobby._id))!;
    const bothReady =
      current.fighter1Id !== undefined &&
      current.fighter2Id !== undefined &&
      current.fighter1Ready === true &&
      current.fighter2Ready === true;
    let countingDown: boolean;
    if (bothReady) {
      if (current.countdownEndsAt === undefined) {
        const config = await readArenaConfig(ctx);
        await ctx.db.patch(lobby._id, {
          countdownEndsAt: now + config.countdownMs,
          updatedAt: now,
        });
      }
      countingDown = true;
    } else {
      if (current.countdownEndsAt !== undefined) {
        await ctx.db.patch(lobby._id, {
          countdownEndsAt: undefined,
          updatedAt: now,
        });
      }
      countingDown = false;
    }
    return {
      ...(await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!)),
      countingDown,
    };
  },
});

// ─── Mutations: turn-based rounds ─────────────────────────────────────────────

/**
 * Advance all due rounds. Any viewer (fighter or spectator) may call this on
 * a poll loop — the clock, damage rolls, and the final verdict are all
 * server-side, so clients only render what comes back.
 */
export const tickFight = mutation({
  args: {
    playerId: v.id("players"),
    lobbyId: v.id("arenaLobbies"),
  },
  handler: async (ctx, { playerId, lobbyId }) => {
    await requirePlayerOwner(ctx, playerId);
    const gate = await rateLimiter.limit(ctx, "pvpTick", {
      key: playerId,
      config: { kind: "token bucket", rate: 4, period: 1_000, capacity: 4 },
    });
    const lobby = await ctx.db.get(lobbyId);
    if (!lobby) throw new Error("Arena lobby not found");
    if (!gate.ok) {
      return {
        ...(await toPublicLobby(ctx, lobby)),
        advanced: 0,
        changed: false as const,
        started: false as const,
      };
    }
    const now = Date.now();
    if (await expireIfStale(ctx, lobby, now)) {
      return {
        ...(await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!)),
        advanced: 0,
        changed: true as const,
        started: false as const,
      };
    }
    if (lobby.status === "waiting") {
      // Countdown completion: both corners held ready through the clock, so
      // the fight starts. Anything else just reports the room state.
      const bothReady =
        lobby.fighter1Id !== undefined &&
        lobby.fighter2Id !== undefined &&
        lobby.fighter1Ready === true &&
        lobby.fighter2Ready === true;
      if (
        bothReady &&
        lobby.countdownEndsAt !== undefined &&
        now >= lobby.countdownEndsAt
      ) {
        const config = await readArenaConfig(ctx);
        const started = await startFightCore(ctx, lobby, config, now);
        return {
          ...(await toPublicLobby(ctx, started)),
          advanced: 0,
          changed: true as const,
          started: true as const,
        };
      }
      if (!bothReady && lobby.countdownEndsAt !== undefined) {
        // Defensive: the countdown should already be cleared by whatever
        // broke the ready pair (unready/leave/kick/join).
        await ctx.db.patch(lobby._id, {
          countdownEndsAt: undefined,
          updatedAt: now,
        });
        return {
          ...(await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!)),
          advanced: 0,
          changed: true as const,
          started: false as const,
        };
      }
      return {
        ...(await toPublicLobby(ctx, lobby)),
        advanced: 0,
        changed: false as const,
        started: false as const,
      };
    }
    if (lobby.status !== "active") {
      return {
        ...(await toPublicLobby(ctx, lobby)),
        advanced: 0,
        changed: false as const,
        started: false as const,
      };
    }
    if (lobby.fighter1Id === undefined || lobby.fighter2Id === undefined) {
      throw new Error("Arena fight is missing a fighter");
    }
    const snapshot1 = lobby.fighter1Snapshot;
    const snapshot2 = lobby.fighter2Snapshot;
    const interval = lobby.roundIntervalMs ?? FALLBACKS.roundIntervalMs;
    const maxRounds = lobby.maxRounds ?? FALLBACKS.maxRounds;
    if (
      snapshot1 === undefined ||
      snapshot2 === undefined ||
      lobby.fighter1Hp === undefined ||
      lobby.fighter2Hp === undefined ||
      lobby.fighter1MaxHp === undefined ||
      lobby.fighter2MaxHp === undefined
    ) {
      throw new Error("Arena fight was not started correctly");
    }
    const dueRounds = Math.min(
      MAX_ROUNDS_PER_TICK,
      Math.floor(Math.max(0, now - (lobby.lastRoundAt ?? now)) / interval)
    );
    if (dueRounds <= 0) {
      return {
        ...(await toPublicLobby(ctx, lobby)),
        advanced: 0,
        changed: false as const,
        started: false as const,
      };
    }
    let hp1 = lobby.fighter1Hp;
    let hp2 = lobby.fighter2Hp;
    let round = lobby.round ?? 0;
    const recent = [...(lobby.recentRounds ?? [])];
    let outcome: FightOutcome | null = null;
    let applied = 0;
    const max1 = lobby.fighter1MaxHp;
    const max2 = lobby.fighter2MaxHp;
    // Mutating these in place persists cooldowns/buffs to the lobby row below.
    const state1 = lobby.fighter1AbilityState;
    const state2 = lobby.fighter2AbilityState;
    // Both corners fight through the shared round exchange: the arena
    // supplies the swing roll, the exchange owns the round order and the
    // damage pipeline.
    const fighter1 = duelFighter({
      id: "fighter1",
      self: snapshot1,
      opponent: snapshot2,
      hp: hp1,
      roundIntervalMs: interval,
      ...(state1 ? { abilityState: state1 } : {}),
    });
    const fighter2 = duelFighter({
      id: "fighter2",
      self: snapshot2,
      opponent: snapshot1,
      hp: hp2,
      roundIntervalMs: interval,
      ...(state2 ? { abilityState: state2 } : {}),
    });
    const sides: RoundSide[] = [
      { fighters: [fighter1] },
      { fighters: [fighter2] },
    ];
    for (let i = 0; i < dueRounds; i += 1) {
      round += 1;
      applied += 1;
      const exchange = runRoundExchange(sides, {
        round,
        roundIntervalMs: interval,
      });
      hp1 = exchange.hp.fighter1;
      hp2 = exchange.hp.fighter2;
      recent.push({
        round,
        damage1to2: exchange.damage.fighter1 ?? 0,
        damage2to1: exchange.damage.fighter2 ?? 0,
        crit1: exchange.crit.fighter1 ?? false,
        crit2: exchange.crit.fighter2 ?? false,
        fighter1Hp: hp1,
        fighter2Hp: hp2,
      });
      const verdict = resolveDuelVerdict({
        hpA: hp1,
        maxHpA: max1,
        hpB: hp2,
        maxHpB: max2,
        round,
        maxRounds,
      });
      if (verdict.type === "draw") {
        outcome = { type: "draw" };
        break;
      }
      if (verdict.type === "win") {
        outcome = {
          type: "win",
          winnerId:
            verdict.winner === 0 ? lobby.fighter1Id! : lobby.fighter2Id!,
          reason: verdict.reason,
        };
        break;
      }
    }
    await ctx.db.patch(lobby._id, {
      fighter1Hp: hp1,
      fighter2Hp: hp2,
      round,
      lastRoundAt: (lobby.lastRoundAt ?? now) + applied * interval,
      recentRounds: recent.slice(-MAX_RECENT_ROUNDS),
      ...(state1 ? { fighter1AbilityState: state1 } : {}),
      ...(state2 ? { fighter2AbilityState: state2 } : {}),
      updatedAt: now,
    });
    if (outcome) {
      const config = await readArenaConfig(ctx);
      const settled = (await ctx.db.get(lobby._id))!;
      await settleFight(ctx, settled, outcome, config.taxPercent, now);
    }
    return {
      ...(await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!)),
      advanced: applied,
      changed: true as const,
      started: false as const,
    };
  },
});

/** Active fighter concedes; the opponent takes the pot minus tax. */
export const forfeitFight = mutation({
  args: {
    playerId: v.id("players"),
    lobbyId: v.id("arenaLobbies"),
  },
  handler: async (ctx, { playerId, lobbyId }) => {
    await requirePlayerOwner(ctx, playerId);
    const lobby = await ctx.db.get(lobbyId);
    if (!lobby) throw new Error("Arena lobby not found");
    if (lobby.status !== "active") {
      throw new Error("That fight is not active");
    }
    if (!isFighter(lobby, playerId)) {
      throw new Error("Only fighters can forfeit");
    }
    const opponentId =
      lobby.fighter1Id === playerId ? lobby.fighter2Id : lobby.fighter1Id;
    if (!opponentId) throw new Error("Arena fight has no opponent");
    const config = await readArenaConfig(ctx);
    await settleFight(
      ctx,
      lobby,
      { type: "win", winnerId: opponentId, reason: "forfeit" },
      config.taxPercent,
      Date.now()
    );
    return await toPublicLobby(ctx, (await ctx.db.get(lobbyId))!);
  },
});

/** Hourly sweep for lobbies nobody touches anymore; stakes are refunded. */
export const expireStaleLobbies = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [waiting, active] = await Promise.all([
      ctx.db
        .query("arenaLobbies")
        .withIndex("by_status", (q) => q.eq("status", "waiting"))
        .take(200),
      ctx.db
        .query("arenaLobbies")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .take(200),
    ]);
    let expired = 0;
    for (const lobby of [...waiting, ...active]) {
      if (now > lobby.expiresAt) {
        await refundStakes(ctx, lobby);
        await ctx.db.patch(lobby._id, {
          status: "expired",
          endedAt: now,
          updatedAt: now,
        });
        expired += 1;
      }
    }
    return { expired };
  },
});

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getPvpConfig = query({
  args: {},
  handler: async (ctx) => {
    const config = await readArenaConfig(ctx);
    return {
      minLevel: config.minLevel,
      roundIntervalMs: config.roundIntervalMs,
      maxRounds: config.maxRounds,
      taxPercent: config.taxPercent,
      minStake: config.minStake,
      maxStake: config.maxStake,
      countdownMs: config.countdownMs,
    };
  },
});

export const getOpenLobbies = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayerOwner(ctx, playerId);
    const now = Date.now();
    const [general, privateLobbies] = await Promise.all([
      ctx.db
        .query("arenaLobbies")
        .withIndex("by_status_and_visibility", (q) =>
          q.eq("status", "waiting").eq("visibility", "general")
        )
        .take(OPEN_LIST_LIMIT),
      ctx.db
        .query("arenaLobbies")
        .withIndex("by_status_and_visibility", (q) =>
          q.eq("status", "waiting").eq("visibility", "private")
        )
        .take(OPEN_LIST_LIMIT),
    ]);
    const open = [...general, ...privateLobbies]
      .filter((lobby) => now <= lobby.expiresAt)
      .sort((a, b) => b.createdAt - a.createdAt);
    return await Promise.all(open.map((lobby) => toPublicLobby(ctx, lobby)));
  },
});

export const getLobby = query({
  args: {
    playerId: v.id("players"),
    lobbyId: v.id("arenaLobbies"),
  },
  handler: async (ctx, { playerId, lobbyId }) => {
    await requirePlayerOwner(ctx, playerId);
    const lobby = await ctx.db.get(lobbyId);
    if (!lobby) return null;
    return await toPublicLobby(ctx, lobby);
  },
});

export const getMyLobby = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayerOwner(ctx, playerId);
    const found = await findMyLobby(ctx, playerId);
    if (!found) return null;
    return { ...(await toPublicLobby(ctx, found.lobby)), role: found.role };
  },
});

export const getRecentResults = query({
  args: {
    playerId: v.id("players"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { playerId, limit }) => {
    await requirePlayerOwner(ctx, playerId);
    const capped =
      typeof limit === "number" && Number.isSafeInteger(limit)
        ? Math.min(Math.max(limit, 1), 50)
        : 20;
    const completed = await ctx.db
      .query("arenaLobbies")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .order("desc")
      .take(capped);
    return await Promise.all(completed.map((lobby) => toPublicLobby(ctx, lobby)));
  },
});
