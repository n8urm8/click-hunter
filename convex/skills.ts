import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  consumeItems,
  grantItemToInventory,
} from "./items";
import { validateRecipeChain } from "./recipeValidation";

type DatabaseCtx = QueryCtx | MutationCtx;
type PlayerId = Id<"players">;
type SkillActionType = "gathering" | "crafting";

const DEFAULT_SKILL_XP_PER_LEVEL = 100;
const MAX_SKILL_PANEL_ROWS = 200;

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

function getSkillXpPerLevel(value: unknown) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1
    ? value
    : DEFAULT_SKILL_XP_PER_LEVEL;
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

export async function prepareSkillAction(
  ctx: MutationCtx,
  playerId: PlayerId,
  actionType: SkillActionType,
  actionId: string
) {
  await getPlayer(ctx, playerId);
  if (actionType === "gathering") {
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
    return {
      actionType,
      actionId,
      skillId: activity.skillId,
      displayName: activity.name,
      durationMs: activity.durationMs,
    };
  }

  const recipe = await getRecipe(ctx, actionId);
  if (!recipe || !recipe.enabled) {
    throw new Error("Recipe not found or disabled");
  }
  await assertSkillTierUnlocked(ctx, playerId, recipe.skillId, recipe.tier);
  await validateRecipeChain(ctx, recipe.recipeId);
  const ingredients = await getRecipeIngredients(ctx, recipe.recipeId);
  if (ingredients.length === 0) {
    throw new Error("Recipe has no ingredients");
  }
  const outputs = await getRecipeOutputs(ctx, recipe.recipeId);
  if (outputs.length === 0) {
    throw new Error("Recipe has no outputs");
  }
  const outputSnapshots = await Promise.all(
    outputs.map(async (output) => {
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
  await consumeItems(
    ctx,
    playerId,
    ingredients.map((ingredient) => ({
      itemId: ingredient.itemId,
      quantity: ingredient.quantity,
    }))
  );
  return {
    actionType,
    actionId,
    skillId: recipe.skillId,
    displayName: recipe.name,
    durationMs: recipe.durationMs,
    reservedIngredients: ingredients.map((ingredient) => ({
      itemId: ingredient.itemId,
      quantity: ingredient.quantity,
    })),
    recipeSnapshot: {
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
    value.experienceReward < 0 ||
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
  const xpPerLevel = getSkillXpPerLevel(
    await getBalanceValue(ctx, "skillXpPerLevel")
  );
  let level = playerSkill.level;
  let experience = playerSkill.experience + xpReward;
  const totalExperience = playerSkill.totalExperience + xpReward;
  while (level < skill.maxLevel && experience >= xpPerLevel) {
    experience -= xpPerLevel;
    level += 1;
  }

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

export async function refundCraftingTaskReservation(
  ctx: MutationCtx,
  task: Doc<"playerTasks">
) {
  if (!isRecord(task.payload) || task.payload.actionType !== "crafting") {
    return null;
  }
  const actionId = task.payload.actionId;
  if (typeof actionId !== "string" || actionId.length === 0) {
    throw new Error("Crafting task has an invalid action payload");
  }
  const reservedIngredients = task.payload.reservedIngredients;
  let ingredients: Array<{
    itemId: Id<"items">;
    quantity: number;
  }>;
  let sourceId = actionId;
  if (reservedIngredients !== undefined) {
    if (!Array.isArray(reservedIngredients)) {
      throw new Error("Crafting task has an invalid ingredient reservation");
    }
    ingredients = reservedIngredients.map((ingredient) => {
      if (
        !isRecord(ingredient) ||
        typeof ingredient.itemId !== "string" ||
        typeof ingredient.quantity !== "number" ||
        !Number.isSafeInteger(ingredient.quantity) ||
        ingredient.quantity < 1
      ) {
        throw new Error("Crafting task has an invalid ingredient reservation");
      }
      return {
        itemId: ingredient.itemId as Id<"items">,
        quantity: ingredient.quantity,
      };
    });
  } else {
    const recipe = await getRecipe(ctx, actionId);
    if (!recipe) {
      throw new Error("Crafting recipe for cancelled task no longer exists");
    }
    ingredients = await getRecipeIngredients(ctx, recipe.recipeId);
    sourceId = recipe.recipeId;
  }
  const settlementKey = `${task._id}:cancelled`;
  const refunded = [];
  for (const ingredient of ingredients) {
    const grant = await grantItemToInventory(ctx, {
      playerId: task.playerId,
      itemId: ingredient.itemId,
      quantity: ingredient.quantity,
      overflowSource: {
        sourceType: "crafting",
        sourceId,
        settlementKey,
      },
    });
    refunded.push({
      itemId: ingredient.itemId,
      quantity: ingredient.quantity,
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
        requiredMaterialItem: await ctx.db.get(
          augmentation.requiredMaterialItemId
        ),
        bossCatalystItem:
          augmentation.bossCatalystItemId === undefined
            ? null
            : await ctx.db.get(augmentation.bossCatalystItemId),
      }))
    );
    const xpPerLevel = getSkillXpPerLevel(
      await getBalanceValue(ctx, "skillXpPerLevel")
    );
    return {
      definitions,
      tiers: visibleTiers,
      activities: activityDetails,
      recipes: recipeDetails,
      augmentations: augmentationDetails,
      playerSkills,
      xpPerLevel,
    };
  },
});

export const augmentEquipment = mutation({
  args: {
    playerId: v.id("players"),
    playerItemId: v.id("playerItems"),
    augmentationId: v.string(),
  },
  handler: async (ctx, { playerId, playerItemId, augmentationId }) => {
    const ownedItem = await ctx.db.get(playerItemId);
    if (
      !ownedItem ||
      ownedItem.playerId !== playerId ||
      ownedItem.quantity !== 1
    ) {
      throw new Error("Equipment item not found");
    }
    const item = await ctx.db.get(ownedItem.itemId);
    if (!item || item.category !== "equipment") {
      throw new Error("Only equipment can be augmented");
    }

    const definition = await ctx.db
      .query("augmentationDefinitions")
      .withIndex("by_augmentationId", (q) =>
        q.eq("augmentationId", augmentationId)
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
    if (
      definition.baseItemFamily !== undefined &&
      item.itemFamily !== definition.baseItemFamily
    ) {
      throw new Error("This augmentation does not fit that equipment family");
    }
    if (
      definition.allowedEquipmentSlots.length > 0 &&
      !definition.allowedEquipmentSlots.some((slot) =>
        item.allowedEquipmentSlots.includes(slot)
      )
    ) {
      throw new Error("This augmentation does not fit that equipment slot");
    }

    const existingAugments = await ctx.db
      .query("playerItemAugments")
      .withIndex("by_playerItemId", (q) => q.eq("playerItemId", playerItemId))
      .collect();
    const maxSlots = item.augmentSlots ?? 1;
    if (existingAugments.length >= maxSlots) {
      throw new Error("That equipment has no open augmentation slots");
    }
    if (
      existingAugments.some(
        (augment) => augment.augmentationId === augmentationId
      )
    ) {
      throw new Error("That augmentation is already applied");
    }

    const requirements = [
      {
        itemId: definition.requiredMaterialItemId,
        quantity: definition.requiredMaterialQuantity,
      },
    ];
    if (
      definition.bossCatalystItemId !== undefined &&
      definition.bossCatalystQuantity !== undefined
    ) {
      requirements.push({
        itemId: definition.bossCatalystItemId,
        quantity: definition.bossCatalystQuantity,
      });
    }
    await consumeItems(ctx, playerId, requirements);

    const appliedAt = Date.now();
    await ctx.db.insert("playerItemAugments", {
      playerId,
      playerItemId,
      augmentationId,
      name: definition.name,
      effectType: definition.effectType,
      ...(definition.effectStat === undefined
        ? {}
        : { effectStat: definition.effectStat }),
      effectAmount: definition.effectAmount,
      appliedAt,
    });
    return { applied: true, augmentationId };
  },
});
