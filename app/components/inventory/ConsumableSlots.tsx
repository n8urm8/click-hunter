import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { Button } from "~/components/ui/button";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import {
  useConsumableSlots,
  useSetConsumableSlot,
} from "~/hooks/useInventory";
import { useHpStatus } from "~/hooks/usePlayer";
import { convexQueryCacheOptions } from "~/lib/queryCache";

type SlotItem = Doc<"items"> | null;

function applicabilityLabel(
  item: Pick<Doc<"items">, "effectType" | "effectScope"> | null
): string {
  if (!item?.effectType) return "Unknown";
  switch (item.effectType) {
    case "heal-over-time":
      return "Battle only · heals in combat";
    case "combat-stat-boost":
      return "Battle only";
    case "combat-xp-multiplier":
      return "Battle only · bonus XP";
    case "skill-xp-multiplier":
    case "skill-speed-multiplier": {
      const scope = item.effectScope ?? "all";
      return scope === "all"
        ? "Skilling · all skills"
        : `Skilling · ${scope} only`;
    }
    default:
      return item.effectType;
  }
}

export function ConsumableSlots({
  playerId,
}: {
  playerId: Id<"players">;
}) {
  const slotsQuery = useConsumableSlots(playerId);
  const setSlot = useSetConsumableSlot();
  const hpQuery = useHpStatus(playerId);
  const [error, setError] = useState<string | null>(null);
  const [pendingSlot, setPendingSlot] = useState<number | null>(null);

  if (slotsQuery.isPending) {
    return <p className="text-xs text-muted-foreground">Loading consumable belt...</p>;
  }
  if (!slotsQuery.data) {
    return (
      <p className="text-xs text-blood-light" role="alert">
        Unable to load consumable slots.
      </p>
    );
  }

  const hp = hpQuery.data;
  const hpPercent = hp ? Math.min(100, (hp.currentHp / hp.maxHp) * 100) : 0;

  const handleEquip = async (
    slotIndex: number,
    itemDefId: Id<"items">
  ) => {
    setError(null);
    setPendingSlot(slotIndex);
    try {
      await setSlot({ playerId, slotIndex, itemDefId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to equip consumable.");
    } finally {
      setPendingSlot(null);
    }
  };

  const handleClear = async (slotIndex: number) => {
    setError(null);
    setPendingSlot(slotIndex);
    try {
      await setSlot({ playerId, slotIndex });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to clear slot.");
    } finally {
      setPendingSlot(null);
    }
  };

  return (
    <div className="mt-4 border border-forest-light/20 bg-forest-dark/25 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-heading text-sm text-gold">Consumable Belt</h3>
        {hp && (
          <p className="text-xs text-muted-foreground" role="status">
            HP {hp.currentHp}/{hp.maxHp} · CON regen{" "}
            {hp.conRegenPerSecond.toFixed(1)}/s
            {hp.boostRegenPerSecond > 0 &&
              ` + potion ${hp.boostRegenPerSecond.toFixed(1)}/s`}
          </p>
        )}
      </div>
      {hp && (
        <div
          className="mb-3 h-2 w-full overflow-hidden rounded bg-black/40"
          role="progressbar"
          aria-valuenow={Math.round(hpPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Persistent health"
        >
          <div
            className="h-full bg-gradient-to-r from-red-700 to-green-500 transition-all"
            style={{ width: `${hpPercent}%` }}
          />
        </div>
      )}
      <p className="mb-3 text-xs text-muted-foreground">
        Equipped brews auto-use when their timer expires while you run a
        matching task. Battle brews only fire in combat; skilling brews only
        fire on matching skills. Slots stay equipped when stock runs out but go
        inactive until refilled.
      </p>
      <div className="flex flex-col gap-2">
        {slotsQuery.data.slots.map(
          (slot: {
            slotIndex: number;
            item: SlotItem;
            stock: number;
          }) => (
            <div
              key={slot.slotIndex}
              className="flex flex-col gap-1 border border-forest-light/10 p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">
                  Slot {slot.slotIndex + 1}
                </span>
                {slot.item ? (
                  <span className="text-xs text-forest-glow">
                    {slot.item.name} ×{slot.stock} ·{" "}
                    {applicabilityLabel(slot.item)}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Empty</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {slot.item && (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={pendingSlot === slot.slotIndex}
                    onClick={() => void handleClear(slot.slotIndex)}
                  >
                    {pendingSlot === slot.slotIndex ? "Updating..." : "Unequip"}
                  </Button>
                )}
                <EquipPicker
                  playerId={playerId}
                  slotIndex={slot.slotIndex}
                  currentItemDefId={slot.item?._id ?? null}
                  disabled={pendingSlot === slot.slotIndex}
                  onEquip={handleEquip}
                />
              </div>
            </div>
          )
        )}
        {slotsQuery.data.locked.map((slotIndex: number) => (
          <div
            key={slotIndex}
            className="border border-dashed border-forest-light/20 p-2 text-xs text-muted-foreground"
          >
            Slot {slotIndex + 1} locked — equip a higher-tier belt
            (t4 belt: 2 slots, t8 belt: 3 slots) from leathercrafting.
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

function EquipPicker({
  playerId,
  slotIndex,
  currentItemDefId,
  disabled,
  onEquip,
}: {
  playerId: Id<"players">;
  slotIndex: number;
  currentItemDefId: Id<"items"> | null;
  disabled: boolean;
  onEquip: (slotIndex: number, itemDefId: Id<"items">) => Promise<void>;
}) {
  const inventory = useQuery({
    ...convexQuery(api.items.getPlayerInventory, { playerId }),
    ...convexQueryCacheOptions,
  });
  const [selected, setSelected] = useState<string>("");
  const rows = (inventory.data as { inventory?: Array<{
    _id: Id<"playerItems">;
    equippedSlot?: string;
    quantity: number;
    item: Doc<"items">;
  }> } | undefined)?.inventory ?? [];
  const consumables = rows.filter(
    (row) =>
      row.equippedSlot === undefined &&
      row.item.category === "crafting" &&
      typeof row.item.effectType === "string" &&
      typeof row.item.effectAmount === "number" &&
      typeof row.item.effectDurationMs === "number"
  );
  if (consumables.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <select
        aria-label={`Equip consumable to slot ${slotIndex + 1}`}
        className="max-w-48 border border-forest-light/20 bg-black/40 px-1 py-1 text-xs"
        value={selected}
        disabled={disabled}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">Brew from inventory…</option>
        {consumables.map((row) => (
          <option
            key={row._id}
            value={row.item._id}
            disabled={row.item._id === currentItemDefId}
          >
            {row.item.name} ×{row.quantity}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={disabled || !selected}
        onClick={() => {
          const defId = selected as Id<"items">;
          setSelected("");
          void onEquip(slotIndex, defId);
        }}
      >
        Equip
      </Button>
    </span>
  );
}
