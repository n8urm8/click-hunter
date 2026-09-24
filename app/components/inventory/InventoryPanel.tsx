import { useState, type DragEvent, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import {
  useClaimAllPendingRewards,
  useClaimPendingReward,
  useEquipItem,
  usePlayerInventory,
  useSkillBoost,
  useUnequipItem,
} from "~/hooks/useInventory";
import { useSkillPanel } from "~/hooks/useSkills";
import { useEnqueueSkillAction } from "~/hooks/useTasks";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  EQUIPMENT_SLOT_VALUES,
  SKILL_TASK_EFFECT_TYPES,
  type EquipmentSlot,
  type SkillBonusScope,
  type SkillTaskEffectType,
} from "../../../convex/itemTypes";

interface InventoryPanelProps {
  playerId: Id<"players">;
}

type OwnedItem = {
  _id: Id<"playerItems">;
  itemId: Id<"items">;
  quantity: number;
  acquiredAt: number;
  updatedAt: number;
  item: Doc<"items">;
  rarity: Doc<"itemRarities"> | null;
  augments: Doc<"playerItemAugments">[];
};

const SLOT_LABELS: Record<EquipmentSlot, string> = {
  head: "Head",
  chest: "Chest",
  mainHand: "Main Hand",
  offHand: "Off Hand",
  legs: "Legs",
  feet: "Feet",
  accessory1: "Accessory 1",
  accessory2: "Accessory 2",
  bag: "Bag",
  craftingEquipment: "Crafting Equipment",
};

const SLOT_LAYOUT: Record<EquipmentSlot, string> = {
  head: "col-start-2 row-start-1",
  chest: "col-start-2 row-start-2",
  mainHand: "col-start-1 row-start-2",
  offHand: "col-start-3 row-start-2",
  accessory1: "col-start-1 row-start-3",
  legs: "col-start-2 row-start-3",
  accessory2: "col-start-3 row-start-3",
  feet: "col-start-2 row-start-4",
  bag: "col-start-1 row-start-4",
  craftingEquipment: "col-start-3 row-start-4",
};

type InventoryTab = "crafting" | "equipment";

function isSkillTaskEffectType(
  value: string | undefined
): value is SkillTaskEffectType {
  return SKILL_TASK_EFFECT_TYPES.some((effectType) => effectType === value);
}

function skillScopeLabel(scope: SkillBonusScope | undefined) {
  if (scope === "all" || scope === undefined) return "all skills";
  return scope;
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

function errorMessage(error: unknown, fallback = "Unable to update inventory.") {
  return error instanceof Error ? error.message : fallback;
}

function isCompatible(item: OwnedItem, slot: EquipmentSlot) {
  return (
    item.item.category === "equipment" &&
    item.item.allowedEquipmentSlots.includes(slot)
  );
}

type ItemDragHandler = (
  event: DragEvent<HTMLElement>,
  ownedItem: OwnedItem
) => void;

function itemInitials(name: string) {
  return name
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function statLabel(stat: string | undefined) {
  switch (stat) {
    case "str":
      return "STR";
    case "dex":
      return "DEX";
    case "int":
      return "INT";
    case "luk":
      return "LUK";
    case "con":
      return "CON";
    default:
      return null;
  }
}

function ItemGridItem({
  ownedItem,
  selected,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  ownedItem: OwnedItem;
  selected: boolean;
  onSelect: (ownedItem: OwnedItem) => void;
  onDragStart: ItemDragHandler;
  onDragEnd: () => void;
}) {
  const rarityLabel = ownedItem.rarity
    ? `, ${ownedItem.rarity.name} rarity`
    : "";

  return (
    <button
      type="button"
      draggable
      aria-label={`${ownedItem.item.name}${rarityLabel}${ownedItem.quantity > 1 ? `, quantity ${ownedItem.quantity}` : ""}`}
      aria-pressed={selected}
      title={`${ownedItem.item.name}${ownedItem.rarity ? ` · ${ownedItem.rarity.name}` : ""}`}
      onClick={() => onSelect(ownedItem)}
      onDragStart={(event) => onDragStart(event, ownedItem)}
      onDragEnd={onDragEnd}
      className={`relative flex size-[42px] shrink-0 cursor-grab items-center justify-center border text-center transition-colors active:cursor-grabbing ${
        selected
          ? "border-gold bg-forest-mid text-gold-light shadow-[0_0_10px_rgba(212,175,55,0.2)]"
          : "border-forest-light/30 bg-forest-dark/60 text-forest-glow/80 hover:border-gold/60 hover:bg-forest-mid/60"
      }`}
    >
      <span
        className="font-heading text-xs"
        style={ownedItem.rarity ? { color: ownedItem.rarity.color } : undefined}
      >
        {itemInitials(ownedItem.item.name)}
      </span>
      {ownedItem.quantity > 1 && (
        <span className="absolute -right-1 -top-1 min-w-4 border border-gold/50 bg-forest-dark px-0.5 text-[9px] font-semibold leading-4 text-gold-light">
          {ownedItem.quantity}
        </span>
      )}
    </button>
  );
}

function ItemGrid({
  items,
  selectedItemId,
  emptyMessage,
  fill,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  items: OwnedItem[];
  selectedItemId: Id<"playerItems"> | null;
  emptyMessage: string;
  fill?: boolean;
  onSelect: (ownedItem: OwnedItem) => void;
  onDragStart: ItemDragHandler;
  onDragEnd: () => void;
}) {
  return (
    <div
      className={`${
        fill ? "min-h-0 max-h-none flex-1" : "max-h-36 min-h-20"
      } overflow-y-auto border border-forest-light/25 bg-forest-dark/30 p-2`}
    >
      {items.length === 0 ? (
        <p
          className={`flex ${
            fill ? "h-full" : "min-h-16"
          } items-center justify-center px-2 text-center text-xs text-muted-foreground`}
        >
          {emptyMessage}
        </p>
      ) : (
        <div
          className="grid auto-rows-[42px] gap-2"
          style={{ gridTemplateColumns: "repeat(auto-fill, 42px)" }}
        >
          {items.map((ownedItem) => (
            <ItemGridItem
              key={ownedItem._id}
              ownedItem={ownedItem}
              selected={selectedItemId === ownedItem._id}
              onSelect={onSelect}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemDetails({
  ownedItem,
  emptyMessage,
  error,
  actions,
}: {
  ownedItem: OwnedItem | null;
  emptyMessage: string;
  error: string | null;
  actions?: ReactNode;
}) {
  return (
    <div className="min-h-28 border border-forest-light/25 bg-forest-dark/30 p-3">
      {ownedItem ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-heading text-sm text-gold-light">
                {ownedItem.item.name}
              </p>
              {ownedItem.rarity && (
                <p
                  className="mt-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: ownedItem.rarity.color }}
                >
                  {ownedItem.rarity.name} · Level {ownedItem.rarity.level}
                </p>
              )}
              <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {ownedItem.item.category === "equipment"
                  ? "Equipment"
                  : "Crafting material"}
                {ownedItem.item.craftingTier !== undefined &&
                  ` · Tier ${ownedItem.item.craftingTier}`}
                {ownedItem.item.itemFamily && ` · ${ownedItem.item.itemFamily}`}
                {ownedItem.quantity > 1 && ` · Quantity ${ownedItem.quantity}`}
              </p>
            </div>
            {ownedItem.quantity > 1 && (
              <span className="shrink-0 border border-gold/40 px-1.5 py-0.5 text-xs font-semibold text-gold">
                x{ownedItem.quantity}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-foreground/80">
            {ownedItem.item.description}
          </p>
          {ownedItem.item.effectType === "stat-bonus" &&
            typeof ownedItem.item.effectAmount === "number" &&
            statLabel(ownedItem.item.effectStat) && (
              <p className="mt-2 text-xs font-semibold text-gold">
                Base effect: +{ownedItem.item.effectAmount}{" "}
                {statLabel(ownedItem.item.effectStat)}
                {ownedItem.item.effectDurationMs !== undefined &&
                  ` · ${Math.round(ownedItem.item.effectDurationMs / 1000)}s`}
              </p>
            )}
          {ownedItem.item.effectType &&
            ownedItem.item.effectType !== "stat-bonus" && (
              <p className="mt-2 text-xs font-semibold text-forest-glow">
                Stored effect: {ownedItem.item.effectType}
                {isSkillTaskEffectType(ownedItem.item.effectType) &&
                  ` · ${skillScopeLabel(ownedItem.item.effectScope)} scope`}
                {ownedItem.item.effectStat &&
                  ` · ${statLabel(ownedItem.item.effectStat) ?? ownedItem.item.effectStat}`}
                {ownedItem.item.effectAmount !== undefined &&
                  (isSkillTaskEffectType(ownedItem.item.effectType)
                    ? ` ×${ownedItem.item.effectAmount}`
                    : ` +${ownedItem.item.effectAmount}`)}
                {ownedItem.item.effectDurationMs !== undefined &&
                  ` · ${Math.round(ownedItem.item.effectDurationMs / 1000)}s`}
              </p>
            )}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {actions ?? (
              <span className="text-xs text-muted-foreground">
                No actions available yet.
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="flex min-h-20 items-center justify-center text-center text-xs text-muted-foreground">
          {emptyMessage}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-blood-light">
          {error}
        </p>
      )}
    </div>
  );
}

function AugmentationControls({
  playerId,
  ownedItem,
  itemQuantities,
}: {
  playerId: Id<"players">;
  ownedItem: OwnedItem | null;
  itemQuantities: Map<string, number>;
}) {
  const skillPanel = useSkillPanel(playerId);
  const enqueueSkillAction = useEnqueueSkillAction();
  const [activeAugmentation, setActiveAugmentation] = useState<string | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  if (!ownedItem || ownedItem.item.category !== "equipment") return null;

  const augmentSlots = ownedItem.item.augmentSlots ?? 1;
  const availableAugmentations = (skillPanel.data?.augmentations ?? []).filter(
    (augmentation) =>
      (augmentation.baseItemFamily === undefined ||
        augmentation.baseItemFamily === ownedItem.item.itemFamily) &&
      (augmentation.allowedEquipmentSlots.length === 0 ||
        augmentation.allowedEquipmentSlots.some((slot) =>
          ownedItem.item.allowedEquipmentSlots.includes(slot)
        )) &&
      !ownedItem.augments.some(
        (applied) => applied.augmentationId === augmentation.augmentationId
      )
  );

  const queueAugmentation = async (augmentationId: string) => {
    setActiveAugmentation(augmentationId);
    setError(null);
    try {
      await enqueueSkillAction({
        playerId,
        actionType: "augmentation",
        actionId: augmentationId,
        targetPlayerItemId: ownedItem._id,
      });
    } catch (augmentationError) {
      setError(
        augmentationError instanceof Error
          ? augmentationError.message
          : "Unable to queue augmentation."
      );
    } finally {
      setActiveAugmentation(null);
    }
  };

  return (
    <div className="mt-3 border-t border-forest-light/20 pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Augmentations
        </p>
        <span className="text-[10px] text-muted-foreground">
          {ownedItem.augments.length} / {augmentSlots} slots
        </span>
      </div>
      {ownedItem.augments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ownedItem.augments.map((augment) => (
            <span
              key={augment._id}
              className="border border-forest-glow/30 bg-forest-glow/5 px-2 py-1 text-[11px] text-forest-glow"
            >
              {augment.name}{" "}
              {augment.effectAmount > 0 ? `+${augment.effectAmount}` : ""}
            </span>
          ))}
        </div>
      )}
      {ownedItem.augments.length < augmentSlots && (
        <div className="mt-2 space-y-2">
          {availableAugmentations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No compatible monster augmentations are available.
            </p>
          ) : (
            availableAugmentations.map((augmentation) => {
              const augmentationSkill = skillPanel.data?.definitions.find(
                (skill) => skill.skillId === augmentation.skillId
              );
              const augmentationTier = skillPanel.data?.tiers.find(
                (tier) =>
                  tier.skillId === augmentation.skillId &&
                  tier.tier === augmentation.tier
              );
              const skillLevel =
                skillPanel.data?.playerSkills.find(
                  (skill) => skill.skillId === augmentation.skillId
                )?.level ?? 1;
              const skillUnlocked =
                augmentationTier === undefined ||
                skillLevel >= augmentationTier.requiredLevel;
              const materialCount =
                itemQuantities.get(augmentation.requiredMaterialItemId) ?? 0;
              const catalystCount = augmentation.bossCatalystItemId
                ? itemQuantities.get(augmentation.bossCatalystItemId) ?? 0
                : null;
              const hasMaterials =
                materialCount >= augmentation.requiredMaterialQuantity &&
                (augmentation.bossCatalystQuantity === undefined ||
                  (catalystCount ?? 0) >= augmentation.bossCatalystQuantity);
              return (
                <div
                  key={augmentation._id}
                  className="flex flex-col gap-2 border border-forest-light/20 bg-forest-dark/25 p-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-xs font-semibold text-foreground">
                      {augmentation.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {augmentation.description}
                    </p>
                    <p className="mt-1 text-[10px] text-forest-glow">
                      {augmentation.requiredMaterialQuantity}x{" "}
                      {augmentation.requiredMaterialItem?.name ??
                        "monster material"}
                      {augmentation.bossCatalystQuantity !== undefined &&
                        ` · ${augmentation.bossCatalystQuantity}x ${
                          augmentation.bossCatalystItem?.name ?? "boss catalyst"
                        }`}
                      {!skillUnlocked &&
                        ` · Requires ${augmentationSkill?.name ?? "skill"} level ${
                          augmentationTier?.requiredLevel ?? augmentation.tier
                        }`}
                      {!hasMaterials && " · Missing materials"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    disabled={
                      !hasMaterials ||
                      !skillUnlocked ||
                      activeAugmentation !== null
                    }
                    onClick={() =>
                      void queueAugmentation(augmentation.augmentationId)
                    }
                  >
                    {activeAugmentation === augmentation.augmentationId
                      ? "Queueing..."
                      : "Queue"}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      )}
      {error && (
        <p className="mt-2 text-xs text-blood-light" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function PendingRewardsCard({
  playerId,
  rewards,
}: {
  playerId: Id<"players">;
  rewards: NonNullable<
    NonNullable<ReturnType<typeof usePlayerInventory>["data"]>["pendingRewards"]
  >;
}) {
  const claimReward = useClaimPendingReward();
  const claimAll = useClaimAllPendingRewards();
  const [claimingId, setClaimingId] = useState<Id<"pendingRewards"> | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  if (rewards.length === 0) return null;

  const handleClaim = async (rewardId: Id<"pendingRewards">) => {
    setClaimingId(rewardId);
    setError(null);
    try {
      await claimReward({ playerId, rewardId });
    } catch (claimError) {
      setError(
        claimError instanceof Error
          ? claimError.message
          : "Unable to claim reward."
      );
    } finally {
      setClaimingId(null);
    }

  };

  const handleClaimAll = async () => {
    setClaimingId(null);
    setError(null);
    try {
      await claimAll({ playerId });
    } catch (claimError) {
      setError(
        claimError instanceof Error
          ? claimError.message
          : "Unable to claim rewards."
      );
    }
  };

  return (
    <div className="border-b border-gold/25 bg-gold/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-base text-gold">Reward cache</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Inventory overflow is held here until you have room to claim it.
          </p>
        </div>
        <Button type="button" size="xs" variant="outline" onClick={() => void handleClaimAll()}>
          Claim what fits
        </Button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rewards.map((reward) => (
          <div
            key={reward._id}
            className="flex items-center justify-between gap-3 border border-forest-light/25 bg-forest-dark/40 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                {reward.item?.name ?? "Unknown item"}
              </p>
              <p className="text-xs text-muted-foreground">
                x{reward.quantity} · {reward.sourceType} reward
              </p>
            </div>
            <Button
              type="button"
              size="xs"
              disabled={claimingId !== null}
              onClick={() => void handleClaim(reward._id)}
            >
              {claimingId === reward._id ? "..." : "Claim"}
            </Button>
          </div>
        ))}
      </div>
      {error && (
        <p className="mt-2 text-xs text-blood-light" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function EquipmentSlotCard({
  slot,
  ownedItem,
  draggingItem,
  onDrop,
  onDragStart,
  onDragEnd,
  onUnequip,
}: {
  slot: EquipmentSlot;
  ownedItem: OwnedItem | null;
  draggingItem: OwnedItem | null;
  onDrop: (event: DragEvent<HTMLButtonElement>, slot: EquipmentSlot) => void;
  onDragStart: ItemDragHandler;
  onDragEnd: () => void;
  onUnequip: (ownedItem: OwnedItem) => void;
}) {
  const canAcceptDrop = draggingItem ? isCompatible(draggingItem, slot) : false;
  const rarityLabel = ownedItem?.rarity
    ? ` (${ownedItem.rarity.name} rarity)`
    : "";

  return (
    <button
      type="button"
      className={`group relative flex size-20 shrink-0 flex-col items-center justify-center border p-2 text-center transition-colors ${
        ownedItem
          ? "border-gold/50 bg-forest-mid/60"
          : "border-dashed border-forest-light/35 bg-forest-dark/50"
      } ${
        canAcceptDrop
          ? "border-gold bg-gold/10 shadow-[0_0_14px_rgba(212,175,55,0.18)]"
          : ""
      }`}
      aria-label={
        ownedItem
          ? `${SLOT_LABELS[slot]} equipped with ${ownedItem.item.name}${rarityLabel}. Click to unequip.`
          : `${SLOT_LABELS[slot]} equipment slot`
      }
      onClick={() => {
        if (ownedItem) onUnequip(ownedItem);
      }}
      onDragOver={(event) => {
        if (canAcceptDrop) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => onDrop(event, slot)}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {SLOT_LABELS[slot]}
      </span>
      {ownedItem ? (
        <div
          draggable
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => onDragStart(event, ownedItem)}
          onDragEnd={onDragEnd}
          className="mt-1 max-w-full cursor-grab truncate text-[10px] font-semibold leading-tight text-gold-light active:cursor-grabbing"
          style={ownedItem.rarity ? { color: ownedItem.rarity.color } : undefined}
          title="Drag to another compatible slot"
        >
          {ownedItem.item.name}
        </div>
      ) : (
        <span className="mt-1 text-xs text-muted-foreground/60">Empty</span>
      )}
      {ownedItem && (
        <span className="mt-1 text-[9px] text-muted-foreground group-hover:text-foreground/80">
          Click to unequip
        </span>
      )}
    </button>
  );
}

export function InventoryPanel({ playerId }: InventoryPanelProps) {
  const inventory = usePlayerInventory(playerId);
  const equipItem = useEquipItem();
  const unequipItem = useUnequipItem();
  const activateSkillBoost = useSkillBoost();
  const [draggingItemId, setDraggingItemId] = useState<Id<"playerItems"> | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<InventoryTab>("crafting");
  const [selectedCraftingItemId, setSelectedCraftingItemId] =
    useState<Id<"playerItems"> | null>(null);
  const [selectedEquipmentItemId, setSelectedEquipmentItemId] =
    useState<Id<"playerItems"> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [usingSkillBoostId, setUsingSkillBoostId] =
    useState<Id<"playerItems"> | null>(null);
  const [skillBoostStatus, setSkillBoostStatus] = useState<string | null>(null);

  if (inventory.isPending) {
    return (
      <Card className="forest-card box-glow-green min-h-[400px] p-6">
        <div className="flex min-h-[348px] items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading inventory...</p>
        </div>
      </Card>
    );
  }

  if (!inventory.data) {
    return (
      <Card className="forest-card box-glow-green min-h-[400px] p-6">
        <div className="flex min-h-[348px] items-center justify-center">
          <p className="text-sm text-blood-light" role="alert">
            Unable to load inventory.
          </p>
        </div>
      </Card>
    );
  }

  const equippedItems = inventory.data.equipment.flatMap((entry) =>
    entry.item ? [entry.item] : []
  );
  const craftingItems = inventory.data.inventory.filter(
    (ownedItem) => ownedItem.item.category === "crafting"
  );
  const equipmentItems = inventory.data.inventory.filter(
    (ownedItem) => ownedItem.item.category === "equipment"
  );
  const itemQuantities = new Map<string, number>();
  for (const ownedItem of inventory.data.inventory) {
    itemQuantities.set(
      ownedItem.itemId,
      (itemQuantities.get(ownedItem.itemId) ?? 0) + ownedItem.quantity
    );
  }
  const findOwnedItem = (playerItemId: Id<"playerItems">) =>
    inventory.data.inventory.find((item) => item._id === playerItemId) ??
    equippedItems.find((item) => item._id === playerItemId) ??
    null;
  const draggingItem = draggingItemId ? findOwnedItem(draggingItemId) : null;

  const handleDragStart = (
    event: DragEvent<HTMLElement>,
    ownedItem: OwnedItem
  ) => {
    setActionError(null);
    setDraggingItemId(ownedItem._id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ownedItem._id);
  };

  const handleDragEnd = () => setDraggingItemId(null);

  const handleEquip = async (
    ownedItem: OwnedItem,
    slot: EquipmentSlot
  ) => {
    if (!isCompatible(ownedItem, slot)) {
      setActionError(`${ownedItem.item.name} cannot be equipped to that slot.`);
      return;
    }
    if (isUpdating) return;

    setActionError(null);
    setIsUpdating(true);
    try {
      await equipItem({ playerId, playerItemId: ownedItem._id, slot });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDrop = async (
    event: DragEvent<HTMLButtonElement>,
    slot: EquipmentSlot
  ) => {
    event.preventDefault();
    setDraggingItemId(null);
    const playerItemId = event.dataTransfer.getData(
      "text/plain"
    ) as Id<"playerItems">;
    const ownedItem = findOwnedItem(playerItemId);
    if (!ownedItem) {
      setActionError("That item is no longer available.");
      return;
    }
    await handleEquip(ownedItem, slot);
  };

  const handleUnequip = async (ownedItem: OwnedItem) => {
    if (isUpdating) return;

    setActionError(null);
    setIsUpdating(true);
    try {
      await unequipItem({ playerId, playerItemId: ownedItem._id });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleUseSkillBoost = async (ownedItem: OwnedItem) => {
    if (!isSkillTaskEffectType(ownedItem.item.effectType)) {
      setActionError("That item is not a skill boost.");
      return;
    }
    if (usingSkillBoostId !== null || isUpdating) return;

    setActionError(null);
    setSkillBoostStatus(null);
    setUsingSkillBoostId(ownedItem._id);
    try {
      const result = await activateSkillBoost({
        playerId,
        playerItemId: ownedItem._id,
      });
      const effectLabel =
        result.effectType === "skill-speed-multiplier"
          ? "skill speed"
          : "skill XP";
      const scopeLabel = skillScopeLabel(result.effectScope);
      setSkillBoostStatus(
        `${scopeLabel} ${effectLabel} ×${result.effectAmount} active for ${formatDuration(
          result.expiresAt - Date.now()
        )}.`
      );
    } catch (boostError) {
      setActionError(errorMessage(boostError, "Unable to use skill boost."));
    } finally {
      setUsingSkillBoostId(null);
    }
  };

  const selectedCraftingItem =
    craftingItems.find((item) => item._id === selectedCraftingItemId) ?? null;
  const selectedEquipmentItem =
    equipmentItems.find((item) => item._id === selectedEquipmentItemId) ?? null;

  return (
    <Card className="forest-card box-glow-green min-h-[400px] rounded-none gap-0 p-0">
      <PendingRewardsCard
        playerId={playerId}
        rewards={inventory.data.pendingRewards}
      />
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (value === "crafting" || value === "equipment") {
            setActiveTab(value);
            setActionError(null);
          }
        }}
        className="gap-0"
      >
        <TabsList variant="forest" aria-label="Inventory category">
          <TabsTrigger value="crafting">Crafting</TabsTrigger>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
        </TabsList>

        <TabsContent value="crafting" className="p-0">
          <div className="flex min-h-[368px] flex-col gap-3 p-3">
            <ItemGrid
              items={craftingItems}
              selectedItemId={selectedCraftingItemId}
              emptyMessage="Crafting materials will appear here when item acquisition is added."
              fill
              onSelect={(ownedItem) => {
                setSelectedCraftingItemId(ownedItem._id);
                setActionError(null);
                setSkillBoostStatus(null);
              }}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            />
            <ItemDetails
              ownedItem={selectedCraftingItem}
              emptyMessage="Select a crafting item to view its description and available actions."
              error={actionError}
              actions={
                selectedCraftingItem &&
                isSkillTaskEffectType(selectedCraftingItem.item.effectType) ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={
                      usingSkillBoostId !== null ||
                      isUpdating ||
                      selectedCraftingItem._id === usingSkillBoostId
                    }
                    onClick={() =>
                      void handleUseSkillBoost(selectedCraftingItem)
                    }
                  >
                    {selectedCraftingItem._id === usingSkillBoostId
                      ? "Activating..."
                      : "Use boost"}
                  </Button>
                ) : undefined
              }
            />
            {skillBoostStatus && (
              <p className="text-xs text-forest-glow" role="status">
                {skillBoostStatus}
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="equipment" className="p-0">
          <div className="grid min-h-[368px] items-stretch gap-5 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)]">
            <div className="border border-forest-light/20 bg-forest-dark/25 p-3">
              <p className="mb-3 text-xs text-muted-foreground">
                Drag equipment onto a compatible slot. Dropping onto an
                occupied slot swaps the old item back into your inventory.
              </p>
              <div className="mx-auto grid w-fit grid-cols-[repeat(3,80px)] grid-rows-[repeat(4,80px)] gap-2">
                {EQUIPMENT_SLOT_VALUES.map((slot) => {
                  const equipped = inventory.data.equipment.find(
                    (entry) => entry.slot === slot
                  )?.item ?? null;
                  return (
                    <div key={slot} className={`size-20 ${SLOT_LAYOUT[slot]}`}>
                      <EquipmentSlotCard
                        slot={slot}
                        ownedItem={equipped}
                        draggingItem={draggingItem}
                        onDrop={handleDrop}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onUnequip={handleUnequip}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex min-h-0 flex-col">
              <ItemGrid
                items={equipmentItems}
                selectedItemId={selectedEquipmentItemId}
                emptyMessage="No equipment is available yet."
                fill
                onSelect={(ownedItem) => {
                  setSelectedEquipmentItemId(ownedItem._id);
                  setActionError(null);
                }}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              />
              <div className="mt-3 shrink-0">
                <ItemDetails
                  ownedItem={selectedEquipmentItem}
                  emptyMessage="Select an equipment item to view its description and available actions."
                  error={actionError}
                  actions={
                    selectedEquipmentItem ? (
                      <>
                        {selectedEquipmentItem.item.allowedEquipmentSlots.map(
                          (slot) => (
                            <Button
                              key={slot}
                              type="button"
                              size="xs"
                              variant="outline"
                              disabled={isUpdating}
                              onClick={() =>
                                void handleEquip(selectedEquipmentItem, slot)
                              }
                            >
                              Equip {SLOT_LABELS[slot]}
                            </Button>
                          )
                        )}
                      </>
                    ) : undefined
                  }
                />
                <AugmentationControls
                  playerId={playerId}
                  ownedItem={selectedEquipmentItem}
                  itemQuantities={itemQuantities}
                />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
