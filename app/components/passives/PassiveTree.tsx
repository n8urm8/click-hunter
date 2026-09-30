import { useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
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
};

function formatBonus(node: {
  effectType: string;
  effectStat?: string;
  effectScope?: string;
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
    case "unlock-auto-attack":
      return "Unlock: automatic attacks";
    case "unlock-auto-battle":
      return "Unlock: battle automation";
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
  const circleRefs = useRef(new Map<string, SVGCircleElement>());

  const nodesById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof tree.data>["nodes"][number]>();
    for (const node of tree.data?.nodes ?? []) map.set(node.nodeId, node);
    return map;
  }, [tree.data]);

  const clearSelection = () => {
    setSelectedId(null);
  };

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
    node.requires
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

  return (
    <div className="space-y-4">
      <Card className="forest-card box-glow-green p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl text-gold glow-gold">
              Passive skill web
            </h2>
            <p className="text-xs text-muted-foreground">
              Level {points.level} · base {points.baseLevel} · earn 1 point
              every {points.interval} levels · {points.earned} earned ·{" "}
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
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(BRANCH_LABELS).map(([branch, label]) => (
            <span
              key={branch}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                className="inline-block size-3 rounded-full"
                style={{ backgroundColor: BRANCH_COLORS[branch] }}
                aria-hidden="true"
              />
              {label}
            </span>
          ))}
        </div>
      </Card>

      <Popover.Root
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) clearSelection();
        }}
      >
        <Card className="forest-card overflow-hidden p-0">
          <svg
            viewBox="0 0 100 100"
            role="img"
            aria-label="Passive skill web with weapon and skilling branches"
            className="h-auto w-full touch-manipulation bg-forest-deep/60"
          >
            {edges.map((edge) => (
              <line
                key={edge.key}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={edge.active ? "#eab308" : "#3f6212"}
                strokeWidth={edge.active ? 0.5 : 0.3}
                opacity={edge.active ? 0.9 : 0.5}
              />
            ))}
            <circle cx={50} cy={50} r={1.6} fill="#eab308" opacity={0.9}>
              <title>Center of the web</title>
            </circle>
            {nodes.map((node) => {
              const color = BRANCH_COLORS[node.branch] ?? "#a3a3a3";
              const isSelected = selectedId === node.nodeId;
              const canUnlock =
                !node.unlocked && node.requirementsMet && points.available > 0;
              return (
                <g key={node.nodeId}>
                  <circle
                    ref={(el) => {
                      if (el) circleRefs.current.set(node.nodeId, el);
                      else circleRefs.current.delete(node.nodeId);
                    }}
                    cx={node.positionX}
                    cy={node.positionY}
                    r={node.unlocked ? 2.6 : 2.2}
                    fill={node.unlocked ? color : "#0c1a0c"}
                    stroke={color}
                    strokeWidth={isSelected ? 0.7 : 0.4}
                    opacity={
                      node.unlocked ? 1 : node.requirementsMet ? 0.95 : 0.45
                    }
                    style={{ cursor: "pointer" }}
                    tabIndex={0}
                    role="button"
                    aria-label={`${node.name} — ${formatBonus(node)}${node.unlocked ? " (unlocked)" : ""}`}
                    onClick={() => {
                      setError(null);
                      setSelectedId(node.nodeId);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setError(null);
                        setSelectedId(node.nodeId);
                      }
                    }}
                  >
                    <title>{`${node.name} — ${formatBonus(node)}`}</title>
                  </circle>
                  {node.effectType.startsWith("unlock-") && (
                    <text
                      x={node.positionX}
                      y={node.positionY + 0.4}
                      textAnchor="middle"
                      fontSize={2}
                      fill={node.unlocked ? "#0c1a0c" : color}
                      pointerEvents="none"
                    >
                      ★
                    </text>
                  )}
                  {canUnlock && (
                    <circle
                      cx={node.positionX}
                      cy={node.positionY}
                      r={3}
                      fill="none"
                      stroke="#4ade80"
                      strokeWidth={0.25}
                      opacity={0.7}
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </Card>
        <Popover.Portal>
          <Popover.Positioner
            anchor={
              selected ? (circleRefs.current.get(selected.nodeId) ?? null) : null
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
                            BRANCH_COLORS[selected.branch] ?? "#a3a3a3",
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
                    {BRANCH_LABELS[selected.branch] ?? selected.branch} ·{" "}
                    {formatBonus(selected)}
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
          Click a node in the web for details. Glowing rings are ready to
          unlock. Starred nodes grant automation. All bonuses are modest and
          global. The web fully resets on rebirth.
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
            <dt className="text-muted-foreground">Automation</dt>
            <dd className="text-foreground">
              {bonuses.autoAttack ? "auto-attack ✓" : "auto-attack —"} ·{" "}
              {bonuses.autoBattle ? "auto-battle ✓" : "auto-battle —"}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
