import { useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  useBazaarMeta,
  useCancelBazaarOrder,
  useMyBazaarOrders,
} from "~/hooks/useBazaar";
import {
  ItemName,
  formatGold,
  formatTimeLeft,
  rarityForLevel,
  toErrorMessage,
} from "./shared";

interface MyOrdersProps {
  player: any;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MyOrders({ player }: MyOrdersProps) {
  const myOrders = useMyBazaarOrders(player?._id ?? null);
  const meta = useBazaarMeta();
  const cancelOrder = useCancelBazaarOrder();
  const [searchParams, setSearchParams] = useSearchParams();

  // ?status=active|history|all — deep-linkable My Orders filter.
  const rawStatus = searchParams.get("status");
  const statusFilter: "all" | "active" | "history" =
    rawStatus === "active" || rawStatus === "history" ? rawStatus : "all";
  const showActive = statusFilter !== "history";
  const showHistory = statusFilter !== "active";

  const handleStatusChange = (value: "all" | "active" | "history") => {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete("status");
    else next.set("status", value);
    setSearchParams(next, { replace: true });
  };

  const [pendingOrderId, setPendingOrderId] = useState<
    Id<"marketOrders"> | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleCancel = async (orderId: Id<"marketOrders">) => {
    setPendingOrderId(orderId);
    setError(null);
    setNotice(null);
    try {
      const result = await cancelOrder({ orderId, playerId: player._id });
      setNotice(
        result.status === "expired"
          ? "Expired order reclaimed"
          : "Order cancelled and escrow returned"
      );
    } catch (cancelError) {
      setError(toErrorMessage(cancelError, "Could not close that order"));
    } finally {
      setPendingOrderId(null);
    }
  };

  const orders = myOrders.data?.orders ?? [];
  const activeOrders = orders.filter((order) => order.status === "open");
  const pastOrders = orders.filter((order) => order.status !== "open");
  const activeCount = myOrders.data?.activeCount ?? 0;
  const maxOpenOrders = meta.data?.maxOpenOrders ?? 5;

  const renderRow = (order: (typeof orders)[number], isActive: boolean) => {
    const rarity = rarityForLevel(meta.data?.rarities, order.item.rarityLevel);
    const isPending = pendingOrderId === order.orderId;
    const expired = order.expired;

    return (
      <div
        key={order.orderId}
        className="forest-panel flex flex-wrap items-center gap-3 p-3"
      >
        <div className="min-w-40 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`border px-1 text-[9px] font-semibold uppercase tracking-widest ${
                order.side === "sell"
                  ? "border-forest-light/50 text-forest-light"
                  : "border-gold/40 text-gold"
              }`}
            >
              {order.side === "sell" ? "Sell" : "Buy"}
            </span>
            <ItemName name={order.item.name} color={rarity?.color} item={order.item} />
            <span
              className="text-[10px] uppercase tracking-widest"
              style={rarity ? { color: rarity.color } : undefined}
            >
              {rarity?.name ?? ""}
            </span>
            {!isActive && (
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {order.status === "filled"
                  ? "filled"
                  : order.status === "expired"
                    ? "expired"
                    : "cancelled"}
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {formatGold(order.unitPrice)} each · {order.filledQuantity} of{" "}
            {order.originalQuantity} filled ·{" "}
            {isActive
              ? expired
                ? "expired"
                : `expires ${formatTimeLeft(order.expiresAt)}`
              : `closed ${order.closedAt ? formatTimestamp(order.closedAt) : ""}`}
          </p>
        </div>

        <div className="text-right">
          {!isActive && order.settledGold !== undefined ? (
            <>
              <p className="text-sm font-semibold text-gold">
                {formatGold(order.settledGold)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {order.side === "buy" ? "gold spent" : "gold earned"}
                {order.taxPaid ? ` · ${formatGold(order.taxPaid)} tax` : ""}
              </p>
            </>
          ) : (
            <>
              {order.side === "buy" &&
                order.escrowedGold !== undefined &&
                isActive && (
                  <p className="text-sm font-semibold text-gold">
                    {formatGold(order.escrowedGold)}
                  </p>
                )}
              <p className="text-[10px] text-muted-foreground">
                {order.side === "buy" && isActive ? "gold escrowed" : "listed"}
              </p>
            </>
          )}
        </div>

        {isActive && (
          <Button
            type="button"
            size="sm"
            variant={expired ? "default" : "outline"}
            disabled={isPending}
            onClick={() => handleCancel(order.orderId)}
          >
            {isPending
              ? "Working..."
              : expired
                ? order.side === "sell"
                  ? "Claim items"
                  : "Claim gold"
                : "Cancel"}
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] text-muted-foreground">
          Active orders: {activeCount}/{maxOpenOrders}. Cancel anytime to get
          your escrow back; expired orders hold their escrow until claimed.
        </p>
        <div className="flex" role="group" aria-label="Order history filter">
          {(
            [
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "history", label: "History" },
            ] as const
          ).map((entry) => (
            <Button
              key={entry.value}
              type="button"
              size="sm"
              variant={statusFilter === entry.value ? "default" : "outline"}
              aria-pressed={statusFilter === entry.value}
              onClick={() => handleStatusChange(entry.value)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </div>

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

      {myOrders.isPending ? (
        <div className="space-y-2">
          <div className="forest-panel h-14 animate-pulse" aria-hidden="true" />
          <div className="forest-panel h-14 animate-pulse" aria-hidden="true" />
        </div>
      ) : orders.length === 0 ? (
        <div className="forest-panel p-4 text-center">
          <p className="text-sm text-muted-foreground">
            You have no Bazaar orders yet.
          </p>
        </div>
      ) : (
        <>
          {showActive && activeOrders.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Active
              </h3>
              {activeOrders.map((order) => renderRow(order, true))}
            </div>
          )}
          {showHistory && pastOrders.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                History
              </h3>
              {pastOrders.map((order) => renderRow(order, false))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
