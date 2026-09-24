import { query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  consumeItems,
  grantItemToInventory,
} from "./items";
import {
  DEFAULT_SKILL_TASK_MS_PER_XP,
  getSkillActionDurationMs,
  getSkillModifierTimeline,
  getSkillModifiersAt,
  readSkillTaskMsPerXp,
} from "./skillBonuses";
import {
  applySkillExperience,
  getSkillXpRequiredForLevel,
  readSkillXpBase,
  SKILL_XP_BALANCE_DEFAULT,
} from "./skillProgression";
import { validateRecipeChain } from "./recipeValidation";

type DatabaseCtx = QueryCtx | MutationCtx;
type PlayerId = Id<"players">;
export type SkillActionType = "gathering" | "crafting" | "augmentation";

type ReservedIngredient = {
  itemId: Id<"items">;
  quantity: number;
};

const MAX_SKILL_PANEL_ROWS = 200;
const MAX_SKILL_BATCH_SIZE = 10_000;
const MAX_SKILL_ACTIONS_PER_RESOLUTION = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type SnapshotEffectStat = "str" | "dex" | "int" | "luk" | "con";

function snapshotEffectStat(value: unknown): SnapshotEffectStat | undefined {
  return value === "str" ||
    value === "dex" ||
    value === "int" ||
    value === "luk" ||
    value === "con"
    ? value
    : undefined;
}

async function getPlayer(ctx: DatabaseCtx, playerId: PlayerId) {
  const player = await ctx.db.get(playerId);
  if (!player) throw new Error("Player not found");
  return player;
}

async function getBalanceValue(ctx: DatabaseCtx, key: string) {
  return (
    await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first()
  )?.value;
}

async function getSkillDefinition(ctx: DatabaseCtx, skillId: string) {
  return await ctx.db
    .query("skillDefinitions")
    .withIndex("by_skillId", (q) => q.eq("skillId", skillId))
    .first();
}

async function getPlayerSkillRow(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  skillId: string
) {
  return await ctx.db
    .query("playerSkills")
    .withIndex("by_playerId_and_skillId", (q) =>
      q.eq("playerId", playerId).eq("skillId", skillId)
    )
    .first();
}

async function ensurePlayerSkill(
  ctx: MutationCtx,
  playerId: PlayerId,
  skillId: string,
  now = Date.now()
) {
  const existing = await getPlayerSkillRow(ctx, playerId, skillId);
  if (existing) return existing;

  const skill = await getSkillDefinition(ctx, skillId);
  if (!skill) throw new Error("Skill definition not found");
  const skillIdRef = await ctx.db.insert("playerSkills", {
    playerId,
    skillId,
    level: 1,
    experience: 0,
    totalExperience: 0,
    actionsCompleted: 0,
    createdAt: now,
    updatedAt: now,
  });
  return await ctx.db.get(skillIdRef);
}

async function getTierDefinition(
  ctx: DatabaseCtx,
  skillId: string,
  tier: number
) {
  return await ctx.db
    .query("skillTierDefinitions")
    .withIndex("by_skillId_and_tier", (q) =>
      q.eq("skillId", skillId).eq("tier", tier)
    )
    .first();
}

async function assertSkillTierUnlocked(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  skillId: string,
  tier: number
) {
  if (!Number.isSafeInteger(tier) || tier < 1) {
    throw new Error("Skill tier must be a positive integer");
  }
  const skill = await getSkillDefinition(ctx, skillId);
  if (!skill || !skill.enabled) {
    throw new Error("That skill is not configured");
  }
  const tierDefinition = await getTierDefinition(ctx, skillId, tier);
  if (!tierDefinition || !tierDefinition.enabled) {
    throw new Error("That skill tier is not configured");
  }
  const playerSkill = await getPlayerSkillRow(ctx, playerId, skillId);
  const level = playerSkill?.level ?? 1;
  if (level < tierDefinition.requiredLevel) {
    throw new Error(
      `Requires ${tierDefinition.name} at skill level ${tierDefinition.requiredLevel}`
    );
  }
  return { tierDefinition, level };
}

export async function getGatheringActivity(
  ctx: DatabaseCtx,
  activityId: string
) {
  return await ctx.db
    .query("gatheringActivities")
    .withIndex("by_activityId", (q) => q.eq("activityId", activityId))
    .first();
}

export async function getRecipe(ctx: DatabaseCtx, recipeId: string) {
  return await ctx.db
    .query("recipes")
    .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
    .first();
}

async function getRecipeIngredients(ctx: DatabaseCtx, recipeId: string) {
  return await ctx.db
    .query("recipeIngredients")
    .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
    .take(MAX_SKILL_PANEL_ROWS);
}

async function getRecipeOutputs(ctx: DatabaseCtx, recipeId: string) {
  return await ctx.db
    .query("recipeOutputs")
    .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
    .take(MAX_SKILL_PANEL_ROWS);
}

function combineIngredients(
  ingredients: Array<{ itemId: Id<"items">; quantity: number }>
): ReservedIngredient[] {
  const totals = new Map<Id<"items">, number>();
  for (const ingredient of ingredients) {
    if (
      !Number.isSafeInteger(ingredient.quantity) ||
      ingredient.quantity < 1
    ) {
      throw new Error("Skill action has an invalid ingredient requirement");
    }
    const total = (totals.get(ingredient.itemId) ?? 0) + ingredient.quantity;
    if (!Number.isSafeInteger(total)) {
      throw new Error("Skill action ingredient quantity is too large");
    }
    totals.set(ingredient.itemId, total);
  }
  return Array.from(totals, ([itemId, quantity]) => ({ itemId, quantity }));
}

type AugmentationTargetValidation =
  | { error: string }
  | {
      error: null;
      ownedItem: Doc<"playerItems">;
      item: Doc<"items">;
      existingAugments: Doc<"playerItemAugments">[];
    };
type ValidAugmentationTarget = Extract<
  AugmentationTargetValidation,
  { error: null }
>;

async function inspectAugmentationTarget(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  playerItemId: Id<"playerItems">,
  definition: Doc<"augmentationDefinitions">
): Promise<AugmentationTargetValidation> {
  const ownedItem = await ctx.db.get(playerItemId);
  if (
    !ownedItem ||
    ownedItem.playerId !== playerId ||
    ownedItem.quantity !== 1
  ) {
    return { error: "Equipment item not found" };
  }
  const item = await ctx.db.get(ownedItem.itemId);
  if (!item || item.category !== "equipment") {
    return { error: "Only equipment can be augmented" };
  }
  if (
    definition.baseItemFamily !== undefined &&
    item.itemFamily !== definition.baseItemFamily
  ) {
    return { error: "This augmentation does not fit that equipment family" };
  }
  if (
    definition.allowedEquipmentSlots.length > 0 &&
    !definition.allowedEquipmentSlots.some((slot) =>
      item.allowedEquipmentSlots.includes(slot)
    )
  ) {
    return { error: "This augmentation does not fit that equipment slot" };
  }

  const existingAugments = await ctx.db
    .query("playerItemAugments")
    .withIndex("by_playerItemId", (q) => q.eq("playerItemId", playerItemId))
    .collect();
  if (existingAugments.length >= (item.augmentSlots ?? 1)) {
    return { error: "That equipment has no open augmentation slots" };
  }
  if (
    existingAugments.some(
      (augment) => augment.augmentationId === definition.augmentationId
    )
  ) {
    return { error: "That augmentation is already applied" };
  }
  return { error: null, ownedItem, item, existingAugments };
}

async function validateAugmentationTarget(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  playerItemId: Id<"playerItems">,
  definition: Doc<"augmentationDefinitions">
): Promise<ValidAugmentationTarget> {
  const result = await inspectAugmentationTarget(
    ctx,
    playerId,
    playerItemId,
    definition
  );
  if (result.error !== null) throw new Error(result.error);
  return result;
}

export async function prepareSkillAction(
  ctx: MutationCtx,
  playerId: PlayerId,
  actionType: SkillActionType,
  actionId: string,
  options: {
    quantity?: number;
    playerItemId?: Id<"playerItems">;
  } = {}
) {
  await getPlayer(ctx, playerId);
  if (actionType === "gathering") {
    if (options.playerItemId !== undefined) {
      throw new Error("Gathering tasks do not accept an equipment target");
    }
    const quantity = options.quantity ?? 1;
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_SKILL_BATCH_SIZE
    ) {
      throw new Error(
        `Gathering action quantity must be between 1 and ${MAX_SKILL_BATCH_SIZE}`
      );
    }
    const activity = await getGatheringActivity(ctx, actionId);
    if (!activity || !activity.enabled) {
      throw new Error("Gathering activity not found or disabled");
    }
    await assertSkillTierUnlocked(
      ctx,
      playerId,
      activity.skillId,
      activity.tier
    );
    const baseDurationMs = getSkillActionDurationMs(
      activity.experienceReward,
      await readSkillTaskMsPerXp(ctx)
    );
    return {
      actionType,
      actionId,
      skillId: activity.skillId,
      skillCategory: "gathering" as const,
      baseExperienceReward: activity.experienceReward,
      displayName: activity.name,
      baseDurationMs,
      skillActionSnapshot: {
        actionType,
        actionId,
        skillId: activity.skillId,
        skillCategory: "gathering" as const,
        baseExperienceReward: activity.experienceReward,
        gathering: {
          outputItemId: activity.outputItemId,
          minYield: activity.minYield,
          maxYield: activity.maxYield,
        },
      },
      quantity,
    };
  }

  if (actionType === "crafting") {
    if (options.playerItemId !== undefined) {
      throw new Error("Crafting tasks do not accept an equipment target");
    }
    const quantity = options.quantity ?? 1;
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_SKILL_BATCH_SIZE
    ) {
      throw new Error(
        `Craft quantity must be between 1 and ${MAX_SKILL_BATCH_SIZE}`
      );
    }
    const recipe = await getRecipe(ctx, actionId);
    if (!recipe || !recipe.enabled) {
      throw new Error("Recipe not found or disabled");
    }
    await assertSkillTierUnlocked(ctx, playerId, recipe.skillId, recipe.tier);
    await validateRecipeChain(ctx, recipe.recipeId);
    const ingredients = combineIngredients(
      await getRecipeIngredients(ctx, recipe.recipeId)
    );
    if (ingredients.length === 0) {
      throw new Error("Recipe has no ingredients");
    }
    const outputs = await getRecipeOutputs(ctx, recipe.recipeId);
    if (outputs.length === 0) {
      throw new Error("Recipe has no outputs");
    }
    const outputSnapshots = await Promise.all(
      outputs.map(async (output) => {
        if (
          !Number.isSafeInteger(output.quantity) ||
          output.quantity < 1
        ) {
          throw new Error("Recipe output quantity is invalid");
        }
        const item = await ctx.db.get(output.itemId);
        if (!item) {
          throw new Error("Recipe output references a missing item");
        }
        const effectStat = snapshotEffectStat(item.effectStat);
        return {
          itemId: output.itemId,
          quantity: output.quantity,
          ...(item.itemFamily === undefined
            ? {}
            : { itemFamily: item.itemFamily }),
          ...(item.effectType === undefined
            ? {}
            : { effectType: item.effectType }),
          ...(effectStat === undefined ? {} : { effectStat }),
          ...(item.effectAmount === undefined
            ? {}
            : { effectAmount: item.effectAmount }),
          ...(item.effectDurationMs === undefined
            ? {}
            : { effectDurationMs: item.effectDurationMs }),
        };
      })
    );
    const totalIngredients = ingredients.map((ingredient) => ({
      itemId: ingredient.itemId,
      quantity: ingredient.quantity * quantity,
    }));
    if (
      totalIngredients.some(
        (ingredient) => !Number.isSafeInteger(ingredient.quantity)
      )
    ) {
      throw new Error("Craft quantity exceeds the available resource limits");
    }
    await consumeItems(ctx, playerId, totalIngredients);
    const baseDurationMs = getSkillActionDurationMs(
      recipe.experienceReward,
      await readSkillTaskMsPerXp(ctx)
    );
    const recipeSnapshot = {
      recipeId: recipe.recipeId,
      skillId: recipe.skillId,
      tier: recipe.tier,
      experienceReward: recipe.experienceReward,
      ...(recipe.outputFamily === undefined
        ? {}
        : { outputFamily: recipe.outputFamily }),
      ...(recipe.stage === undefined ? {} : { stage: recipe.stage }),
      ...(recipe.requiresMonsterDrop === undefined
        ? {}
        : { requiresMonsterDrop: recipe.requiresMonsterDrop }),
      outputs: outputSnapshots,
    };
    return {
      actionType,
      actionId,
      skillId: recipe.skillId,
      skillCategory: "crafting" as const,
      baseExperienceReward: recipe.experienceReward,
      displayName: recipe.name,
      baseDurationMs,
      quantity,
      reservedIngredients: ingredients,
      recipeSnapshot,
      skillActionSnapshot: {
        actionType,
        actionId,
        skillId: recipe.skillId,
        skillCategory: "crafting" as const,
        baseExperienceReward: recipe.experienceReward,
        recipe: recipeSnapshot,
      },
    };
  }

  if (options.quantity !== undefined || options.playerItemId === undefined) {
    throw new Error("Augmentation tasks require one equipment target");
  }
  const definition = await ctx.db
    .query("augmentationDefinitions")
    .withIndex("by_augmentationId", (q) =>
      q.eq("augmentationId", actionId)
    )
    .first();
  if (!definition || !definition.enabled) {
    throw new Error("Augmentation not found or disabled");
  }
  await assertSkillTierUnlocked(
    ctx,
    playerId,
    definition.skillId,
    definition.tier
  );
  const { item } = await validateAugmentationTarget(
    ctx,
    playerId,
    options.playerItemId,
    definition
  );
  const reservedIngredients = combineIngredients([
    {
      itemId: definition.requiredMaterialItemId,
      quantity: definition.requiredMaterialQuantity,
    },
    ...(definition.bossCatalystItemId !== undefined &&
    definition.bossCatalystQuantity !== undefined
      ? [
          {
            itemId: definition.bossCatalystItemId,
            quantity: definition.bossCatalystQuantity,
          },
        ]
      : []),
  ]);
  await consumeItems(ctx, playerId, reservedIngredients);
  const baseExperienceReward =
    definition.experienceReward ?? 50 * definition.tier;
  if (
    !Number.isSafeInteger(baseExperienceReward) ||
    baseExperienceReward < 1
  ) {
    throw new Error("Augmentation has an invalid skill experience reward");
  }
  const baseDurationMs = getSkillActionDurationMs(
    baseExperienceReward,
    await readSkillTaskMsPerXp(ctx)
  );
  return {
    actionType,
    actionId,
    skillId: definition.skillId,
    skillCategory: "crafting" as const,
    baseExperienceReward,
    displayName: definition.name,
    baseDurationMs,
    quantity: 1,
    reservedIngredients,
    targetPlayerItemId: options.playerItemId,
    skillActionSnapshot: {
      actionType,
      actionId,
      skillId: definition.skillId,
      skillCategory: "crafting" as const,
      baseExperienceReward,
      augmentation: {
        targetPlayerItemId: options.playerItemId,
        augmentationId: definition.augmentationId,
        name: definition.name,
        effectType: definition.effectType,
        baseItemFamily: definition.baseItemFamily ?? null,
        allowedEquipmentSlots: definition.allowedEquipmentSlots,
        targetItemFamily: item.itemFamily ?? null,
        ...(definition.effectStat === undefined
          ? {}
          : { effectStat: definition.effectStat }),
        effectAmount: definition.effectAmount,
        itemFamily: item.itemFamily ?? null,
      },
    },
  };
}

type CraftingRecipeSnapshot = {
  recipeId: string;
  skillId: string;
  tier: number;
  experienceReward: number;
  outputFamily?: string;
  stage?: "refinement" | "product";
  requiresMonsterDrop?: boolean;
  outputs: Array<{
    itemId: Id<"items">;
    quantity: number;
    itemFamily?: string;
    effectType?: string;
    effectStat?: "str" | "dex" | "int" | "luk" | "con";
    effectAmount?: number;
    effectDurationMs?: number;
  }>;
};

function readCraftingRecipeSnapshot(
  payload: Record<string, unknown>
): CraftingRecipeSnapshot | null {
  const value = payload.recipeSnapshot;
  if (!isRecord(value)) return null;
  if (
    typeof value.recipeId !== "string" ||
    typeof value.skillId !== "string" ||
    typeof value.tier !== "number" ||
    !Number.isSafeInteger(value.tier) ||
    value.tier < 1 ||
    typeof value.experienceReward !== "number" ||
    !Number.isSafeInteger(value.experienceReward) ||
    value.experienceReward < 1 ||
    !Array.isArray(value.outputs) ||
    value.outputs.length === 0
  ) {
    throw new Error("Crafting task has an invalid recipe snapshot");
  }
  const outputs: CraftingRecipeSnapshot["outputs"] = value.outputs.map(
    (output) => {
    if (
      !isRecord(output) ||
      typeof output.itemId !== "string" ||
      typeof output.quantity !== "number" ||
      !Number.isSafeInteger(output.quantity) ||
      output.quantity < 1
    ) {
      throw new Error("Crafting task has an invalid recipe output snapshot");
    }
    const effectStat = snapshotEffectStat(output.effectStat);
    return {
      itemId: output.itemId as Id<"items">,
      quantity: output.quantity,
      ...(typeof output.itemFamily === "string"
        ? { itemFamily: output.itemFamily }
        : {}),
      ...(typeof output.effectType === "string"
        ? { effectType: output.effectType }
        : {}),
      ...(effectStat === undefined ? {} : { effectStat }),
      ...(typeof output.effectAmount === "number"
        ? { effectAmount: output.effectAmount }
        : {}),
      ...(typeof output.effectDurationMs === "number"
        ? { effectDurationMs: output.effectDurationMs }
        : {}),
    };
    }
  );
  return {
    recipeId: value.recipeId,
    skillId: value.skillId,
    tier: value.tier,
    experienceReward: value.experienceReward,
    ...(typeof value.outputFamily === "string"
      ? { outputFamily: value.outputFamily }
      : {}),
    ...(value.stage === "refinement" || value.stage === "product"
      ? { stage: value.stage }
      : {}),
    ...(typeof value.requiresMonsterDrop === "boolean"
      ? { requiresMonsterDrop: value.requiresMonsterDrop }
      : {}),
    outputs,
  };
}

export async function resolveSkillTask(
  ctx: MutationCtx,
  task: Doc<"playerTasks">,
  now: number
) {
  if (!isRecord(task.payload)) {
    throw new Error("Skill task is missing its action payload");
  }
  const actionType = task.payload.actionType;
  const actionId = task.payload.actionId;
  if (
    (actionType !== "gathering" && actionType !== "crafting") ||
    typeof actionId !== "string" ||
    actionId.length === 0
  ) {
    throw new Error("Skill task has an invalid action payload");
  }

  const completionKey = `${task._id}:skill`;
  const existing = await ctx.db
    .query("skillActionHistory")
    .withIndex("by_completionKey", (q) =>
      q.eq("completionKey", completionKey)
    )
    .first();
  if (existing) return existing.result ?? null;

  const recipeSnapshot =
    actionType === "crafting"
      ? readCraftingRecipeSnapshot(task.payload)
      : null;
  const action =
    actionType === "gathering"
      ? await getGatheringActivity(ctx, actionId)
      : recipeSnapshot
        ? null
        : await getRecipe(ctx, actionId);
  if (actionType === "gathering" && !action) {
    throw new Error("Gathering action no longer exists");
  }
  if (actionType === "crafting" && !recipeSnapshot && !action) {
    throw new Error("Crafting recipe no longer exists");
  }

  const playerSkill = await ensurePlayerSkill(
    ctx,
    task.playerId,
    recipeSnapshot?.skillId ?? action!.skillId,
    now
  );
  if (!playerSkill) throw new Error("Unable to initialize player skill");
  const skill = await getSkillDefinition(
    ctx,
    recipeSnapshot?.skillId ?? action!.skillId
  );
  if (!skill) throw new Error("Skill definition not found");

  const xpReward = recipeSnapshot?.experienceReward ?? action!.experienceReward;
  if (
    !Number.isSafeInteger(xpReward) ||
    xpReward < 0
  ) {
    throw new Error("Skill action has an invalid experience reward");
  }
  const xpBase = readSkillXpBase(
    await getBalanceValue(ctx, SKILL_XP_BALANCE_DEFAULT.key)
  );
  const { level, experience } = applySkillExperience(
    playerSkill.level,
    playerSkill.experience,
    xpReward,
    skill.maxLevel,
    xpBase
  );
  const totalExperience = playerSkill.totalExperience + xpReward;

  const result: Record<string, unknown> = {
    actionType,
    actionId,
    skillId: recipeSnapshot?.skillId ?? action!.skillId,
    experienceEarned: xpReward,
    level,
  };

  if (actionType === "gathering") {
    if (!action || !("maxYield" in action) || !("minYield" in action)) {
      throw new Error("Gathering activity is missing yield configuration");
    }
    const yieldRange = action.maxYield - action.minYield + 1;
    if (
      !Number.isSafeInteger(action.minYield) ||
      !Number.isSafeInteger(action.maxYield) ||
      action.minYield < 1 ||
      action.maxYield < action.minYield
    ) {
      throw new Error("Gathering activity has an invalid yield range");
    }
    const quantity =
      action.minYield + Math.floor(Math.random() * Math.max(1, yieldRange));
    const completion = await grantItemToInventory(ctx, {
      playerId: task.playerId,
      itemId: action.outputItemId,
      quantity,
      overflowSource: {
        sourceType: "skill",
        sourceId: action.activityId,
        settlementKey: completionKey,
      },
    });
    result.quantity = quantity;
    result.itemId = action.outputItemId;
    result.pending = completion.pending;
  } else {
    if (!recipeSnapshot && (!action || !("recipeId" in action))) {
      throw new Error("Crafting recipe is missing its recipe ID");
    }
    const outputs = recipeSnapshot
      ? recipeSnapshot.outputs
      : "recipeId" in action!
        ? await getRecipeOutputs(ctx, action.recipeId)
        : [];
    if (outputs.length === 0) {
      throw new Error("Recipe has no outputs");
    }
    const sourceId =
      recipeSnapshot?.recipeId ??
      (action && "recipeId" in action ? action.recipeId : actionId);
    const outputSummary = [];
    for (const output of outputs) {
      const completion = await grantItemToInventory(ctx, {
        playerId: task.playerId,
        itemId: output.itemId,
        quantity: output.quantity,
        overflowSource: {
          sourceType: "crafting",
          sourceId,
          settlementKey: completionKey,
        },
      });
      outputSummary.push({
        itemId: output.itemId,
        quantity: output.quantity,
        pending: completion.pending,
      });
    }
    result.outputs = outputSummary;
    if (recipeSnapshot) {
      result.recipe = {
        recipeId: recipeSnapshot.recipeId,
        tier: recipeSnapshot.tier,
        ...(recipeSnapshot.outputFamily === undefined
          ? {}
          : { outputFamily: recipeSnapshot.outputFamily }),
        ...(recipeSnapshot.stage === undefined
          ? {}
          : { stage: recipeSnapshot.stage }),
        ...(recipeSnapshot.requiresMonsterDrop === undefined
          ? {}
          : { requiresMonsterDrop: recipeSnapshot.requiresMonsterDrop }),
        outputs: recipeSnapshot.outputs,
      };
    }
  }

  await ctx.db.patch(playerSkill._id, {
    level,
    experience,
    totalExperience,
    actionsCompleted: playerSkill.actionsCompleted + 1,
    updatedAt: now,
  });
  await ctx.db.insert("skillActionHistory", {
    playerId: task.playerId,
    taskId: task._id,
    actionType,
    actionId,
    status: "completed",
    completionKey,
    result,
    createdAt: now,
  });
  return result;
}

type SkillActionSnapshot = {
  actionType: SkillActionType;
  actionId: string;
  skillId: string;
  skillCategory: "gathering" | "crafting";
  baseExperienceReward: number;
  gathering?: {
    outputItemId: Id<"items">;
    minYield: number;
    maxYield: number;
  };
  recipe?: CraftingRecipeSnapshot;
  augmentation?: {
    targetPlayerItemId: Id<"playerItems">;
    augmentationId: string;
    name: string;
    effectType: string;
    effectStat?: SnapshotEffectStat;
    effectAmount: number;
    baseItemFamily: string | null;
    allowedEquipmentSlots: string[];
    targetItemFamily: string | null;
  };
};

function readSkillActionSnapshot(
  payload: Record<string, unknown>
): SkillActionSnapshot {
  const value = payload.skillActionSnapshot;
  if (!isRecord(value)) {
    throw new Error("Skill task has an invalid action snapshot");
  }
  const actionType = value.actionType;
  const actionId = value.actionId;
  const skillId = value.skillId;
  const skillCategory = value.skillCategory;
  const baseExperienceReward = value.baseExperienceReward;
  if (
    (actionType !== "gathering" &&
      actionType !== "crafting" &&
      actionType !== "augmentation") ||
    typeof actionId !== "string" ||
    actionId.length === 0 ||
    typeof skillId !== "string" ||
    skillId.length === 0 ||
    (skillCategory !== "gathering" && skillCategory !== "crafting") ||
    !Number.isSafeInteger(baseExperienceReward) ||
    (baseExperienceReward as number) < 1
  ) {
    throw new Error("Skill task has an invalid action snapshot");
  }
  const snapshot: SkillActionSnapshot = {
    actionType,
    actionId,
    skillId,
    skillCategory,
    baseExperienceReward: baseExperienceReward as number,
  };

  if (actionType === "gathering") {
    const gathering = value.gathering;
    if (
      skillCategory !== "gathering" ||
      !isRecord(gathering) ||
      typeof gathering.outputItemId !== "string" ||
      !Number.isSafeInteger(gathering.minYield) ||
      (gathering.minYield as number) < 1 ||
      !Number.isSafeInteger(gathering.maxYield) ||
      (gathering.maxYield as number) < (gathering.minYield as number)
    ) {
      throw new Error("Skill task has an invalid gathering snapshot");
    }
    snapshot.gathering = {
      outputItemId: gathering.outputItemId as Id<"items">,
      minYield: gathering.minYield as number,
      maxYield: gathering.maxYield as number,
    };
  } else if (actionType === "crafting") {
    const recipe = readCraftingRecipeSnapshot({
      recipeSnapshot: value.recipe,
    });
    if (skillCategory !== "crafting" || !recipe) {
      throw new Error("Skill task has an invalid recipe snapshot");
    }
    snapshot.recipe = recipe;
  } else {
    const augmentation = value.augmentation;
    const effectStat = isRecord(augmentation)
      ? snapshotEffectStat(augmentation.effectStat)
      : undefined;
    if (
      skillCategory !== "crafting" ||
      !isRecord(augmentation) ||
      typeof augmentation.targetPlayerItemId !== "string" ||
      typeof augmentation.augmentationId !== "string" ||
      typeof augmentation.name !== "string" ||
      typeof augmentation.effectType !== "string" ||
      typeof augmentation.effectAmount !== "number" ||
      !Number.isFinite(augmentation.effectAmount) ||
      augmentation.effectAmount < 0 ||
      (augmentation.baseItemFamily !== null &&
        typeof augmentation.baseItemFamily !== "string") ||
      !Array.isArray(augmentation.allowedEquipmentSlots) ||
      !augmentation.allowedEquipmentSlots.every(
        (slot) => typeof slot === "string"
      ) ||
      (augmentation.targetItemFamily !== null &&
        typeof augmentation.targetItemFamily !== "string")
    ) {
      throw new Error("Skill task has an invalid augmentation snapshot");
    }
    snapshot.augmentation = {
      targetPlayerItemId:
        augmentation.targetPlayerItemId as Id<"playerItems">,
      augmentationId: augmentation.augmentationId,
      name: augmentation.name,
      effectType: augmentation.effectType,
      ...(effectStat === undefined ? {} : { effectStat }),
      effectAmount: augmentation.effectAmount,
      baseItemFamily: augmentation.baseItemFamily,
      allowedEquipmentSlots: augmentation.allowedEquipmentSlots,
      targetItemFamily: augmentation.targetItemFamily,
    };
  }
  return snapshot;
}

function readNonNegativeInteger(value: unknown, field: string) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`Skill task has an invalid ${field}`);
  }
  return value;
}

function readSkillOutputSummary(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("Skill task has an invalid output summary");
  }
  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.itemId !== "string" ||
      !Number.isSafeInteger(entry.quantity) ||
      (entry.quantity as number) < 1 ||
      !Number.isSafeInteger(entry.pending) ||
      (entry.pending as number) < 0
    ) {
      throw new Error("Skill task has an invalid output summary");
    }
    return {
      itemId: entry.itemId,
      quantity: entry.quantity as number,
      pending: entry.pending as number,
    };
  });
}

function addSafeInteger(current: number, addition: number, field: string) {
  const total = current + addition;
  if (!Number.isSafeInteger(total)) {
    throw new Error(`Skill task ${field} exceeds the supported limit`);
  }
  return total;
}

async function applyQueuedAugmentation(
  ctx: MutationCtx,
  playerId: PlayerId,
  augmentation: NonNullable<SkillActionSnapshot["augmentation"]>,
  now: number
) {
  const ownedItem = await ctx.db.get(augmentation.targetPlayerItemId);
  if (
    !ownedItem ||
    ownedItem.playerId !== playerId ||
    ownedItem.quantity !== 1
  ) {
    return "Equipment item is no longer available";
  }
  const item = await ctx.db.get(ownedItem.itemId);
  if (!item || item.category !== "equipment") {
    return "Only equipment can be augmented";
  }
  if ((item.itemFamily ?? null) !== augmentation.targetItemFamily) {
    return "Equipment was changed after this augmentation was queued";
  }
  if (
    augmentation.baseItemFamily !== null &&
    item.itemFamily !== augmentation.baseItemFamily
  ) {
    return "This augmentation no longer fits the equipment family";
  }
  if (
    augmentation.allowedEquipmentSlots.length > 0 &&
    !augmentation.allowedEquipmentSlots.some((slot) =>
      item.allowedEquipmentSlots.some((allowedSlot) => allowedSlot === slot)
    )
  ) {
    return "This augmentation no longer fits the equipment slot";
  }
  const augments = await ctx.db
    .query("playerItemAugments")
    .withIndex("by_playerItemId", (q) =>
      q.eq("playerItemId", augmentation.targetPlayerItemId)
    )
    .collect();
  if (augments.length >= (item.augmentSlots ?? 1)) {
    return "That equipment has no open augmentation slots";
  }
  if (
    augments.some(
      (augment) => augment.augmentationId === augmentation.augmentationId
    )
  ) {
    return "That augmentation is already applied";
  }

  await ctx.db.insert("playerItemAugments", {
    playerId,
    playerItemId: augmentation.targetPlayerItemId,
    augmentationId: augmentation.augmentationId,
    name: augmentation.name,
    effectType: augmentation.effectType,
    ...(augmentation.effectStat === undefined
      ? {}
      : { effectStat: augmentation.effectStat }),
    effectAmount: augmentation.effectAmount,
    appliedAt: now,
  });
  return null;
}

export async function advanceSkillActionTask(
  ctx: MutationCtx,
  task: Doc<"playerTasks">,
  availableMs: number,
  intervalStartMs: number,
  now: number
): Promise<{
  consumedMs: number;
  complete: boolean;
  deferred: boolean;
  failureReason?: string;
  progressMs: number;
  durationMs: number;
  payload: Record<string, unknown>;
  skillResult?: Record<string, unknown>;
}> {
  if (!isRecord(task.payload)) {
    throw new Error("Skill task is missing its action payload");
  }
  const payload = { ...task.payload };
  const snapshot = readSkillActionSnapshot(payload);
  const completedActions = readNonNegativeInteger(
    payload.completedActions ?? 0,
    "completed action count"
  );
  const totalExperienceEarned = readNonNegativeInteger(
    payload.totalExperienceEarned ?? 0,
    "total experience"
  );
  const outputSummary = readSkillOutputSummary(payload.outputSummary);
  const isGathering = snapshot.actionType === "gathering";
  const hasActionCountTarget = payload.targetActionCount !== undefined;
  const targetActionCount =
    isGathering && !hasActionCountTarget
      ? undefined
      : readNonNegativeInteger(payload.targetActionCount, "target action count");
  const isDurationBasedGathering = isGathering && !hasActionCountTarget;
  if (targetActionCount !== undefined && targetActionCount < 1) {
    throw new Error("Skill task has an invalid target action count");
  }
  if (targetActionCount !== undefined && completedActions > targetActionCount) {
    throw new Error("Skill task completed more actions than requested");
  }
  const targetDurationMs = isDurationBasedGathering
    ? task.durationMs
    : undefined;
  if (
    isDurationBasedGathering &&
    (targetDurationMs === undefined ||
      !Number.isSafeInteger(targetDurationMs) ||
      targetDurationMs < 1)
  ) {
    throw new Error("Gathering task has an invalid duration target");
  }
  const currentActionDurationMs =
    payload.currentActionDurationMs === undefined
      ? undefined
      : readNonNegativeInteger(
          payload.currentActionDurationMs,
          "current action duration"
        );
  const currentActionProgressMs = readNonNegativeInteger(
    payload.currentActionProgressMs ?? 0,
    "current action progress"
  );
  const currentActionXpReward =
    payload.currentActionXpReward === undefined
      ? undefined
      : readNonNegativeInteger(
          payload.currentActionXpReward,
          "current action experience"
        );
  if (
    (currentActionDurationMs === undefined) !==
    (currentActionXpReward === undefined)
  ) {
    throw new Error("Skill task has an incomplete current action state");
  }
  if (
    currentActionDurationMs === undefined &&
    currentActionProgressMs !== 0
  ) {
    throw new Error("Skill task has progress without a current action");
  }
  if (
    currentActionDurationMs === 0 ||
    (currentActionDurationMs !== undefined &&
      currentActionProgressMs >= currentActionDurationMs)
  ) {
    throw new Error("Skill task has invalid current action progress");
  }

  let consumedMs = 0;
  let actionCountThisCall = 0;
  let experienceThisCall = 0;
  let currentDuration = currentActionDurationMs;
  let currentProgress = currentActionProgressMs;
  let currentXpReward = currentActionXpReward;
  const gatheringQuantities = new Map<Id<"items">, number>();
  let failureReason: string | undefined;
  let deferred = false;
  let complete =
    isDurationBasedGathering
      ? task.progressMs >= (targetDurationMs ?? 0)
      : completedActions >= (targetActionCount ?? 0);
  const timelineEndedAt = intervalStartMs + Math.max(0, availableMs);
  let msPerXp = DEFAULT_SKILL_TASK_MS_PER_XP;
  if (availableMs > 0 && !complete) {
    if (!Number.isFinite(timelineEndedAt)) {
      throw new Error("Skill task resolution interval is invalid");
    }
    msPerXp = await readSkillTaskMsPerXp(ctx);
  }
  const timeline =
    availableMs > 0 && !complete
      ? await getSkillModifierTimeline(
          ctx,
          task.playerId,
          intervalStartMs,
          timelineEndedAt
        )
      : null;

  while (!complete && consumedMs < availableMs) {
    const progressAtCursor = task.progressMs + consumedMs;
    const remainingTaskMs = isDurationBasedGathering
      ? Math.max(0, (targetDurationMs ?? 0) - progressAtCursor)
      : Number.MAX_SAFE_INTEGER;
    if (remainingTaskMs === 0) {
      complete = true;
      break;
    }
    if (
      !isDurationBasedGathering &&
      completedActions + actionCountThisCall >= (targetActionCount ?? 0)
    ) {
      complete = true;
      break;
    }

    if (currentDuration === undefined || currentXpReward === undefined) {
      if (!timeline) {
        throw new Error("Skill task is missing its action timing modifiers");
      }
      const actionStart = intervalStartMs + consumedMs;
      const modifiers = getSkillModifiersAt(
        timeline,
        snapshot.skillCategory,
        actionStart
      );
      currentDuration = getSkillActionDurationMs(
        snapshot.baseExperienceReward,
        msPerXp,
        modifiers.speedMultiplier
      );
      const xpReward = Math.round(
        snapshot.baseExperienceReward * modifiers.xpMultiplier
      );
      if (!Number.isSafeInteger(xpReward) || xpReward < 0) {
        throw new Error("Skill bonus produced an invalid experience reward");
      }
      currentXpReward = xpReward;
      currentProgress = 0;
    }

    const actionRemainingMs = currentDuration - currentProgress;
    const stepMs = Math.min(
      actionRemainingMs,
      availableMs - consumedMs,
      remainingTaskMs
    );
    consumedMs += stepMs;
    currentProgress += stepMs;
    if (currentProgress < currentDuration) {
      break;
    }

    if (snapshot.actionType === "augmentation") {
      if (!snapshot.augmentation) {
        throw new Error("Augmentation task is missing its target snapshot");
      }
      failureReason = await applyQueuedAugmentation(
        ctx,
        task.playerId,
        snapshot.augmentation,
        now
      ) ?? undefined;
      if (failureReason) break;
    } else if (snapshot.actionType === "gathering") {
      if (!snapshot.gathering) {
        throw new Error("Gathering task is missing its output snapshot");
      }
      const yieldRange =
        snapshot.gathering.maxYield - snapshot.gathering.minYield + 1;
      const quantity =
        snapshot.gathering.minYield +
        Math.floor(Math.random() * yieldRange);
      const outputItemId = snapshot.gathering.outputItemId;
      gatheringQuantities.set(
        outputItemId,
        addSafeInteger(
          gatheringQuantities.get(outputItemId) ?? 0,
          quantity,
          "gathering output"
        )
      );
    }

    actionCountThisCall += 1;
    experienceThisCall = addSafeInteger(
      experienceThisCall,
      currentXpReward,
      "experience reward"
    );
    currentDuration = undefined;
    currentProgress = 0;
    currentXpReward = undefined;

    if (actionCountThisCall >= MAX_SKILL_ACTIONS_PER_RESOLUTION) {
      deferred =
        consumedMs < availableMs &&
        (isDurationBasedGathering
          ? task.progressMs + consumedMs < (targetDurationMs ?? 0)
          : completedActions + actionCountThisCall <
            (targetActionCount ?? 0));
      break;
    }
    complete =
      isDurationBasedGathering
        ? task.progressMs + consumedMs >= (targetDurationMs ?? 0)
        : completedActions + actionCountThisCall >= (targetActionCount ?? 0);
  }

  const progressMs = addSafeInteger(
    task.progressMs,
    consumedMs,
    "progress"
  );
  if (
    isDurationBasedGathering &&
    progressMs >= (targetDurationMs ?? 0)
  ) {
    complete = true;
    currentDuration = undefined;
    currentProgress = 0;
    currentXpReward = undefined;
  }

  if (failureReason) {
    return {
      consumedMs,
      complete: false,
      deferred: false,
      failureReason,
      progressMs,
      durationMs: task.durationMs ?? progressMs,
      payload,
    };
  }

  let nextOutputSummary = outputSummary;
  const producedQuantities = new Map<Id<"items">, number>(
    gatheringQuantities
  );
  if (snapshot.actionType === "crafting" && actionCountThisCall > 0) {
    if (!snapshot.recipe) {
      throw new Error("Crafting task is missing its output snapshot");
    }
    for (const output of snapshot.recipe.outputs) {
      const quantity = output.quantity * actionCountThisCall;
      if (!Number.isSafeInteger(quantity)) {
        throw new Error("Crafting output quantity exceeds the supported limit");
      }
      producedQuantities.set(
        output.itemId,
        addSafeInteger(
          producedQuantities.get(output.itemId) ?? 0,
          quantity,
          "crafting output"
        )
      );
    }
  }

  if (actionCountThisCall > 0) {
    const playerSkill = await ensurePlayerSkill(
      ctx,
      task.playerId,
      snapshot.skillId,
      now
    );
    if (!playerSkill) {
      throw new Error("Unable to initialize player skill");
    }
    const skill = await getSkillDefinition(ctx, snapshot.skillId);
    if (!skill) throw new Error("Skill definition not found");
    const xpBase = readSkillXpBase(
      await getBalanceValue(ctx, SKILL_XP_BALANCE_DEFAULT.key)
    );
    const { level, experience } = applySkillExperience(
      playerSkill.level,
      playerSkill.experience,
      experienceThisCall,
      skill.maxLevel,
      xpBase
    );
    const totalExperience = addSafeInteger(
      playerSkill.totalExperience,
      experienceThisCall,
      "total experience"
    );
    await ctx.db.patch(playerSkill._id, {
      level,
      experience,
      totalExperience,
      actionsCompleted: addSafeInteger(
        playerSkill.actionsCompleted,
        actionCountThisCall,
        "completed action count"
      ),
      updatedAt: now,
    });

    const sourceType = snapshot.actionType === "gathering" ? "skill" : "crafting";
    const sourceId = snapshot.recipe?.recipeId ?? snapshot.actionId;
    const completionKey = `${task._id}:skill`;
    for (const [itemId, quantity] of producedQuantities) {
      const grant = await grantItemToInventory(ctx, {
        playerId: task.playerId,
        itemId,
        quantity,
        overflowSource: {
          sourceType,
          sourceId,
          settlementKey: completionKey,
        },
      });
      const existingOutput = nextOutputSummary.find(
        (output) => output.itemId === itemId
      );
      if (existingOutput) {
        existingOutput.quantity = addSafeInteger(
          existingOutput.quantity,
          quantity,
          "output summary"
        );
        existingOutput.pending = addSafeInteger(
          existingOutput.pending,
          grant.pending,
          "pending output summary"
        );
      } else {
        nextOutputSummary.push({
          itemId,
          quantity,
          pending: grant.pending,
        });
      }
    }

    payload.completedActions = addSafeInteger(
      completedActions,
      actionCountThisCall,
      "completed action count"
    );
    payload.totalExperienceEarned = addSafeInteger(
      totalExperienceEarned,
      experienceThisCall,
      "total experience"
    );
    payload.outputSummary = nextOutputSummary;
  }

  if (currentDuration === undefined) {
    delete payload.currentActionDurationMs;
  } else {
    payload.currentActionDurationMs = currentDuration;
  }
  payload.currentActionProgressMs = currentProgress;
  if (currentXpReward === undefined) {
    delete payload.currentActionXpReward;
  } else {
    payload.currentActionXpReward = currentXpReward;
  }

  const completedActionTotal = completedActions + actionCountThisCall;
  complete =
    isDurationBasedGathering
      ? progressMs >= (targetDurationMs ?? 0)
      : completedActionTotal >= (targetActionCount ?? 0);
  let durationMs: number;
  if (isDurationBasedGathering) {
    durationMs = targetDurationMs ?? progressMs;
  } else if (complete) {
    durationMs = Math.max(1, progressMs);
  } else if (timeline) {
    const currentModifiers = getSkillModifiersAt(
      timeline,
      snapshot.skillCategory,
      intervalStartMs + consumedMs
    );
    const estimatedActionDuration = getSkillActionDurationMs(
      snapshot.baseExperienceReward,
      msPerXp,
      currentModifiers.speedMultiplier
    );
    const currentActionRemaining =
      currentDuration === undefined
        ? 0
        : Math.max(0, currentDuration - currentProgress);
    const remainingActions =
      (targetActionCount ?? completedActionTotal) - completedActionTotal;
    const actionsWithoutCurrent =
      Math.max(0, remainingActions - (currentDuration === undefined ? 0 : 1));
    durationMs = Math.max(
      1,
      progressMs +
        currentActionRemaining +
        actionsWithoutCurrent * estimatedActionDuration
    );
  } else {
    durationMs = task.durationMs ?? Math.max(1, progressMs);
  }
  if (!Number.isSafeInteger(durationMs)) {
    durationMs = Number.MAX_SAFE_INTEGER;
  }

  let skillResult: Record<string, unknown> | undefined;
  if (complete) {
    const result: Record<string, unknown> = {
      actionType: snapshot.actionType,
      actionId: snapshot.actionId,
      skillId: snapshot.skillId,
      completedActions: addSafeInteger(
        completedActions,
        actionCountThisCall,
        "completed action count"
      ),
      experienceEarned: payload.totalExperienceEarned ?? totalExperienceEarned,
      outputs: payload.outputSummary ?? outputSummary,
    };
    if (snapshot.augmentation) {
      result.augmentationId = snapshot.augmentation.augmentationId;
      result.targetPlayerItemId = snapshot.augmentation.targetPlayerItemId;
    }
    const completionKey = `${task._id}:skill`;
    const existing = await ctx.db
      .query("skillActionHistory")
      .withIndex("by_completionKey", (q) =>
        q.eq("completionKey", completionKey)
      )
      .first();
    if (existing) {
      skillResult = isRecord(existing.result) ? existing.result : result;
    } else {
      await ctx.db.insert("skillActionHistory", {
        playerId: task.playerId,
        taskId: task._id,
        actionType: snapshot.actionType,
        actionId: snapshot.actionId,
        status: "completed",
        completionKey,
        result,
        createdAt: now,
      });
      skillResult = result;
    }
  }

  return {
    consumedMs,
    complete,
    deferred,
    progressMs,
    durationMs,
    payload,
    ...(skillResult === undefined ? {} : { skillResult }),
  };
}

export async function refundSkillTaskReservation(
  ctx: MutationCtx,
  task: Doc<"playerTasks">
) {
  if (!isRecord(task.payload)) {
    return null;
  }
  const actionType = task.payload.actionType;
  if (actionType === "gathering") return null;
  if (actionType !== "crafting" && actionType !== "augmentation") {
    return null;
  }
  const actionId = task.payload.actionId;
  if (typeof actionId !== "string" || actionId.length === 0) {
    throw new Error("Skill task has an invalid action payload");
  }
  const targetActionCount =
    task.payload.targetActionCount === undefined
      ? 1
      : readNonNegativeInteger(
          task.payload.targetActionCount,
          "target action count"
        );
  const completedActions = readNonNegativeInteger(
    task.payload.completedActions ?? 0,
    "completed action count"
  );
  const remainingActions = Math.max(
    0,
    targetActionCount - completedActions
  );
  if (remainingActions === 0) return [];
  const reservedIngredients = task.payload.reservedIngredients;
  let ingredients: ReservedIngredient[];
  let sourceId = actionId;
  if (reservedIngredients !== undefined) {
    if (!Array.isArray(reservedIngredients)) {
      throw new Error("Skill task has an invalid ingredient reservation");
    }
    ingredients = reservedIngredients.map((ingredient) => {
      if (
        !isRecord(ingredient) ||
        typeof ingredient.itemId !== "string" ||
        !Number.isSafeInteger(ingredient.quantity) ||
        (ingredient.quantity as number) < 1
      ) {
        throw new Error("Skill task has an invalid ingredient reservation");
      }
      return {
        itemId: ingredient.itemId as Id<"items">,
        quantity: ingredient.quantity as number,
      };
    });
  } else if (actionType === "crafting") {
    const recipe = await getRecipe(ctx, actionId);
    if (!recipe) {
      throw new Error("Crafting recipe for cancelled task no longer exists");
    }
    ingredients = await getRecipeIngredients(ctx, recipe.recipeId);
    sourceId = recipe.recipeId;
  } else {
    const definition = await ctx.db
      .query("augmentationDefinitions")
      .withIndex("by_augmentationId", (q) =>
        q.eq("augmentationId", actionId)
      )
      .first();
    if (!definition) {
      throw new Error("Augmentation for cancelled task no longer exists");
    }
    ingredients = combineIngredients([
      {
        itemId: definition.requiredMaterialItemId,
        quantity: definition.requiredMaterialQuantity,
      },
      ...(definition.bossCatalystItemId !== undefined &&
      definition.bossCatalystQuantity !== undefined
        ? [{
            itemId: definition.bossCatalystItemId,
            quantity: definition.bossCatalystQuantity,
          }]
        : []),
    ]);
  }
  const settlementKey = `${task._id}:cancelled`;
  const refunded = [];
  for (const ingredient of ingredients) {
    const quantity = ingredient.quantity * remainingActions;
    if (!Number.isSafeInteger(quantity)) {
      throw new Error("Reserved ingredient refund exceeds the supported limit");
    }
    const grant = await grantItemToInventory(ctx, {
      playerId: task.playerId,
      itemId: ingredient.itemId,
      quantity,
      overflowSource: {
        sourceType: "crafting",
        sourceId,
        settlementKey,
      },
    });
    refunded.push({
      itemId: ingredient.itemId,
      quantity,
      pending: grant.pending,
    });
  }
  return refunded;
}

export const getSkillPanel = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    await getPlayer(ctx, playerId);
    const [
      definitions,
      tiers,
      activities,
      recipes,
      augmentations,
      playerSkills,
    ] = await Promise.all([
      ctx.db.query("skillDefinitions").withIndex("by_enabled", (q) => q.eq("enabled", true)).take(MAX_SKILL_PANEL_ROWS),
      ctx.db.query("skillTierDefinitions").withIndex("by_enabled", (q) => q.eq("enabled", true)).take(MAX_SKILL_PANEL_ROWS),
      ctx.db.query("gatheringActivities").withIndex("by_enabled", (q) => q.eq("enabled", true)).take(MAX_SKILL_PANEL_ROWS),
      ctx.db.query("recipes").withIndex("by_enabled", (q) => q.eq("enabled", true)).take(MAX_SKILL_PANEL_ROWS),
      ctx.db.query("augmentationDefinitions").withIndex("by_enabled", (q) => q.eq("enabled", true)).take(MAX_SKILL_PANEL_ROWS),
      ctx.db.query("playerSkills").withIndex("by_playerId", (q) => q.eq("playerId", playerId)).take(MAX_SKILL_PANEL_ROWS),
    ]);
    const enabledSkillIds = new Set(definitions.map((skill) => skill.skillId));
    const enabledSkillTiers = new Set(
      tiers.map((tier) => `${tier.skillId}:${tier.tier}`)
    );
    const visibleTiers = tiers.filter((tier) =>
      enabledSkillIds.has(tier.skillId)
    );
    const visibleActivities = activities.filter((activity) =>
      enabledSkillIds.has(activity.skillId) &&
      enabledSkillTiers.has(`${activity.skillId}:${activity.tier}`)
    );
    const visibleRecipes = recipes.filter((recipe) =>
      enabledSkillIds.has(recipe.skillId) &&
      enabledSkillTiers.has(`${recipe.skillId}:${recipe.tier}`)
    );
    const visibleAugmentations = augmentations.filter((augmentation) =>
      enabledSkillIds.has(augmentation.skillId) &&
      enabledSkillTiers.has(`${augmentation.skillId}:${augmentation.tier}`)
    );
    const recipeDetails = await Promise.all(
      visibleRecipes.map(async (recipe) => {
        const [ingredients, outputs] = await Promise.all([
          getRecipeIngredients(ctx, recipe.recipeId),
          getRecipeOutputs(ctx, recipe.recipeId),
        ]);
        return {
          ...recipe,
          ingredients: await Promise.all(
            ingredients.map(async (ingredient) => ({
              ...ingredient,
              item: await ctx.db.get(ingredient.itemId),
            }))
          ),
          outputs: await Promise.all(
            outputs.map(async (output) => ({
              ...output,
              item: await ctx.db.get(output.itemId),
            }))
          ),
        };
      })
    );
    const activityDetails = await Promise.all(
      visibleActivities.map(async (activity) => ({
        ...activity,
        outputItem: await ctx.db.get(activity.outputItemId),
      }))
    );
    const augmentationDetails = await Promise.all(
      visibleAugmentations.map(async (augmentation) => ({
        ...augmentation,
        experienceReward:
          augmentation.experienceReward ?? 50 * augmentation.tier,
        requiredMaterialItem: await ctx.db.get(
          augmentation.requiredMaterialItemId
        ),
        bossCatalystItem:
          augmentation.bossCatalystItemId === undefined
            ? null
            : await ctx.db.get(augmentation.bossCatalystItemId),
      }))
    );
    const [xpBaseValue, skillTaskMsPerXp] = await Promise.all([
      getBalanceValue(ctx, SKILL_XP_BALANCE_DEFAULT.key),
      readSkillTaskMsPerXp(ctx),
    ]);
    const skillXpBase = readSkillXpBase(xpBaseValue);
    return {
      definitions,
      tiers: visibleTiers,
      activities: activityDetails,
      recipes: recipeDetails,
      augmentations: augmentationDetails,
      playerSkills: playerSkills.map((playerSkill) => ({
        ...playerSkill,
        xpRequiredForNextLevel: getSkillXpRequiredForLevel(
          playerSkill.level,
          skillXpBase
        ),
      })),
      skillXpBase,
      skillTaskMsPerXp,
      maxSkillBatchSize: MAX_SKILL_BATCH_SIZE,
    };
  },
});
