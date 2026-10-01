/**
 * Bazaar — the player-to-player marketplace, run as a price-priority order
 * book. Everything is priced in gold.
 *
 * - Sell orders escrow the listed items (removed from the seller's inventory
 *   while the order is open; equipment augments are snapshotted on the order
 *   and travel with the item).
 * - Buy orders escrow their full gold total up front (escrowedGold).
 * - New orders auto-match against crossing orders at the resting (maker)
 *   price, best price first then oldest first. Unfilled remainders rest on
 *   the book. Fills may be partial.
 * - A tax of bazaarTaxPercent (seeded gameBalance, default 5%) is deducted
 *   from the seller's proceeds on every fill, rounded DOWN to the nearest
 *   whole gold (so small trades can be untaxed), and burned — it is never
 *   credited to any player.
 * - Orders expire after bazaarOrderExpiryDays (seeded gameBalance, default
 *   7). Expiry is enforced lazily: expired orders stop matching immediately
 *   and the owner claims the escrow through cancelOrder.
 * - Players may hold bazaarMaxOpenOrders (seeded gameBalance, default 5)
 *   active orders at a time.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { settleTasksBeforeInteraction } from "./taskSettlement";
import {
  canGrantItemToInventory,
  grantItemToInventory,
  itemCategoryValidator,
} from "./items";

export const DEFAULT_BAZAAR_TAX_PERCENT = 5;
export const DEFAULT_BAZAAR_ORDER_EXPIRY_DAYS = 7;
export const DEFAULT_BAZAAR_MAX_OPEN_ORDERS = 5;

const MAX_ORDER_UNIT_PRICE = 1_000_000_000;
const MAX_ORDER_QUANTITY = 1_000_000;
const BROWSE_FETCH_WINDOW = 300;
const MATCH_FETCH_WINDOW = 100;
export const CATALOG_FETCH_LIMIT = 300;
const MY_ORDERS_FETCH_LIMIT = 50;
const MAX_AUGMENTS_PER_ITEM = 20;
const DEFAULT_BROWSE_LIMIT = 50;
const MAX_BROWSE_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

type MarketOrder = Doc<"marketOrders">;
type EscrowedAugment = NonNullable<MarketOrder["escrowedAugments"]>[number];

type BazaarConfig = {
  taxPercent: number;
  expiryMs: number;
  maxOpenOrders: number;
};

// ─── Balance configuration ────────────────────────────────────────────────────

function readIntInRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

export async function readBazaarConfig(
  ctx: QueryCtx | MutationCtx
): Promise<BazaarConfig> {
  const [taxRow, expiryRow, maxOrdersRow] = await Promise.all([
    ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "bazaarTaxPercent"))
      .first(),
    ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "bazaarOrderExpiryDays"))
      .first(),
    ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", "bazaarMaxOpenOrders"))
      .first(),
  ]);
  return {
    taxPercent: readIntInRange(
      taxRow?.value,
      0,
      100,
      DEFAULT_BAZAAR_TAX_PERCENT
    ),
    expiryMs:
      readIntInRange(
        expiryRow?.value,
        1,
        365,
        DEFAULT_BAZAAR_ORDER_EXPIRY_DAYS
      ) * DAY_MS,
    maxOpenOrders: readIntInRange(
      maxOrdersRow?.value,
      1,
      100,
      DEFAULT_BAZAAR_MAX_OPEN_ORDERS
    ),
  };
}

function calculateTradeTax(total: number, taxPercent: number): number {
  return Math.floor((total * taxPercent) / 100);
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function validateUnitPrice(unitPrice: number) {
  if (
    !Number.isSafeInteger(unitPrice) ||
    unitPrice < 1 ||
    unitPrice > MAX_ORDER_UNIT_PRICE
  ) {
    throw new Error(
      `Unit price must be a whole number of gold between 1 and ${MAX_ORDER_UNIT_PRICE}`
    );
  }
}

function validateQuantity(quantity: number) {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_ORDER_QUANTITY
  ) {
    throw new Error("Quantity must be a positive whole number");
  }
}

function validateTradeTotal(total: number) {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("Trade total is too large");
  }
}

async function countActiveOpenOrders(
  ctx: MutationCtx,
  playerId: Id<"players">,
  maxOpenOrders: number
): Promise<number> {
  const now = Date.now();
  const rows = await ctx.db
    .query("marketOrders")
    .withIndex("by_playerId_and_status", (q) =>
      q.eq("playerId", playerId).eq("status", "open")
    )
    // Stream-filter expired rows so the bounded take only sees active ones;
    // otherwise expired-unclaimed orders could crowd out active ones.
    .filter((q) => q.gt(q.field("expiresAt"), now))
    .take(maxOpenOrders + 1);
  return rows.length;
}

// ─── Escrow: taking items from a seller's inventory ───────────────────────────

type EscrowTake = {
  itemId: Id<"items">;
  quantity: number;
  augments: EscrowedAugment[];
};

async function getAugmentsFor(
  ctx: MutationCtx,
  playerItemId: Id<"playerItems">
) {
  const rows = await ctx.db
    .query("playerItemAugments")
    .withIndex("by_playerItemId", (q) => q.eq("playerItemId", playerItemId))
    .take(MAX_AUGMENTS_PER_ITEM);
  return rows;
}

async function deleteRowAndAugments(
  ctx: MutationCtx,
  row: { _id: Id<"playerItems"> }
) {
  for (const augment of await getAugmentsFor(ctx, row._id)) {
    await ctx.db.delete(augment._id);
  }
  await ctx.db.delete(row._id);
}

function stripAugment(augment: Doc<"playerItemAugments">): EscrowedAugment {
  return {
    augmentationId: augment.augmentationId,
    name: augment.name,
    effectType: augment.effectType,
    ...(augment.effectStat === undefined
      ? {}
      : { effectStat: augment.effectStat }),
    effectAmount: augment.effectAmount,
    appliedAt: augment.appliedAt,
  };
}

/**
 * Take escrow from one specific inventory row (the listing flow: the player
 * picks the exact stack or equipment item they are selling).
 */
async function takeEscrowFromRow(
  ctx: MutationCtx,
  playerId: Id<"players">,
  playerItemId: Id<"playerItems">,
  quantity: number,
  now: number
): Promise<EscrowTake> {
  const row = await ctx.db.get(playerItemId);
  if (!row || row.playerId !== playerId) {
    throw new Error("Inventory item not found");
  }
  if (row.equippedSlot !== undefined) {
    throw new Error("Unequip the item before listing it");
  }
  validateQuantity(quantity);
  if (quantity > row.quantity) {
    throw new Error("Not enough of that item to list");
  }
  const item = await ctx.db.get(row.itemId);
  if (!item) {
    throw new Error("Item definition not found");
  }
  const augments = await getAugmentsFor(ctx, row._id);

  if (item.stackable) {
    if (augments.length > 0) {
      throw new Error("Augmented items cannot be traded on the Bazaar");
    }
    if (quantity === row.quantity) {
      await ctx.db.delete(row._id);
    } else {
      await ctx.db.patch(row._id, {
        quantity: row.quantity - quantity,
        updatedAt: now,
      });
    }
    return { itemId: row.itemId, quantity, augments: [] };
  }

  if (quantity !== 1 || row.quantity !== 1) {
    throw new Error("Equipment is traded one item at a time");
  }
  const snapshot = augments.map(stripAugment);
  await deleteRowAndAugments(ctx, row);
  return { itemId: row.itemId, quantity: 1, augments: snapshot };
}

/**
 * Take escrow for a manual fill of a buy order. If playerItemId is given the
 * sale comes from that exact row; otherwise rows of itemId are consumed
 * first-fit (stackables may span rows, equipment takes a single item).
 */
async function takeEscrowFromInventory(
  ctx: MutationCtx,
  playerId: Id<"players">,
  itemId: Id<"items">,
  quantity: number,
  playerItemId: Id<"playerItems"> | undefined,
  now: number
): Promise<EscrowTake> {
  if (playerItemId) {
    const pinned = await ctx.db.get(playerItemId);
    if (!pinned || pinned.playerId !== playerId) {
      throw new Error("Inventory item not found");
    }
    if (pinned.itemId !== itemId) {
      throw new Error("That item does not match this order");
    }
    return takeEscrowFromRow(ctx, playerId, playerItemId, quantity, now);
  }

  validateQuantity(quantity);
  const item = await ctx.db.get(itemId);
  if (!item) {
    throw new Error("Item definition not found");
  }
  const rows = (
    await ctx.db
      .query("playerItems")
      .withIndex("by_playerId_and_itemId", (q) =>
        q.eq("playerId", playerId).eq("itemId", itemId)
      )
      .collect()
  ).filter((row) => row.equippedSlot === undefined);

  if (item.stackable) {
    let available = 0;
    for (const row of rows) available += row.quantity;
    if (available < quantity) {
      throw new Error("Not enough of that item to sell");
    }

    let remaining = quantity;
    for (const row of rows) {
      if (remaining === 0) break;
      const augments = await getAugmentsFor(ctx, row._id);
      if (augments.length > 0) {
        throw new Error("Augmented items cannot be traded on the Bazaar");
      }
      const consumed = Math.min(row.quantity, remaining);
      remaining -= consumed;
      if (consumed === row.quantity) {
        await ctx.db.delete(row._id);
      } else {
        await ctx.db.patch(row._id, {
          quantity: row.quantity - consumed,
          updatedAt: now,
        });
      }
    }
    return { itemId, quantity, augments: [] };
  }

  if (quantity !== 1) {
    throw new Error("Equipment is traded one item at a time");
  }
  const row = rows[0];
  if (!row) {
    throw new Error("Not enough of that item to sell");
  }
  const snapshot = (await getAugmentsFor(ctx, row._id)).map(stripAugment);
  await deleteRowAndAugments(ctx, row);
  return { itemId, quantity: 1, augments: snapshot };
}

// ─── Escrow: delivering items to a recipient ──────────────────────────────────

/**
 * Deliver escrowed items into a player's inventory. Callers must pass a
 * canGrantItemToInventory pre-check first so delivery cannot fail mid-flow.
 */
async function deliverEscrow(
  ctx: MutationCtx,
  args: {
    toPlayerId: Id<"players">;
    item: Doc<"items">;
    quantity: number;
    augments: EscrowedAugment[];
    now: number;
  }
) {
  if (args.quantity < 1) return;

  if (args.item.stackable) {
    if (args.augments.length > 0) {
      throw new Error("Cannot deliver augmented stackable items");
    }
    await grantItemToInventory(ctx, {
      playerId: args.toPlayerId,
      itemId: args.item._id,
      quantity: args.quantity,
    });
    return;
  }

  if (args.quantity !== 1) {
    throw new Error("Equipment is traded one item at a time");
  }
  const rowId = await ctx.db.insert("playerItems", {
    playerId: args.toPlayerId,
    itemId: args.item._id,
    quantity: 1,
    acquiredAt: args.now,
    updatedAt: args.now,
  });
  for (const augment of args.augments) {
    await ctx.db.insert("playerItemAugments", {
      playerId: args.toPlayerId,
      playerItemId: rowId,
      augmentationId: augment.augmentationId,
      name: augment.name,
      effectType: augment.effectType,
      ...(augment.effectStat === undefined
        ? {}
        : { effectStat: augment.effectStat }),
      effectAmount: augment.effectAmount,
      appliedAt: augment.appliedAt,
    });
  }
}

/** Deliver `quantity` items from an open sell order's escrow to a buyer. */
async function deliverFromSellOrder(
  ctx: MutationCtx,
  order: MarketOrder,
  item: Doc<"items">,
  quantity: number,
  toPlayerId: Id<"players">,
  now: number
) {
  if (!item.stackable && quantity !== 1) {
    throw new Error("Equipment is traded one item at a time");
  }
  await deliverEscrow(ctx, {
    toPlayerId,
    item,
    quantity,
    augments: order.escrowedAugments ?? [],
    now,
  });
}

// ─── Matching engine ──────────────────────────────────────────────────────────

/**
 * Close a fully-filled BUY order. Any escrow still held (fills that executed
 * at better prices than the order's own quote) is refunded to the buyer —
 * it was their gold. `goldSpent` accumulates onto the order's settlement
 * history so completed orders record what was actually paid.
 */
async function closeFilledBuyOrder(
  ctx: MutationCtx,
  order: MarketOrder,
  args: { quantity: number; escrowAfter: number; now: number; goldSpent: number }
) {
  if (args.escrowAfter > 0) {
    const buyer = await ctx.db.get(order.playerId);
    if (!buyer) throw new Error("Buyer not found");
    await ctx.db.patch(order.playerId, {
      gold: buyer.gold + args.escrowAfter,
      lastUpdated: args.now,
    });
  }
  await ctx.db.patch(order._id, {
    quantity: args.quantity,
    escrowedGold: 0,
    settledGold: (order.settledGold ?? 0) + args.goldSpent,
    status: "filled",
    closedAt: args.now,
    updatedAt: args.now,
  });
}

/**
 * Load resting orders on `makerSide` for an item that cross the taker's
 * price, sorted price-priority then time-priority (oldest first). Orders
 * owned by the taker or already expired are skipped.
 */
async function loadCrossingOrders(
  ctx: MutationCtx,
  args: {
    makerSide: "sell" | "buy";
    itemId: Id<"items">;
    takerPlayerId: Id<"players">;
    takerPrice: number;
    now: number;
  }
): Promise<MarketOrder[]> {
  const candidates = await ctx.db
    .query("marketOrders")
    .withIndex("by_side_and_status_and_itemId_and_unitPrice", (q) =>
      q
        .eq("side", args.makerSide)
        .eq("status", "open")
        .eq("itemId", args.itemId)
    )
    .filter((q) => q.gt(q.field("expiresAt"), args.now))
    .take(MATCH_FETCH_WINDOW);

  const crossing = candidates.filter(
    (order) =>
      order.expiresAt > args.now &&
      order.playerId !== args.takerPlayerId &&
      order.quantity > 0 &&
      (args.makerSide === "buy"
        ? order.unitPrice >= args.takerPrice
        : order.unitPrice <= args.takerPrice)
  );
  crossing.sort((left, right) => {
    const priceDelta =
      args.makerSide === "buy"
        ? right.unitPrice - left.unitPrice
        : left.unitPrice - right.unitPrice;
    return priceDelta !== 0 ? priceDelta : left.createdAt - right.createdAt;
  });
  return crossing;
}

/**
 * A taker SELL order fills against resting BUY orders. Trades execute at the
 * resting buyer's price; the taker seller is credited the proceeds.
 */
async function matchSellAgainstBuys(
  ctx: MutationCtx,
  args: {
    takerOrderId: Id<"marketOrders">;
    sellerId: Id<"players">;
    item: Doc<"items">;
    askPrice: number;
    quantity: number;
    augments: EscrowedAugment[];
    config: BazaarConfig;
    now: number;
  }
): Promise<{ filledQuantity: number; goldEarned: number }> {
  let remaining = args.quantity;
  let goldEarned = 0;
  let taxTotal = 0;

  const makers = await loadCrossingOrders(ctx, {
    makerSide: "buy",
    itemId: args.item._id,
    takerPlayerId: args.sellerId,
    takerPrice: args.askPrice,
    now: args.now,
  });

  for (const maker of makers) {
    if (remaining === 0) break;
    const fillQuantity = Math.min(remaining, maker.quantity);
    const total = maker.unitPrice * fillQuantity;
    validateTradeTotal(total);
    if ((maker.escrowedGold ?? 0) < total) {
      throw new Error("Buy order escrow is insufficient");
    }
    const buyerHasRoom = await canGrantItemToInventory(
      ctx,
      maker.playerId,
      args.item._id,
      fillQuantity
    );
    if (!buyerHasRoom) continue;

    await deliverEscrow(ctx, {
      toPlayerId: maker.playerId,
      item: args.item,
      quantity: fillQuantity,
      augments: args.augments,
      now: args.now,
    });

    const tax = calculateTradeTax(total, args.config.taxPercent);
    goldEarned += total - tax;
    taxTotal += tax;

    const makerFilled = fillQuantity === maker.quantity;
    if (makerFilled) {
      await closeFilledBuyOrder(ctx, maker, {
        quantity: 0,
        escrowAfter: (maker.escrowedGold ?? 0) - total,
        now: args.now,
        // Buy-side settlement records gross gold spent from escrow.
        goldSpent: total,
      });
    } else {
      await ctx.db.patch(maker._id, {
        quantity: maker.quantity - fillQuantity,
        escrowedGold: (maker.escrowedGold ?? 0) - total,
        settledGold: (maker.settledGold ?? 0) + total,
        updatedAt: args.now,
      });
    }

    remaining -= fillQuantity;
  }

  if (goldEarned > 0) {
    const seller = await ctx.db.get(args.sellerId);
    if (!seller) throw new Error("Seller not found");
    await ctx.db.patch(args.sellerId, {
      gold: seller.gold + goldEarned,
      lastUpdated: args.now,
    });
  }

  if (remaining < args.quantity) {
    const filled = args.quantity - remaining;
    const taker = await ctx.db.get(args.takerOrderId);
    if (!taker) throw new Error("Sell order not found");
    await ctx.db.patch(args.takerOrderId, {
      quantity: remaining,
      // Sell-side settlement records net proceeds and tax withheld.
      settledGold: (taker.settledGold ?? 0) + goldEarned,
      taxPaid: (taker.taxPaid ?? 0) + taxTotal,
      status: remaining === 0 ? "filled" : "open",
      closedAt: remaining === 0 ? args.now : undefined,
      updatedAt: args.now,
    });
    return { filledQuantity: filled, goldEarned };
  }
  return { filledQuantity: 0, goldEarned: 0 };
}

/**
 * A taker BUY order fills against resting SELL orders. Trades execute at the
 * resting seller's price; the taker buyer pays from their escrowed gold and
 * the resting seller is credited the proceeds (minus tax).
 */
async function matchBuyAgainstSells(
  ctx: MutationCtx,
  args: {
    takerOrderId: Id<"marketOrders">;
    buyerId: Id<"players">;
    item: Doc<"items">;
    bidPrice: number;
    quantity: number;
    config: BazaarConfig;
    now: number;
  }
): Promise<{ filledQuantity: number; goldSpent: number }> {
  let remaining = args.quantity;
  let escrowRemaining = args.quantity * args.bidPrice;
  let goldSpent = 0;

  const makers = await loadCrossingOrders(ctx, {
    makerSide: "sell",
    itemId: args.item._id,
    takerPlayerId: args.buyerId,
    takerPrice: args.bidPrice,
    now: args.now,
  });

  for (const maker of makers) {
    if (remaining === 0) break;
    const fillQuantity = Math.min(remaining, maker.quantity);
    const total = maker.unitPrice * fillQuantity;
    validateTradeTotal(total);
    if (escrowRemaining < total) {
      throw new Error("Buy order escrow is insufficient");
    }
    const buyerHasRoom = await canGrantItemToInventory(
      ctx,
      args.buyerId,
      args.item._id,
      fillQuantity
    );
    if (!buyerHasRoom) continue;

    await deliverFromSellOrder(
      ctx,
      maker,
      args.item,
      fillQuantity,
      args.buyerId,
      args.now
    );

    const tax = calculateTradeTax(total, args.config.taxPercent);
    const seller = await ctx.db.get(maker.playerId);
    if (!seller) throw new Error("Seller not found");
    await ctx.db.patch(maker.playerId, {
      gold: seller.gold + (total - tax),
      lastUpdated: args.now,
    });

    escrowRemaining -= total;
    goldSpent += total;

    const makerFilled = fillQuantity === maker.quantity;
    await ctx.db.patch(maker._id, {
      quantity: maker.quantity - fillQuantity,
      // Sell-side settlement records net proceeds and tax withheld.
      settledGold: (maker.settledGold ?? 0) + (total - tax),
      taxPaid: (maker.taxPaid ?? 0) + tax,
      status: makerFilled ? "filled" : "open",
      closedAt: makerFilled ? args.now : undefined,
      updatedAt: args.now,
    });

    remaining -= fillQuantity;
  }

  if (remaining === 0 && goldSpent > 0) {
    const takerOrder = await ctx.db.get(args.takerOrderId);
    if (!takerOrder) throw new Error("Buy order not found");
    await closeFilledBuyOrder(ctx, takerOrder, {
      quantity: 0,
      escrowAfter: escrowRemaining,
      now: args.now,
      goldSpent,
    });
    return { filledQuantity: args.quantity, goldSpent };
  }
  if (remaining < args.quantity) {
    const filled = args.quantity - remaining;
    const taker = await ctx.db.get(args.takerOrderId);
    if (!taker) throw new Error("Buy order not found");
    await ctx.db.patch(args.takerOrderId, {
      quantity: remaining,
      escrowedGold: escrowRemaining,
      // Buy-side settlement records gross gold spent from escrow.
      settledGold: (taker.settledGold ?? 0) + goldSpent,
      updatedAt: args.now,
    });
    return { filledQuantity: filled, goldSpent };
  }
  return { filledQuantity: 0, goldSpent: 0 };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export const placeSellOrder = mutation({
  args: {
    playerId: v.id("players"),
    playerItemId: v.id("playerItems"),
    quantity: v.number(),
    unitPrice: v.number(),
  },
  handler: async (ctx, { playerId, playerItemId, quantity, unitPrice }) => {
    await settleTasksBeforeInteraction(ctx, playerId);
    const now = Date.now();
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");
    validateUnitPrice(unitPrice);
    const config = await readBazaarConfig(ctx);
    const openCount = await countActiveOpenOrders(
      ctx,
      playerId,
      config.maxOpenOrders
    );
    if (openCount >= config.maxOpenOrders) {
      throw new Error(
        `You can have at most ${config.maxOpenOrders} active Bazaar orders`
      );
    }

    const escrow = await takeEscrowFromRow(
      ctx,
      playerId,
      playerItemId,
      quantity,
      now
    );
    const item = await ctx.db.get(escrow.itemId);
    if (!item) throw new Error("Item definition not found");

    const orderId = await ctx.db.insert("marketOrders", {
      playerId,
      side: "sell",
      itemId: escrow.itemId,
      quantity: escrow.quantity,
      originalQuantity: escrow.quantity,
      unitPrice,
      status: "open",
      escrowedAugments:
        escrow.augments.length > 0 ? escrow.augments : undefined,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + config.expiryMs,
    });

    const match = await matchSellAgainstBuys(ctx, {
      takerOrderId: orderId,
      sellerId: playerId,
      item,
      askPrice: unitPrice,
      quantity: escrow.quantity,
      augments: escrow.augments,
      config,
      now,
    });

    return {
      orderId,
      filledQuantity: match.filledQuantity,
      goldEarned: match.goldEarned,
      remainingQuantity: escrow.quantity - match.filledQuantity,
    };
  },
});

export const placeBuyOrder = mutation({
  args: {
    playerId: v.id("players"),
    itemId: v.id("items"),
    quantity: v.number(),
    unitPrice: v.number(),
  },
  handler: async (ctx, { playerId, itemId, quantity, unitPrice }) => {
    await settleTasksBeforeInteraction(ctx, playerId);
    const now = Date.now();
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found");
    validateUnitPrice(unitPrice);
    validateQuantity(quantity);
    const item = await ctx.db.get(itemId);
    if (!item) throw new Error("Item definition not found");

    const total = unitPrice * quantity;
    validateTradeTotal(total);
    if (player.gold < total) {
      throw new Error("Insufficient gold");
    }

    const config = await readBazaarConfig(ctx);
    const openCount = await countActiveOpenOrders(
      ctx,
      playerId,
      config.maxOpenOrders
    );
    if (openCount >= config.maxOpenOrders) {
      throw new Error(
        `You can have at most ${config.maxOpenOrders} active Bazaar orders`
      );
    }

    await ctx.db.patch(playerId, {
      gold: player.gold - total,
      lastUpdated: now,
    });

    const orderId = await ctx.db.insert("marketOrders", {
      playerId,
      side: "buy",
      itemId,
      quantity,
      originalQuantity: quantity,
      unitPrice,
      status: "open",
      escrowedGold: total,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + config.expiryMs,
    });

    const match = await matchBuyAgainstSells(ctx, {
      takerOrderId: orderId,
      buyerId: playerId,
      item,
      bidPrice: unitPrice,
      quantity,
      config,
      now,
    });

    return {
      orderId,
      filledQuantity: match.filledQuantity,
      goldSpent: match.goldSpent,
      remainingQuantity: quantity - match.filledQuantity,
    };
  },
});

export const fulfillOrder = mutation({
  args: {
    orderId: v.id("marketOrders"),
    playerId: v.id("players"),
    quantity: v.number(),
    playerItemId: v.optional(v.id("playerItems")),
  },
  handler: async (ctx, { orderId, playerId, quantity, playerItemId }) => {
    await settleTasksBeforeInteraction(ctx, playerId);
    const now = Date.now();
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "open") throw new Error("Order is no longer open");
    if (order.expiresAt <= now) throw new Error("Order has expired");
    if (order.playerId === playerId) {
      throw new Error("You cannot fulfill your own order");
    }
    validateQuantity(quantity);
    if (quantity > order.quantity) {
      throw new Error("Not enough quantity left on that order");
    }
    const item = await ctx.db.get(order.itemId);
    if (!item) throw new Error("Item definition not found");
    const config = await readBazaarConfig(ctx);
    const total = order.unitPrice * quantity;
    validateTradeTotal(total);

    if (order.side === "sell") {
      // The caller is buying from a sell order.
      const buyer = await ctx.db.get(playerId);
      if (!buyer) throw new Error("Player not found");
      if (buyer.gold < total) throw new Error("Insufficient gold");
      const hasRoom = await canGrantItemToInventory(
        ctx,
        playerId,
        order.itemId,
        quantity
      );
      if (!hasRoom) throw new Error("Inventory is full");

      await deliverFromSellOrder(ctx, order, item, quantity, playerId, now);

      const tax = calculateTradeTax(total, config.taxPercent);
      const seller = await ctx.db.get(order.playerId);
      if (!seller) throw new Error("Seller not found");
      await ctx.db.patch(order.playerId, {
        gold: seller.gold + (total - tax),
        lastUpdated: now,
      });
      await ctx.db.patch(playerId, {
        gold: buyer.gold - total,
        lastUpdated: now,
      });

      const remaining = order.quantity - quantity;
      await ctx.db.patch(orderId, {
        quantity: remaining,
        // Sell-side settlement records net proceeds and tax withheld.
        settledGold: (order.settledGold ?? 0) + (total - tax),
        taxPaid: (order.taxPaid ?? 0) + tax,
        status: remaining === 0 ? "filled" : "open",
        closedAt: remaining === 0 ? now : undefined,
        updatedAt: now,
      });
      // Receipt row: the caller has no order of their own on this trade, so
      // record what they bought. Status "filled" keeps it out of browse,
      // matching, and the active-order cap.
      await ctx.db.insert("marketOrders", {
        playerId,
        side: "buy",
        itemId: order.itemId,
        quantity: 0,
        originalQuantity: quantity,
        unitPrice: order.unitPrice,
        status: "filled",
        // Buyers pay the gross trade total; tax is withheld from the seller.
        settledGold: total,
        createdAt: now,
        updatedAt: now,
        closedAt: now,
        expiresAt: now,
      });
      return { filledQuantity: quantity, total, tax };
    }

    // The caller is selling into a buy order.
    if ((order.escrowedGold ?? 0) < total) {
      throw new Error("Buy order escrow is insufficient");
    }
    const hasRoom = await canGrantItemToInventory(
      ctx,
      order.playerId,
      order.itemId,
      quantity
    );
    if (!hasRoom) {
      throw new Error("The buyer's inventory is full");
    }

    const escrow = await takeEscrowFromInventory(
      ctx,
      playerId,
      order.itemId,
      quantity,
      playerItemId,
      now
    );
    const deliverItem = await ctx.db.get(escrow.itemId);
    if (!deliverItem) throw new Error("Item definition not found");
    await deliverEscrow(ctx, {
      toPlayerId: order.playerId,
      item: deliverItem,
      quantity: escrow.quantity,
      augments: escrow.augments,
      now,
    });

    const tax = calculateTradeTax(total, config.taxPercent);
    const seller = await ctx.db.get(playerId);
    if (!seller) throw new Error("Player not found");
    await ctx.db.patch(playerId, {
      gold: seller.gold + (total - tax),
      lastUpdated: now,
    });

    const remaining = order.quantity - quantity;
    const escrowAfter = (order.escrowedGold ?? 0) - total;
    if (remaining === 0) {
      await closeFilledBuyOrder(ctx, order, {
        quantity: 0,
        escrowAfter,
        now,
        goldSpent: total,
      });
    } else {
      await ctx.db.patch(orderId, {
        quantity: remaining,
        escrowedGold: escrowAfter,
        // Buy-side settlement records gross gold spent from escrow.
        settledGold: (order.settledGold ?? 0) + total,
        updatedAt: now,
      });
    }
    // Receipt row: the caller has no order of their own on this trade, so
    // record what they sold. Status "filled" keeps it out of browse,
    // matching, and the active-order cap.
    await ctx.db.insert("marketOrders", {
      playerId,
      side: "sell",
      itemId: order.itemId,
      quantity: 0,
      originalQuantity: quantity,
      unitPrice: order.unitPrice,
      status: "filled",
      // Sellers receive the gross total minus the burned tax.
      settledGold: total - tax,
      taxPaid: tax,
      createdAt: now,
      updatedAt: now,
      closedAt: now,
      expiresAt: now,
    });
    return { filledQuantity: quantity, total, tax };
  },
});

export const cancelOrder = mutation({
  args: {
    orderId: v.id("marketOrders"),
    playerId: v.id("players"),
  },
  handler: async (ctx, { orderId, playerId }) => {
    const now = Date.now();
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Order not found");
    if (order.playerId !== playerId) throw new Error("Not your order");
    if (order.status !== "open") throw new Error("Order is already closed");

    const expired = order.expiresAt <= now;

    if (order.side === "sell") {
      const item = await ctx.db.get(order.itemId);
      if (!item) throw new Error("Item definition not found");
      const hasRoom = await canGrantItemToInventory(
        ctx,
        playerId,
        order.itemId,
        order.quantity
      );
      if (!hasRoom) {
        throw new Error("Free up inventory space to reclaim these items");
      }
      await deliverEscrow(ctx, {
        toPlayerId: playerId,
        item,
        quantity: order.quantity,
        augments: order.escrowedAugments ?? [],
        now,
      });
    } else {
      const player = await ctx.db.get(playerId);
      if (!player) throw new Error("Player not found");
      await ctx.db.patch(playerId, {
        gold: player.gold + (order.escrowedGold ?? 0),
        lastUpdated: now,
      });
    }

    await ctx.db.patch(orderId, {
      status: expired ? "expired" : "cancelled",
      closedAt: now,
      updatedAt: now,
    });
    return { status: expired ? "expired" : "cancelled" };
  },
});

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getMeta = query({
  args: {},
  handler: async (ctx) => {
    const [config, rarities] = await Promise.all([
      readBazaarConfig(ctx),
      ctx.db.query("itemRarities").collect(),
    ]);
    return {
      taxPercent: config.taxPercent,
      maxOpenOrders: config.maxOpenOrders,
      expiryDays: Math.round(config.expiryMs / DAY_MS),
      rarities,
    };
  },
});

export const getCatalog = query({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query("items").take(CATALOG_FETCH_LIMIT);
    return items.map((item) => ({
      itemId: item._id,
      name: item.name,
      description: item.description,
      category: item.category,
      rarityLevel: item.rarityLevel,
      stackable: item.stackable,
      maxStackSize: item.maxStackSize,
    }));
  },
});

export const getOpenOrders = query({
  args: {
    side: v.union(v.literal("sell"), v.literal("buy")),
    viewerPlayerId: v.optional(v.id("players")),
    category: v.optional(itemCategoryValidator),
    rarityLevel: v.optional(v.number()),
    search: v.optional(v.string()),
    minPrice: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
    sort: v.union(
      v.literal("price_asc"),
      v.literal("price_desc"),
      v.literal("newest")
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = readIntInRange(
      args.limit,
      1,
      MAX_BROWSE_LIMIT,
      DEFAULT_BROWSE_LIMIT
    );
    const search = args.search?.trim().toLowerCase() ?? "";
    const minPrice =
      args.minPrice !== undefined &&
      Number.isFinite(args.minPrice) &&
      args.minPrice >= 0
        ? args.minPrice
        : undefined;
    const maxPrice =
      args.maxPrice !== undefined &&
      Number.isFinite(args.maxPrice) &&
      args.maxPrice >= 0
        ? args.maxPrice
        : undefined;

    const items = await ctx.db.query("items").take(CATALOG_FETCH_LIMIT);
    const itemById = new Map(items.map((item) => [item._id, item]));
    const hasItemFilter =
      args.category !== undefined ||
      args.rarityLevel !== undefined ||
      search.length > 0;
    const allowedItemIds = hasItemFilter
      ? new Set(
          items
            .filter(
              (item) =>
                (args.category === undefined ||
                  item.category === args.category) &&
                (args.rarityLevel === undefined ||
                  (item.rarityLevel ?? 10) === args.rarityLevel) &&
                (search.length === 0 ||
                  item.name.toLowerCase().includes(search))
            )
            .map((item) => item._id)
        )
      : null;

    const candidates = await ctx.db
      .query("marketOrders")
      .withIndex("by_side_and_status_and_unitPrice", (q) =>
        q.eq("side", args.side).eq("status", "open")
      )
      .filter((q) => q.gt(q.field("expiresAt"), now))
      .order(args.sort === "price_desc" ? "desc" : "asc")
      .take(BROWSE_FETCH_WINDOW);

    const orders = candidates.filter((order) => {
      if (order.expiresAt <= now) return false;
      if (minPrice !== undefined && order.unitPrice < minPrice) return false;
      if (maxPrice !== undefined && order.unitPrice > maxPrice) return false;
      if (allowedItemIds !== null && !allowedItemIds.has(order.itemId)) {
        return false;
      }
      return itemById.has(order.itemId);
    });
    if (args.sort === "newest") {
      orders.sort((left, right) => right.createdAt - left.createdAt);
    }

    const visible = orders.slice(0, limit);
    const ownerIds = [...new Set(visible.map((order) => order.playerId))];
    const owners = await Promise.all(ownerIds.map((id) => ctx.db.get(id)));
    const ownerNameById = new Map(
      owners
        .filter((owner) => owner !== null)
        .map((owner) => [owner._id, owner.name])
    );

    return visible.map((order) => ({
      orderId: order._id,
      side: order.side,
      playerId: order.playerId,
      ownerName: ownerNameById.get(order.playerId) ?? "Unknown",
      itemId: order.itemId,
      item: itemById.get(order.itemId)!,
      quantity: order.quantity,
      originalQuantity: order.originalQuantity,
      unitPrice: order.unitPrice,
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
      isOwn: args.viewerPlayerId === order.playerId,
      totalMatches: orders.length,
    }));
  },
});

export const getMyOrders = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    const now = Date.now();
    const orders = await ctx.db
      .query("marketOrders")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .order("desc")
      .take(MY_ORDERS_FETCH_LIMIT);

    const itemIds = [...new Set(orders.map((order) => order.itemId))];
    const items = await Promise.all(itemIds.map((id) => ctx.db.get(id)));
    const itemById = new Map(
      items
        .filter((item) => item !== null)
        .map((item) => [item._id, item])
    );

    let activeCount = 0;
    const rows = orders
      .filter((order) => itemById.has(order.itemId))
      .map((order) => {
        const active = order.status === "open" && order.expiresAt > now;
        if (active) activeCount += 1;
        return {
          orderId: order._id,
          side: order.side,
          status: order.status,
          itemId: order.itemId,
          item: itemById.get(order.itemId)!,
          quantity: order.quantity,
          originalQuantity: order.originalQuantity,
          filledQuantity: order.originalQuantity - order.quantity,
          unitPrice: order.unitPrice,
          escrowedGold: order.escrowedGold,
          settledGold: order.settledGold,
          taxPaid: order.taxPaid,
          createdAt: order.createdAt,
          expiresAt: order.expiresAt,
          closedAt: order.closedAt,
          active,
          expired: order.status === "open" && order.expiresAt <= now,
        };
      });

    return { orders: rows, activeCount };
  },
});
