import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  BowArrow,
  Brain,
  Clover,
  Coins,
  Crosshair,
  Crown,
  Dumbbell,
  Droplet,
  Feather,
  FlaskConical,
  Flame,
  Gauge,
  GraduationCap,
  Hammer,
  Heart,
  HeartPulse,
  Minus,
  Moon,
  Mountain,
  Plus,
  RotateCcw,
  Shield,
  Slice,
  Sparkles,
  Sun,
  Sword,
  Target,
  Timer,
  TrendingUp,
  WandSparkles,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import swordArt from "../../assets/icons/sword.svg";
import daggerArt from "../../assets/icons/dagger.png";
import maceArt from "../../assets/icons/mace.png";
import bowArt from "../../assets/icons/bow.svg";
import staffArt from "../../assets/icons/staff.png";
import shieldArt from "../../assets/icons/shield.svg";
import herbsArt from "../../assets/icons/herbs.svg";
import refinedAlchemyArt from "../../assets/icons/refinedAlchemy.png";
import {
  usePassiveTree,
  useSeedDefaultTree,
  useUnlockPassive,
} from "~/hooks/usePassives";
import type { Id } from "../../../convex/_generated/dataModel";

interface PassiveTreeProps {
  playerId: Id<"players">;
  isAdmin?: boolean;
}

const BRANCH_COLORS: Record<string, string> = {
  sword: "#f87171",
  dagger: "#fbbf24",
  mace: "#94a3b8",
  bow: "#4ade80",
  staff: "#c084fc",
  skilling: "#22d3ee",
};

const BRANCH_LABELS: Record<string, string> = {
  sword: "Sword",
  dagger: "Dagger",
  mace: "Mace",
  bow: "Bow",
  staff: "Staff",
  skilling: "Skilling",
  elemental: "Elemental",
};

const ELEMENT_COLORS: Record<string, string> = {
  light: "#facc15",
  dark: "#7c3aed",
  water: "#38bdf8",
  fire: "#ea580c",
  wind: "#5eead4",
  earth: "#a16207",
};

const ELEMENT_LABELS: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  water: "Water",
  fire: "Fire",
  wind: "Wind",
  earth: "Earth",
};

const ELEMENT_ORDER = [
  "light",
  "dark",
  "water",
  "fire",
  "wind",
  "earth",
] as const;

const ELEMENT_ICONS: Record<string, LucideIcon> = {
  light: Sun,
  dark: Moon,
  water: Droplet,
  fire: Flame,
  wind: Wind,
  earth: Mountain,
};

type TreeNodeLike = {
  branch: string;
  effectType: string;
  effectStat?: string;
  element?: string;
};

/** Display color: elemental nodes use their element color, not the branch. */
function nodeColor(node: { branch: string; element?: string }): string {
  if (node.element && ELEMENT_COLORS[node.element]) {
    return ELEMENT_COLORS[node.element];
  }
  return BRANCH_COLORS[node.branch] ?? "#d4d4d4";
}

const WEAPON_ICONS: Record<string, LucideIcon> = {
  sword: Sword,
  dagger: Slice,
  mace: Hammer,
  bow: BowArrow,
  staff: WandSparkles,
  skilling: Target,
};

/** Game-art slots: real item art where it clearly matches the node. */
const ART_SLOTS: Record<string, string> = {
  "sword-1": swordArt,
  "sword-2": swordArt,
  "sword-6": swordArt,
  "dagger-1": daggerArt,
  "dagger-8": daggerArt,
  "mace-1": maceArt,
  "mace-8": maceArt,
  "bow-1": bowArt,
  "bow-2": bowArt,
  "staff-1": staffArt,
  "staff-2": staffArt,
  "staff-6": staffArt,
  "mace-2": shieldArt,
  "mace-6": shieldArt,
  "staff-5": shieldArt,
  "skilling-2": herbsArt,
  "skilling-3": refinedAlchemyArt,
};

type TreeIcon =
  | { kind: "art"; src: string }
  | { kind: "lucide"; Icon: LucideIcon };

/** Icon for a node: game art on themed slots, Lucide pictogram otherwise. */
function treeIconFor(node: TreeNodeLike & { nodeId: string }): TreeIcon {
  const src = ART_SLOTS[node.nodeId];
  if (src) return { kind: "art", src };
  return { kind: "lucide", Icon: nodeIconFor(node) };
}

// 21 x 21 grid, hub cell center. Cells and nodes share one size so a node
// exactly fills its cell and grid-snapped nodes can never overlap.
const GRID_SIZE = 21;
const GRID_HUB = 10.5;
const CELL = 60;
const PAD = 8;
const WORLD = (GRID_SIZE + PAD * 2) * CELL;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const toWorld = (g: number) => (g + PAD) * CELL;

function hexA(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = parseInt(full, 16);
  if (!Number.isFinite(num)) return hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Icon picturing what the node boosts: weapon, stat, effect, or element. */
function nodeIconFor(node: TreeNodeLike): LucideIcon {
  if (node.effectType === "elemental-damage-percent" && node.element) {
    return ELEMENT_ICONS[node.element] ?? Sparkles;
  }
  switch (node.effectType) {
    case "stat-boost":
      switch (node.effectStat) {
        case "str":
          return Dumbbell;
        case "dex":
          return Feather;
        case "int":
          return Brain;
        case "luk":
          return Clover;
        case "con":
          return HeartPulse;
        default:
          return Sparkles;
      }
    case "damage-percent":
      return WEAPON_ICONS[node.branch] ?? Target;
    case "attack-speed-percent":
      return Gauge;
    case "defense-percent":
      return Shield;
    case "health-percent":
      return Heart;
    case "crit-chance":
      return Crosshair;
    case "gold-multiplier":
      return Coins;
    case "xp-multiplier":
      return TrendingUp;
    case "skill-xp-multiplier":
      return GraduationCap;
    case "skill-speed-multiplier":
      return Timer;
    case "consumable-slot":
      return FlaskConical;
    default:
      return Sparkles;
  }
}

function formatBonus(node: {
  effectType: string;
  effectStat?: string;
  effectScope?: string;
  element?: string;
  effectAmount: number;
}) {
  switch (node.effectType) {
    case "stat-boost":
      return `+${node.effectAmount} ${node.effectStat?.toUpperCase()}`;
    case "damage-percent":
      return `+${Math.round(node.effectAmount * 100)}% damage`;
    case "attack-speed-percent":
      return `+${Math.round(node.effectAmount * 100)}% attack speed`;
    case "defense-percent":
      return `+${Math.round(node.effectAmount * 100)}% defense`;
    case "health-percent":
      return `+${Math.round(node.effectAmount * 100)}% health`;
    case "crit-chance":
      return `+${(node.effectAmount * 100).toFixed(1)}% crit chance`;
    case "gold-multiplier":
      return `+${Math.round((node.effectAmount - 1) * 100)}% gold`;
    case "xp-multiplier":
      return `+${Math.round((node.effectAmount - 1) * 100)}% combat XP`;
    case "skill-xp-multiplier":
      return `+${Math.round((node.effectAmount - 1) * 100)}% skill XP (${node.effectScope ?? "all"})`;
    case "skill-speed-multiplier":
      return `~${Math.round((node.effectAmount - 1) * 100)}% faster skill actions (${node.effectScope ?? "all"})`;
    case "elemental-damage-percent":
      return `+${Math.round(node.effectAmount * 100)}% ${node.element ?? "elemental"} damage (requires ${node.element ?? "elemental"} weapon)`;
    case "consumable-slot":
      return `+${node.effectAmount} equipped consumable slot`;
    default:
      return node.effectType;
  }
}

export function PassiveTree({ playerId, isAdmin = false }: PassiveTreeProps) {
  const tree = usePassiveTree(playerId);
  const unlock = useUnlockPassive();
  const seedDefaults = useSeedDefaultTree();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const fitted = useRef(false);
  const panRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const dragMoved = useRef(false);
  // Mutable mirror so the native wheel listener always sees fresh values.
  const viewRef = useRef({ scale: 1, pan: { x: 0, y: 0 }, w: 0, h: 0 });
  viewRef.current = { scale, pan, w: wrapSize.w, h: wrapSize.h };

  useEffect(() => {
    // Re-run when the query resolves: the measured container only mounts
    // once data loads, so a mount-only effect would observe nothing.
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setWrapSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tree.data]);

  // First fit: frame the whole grid centered on the hub.
  useEffect(() => {
    if (fitted.current || wrapSize.w === 0 || wrapSize.h === 0) return;
    fitted.current = true;
    const s = Math.min(wrapSize.w, wrapSize.h) / (GRID_SIZE * CELL);
    setScale(s);
    setPan({
      x: wrapSize.w / 2 - toWorld(GRID_HUB) * s,
      y: wrapSize.h / 2 - toWorld(GRID_HUB) * s,
    });
  }, [wrapSize]);

  const nodesById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof tree.data>["nodes"][number]>();
    for (const node of tree.data?.nodes ?? []) map.set(node.nodeId, node);
    return map;
  }, [tree.data]);

  const clearSelection = () => {
    setSelectedId(null);
  };

  const seedAttempted = useRef(false);
  useEffect(() => {
    const live = tree.data?.nodes ?? [];
    const legacy = live.some(
      (node) =>
        node.positionX < 0 ||
        node.positionX > GRID_SIZE ||
        node.positionY < 0 ||
        node.positionY > GRID_SIZE
    );
    // Seed generations add nodes (e.g. the elemental bridges) and rework
    // effects; a present-but-incomplete web needs the same one-shot reseed.
    const liveIds = new Set(live.map((node) => node.nodeId));
    const missingSeedContent =
      live.length > 0 &&
      [
        "element-fire",
        "element-water",
        "element-wind",
        "element-earth",
        "element-light",
        "element-dark",
      ].some((nodeId) => !liveIds.has(nodeId));
    // Dual-parent bridges replaced the single-parent elementals: any bridge
    // still on the old single-requires shape needs a reseed to gain
    // requiresAny and its centered gap cell.
    const legacyBridges =
      live.length > 0 &&
      live.some(
        (node) =>
          node.nodeId.startsWith("element-") &&
          ((node.requiresAny ?? []).length === 0 ||
            node.requires.length > 0)
      );
    if (
      (!legacy && !missingSeedContent && !legacyBridges) ||
      !isAdmin ||
      seedAttempted.current
    ) {
      return;
    }
    seedAttempted.current = true;
    void (async () => {
      setIsSeeding(true);
      setError(null);
      try {
        await seedDefaults({ playerId });
      } catch (seedError) {
        setError(
          seedError instanceof Error ? seedError.message : "Seeding failed"
        );
      } finally {
        setIsSeeding(false);
      }
    })();
  }, [tree.data, isAdmin, playerId, seedDefaults]);

  // Native non-passive wheel listener so page scroll can be suppressed.
  // Must live above the early returns to keep hook order stable; it only
  // touches refs, and zoomAtCursor is resolved when the handler fires.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAtCursor(
        event.clientX,
        event.clientY,
        Math.exp(-event.deltaY * 0.0015)
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (tree.isPending) {
    return (
      <Card className="forest-card box-glow-green min-h-[400px] p-6">
        <p className="text-sm text-muted-foreground">Growing the skill web...</p>
      </Card>
    );
  }

  if (!tree.data) {
    return (
      <Card className="forest-card box-glow-green min-h-[400px] p-6">
        <p className="text-sm text-blood-light" role="alert">
          Unable to load the passive tree.
        </p>
      </Card>
    );
  }

  const { nodes, points, bonuses } = tree.data;
  const selected = selectedId ? nodesById.get(selectedId) ?? null : null;

  const handleSeed = async () => {
    setIsSeeding(true);
    setError(null);
    try {
      await seedDefaults({ playerId });
    } catch (seedError) {
      setError(
        seedError instanceof Error ? seedError.message : "Seeding failed"
      );
    } finally {
      setIsSeeding(false);
    }
  };

  if (nodes.length === 0) {
    return (
      <div className="space-y-4">
        <Card className="forest-card box-glow-green p-6">
          <h2 className="font-heading text-xl text-gold glow-gold">
            Passive skill web
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            No passive nodes are configured yet. The skill web has not been
            seeded on this deployment.
          </p>
          {isAdmin ? (
            <div className="mt-4">
              <Button
                size="sm"
                disabled={isSeeding}
                onClick={() => void handleSeed()}
              >
                {isSeeding ? "Seeding..." : "Seed default skill web"}
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Ask an admin to seed the default skill web.
            </p>
          )}
          {error && (
            <p className="mt-2 text-xs text-blood-light" role="alert">
              {error}
            </p>
          )}
        </Card>
      </div>
    );
  }

  const handleUnlock = async (nodeId: string) => {
    setPendingId(nodeId);
    setError(null);
    try {
      await unlock({ playerId, nodeId });
    } catch (unlockError) {
      setError(
        unlockError instanceof Error ? unlockError.message : "Unlock failed"
      );
    } finally {
      setPendingId(null);
    }
  };

  const edges = nodes.flatMap((node) =>
    [...node.requires, ...(node.requiresAny ?? [])]
      .map((parentId) => nodesById.get(parentId))
      .filter((parent): parent is typeof node => Boolean(parent))
      .map((parent) => ({
        key: `${parent.nodeId}->${node.nodeId}`,
        x1: parent.positionX,
        y1: parent.positionY,
        x2: node.positionX,
        y2: node.positionY,
        active: parent.unlocked && node.unlocked,
      }))
  );

  // Transform viewport: world point (wx, wy) renders at
  // screen = pan + world * scale, with transform-origin top-left.
  const clampPan = (x: number, y: number, s: number, w: number, h: number) => {
    const M = 160;
    const x0 = PAD * CELL * s;
    const x1 = (PAD + GRID_SIZE) * CELL * s;
    let loX = -M - x1;
    let hiX = w + M - x0;
    if (loX > hiX) {
      const mid = (loX + hiX) / 2;
      loX = mid;
      hiX = mid;
    }
    let loY = -M - x1;
    let hiY = h + M - x0;
    if (loY > hiY) {
      const mid = (loY + hiY) / 2;
      loY = mid;
      hiY = mid;
    }
    return {
      x: Math.min(hiX, Math.max(loX, x)),
      y: Math.min(hiY, Math.max(loY, y)),
    };
  };

  const zoomAtCursor = (clientX: number, clientY: number, factor: number) => {
    const v = viewRef.current;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const wx = (clientX - rect.left - v.pan.x) / v.scale;
    const wy = (clientY - rect.top - v.pan.y) / v.scale;
    const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
    const nx = clientX - rect.left - wx * ns;
    const ny = clientY - rect.top - wy * ns;
    setScale(ns);
    setPan(clampPan(nx, ny, ns, v.w, v.h));
  };

  const resetView = () => {
    const v = viewRef.current;
    if (v.w === 0 || v.h === 0) return;
    const s = Math.min(v.w, v.h) / (GRID_SIZE * CELL);
    setScale(s);
    setPan({
      x: v.w / 2 - toWorld(GRID_HUB) * s,
      y: v.h / 2 - toWorld(GRID_HUB) * s,
    });
  };

  return (
    <div className="space-y-4">
      <Card className="forest-card box-glow-green p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl text-gold glow-gold">
              Passive skill web
            </h2>
            <p className="text-xs text-muted-foreground">
              Level {points.level} · base {points.baseLevel} · next point
              costs {points.nextGap} levels · {points.earned} earned ·{" "}
              {points.spent} spent
            </p>
          </div>
          <div
            className="border border-gold/40 px-3 py-1 text-sm font-semibold text-gold"
            aria-live="polite"
          >
            {points.available} point{points.available === 1 ? "" : "s"} available
          </div>
        </div>
      </Card>

      {(() => {
        const liveIds = new Set(nodes.map((node) => node.nodeId));
        const outdated =
          nodes.some(
            (node) =>
              node.positionX < 0 ||
              node.positionX > GRID_SIZE ||
              node.positionY < 0 ||
              node.positionY > GRID_SIZE
          ) ||
          (nodes.length > 0 &&
            [
              "element-fire",
              "element-water",
              "element-wind",
              "element-earth",
              "element-light",
              "element-dark",
            ].some((nodeId) => !liveIds.has(nodeId))) ||
          nodes.some(
            (node) =>
              node.nodeId.startsWith("element-") &&
              ((node.requiresAny ?? []).length === 0 ||
                node.requires.length > 0)
          );
        if (!outdated) return null;
        return (
          <Card className="forest-card box-glow-gold p-4">
            <p className="text-xs text-gold-light" role="status">
              {isSeeding
                ? "Updating the skill web to the latest layout…"
                : isAdmin
                  ? "This skill web is missing the latest nodes — updating it now…"
                  : "This skill web is out of date. Ask an admin to reseed it."}
            </p>
            {error && (
              <p className="mt-2 text-xs text-blood-light" role="alert">
                {error}
              </p>
            )}
          </Card>
        );
      })()}

      <Popover.Root
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) clearSelection();
        }}
      >
        <Card className="forest-card overflow-hidden p-0">
          <style>{`
            .tree-node {
              border: 3px solid var(--c);
              background-color: #0d1a0d;
              box-shadow: var(--glow);
              transition: box-shadow 0.12s ease, border-color 0.12s ease, scale 0.12s ease;
            }
            .tree-node:hover {
              border-color: #fff;
              box-shadow: var(--glow-hover);
              scale: 1.1;
            }
            .tree-node:focus-visible {
              outline: 2px solid #fcd34d;
              outline-offset: 3px;
            }
          `}</style>
          <div
            ref={wrapRef}
            role="application"
            aria-label="Passive skill web. Drag to pan, scroll to zoom."
            className="relative h-[60vh] min-h-[420px] w-full touch-none overflow-hidden bg-[#070f07] select-none"
            style={{ cursor: dragging ? "grabbing" : "grab" }}
            onPointerDown={(event) => {
              if (event.button !== 0 && event.pointerType === "mouse") return;
              panRef.current = {
                pointerId: event.pointerId,
                lastX: event.clientX,
                lastY: event.clientY,
                moved: false,
              };
              dragMoved.current = false;
            }}
            onPointerMove={(event) => {
              const p = panRef.current;
              if (!p || p.pointerId !== event.pointerId) return;
              const dx = event.clientX - p.lastX;
              const dy = event.clientY - p.lastY;
              if (!p.moved && Math.hypot(dx, dy) > 5) {
                p.moved = true;
                dragMoved.current = true;
                setDragging(true);
              }
              if (p.moved) {
                p.lastX = event.clientX;
                p.lastY = event.clientY;
                const v = viewRef.current;
                setPan((c) => clampPan(c.x + dx, c.y + dy, v.scale, v.w, v.h));
              }
            }}
            onPointerUp={(event) => {
              if (panRef.current?.pointerId === event.pointerId) {
                panRef.current = null;
              }
              setDragging(false);
            }}
            onPointerCancel={() => {
              panRef.current = null;
              setDragging(false);
            }}
            onClick={() => {
              if (dragMoved.current) return;
              clearSelection();
            }}
          >
            <div
              className="absolute top-0 left-0"
              style={{
                width: WORLD,
                height: WORLD,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                transformOrigin: "0 0",
              }}
            >
              <div
                className="absolute"
                style={{
                  left: toWorld(10),
                  top: toWorld(10),
                  width: CELL,
                  height: CELL,
                  backgroundColor: "rgba(234,179,8,0.07)",
                }}
              />
              {edges.map((edge) => {
                const x1 = toWorld(edge.x1);
                const y1 = toWorld(edge.y1);
                const x2 = toWorld(edge.x2);
                const y2 = toWorld(edge.y2);
                const len = Math.hypot(x2 - x1, y2 - y1);
                const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
                return (
                  <div
                    key={edge.key}
                    className="pointer-events-none absolute rounded-full"
                    style={{
                      left: x1,
                      top: y1,
                      width: len,
                      height: 4,
                      transform: `rotate(${ang}deg)`,
                      transformOrigin: "left center",
                      backgroundColor: edge.active ? "#eab308" : "#2f5a1e",
                      opacity: edge.active ? 0.95 : 0.6,
                      boxShadow: edge.active
                        ? "0 0 6px rgba(234,179,8,0.5)"
                        : undefined,
                    }}
                  />
                );
              })}
            <div
              className="absolute rounded-full"
              style={{
                left: toWorld(GRID_HUB),
                top: toWorld(GRID_HUB),
                width: CELL,
                height: CELL,
                transform: "translate(-50%, -50%)",
                border: "3px solid #eab308",
                backgroundColor: "#0c1a0c",
                display: "grid",
                placeItems: "center",
                boxShadow: "0 0 14px rgba(234,179,8,0.45)",
              }}
              title="Center of the web"
            >
              <Crown
                size={30}
                strokeWidth={2}
                color="#eab308"
                aria-hidden="true"
              />
            </div>
            {nodes.map((node) => {
              const color = nodeColor(node);
              const isSelected = selectedId === node.nodeId;
              const canUnlock =
                !node.unlocked && node.requirementsMet && points.available > 0;
              const icon = treeIconFor(node);
              const baseGlow = node.unlocked
                ? `0 0 14px ${hexA(color, 0.55)}`
                : canUnlock
                  ? `0 0 10px ${hexA("#4ade80", 0.5)}`
                  : `0 0 6px ${hexA(color, 0.25)}`;
              const hoverGlow = node.unlocked
                ? `0 0 20px ${hexA(color, 0.8)}`
                : `0 0 14px ${hexA(canUnlock ? "#4ade80" : color, 0.7)}`;
              return (
                <button
                  key={node.nodeId}
                  ref={(el) => {
                    if (el) nodeRefs.current.set(node.nodeId, el);
                    else nodeRefs.current.delete(node.nodeId);
                  }}
                  type="button"
                  aria-label={`${node.name} — ${formatBonus(node)}${node.unlocked ? " (unlocked)" : ""}`}
                  title={`${node.name} — ${formatBonus(node)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (dragMoved.current) return;
                    setError(null);
                    setSelectedId(node.nodeId);
                  }}
                  className="tree-node absolute grid place-items-center rounded-full"
                  style={
                    {
                      left: toWorld(node.positionX),
                      top: toWorld(node.positionY),
                      width: CELL,
                      height: CELL,
                      transform: "translate(-50%, -50%)",
                      "--c": isSelected ? "#f5f5f5" : color,
                      "--glow": baseGlow,
                      "--glow-hover": hoverGlow,
                      backgroundColor: node.unlocked
                        ? hexA(color, 0.3)
                        : undefined,
                      opacity:
                        node.unlocked || isSelected
                          ? 1
                          : node.requirementsMet
                            ? 0.95
                            : 0.55,
                    } as CSSProperties
                  }
                >
                  {icon.kind === "art" ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none"
                      style={{
                        width: 36,
                        height: 36,
                        backgroundColor: node.unlocked ? "#0c1a0c" : color,
                        WebkitMaskImage: `url("${icon.src}")`,
                        maskImage: `url("${icon.src}")`,
                        WebkitMaskSize: "contain",
                        maskSize: "contain",
                        WebkitMaskRepeat: "no-repeat",
                        maskRepeat: "no-repeat",
                        WebkitMaskPosition: "center",
                        maskPosition: "center",
                      }}
                    />
                  ) : (
                    <icon.Icon
                      size={30}
                      strokeWidth={2}
                      color={node.unlocked ? "#0c1a0c" : color}
                      className="pointer-events-none"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div className="absolute top-2 right-2 flex gap-1">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Zoom in"
              onClick={(event) => {
                const rect = wrapRef.current?.getBoundingClientRect();
                zoomAtCursor(
                  rect ? rect.left + rect.width / 2 : 0,
                  rect ? rect.top + rect.height / 2 : 0,
                  1.3
                );
                event.stopPropagation();
              }}
            >
              <Plus aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Zoom out"
              onClick={(event) => {
                const rect = wrapRef.current?.getBoundingClientRect();
                zoomAtCursor(
                  rect ? rect.left + rect.width / 2 : 0,
                  rect ? rect.top + rect.height / 2 : 0,
                  1 / 1.3
                );
                event.stopPropagation();
              }}
            >
              <Minus aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Reset view"
              onClick={(event) => {
                resetView();
                event.stopPropagation();
              }}
            >
              <RotateCcw aria-hidden="true" />
            </Button>
          </div>
        </div>
        </Card>
        <Popover.Portal>
          <Popover.Positioner
            anchor={
              selected ? (nodeRefs.current.get(selected.nodeId) ?? null) : null
            }
            side="top"
            align="center"
            sideOffset={12}
            collisionAvoidance={{ side: "flip", align: "shift" }}
            className="z-[200]"
          >
            <Popover.Popup className="forest-card w-64 p-3 shadow-xl outline-none">
              {selected && (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span
                        className="inline-block size-3 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            nodeColor(selected),
                        }}
                        aria-hidden="true"
                      />
                      <Popover.Title className="font-heading text-base text-gold-light">
                        {selected.name}
                      </Popover.Title>
                    </div>
                    <button
                      type="button"
                      aria-label="Close node details"
                      onClick={clearSelection}
                      className="shrink-0 px-1 text-lg leading-none text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </button>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-foreground">
                    {selected.element
                      ? (ELEMENT_LABELS[selected.element] ?? selected.element)
                      : (BRANCH_LABELS[selected.branch] ?? selected.branch)}{" "}
                    · {formatBonus(selected)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selected.description}
                  </p>
                  {selected.requires.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Requires: {selected.requires.join(", ")}
                      {!selected.requirementsMet && " (not yet unlocked)"}
                    </p>
                  )}
                  {(selected.requiresAny ?? []).length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Requires any: {(selected.requiresAny ?? []).join(" or ")}
                      {!selected.requirementsMet && " (not yet unlocked)"}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!selected.unlocked ? (
                      <Button
                        size="sm"
                        disabled={
                          !selected.requirementsMet ||
                          points.available < 1 ||
                          pendingId === selected.nodeId
                        }
                        onClick={() => void handleUnlock(selected.nodeId)}
                      >
                        {pendingId === selected.nodeId
                          ? "Unlocking..."
                          : selected.requirementsMet
                            ? points.available > 0
                              ? "Unlock (1 point)"
                              : "No points available"
                            : "Locked"}
                      </Button>
                    ) : (
                      <span className="text-xs font-semibold text-forest-glow">
                        Unlocked
                      </span>
                    )}
                  </div>
                  {error && (
                    <p className="mt-2 text-xs text-blood-light" role="alert">
                      {error}
                    </p>
                  )}
                </>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <Card className="forest-card p-4">
        <p className="text-xs text-muted-foreground">
          Drag empty space to pan · scroll or use +/− to zoom · click a node
          for details. Elemental nodes only boost damage while wielding a
          weapon of that element. All bonuses are modest and global. The web
          fully resets on rebirth.
        </p>
      </Card>

      <Card className="forest-card p-4">
        <h3 className="font-heading text-sm uppercase tracking-wider text-gold">
          Active bonuses
        </h3>
        <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex justify-between gap-2 border-b border-forest-light/15 pb-1">
            <dt className="text-muted-foreground">Stats</dt>
            <dd className="text-foreground">
              STR +{bonuses.stats.str} · DEX +{bonuses.stats.dex} · INT +
              {bonuses.stats.int} · LUK +{bonuses.stats.luk} · CON +
              {bonuses.stats.con}
            </dd>
          </div>
          <div className="flex justify-between gap-2 border-b border-forest-light/15 pb-1">
            <dt className="text-muted-foreground">Damage</dt>
            <dd className="text-foreground">
              +{Math.round(bonuses.damagePercent * 100)}%
            </dd>
          </div>
          <div className="flex justify-between gap-2 border-b border-forest-light/15 pb-1">
            <dt className="text-muted-foreground">Attack speed</dt>
            <dd className="text-foreground">
              +{Math.round(bonuses.attackSpeedPercent * 100)}%
            </dd>
          </div>
          <div className="flex justify-between gap-2 border-b border-forest-light/15 pb-1">
            <dt className="text-muted-foreground">Defense / Health</dt>
            <dd className="text-foreground">
              +{Math.round(bonuses.defensePercent * 100)}% / +
              {Math.round(bonuses.healthPercent * 100)}%
            </dd>
          </div>
          <div className="flex justify-between gap-2 border-b border-forest-light/15 pb-1">
            <dt className="text-muted-foreground">Crit / Gold / Combat XP</dt>
            <dd className="text-foreground">
              +{(bonuses.critChance * 100).toFixed(1)}% · ×
              {bonuses.goldMultiplier.toFixed(3)} · ×
              {bonuses.xpMultiplier.toFixed(3)}
            </dd>
          </div>
          <div className="flex justify-between gap-2 border-b border-forest-light/15 pb-1">
            <dt className="text-muted-foreground">Skill XP / Speed</dt>
            <dd className="text-foreground">
              ×{bonuses.skillXpMultipliers.all.toFixed(3)} all · ×
              {bonuses.skillSpeedMultipliers.all.toFixed(3)} speed
            </dd>
          </div>
          <div className="flex justify-between gap-2 border-b border-forest-light/15 pb-1">
            <dt className="text-muted-foreground">Elements</dt>
            <dd className="text-foreground">
              {ELEMENT_ORDER.map(
                (element) =>
                  `${ELEMENT_LABELS[element]} +${Math.round((bonuses.elements?.[element] ?? 0) * 100)}%`
              ).join(" · ")}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
