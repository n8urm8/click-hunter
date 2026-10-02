import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { combatZoneValidator } from "./zones";
import { battleEncounterValidator } from "./taskTiming";
import {
  EQUIPMENT_SLOT_VALUES,
  ITEM_EFFECT_STAT_VALUES,
  ITEM_CATEGORY_VALUES,
} from "./itemTypes";

const itemCategoryValidator = v.union(
  ...ITEM_CATEGORY_VALUES.map((value) => v.literal(value))
);
const equipmentSlotValidator = v.union(
  ...EQUIPMENT_SLOT_VALUES.map((value) => v.literal(value))
);
const itemEffectStatValidator = v.union(
  ...ITEM_EFFECT_STAT_VALUES.map((value) => v.literal(value))
);
const damageStatValidator = v.union(
  v.literal("str"),
  v.literal("dex"),
  v.literal("int")
);
const damageTypeValidator = v.union(
  v.literal("physical"),
  v.literal("magical")
);
const buffVariantValidator = v.union(
  v.literal("base"),
  v.literal("advanced")
);
const skillBonusScopeValidator = v.union(
  v.literal("all"),
  v.literal("gathering"),
  v.literal("crafting")
);
const skillTaskEffectTypeValidator = v.union(
  v.literal("skill-speed-multiplier"),
  v.literal("skill-xp-multiplier")
);
const skillCategoryValidator = v.union(
  v.literal("gathering"),
  v.literal("crafting")
);
const lootSourceTypeValidator = v.union(
  v.literal("monster"),
  v.literal("boss")
);
const pendingRewardSourceTypeValidator = v.union(
  v.literal("monster"),
  v.literal("boss"),
  v.literal("skill"),
  v.literal("crafting")
);
const lootPurposeValidator = v.union(
  v.literal("augmentation"),
  v.literal("boss-catalyst")
);
const passiveBranchValidator = v.union(
  v.literal("sword"),
  v.literal("dagger"),
  v.literal("mace"),
  v.literal("bow"),
  v.literal("staff"),
  v.literal("skilling"),
  v.literal("elemental")
);

export default defineSchema({
  players: defineTable({
    anonymousId: v.string(),
    name: v.string(),
    // Bound Convex Auth subject (stable per browser, anonymous sign-in).
    // All mutations verify the caller's identity matches this subject.
    // Unset only for rows created before auth; claimed on first authed use.
    authSubject: v.optional(v.string()),
    // Temporary role flag until authenticated Convex identities are wired in.
    role: v.optional(v.union(v.literal("admin"), v.literal("player"))),
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
    // Combat stat experience pools (floats); leveled with the skill XP curve.
    statXp: v.optional(
      v.object({
        str: v.number(),
        dex: v.number(),
        int: v.number(),
        luk: v.number(),
        con: v.number(),
      })
    ),
    // Chosen starter weapon ID (reselectable at each rebirth).
    starterWeapon: v.optional(v.string()),
    // True when the player must pick a starter kit (creation/rebirth flow).
    pendingStarterPick: v.optional(v.boolean()),
    // Metadata
    createdAt: v.number(),
    lastUpdated: v.number(),
  })
    .index("by_anonymousId", ["anonymousId"])
    .index("by_authSubject", ["authSubject"])
    .index("by_createdAt", ["createdAt"]),

  playerUpgrades: defineTable({
    playerId: v.id("players"),
    upgradeId: v.string(),
    quantity: v.number(),
    // Paid stat purchases only; hidden-spot rewards leave this at zero.
    purchaseCount: v.optional(v.number()),
    purchasedAt: v.number(),
  }).index("by_playerId", ["playerId"]),

  itemRarities: defineTable({
    level: v.number(),
    name: v.string(),
    color: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_level", ["level"]),

  items: defineTable({
    itemId: v.string(),
    name: v.string(),
    category: itemCategoryValidator,
    description: v.string(),
    stackable: v.boolean(),
    maxStackSize: v.number(),
    allowedEquipmentSlots: v.array(equipmentSlotValidator),
    // Optional until migrations backfill existing item definitions.
    rarityLevel: v.optional(v.number()),
    itemFamily: v.optional(v.string()),
    craftingSkillId: v.optional(v.string()),
    craftingTier: v.optional(v.number()),
    effectType: v.optional(v.string()),
    effectStat: v.optional(itemEffectStatValidator),
    effectAmount: v.optional(v.number()),
    effectScope: v.optional(skillBonusScopeValidator),
    // Weapon combat fields (mainHand equipment only).
    baseDamage: v.optional(v.number()),
    attackSpeed: v.optional(v.number()),
    damageStat: v.optional(damageStatValidator),
    damageType: v.optional(damageTypeValidator),
    // Elemental damage tag (mainHand weapons only). Tags the weapon's base
    // damage with an element so elemental passive bonuses can scale it.
    element: v.optional(v.string()),
    // Armor combat fields (head/chest/legs/feet equipment only).
    baseDefense: v.optional(v.number()),
    speedPenalty: v.optional(v.number()),
    // Consumable buff variant (base/advanced pairing).
    buffVariant: v.optional(buffVariantValidator),
    // Metadata for future temporary effects; item consumption is intentionally
    // handled separately from this content model.
    effectDurationMs: v.optional(v.number()),
    augmentSlots: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_itemId", ["itemId"])
    .index("by_category", ["category"])
    .index("by_rarityLevel", ["rarityLevel"]),

  playerItems: defineTable({
    playerId: v.id("players"),
    itemId: v.id("items"),
    quantity: v.number(),
    equippedSlot: v.optional(equipmentSlotValidator),
    acquiredAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_and_itemId", ["playerId", "itemId"])
    .index("by_playerId_and_equippedSlot", ["playerId", "equippedSlot"]),

  playerSkillBoosts: defineTable({
    playerId: v.id("players"),
    effectType: skillTaskEffectTypeValidator,
    effectScope: skillBonusScopeValidator,
    effectAmount: v.number(),
    sourceItemId: v.id("items"),
    startedAt: v.number(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_and_effectType_and_effectScope", [
      "playerId",
      "effectType",
      "effectScope",
    ]),

  playerCombatBoosts: defineTable({
    playerId: v.id("players"),
    effectType: v.string(),
    effectStat: v.optional(itemEffectStatValidator),
    variant: v.optional(buffVariantValidator),
    effectAmount: v.number(),
    sourceItemId: v.id("items"),
    startedAt: v.number(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_and_effectType", ["playerId", "effectType"]),

  skillDefinitions: defineTable({
    skillId: v.string(),
    name: v.string(),
    category: skillCategoryValidator,
    pairedSkillId: v.optional(v.string()),
    description: v.string(),
    enabled: v.boolean(),
    // Undefined means uncapped (open-ended leveling).
    maxLevel: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_skillId", ["skillId"])
    .index("by_category", ["category"])
    .index("by_enabled", ["enabled"]),

  skillTierDefinitions: defineTable({
    skillId: v.string(),
    tier: v.number(),
    name: v.string(),
    description: v.string(),
    requiredLevel: v.number(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_skillId", ["skillId"])
    .index("by_skillId_and_tier", ["skillId", "tier"])
    .index("by_enabled", ["enabled"]),

  playerSkills: defineTable({
    playerId: v.id("players"),
    skillId: v.string(),
    level: v.number(),
    experience: v.number(),
    totalExperience: v.number(),
    actionsCompleted: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_and_skillId", ["playerId", "skillId"])
    .index("by_skillId", ["skillId"]),

  gatheringActivities: defineTable({
    activityId: v.string(),
    skillId: v.string(),
    tier: v.number(),
    name: v.string(),
    description: v.string(),
    outputItemId: v.id("items"),
    minYield: v.number(),
    maxYield: v.number(),
    durationMs: v.optional(v.number()),
    experienceReward: v.number(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_activityId", ["activityId"])
    .index("by_skillId_and_tier", ["skillId", "tier"])
    .index("by_enabled", ["enabled"]),

  recipes: defineTable({
    recipeId: v.string(),
    skillId: v.string(),
    tier: v.number(),
    name: v.string(),
    description: v.string(),
    durationMs: v.optional(v.number()),
    experienceReward: v.number(),
    outputFamily: v.optional(v.string()),
    stage: v.optional(
      v.union(
        v.literal("refinement"),
        v.literal("product"),
        v.literal("consumable")
      )
    ),
    requiresMonsterDrop: v.optional(v.boolean()),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_recipeId", ["recipeId"])
    .index("by_skillId_and_tier", ["skillId", "tier"])
    .index("by_enabled", ["enabled"]),

  recipeIngredients: defineTable({
    recipeId: v.string(),
    itemId: v.id("items"),
    quantity: v.number(),
  })
    .index("by_recipeId", ["recipeId"])
    .index("by_recipeId_and_itemId", ["recipeId", "itemId"]),

  recipeOutputs: defineTable({
    recipeId: v.string(),
    itemId: v.id("items"),
    quantity: v.number(),
  })
    .index("by_recipeId", ["recipeId"])
    .index("by_recipeId_and_itemId", ["recipeId", "itemId"]),

  augmentationDefinitions: defineTable({
    augmentationId: v.string(),
    skillId: v.string(),
    tier: v.number(),
    name: v.string(),
    description: v.string(),
    baseItemFamily: v.optional(v.string()),
    allowedEquipmentSlots: v.array(equipmentSlotValidator),
    requiredMaterialItemId: v.id("items"),
    requiredMaterialQuantity: v.number(),
    bossCatalystItemId: v.optional(v.id("items")),
    bossCatalystQuantity: v.optional(v.number()),
    effectType: v.string(),
    effectStat: v.optional(itemEffectStatValidator),
    effectAmount: v.number(),
    experienceReward: v.optional(v.number()),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_augmentationId", ["augmentationId"])
    .index("by_skillId_and_tier", ["skillId", "tier"])
    .index("by_enabled", ["enabled"]),

  playerItemAugments: defineTable({
    playerId: v.id("players"),
    playerItemId: v.id("playerItems"),
    augmentationId: v.string(),
    name: v.string(),
    effectType: v.string(),
    effectStat: v.optional(itemEffectStatValidator),
    effectAmount: v.number(),
    appliedAt: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerItemId", ["playerItemId"])
    .index("by_playerItemId_and_augmentationId", [
      "playerItemId",
      "augmentationId",
    ]),

  skillActionHistory: defineTable({
    playerId: v.id("players"),
    taskId: v.optional(v.id("playerTasks")),
    actionType: v.union(
      v.literal("gathering"),
      v.literal("crafting"),
      v.literal("augmentation")
    ),
    actionId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    completionKey: v.string(),
    result: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_playerId_and_createdAt", ["playerId", "createdAt"])
    .index("by_completionKey", ["completionKey"])
    .index("by_taskId", ["taskId"]),

  lootTables: defineTable({
    lootTableId: v.string(),
    name: v.string(),
    sourceType: lootSourceTypeValidator,
    tier: v.optional(v.number()),
    rollCount: v.number(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_lootTableId", ["lootTableId"])
    .index("by_sourceType_and_tier", ["sourceType", "tier"])
    .index("by_enabled", ["enabled"]),

  lootTableEntries: defineTable({
    lootTableId: v.string(),
    itemId: v.id("items"),
    weight: v.number(),
    dropChance: v.number(),
    minQuantity: v.number(),
    maxQuantity: v.number(),
    guaranteed: v.boolean(),
    purpose: lootPurposeValidator,
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_lootTableId", ["lootTableId"])
    .index("by_lootTableId_and_itemId", ["lootTableId", "itemId"])
    .index("by_enabled", ["enabled"]),

  lootSources: defineTable({
    sourceType: lootSourceTypeValidator,
    sourceId: v.string(),
    tier: v.optional(v.number()),
    lootTableId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sourceType_and_sourceId", ["sourceType", "sourceId"])
    .index("by_sourceType_and_sourceId_and_tier", [
      "sourceType",
      "sourceId",
      "tier",
    ])
    .index("by_lootTableId", ["lootTableId"]),

  lootAwards: defineTable({
    playerId: v.id("players"),
    settlementKey: v.string(),
    sourceType: lootSourceTypeValidator,
    sourceId: v.string(),
    tier: v.number(),
    itemId: v.id("items"),
    quantity: v.number(),
    purpose: v.optional(lootPurposeValidator),
    status: v.union(v.literal("granted"), v.literal("pending")),
    createdAt: v.number(),
  })
    .index("by_settlementKey", ["settlementKey"])
    .index("by_playerId_and_createdAt", ["playerId", "createdAt"])
    .index("by_playerId_and_status", ["playerId", "status"]),

  pendingRewards: defineTable({
    playerId: v.id("players"),
    itemId: v.id("items"),
    quantity: v.number(),
    sourceType: pendingRewardSourceTypeValidator,
    sourceId: v.string(),
    settlementKey: v.string(),
    status: v.union(v.literal("pending"), v.literal("claimed")),
    createdAt: v.number(),
    claimedAt: v.optional(v.number()),
  })
    .index("by_playerId_and_status", ["playerId", "status"])
    .index("by_settlementKey", ["settlementKey"]),

  taskDefinitions: defineTable({
    taskId: v.string(),
    name: v.string(),
    category: v.string(),
    description: v.string(),
    durationMs: v.optional(v.number()),
    canProgressOffline: v.boolean(),
    requiresOnline: v.boolean(),
    enabled: v.boolean(),
    prerequisites: v.optional(v.any()),
    rewards: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_taskId", ["taskId"])
    .index("by_category", ["category"])
    .index("by_enabled", ["enabled"]),

  playerTasks: defineTable({
    playerId: v.id("players"),
    taskType: v.union(v.literal("timed"), v.literal("battle")),
    definitionId: v.string(),
    displayName: v.string(),
    status: v.union(v.literal("queued"), v.literal("active")),
    queueOrder: v.number(),
    canProgressOffline: v.boolean(),
    requiresOnline: v.boolean(),
    durationMs: v.optional(v.number()),
    progressMs: v.number(),
    battleMode: v.optional(
      v.union(
        v.literal("count"),
        v.literal("duration"),
        v.literal("until-stopped")
      )
    ),
    targetBattles: v.optional(v.number()),
    targetDurationMs: v.optional(v.number()),
    completedBattles: v.number(),
    currentMonsterName: v.optional(v.string()),
    currentMonsterType: v.optional(v.string()),
    currentMonsterHealth: v.optional(v.number()),
    currentMonsterMaxHealth: v.optional(v.number()),
    currentPlayerHealth: v.optional(v.number()),
    currentPlayerMaxHealth: v.optional(v.number()),
    totalGoldEarned: v.optional(v.number()),
    totalExperienceEarned: v.optional(v.number()),
    lootSummary: v.optional(v.any()),
    tier: v.optional(v.number()),
    // Combat zone the battle task hunts in. Absent on tasks queued before
    // zones existed, which fall back to the full monster pool.
    zone: v.optional(combatZoneValidator),
    onlineCreditMs: v.number(),
    battleEncounter: v.optional(battleEncounterValidator),
    lastResolvedAt: v.number(),
    lastHeartbeatAt: v.number(),
    respawnUntil: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    offlineCapped: v.boolean(),
    payload: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_playerId_and_queueOrder", ["playerId", "queueOrder"])
    .index("by_playerId_and_status", ["playerId", "status"])
    .index("by_playerId_and_status_and_queueOrder", [
      "playerId",
      "status",
      "queueOrder",
    ]),

  taskPresence: defineTable({
    playerId: v.id("players"),
    taskId: v.id("playerTasks"),
    segmentStartedAt: v.number(),
    lastSeenAt: v.number(),
  }).index("by_playerId", ["playerId"]),

  taskBattleStats: defineTable({
    playerId: v.id("players"),
    taskId: v.id("playerTasks"),
    monsterType: v.string(),
    monsterName: v.string(),
    defeatedCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_taskId", ["taskId"])
    .index("by_taskId_and_monsterType", ["taskId", "monsterType"])
    .index("by_playerId_and_taskId", ["playerId", "taskId"]),

  taskHistory: defineTable({
    playerId: v.id("players"),
    taskId: v.id("playerTasks"),
    definitionId: v.string(),
    displayName: v.string(),
    taskType: v.union(v.literal("timed"), v.literal("battle")),
    status: v.union(
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("failed")
    ),
    completionKey: v.string(),
    durationMs: v.optional(v.number()),
    progressMs: v.number(),
    completedBattles: v.number(),
    totalGoldEarned: v.optional(v.number()),
    totalExperienceEarned: v.optional(v.number()),
    lootSummary: v.optional(v.any()),
    tier: v.optional(v.number()),
    zone: v.optional(combatZoneValidator),
    result: v.optional(v.any()),
    createdAt: v.number(),
    completedAt: v.number(),
  })
    .index("by_playerId_and_completedAt", ["playerId", "completedAt"])
    .index("by_taskId", ["taskId"])
    .index("by_completionKey", ["completionKey"]),

  fightHistory: defineTable({
    playerId: v.id("players"),
    settlementKey: v.optional(v.string()),
    monsterTier: v.number(),
    monsterType: v.string(),
    won: v.boolean(),
    // Optional so existing fight history remains valid after boss battles are added.
    isBoss: v.optional(v.boolean()),
    // Optional so rows recorded before zones existed remain valid.
    monsterZone: v.optional(combatZoneValidator),
    goldEarned: v.number(),
    experienceEarned: v.number(),
    timestamp: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_timestamp", ["playerId", "timestamp"])
    .index("by_settlementKey", ["settlementKey"]),

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
  })
    .index("by_type", ["type"])
    .index("by_strength", ["strength"]),

  bosses: defineTable({
    bossId: v.string(),
    tier: v.number(),
    name: v.string(),
    // Stats are generated from the strongest regular monster and tier-scaled.
    str: v.number(),
    dex: v.number(),
    int: v.number(),
    luk: v.number(),
    con: v.number(),
    // Optional migration marker for bosses created before tier-scaled stats.
    statsTierScaled: v.optional(v.boolean()),
    rewardMultiplier: v.number(),
    createdAt: v.number(),
  })
    .index("by_bossId", ["bossId"])
    .index("by_tier", ["tier"])
    .index("by_name", ["name"]),

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
    effectScope: v.optional(skillBonusScopeValidator),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_isActive", ["isActive"])
    .index("by_startTime", ["startTime"])
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

  // Extensible channel-based chat. World and private channels are supported
  // now; future channels can use the same shape with their own membership
  // checks in the chat functions.
  chatMessages: defineTable({
    channelType: v.string(),
    channelId: v.string(),
    senderId: v.optional(v.id("players")),
    senderName: v.string(),
    recipientId: v.optional(v.id("players")),
    recipientName: v.optional(v.string()),
    content: v.string(),
    createdAt: v.number(),
    seedId: v.optional(v.string()),
  })
    .index("by_channel_createdAt", ["channelType", "channelId", "createdAt"])
    .index("by_senderId_createdAt", ["senderId", "createdAt"])
    .index("by_recipientId_createdAt", ["recipientId", "createdAt"])
    .index("by_seedId", ["seedId"]),

  chatReadReceipts: defineTable({
    playerId: v.id("players"),
    channelId: v.string(),
    lastReadAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_channelId", ["playerId", "channelId"]),

  // Bazaar order book. Sell orders escrow the listed items (removed from the
  // seller's inventory while the order is open); buy orders escrow gold
  // (escrowedGold). A 5% tax (bazaarTaxPercent, balance-configured) is
  // deducted from the seller's proceeds on every fill and burned.
  marketOrders: defineTable({
    playerId: v.id("players"),
    side: v.union(v.literal("sell"), v.literal("buy")),
    itemId: v.id("items"),
    // Remaining quantity. Always 1 for non-stackable (equipment) sells.
    quantity: v.number(),
    originalQuantity: v.number(),
    // Gold per unit the maker accepts; fills execute at the maker's price.
    unitPrice: v.number(),
    status: v.union(
      v.literal("open"),
      v.literal("filled"),
      v.literal("cancelled"),
      v.literal("expired")
    ),
    // Buy orders only: gold actually held in escrow. Decreases by the trade
    // total on each fill; fills at better prices leave more than
    // unitPrice * quantity, which is what a cancel refunds.
    escrowedGold: v.optional(v.number()),
    // Sell orders only: augment snapshot for the escrowed equipment item.
    // Re-applied to the row created for the buyer (or the seller on refund).
    escrowedAugments: v.optional(
      v.array(
        v.object({
          augmentationId: v.string(),
          name: v.string(),
          effectType: v.string(),
          effectStat: v.optional(itemEffectStatValidator),
          effectAmount: v.number(),
          appliedAt: v.number(),
        })
      )
    ),
    // Settlement history across all fills: gold the owner received (sell
    // side, net of tax) or spent (buy side, gross). Absent until first fill;
    // accumulates even if the order is later cancelled or expires.
    settledGold: v.optional(v.number()),
    // Tax deducted from the owner's proceeds. Sell-side rows only — buyers
    // pay gross and the tax is taken out of the seller's credit.
    taxPaid: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_and_status", ["playerId", "status"])
    .index("by_side_and_status_and_unitPrice", ["side", "status", "unitPrice"])
    .index("by_side_and_status_and_itemId_and_unitPrice", [
      "side",
      "status",
      "itemId",
      "unitPrice",
    ]),

  // PoE-like passive skill web. Tunable content lives in passiveNodes rows
  // (seeded, admin-editable); players unlock nodes with earned passive points.
  passiveNodes: defineTable({
    nodeId: v.string(),
    branch: passiveBranchValidator,
    name: v.string(),
    description: v.string(),
    effectType: v.string(),
    effectStat: v.optional(v.string()),
    effectScope: v.optional(skillBonusScopeValidator),
    // Element for elemental-damage-percent nodes (light/dark/water/fire/wind/earth).
    element: v.optional(v.string()),
    effectAmount: v.number(),
    requires: v.array(v.string()),
    // Alternative prerequisites: unlock when every `requires` is met AND at
    // least one `requiresAny` is met (when non-empty). Elemental bridge nodes
    // use this to hang off two weapon arms at once.
    requiresAny: v.optional(v.array(v.string())),
    positionX: v.number(),
    positionY: v.number(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_nodeId", ["nodeId"])
    .index("by_branch", ["branch"])
    .index("by_enabled", ["enabled"]),

  playerPassives: defineTable({
    playerId: v.id("players"),
    nodeId: v.string(),
    unlockedAt: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_and_nodeId", ["playerId", "nodeId"]),

  // Server-authoritative manual boss fights. The client renders HP bars and
  // sends intents (start/strike); all damage rolls and win/loss settlement
  // happen here, so a forged `won: true` can never mint rewards.
  bossSessions: defineTable({
    playerId: v.id("players"),
    bossId: v.string(),
    tier: v.number(),
    monsterHp: v.number(),
    monsterMaxHp: v.number(),
    monsterAttack: v.number(),
    monsterAttackSpeed: v.number(),
    playerHp: v.number(),
    playerMaxHp: v.number(),
    settlementKey: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("won"),
      v.literal("lost")
    ),
    strikes: v.number(),
    startedAt: v.number(),
    lastStrikeAt: v.number(),
  })
    .index("by_playerId_and_status", ["playerId", "status"])
    .index("by_settlementKey", ["settlementKey"]),

  ...authTables,
});
