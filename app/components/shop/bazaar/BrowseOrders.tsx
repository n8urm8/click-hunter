import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "~/components/ui/button";
import { useFulfillBazaarOrder, useBazaarMeta, useOpenBazaarOrders } from "~/hooks/useBazaar";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { ItemCategory } from "../../../../convex/itemTypes";
import {
  ItemName,
  bazaarInputClass,
  formatGold,
  formatTimeLeft,
  rarityForLevel,
  toErrorMessage,
} from "./shared";

interface BrowseOrdersProps {
  player: any;
}

type BazaarSide = "sell" | "buy";

// Wide screens (≥64rem, matching GameNavbar's desktop breakpoint) show sell
// and buy orders side by side; narrower screens keep the side toggle.
const TWO_COLUMN_QUERY = "(min-width: 64rem)";

type OrdersQuery = ReturnType<typeof useOpenBazaarOrders>;
type BazaarMeta = ReturnType<typeof useBazaarMeta>;

function optionalPositiveInt(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

interface OrdersListProps {
  columnSide: BazaarSide;
  orders: OrdersQuery;
  meta: BazaarMeta;
  player: any;
  quantityByOrder: Record<string, string>;
  setQuantityByOrder: Dispatch<SetStateAction<Record<string, string>>>;
  pendingOrderId: Id<"marketOrders"> | null;
  handleFulfill: (orderId: Id<"marketOrders">, quantity: number) => Promise<void>;
}

function OrdersList({
  columnSide,
  orders,
  meta,
  player,
  quantityByOrder,
  setQuantityByOrder,
  pendingOrderId,
  handleFulfill,
}: OrdersListProps) {
  const rows = orders.data ?? [];
  // With placeholderData, isPending only holds on the very first load. On a
  // filter/sort/search change the previous rows stay up (`isPlaceholderData`)
  // until the new result lands; only fall back to skeletons when there is
  // nothing yet to show (first load, or previous result was empty).
  const showSkeleton =
    orders.isPending || (orders.isPlaceholderData && rows.length === 0);

  if (showSkeleton) {
    return (
      <div className="space-y-2">
        <div className="forest-panel h-14 animate-pulse" aria-hidden="true" />
        <div className="forest-panel h-14 animate-pulse" aria-hidden="true" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="forest-panel p-4 text-center">
        <p className="text-sm text-muted-foreground">
          No matching orders. Head to the Sell or Buy tab to post one.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`space-y-2 transition-opacity duration-200${
        orders.isPlaceholderData ? " opacity-60" : ""
      }`}
    >
      {rows.map((order) => {
        const rarity = rarityForLevel(meta.data?.rarities, order.item.rarityLevel);
        const stackable = order.item.stackable;
        const rawQuantity = quantityByOrder[order.orderId] ?? "1";
        const requested = Math.max(1, Number(rawQuantity) || 1);
        const maxQuantity = stackable
          ? columnSide === "sell"
            ? Math.max(
                1,
                Math.floor((player.gold ?? 0) / order.unitPrice)
              )
            : order.quantity
          : 1;
        const quantity = Math.min(requested, maxQuantity, order.quantity);
        const total = quantity * order.unitPrice;
        const isPending = pendingOrderId === order.orderId;
        const canAct =
          !order.isOwn &&
          !isPending &&
          !(columnSide === "sell" && total > (player.gold ?? 0));

        return (
          <div
            key={order.orderId}
            className="forest-panel flex flex-wrap items-center gap-3 p-3"
          >
            <div className="min-w-40 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <ItemName name={order.item.name} color={rarity?.color} />
                <span
                  className="text-[10px] uppercase tracking-widest"
                  style={rarity ? { color: rarity.color } : undefined}
                >
                  {rarity?.name ?? ""}
                </span>
                {order.isOwn && (
                  <span className="border border-gold/40 px-1 text-[9px] font-semibold uppercase tracking-widest text-gold">
                    Yours
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {order.item.category === "equipment" ? "Equipment" : "Crafting"}{" "}
                · {order.isOwn ? "you" : order.ownerName} ·{" "}
                {formatTimeLeft(order.expiresAt)}
              </p>
            </div>

            <div className="text-right">
              <p className="text-sm font-semibold text-gold">
                {formatGold(total)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {order.quantity}
                {order.originalQuantity > 1
                  ? ` of ${order.originalQuantity}`
                  : ""}{" "}
                available
              </p>
            </div>

            {!order.isOwn && (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  max={maxQuantity}
                  step="1"
                  value={quantity}
                  aria-label={`Trade quantity for ${order.item.name}`}
                  disabled={!stackable}
                  onChange={(event) => {
                    // Read the value before the updater runs — React can
                    // invoke state updaters after the event has finished
                    // dispatching, when currentTarget is already null.
                    const value = event.currentTarget.value;
                    setQuantityByOrder((current) => ({
                      ...current,
                      [order.orderId]: value,
                    }));
                  }}
                  className={`${bazaarInputClass} w-16`}
                />
                <div className="text-right">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canAct}
                    onClick={() => handleFulfill(order.orderId, quantity)}
                  >
                    {columnSide === "sell" ? "Buy" : "Sell"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function BrowseOrders({ player }: BrowseOrdersProps) {
  const meta = useBazaarMeta();
  const fulfillOrder = useFulfillBazaarOrder();

  const isTwoColumn = useMediaQuery(TWO_COLUMN_QUERY);

  const [side, setSide] = useState<BazaarSide>("sell");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState<"" | ItemCategory>("");
  const [rarityLevel, setRarityLevel] = useState("");
  const [sort, setSort] = useState<"price_asc" | "price_desc" | "newest">(
    "price_asc"
  );
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [quantityByOrder, setQuantityByOrder] = useState<Record<string, string>>(
    {}
  );
  const [pendingOrderId, setPendingOrderId] = useState<
    Id<"marketOrders"> | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search box: the input updates instantly, but the orders query
  // only re-runs after typing pauses for a moment.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const commonFilters = {
    viewerPlayerId: player._id,
    category: category === "" ? undefined : category,
    rarityLevel: optionalPositiveInt(rarityLevel),
    search: debouncedSearch.trim() === "" ? undefined : debouncedSearch.trim(),
    minPrice: optionalPositiveInt(minPrice),
    maxPrice: optionalPositiveInt(maxPrice),
    sort,
  };

  // Two-column layout fetches both sides; the mobile toggle only subscribes
  // to the side it's showing ("skip" keeps the other query idle).
  const sellOrders = useOpenBazaarOrders(
    isTwoColumn || side === "sell"
      ? { ...commonFilters, side: "sell" }
      : "skip"
  );
  const buyOrders = useOpenBazaarOrders(
    isTwoColumn || side === "buy" ? { ...commonFilters, side: "buy" } : "skip"
  );

  const handleFulfill = async (
    orderId: Id<"marketOrders">,
    quantity: number
  ) => {
    setPendingOrderId(orderId);
    setError(null);
    try {
      await fulfillOrder({
        orderId,
        playerId: player._id,
        quantity,
      });
    } catch (fulfillError) {
      setError(toErrorMessage(fulfillError, "Trade failed"));
    } finally {
      setPendingOrderId(null);
    }
  };

  const listProps = {
    meta,
    player,
    quantityByOrder,
    setQuantityByOrder,
    pendingOrderId,
    handleFulfill,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!isTwoColumn && (
          <div className="flex" role="group" aria-label="Order side">
            <Button
              type="button"
              size="sm"
              variant={side === "sell" ? "default" : "outline"}
              aria-pressed={side === "sell"}
              onClick={() => setSide("sell")}
            >
              Sell orders
            </Button>
            <Button
              type="button"
              size="sm"
              variant={side === "buy" ? "default" : "outline"}
              aria-pressed={side === "buy"}
              onClick={() => setSide("buy")}
            >
              Buy orders
            </Button>
          </div>
        )}

        <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Search
          <input
            type="text"
            value={search}
            placeholder="item name"
            aria-label="Search items"
            onChange={(event) => setSearch(event.currentTarget.value)}
            className={`${bazaarInputClass} w-32`}
          />
        </label>

        <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Type
          <select
            value={category}
            aria-label="Filter by item type"
            onChange={(event) =>
              setCategory(event.currentTarget.value as "" | ItemCategory)
            }
            className={`${bazaarInputClass} w-28`}
          >
            <option value="">All</option>
            <option value="crafting">Crafting</option>
            <option value="equipment">Equipment</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Rarity
          <select
            value={rarityLevel}
            aria-label="Filter by rarity"
            onChange={(event) => setRarityLevel(event.currentTarget.value)}
            className={`${bazaarInputClass} w-28`}
          >
            <option value="">All</option>
            {(meta.data?.rarities ?? []).map((rarity) => (
              <option key={rarity.level} value={rarity.level}>
                {rarity.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sort
          <select
            value={sort}
            aria-label="Sort orders"
            onChange={(event) =>
              setSort(
                event.currentTarget.value as
                  | "price_asc"
                  | "price_desc"
                  | "newest"
              )
            }
            className={`${bazaarInputClass} w-32`}
          >
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="newest">Newest</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Min
          <input
            type="number"
            min="0"
            step="1"
            value={minPrice}
            aria-label="Minimum unit price"
            onChange={(event) => setMinPrice(event.currentTarget.value)}
            className={`${bazaarInputClass} w-20`}
          />
        </label>
        <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Max
          <input
            type="number"
            min="0"
            step="1"
            value={maxPrice}
            aria-label="Maximum unit price"
            onChange={(event) => setMaxPrice(event.currentTarget.value)}
            className={`${bazaarInputClass} w-20`}
          />
        </label>
      </div>

      <p className="text-[10px] text-muted-foreground">
        {meta.data
          ? `Sellers pay a ${meta.data.taxPercent}% tax on each sale (rounded down). Orders expire after ${meta.data.expiryDays} days.`
          : "Loading marketplace rules..."}
      </p>

      {error && (
        <p className="text-xs text-blood-light" role="alert">
          {error}
        </p>
      )}

      {isTwoColumn ? (
        <div className="grid grid-cols-2 gap-4">
          <section className="min-w-0 space-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Sell orders
            </h3>
            <OrdersList columnSide="sell" orders={sellOrders} {...listProps} />
          </section>
          <section className="min-w-0 space-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Buy orders
            </h3>
            <OrdersList columnSide="buy" orders={buyOrders} {...listProps} />
          </section>
        </div>
      ) : (
        <OrdersList
          columnSide={side}
          orders={side === "sell" ? sellOrders : buyOrders}
          {...listProps}
        />
      )}
    </div>
  );
}
