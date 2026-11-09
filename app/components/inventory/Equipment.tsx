import { useState, type DragEvent, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { ItemIcon } from "~/components/game/ItemIcon";
import { useSkillPanel } from "~/hooks/useSkills";
import { useEnqueueSkillAction } from "~/hooks/useTasks";
import { useEnchantEquipment } from "~/hooks/useInventory";
import { formatPercent, infusionSuccessChance } from "~/lib/infusion";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  COMBAT_EFFECT_TYPES,
  SKILL_TASK_EFFECT_TYPES,
  type CombatEffectType,
  type EquipmentSlot,
  type SkillBonusScope,
  type SkillTaskEffectType,
} from "../../../convex/itemTypes";

export type OwnedItem = {
  _id: Id<"playerItems">;
  itemId: Id<"items">;
  quantity: number;
  enchantLevel?: number;
  acquiredAt: number;
  updatedAt: number;
  item: Doc<"items">;
  rarity: Doc<"itemRarities"> | null;
  augments: Doc<"playerItemAugments">[];
};

export type CatalogAugmentation = NonNullable<
  ReturnType<typeof useSkillPanel>["data"]
>["augmentations"][number];

export const SLOT_LABELS: Record<EquipmentSlot, string> = {
  head: "Head",
  chest: "Chest",
  mainHand: "Main Hand",
  offHand: "Off Hand",
  legs: "Legs",
  feet: "Feet",
  accessory1: "Accessory 1",
  accessory2: "Accessory 2",
  amulet: "Amulet",
  belt: "Belt",
  bag: "Bag",
  craftingEquipment: "Crafting Equipment",
};

export const SLOT_LAYOUT: Record<EquipmentSlot, string> = {
  belt: "col-start-1 row-start-1",
  head: "col-start-2 row-start-1",
  amulet: "col-start-3 row-start-1",
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

export function isSkillTaskEffectType(
  value: string | undefined
): value is SkillTaskEffectType {
  return SKILL_TASK_EFFECT_TYPES.some((effectType) => effectType === value);
}

export function isCombatEffectType(
  value: string | undefined
): value is CombatEffectType {
  return COMBAT_EFFECT_TYPES.some((effectType) => effectType === value);
}

export function skillScopeLabel(scope: SkillBonusScope | undefined) {
  if (scope === "all" || scope === undefined) return "all skills";
  return scope;
}

export function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

export function errorMessage(error: unknown, fallback = "Unable to update inventory.") {
  return error instanceof Error ? error.message : fallback;
}

export function isCompatible(item: OwnedItem, slot: EquipmentSlot) {
  return (
    item.item.category === "equipment" &&
    item.item.allowedEquipmentSlots.includes(slot)
  );
}

export type ItemDragHandler = (
  event: DragEvent<HTMLElement>,
  ownedItem: OwnedItem
) => void;

export function statLabel(stat: string | undefined) {
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
export function ItemGridItem({
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
      <ItemIcon item={ownedItem.item} alt="" />
      {ownedItem.quantity > 1 && (
        <span className="absolute -right-1 -top-1 min-w-4 border border-gold/50 bg-forest-dark px-0.5 text-[9px] font-semibold leading-4 text-gold-light">
          {ownedItem.quantity}
        </span>
      )}
    </button>
  );
}

export function ItemGrid({
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

export function ItemDetails({
  ownedItem,
  attackSpeedMultiplier,
  emptyMessage,
  error,
  actions,
}: {
  ownedItem: OwnedItem | null;
  attackSpeedMultiplier: number;
  emptyMessage: string;
  error: string | null;
  actions?: ReactNode;
}) {
  return (
    <div className="min-h-28 border border-forest-light/25 bg-forest-dark/30 p-3">
      {ownedItem ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <ItemIcon item={ownedItem.item} alt="" className="size-9 mt-0.5" />
              <div className="min-w-0">
              <p className="font-heading text-sm text-gold-light">
                {ownedItem.item.name}
                {(ownedItem.enchantLevel ?? 0) > 0 && (
                  <span className="text-forest-glow">
                    {" "}+{ownedItem.enchantLevel}
                  </span>
                )}
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
          {(ownedItem.item.baseDamage !== undefined ||
            ownedItem.item.attackSpeed !== undefined ||
            ownedItem.item.baseDefense !== undefined) && (
            <p className="mt-2 text-xs font-semibold text-gold">
              {ownedItem.item.baseDamage !== undefined &&
                `Damage ${ownedItem.item.baseDamage}`}
              {ownedItem.item.attackSpeed !== undefined &&
                ` · Base speed ${Number((ownedItem.item.attackSpeed * attackSpeedMultiplier).toFixed(3))}/s`}
              {ownedItem.item.damageStat !== undefined &&
                ` · scales ${statLabel(ownedItem.item.damageStat) ?? ownedItem.item.damageStat}`}
              {ownedItem.item.damageType === "magical" && " · magical"}
              {ownedItem.item.baseDefense !== undefined &&
                `Defense ${ownedItem.item.baseDefense}`}
              {ownedItem.item.speedPenalty !== undefined &&
                ownedItem.item.speedPenalty > 0 &&
                ` · −${Number((ownedItem.item.speedPenalty * attackSpeedMultiplier).toFixed(3))}/s`}
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

export function AugmentationControls({
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
  const isChainCompatible = (augmentation: CatalogAugmentation) => {
    if (augmentation.requiresPreviousTier !== true) return true;
    if (augmentation.tier <= 1) return true;
    const predecessor = ownedItem.augments.find(
      (applied) => (applied.tier ?? 0) === augmentation.tier - 1
    );
    if (!predecessor) return false;
    return ownedItem.augments.length - 1 < augmentSlots;
  };
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
      ) &&
      (augmentation.requiresPreviousTier === true
        ? isChainCompatible(augmentation)
        : ownedItem.augments.length < augmentSlots)
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
              {augment.effectElement ? ` ${augment.effectElement}` : ""}
              {augment.tier !== undefined ? ` · T${augment.tier}` : ""}
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

export function EnchantmentControls({
  playerId,
  ownedItem,
  inventoryItems,
}: {
  playerId: Id<"players">;
  ownedItem: OwnedItem | null;
  inventoryItems: OwnedItem[];
}) {
  const skillPanel = useSkillPanel(playerId);
  const enchantEquipment = useEnchantEquipment();
  const [isEnchanting, setIsEnchanting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!ownedItem || ownedItem.item.category !== "equipment") return null;

  const rates = skillPanel.data?.infusionRates;
  const infusionLevel =
    skillPanel.data?.playerSkills.find(
      (skill) => skill.skillId === "infusion"
    )?.level ?? 1;
  const current = ownedItem.enchantLevel ?? 0;
  const next = current + 1;
  const isWeapon = ownedItem.item.baseDamage !== undefined;
  const isArmor = ownedItem.item.baseDefense !== undefined;
  const enchantable = isWeapon || isArmor;
  const essenceSlug = `essence-tier-${next}`;
  const essenceCount = inventoryItems
    .filter((row) => row.item.itemId === essenceSlug)
    .reduce((total, row) => total + row.quantity, 0);
  const need = rates?.enchantEssenceQty ?? 25;
  const goldCost = Math.ceil((rates?.enchantGoldPerLevel ?? 0) * next);
  const atCap = rates ? next > rates.enchantLevelCap : false;
  const chance = rates
    ? infusionSuccessChance(infusionLevel, next, rates)
    : null;
  const bonus = isWeapon
    ? `+${rates?.damagePerLevel ?? 2} base damage`
    : `+${rates?.defensePerLevel ?? 2} base defense`;

  const runEnchant = async () => {
    setIsEnchanting(true);
    setError(null);
    setStatus(null);
    try {
      const result = await enchantEquipment({
        playerId,
        playerItemId: ownedItem._id,
      });
      setStatus(
        result.success
          ? `Enchanted to +${result.enchantLevel}!`
          : `Infusion failed — materials burned for +${result.experienceEarned} Infusion XP. Still +${result.enchantLevel}.`
      );
    } catch (enchantError) {
      setError(
        enchantError instanceof Error
          ? enchantError.message
          : "Unable to enchant."
      );
    } finally {
      setIsEnchanting(false);
    }
  };

  return (
    <div className="mt-3 border-t border-forest-light/20 pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Enchantment
        </p>
        <span className="text-[10px] text-muted-foreground">
          {current > 0 ? `+${current}` : "Unenchanted"}
        </span>
      </div>
      {!enchantable ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Only weapons and armor can be enchanted.
        </p>
      ) : atCap ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Maximum enchant level reached.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-forest-glow">
            +{next}: {need}x {essenceSlug} (have {essenceCount}){goldCost > 0 ? ` + ${goldCost.toLocaleString()} gold` : ""} · {bonus}
            {chance !== null &&
              ` · ${formatPercent(chance)} at Infusion ${infusionLevel}`}
          </p>
          <Button
            type="button"
            size="xs"
            disabled={isEnchanting || essenceCount < need}
            onClick={() => void runEnchant()}
          >
            {isEnchanting ? "Enchanting..." : `Enchant +${next}`}
          </Button>
        </div>
      )}
      {status && (
        <p className="mt-2 text-xs text-forest-glow" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-blood-light" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function EquipmentSlotCard({
  slot,
  ownedItem,
  draggingItem,
  selected,
  onDrop,
  onDragStart,
  onDragEnd,
  onSelect,
}: {
  slot: EquipmentSlot;
  ownedItem: OwnedItem | null;
  draggingItem: OwnedItem | null;
  selected: boolean;
  onDrop: (event: DragEvent<HTMLButtonElement>, slot: EquipmentSlot) => void;
  onDragStart: ItemDragHandler;
  onDragEnd: () => void;
  onSelect: (ownedItem: OwnedItem) => void;
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
      } ${selected && ownedItem ? "ring-2 ring-gold/70" : ""}`}
      aria-label={
        ownedItem
          ? `${ownedItem.item.name}${rarityLabel}, equipped in ${SLOT_LABELS[slot]}. Activate to view details.`
          : `${SLOT_LABELS[slot]} equipment slot`
      }
      aria-pressed={ownedItem ? selected : undefined}
      onClick={() => {
        if (ownedItem) onSelect(ownedItem);
      }}
      onDragOver={(event) => {
        if (canAcceptDrop) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => onDrop(event, slot)}
    >
      {ownedItem ? (
        <div
          draggable
          onDragStart={(event) => onDragStart(event, ownedItem)}
          onDragEnd={onDragEnd}
          className="flex cursor-grab items-center justify-center active:cursor-grabbing"
          title={`${ownedItem.item.name} — drag to another compatible slot`}
        >
          <ItemIcon item={ownedItem.item} alt="" className="size-12" />
        </div>
      ) : (
        <>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {SLOT_LABELS[slot]}
          </span>
          <span className="mt-1 flex flex-col items-center gap-1">
            <ItemIcon
              item={{ category: "equipment", allowedEquipmentSlots: [slot] }}
              alt=""
              className="size-8 opacity-30"
            />
            <span className="text-xs text-muted-foreground/60">Empty</span>
          </span>
        </>
      )}
    </button>
  );
}
