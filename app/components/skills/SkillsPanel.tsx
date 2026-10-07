import { useMemo, useState } from "react";
import { useAtom } from "jotai";
import { skillTierFilterAtom } from "~/store/gameStore";
import { useNavigate, useParams } from "react-router";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { usePlayerInventory } from "~/hooks/useInventory";
import { useEnqueueSkillAction, useTaskQueue } from "~/hooks/useTasks";
import { useSkillPanel } from "~/hooks/useSkills";
import { formatPercent, infusionSuccessChance } from "~/lib/infusion";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import type { Id } from "../../../convex/_generated/dataModel";
import { ItemIcon } from "~/components/game/ItemIcon";
import type { ItemIconInput } from "~/lib/itemIcons";

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
  item: (ItemIconInput & { name: string }) | null;
  quantity: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-foreground/80">
      <ItemIcon item={item} alt="" className="size-5" />
      {quantity}x {item?.name ?? "Unknown item"}
    </span>
  );
}

function recipeStageLabel(stage: "refinement" | "product" | "consumable" | undefined) {
  if (stage === "refinement") return "Refinement";
  if (stage === "product") return "Finished item";
  if (stage === "consumable") return "Consumable";
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
  const basic =
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
    );
  if (!basic) return false;
  if (augmentation.requiresPreviousTier === true) {
    // Chained lines replace in place: tier N needs the tier N-1 augment,
    // and the predecessor frees its slot.
    if (augmentation.tier <= 1) return true;
    const predecessor = ownedItem.augments.find(
      (applied) => (applied.tier ?? 0) === augmentation.tier - 1
    );
    if (!predecessor) return false;
    const occupied = ownedItem.augments.length - 1;
    return occupied < (item.augmentSlots ?? 1);
  }
  return true;
}

function SkillSummary({
  skill,
  state,
  skillXpBase,
}: {
  skill: SkillDefinition;
  state: SkillState | null;
  skillXpBase: number;
}) {
  const level = state?.level ?? 1;
  const experience = state?.experience ?? 0;
  const xpRequiredForNextLevel =
    state?.xpRequiredForNextLevel ?? skillXpBase;
  const progress = Math.min(
    100,
    (experience / xpRequiredForNextLevel) * 100
  );

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
          {experience} / {xpRequiredForNextLevel} XP
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

const TIER_FILTER_OPTIONS: Array<number | null> = [
  null,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
];

function TierFilterSidebar({
  skillName,
  selectedTier,
  onSelect,
}: {
  skillName: string;
  selectedTier: number | null;
  onSelect: (tier: number | null) => void;
}) {
  return (
    <nav
      aria-label={`${skillName} tier filter`}
      className="shrink-0 md:w-24"
    >
      <div className="rounded-none border border-forest-light/25 bg-forest-dark/35">
        <p className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Tier
        </p>
        <ul className="flex flex-row gap-0 overflow-x-auto p-1 md:flex-col md:overflow-visible">
          {TIER_FILTER_OPTIONS.map((tier) => {
            const isActive =
              tier === null ? selectedTier == null : selectedTier === tier;
            const label = tier === null ? "All" : `Tier ${tier}`;
            return (
              <li key={tier === null ? "all" : `tier-${tier}`} className="w-auto shrink-0 md:w-full">
                <button
                  type="button"
                  aria-pressed={isActive}
                  aria-label={`Show ${label} ${skillName} activities`}
                  onClick={() => onSelect(tier)}
                  className={`block w-full rounded-none border px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider transition-colors outline-none focus-visible:ring-1 focus-visible:ring-gold/40 ${
                    isActive
                      ? "border-forest-light/30 bg-forest-mid text-gold-light"
                      : "border-transparent text-muted-foreground hover:bg-forest-mid/50 hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

export function SkillsPanel({ playerId }: SkillsPanelProps) {
  const panel = useSkillPanel(playerId);
  const inventory = usePlayerInventory(playerId);
  const enqueueSkillAction = useEnqueueSkillAction();
  const taskQueue = useTaskQueue(playerId);
  const navigate = useNavigate();
  const params = useParams();
  const [tierFilterBySkill, setTierFilterBySkill] = useAtom(
    skillTierFilterAtom
  );
  const routeSkillId =
    typeof params.skillId === "string" ? params.skillId : null;
  const hasQueuedTasks =
    taskQueue.data !== undefined &&
    (taskQueue.data.active != null ||
      (taskQueue.data.queued?.length ?? 0) > 0);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEquipmentByAugmentation, setSelectedEquipmentByAugmentation] =
    useState<Record<string, string>>({});
  const [quantityByGatheringActivity, setQuantityByGatheringActivity] =
    useState<Record<string, string>>({});
  const [quantityByRecipe, setQuantityByRecipe] = useState<
    Record<string, string>
  >({});

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
    (routeSkillId
      ? data.definitions.find((skill) => skill.skillId === routeSkillId)
      : undefined) ??
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
    requestKey: string,
    enqueue: () => Promise<unknown>,
    fallback = "Unable to queue skill action."
  ) => {
    setActiveAction(requestKey);
    setError(null);
    try {
      await enqueue();
    } catch (actionError) {
      setError(errorMessage(actionError, fallback));
    } finally {
      setActiveAction(null);
    }
  };

  const applyAugmentation = async (
    augmentationId: string,
    playerItemId: Id<"playerItems">
  ) => {
    const key = `augmentation:${augmentationId}:${playerItemId}`;
    await runAction(
      key,
      () =>
        enqueueSkillAction({
          playerId,
          actionType: "augmentation",
          actionId: augmentationId,
          targetPlayerItemId: playerItemId,
        }),
      "Unable to queue augmentation."
    );
  };

  const renderGatheringActivity = (
    skill: SkillDefinition,
    state: SkillState | null,
    activity: GatheringActivity
  ) => {
    const tier = tierFor(data.tiers, skill.skillId, activity.tier);
    const unlocked = (state?.level ?? 1) >= (tier?.requiredLevel ?? 1);
    const actionKey = `gathering:${activity.activityId}`;
    const baseActionDurationMs =
      activity.experienceReward * data.skillTaskMsPerXp;
    const rawGatheringQuantity =
      quantityByGatheringActivity[activity.activityId] ?? "1";
    const gatheringQuantity = Number(rawGatheringQuantity);
    const validGatheringQuantity =
      Number.isSafeInteger(gatheringQuantity) &&
      gatheringQuantity >= 1 &&
      gatheringQuantity <= data.maxSkillBatchSize;
    const gatheringRequestKey = `${actionKey}:${gatheringQuantity}`;
    const actionVerb = hasQueuedTasks ? "Queue" : "Start";
    const actionProgressVerb = hasQueuedTasks ? "Queueing..." : "Starting...";
    const durationOptions = [
      { label: "+1 hr", description: "one hour", value: "one-hour" as const },
      { label: "+2 hr", description: "two hours", value: "two-hours" as const },
      {
        label: "Fill",
        description: "the remaining offline time",
        value: "fill-remaining" as const,
      },
    ];

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
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-forest-glow">
            <ItemIcon item={activity.outputItem} alt="" className="size-5" />
            Yields {activity.minYield}–{activity.maxYield}{" "}
            {activity.outputItem?.name ?? "resource"} · Base action{" "}
            {formatDuration(baseActionDurationMs)} · +{activity.experienceReward} XP
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Actions
              <input
                type="number"
                min="1"
                max={data.maxSkillBatchSize}
                step="1"
                value={rawGatheringQuantity}
                aria-label={`${activity.name} action quantity, maximum ${data.maxSkillBatchSize}`}
                onChange={(event) => {
                  // Capture before the deferred updater — currentTarget is
                  // null once the event finishes dispatching.
                  const value = event.currentTarget.value;
                  setQuantityByGatheringActivity((current) => ({
                    ...current,
                    [activity.activityId]: value,
                  }));
                }}
                className="min-h-9 w-20 border border-forest-light/30 bg-forest-deep px-2 text-xs font-normal normal-case tracking-normal text-foreground outline-none focus:border-gold focus:ring-1 focus:ring-gold/40"
              />
            </label>
            <Button
              type="button"
              size="sm"
              disabled={
                !unlocked ||
                !validGatheringQuantity ||
                activeAction !== null
              }
              aria-label={`${actionVerb} ${gatheringQuantity} ${activity.name} actions`}
              onClick={() =>
                void runAction(
                  gatheringRequestKey,
                  () =>
                    enqueueSkillAction({
                      playerId,
                      actionType: "gathering",
                      actionId: activity.activityId,
                      quantity: gatheringQuantity,
                    }),
                  "Unable to queue gathering actions."
                )
              }
            >
              {activeAction === gatheringRequestKey ? actionProgressVerb : actionVerb}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1 sm:justify-end">
            {durationOptions.map((option) => {
              const requestKey = `${actionKey}:${option.value}`;
              return (
                <Button
                  key={option.value}
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={!unlocked || activeAction !== null}
                  aria-label={`Queue ${option.description} of ${activity.name}`}
                  onClick={() =>
                    void runAction(requestKey, () =>
                      enqueueSkillAction({
                        playerId,
                        actionType: "gathering",
                        actionId: activity.activityId,
                        durationOption: option.value,
                      })
                    )
                  }
                >
                  {activeAction === requestKey ? "Queueing..." : option.label}
                </Button>
              );
            })}
          </div>
        </div>
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
    const ingredientRequirements = new Map<string, number>();
    for (const ingredient of recipe.ingredients) {
      ingredientRequirements.set(
        ingredient.itemId,
        (ingredientRequirements.get(ingredient.itemId) ?? 0) +
          ingredient.quantity
      );
    }
    const maxCraftQuantity =
      ingredientRequirements.size === 0
        ? 0
        : Math.min(
            data.maxSkillBatchSize,
            ...Array.from(ingredientRequirements, ([itemId, quantity]) =>
              Math.floor((itemQuantities.get(itemId) ?? 0) / quantity)
            )
          );
    const missingIngredients = recipe.ingredients.filter(
      (ingredient) =>
        (itemQuantities.get(ingredient.itemId) ?? 0) < ingredient.quantity
    );
    const actionKey = `crafting:${recipe.recipeId}`;
    const monsterDrop = recipe.ingredients.find((ingredient) =>
      ingredient.item?.itemFamily?.includes("monster")
    );
    const baseActionDurationMs =
      recipe.experienceReward * data.skillTaskMsPerXp;
    const rawCraftQuantity = quantityByRecipe[recipe.recipeId] ?? "1";
    const craftQuantity = Number(rawCraftQuantity);
    const validCraftQuantity =
      Number.isSafeInteger(craftQuantity) &&
      craftQuantity >= 1 &&
      craftQuantity <= maxCraftQuantity;
    const craftRequestKey = `${actionKey}:${craftQuantity}`;

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
              Base action {formatDuration(baseActionDurationMs)} · +
              {recipe.experienceReward} XP
            </p>
            {skill.skillId === "infusion" && data.infusionRates && (
              <p className="mt-1 text-[11px] text-gold-light">
                Infusion success{" "}
                {formatPercent(
                  infusionSuccessChance(
                    state?.level ?? 1,
                    recipe.tier,
                    data.infusionRates
                  )
                )}{" "}
                at Infusion level {state?.level ?? 1} · failure burns the
                materials for{" "}
                {Math.round(data.infusionRates.failXpPercent * 100)}% XP
              </p>
            )}
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
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-1.5 border-t border-forest-light/15 pt-3">
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Quantity · max {maxCraftQuantity}
            <input
              type="number"
              min="1"
              max={maxCraftQuantity}
              step="1"
              value={rawCraftQuantity}
              aria-label={`${recipe.name} craft quantity`}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setQuantityByRecipe((current) => ({
                  ...current,
                  [recipe.recipeId]: value,
                }));
              }}
              className="min-h-8 w-24 border border-forest-light/30 bg-forest-deep px-2 text-xs font-normal normal-case tracking-normal text-foreground outline-none focus:border-gold focus:ring-1 focus:ring-gold/40"
            />
          </label>
          {[1, 5, 10].map((quantity) => (
            <Button
              key={quantity}
              type="button"
              size="xs"
              variant="outline"
              disabled={
                quantity > maxCraftQuantity || activeAction !== null
              }
              aria-label={`Set ${recipe.name} quantity to ${quantity}`}
              onClick={() =>
                setQuantityByRecipe((current) => ({
                  ...current,
                  [recipe.recipeId]: String(quantity),
                }))
              }
            >
              {quantity}
            </Button>
          ))}
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={
              !unlocked ||
              maxCraftQuantity < 1 ||
              !validCraftQuantity ||
              activeAction !== null
            }
            aria-label={`Set ${recipe.name} quantity to maximum`}
            onClick={() => {
              setQuantityByRecipe((current) => ({
                ...current,
                [recipe.recipeId]: String(maxCraftQuantity),
              }));
            }}
          >
            Max
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={
              !unlocked ||
              !validCraftQuantity ||
              activeAction !== null
            }
            onClick={() =>
              void runAction(craftRequestKey, () =>
                enqueueSkillAction({
                  playerId,
                  actionType: "crafting",
                  actionId: recipe.recipeId,
                  quantity: craftQuantity,
                })
              )
            }
          >
            {activeAction === craftRequestKey
              ? "Queueing..."
              : `Queue ${validCraftQuantity ? craftQuantity : "craft"}`}
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
              {augmentation.effectElement
                ? ` · ${augmentation.effectElement}`
                : ""}
              {augmentation.effectAmount > 0
                ? ` +${augmentation.effectAmount}`
                : ""}
            </p>
            <p className="mt-1 text-xs text-forest-glow">
              Base action{" "}
              {formatDuration(
                augmentation.experienceReward * data.skillTaskMsPerXp
              )}{" "}
              · +{augmentation.experienceReward} XP
            </p>
            {skill.skillId === "infusion" && data.infusionRates && (
              <p className="mt-1 text-[11px] text-gold-light">
                Infusion success{" "}
                {formatPercent(
                  infusionSuccessChance(
                    state?.level ?? 1,
                    augmentation.tier,
                    data.infusionRates,
                    "augment"
                  )
                )}{" "}
                at Infusion level {state?.level ?? 1} · failure burns the
                materials for{" "}
                {Math.round(data.infusionRates.failXpPercent * 100)}% XP
              </p>
            )}
            {augmentation.requiresPreviousTier === true && (
              <p className="mt-1 text-[11px] text-gold-light">
                Chained: needs the tier {augmentation.tier - 1} augment
                applied to the same item (replaced on success).
              </p>
            )}
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
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSelectedEquipmentByAugmentation((current) => ({
                    ...current,
                    [augmentation.augmentationId]: value,
                  }));
                }}
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
                ? "Queueing..."
                : "Queue"}
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
    const selectedTier = tierFilterBySkill[skill.skillId] ?? null;
    const visibleTierNumbers =
      selectedTier == null
        ? tierNumbers
        : tierNumbers.filter((tierNumber) => tierNumber === selectedTier);

    return (
      <div className="space-y-5">
        <SkillSummary
          skill={skill}
          state={state}
          skillXpBase={data.skillXpBase}
        />
        {tierNumbers.length === 0 ? (
          <p className="border border-forest-light/20 bg-forest-dark/25 p-3 text-xs text-muted-foreground">
            No options are configured for this skill yet.
          </p>
        ) : (
          <div className="flex flex-col gap-4 md:flex-row">
            <TierFilterSidebar
              skillName={skill.name}
              selectedTier={selectedTier}
              onSelect={(tier) =>
                setTierFilterBySkill((current) => ({
                  ...current,
                  [skill.skillId]: tier,
                }))
              }
            />
            <div className="min-w-0 flex-1 space-y-5">
              {visibleTierNumbers.length === 0 ? (
                <p className="border border-forest-light/20 bg-forest-dark/25 p-3 text-xs text-muted-foreground">
                  No options are configured for this tier yet.
                </p>
              ) : (
                visibleTierNumbers.map((tierNumber) => {
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
                })
              )}
            </div>
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
            setError(null);
            navigate(`/skills/${value}`, { replace: false });
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
