import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { usePlayerInventory } from "~/hooks/useInventory";
import { useEnqueueSkillAction } from "~/hooks/useTasks";
import { useAugmentEquipment, useSkillPanel } from "~/hooks/useSkills";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import type { Id } from "../../../convex/_generated/dataModel";

interface SkillsPanelProps {
  playerId: Id<"players">;
}

type SkillPanelData = NonNullable<ReturnType<typeof useSkillPanel>["data"]>;
type SkillDefinition = SkillPanelData["definitions"][number];
type SkillState = SkillPanelData["playerSkills"][number];
type TierDefinition = SkillPanelData["tiers"][number];
type GatheringActivity = SkillPanelData["activities"][number];
type RecipeDefinition = SkillPanelData["recipes"][number];
type AugmentationDefinition = SkillPanelData["augmentations"][number];
type InventoryData = NonNullable<
  ReturnType<typeof usePlayerInventory>["data"]
>;
type OwnedItem = InventoryData["inventory"][number];
type EquipmentChoice = {
  ownedItem: OwnedItem;
  label: string;
};

function errorMessage(
  error: unknown,
  fallback = "Unable to start skill action."
) {
  return error instanceof Error ? error.message : fallback;
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(1, Math.ceil(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function skillState(
  data: SkillPanelData,
  skillId: string
): SkillState | null {
  return data.playerSkills.find((skill) => skill.skillId === skillId) ?? null;
}

function tierFor(
  tiers: SkillPanelData["tiers"],
  skillId: string,
  tier: number
): TierDefinition | null {
  return (
    tiers.find(
      (definition) =>
        definition.skillId === skillId && definition.tier === tier
    ) ?? null
  );
}

function ItemLabel({
  item,
  quantity,
}: {
  item: { name: string } | null;
  quantity: number;
}) {
  return (
    <span className="text-xs text-foreground/80">
      {quantity}x {item?.name ?? "Unknown item"}
    </span>
  );
}

function recipeStageLabel(stage: "refinement" | "product" | undefined) {
  if (stage === "refinement") return "Refinement";
  if (stage === "product") return "Finished item";
  return "Recipe";
}

function equipmentSlotLabel(slot: string) {
  return slot
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
}

function isCompatibleEquipment(
  ownedItem: OwnedItem,
  augmentation: AugmentationDefinition
) {
  const item = ownedItem.item;
  return (
    item.category === "equipment" &&
    (item.augmentSlots ?? 1) > ownedItem.augments.length &&
    (augmentation.baseItemFamily === undefined ||
      augmentation.baseItemFamily === item.itemFamily) &&
    (augmentation.allowedEquipmentSlots.length === 0 ||
      augmentation.allowedEquipmentSlots.some((slot) =>
        item.allowedEquipmentSlots.includes(slot)
      )) &&
    !ownedItem.augments.some(
      (applied) => applied.augmentationId === augmentation.augmentationId
    )
  );
}

function SkillSummary({
  skill,
  state,
  xpPerLevel,
}: {
  skill: SkillDefinition;
  state: SkillState | null;
  xpPerLevel: number;
}) {
  const level = state?.level ?? 1;
  const experience = state?.experience ?? 0;
  const progress = Math.min(100, (experience / xpPerLevel) * 100);

  return (
    <div className="border border-forest-light/25 bg-forest-dark/35 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-lg text-gold-light">{skill.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
        </div>
        <span className="shrink-0 border border-gold/40 px-2 py-1 text-xs font-semibold text-gold">
          Level {level}
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden bg-forest-deep">
        <div
          className="h-full bg-gold transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>
          {experience} / {xpPerLevel} XP
        </span>
        <span>{state?.actionsCompleted ?? 0} actions</span>
      </div>
    </div>
  );
}

function TierBadge({
  tier,
  unlocked,
}: {
  tier: TierDefinition | null;
  unlocked: boolean;
}) {
  if (!tier) {
    return (
      <span className="border border-blood-light/30 px-1.5 py-0.5 text-[10px] text-blood-light">
        Tier unavailable
      </span>
    );
  }
  return (
    <span
      className={`border px-1.5 py-0.5 text-[10px] ${
        unlocked
          ? "border-forest-glow/40 text-forest-glow"
          : "border-forest-light/30 text-muted-foreground"
      }`}
    >
      T{tier.tier} · {unlocked ? "Unlocked" : `Level ${tier.requiredLevel}`}
    </span>
  );
}

export function SkillsPanel({ playerId }: SkillsPanelProps) {
  const panel = useSkillPanel(playerId);
  const inventory = usePlayerInventory(playerId);
  const enqueueSkillAction = useEnqueueSkillAction();
  const augmentEquipment = useAugmentEquipment();
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEquipmentByAugmentation, setSelectedEquipmentByAugmentation] =
    useState<Record<string, string>>({});

  const itemQuantities = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const ownedItem of inventory.data?.inventory ?? []) {
      quantities.set(
        ownedItem.itemId,
        (quantities.get(ownedItem.itemId) ?? 0) + ownedItem.quantity
      );
    }
    return quantities;
  }, [inventory.data?.inventory]);

  const equipmentChoices = useMemo<EquipmentChoice[]>(() => {
    const choices: EquipmentChoice[] = [];
    const seen = new Set<string>();

    const addChoice = (ownedItem: OwnedItem, label: string) => {
      if (seen.has(ownedItem._id)) return;
      seen.add(ownedItem._id);
      choices.push({ ownedItem, label });
    };

    for (const ownedItem of inventory.data?.inventory ?? []) {
      if (ownedItem.item.category === "equipment") {
        addChoice(ownedItem, `${ownedItem.item.name} · Backpack`);
      }
    }

    for (const equipment of inventory.data?.equipment ?? []) {
      if (equipment.item) {
        addChoice(
          equipment.item,
          `${equipment.item.item.name} · Equipped (${equipmentSlotLabel(
            equipment.slot
          )})`
        );
      }
    }

    return choices;
  }, [inventory.data?.equipment, inventory.data?.inventory]);

  if (panel.isPending) {
    return (
      <Card className="forest-card box-glow-green min-h-[400px] p-6">
        <div className="flex min-h-[348px] items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading skills...</p>
        </div>
      </Card>
    );
  }

  if (!panel.data) {
    return (
      <Card className="forest-card box-glow-green min-h-[400px] p-6">
        <div className="flex min-h-[348px] items-center justify-center">
          <p className="text-sm text-blood-light" role="alert">
            Unable to load skills.
          </p>
        </div>
      </Card>
    );
  }

  const data = panel.data;
  const activeSkill =
    data.definitions.find((skill) => skill.skillId === activeSkillId) ??
    data.definitions[0] ??
    null;

  if (!activeSkill) {
    return (
      <Card className="forest-card box-glow-green min-h-[400px] rounded-none p-4">
        <div className="flex min-h-[368px] items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No enabled skills are configured.
          </p>
        </div>
      </Card>
    );
  }

  const runAction = async (
    actionType: "gathering" | "crafting",
    actionId: string
  ) => {
    const key = `${actionType}:${actionId}`;
    setActiveAction(key);
    setError(null);
    try {
      await enqueueSkillAction({ playerId, actionType, actionId });
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setActiveAction(null);
    }
  };

  const applyAugmentation = async (
    augmentationId: string,
    playerItemId: Id<"playerItems">
  ) => {
    const key = `augmentation:${augmentationId}:${playerItemId}`;
    setActiveAction(key);
    setError(null);
    try {
      await augmentEquipment({ playerId, playerItemId, augmentationId });
    } catch (augmentationError) {
      setError(
        errorMessage(augmentationError, "Unable to apply augmentation.")
      );
    } finally {
      setActiveAction(null);
    }
  };

  const renderGatheringActivity = (
    skill: SkillDefinition,
    state: SkillState | null,
    activity: GatheringActivity
  ) => {
    const tier = tierFor(data.tiers, skill.skillId, activity.tier);
    const unlocked = (state?.level ?? 1) >= (tier?.requiredLevel ?? 1);
    const actionKey = `gathering:${activity.activityId}`;

    return (
      <div
        key={`activity:${activity._id}`}
        className="flex flex-col gap-3 border border-forest-light/20 bg-forest-dark/25 p-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-foreground">{activity.name}</h4>
            <TierBadge tier={tier} unlocked={unlocked} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {activity.description}
          </p>
          <p className="mt-2 text-xs text-forest-glow">
            Yields {activity.minYield}–{activity.maxYield}{" "}
            {activity.outputItem?.name ?? "resource"} ·{" "}
            {formatDuration(activity.durationMs)} · +{activity.experienceReward} XP
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!unlocked || activeAction !== null}
          onClick={() => void runAction("gathering", activity.activityId)}
        >
          {activeAction === actionKey ? "Queueing..." : "Gather"}
        </Button>
      </div>
    );
  };

  const renderRecipe = (
    skill: SkillDefinition,
    state: SkillState | null,
    recipe: RecipeDefinition
  ) => {
    const tier = tierFor(data.tiers, skill.skillId, recipe.tier);
    const unlocked = (state?.level ?? 1) >= (tier?.requiredLevel ?? 1);
    const hasIngredients = recipe.ingredients.every(
      (ingredient) =>
        (itemQuantities.get(ingredient.itemId) ?? 0) >= ingredient.quantity
    );
    const missingIngredients = recipe.ingredients.filter(
      (ingredient) =>
        (itemQuantities.get(ingredient.itemId) ?? 0) < ingredient.quantity
    );
    const actionKey = `crafting:${recipe.recipeId}`;
    const monsterDrop = recipe.ingredients.find((ingredient) =>
      ingredient.item?.itemFamily?.includes("monster")
    );

    return (
      <div
        key={`recipe:${recipe._id}`}
        className="border border-forest-light/20 bg-forest-dark/25 p-3"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-foreground">{recipe.name}</h4>
              <TierBadge tier={tier} unlocked={unlocked} />
              <span className="border border-gold/30 px-1.5 py-0.5 text-[10px] text-gold-light">
                {recipeStageLabel(recipe.stage)}
              </span>
              {recipe.requiresMonsterDrop && (
                <span className="border border-blood-light/40 px-1.5 py-0.5 text-[10px] text-blood-light">
                  Monster hybrid
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {recipe.description}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Uses
              </span>
              {recipe.ingredients.map((ingredient) => (
                <ItemLabel
                  key={ingredient._id}
                  item={ingredient.item}
                  quantity={ingredient.quantity}
                />
              ))}
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Makes
              </span>
              {recipe.outputs.map((output) => (
                <ItemLabel
                  key={output._id}
                  item={output.item}
                  quantity={output.quantity}
                />
              ))}
            </div>
            {monsterDrop && (
              <p className="mt-2 text-[11px] text-blood-light">
                Themed drop: {monsterDrop.item?.name ?? "monster material"}
              </p>
            )}
            {recipe.outputs.some(
              (output) => output.item?.effectType !== undefined
            ) && (
              <p className="mt-2 text-[11px] text-forest-glow">
                Effect metadata:{" "}
                {recipe.outputs
                  .filter((output) => output.item?.effectType)
                  .map((output) => {
                    const item = output.item!;
                    return `${item.effectType}${
                      item.effectAmount === undefined
                        ? ""
                        : ` +${item.effectAmount}`
                    }${
                      item.effectDurationMs === undefined
                        ? ""
                        : ` for ${formatDuration(item.effectDurationMs)}`
                    }`;
                  })
                  .join(", ")}
              </p>
            )}
            <p className="mt-2 text-xs text-forest-glow">
              {formatDuration(recipe.durationMs)} · +{recipe.experienceReward} XP
            </p>
            {missingIngredients.length > 0 && (
              <p className="mt-1 text-[11px] text-blood-light">
                Missing:{" "}
                {missingIngredients
                  .map(
                    (ingredient) =>
                      `${ingredient.quantity - (itemQuantities.get(ingredient.itemId) ?? 0)}x ${
                        ingredient.item?.name ?? "unknown material"
                      }`
                  )
                  .join(", ")}
              </p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!unlocked || !hasIngredients || activeAction !== null}
            onClick={() => void runAction("crafting", recipe.recipeId)}
          >
            {activeAction === actionKey ? "Queueing..." : "Craft"}
          </Button>
        </div>
      </div>
    );
  };

  const renderAugmentation = (
    skill: SkillDefinition,
    state: SkillState | null,
    augmentation: AugmentationDefinition
  ) => {
    const tier = tierFor(data.tiers, skill.skillId, augmentation.tier);
    const unlocked = (state?.level ?? 1) >= (tier?.requiredLevel ?? 1);
    const materialCount =
      itemQuantities.get(augmentation.requiredMaterialItemId) ?? 0;
    const catalystCount = augmentation.bossCatalystItemId
      ? itemQuantities.get(augmentation.bossCatalystItemId) ?? 0
      : null;
    const hasMaterials =
      materialCount >= augmentation.requiredMaterialQuantity &&
      (augmentation.bossCatalystQuantity === undefined ||
        (catalystCount ?? 0) >= augmentation.bossCatalystQuantity);
    const compatibleEquipment = equipmentChoices.filter((choice) =>
      isCompatibleEquipment(choice.ownedItem, augmentation)
    );
    const selectedEquipmentId =
      selectedEquipmentByAugmentation[augmentation.augmentationId];
    const selectedEquipment =
      compatibleEquipment.find(
        (choice) => choice.ownedItem._id === selectedEquipmentId
      ) ?? null;
    const actionKey = selectedEquipment
      ? `augmentation:${augmentation.augmentationId}:${selectedEquipment.ownedItem._id}`
      : null;
    const missingRequirements: string[] = [];

    if (materialCount < augmentation.requiredMaterialQuantity) {
      missingRequirements.push(
        `${augmentation.requiredMaterialQuantity - materialCount}x ${
          augmentation.requiredMaterialItem?.name ?? "required material"
        }`
      );
    }
    if (
      augmentation.bossCatalystQuantity !== undefined &&
      (catalystCount ?? 0) < augmentation.bossCatalystQuantity
    ) {
      missingRequirements.push(
        `${augmentation.bossCatalystQuantity - (catalystCount ?? 0)}x ${
          augmentation.bossCatalystItem?.name ?? "boss catalyst"
        }`
      );
    }

    return (
      <div
        key={`augmentation:${augmentation._id}`}
        className="border border-forest-light/20 bg-forest-dark/25 p-3"
      >
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-foreground">
                {augmentation.name}
              </h4>
              <TierBadge tier={tier} unlocked={unlocked} />
              <span className="border border-gold/30 px-1.5 py-0.5 text-[10px] text-gold-light">
                Augmentation
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {augmentation.description}
            </p>
            <p className="mt-2 text-xs text-forest-glow">
              Requires {augmentation.requiredMaterialQuantity}x{" "}
              {augmentation.requiredMaterialItem?.name ?? "required material"}
              {augmentation.bossCatalystQuantity !== undefined &&
                ` · ${augmentation.bossCatalystQuantity}x ${
                  augmentation.bossCatalystItem?.name ?? "boss catalyst"
                }`}
            </p>
            <p className="mt-1 text-xs text-forest-glow">
              Effect: {augmentation.effectType}
              {augmentation.effectStat
                ? ` · ${augmentation.effectStat.toUpperCase()}`
                : ""}
              {augmentation.effectAmount > 0
                ? ` +${augmentation.effectAmount}`
                : ""}
            </p>
            {!unlocked && (
              <p className="mt-1 text-[11px] text-blood-light">
                Requires {skill.name} level {tier?.requiredLevel ?? augmentation.tier}
              </p>
            )}
            {missingRequirements.length > 0 && (
              <p className="mt-1 text-[11px] text-blood-light">
                Missing: {missingRequirements.join(", ")}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t border-forest-light/20 pt-3 sm:flex-row sm:items-end sm:justify-between">
            <label
              className="flex min-w-0 flex-1 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              htmlFor={`augmentation-equipment-${augmentation.augmentationId}`}
            >
              Target equipment
              <select
                id={`augmentation-equipment-${augmentation.augmentationId}`}
                value={selectedEquipment?.ownedItem._id ?? ""}
                disabled={inventory.isPending || compatibleEquipment.length === 0}
                onChange={(event) =>
                  setSelectedEquipmentByAugmentation((current) => ({
                    ...current,
                    [augmentation.augmentationId]: event.currentTarget.value,
                  }))
                }
                className="min-h-9 border border-forest-light/30 bg-forest-deep px-2 py-2 text-xs font-normal normal-case tracking-normal text-foreground outline-none focus:border-gold focus:ring-1 focus:ring-gold/40 disabled:opacity-60"
              >
                <option value="">
                  {inventory.isPending
                    ? "Loading equipment..."
                    : compatibleEquipment.length === 0
                      ? "No compatible equipment"
                      : "Select equipment"}
                </option>
                {compatibleEquipment.map((choice) => (
                  <option
                    key={choice.ownedItem._id}
                    value={choice.ownedItem._id}
                  >
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              disabled={
                !unlocked ||
                !hasMaterials ||
                selectedEquipment === null ||
                activeAction !== null
              }
              onClick={() => {
                if (selectedEquipment) {
                  void applyAugmentation(
                    augmentation.augmentationId,
                    selectedEquipment.ownedItem._id
                  );
                }
              }}
            >
              {actionKey !== null && activeAction === actionKey
                ? "Applying..."
                : "Apply"}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderSkillContent = (skill: SkillDefinition) => {
    const state = skillState(data, skill.skillId);
    const activities = data.activities
      .filter((activity) => activity.skillId === skill.skillId)
      .sort((left, right) => left.tier - right.tier);
    const recipes = data.recipes
      .filter((recipe) => recipe.skillId === skill.skillId)
      .sort(
        (left, right) =>
          left.tier - right.tier ||
          (left.stage === "refinement" ? -1 : 1) -
            (right.stage === "refinement" ? -1 : 1)
      );
    const augmentations = data.augmentations
      .filter((augmentation) => augmentation.skillId === skill.skillId)
      .sort((left, right) => left.tier - right.tier);
    const tierNumbers = Array.from(
      new Set([
        ...data.tiers
          .filter((tier) => tier.skillId === skill.skillId)
          .map((tier) => tier.tier),
        ...activities.map((activity) => activity.tier),
        ...recipes.map((recipe) => recipe.tier),
        ...augmentations.map((augmentation) => augmentation.tier),
      ])
    ).sort((left, right) => left - right);

    return (
      <div className="space-y-5">
        <SkillSummary skill={skill} state={state} xpPerLevel={data.xpPerLevel} />
        {tierNumbers.length === 0 ? (
          <p className="border border-forest-light/20 bg-forest-dark/25 p-3 text-xs text-muted-foreground">
            No options are configured for this skill yet.
          </p>
        ) : (
          <div className="space-y-5">
            {tierNumbers.map((tierNumber) => {
              const tier = tierFor(data.tiers, skill.skillId, tierNumber);
              const unlocked =
                (state?.level ?? 1) >= (tier?.requiredLevel ?? 1);
              const tierActivities = activities.filter(
                (activity) => activity.tier === tierNumber
              );
              const tierRecipes = recipes.filter(
                (recipe) => recipe.tier === tierNumber
              );
              const tierAugmentations = augmentations.filter(
                (augmentation) => augmentation.tier === tierNumber
              );
              const hasOptions =
                (skill.category === "gathering" && tierActivities.length > 0) ||
                (skill.category === "crafting" && tierRecipes.length > 0) ||
                tierAugmentations.length > 0;

              return (
                <section key={`${skill.skillId}:tier:${tierNumber}`} className="space-y-2">
                  <div className="flex flex-col gap-2 border-b border-forest-light/25 pb-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="font-heading text-sm uppercase tracking-wider text-gold">
                        Tier {tierNumber} progression
                      </h3>
                      {tier?.description && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {tier.description}
                        </p>
                      )}
                    </div>
                    <TierBadge tier={tier} unlocked={unlocked} />
                  </div>
                  <div className="space-y-2">
                    {skill.category === "gathering" &&
                      tierActivities.map((activity) =>
                        renderGatheringActivity(skill, state, activity)
                      )}
                    {skill.category === "crafting" &&
                      tierRecipes.map((recipe) =>
                        renderRecipe(skill, state, recipe)
                      )}
                    {tierAugmentations.map((augmentation) =>
                      renderAugmentation(skill, state, augmentation)
                    )}
                    {!hasOptions && (
                      <p className="border border-forest-light/20 bg-forest-dark/25 p-3 text-xs text-muted-foreground">
                        No options are configured for this tier yet.
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className="forest-card box-glow-green gap-0 rounded-none p-0">
      <Tabs
        value={activeSkill.skillId}
        onValueChange={(value) => {
          if (data.definitions.some((skill) => skill.skillId === value)) {
            setActiveSkillId(value);
            setError(null);
          }
        }}
        className="gap-0"
      >
        <div className="min-h-8 overflow-x-auto overflow-y-hidden border-b border-forest-light/30">
          <TabsList
            variant="forest"
            aria-label="Skills"
            className="min-w-max"
          >
            {data.definitions.map((skill) => (
              <TabsTrigger key={skill.skillId} value={skill.skillId}>
                {skill.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {data.definitions.map((skill) => (
          <TabsContent
            key={skill.skillId}
            value={skill.skillId}
            className="space-y-4 p-4 outline-none"
          >
            {error && (
              <p className="text-xs text-blood-light" role="alert">
                {error}
              </p>
            )}
            {renderSkillContent(skill)}
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}
