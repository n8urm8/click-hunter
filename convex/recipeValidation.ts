import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export type RecipeStage = "refinement" | "product";

type RecipeRows = {
  ingredients: Array<{ itemId: Id<"items">; quantity: number }>;
  outputs: Array<{ itemId: Id<"items">; quantity: number }>;
};

const MONSTER_DROP_FAMILIES = new Set([
  "monster-drop",
  "monster-augmentation",
  "monster-material",
]);
const EFFECT_STATS = new Set(["str", "dex", "int", "luk", "con"]);

async function rowsForRecipe(
  ctx: MutationCtx,
  recipeId: string
): Promise<RecipeRows> {
  const [ingredients, outputs] = await Promise.all([
    ctx.db
      .query("recipeIngredients")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
      .collect(),
    ctx.db
      .query("recipeOutputs")
      .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
      .collect(),
  ]);
  return { ingredients, outputs };
}

function containsItem(
  itemIds: Set<Id<"items">>,
  rows: Array<{ itemId: Id<"items"> }>
) {
  return rows.some((row) => itemIds.has(row.itemId));
}

async function findRecipe(
  ctx: MutationCtx,
  skillId: string,
  tier: number,
  stage: RecipeStage,
  outputFamily: string
) {
  const recipes = await ctx.db
    .query("recipes")
    .withIndex("by_skillId_and_tier", (q) =>
      q.eq("skillId", skillId).eq("tier", tier)
    )
    .collect();
  return recipes.find(
    (recipe) =>
      recipe.stage === stage && recipe.outputFamily === outputFamily
  );
}

async function validateOutputMetadata(
  ctx: MutationCtx,
  recipe: {
    skillId: string;
    tier: number;
    stage?: RecipeStage;
    outputFamily?: string;
  },
  outputIds: Set<Id<"items">>
) {
  if (outputIds.size === 0) {
    throw new Error("Recipe must define at least one output");
  }
  if (!recipe.outputFamily) {
    throw new Error("Progression recipes require an output family");
  }

  const outputItems = await Promise.all(
    Array.from(outputIds, (itemId) => ctx.db.get(itemId))
  );
  if (outputItems.some((item) => !item)) {
    throw new Error("Recipe output references a missing item");
  }

  const items = outputItems.filter(
    (item): item is NonNullable<typeof item> => item !== null
  );
  const families = new Set(
    items.map((item) => item.itemFamily).filter((family) => family !== undefined)
  );
  if (families.size !== items.length) {
    throw new Error(
      "Progression recipe outputs must define an item family for every output"
    );
  }
  if (families.size > 1) {
    throw new Error("Progression recipe outputs must use one item family");
  }

  for (const item of items) {
    if (
      item.craftingSkillId !== recipe.skillId ||
      item.craftingTier !== recipe.tier
    ) {
      throw new Error(
        `Output ${item.itemId} must be tagged for ${recipe.skillId} tier ${recipe.tier}`
      );
    }
    if (recipe.stage === "refinement" && item.category !== "crafting") {
      throw new Error("Refinement recipes can only produce crafting materials");
    }
    if (recipe.stage === "refinement" && !item.stackable) {
      throw new Error("Refinement outputs must be stackable crafting materials");
    }
    if (item.category === "crafting" && item.allowedEquipmentSlots.length > 0) {
      throw new Error("Crafting outputs cannot define equipment slots");
    }
    if (item.itemFamily !== recipe.outputFamily) {
      throw new Error(
        `Output ${item.itemId} must match recipe family ${recipe.outputFamily}`
      );
    }
    if (!item.stackable && item.maxStackSize !== 1) {
      throw new Error("Non-stackable outputs must have a maximum stack size of 1");
    }
    if (
      item.category === "equipment" &&
      item.allowedEquipmentSlots.length === 0
    ) {
      throw new Error("Equipment outputs must define an equipment slot");
    }
    if (item.category === "equipment" && item.stackable) {
      throw new Error("Equipment outputs cannot be stackable");
    }
    if (
      item.effectAmount !== undefined &&
      (!Number.isFinite(item.effectAmount) || item.effectAmount < 0)
    ) {
      throw new Error("Output effect amounts must be non-negative numbers");
    }
    if (
      item.effectDurationMs !== undefined &&
      (!Number.isSafeInteger(item.effectDurationMs) || item.effectDurationMs < 1)
    ) {
      throw new Error("Output effect durations must be positive integers");
    }
    if (item.effectDurationMs !== undefined && item.effectType === undefined) {
      throw new Error("Output effect durations require an effect type");
    }
    if (
      item.effectStat !== undefined &&
      !EFFECT_STATS.has(item.effectStat)
    ) {
      throw new Error("Output effect stats must use a supported stat");
    }
    if (
      item.effectType === "stat-bonus" &&
      (item.effectStat === undefined || item.effectAmount === undefined)
    ) {
      throw new Error("Stat-bonus outputs require an effect stat and amount");
    }
  }
}

async function validateRecipeCycles(ctx: MutationCtx) {
  const recipes = await ctx.db.query("recipes").collect();
  const [ingredientRows, outputRows] = await Promise.all([
    ctx.db.query("recipeIngredients").collect(),
    ctx.db.query("recipeOutputs").collect(),
  ]);
  const outputsByItem = new Map<Id<"items">, string[]>();
  for (const row of outputRows) {
    const producers = outputsByItem.get(row.itemId) ?? [];
    producers.push(row.recipeId);
    outputsByItem.set(row.itemId, producers);
  }
  const ingredientsByRecipe = new Map<string, Id<"items">[]>();
  for (const row of ingredientRows) {
    const ingredients = ingredientsByRecipe.get(row.recipeId) ?? [];
    ingredients.push(row.itemId);
    ingredientsByRecipe.set(row.recipeId, ingredients);
  }
  const recipeIds = new Set(recipes.map((recipe) => recipe.recipeId));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (recipeId: string, path: string[]) => {
    if (visiting.has(recipeId)) {
      const cycleStart = path.indexOf(recipeId);
      const cycle = [...path.slice(cycleStart), recipeId].join(" -> ");
      throw new Error(`Recipe dependency cycle detected: ${cycle}`);
    }
    if (visited.has(recipeId)) return;

    visiting.add(recipeId);
    for (const itemId of ingredientsByRecipe.get(recipeId) ?? []) {
      for (const producer of outputsByItem.get(itemId) ?? []) {
        if (recipeIds.has(producer)) {
          visit(producer, [...path, recipeId]);
        }
      }
    }
    visiting.delete(recipeId);
    visited.add(recipeId);
  };

  for (const recipe of recipes) {
    visit(recipe.recipeId, []);
  }
}

/**
 * Validates the refinement/product progression contract after recipe rows have
 * been written. Legacy recipes without a stage remain valid and are skipped.
 */
export async function validateRecipeChain(
  ctx: MutationCtx,
  recipeId: string
) {
  const recipe = await ctx.db
    .query("recipes")
    .withIndex("by_recipeId", (q) => q.eq("recipeId", recipeId))
    .first();
  if (!recipe) throw new Error("Recipe not found");

  if (recipe.stage === undefined) {
    if (recipe.requiresMonsterDrop) {
      throw new Error("Only product recipes can require monster drops");
    }
    return;
  }

  const { ingredients, outputs } = await rowsForRecipe(ctx, recipeId);
  if (ingredients.length === 0 || outputs.length === 0) {
    throw new Error("Progression recipes require ingredients and outputs");
  }
  const outputIds = new Set(outputs.map((output) => output.itemId));
  await validateOutputMetadata(ctx, recipe, outputIds);

  if (recipe.stage === "refinement") {
    if (recipe.requiresMonsterDrop) {
      throw new Error("Refinement recipes cannot require monster drops");
    }
    const skill = await ctx.db
      .query("skillDefinitions")
      .withIndex("by_skillId", (q) => q.eq("skillId", recipe.skillId))
      .first();
    if (!skill?.pairedSkillId) {
      throw new Error("Refinement recipes require a paired gathering skill");
    }
    const activities = await ctx.db
      .query("gatheringActivities")
      .withIndex("by_skillId_and_tier", (q) =>
        q.eq("skillId", skill.pairedSkillId!).eq("tier", recipe.tier)
      )
      .collect();
    const gatheredIds = new Set(activities.map((activity) => activity.outputItemId));
    if (!containsItem(gatheredIds, ingredients)) {
      throw new Error(
        "Refinement recipes must use a material gathered at the same tier"
      );
    }
  } else {
    const refinementRecipes = await ctx.db
      .query("recipes")
      .withIndex("by_skillId_and_tier", (q) =>
        q.eq("skillId", recipe.skillId).eq("tier", recipe.tier)
      )
      .collect();
    const refinementOutputs = new Set<Id<"items">>();
    for (const refinement of refinementRecipes.filter(
      (candidate) => candidate.stage === "refinement"
    )) {
      const rows = await rowsForRecipe(ctx, refinement.recipeId);
      for (const output of rows.outputs) refinementOutputs.add(output.itemId);
    }
    if (!containsItem(refinementOutputs, ingredients)) {
      throw new Error(
        "Product recipes must use a refined material from the same tier"
      );
    }

    if (recipe.requiresMonsterDrop) {
      const ingredientItems = await Promise.all(
        ingredients.map((ingredient) => ctx.db.get(ingredient.itemId))
      );
      const hasMonsterDrop = ingredientItems.some((item) => {
        const family = item?.itemFamily;
        return family !== undefined && MONSTER_DROP_FAMILIES.has(family);
      });
      if (!hasMonsterDrop) {
        throw new Error(
          "Hybrid product recipes must use a themed monster drop ingredient"
        );
      }
    }
  }

  if (recipe.tier > 1) {
    const previous = await findRecipe(
      ctx,
      recipe.skillId,
      recipe.tier - 1,
      recipe.stage,
      recipe.outputFamily!
    );
    if (!previous) {
      throw new Error(
        `Tier ${recipe.tier} requires a tier ${recipe.tier - 1} ${recipe.stage} recipe in the same family`
      );
    }
    const previousRows = await rowsForRecipe(ctx, previous.recipeId);
    const previousOutputIds = new Set(
      previousRows.outputs.map((output) => output.itemId)
    );
    if (!containsItem(previousOutputIds, ingredients)) {
      throw new Error(
        `Tier ${recipe.tier} recipes must use the previous tier ${recipe.stage} output`
      );
    }
  }

  await validateRecipeCycles(ctx);
}

export async function validateAllRecipeChains(ctx: MutationCtx) {
  const recipes = await ctx.db.query("recipes").collect();
  for (const recipe of recipes) {
    if (recipe.stage !== undefined) {
      await validateRecipeChain(ctx, recipe.recipeId);
    }
  }
}
