import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Button } from "~/components/ui/button";
import { usePlayerInventory } from "~/hooks/useInventory";
import {
  useClearPvpLoadout,
  usePvpLoadout,
  useSavePvpLoadout,
} from "~/hooks/useArena";
import {
  AugmentationControls,
  EnchantmentControls,
  EquipmentSlotCard,
  ItemDetails,
  ItemGrid,
  SLOT_LABELS,
  SLOT_LAYOUT,
  isCompatible,
  type OwnedItem,
} from "~/components/inventory/Equipment";
import {
  EQUIPMENT_SLOT_VALUES,
  type EquipmentSlot,
} from "../../../convex/itemTypes";
import type { Id } from "../../../convex/_generated/dataModel";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

type Draft = Partial<Record<EquipmentSlot, Id<"playerItems">>>;

/**
 * PvP equipment loadout, presented as the same equipment screen as the
 * inventory: paper doll, item grid, and item details are the shared
 * components. Draft picks override worn gear per slot when fights snapshot;
 * empty slots (or no saved set at all) fall back to whatever is worn.
 */
export function LoadoutPanel({ playerId }: { playerId: Id<"players"> }) {
  const inventory = usePlayerInventory(playerId);
  const loadout = usePvpLoadout(playerId);
  const saveLoadout = useSavePvpLoadout();
  const clearLoadout = useClearPvpLoadout();
  const [draft, setDraft] = useState<Draft>({});
  const [selectedEquipmentItemId, setSelectedEquipmentItemId] =
    useState<Id<"playerItems"> | null>(null);
  const [draggingItemId, setDraggingItemId] =
    useState<Id<"playerItems"> | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Hydrate the draft from the saved loadout once it arrives.
  useEffect(() => {
    if (hydrated || !loadout.data) return;
    const next: Draft = {};
    for (const slot of EQUIPMENT_SLOT_VALUES) {
      const entry = loadout.data.saved[slot];
      if (entry) next[slot] = entry.playerItemId;
    }
    setDraft(next);
    setHydrated(true);
  }, [hydrated, loadout.data]);

  const findOwnedItem = useMemo(() => {
    if (!inventory.data) return (_id: Id<"playerItems">): OwnedItem | null => null;
    const equippedFlat = inventory.data.equipment.flatMap((entry) =>
      entry.item ? [entry.item] : []
    );
    return (id: Id<"playerItems">): OwnedItem | null =>
      inventory.data.inventory.find((item) => item._id === id) ??
      equippedFlat.find((item) => item._id === id) ??
      null;
  }, [inventory.data]);

  const equipmentItems = useMemo(
    () =>
      inventory.data?.inventory.filter(
        (ownedItem) => ownedItem.item.category === "equipment"
      ) ?? [],
    [inventory.data]
  );

  const itemQuantities = useMemo(() => {
    const map = new Map<string, number>();
    for (const ownedItem of inventory.data?.inventory ?? []) {
      map.set(
        ownedItem.itemId,
        (map.get(ownedItem.itemId) ?? 0) + ownedItem.quantity
      );
    }
    return map;
  }, [inventory.data]);

  const effectiveItem = (slot: EquipmentSlot): OwnedItem | null => {
    const picked = draft[slot] ? findOwnedItem(draft[slot] as Id<"playerItems">) : null;
    if (picked) return picked;
    return (
      inventory.data?.equipment.find((entry) => entry.slot === slot)?.item ??
      null
    );
  };

  const selectedEquipmentItem = selectedEquipmentItemId
    ? findOwnedItem(selectedEquipmentItemId)
    : null;

  const savedKey = loadout.data
    ? EQUIPMENT_SLOT_VALUES.map((slot) =>
        loadout.data.saved[slot]
          ? String(loadout.data.saved[slot]?.playerItemId)
          : ""
      ).join("|")
    : null;
  const draftKey = EQUIPMENT_SLOT_VALUES.map((slot) =>
    draft[slot] ? String(draft[slot]) : ""
  ).join("|");
  const dirty = savedKey !== null && savedKey !== draftKey;
  const draggingItem = draggingItemId ? findOwnedItem(draggingItemId) : null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const assignSlot = (ownedItem: OwnedItem, slot: EquipmentSlot) => {
    if (!isCompatible(ownedItem, slot)) {
      setError(`${ownedItem.item.name} cannot fight in that slot.`);
      return;
    }
    setDraft((current) => ({ ...current, [slot]: ownedItem._id }));
    setError(null);
  };

  const clearSlot = (slot: EquipmentSlot) => {
    setDraft((current) => {
      const next = { ...current };
      delete next[slot];
      return next;
    });
    setError(null);
  };

  const handleDragStart = (
    event: DragEvent<HTMLElement>,
    ownedItem: OwnedItem
  ) => {
    setError(null);
    setDraggingItemId(ownedItem._id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ownedItem._id);
  };

  const handleDragEnd = () => setDraggingItemId(null);

  const handleDrop = (
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
      setError("That item is no longer available.");
      return;
    }
    assignSlot(ownedItem, slot);
  };

  const handleSave = () =>
    run(async () => {
      await saveLoadout({
        playerId,
        slots: EQUIPMENT_SLOT_VALUES.flatMap((slot) =>
          draft[slot]
            ? [{ slot, playerItemId: draft[slot] as Id<"playerItems"> }]
            : []
        ),
      });
      setHydrated(false);
    });

  const handleReset = () =>
    run(async () => {
      await clearLoadout({ playerId });
      setDraft({});
    });

  if (inventory.isPending || loadout.isPending) {
    return <p className="text-sm text-muted-foreground">Loading loadout...</p>;
  }
  if (!inventory.data || !loadout.data) {
    return (
      <p className="text-sm text-blood-light" role="alert">
        Unable to load equipment.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {loadout.data.hasSaved
            ? "Saved set fights in every PvP battle. Empty slots fall back to what you wear."
            : "No saved set — fights use whatever you wear. Set gear per slot, then save."}
        </p>
        <Button size="sm" disabled={busy || !dirty} onClick={handleSave}>
          {busy ? "Saving..." : "Save loadout"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || (!dirty && !loadout.data.hasSaved)}
          onClick={handleReset}
        >
          Reset
        </Button>
      </div>
      {error && (
        <p className="text-xs text-blood-light" role="alert">
          {error}
        </p>
      )}

      <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)]">
        <div className="border border-forest-light/20 bg-forest-dark/25 p-3">
          <p className="mb-3 text-xs text-muted-foreground">
            Click a set piece to view it. Drag equipment onto a compatible
            slot. Set pieces override worn gear when PvP fights snapshot.
          </p>
          <div className="mx-auto grid w-fit grid-cols-[repeat(3,80px)] grid-rows-[repeat(4,80px)] gap-2">
            {EQUIPMENT_SLOT_VALUES.map((slot) => {
              const effective = effectiveItem(slot);
              const picked =
                effective !== null &&
                draft[slot] !== undefined &&
                String(draft[slot]) === String(effective._id);
              return (
                <div
                  key={slot}
                  className={`relative size-20 ${SLOT_LAYOUT[slot]}`}
                >
                  <EquipmentSlotCard
                    slot={slot}
                    ownedItem={effective}
                    draggingItem={draggingItem}
                    selected={
                      effective?._id === selectedEquipmentItemId
                    }
                    onDrop={handleDrop}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onSelect={(ownedItem) => {
                      setSelectedEquipmentItemId(ownedItem._id);
                      setError(null);
                    }}
                  />
                  {picked && (
                    <span className="pointer-events-none absolute -right-1 -top-1 border border-gold/60 bg-forest-dark px-1 text-[9px] font-bold uppercase tracking-wider text-gold-light">
                      PvP
                    </span>
                  )}
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
              setError(null);
            }}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
          <div className="mt-3 shrink-0">
            <ItemDetails
              ownedItem={selectedEquipmentItem}
              attackSpeedMultiplier={inventory.data.attackSpeedMultiplier}
              emptyMessage="Select an equipment item to view its description and set it."
              error={null}
              actions={
                selectedEquipmentItem ? (
                  <>
                    {selectedEquipmentItem.item.allowedEquipmentSlots.map(
                      (slot) =>
                        draft[slot] === selectedEquipmentItem._id ? (
                          <Button
                            key={slot}
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={busy}
                            onClick={() => clearSlot(slot)}
                          >
                            Clear {SLOT_LABELS[slot]}
                          </Button>
                        ) : (
                          <Button
                            key={slot}
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              assignSlot(selectedEquipmentItem, slot)
                            }
                          >
                            Set {SLOT_LABELS[slot]}
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
            <EnchantmentControls
              playerId={playerId}
              ownedItem={selectedEquipmentItem}
              inventoryItems={inventory.data.inventory}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
