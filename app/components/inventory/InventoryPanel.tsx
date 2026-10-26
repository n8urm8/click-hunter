import { useState, type DragEvent } from "react";
import { useNavigate, useParams } from "react-router";
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
  useCombatBoost,
  useEquipItem,
  usePlayerInventory,
  useSkillBoost,
  useUnequipItem,
} from "~/hooks/useInventory";
import { ItemIcon } from "~/components/game/ItemIcon";
import { ConsumableSlots } from "~/components/inventory/ConsumableSlots";
import { AbilitiesPanel } from "~/components/inventory/AbilitiesPanel";
import {
  AugmentationControls,
  EnchantmentControls,
  EquipmentSlotCard,
  ItemDetails,
  ItemGrid,
  SLOT_LABELS,
  SLOT_LAYOUT,
  errorMessage,
  formatDuration,
  isCombatEffectType,
  isCompatible,
  isSkillTaskEffectType,
  skillScopeLabel,
  type OwnedItem,
} from "./Equipment";
import { isInventoryTab, type InventoryTab } from "~/lib/gameRoutes";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  EQUIPMENT_SLOT_VALUES,
  type EquipmentSlot,
} from "../../../convex/itemTypes";

interface InventoryPanelProps {
  playerId: Id<"players">;
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

  if (rewards.length === 0) {
    return (
      <div className="border border-gold/25 bg-gold/5 p-3">
        <h3 className="font-heading text-base text-gold">Reward cache</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Inventory overflow is held here until you have room to claim it.
          The cache is currently empty.
        </p>
      </div>
    );
  }

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
    <div className="border border-gold/25 bg-gold/5 p-3">
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
            <div className="flex min-w-0 items-center gap-2">
              <ItemIcon item={reward.item} alt="" className="size-7" />
              <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                {reward.item?.name ?? "Unknown item"}
              </p>
              <p className="text-xs text-muted-foreground">
                x{reward.quantity} · {reward.sourceType} reward
              </p>
              </div>
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


export function InventoryPanel({ playerId }: InventoryPanelProps) {
  const inventory = usePlayerInventory(playerId);
  const equipItem = useEquipItem();
  const unequipItem = useUnequipItem();
  const activateSkillBoost = useSkillBoost();
  const activateCombatBoost = useCombatBoost();
  const navigate = useNavigate();
  const params = useParams();
  const tabParam = params.tab ?? null;
  const routeTab: InventoryTab = isInventoryTab(tabParam)
    ? tabParam
    : "crafting";
  const activeTab: InventoryTab = routeTab;
  const [draggingItemId, setDraggingItemId] = useState<Id<"playerItems"> | null>(
    null
  );
  const [selectedCraftingItemId, setSelectedCraftingItemId] =
    useState<Id<"playerItems"> | null>(null);
  const [selectedEquipmentItemId, setSelectedEquipmentItemId] =
    useState<Id<"playerItems"> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [usingSkillBoostId, setUsingSkillBoostId] =
    useState<Id<"playerItems"> | null>(null);
  const [usingCombatBoostId, setUsingCombatBoostId] =
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

  const handleUseCombatBoost = async (ownedItem: OwnedItem) => {
    if (!isCombatEffectType(ownedItem.item.effectType)) {
      setActionError("That item is not a combat consumable.");
      return;
    }
    if (usingCombatBoostId !== null || isUpdating) return;

    setActionError(null);
    setSkillBoostStatus(null);
    setUsingCombatBoostId(ownedItem._id);
    try {
      const result = await activateCombatBoost({
        playerId,
        playerItemId: ownedItem._id,
      });
      setSkillBoostStatus(
        `Combat effect ${result.effectType} active for ${formatDuration(
          result.expiresAt - Date.now()
        )}.`
      );
    } catch (boostError) {
      setActionError(errorMessage(boostError, "Unable to use consumable."));
    } finally {
      setUsingCombatBoostId(null);
    }
  };

  const selectedCraftingItem =
    craftingItems.find((item) => item._id === selectedCraftingItemId) ?? null;
  const selectedEquipmentItem =
    equipmentItems.find((item) => item._id === selectedEquipmentItemId) ??
    equippedItems.find((item) => item._id === selectedEquipmentItemId) ??
    null;
  const selectedEquipmentIsEquipped = selectedEquipmentItem
    ? inventory.data.equipment.some(
        (entry) => entry.item?._id === selectedEquipmentItem._id
      )
    : false;

  return (
    <Card className="forest-card box-glow-green min-h-[400px] rounded-none gap-0 p-0">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (isInventoryTab(value)) {
            setActionError(null);
            navigate(`/inventory/${value}`);
          }
        }}
        className="gap-0"
      >
        <TabsList variant="forest" aria-label="Inventory category">
          <TabsTrigger value="crafting">Crafting</TabsTrigger>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          <TabsTrigger value="abilities">Abilities</TabsTrigger>
          <TabsTrigger value="cache">
            Cache
            {inventory.data.pendingRewards.length > 0 &&
              ` (${inventory.data.pendingRewards.length})`}
          </TabsTrigger>
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
              attackSpeedMultiplier={inventory.data.attackSpeedMultiplier}
              emptyMessage="Select a crafting item to view its description and available actions."
              error={actionError}
              actions={
                selectedCraftingItem &&
                (isSkillTaskEffectType(selectedCraftingItem.item.effectType) ||
                  isCombatEffectType(selectedCraftingItem.item.effectType)) ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={
                      usingSkillBoostId !== null ||
                      usingCombatBoostId !== null ||
                      isUpdating ||
                      selectedCraftingItem._id === usingSkillBoostId ||
                      selectedCraftingItem._id === usingCombatBoostId
                    }
                    onClick={() =>
                      isCombatEffectType(selectedCraftingItem.item.effectType)
                        ? void handleUseCombatBoost(selectedCraftingItem)
                        : void handleUseSkillBoost(selectedCraftingItem)
                    }
                  >
                    {selectedCraftingItem._id === usingSkillBoostId ||
                    selectedCraftingItem._id === usingCombatBoostId
                      ? "Activating..."
                      : isCombatEffectType(selectedCraftingItem.item.effectType)
                        ? "Use consumable"
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
                Click an equipped item to view it. Drag equipment onto a
                compatible slot. Dropping onto an occupied slot swaps the old
                item back into your inventory.
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
                        selected={
                          equipped?._id === selectedEquipmentItemId
                        }
                        onDrop={handleDrop}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onSelect={(ownedItem) => {
                          setSelectedEquipmentItemId(ownedItem._id);
                          setActionError(null);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <ConsumableSlots playerId={playerId} />
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
                  attackSpeedMultiplier={inventory.data.attackSpeedMultiplier}
                  emptyMessage="Select an equipment item to view its description and available actions."
                  error={actionError}
                  actions={
                    selectedEquipmentItem ? (
                      selectedEquipmentIsEquipped ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={isUpdating}
                          onClick={() =>
                            void handleUnequip(selectedEquipmentItem)
                          }
                        >
                          Unequip
                        </Button>
                      ) : (
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
                      )
                    ) : undefined
                  }
                />
                <AugmentationControls
                  playerId={playerId}
                  ownedItem={selectedEquipmentItem}
                  itemQuantities={itemQuantities}
                />
                <EnchantmentControls
                  playerId={playerId}
                  ownedItem={selectedEquipmentItem}
                  inventoryItems={inventory.data.inventory}
                />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="abilities" className="p-0">
          <AbilitiesPanel playerId={playerId} />
        </TabsContent>

        <TabsContent value="cache" className="p-0">
          <div className="min-h-[368px] p-3">
            <PendingRewardsCard
              playerId={playerId}
              rewards={inventory.data.pendingRewards}
            />
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
