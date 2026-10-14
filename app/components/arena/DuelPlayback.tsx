import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { DamageFloater } from "~/components/game/DamageFloater";
import { ItemIcon } from "~/components/game/ItemIcon";
import { SLOT_LABELS } from "~/components/inventory/Equipment";
import type { EquipmentSlot } from "../../../convex/itemTypes";
import type { ClickAnimation } from "~/store/gameStore";

/**
 * Shared duel visuals for arena and ranked fights: two HP bars that drain
 * with the same transition as monster fights, plus damage popups per side.
 * All state is local (never the global click-animation atom) so a lobby or
 * ranked bout can't spray floaters over an unrelated auto-battle.
 */

function makeFloater(damage: number): ClickAnimation {
  return {
    id: `duel_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    damage,
    x: 30 + Math.random() * 40,
    y: 20 + Math.random() * 30,
    timestamp: Date.now(),
  };
}

export function useDuelFloaters() {
  const [sideA, setSideA] = useState<ClickAnimation[]>([]);
  const [sideB, setSideB] = useState<ClickAnimation[]>([]);

  const clear = useCallback(() => {
    setSideA([]);
    setSideB([]);
  }, []);

  // One exchange: A takes damageB, B takes damageA. Popups fade after ~1s.
  const spawn = useCallback((damageAtoB: number, damageBtoA: number) => {
    const fa = makeFloater(damageBtoA);
    const fb = makeFloater(damageAtoB);
    setSideA((prev) => [...prev.slice(-4), fa]);
    setSideB((prev) => [...prev.slice(-4), fb]);
    window.setTimeout(() => {
      setSideA((prev) => prev.filter((f) => f.id !== fa.id));
      setSideB((prev) => prev.filter((f) => f.id !== fb.id));
    }, 1100);
  }, []);

  return { floatersA: sideA, floatersB: sideB, spawn, clear };
}

export function DuelFighterCard({
  name,
  level,
  hp,
  maxHp,
  floaters,
}: {
  name: string;
  level: number | null;
  hp: number | undefined;
  maxHp: number | undefined;
  floaters: ClickAnimation[];
}) {
  const pct =
    hp !== undefined && maxHp !== undefined && maxHp > 0
      ? Math.max(0, Math.min(100, (hp / maxHp) * 100))
      : 0;
  return (
    <div className="relative rounded bg-zinc-900 px-3 py-2">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {floaters.map((floater) => (
          <DamageFloater key={floater.id} floater={floater} />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium">
          {name}{" "}
          {level !== null && (
            <span className="text-xs text-muted-foreground">Lv {level}</span>
          )}
        </p>
        <span className="shrink-0 tabular-nums text-xs text-foreground">
          {hp !== undefined && maxHp !== undefined
            ? `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`
            : "—"}
        </span>
      </div>
      <Progress value={pct} className="mt-1 h-2" aria-label={`${name} health`} />
    </div>
  );
}

export type PlaybackRound = {
  damageAtoB: number;
  damageBtoA: number;
  hpA: number;
  hpB: number;
};

export type DuelGearPiece = {
  slot: EquipmentSlot;
  itemName: string;
  itemSlug: string;
  itemFamily?: string | null;
  category?: string | null;
  enchantLevel?: number | null;
};

function GearColumn({ name, gear }: { name: string; gear: DuelGearPiece[] }) {
  return (
    <div className="rounded bg-zinc-900 px-3 py-2">
      <p className="mb-1 truncate text-xs font-semibold text-foreground">
        {name}
      </p>
      {gear.length === 0 ? (
        <p className="text-xs text-muted-foreground">Fighting barehanded</p>
      ) : (
        <ul className="space-y-1" aria-label={`${name} loadout`}>
          {gear.map((piece) => (
            <li
              key={piece.slot}
              className="flex items-center gap-2 text-xs"
            >
              <ItemIcon
                item={{
                  itemId: piece.itemSlug,
                  name: piece.itemName,
                  itemFamily: piece.itemFamily,
                  category: piece.category ?? undefined,
                }}
                alt=""
                className="size-5"
              />
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                {SLOT_LABELS[piece.slot] ?? piece.slot}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {piece.itemName}
                {piece.enchantLevel ? ` +${piece.enchantLevel}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Both corners' frozen fight gear, always visible side by side. Gear is
 * recorded at fight start, so it shows what actually fought even if
 * loadouts changed since. Hidden entirely when neither corner wore anything.
 */
export function DuelGearLists({
  nameA,
  gearA,
  nameB,
  gearB,
}: {
  nameA: string;
  gearA: DuelGearPiece[];
  nameB: string;
  gearB: DuelGearPiece[];
}) {
  if (gearA.length === 0 && gearB.length === 0) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <GearColumn name={nameA} gear={gearA} />
      <GearColumn name={nameB} gear={gearB} />
    </div>
  );
}

/**
 * The single battle viewer for lobby and ranked fights: two animated HP
 * cards with damage popups, driven either by live server rounds (arena) or
 * by auto-playing a resolved log (ranked). Mode chrome (round counter,
 * forfeit/leave, round log) comes through slots.
 */
export function BattleViewer({
  nameA,
  levelA,
  maxHpA,
  nameB,
  levelB,
  maxHpB,
  rounds,
  autoplay = false,
  autoplayMs = 550,
  resetKey,
  title,
  actions,
  logList,
  onDone,
}: {
  nameA: string;
  levelA: number | null;
  maxHpA: number | undefined;
  nameB: string;
  levelB: number | null;
  maxHpB: number | undefined;
  rounds: PlaybackRound[];
  autoplay?: boolean;
  autoplayMs?: number;
  resetKey?: string | number | null;
  title?: ReactNode;
  actions?: ReactNode;
  logList?: ReactNode;
  onDone?: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const { floatersA, floatersB, spawn, clear } = useDuelFloaters();
  const seen = useRef(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // New bout / new fight: start over.
  useEffect(() => {
    setCursor(0);
    seen.current = 0;
    clear();
  }, [resetKey, clear]);

  const revealed = autoplay ? Math.min(cursor, rounds.length) : rounds.length;

  // Autoplay clock (ranked): reveal one round at a time.
  useEffect(() => {
    if (!autoplay || revealed >= rounds.length) return;
    const timer = window.setTimeout(
      () => setCursor((current) => current + 1),
      autoplayMs
    );
    return () => window.clearTimeout(timer);
  }, [autoplay, autoplayMs, revealed, rounds.length]);

  // Autoplay completion: hold the final frame, then hand control back.
  const playedOut =
    autoplay && rounds.length > 0 && revealed >= rounds.length;
  useEffect(() => {
    if (!playedOut) return;
    const finish = window.setTimeout(() => {
      clear();
      onDoneRef.current?.();
    }, 1200);
    return () => window.clearTimeout(finish);
  }, [playedOut, clear]);

  // Popups for newly revealed rounds (cap catch-up bursts).
  useEffect(() => {
    if (revealed <= seen.current) return;
    const fresh = rounds.slice(Math.max(seen.current, revealed - 3), revealed);
    seen.current = revealed;
    fresh.forEach((round, index) => {
      window.setTimeout(
        () => spawn(round.damageAtoB, round.damageBtoA),
        index * 250
      );
    });
  }, [revealed, rounds, spawn]);

  const current = revealed > 0 ? rounds[revealed - 1] : undefined;

  return (
    <div className="space-y-2">
      {title}
      {autoplay && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground" role="status">
            Round {Math.min(revealed, rounds.length)} / {rounds.length}
          </p>
          {!playedOut && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => setCursor(rounds.length)}
            >
              Skip
            </Button>
          )}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <DuelFighterCard
          name={nameA}
          level={levelA}
          hp={current ? current.hpA : maxHpA}
          maxHp={maxHpA}
          floaters={floatersA}
        />
        <DuelFighterCard
          name={nameB}
          level={levelB}
          hp={current ? current.hpB : maxHpB}
          maxHp={maxHpB}
          floaters={floatersB}
        />
      </div>
      {logList}
      {actions}
    </div>
  );
}
