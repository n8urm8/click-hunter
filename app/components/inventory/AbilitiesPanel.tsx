import { useState } from "react";
import { Button } from "~/components/ui/button";
import { ItemIcon } from "~/components/game/ItemIcon";
import { errorMessage } from "./Equipment";
import {
  useAbilityPanel,
  useEquipAbility,
  useUnequipAbility,
  useUseAbilityBook,
} from "~/hooks/useAbilities";
import type { Id } from "../../../convex/_generated/dataModel";

type AbilityEntry = NonNullable<
  NonNullable<ReturnType<typeof useAbilityPanel>["data"]>
>["known"][number];

const TYPE_GLYPH: Record<string, string> = {
  attack: "✦",
  heal: "✚",
  buff_offense: "▲",
  buff_defense: "◆",
  utility: "◇",
};

const TYPE_LABEL: Record<string, string> = {
  attack: "Attack",
  heal: "Heal",
  buff_offense: "Offense buff",
  buff_defense: "Defense buff",
  utility: "Utility",
};

function typeGlyph(type: string) {
  return TYPE_GLYPH[type] ?? "◆";
}

function typeLabel(type: string) {
  return TYPE_LABEL[type] ?? type;
}

function weaponLabel(weaponType: string) {
  if (weaponType === "any") return "Any weapon";
  return weaponType.charAt(0).toUpperCase() + weaponType.slice(1);
}

function AbilityTile({
  entry,
  selected,
  onSelect,
}: {
  entry: AbilityEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`relative flex flex-col gap-1 border p-2 text-left transition-colors ${
        selected
          ? "border-gold bg-forest-mid text-gold-light shadow-[0_0_10px_rgba(212,175,55,0.2)]"
          : "border-forest-light/30 bg-forest-dark/60 hover:border-gold/60 hover:bg-forest-mid/60"
      }`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-sm text-forest-glow">
          {typeGlyph(entry.type)}
        </span>
        <span className="truncate font-heading text-xs text-gold-light">
          {entry.name}
        </span>
      </div>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Lv {entry.level} · {typeLabel(entry.type)}
      </span>
      {entry.equippedSlot !== null && (
        <span className="absolute right-1 top-1 border border-gold/40 px-1 text-[9px] font-semibold text-gold">
          Slot {entry.equippedSlot + 1}
        </span>
      )}
      {!entry.usableWithWeapon && (
        <span className="text-[10px] text-blood-light">
          Needs {weaponLabel(entry.weaponType)}
        </span>
      )}
    </button>
  );
}

export function AbilitiesPanel({ playerId }: { playerId: Id<"players"> }) {
  const panel = useAbilityPanel(playerId);
  const equipAbility = useEquipAbility();
  const unequipAbility = useUnequipAbility();
  const useBook = useUseAbilityBook();
  const [selectedAbilityId, setSelectedAbilityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (panel.isPending) {
    return (
      <div className="flex min-h-[368px] items-center justify-center p-3">
        <p className="text-xs text-muted-foreground">Loading abilities...</p>
      </div>
    );
  }
  if (!panel.data) {
    return (
      <div className="flex min-h-[368px] items-center justify-center p-3">
        <p className="text-xs text-blood-light" role="alert">
          Unable to load abilities.
        </p>
      </div>
    );
  }

  const data = panel.data;
  const selectedAbility =
    data.known.find((entry) => entry.abilityId === selectedAbilityId) ?? null;
  const powerPercent = Math.round((data.powerMultiplier - 1) * 100);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught, "Unable to update abilities."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[368px] p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border border-forest-light/25 bg-forest-dark/30 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Abilities auto-cast on cooldown in every battle while equipped.
          Healing spells only cast when they will not overheal.
        </p>
        <p className="text-xs text-forest-glow">
          Wisdom Lv {data.wisdom.level} · +{powerPercent}% ability power ·{" "}
          {data.maxSlots}/{data.maxPossibleSlots} slots
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)]">
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              Equipped slots
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {data.slots.map((slot) => {
                const occupied = slot.ability;
                return (
                  <button
                    key={slot.slot}
                    type="button"
                    disabled={slot.locked || busy}
                    onClick={() => {
                      if (slot.locked) return;
                      if (occupied) {
                        setSelectedAbilityId(occupied.abilityId);
                        setError(null);
                        setStatus(null);
                      } else if (selectedAbility) {
                        void run(() =>
                          equipAbility({
                            playerId,
                            abilityId: selectedAbility.abilityId,
                            slot: slot.slot,
                          })
                        );
                      }
                    }}
                    className={`flex min-h-16 flex-col items-start gap-1 border p-2 text-left text-xs transition-colors ${
                      slot.locked
                        ? "cursor-not-allowed border-forest-light/15 bg-forest-dark/20 text-muted-foreground"
                        : occupied
                          ? "border-gold/50 bg-forest-mid/60 text-gold-light hover:border-gold"
                          : "border-dashed border-forest-light/30 bg-forest-dark/40 text-muted-foreground hover:border-gold/60"
                    }`}
                  >
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Slot {slot.slot + 1}
                    </span>
                    <span className="truncate font-heading">
                      {slot.locked
                        ? "Locked"
                        : occupied
                          ? `${typeGlyph(occupied.type)} ${occupied.name}`
                          : "Empty"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Select an ability below, then click an empty unlocked slot to
              equip it. Slots unlock as Wisdom grows.
            </p>
          </div>

          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              Known abilities ({data.known.length})
            </p>
            {data.known.length === 0 ? (
              <p className="border border-forest-light/25 bg-forest-dark/30 p-3 text-center text-xs text-muted-foreground">
                Learn abilities by consuming ability books dropped by bosses.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {data.known.map((entry) => (
                  <AbilityTile
                    key={entry.abilityId}
                    entry={entry}
                    selected={entry.abilityId === selectedAbilityId}
                    onSelect={() => {
                      setSelectedAbilityId(entry.abilityId);
                      setError(null);
                      setStatus(null);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <div className="min-h-28 border border-forest-light/25 bg-forest-dark/30 p-3">
            {selectedAbility ? (
              <>
                <div className="flex items-start gap-2">
                  <span aria-hidden className="mt-0.5 text-base text-forest-glow">
                    {typeGlyph(selectedAbility.type)}
                  </span>
                  <div className="min-w-0">
                    <p className="font-heading text-sm text-gold-light">
                      {selectedAbility.name}
                    </p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {typeLabel(selectedAbility.type)} · Lv{" "}
                      {selectedAbility.level}
                      {selectedAbility.maxLevel !== null &&
                        ` / ${selectedAbility.maxLevel}`}{" "}
                      · {weaponLabel(selectedAbility.weaponType)}
                      {selectedAbility.element &&
                        ` · ${selectedAbility.element}`}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-foreground/80">
                  {selectedAbility.description}
                </p>
                {!selectedAbility.usableWithWeapon && (
                  <p className="mt-2 text-[11px] text-blood-light">
                    Equip a {weaponLabel(selectedAbility.weaponType).toLowerCase()}{" "}
                    to auto-cast this ability.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {data.slots
                    .filter((slot) => !slot.locked)
                    .map((slot) => {
                      const alreadyHere =
                        selectedAbility.equippedSlot === slot.slot;
                      const isMove =
                        selectedAbility.equippedSlot !== null && !alreadyHere;
                      return (
                        <Button
                          key={slot.slot}
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={busy || alreadyHere}
                          onClick={() =>
                            void run(() =>
                              equipAbility({
                                playerId,
                                abilityId: selectedAbility.abilityId,
                                slot: slot.slot,
                              })
                            )
                          }
                        >
                          {alreadyHere
                            ? `Slot ${slot.slot + 1}`
                            : `${isMove ? "Move to" : "Equip slot"} ${slot.slot + 1}`}
                        </Button>
                      );
                    })}
                  {selectedAbility.equippedSlot !== null && (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          unequipAbility({
                            playerId,
                            slot: selectedAbility.equippedSlot!,
                          })
                        )
                      }
                    >
                      Unequip
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex min-h-20 items-center justify-center text-center text-xs text-muted-foreground">
                Select an ability to view its details and equip it.
              </div>
            )}
            {error && (
              <p role="alert" className="mt-2 text-xs text-blood-light">
                {error}
              </p>
            )}
          </div>

          <div className="border border-forest-light/25 bg-forest-dark/30 p-3">
            <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              Ability books
            </p>
            {data.books.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No ability books in your inventory. Bosses drop them.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.books.map((book) => (
                  <li
                    key={book.playerItemId}
                    className="flex items-center gap-2 border border-forest-light/20 bg-forest-dark/40 p-2"
                  >
                    <ItemIcon
                      item={{
                        category: "abilityBook",
                        itemId: book.itemId,
                        name: book.itemName,
                      }}
                      alt=""
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-gold-light">
                        {book.itemName}
                      </p>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        +{book.xpValue} XP · Tier {book.bookTier} · x
                        {book.quantity}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const granted = await useBook({
                            playerId,
                            playerItemId: book.playerItemId,
                            quantity: 1,
                          });
                          if (granted) {
                            setStatus(
                              `${book.itemName} used — ability is now level ${granted.newLevel}.`
                            );
                          }
                        })
                      }
                    >
                      Use
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {status && (
              <p role="status" className="mt-2 text-xs text-forest-glow">
                {status}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
