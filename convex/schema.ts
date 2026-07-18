import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  players: defineTable({
    anonymousId: v.string(),
    name: v.string(),
    // Base stats
    str: v.number(),
    dex: v.number(),
    int: v.number(),
    luk: v.number(),
    con: v.number(),
    // Progression
    gold: v.number(),
    totalExperience: v.number(),
    rebirthCount: v.number(),
    rebirthTierThreshold: v.number(), // e.g., 3, 5, 8, 12 - which tier unlocks next rebirth
    currentTier: v.number(),
    currentTierProgression: v.number(), // 0, 1, or 2 (which monster in tier)
    // Upgrades
    autoAttackEnabled: v.boolean(),
    autoStartFightEnabled: v.boolean(),
    // Metadata
    createdAt: v.number(),
    lastUpdated: v.number(),
  })
    .index("by_anonymousId", ["anonymousId"])
    .index("by_createdAt", ["createdAt"]),

  playerUpgrades: defineTable({
    playerId: v.id("players"),
    upgradeId: v.string(),
    quantity: v.number(),
    purchasedAt: v.number(),
  }).index("by_playerId", ["playerId"]),

  fightHistory: defineTable({
    playerId: v.id("players"),
    monsterTier: v.number(),
    monsterType: v.string(),
    won: v.boolean(),
    goldEarned: v.number(),
    experienceEarned: v.number(),
    timestamp: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_timestamp", ["playerId", "timestamp"]),
});
