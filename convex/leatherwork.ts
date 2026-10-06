import { readBalanceMap } from "./balance";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type DatabaseCtx = QueryCtx | MutationCtx;

export const LEATHER_BALANCE_DEFAULTS = [
  {
    key: "bagInventorySlotsPerTier",
    value: 10,
    description:
      "Inventory slots granted per tier of the equipped leather bag (bag tier × this value)",
  },
  {
    key: "beltSecondSlotTier",
    value: 4,
    description:
      "Belt tier that unlocks the 2nd equipped consumable slot (total slots)",
  },
  {
    key: "beltThirdSlotTier",
    value: 8,
    description:
      "Belt tier that unlocks the 3rd equipped consumable slot (total slots)",
  },
] as const;

function readPositiveInt(value: unknown, fallback: number) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1
    ? value
    : fallback;
}

export async function readLeatherBalance(ctx: DatabaseCtx) {
  const values = await readBalanceMap(
    ctx,
    LEATHER_BALANCE_DEFAULTS.map((entry) => entry.key)
  );
  const perTier = readPositiveInt(
    values.get("bagInventorySlotsPerTier"),
    LEATHER_BALANCE_DEFAULTS[0].value
  );
  let second = readPositiveInt(
    values.get("beltSecondSlotTier"),
    LEATHER_BALANCE_DEFAULTS[1].value
  );
  let third = readPositiveInt(
    values.get("beltThirdSlotTier"),
    LEATHER_BALANCE_DEFAULTS[2].value
  );
  if (third < second) third = second;
  return { bagSlotsPerTier: perTier, beltSecondSlotTier: second, beltThirdSlotTier: third };
}

/** Total equipped consumable slots granted by a belt of the given tier. */
export function beltConsumableSlots(
  beltTier: number,
  balance: { beltSecondSlotTier: number; beltThirdSlotTier: number }
) {
  if (!Number.isSafeInteger(beltTier) || beltTier < 1) return 1;
  if (beltTier >= balance.beltThirdSlotTier) return 3;
  if (beltTier >= balance.beltSecondSlotTier) return 2;
  return 1;
}

async function getEquippedBagTier(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<number> {
  const equipped = await ctx.db
    .query("playerItems")
    .withIndex("by_playerId_and_equippedSlot", (q) =>
      q.eq("playerId", playerId).eq("equippedSlot", "bag")
    )
    .first();
  if (!equipped) return 0;
  const item = await ctx.db.get(equipped.itemId);
  const tier = item?.craftingTier;
  return typeof tier === "number" && Number.isSafeInteger(tier) && tier >= 1
    ? tier
    : 0;
}

/** Extra inventory capacity from the equipped leather bag (0 when none). */
export async function getBagCapacityBonus(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<number> {
  const [tier, balance] = await Promise.all([
    getEquippedBagTier(ctx, playerId),
    readLeatherBalance(ctx),
  ]);
  if (tier < 1) return 0;
  return tier * balance.bagSlotsPerTier;
}

/** Crafting tier of the equipped belt (0 when none equipped). */
export async function getEquippedBeltTier(
  ctx: DatabaseCtx,
  playerId: Id<"players">
): Promise<number> {
  const equipped = await ctx.db
    .query("playerItems")
    .withIndex("by_playerId_and_equippedSlot", (q) =>
      q.eq("playerId", playerId).eq("equippedSlot", "belt")
    )
    .first();
  if (!equipped) return 0;
  const item = await ctx.db.get(equipped.itemId);
  // Only leather belts (belt-slot equipment with a crafting tier) count.
  if (!item || item.category !== "equipment") return 0;
  if (!item.allowedEquipmentSlots.includes("belt")) return 0;
  const tier = item.craftingTier;
  return typeof tier === "number" && Number.isSafeInteger(tier) && tier >= 1
    ? tier
    : 0;
}
