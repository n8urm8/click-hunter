import { useState } from "react";
import { Button } from "~/components/ui/button";
import { usePlayerInventory } from "~/hooks/useInventory";
import {
  useBazaarMeta,
  useMyBazaarOrders,
  usePlaceBazaarSellOrder,
} from "~/hooks/useBazaar";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  ItemName,
  bazaarInputClass,
  formatGold,
  toErrorMessage,
} from "./shared";

interface SellItemsProps {
  player: any;
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export function SellItems({ player }: SellItemsProps) {
  const inventory = usePlayerInventory(player?._id ?? null);
  const meta = useBazaarMeta();
  const myOrders = useMyBazaarOrders(player?._id ?? null);
  const placeSellOrder = usePlaceBazaarSellOrder();

  const [quantityByRow, setQuantityByRow] = useState<Record<string, string>>(
    {}
  );
  const [priceByRow, setPriceByRow] = useState<Record<string, string>>({});
  const [pendingRowId, setPendingRowId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const taxPercent = meta.data?.taxPercent ?? 5;
  const maxOpenOrders = meta.data?.maxOpenOrders ?? 5;
  const activeCount = myOrders.data?.activeCount ?? 0;
  const atOrderCap = activeCount >= maxOpenOrders;

  const handleList = async (
    rowId: Id<"playerItems">,
    maxQuantity: number
  ) => {
    const quantity = Math.min(
      parsePositiveInt(quantityByRow[rowId] ?? "") ?? 1,
      maxQuantity
    );
    const unitPrice = parsePositiveInt(priceByRow[rowId] ?? "");
    if (unitPrice === null) {
      setError("Enter a whole-number price of at least 1g");
      return;
    }

    setPendingRowId(rowId);
    setError(null);
    setNotice(null);
    try {
      const result = await placeSellOrder({
        playerId: player._id,
        playerItemId: rowId,
        quantity,
        unitPrice,
      });
      const total = result.goldEarned;
      setNotice(
        result.filledQuantity > 0
          ? `Sold ${result.filledQuantity} immediately for ${formatGold(total)} (after tax)${
              result.remainingQuantity > 0
                ? `; ${result.remainingQuantity} resting on the book`
                : ""
            }`
          : "Sell order placed on the Bazaar"
      );
      setPriceByRow((current) => {
        const next = { ...current };
        delete next[rowId];
        return next;
      });
    } catch (listError) {
      setError(toErrorMessage(listError, "Could not list that item"));
    } finally {
      setPendingRowId(null);
    }
  };

  const rows = inventory.data?.inventory ?? [];

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted-foreground">
        Listed items are held in escrow until sold or cancelled.{" "}
        {taxPercent}% tax is deducted from proceeds (rounded down). Active
        orders: {activeCount}/{maxOpenOrders}.
      </p>

      {notice && (
        <p className="text-xs text-forest-light" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-xs text-blood-light" role="alert">
          {error}
        </p>
      )}

      {inventory.isPending ? (
        <div className="space-y-2">
          <div className="forest-panel h-14 animate-pulse" aria-hidden="true" />
          <div className="forest-panel h-14 animate-pulse" aria-hidden="true" />
        </div>
      ) : rows.length === 0 ? (
        <div className="forest-panel p-4 text-center">
          <p className="text-sm text-muted-foreground">
            You have no tradeable items. Gather or craft something first.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const rarity = row.rarity;
            const stackable = row.item.stackable;
            const maxQuantity = stackable ? row.quantity : 1;
            const quantity = Math.min(
              Math.max(1, Number(quantityByRow[row._id] ?? "") || 1),
              maxQuantity
            );
            const unitPrice = parsePositiveInt(priceByRow[row._id] ?? "");
            const total = unitPrice !== null ? quantity * unitPrice : null;
            const proceeds =
              total !== null ? Math.floor((total * (100 - taxPercent)) / 100) : null;
            const isPending = pendingRowId === row._id;

            return (
              <div
                key={row._id}
                className="forest-panel flex flex-wrap items-center gap-3 p-3"
              >
                <div className="min-w-40 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <ItemName name={row.item.name} color={rarity?.color} item={row.item} />
                    <span
                      className="text-[10px] uppercase tracking-widest"
                      style={rarity ? { color: rarity.color } : undefined}
                    >
                      {rarity?.name ?? ""}
                    </span>
                    {row.augments.length > 0 && (
                      <span className="text-[10px] uppercase tracking-widest text-gold">
                        {row.augments.length} aug
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {row.item.category === "equipment" ? "Equipment" : "Crafting"} ·{" "}
                    {row.quantity} owned
                    {!stackable && " · traded one at a time"}
                  </p>
                </div>

                <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Qty
                  <input
                    type="number"
                    min="1"
                    max={maxQuantity}
                    step="1"
                    value={quantity}
                    disabled={!stackable}
                    aria-label={`Quantity of ${row.item.name} to list`}
                    onChange={(event) => {
                      // Capture before the deferred updater — currentTarget is
                      // null once the event finishes dispatching.
                      const value = event.currentTarget.value;
                      setQuantityByRow((current) => ({
                        ...current,
                        [row._id]: value,
                      }));
                    }}
                    className={`${bazaarInputClass} w-16`}
                  />
                </label>

                <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Price each
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={priceByRow[row._id] ?? ""}
                    placeholder="gold"
                    aria-label={`Unit price for ${row.item.name}`}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setPriceByRow((current) => ({
                        ...current,
                        [row._id]: value,
                      }));
                    }}
                    className={`${bazaarInputClass} w-24`}
                  />
                </label>

                <div className="flex items-center gap-3">
                  {proceeds !== null && (
                    <p className="text-[10px] text-muted-foreground">
                      you get {formatGold(proceeds)} after tax
                    </p>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending || atOrderCap}
                    onClick={() => handleList(row._id, maxQuantity)}
                  >
                    {isPending ? "Listing..." : "List"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {atOrderCap && (
        <p className="text-[10px] text-blood-light">
          You have reached the {maxOpenOrders}-order limit. Cancel an order in
          My Orders first.
        </p>
      )}
    </div>
  );
}
