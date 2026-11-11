import { mutation, query } from "./_generated/server";
import { requirePlayer, requirePlayerRead, requirePlayerOwner } from "./playerAuth";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { settleCombatFight } from "./loot";
import { combatZoneValidator } from "./zones";

const rateLimiter = new RateLimiter(components.rateLimiter, {});

/**
 * Get all upgrades owned by a player
 */
export const getPlayerUpgrades = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    await requirePlayerOwner(ctx, playerId);
    return await ctx.db
      .query("playerUpgrades")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect();
  },
});

/**
 * Check if player owns an upgrade
 */
export const hasUpgrade = query({
  args: {
    playerId: v.id("players"),
    upgradeId: v.string(),
  },
  handler: async (ctx, { playerId, upgradeId }) => {
    await requirePlayerOwner(ctx, playerId);
    const upgrades = await ctx.db
      .query("playerUpgrades")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect();

    return upgrades.some((u) => u.upgradeId === upgradeId);
  },
});

/**
 * Internal: apply upgrade effect to player
 */
async function applyUpgradeEffect(
  ctx: MutationCtx,
  playerId: Id<"players">,
  upgrade: Doc<"upgrades">
) {
  if (upgrade.effectType !== "stat-boost" || !upgrade.effectStat || !upgrade.effectAmount) return;
  const stat = upgrade.effectStat as "str" | "dex" | "int" | "luk" | "con" | "agi";
  const player = await ctx.db.get(playerId);
  if (!player) return;
  await ctx.db.patch(playerId, {
    [stat]: (player[stat] || 5) + upgrade.effectAmount,
    lastUpdated: Date.now(),
  });
}

/**
 * Record a fight in history and aggregate
 */
export const recordFight = mutation({
  args: {
    playerId: v.id("players"),
    monsterTier: v.number(),
    monsterType: v.string(),
    isBoss: v.boolean(),
    won: v.boolean(),
    monsterZone: v.optional(combatZoneValidator),
    goldEarned: v.optional(v.number()),
    experienceEarned: v.optional(v.number()),
    settlementKey: v.optional(v.string()),
    sessionId: v.optional(v.id("bossSessions")),
  },
  handler: async (ctx, {
    playerId,
    monsterTier,
    monsterType,
    isBoss,
    won,
    settlementKey,
    sessionId,
  }) => {
    if (!isBoss) {
      throw new Error("Regular fights must use the auto-battle queue");
    }
    const player = await requirePlayer(ctx, playerId);
    if (!Number.isSafeInteger(monsterTier) || monsterTier < 1) {
      throw new Error("Fight tier must be a positive integer");
    }
    // No skipping ahead: boss tier N requires proven progress through N-1.
    const provenMax = player.maxTierReached ?? player.currentTier ?? 1;
    if (monsterTier > provenMax + 1) {
      throw new Error("That boss tier is not unlocked yet");
    }
    if (settlementKey?.trim() && !settlementKey.startsWith(`${playerId}:`)) {
      throw new Error("Fight settlement key must belong to the player");
    }
    const fightStatus = await rateLimiter.limit(ctx, "bossFight", {
      key: playerId,
      config: { kind: "token bucket", rate: 1, period: 10_000, capacity: 3 },
    });
    if (!fightStatus.ok) {
      throw new Error("Boss challenges are settling too fast. Wait a moment.");
    }

    if (won) {
      // Victories are minted only by server-run strikes. A forged won:true
      // without a server-killed session settles nothing.
      if (!sessionId) {
        throw new Error("Boss victories must come from strikeBoss. Reload to update.");
      }
      const session = await ctx.db.get(sessionId);
      if (!session || session.playerId !== playerId) {
        throw new Error("Boss session not found");
      }
      if (session.status !== "won") {
        throw new Error("That boss has not been defeated yet.");
      }
      if (session.bossId !== monsterType || session.tier !== monsterTier) {
        throw new Error("Boss session does not match this fight.");
      }
      const recorded = await ctx.db
        .query("fightHistory")
        .withIndex("by_settlementKey", (q) =>
          q.eq("settlementKey", session.settlementKey)
        )
        .first();
      if (!recorded) {
        throw new Error("Boss victory was not settled by the server.");
      }
      return {
        recorded: true,
        duplicate: true,
        goldEarned: recorded.goldEarned,
        experienceEarned: recorded.experienceEarned,
        loot: [],
      };
    }

    const key =
      settlementKey?.trim() ||
      `${playerId}:boss:${monsterType}:${monsterTier}:${Date.now()}`;

    const boss = await ctx.db
      .query("bosses")
      .withIndex("by_bossId", (q) => q.eq("bossId", monsterType))
      .first();
    if (!boss || boss.tier !== monsterTier) {
      throw new Error("Boss not found for this tier");
    }

    return await settleCombatFight(ctx, {
      playerId,
      settlementKey: key,
      sourceType: "boss",
      sourceId: monsterType,
      tier: monsterTier,
      won,
    });
  },
});

/**
 * Claim reward from hidden spot
 */
export const claimHiddenSpotReward = mutation({
  args: {
    playerId: v.id("players"),
    upgradeId: v.string(),
    spotId: v.string(),
  },
  handler: async (ctx, { playerId, upgradeId, spotId }) => {
    await requirePlayerOwner(ctx, playerId);

    // The spot must exist and actually grant the claimed upgrade. Never trust
    // the upgradeId alone: without this check any caller can mint any upgrade.
    const spot = await ctx.db
      .query("hiddenSpots")
      .withIndex("by_spotId", (q) => q.eq("spotId", spotId))
      .first();
    if (!spot) throw new Error("Hidden spot not found");
    if (spot.rewardUpgradeId !== upgradeId) {
      throw new Error("That spot does not grant that reward");
    }

    const upgrade = await ctx.db
      .query("upgrades")
      .withIndex("by_upgradeId", (q) => q.eq("upgradeId", upgradeId))
      .first();
    if (!upgrade) throw new Error("Upgrade not found");

    // Check if this spot was already claimed
    const playerUpgrades = await ctx.db
      .query("playerUpgrades")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .collect();

    const claimed = playerUpgrades.find(
      (u) => u.upgradeId === upgradeId && u.quantity && u.quantity > 0
    );

    if (claimed) {
      throw new Error("Spot already claimed");
    }

    // Record the claim
    await ctx.db.insert("playerUpgrades", {
      playerId,
      upgradeId,
      quantity: 1,
      purchasedAt: Date.now(),
    });

    // Apply the upgrade effect directly
    await applyUpgradeEffect(ctx, playerId, upgrade);

    return { success: true, upgrade };
  },
});
