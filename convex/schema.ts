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
    rebirthTierThreshold: v.number(), // e.g., 5, 10, 15 - which tier unlocks next rebirth
    currentTier: v.number(), // Which tier player is currently fighting in (1+)
    maxTierReached: v.optional(v.number()), // Highest tier player has beaten — optional during migration
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

  monsters: defineTable({
    type: v.string(), // "rat", "goblin", etc.
    name: v.string(),
    // Base stats for a tier-1 monster
    str: v.number(),
    dex: v.number(),
    int: v.number(),
    luk: v.number(),
    con: v.number(),
    // Rewards
    goldDrop: v.number(),
    experienceReward: v.number(),
    // Combat
    baseMsPerAttack: v.number(),
    // Difficulty weighting (0-100, lower = more common)
    strength: v.number(),
    // Metadata
    createdAt: v.number(),
  }).index("by_type", ["type"]),

  upgrades: defineTable({
    upgradeId: v.string(), // "str_boost_1", etc.
    name: v.string(),
    category: v.string(), // "stat-boost", "weapon", "armor", "auto", "special"
    cost: v.number(),
    description: v.string(),
    // Effect payload (JSON-like structure)
    effectType: v.string(), // "stat-boost", "enable-auto-attack", "enable-auto-start-fight", "special"
    effectStat: v.optional(v.string()), // "str", "dex", etc. if applicable
    effectAmount: v.optional(v.number()),
    // Prerequisites
    minTier: v.optional(v.number()),
    minLevel: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_upgradeId", ["upgradeId"]),

  gameBalance: defineTable({
    // Key-value store for global balance constants
    key: v.string(), // "tierScaleMultiplier", "maxTier", "rebirthThresholds", etc.
    value: v.any(), // number, array, object, etc.
    description: v.string(),
    lastUpdated: v.number(),
  }).index("by_key", ["key"]),

  hiddenSpots: defineTable({
    spotId: v.string(),
    x: v.number(), // percentage from left
    y: v.number(), // percentage from top
    rewardUpgradeId: v.string(), // which upgrade they unlock
    radius: v.number(), // click radius in pixels
    createdAt: v.number(),
  }).index("by_spotId", ["spotId"]),

  // Phase 3: Achievements
  achievements: defineTable({
    achievementId: v.string(),
    name: v.string(),
    description: v.string(),
    icon: v.optional(v.string()),
    condition: v.string(),
    createdAt: v.number(),
  }).index("by_achievementId", ["achievementId"]),

  playerAchievements: defineTable({
    playerId: v.id("players"),
    achievementId: v.string(),
    unlockedAt: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_achievementId", ["playerId", "achievementId"]),

  // Phase 4: Rebirth rewards
  rebirthRewards: defineTable({
    rebirthLevel: v.number(),
    name: v.string(),
    description: v.string(),
    effectType: v.string(),
    effectValue: v.optional(v.number()),
    effectData: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_rebirthLevel", ["rebirthLevel"]),

  playerRebirthRewards: defineTable({
    playerId: v.id("players"),
    rebirthLevel: v.number(),
    isActive: v.boolean(),
    activatedAt: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_level", ["playerId", "rebirthLevel"]),

  // Phase 5: Events
  gameEvents: defineTable({
    eventId: v.string(),
    name: v.string(),
    description: v.string(),
    startTime: v.number(),
    endTime: v.number(),
    effectType: v.string(),
    effectValue: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_isActive", ["isActive"])
    .index("by_eventId", ["eventId"]),

  // Leaderboards
  leaderboardByExperience: defineTable({
    playerId: v.id("players"),
    playerName: v.string(),
    totalExperience: v.number(),
    lastUpdated: v.number(),
  }).index("by_totalExperience", ["totalExperience"]),

  leaderboardByTier: defineTable({
    playerId: v.id("players"),
    playerName: v.string(),
    maxTierReached: v.number(),
    lastUpdated: v.number(),
  }).index("by_maxTierReached", ["maxTierReached"]),

  leaderboardByRebirth: defineTable({
    playerId: v.id("players"),
    playerName: v.string(),
    rebirthCount: v.number(),
    lastUpdated: v.number(),
  }).index("by_rebirthCount", ["rebirthCount"]),
});
