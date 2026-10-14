import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePlayer, requirePlayerRead } from "./playerAuth";
import {
  computeEquipmentStats,
  computeWeaponStats,
  getEquippedProfile,
  getEquippedWeapon,
  type EquippedWeaponStats,
  type EquipmentStatBonuses,
} from "./items";
import type { ElementKind } from "./itemTypes";
import { EQUIPMENT_SLOT_VALUES, type EquipmentSlot } from "./itemTypes";

type DatabaseCtx = QueryCtx | MutationCtx;

export const MAX_LOADOUT_SLOTS = EQUIPMENT_SLOT_VALUES.length;

const loadoutSlotValidator = v.union(
  ...EQUIPMENT_SLOT_VALUES.map((slot) => v.literal(slot))
);

/**
 * Effective PvP equipment: saved loadout pieces merged over currently
 * equipped gear (per slot), or plain current gear when nothing is saved.
 * Arena and ranked snapshots resolve through here so fights always use the
 * loadout when one exists.
 */
export type PvpEquipmentBundle = {
  bonuses: EquipmentStatBonuses;
  armor: { defense: number; speedPenalty: number };
  ward: Record<ElementKind, number>;
  weapon: EquippedWeaponStats;
};

/**
 * Merge saved loadout pieces over currently equipped gear, one row per
 * filled slot. Saved pieces win; stale rows (sold/traded/consumed since
 * saving) quietly fall back to whatever is equipped there now.
 */
function mergeLoadoutRows(
  saved: Array<{ slot: EquipmentSlot; playerItemId: Id<"playerItems"> }>,
  owned: Doc<"playerItems">[]
): Doc<"playerItems">[] {
  const ownedById = new Map(owned.map((row) => [String(row._id), row]));
  const equippedNow = new Map<string, Doc<"playerItems">>();
  for (const row of owned) {
    if (row.equippedSlot !== undefined && !equippedNow.has(row.equippedSlot)) {
      equippedNow.set(row.equippedSlot, row);
    }
  }
  const merged: Doc<"playerItems">[] = [];
  for (const slot of EQUIPMENT_SLOT_VALUES) {
    const savedRow = saved.find((entry) => entry.slot === slot);
    const ownedRow =
      savedRow !== undefined
        ? ownedById.get(String(savedRow.playerItemId))
        : undefined;
    if (ownedRow) {
      merged.push({ ...ownedRow, equippedSlot: slot });
      continue;
    }
    const current = equippedNow.get(slot);
    if (current) merged.push(current);
  }
  return merged;
}

export type PvpCornerGear = Array<{
  slot: EquipmentSlot;
  playerItemId: Id<"playerItems">;
  itemName: string;
  itemSlug: string;
  itemFamily?: string;
  category?: string;
  enchantLevel?: number;
}>;

/**
 * Display-ready corner gear frozen for a fight record: the same merged rows
 * the snapshot math uses, reduced to what the battle viewer renders.
 */
export async function snapshotPvpGear(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<PvpCornerGear> {
  const [saved, owned] = await Promise.all([
    ctx.db
      .query("pvpLoadoutSlots")
      .withIndex("by_player", (q) => q.eq("playerId", playerId))
      .take(MAX_LOADOUT_SLOTS + 4),
    ctx.db
      .query("playerItems")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .take(200),
  ]);
  const merged = mergeLoadoutRows(saved, owned);
  const defIds = [...new Set(merged.map((row) => row.itemId))];
  const defs = await Promise.all(defIds.map((id) => ctx.db.get(id)));
  const defById = new Map(defIds.map((id, index) => [String(id), defs[index]]));
  return merged.map((row) => {
    const def = defById.get(String(row.itemId));
    return {
      slot: row.equippedSlot as EquipmentSlot,
      playerItemId: row._id,
      itemName: def?.name ?? "Unknown item",
      itemSlug: def?.itemId ?? "unknown",
      ...(def?.itemFamily === undefined ? {} : { itemFamily: def.itemFamily }),
      ...(def?.category === undefined ? {} : { category: def.category }),
      ...(row.enchantLevel === undefined
        ? {}
        : { enchantLevel: row.enchantLevel }),
    };
  });
}

export async function resolvePvpEquipment(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<PvpEquipmentBundle> {
  const [saved, owned] = await Promise.all([
    ctx.db
      .query("pvpLoadoutSlots")
      .withIndex("by_player", (q) => q.eq("playerId", playerId))
      .take(MAX_LOADOUT_SLOTS + 4),
    ctx.db
      .query("playerItems")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .take(200),
  ]);
  if (saved.length === 0) {
    // No loadout: byte-identical to the live equipment path.
    const [profile, weapon] = await Promise.all([
      getEquippedProfile(ctx, playerId),
      getEquippedWeapon(ctx, playerId),
    ]);
    return { ...profile, weapon };
  }
  const merged = mergeLoadoutRows(saved, owned);
  const [profile, weapon] = await Promise.all([
    computeEquipmentStats(ctx, playerId, merged),
    (async () => {
      const mainHand = merged.find((row) => row.equippedSlot === "mainHand");
      return mainHand ? computeWeaponStats(ctx, mainHand) : null;
    })(),
  ]);
  return { ...profile, weapon };
}

async function validateLoadoutSlots(
  ctx: MutationCtx,
  playerId: Id<"players">,
  slots: Array<{ slot: EquipmentSlot; playerItemId: Id<"playerItems"> }>
) {
  if (slots.length > MAX_LOADOUT_SLOTS) {
    throw new Error("Too many loadout slots");
  }
  if (new Set(slots.map((entry) => entry.slot)).size !== slots.length) {
    throw new Error("Loadout slots must be unique");
  }
  if (
    new Set(slots.map((entry) => String(entry.playerItemId))).size !==
    slots.length
  ) {
    throw new Error("Each loadout piece can only cover one slot");
  }
  for (const entry of slots) {
    if (
      !EQUIPMENT_SLOT_VALUES.includes(
        entry.slot as (typeof EQUIPMENT_SLOT_VALUES)[number]
      )
    ) {
      throw new Error(`Unsupported equipment slot: ${entry.slot}`);
    }
    const owned = await ctx.db.get(entry.playerItemId);
    if (!owned || owned.playerId !== playerId) {
      throw new Error("Loadout references an item you do not own");
    }
    const item = await ctx.db.get(owned.itemId);
    // Same bar as equipping: real equipment that fits the slot.
    if (
      !item ||
      item.category !== "equipment" ||
      item.stackable ||
      !item.allowedEquipmentSlots.includes(entry.slot)
    ) {
      throw new Error("Loadout item cannot go in that slot");
    }
  }
}

export const getPvpLoadout = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayerRead(ctx, playerId);
    const [saved, owned] = await Promise.all([
      ctx.db
        .query("pvpLoadoutSlots")
        .withIndex("by_player", (q) => q.eq("playerId", playerId))
        .take(MAX_LOADOUT_SLOTS + 4),
      ctx.db
        .query("playerItems")
        .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
        .take(200),
    ]);
    const defIds = [...new Set(owned.map((row) => row.itemId))];
    const defs = await Promise.all(defIds.map((id) => ctx.db.get(id)));
    const defById = new Map(defIds.map((id, index) => [String(id), defs[index]]));
    const describe = (row: Doc<"playerItems"> | undefined) => {
      if (!row) return null;
      const def = defById.get(String(row.itemId));
      return {
        playerItemId: row._id,
        itemName: def?.name ?? "Unknown item",
        itemId: def?.itemId ?? "unknown",
        category: def?.category ?? "equipment",
        equippedSlot: row.equippedSlot ?? null,
      };
    };
    const savedBySlot: Record<string, ReturnType<typeof describe>> = {};
    for (const entry of saved) {
      const row = owned.find(
        (candidate) => String(candidate._id) === String(entry.playerItemId)
      );
      savedBySlot[entry.slot] = describe(row);
    }
    const effectiveBySlot: Record<string, ReturnType<typeof describe>> = {};
    for (const slot of EQUIPMENT_SLOT_VALUES) {
      const savedRow =
        savedBySlot[slot] !== undefined && savedBySlot[slot] !== null
          ? owned.find(
              (candidate) =>
                String(candidate._id) ===
                String(savedBySlot[slot]?.playerItemId)
            )
          : undefined;
      const equipped = owned.find((row) => row.equippedSlot === slot);
      effectiveBySlot[slot] = describe(savedRow ?? equipped);
    }
    return {
      hasSaved: saved.length > 0,
      saved: savedBySlot,
      effective: effectiveBySlot,
      updatedAt: saved.length > 0 ? Math.max(...saved.map((s) => s.updatedAt)) : null,
    };
  },
});

/** Replace-all save: omitted slots fall back to currently equipped gear. */
export const savePvpLoadout = mutation({
  args: {
    playerId: v.id("players"),
    slots: v.array(
      v.object({
        slot: loadoutSlotValidator,
        playerItemId: v.id("playerItems"),
      })
    ),
  },
  handler: async (ctx, { playerId, slots }) => {
    await requirePlayer(ctx, playerId);
    await validateLoadoutSlots(ctx, playerId, slots);
    const existing = await ctx.db
      .query("pvpLoadoutSlots")
      .withIndex("by_player", (q) => q.eq("playerId", playerId))
      .take(MAX_LOADOUT_SLOTS + 4);
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }
    const now = Date.now();
    for (const entry of slots) {
      await ctx.db.insert("pvpLoadoutSlots", {
        playerId,
        slot: entry.slot,
        playerItemId: entry.playerItemId,
        updatedAt: now,
      });
    }
    return await ctx.db
      .query("pvpLoadoutSlots")
      .withIndex("by_player", (q) => q.eq("playerId", playerId))
      .take(MAX_LOADOUT_SLOTS + 4);
  },
});

/** Clear the saved loadout: fights fall back to currently equipped gear. */
export const clearPvpLoadout = mutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayer(ctx, playerId);
    const existing = await ctx.db
      .query("pvpLoadoutSlots")
      .withIndex("by_player", (q) => q.eq("playerId", playerId))
      .take(MAX_LOADOUT_SLOTS + 4);
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});
