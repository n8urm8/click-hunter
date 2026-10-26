import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { combatZoneValidator } from "./zones";
import { battleEncounterValidator } from "./taskTiming";
import { abilityCombatStateValidator } from "./abilityCombat";
import {
  EQUIPMENT_SLOT_VALUES,
  ITEM_EFFECT_STAT_VALUES,
  ITEM_CATEGORY_VALUES,
  WEAPON_TYPE_VALUES,
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
const weaponTypeValidator = v.union(
  ...WEAPON_TYPE_VALUES.map((value) => v.literal(value))
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

// Ability system validators
const abilityTypeValidator = v.union(
  v.literal("attack"),
  v.literal("heal"),
  v.literal("buff_offense"),
  v.literal("buff_defense"),
  v.literal("utility")
);
const abilityTargetValidator = v.union(
  v.literal("self"),
  v.literal("enemy"),
  v.literal("ally")
);
const abilityWeaponTypeValidator = v.union(
  v.literal("sword"),
  v.literal("dagger"),
  v.literal("mace"),
  v.literal("bow"),
  v.literal("staff"),
  v.literal("any")
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
const guildRoleValidator = v.union(
  v.literal("master"),
  v.literal("officer"),
  v.literal("member"),
  v.literal("recruit")
);
const guildApplicationTypeValidator = v.union(
  v.literal("invite"),
  v.literal("application")
);
const guildApplicationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("expired")
);
const guildRaidStatusValidator = v.union(
  v.literal("forming"),
  v.literal("active"),
  v.literal("completed"),
  v.literal("failed"),
  // Another lobby claimed this tier's kill first. The stopped lobby keeps
  // its damage for the leaderboard and still pays XP, but earns no stash.
  v.literal("superseded")
);
// Snapshot of one raider inside a raid lobby. Frozen at fight start so
// gear/level changes mid-fight can't move the result.
const guildRaidPartyMemberValidator = v.object({
  playerId: v.id("players"),
  playerName: v.string(),
  damageDealt: v.number(),
  hp: v.optional(v.number()),
  maxHp: v.optional(v.number()),
  defense: v.optional(v.number()),
  magicalDefense: v.optional(v.number()),
  ward: v.optional(v.number()),
  alive: v.optional(v.boolean()),
  attack: v.optional(v.number()),
  critChance: v.optional(v.number()),
  critMultiplier: v.optional(v.number()),
  // Frozen equipped-ability state (round-based cooldowns) for auto-cast
  // during raid ticks.
  abilityState: v.optional(abilityCombatStateValidator),
});
// Frozen raid tuning captured when a lobby begins. Hot auto-combat ticks read
// this off the row instead of re-scanning gameBalance on every poll.
const guildRaidTuningValidator = v.object({
  formationHours: v.number(),
  durationHours: v.number(),
  roundIntervalMs: v.number(),
  partySize: v.number(),
  powerMultiplier: v.number(),
  tailEvery: v.number(),
  tailMult: v.number(),
  breathEvery: v.number(),
  breathMult: v.number(),
  skinT1: v.number(),
  skinT2: v.number(),
  skinReduction: v.number(),
  skinDuration: v.number(),
  minDamage: v.number(),
  saturdayGate: v.number(),
  summonCost: v.number(),
  rewardGoldMult: v.number(),
  rewardXpMult: v.number(),
  bossGoldPerTier: v.number(),
  bossExperiencePerTier: v.number(),
});
const arenaLobbyVisibilityValidator = v.union(
  v.literal("general"),
  v.literal("private")
);
const arenaLobbyStatusValidator = v.union(
  v.literal("waiting"),
  v.literal("active"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("expired")
);
// Combat snapshot frozen at fight start. Damage rolls read only this, so
// gear/level changes mid-fight can't move the result. `handicap` is the
// reserved hook for future stat/gear balancing (always 1 until then).
const arenaFighterSnapshotValidator = v.object({
  maxHp: v.number(),
  attack: v.number(),
  defense: v.number(),
  magicalDefense: v.number(),
  critChance: v.number(),
  critDamageMultiplier: v.number(),
  damageType: v.string(),
  weaponElement: v.optional(v.string()),
  // Defender-side elemental ward against the opponent's weapon element.
  ward: v.number(),
  level: v.number(),
  handicap: v.number(),
});
// Bounded per-round log (capped server-side); spectators render the tail.
const arenaRoundValidator = v.object({
  round: v.number(),
  damage1to2: v.number(),
  damage2to1: v.number(),
  crit1: v.boolean(),
  crit2: v.boolean(),
  fighter1Hp: v.number(),
  fighter2Hp: v.number(),
});
// Corner gear frozen at fight start (same merged rows the snapshot math
// uses), so viewers see what actually fought even if loadouts change later.
const arenaFighterGearValidator = v.object({
  slot: equipmentSlotValidator,
  playerItemId: v.id("playerItems"),
  itemName: v.string(),
  itemSlug: v.string(),
  itemFamily: v.optional(v.string()),
  category: v.optional(v.string()),
  enchantLevel: v.optional(v.number()),
});

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
    wis: v.optional(v.number()), // Wisdom: 6th combat stat for abilities (optional for migration)
    // Progression
    gold: v.number(),
    totalExperience: v.number(),
    rebirthCount: v.number(),
    rebirthTierThreshold: v.number(), // e.g., 5, 10, 15 - which tier unlocks next rebirth
    currentTier: v.number(), // Which tier player is currently fighting in (1+)
    maxTierReached: v.optional(v.number()), // Highest tier player has beaten — optional during migration
    // Permanent rebirth bonuses: times each stat met the rebirth
    // requirement when a rebirth happened. Each point adds another
    // `rebirthStatBonusPercent` to that stat. Absent means zero.
    rebirthStatBonuses: v.optional(
      v.object({
        str: v.number(),
        dex: v.number(),
        int: v.number(),
        luk: v.number(),
        con: v.number(),
        wis: v.optional(v.number()),
      })
    ),
    // Permanent rebirth bonuses per skill, keyed by skillId. Each point
    // adds another `rebirthSkillBonusPercent` action speed to that skill.
    // Absent means zero.
    rebirthSkillBonuses: v.optional(v.record(v.string(), v.number())),
    // Permanent rebirth bonuses per ability, keyed by abilityId. Each point
    // adds another `rebirthAbilityBonusPercent` power/cooldown reduction to that ability.
    // Absent means zero.
    rebirthAbilityBonuses: v.optional(v.record(v.string(), v.number())),
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
        wis: v.optional(v.number()),
      })
    ),
    // Chosen starter weapon ID (reselectable at each rebirth).
    starterWeapon: v.optional(v.string()),
    // True when the player must pick a starter kit (creation/rebirth flow).
    pendingStarterPick: v.optional(v.boolean()),
    // Persistent HP between fights. Undefined means full (migration fallback).
    currentHp: v.optional(v.number()),
    currentHpUpdatedAt: v.optional(v.number()),
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
    // Main-hand weapon class (sword/dagger/mace/bow/staff). Gates which
    // abilities can be cast while this weapon is equipped.
    weaponType: v.optional(weaponTypeValidator),
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
    // Per-instance enchantment level (infusion). Absent means +0.
    enchantLevel: v.optional(v.number()),
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
    // Element imbued by damage-bonus augmentations (weapons).
    effectElement: v.optional(v.string()),
    effectAmount: v.number(),
    // Chained lines: applying tier N requires (and replaces) tier N-1
    // on the same item, and requires tier-N equipment.
    requiresPreviousTier: v.optional(v.boolean()),
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
    effectElement: v.optional(v.string()),
    // Augment tier within its chain (absent on rows applied before tiers).
    tier: v.optional(v.number()),
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
    // Element dealt by this monster's attacks (for elemental wards).
    element: v.optional(v.string()),
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
          effectElement: v.optional(v.string()),
          tier: v.optional(v.number()),
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

  // Equipped auto-consumable slots. Slot 0 is always unlocked; slots 1-2
  // unlock via skilling passive nodes. Server auto-consumes 1 inventory unit
  // when the slot's buff expires while the active task matches the item.
  playerConsumableSlots: defineTable({
    playerId: v.id("players"),
    slotIndex: v.number(),
    itemId: v.id("items"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_and_slotIndex", ["playerId", "slotIndex"]),

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
    // Element dealt by this boss + the player's attuned ward at start.
    monsterElement: v.optional(v.string()),
    monsterWard: v.optional(v.number()),
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
    // Frozen equipped-ability state for auto-casting over the real-time
    // timeline. Absent for sessions begun before abilities existed / by
    // players with nothing equipped.
    abilityState: v.optional(abilityCombatStateValidator),
  })
    .index("by_playerId_and_status", ["playerId", "status"])
    .index("by_settlementKey", ["settlementKey"]),

  // Guilds / Alliances
  guilds: defineTable({
    name: v.string(),
    tag: v.string(),
    description: v.string(),
    ownerId: v.id("players"),
    gold: v.number(),
    xp: v.number(),
    level: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_tag", ["tag"])
    .index("by_ownerId", ["ownerId"]),

  guildMembers: defineTable({
    guildId: v.id("guilds"),
    playerId: v.id("players"),
    role: guildRoleValidator,
    joinedAt: v.number(),
    contributionXp: v.number(),
    contributionGold: v.number(),
    lastActiveAt: v.number(),
  })
    .index("by_guildId", ["guildId"])
    .index("by_playerId", ["playerId"])
    .index("by_guildId_and_role", ["guildId", "role"]),

  guildApplications: defineTable({
    guildId: v.id("guilds"),
    playerId: v.id("players"),
    type: guildApplicationTypeValidator,
    status: guildApplicationStatusValidator,
    message: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_guildId_and_status", ["guildId", "status"])
    .index("by_playerId_and_status", ["playerId", "status"]),

  guildBonuses: defineTable({
    level: v.number(),
    goldBonusPercent: v.number(),
    xpBonusPercent: v.number(),
    statBonusPercent: v.number(),
    maxMembers: v.number(),
    raidSlots: v.number(),
    createdAt: v.number(),
  })
    .index("by_level", ["level"]),

  guildRaids: defineTable({
    guildId: v.id("guilds"),
    bossId: v.string(),
    tier: v.number(),
    status: guildRaidStatusValidator,
    // One lobby = one row, max guildRaidPartySize entries. Multiple rows may
    // share (guildId, weekStart, tier): each lobbies its own dragon-HP copy
    // and reconciles on finish (first kill claims the tier, wipes chip it).
    participants: v.array(guildRaidPartyMemberValidator),
    bossHp: v.number(),
    bossMaxHp: v.number(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    expiresAt: v.number(),
    rewardGold: v.number(),
    rewardXp: v.number(),
    createdAt: v.number(),
    // Weekly summon scoping. Bosses reset to T1 every Saturday: weekStart is
    // the Saturday 00:00 UTC timestamp for this lobby. Optional for rows
    // written before weekly resets existed.
    weekStart: v.optional(v.number()),
    summonedBy: v.optional(v.id("players")),
    // Element dealt by this raid dragon (cycles per tier like solo bosses).
    dragonElement: v.optional(v.string()),
    // Dragon combat state (meaningful while status is active).
    raidRound: v.optional(v.number()),
    skinUntilRound: v.optional(v.number()),
    skinThresholdsHit: v.optional(v.array(v.number())),
    // Last auto-tick time. tickRaid advances every full roundIntervalMs
    // since this timestamp; anyone viewing may tick (no manual battling).
    lastTickAt: v.optional(v.number()),
    roundIntervalMs: v.optional(v.number()),
    // Frozen tuning + dragon attack captured at beginRaid so auto-combat ticks
    // never touch gameBalance/bosses on the hot path. Optional for rows begun
    // before snapshots existed (tick falls back to a live read).
    raidTuning: v.optional(guildRaidTuningValidator),
    dragonAttack: v.optional(v.number()),
  })
    .index("by_guildId_and_status", ["guildId", "status"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"])
    .index("by_weekStart", ["weekStart"])
    .index("by_guildId_and_weekStart_and_tier", ["guildId", "weekStart", "tier"]),

  // One row per (guild, week, tier) once a lobby lands the killing blow.
  // The stop signal for other in-flight lobbies and the tier-unlock marker.
  // A point read replaces the old scan across every lobby row for the tier.
  guildRaidClaims: defineTable({
    guildId: v.id("guilds"),
    weekStart: v.number(),
    tier: v.number(),
    raidId: v.id("guildRaids"),
    claimedAt: v.number(),
  }).index("by_guildId_and_weekStart_and_tier", [
    "guildId",
    "weekStart",
    "tier",
  ]),

  // One aggregate row per (guild, week): the raid leaderboard source. Updated
  // only when a lobby settles, so live per-tick damage writes never invalidate
  // the leaderboard subscription.
  guildRaidStandings: defineTable({
    guildId: v.id("guilds"),
    weekStart: v.number(),
    highestTierKilled: v.number(),
    totalDamage: v.number(),
    killTime: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_weekStart", ["weekStart"])
    .index("by_guildId_and_weekStart", ["guildId", "weekStart"]),

  // Guild item stash. Kill loot goes here, not to player inventories.
  // No stash limits: stackable items fill existing stacks up to maxStackSize
  // then spill into new rows (multiple stacks allowed); non-stackable items
  // get one row per unit.
  guildStashItems: defineTable({
    guildId: v.id("guilds"),
    itemId: v.id("items"),
    quantity: v.number(),
    acquiredAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_guildId", ["guildId"])
    .index("by_guildId_and_itemId", ["guildId", "itemId"]),

  // Once-per-player-per-tier-per-week raid XP dedup. Everyone who deals
  // damage earns boss-tier XP/Gold once; repeat lobbies still count damage
  // for the leaderboard but pay no repeat XP (anti-farm).
  guildRaidXpGrants: defineTable({
    guildId: v.id("guilds"),
    weekStart: v.number(),
    tier: v.number(),
    playerId: v.id("players"),
    partyId: v.id("guildRaids"),
    xp: v.number(),
    gold: v.number(),
    createdAt: v.number(),
  })
    .index("by_guild_week_tier_player", ["guildId", "weekStart", "tier", "playerId"])
    .index("by_guild_week", ["guildId", "weekStart"]),

  guildWeeklyObjectives: defineTable({
    guildId: v.id("guilds"),
    weekStart: v.number(),
    objectives: v.array(v.object({
      objectiveId: v.string(),
      target: v.number(),
      progress: v.number(),
      rewardGold: v.number(),
      rewardXp: v.number(),
      claimed: v.boolean(),
    })),
    totalProgress: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_guildId_and_weekStart", ["guildId", "weekStart"]),

  guildLeaderboard: defineTable({
    guildId: v.id("guilds"),
    guildName: v.string(),
    guildTag: v.string(),
    level: v.number(),
    xp: v.number(),
    memberCount: v.number(),
    totalContributionXp: v.number(),
    lastUpdated: v.number(),
  })
    .index("by_level_xp", ["level", "xp"])
    .index("by_lastUpdated", ["lastUpdated"]),

  // PvP arena. Lobbies double as match records: waiting -> active ->
  // completed/cancelled/expired. Stakes are escrowed from fighter gold on
  // create/join and settled exactly once. The lobby `password` is write-only:
  // no query ever returns it (projections strip it; joins check equality).
  arenaLobbies: defineTable({
    visibility: arenaLobbyVisibilityValidator,
    password: v.optional(v.string()),
    status: arenaLobbyStatusValidator,
    creatorId: v.id("players"),
    // Either fighter slot may be empty: the creator can be a spectator after
    // succession, and newcomers fill the first empty slot. A fight only
    // starts when both slots are filled.
    fighter1Id: v.optional(v.id("players")),
    fighter1Name: v.optional(v.string()),
    fighter1Stake: v.optional(v.number()),
    fighter1Level: v.optional(v.number()),
    // Combat-only level (str+dex+int+luk+con, no skills) for quick-match
    // pairing. Snapshotted at join like fighterNLevel.
    fighter1CombatLevel: v.optional(v.number()),
    fighter1Ready: v.optional(v.boolean()),
    fighter2Id: v.optional(v.id("players")),
    fighter2Name: v.optional(v.string()),
    fighter2Stake: v.optional(v.number()),
    fighter2Level: v.optional(v.number()),
    fighter2CombatLevel: v.optional(v.number()),
    fighter2Ready: v.optional(v.boolean()),
    // Set when both fighters are ready; the fight starts once this timestamp
    // passes (via any viewer's tick). Either unready clears it.
    countdownEndsAt: v.optional(v.number()),
    // Live fight state (meaningful while status is active).
    fighter1Hp: v.optional(v.number()),
    fighter1MaxHp: v.optional(v.number()),
    fighter2Hp: v.optional(v.number()),
    fighter2MaxHp: v.optional(v.number()),
    fighter1Snapshot: v.optional(arenaFighterSnapshotValidator),
    fighter2Snapshot: v.optional(arenaFighterSnapshotValidator),
    // Frozen equipped-ability state (round-based cooldowns) for auto-cast.
    fighter1AbilityState: v.optional(abilityCombatStateValidator),
    fighter2AbilityState: v.optional(abilityCombatStateValidator),
    fighter1Gear: v.optional(v.array(arenaFighterGearValidator)),
    fighter2Gear: v.optional(v.array(arenaFighterGearValidator)),
    round: v.optional(v.number()),
    lastRoundAt: v.optional(v.number()),
    roundIntervalMs: v.optional(v.number()),
    maxRounds: v.optional(v.number()),
    recentRounds: v.optional(v.array(arenaRoundValidator)),
    winnerId: v.optional(v.id("players")),
    endReason: v.optional(
      v.union(
        v.literal("knockout"),
        v.literal("rounds"),
        v.literal("forfeit"),
        v.literal("draw")
      )
    ),
    taxPaid: v.optional(v.number()),
    potPaid: v.optional(v.number()),
    // Deprecated: arena lobbies never settled through the fight-history seam.
    // Legacy rows keep the key until migrations:dropArenaLobbySettlementKeys
    // clears it; the field is no longer written.
    settlementKey: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_status_and_visibility", ["status", "visibility"])
    .index("by_creator", ["creatorId"]),

  // Arena spectators. Separate table so the lobby row never grows with the
  // crowd; fighters are on the lobby row and never need spectator rows.
  arenaSpectators: defineTable({
    lobbyId: v.id("arenaLobbies"),
    playerId: v.id("players"),
    playerName: v.string(),
    joinedAt: v.number(),
  })
    .index("by_lobby", ["lobbyId"])
    .index("by_lobby_and_player", ["lobbyId", "playerId"])
    .index("by_player", ["playerId"]),

  // Ranked league (async Elo ladder, separate from wagered lobbies).
  // Membership is opt-in at the combat-level gate; battles resolve instantly
  // server-side with no opponent presence, spectators, or stakes.
  rankedFighters: defineTable({
    playerId: v.id("players"),
    playerName: v.string(),
    points: v.number(),
    wins: v.number(),
    losses: v.number(),
    draws: v.number(),
    // Daily battle allowance, tracked against the UTC day number.
    battleDay: v.number(),
    battlesUsed: v.number(),
    joinedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_player", ["playerId"])
    .index("by_points", ["points"]),

  // Settled ranked battles, both perspectives, for recent-history views.
  rankedBattles: defineTable({
    attackerId: v.id("players"),
    attackerName: v.string(),
    defenderId: v.id("players"),
    defenderName: v.string(),
    attackerWon: v.boolean(),
    draw: v.boolean(),
    rounds: v.number(),
    attackerPointsBefore: v.number(),
    attackerPointsAfter: v.number(),
    defenderPointsBefore: v.number(),
    defenderPointsAfter: v.number(),
    // Signed from the attacker's perspective (negative on a loss).
    pointSwing: v.number(),
    createdAt: v.number(),
  })
    .index("by_attacker", ["attackerId"])
    .index("by_defender", ["defenderId"])
    .index("by_createdAt", ["createdAt"]),

  // Weekly settlement records: top-10 payouts of the week that just ended.
  rankedSeasons: defineTable({
    weekStart: v.number(),
    standings: v.array(
      v.object({
        playerId: v.id("players"),
        playerName: v.string(),
        points: v.number(),
        placement: v.number(),
        rewardGold: v.number(),
      })
    ),
    fightersReset: v.number(),
    settledAt: v.number(),
  }).index("by_weekStart", ["weekStart"]),

  // PvP loadouts: one row per saved slot. Absent slots (or no rows at all)
  // fall back to currently equipped gear when a PvP fight snapshots.
  pvpLoadoutSlots: defineTable({
    playerId: v.id("players"),
    slot: equipmentSlotValidator,
    playerItemId: v.id("playerItems"),
    updatedAt: v.number(),
  })
    .index("by_player", ["playerId"])
    .index("by_player_and_slot", ["playerId", "slot"]),

  // Abilities: definitions of all learnable abilities
  abilities: defineTable({
    abilityId: v.string(),
    name: v.string(),
    description: v.string(),
    type: abilityTypeValidator,
    target: abilityTargetValidator,
    weaponType: abilityWeaponTypeValidator,
    element: v.optional(v.string()),
    basePower: v.number(),
    powerScalingPerLevel: v.number(),
    cooldownMs: v.number(),
    castTimeMs: v.optional(v.number()),
    manaCost: v.optional(v.number()),
    hpCost: v.optional(v.number()),
    buffDurationMs: v.optional(v.number()),
    buffStat: v.optional(v.string()),
    buffValue: v.optional(v.number()),
    buffIsPercent: v.optional(v.boolean()),
    maxLevel: v.optional(v.number()),
    icon: v.optional(v.string()),
    tier: v.number(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_abilityId", ["abilityId"])
    .index("by_type", ["type"])
    .index("by_weaponType", ["weaponType"])
    .index("by_tier", ["tier"])
    .index("by_enabled", ["enabled"]),

  // Player learned abilities with level and XP
  playerAbilities: defineTable({
    playerId: v.id("players"),
    abilityId: v.string(),
    level: v.number(),
    experience: v.number(),
    totalExperience: v.number(),
    learnedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_and_abilityId", ["playerId", "abilityId"])
    .index("by_abilityId", ["abilityId"]),

  // Player equipped abilities (active loadout, max 4 slots)
  playerEquippedAbilities: defineTable({
    playerId: v.id("players"),
    slot: v.number(),
    abilityId: v.string(),
    equippedAt: v.number(),
  })
    .index("by_playerId", ["playerId"])
    .index("by_playerId_and_slot", ["playerId", "slot"])
    .index("by_playerId_and_abilityId", ["playerId", "abilityId"]),

  ...authTables,
});
