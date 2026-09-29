import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  useBazaarCatalog,
  useBazaarMeta,
  useMyBazaarOrders,
  usePlaceBazaarBuyOrder,
} from "~/hooks/useBazaar";
import {
  bazaarInputClass,
  formatGold,
  rarityForLevel,
  toErrorMessage,
} from "./shared";

interface CreateBuyOrderProps {
  player: any;
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export function CreateBuyOrder({ player }: CreateBuyOrderProps) {
  const catalog = useBazaarCatalog();
  const meta = useBazaarMeta();
  const myOrders = useMyBazaarOrders(player?._id ?? null);
  const placeBuyOrder = usePlaceBazaarBuyOrder();
  const [searchParams, setSearchParams] = useSearchParams();

  // ?item=<itemId> preselects the buy form so buy orders are deep-linkable.
  const urlItem = searchParams.get("item") ?? "";
  const [itemId, setItemId] = useState(urlItem);
  useEffect(() => {
    setItemId(urlItem);
  }, [urlItem]);

  const handleItemChange = (value: string) => {
    setItemId(value);
    const next = new URLSearchParams(searchParams);
    if (value === "") next.delete("item");
    else next.set("item", value);
    setSearchParams(next, { replace: true });
  };
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const items = catalog.data ?? [];
  const selected = items.find((item) => item.itemId === itemId);
  const parsedQuantity = parsePositiveInt(quantity);
  const parsedPrice = parsePositiveInt(unitPrice);
  const total =
    parsedQuantity !== null && parsedPrice !== null
      ? parsedQuantity * parsedPrice
      : null;
  const maxOpenOrders = meta.data?.maxOpenOrders ?? 5;
  const activeCount = myOrders.data?.activeCount ?? 0;
  const atOrderCap = activeCount >= maxOpenOrders;
  const insufficientGold = total !== null && total > (player.gold ?? 0);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selected === undefined || parsedQuantity === null || parsedPrice === null) {
      setError("Pick an item and enter a whole-number quantity and price");
      return;
    }

    setIsPlacing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await placeBuyOrder({
        playerId: player._id,
        itemId: selected.itemId as Id<"items">,
        quantity: parsedQuantity,
        unitPrice: parsedPrice,
      });
      setNotice(
        result.filledQuantity > 0
          ? `Bought ${result.filledQuantity} immediately for ${formatGold(result.goldSpent)}${
              result.remainingQuantity > 0
                ? `; buy order for ${result.remainingQuantity} resting on the book`
                : ""
            }`
          : "Buy order placed on the Bazaar"
      );
      setQuantity("1");
      setUnitPrice("");
    } catch (placeError) {
      setError(toErrorMessage(placeError, "Could not place that order"));
    } finally {
      setIsPlacing(false);
    }
  };

  const craftingItems = items.filter((item) => item.category === "crafting");
  const equipmentItems = items.filter((item) => item.category === "equipment");
  const selectedRarity = rarityForLevel(meta.data?.rarities, selected?.rarityLevel);

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-[10px] text-muted-foreground">
        A buy order escrows its full gold total up front and fills at the best
        available asking price. Active orders: {activeCount}/{maxOpenOrders}.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Item
          </span>
          <select
            value={itemId}
            aria-label="Item to buy"
            onChange={(event) => handleItemChange(event.currentTarget.value)}
            className={`${bazaarInputClass} w-56`}
          >
            <option value="">Choose an item...</option>
            <optgroup label="Crafting">
              {craftingItems.map((item) => (
                <option key={item.itemId} value={item.itemId}>
                  {item.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Equipment">
              {equipmentItems.map((item) => (
                <option key={item.itemId} value={item.itemId}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Quantity
          </span>
          <input
            type="number"
            min="1"
            step="1"
            value={quantity}
            aria-label="Quantity to buy"
            onChange={(event) => setQuantity(event.currentTarget.value)}
            className={`${bazaarInputClass} w-24`}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Price each
          </span>
          <input
            type="number"
            min="1"
            step="1"
            value={unitPrice}
            placeholder="gold"
            aria-label="Maximum unit price"
            onChange={(event) => setUnitPrice(event.currentTarget.value)}
            className={`${bazaarInputClass} w-28`}
          />
        </label>

        <Button
          type="submit"
          size="sm"
          disabled={isPlacing || atOrderCap || insufficientGold}
        >
          {isPlacing ? "Placing..." : "Place buy order"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        {selected && (
          <span style={selectedRarity ? { color: selectedRarity.color } : undefined}>
            {selected.name}
            {selectedRarity ? ` · ${selectedRarity.name}` : ""}
          </span>
        )}
        {total !== null && <span>Escrow total: {formatGold(total)}</span>}
        <span>Your gold: {formatGold(player.gold ?? 0)}</span>
        {meta.data && <span>{meta.data.taxPercent}% seller tax per fill</span>}
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
      {atOrderCap && (
        <p className="text-[10px] text-blood-light">
          You have reached the {maxOpenOrders}-order limit. Cancel an order in
          My Orders first.
        </p>
      )}
      {insufficientGold && (
        <p className="text-[10px] text-blood-light">
          Not enough gold to escrow this order.
        </p>
      )}
    </form>
  );
}
