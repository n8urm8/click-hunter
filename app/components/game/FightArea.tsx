import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { useAtom } from "jotai";
import {
  currentFightAtom,
  playerHpAtom,
  playerMaxHpAtom,
  inFightPhaseAtom,
  eventTrackerAtom,
  respawnTimerAtom,
  type CurrentFight,
} from "~/store/gameStore";
import { calculateDerivedStats } from "~/lib/statCalculations";
import { ItemIcon } from "./ItemIcon";
import { ActiveFight } from "./ActiveFight";
import {
  AutomationControls,
  type AutoBattleMode,
  type AutoBattleSettings,
} from "./AutomationControls";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import { convexQueryCacheOptions } from "~/lib/queryCache";
import {
  COMBAT_ZONE_LABELS,
  COMBAT_ZONE_VALUES,
  DEFAULT_MONSTER_POWER_MULTIPLIER,
  groupMonstersByZone,
  isCombatZone,
  monstersInZone,
  type CombatZone,
} from "~/lib/combatZones";
import {
  useCancelTask,
  useEnqueueAutoBattle,
  useTaskQueue,
} from "~/hooks/useTasks";
import { formatNumber } from "~/lib/utils";
import type { Id } from "../../../convex/_generated/dataModel";

interface FightAreaProps {
  player: any;
}

interface CombatantStats {
  type: string;
  name: string;
  str: number;
  dex: number;
  int: number;
  luk: number;
  con: number;
}

type QueueTask = {
  _id: Id<"playerTasks">;
  taskType?: "timed" | "battle";
  status: "queued" | "active";
  displayName: string;
  tier?: number;
  zone?: CombatZone;
  battleMode?: AutoBattleMode;
  completedBattles: number;
  targetBattles?: number;
  progressMs: number;
  targetDurationMs?: number;
  currentMonsterName?: string;
  currentMonsterHealth?: number;
  currentMonsterMaxHealth?: number;
  currentPlayerHealth?: number;
  currentPlayerMaxHealth?: number;
  respawnUntil?: number;
  totalGoldEarned?: number;
  totalExperienceEarned?: number;
  lootSummary?: Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    pending: number;
    purpose: "augmentation" | "boss-catalyst";
  }>;
  battleStats?: Array<{
    monsterType: string;
    monsterName: string;
    defeatedCount: number;
  }>;
};
type BattleTask = QueueTask & {
  taskType: "battle";
  battleMode: AutoBattleMode;
};

function toBattleTask(task: QueueTask | null | undefined): BattleTask | null {
  if (!task || task.taskType !== "battle" || !task.battleMode) {
    return null;
  }
  return {
    ...task,
    taskType: "battle",
    battleMode: task.battleMode,
  };
}

function formatDuration(durationMs: number | null | undefined) {
  if (durationMs === null || durationMs === undefined) return "—";
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function AutoBattleStatus({
  playerId,
  task,
  respawnTimeMs,
  onStopped,
}: {
  playerId: Id<"players">;
  task: BattleTask;
  respawnTimeMs: number;
  onStopped: () => void;
}) {
  const cancelTask = useCancelTask();
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const isActive = task.status === "active";
  useEffect(() => {
    if (!isActive || task.respawnUntil === undefined) return;

    const updateClock = () => setClockMs(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 250);
    return () => window.clearInterval(timer);
  }, [isActive, task.respawnUntil]);
  const progressLabel =
    task.battleMode === "count"
      ? `${task.completedBattles} / ${task.targetBattles ?? "?"} battles`
      : task.battleMode === "duration"
        ? `${formatDuration(task.progressMs)} / ${formatDuration(
            task.targetDurationMs
          )} online`
        : `${task.completedBattles} battles completed`;
  const progressPercent =
    task.battleMode === "count" && task.targetBattles
      ? Math.min(100, (task.completedBattles / task.targetBattles) * 100)
      : task.battleMode === "duration" && task.targetDurationMs
        ? Math.min(100, (task.progressMs / task.targetDurationMs) * 100)
        : null;
  const defeatedMonsters = [...(task.battleStats ?? [])].sort(
    (left, right) =>
      right.defeatedCount - left.defeatedCount ||
      left.monsterName.localeCompare(right.monsterName)
  );
  const totalDefeatedMonsters = defeatedMonsters.reduce(
    (total, monster) => total + monster.defeatedCount,
    0
  );
  const lootSummary = [...(task.lootSummary ?? [])].sort(
    (left, right) => right.quantity - left.quantity
  );
  const isRecovering =
    isActive &&
    typeof task.respawnUntil === "number" &&
    task.respawnUntil > clockMs;
  const recoveryRemainingMs = isRecovering
    ? Math.max(0, task.respawnUntil! - clockMs)
    : 0;
  const currentMonster = isActive
    ? isRecovering
      ? "Recovering..."
      : task.currentMonsterName ?? "Preparing next encounter..."
    : "Waiting for the task ahead";
  const healthSnapshot =
    typeof task.currentMonsterHealth === "number" &&
    typeof task.currentMonsterMaxHealth === "number" &&
    typeof task.currentPlayerHealth === "number" &&
    typeof task.currentPlayerMaxHealth === "number"
      ? {
          monsterHealth: task.currentMonsterHealth,
          monsterMaxHealth: task.currentMonsterMaxHealth,
          playerHealth: task.currentPlayerHealth,
          playerMaxHealth: task.currentPlayerMaxHealth,
        }
      : null;
  const monsterHealthPercent = healthSnapshot
    ? Math.min(
        100,
        (healthSnapshot.monsterHealth / healthSnapshot.monsterMaxHealth) * 100
      )
    : 0;
  const playerHealthPercent = healthSnapshot
    ? Math.min(
        100,
        (healthSnapshot.playerHealth / healthSnapshot.playerMaxHealth) * 100
      )
    : 0;

  const handleStop = async () => {
    setIsStopping(true);
    setError(null);
    try {
      await cancelTask({ playerId, taskId: task._id });
      onStopped();
    } catch (stopError) {
      setError(
        stopError instanceof Error
          ? stopError.message
          : "Unable to stop auto-battle."
      );
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <Card className="forest-card box-glow-green min-h-[400px] p-6">
      <div className="flex min-h-[350px] flex-col gap-5 py-8">
        <div className="text-center">
          <p className="mb-2 font-heading text-lg text-forest-glow">
            {isRecovering
              ? "Recovery in progress"
              : isActive
                ? "Battle automation active"
                : "Battle queued"}
          </p>
          <h2 className="font-heading text-2xl text-gold glow-gold">
            Tier {task.tier} ·{" "}
            {task.zone ? `${COMBAT_ZONE_LABELS[task.zone]} wilds` : "regular wilds"}
          </h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            {isRecovering
              ? `Recovering after a defeat. Next encounter in ${formatDuration(
                  recoveryRemainingMs
                )}.`
              : isActive
                ? "Battles are resolving online. Defeats count, and bosses are never included."
              : "This run will begin when the task ahead of it finishes."}
          </p>
        </div>

        <div
          className={`forest-panel flex items-center justify-between gap-4 px-4 py-3 text-sm ${
            isRecovering
              ? "border-gold/50 bg-gold/10 text-gold-light"
              : "text-muted-foreground"
          }`}
          role="status"
          aria-live="polite"
        >
          <span className="font-semibold">
            {isRecovering ? "Respawning after defeat" : "Respawn delay"}
          </span>
          <span className="tabular-nums">
            {isRecovering
              ? `${formatDuration(recoveryRemainingMs)} remaining`
              : `${formatDuration(respawnTimeMs)} after a defeat`}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="forest-panel p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Current monster
            </p>
            <p className="mt-2 font-heading text-xl text-blood-light glow-red">
              {currentMonster}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isRecovering
                ? "Your health will refresh before the next encounter."
                : isActive
                  ? "Health refreshes with each online heartbeat."
                : "The encounter will appear when this run becomes active."}
            </p>
            {healthSnapshot ? (
              <div className="mt-4 space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-foreground/70">Monster health</span>
                    <span className="tabular-nums text-foreground">
                      {Math.ceil(healthSnapshot.monsterHealth)} /{" "}
                      {Math.ceil(healthSnapshot.monsterMaxHealth)}
                    </span>
                  </div>
                  <Progress
                    value={monsterHealthPercent}
                    className="h-2 hp-bar-monster"
                    aria-label="Monster health"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-foreground/70">Your health</span>
                    <span className="tabular-nums text-forest-glow">
                      {Math.ceil(healthSnapshot.playerHealth)} /{" "}
                      {Math.ceil(healthSnapshot.playerMaxHealth)}
                    </span>
                  </div>
                  <Progress
                    value={playerHealthPercent}
                    className="h-2 hp-bar-player"
                    aria-label="Your health"
                  />
                </div>
              </div>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">
                Preparing the first health snapshot...
              </p>
            )}
          </div>

          <div className="forest-panel space-y-3 p-4">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Run mode</span>
              <span className="text-foreground">
                {task.battleMode === "count"
                  ? "Battle count"
                  : task.battleMode === "duration"
                    ? "Online duration"
                    : "Until stopped"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="text-foreground">{progressLabel}</span>
            </div>
            {progressPercent !== null && (
              <Progress value={progressPercent} className="h-2" />
            )}
            <p className="text-xs text-muted-foreground">
              Offline time never adds battle progress. The task queue remains
              available from the navbar.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="forest-panel p-4" aria-labelledby="defeated-monsters-heading">
            <div className="flex items-center justify-between gap-3">
              <h3
                id="defeated-monsters-heading"
                className="font-heading text-lg text-gold"
              >
                Monsters defeated
              </h3>
              <span className="text-xs text-muted-foreground">
                {formatNumber(totalDefeatedMonsters)} total
              </span>
            </div>
            {defeatedMonsters.length > 0 ? (
              <ul className="mt-3 space-y-2" aria-label="Monsters defeated">
                {defeatedMonsters.map((monster) => (
                  <li
                    key={monster.monsterType}
                    className="flex items-center justify-between gap-3 border-b border-forest-light/15 pb-2 text-sm last:border-0 last:pb-0"
                  >
                    <span className="text-foreground">{monster.monsterName}</span>
                    <span className="tabular-nums text-forest-glow">
                      ×{formatNumber(monster.defeatedCount)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded border border-dashed border-forest-light/25 px-3 py-4 text-sm text-muted-foreground">
                No monsters defeated yet.
              </p>
            )}
          </section>

          <section className="forest-panel p-4" aria-labelledby="loot-gained-heading">
            <h3
              id="loot-gained-heading"
              className="font-heading text-lg text-gold"
            >
              Loot gained
            </h3>
            <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-forest-light/15 py-2 text-xs">
              <div className="flex items-baseline gap-1.5">
                <dt className="text-muted-foreground">XP</dt>
                <dd className="font-semibold tabular-nums text-mystic-glow">
                  {formatNumber(task.totalExperienceEarned ?? 0)}
                </dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-muted-foreground">Gold</dt>
                <dd className="font-semibold tabular-nums text-gold-light">
                  {formatNumber(task.totalGoldEarned ?? 0)}
                </dd>
              </div>
            </dl>
            {lootSummary.length > 0 ? (
              <ul className="mt-3 space-y-2" aria-label="Item drops">
                {lootSummary.map((drop) => (
                  <li
                    key={drop.itemId}
                    className="flex items-center justify-between gap-3 border-b border-forest-light/15 pb-2 text-sm last:border-0 last:pb-0"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2 text-foreground">
                      <ItemIcon
                        item={{ itemId: drop.itemId, name: drop.itemName }}
                        alt=""
                        className="size-5"
                      />
                      <span className="truncate">{drop.itemName}</span>
                    </span>
                    <span className="tabular-nums text-forest-glow">
                      ×{formatNumber(drop.quantity)}
                      {drop.pending > 0 && (
                        <span className="ml-1 text-[10px] text-gold">
                          ({formatNumber(drop.pending)} cached)
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3 rounded border border-dashed border-gold/25 bg-gold/5 px-3 py-4">
                <p className="text-sm text-muted-foreground">
                  No item drops recorded yet.
                </p>
              </div>
            )}
          </section>
        </div>

        {error && (
          <p className="text-xs text-blood-light" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleStop()}
            disabled={isStopping}
            className="border-blood-light/40 text-blood-light hover:bg-blood/20"
          >
            {isStopping ? "Stopping..." : "Stop auto-battle"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function createFight(
  combatant: CombatantStats,
  tier: number,
  isBoss: boolean,
  zone?: CombatZone,
  monsterPower: number = 1
): CurrentFight {
  const combatantStats = calculateDerivedStats(
    combatant.str,
    combatant.dex,
    combatant.int,
    combatant.luk,
    combatant.con
  );

  return {
    settlementKey: crypto.randomUUID(),
    monsterTier: tier,
    ...(zone === undefined ? {} : { monsterZone: zone }),
    monsterType: combatant.type,
    monsterName: combatant.name,
    isBoss,
    monsterHp: Math.max(1, Math.round(combatantStats.health * monsterPower)),
    monsterMaxHp: Math.max(
      1,
      Math.round(combatantStats.health * monsterPower)
    ),
    monsterAttack: Math.max(1, combatantStats.attack * monsterPower),
    monsterAttackSpeed: combatantStats.attackSpeed,
  };
}

export function FightArea({ player }: FightAreaProps) {
  const [currentFight, setCurrentFight] = useAtom(currentFightAtom);
  const [, setPlayerHp] = useAtom(playerHpAtom);
  const [, setPlayerMaxHp] = useAtom(playerMaxHpAtom);
  const [, setFightPhase] = useAtom(inFightPhaseAtom);
  const [, setEventTracker] = useAtom(eventTrackerAtom);
  const [respawnTimer, setRespawnTimer] = useAtom(respawnTimerAtom);
  const [searchParams, setSearchParams] = useSearchParams();
  const [isStarting, setIsStarting] = useState(false);
  const [autoBattleSettings, setAutoBattleSettings] =
    useState<AutoBattleSettings>({
      enabled: false,
      mode: "until-stopped",
      target: "10",
    });
  const [autoBattleError, setAutoBattleError] = useState<string | null>(null);
  const [autoBattleTaskId, setAutoBattleTaskId] =
    useState<Id<"playerTasks"> | null>(null);

  const monstersQuery = useQuery({
    ...convexQuery(api.seed.getAllMonsters, {}),
    ...convexQueryCacheOptions,
  });
  const balanceQuery = useQuery({
    ...convexQuery(api.seed.getAllGameBalance, {}),
    ...convexQueryCacheOptions,
  });
  const monsters = monstersQuery.data;
  const balanceRows = balanceQuery.data;

  // Build a lookup from balance key -> value
  const balance = Object.fromEntries(
    (balanceRows ?? []).map((b) => [b.key, b.value])
  );
  const maxTier =
    typeof balance.maxTier === "number" &&
    Number.isSafeInteger(balance.maxTier) &&
    balance.maxTier >= 1
      ? balance.maxTier
      : 20;

  // Tier and hunting zone live in the URL (/combat?tier=3&zone=easy) so every
  // tier/zone combination is a shareable route.
  const requestedTier = Number(searchParams.get("tier"));
  const selectedTier = Math.min(
    Number.isSafeInteger(requestedTier) && requestedTier >= 1
      ? requestedTier
      : player.currentTier,
    maxTier
  );
  const rawZone = searchParams.get("zone");
  const selectedZone: CombatZone = isCombatZone(rawZone) ? rawZone : "easy";

  const updateCombatParams = (tier: number, zone: CombatZone) => {
    const next = new URLSearchParams(searchParams);
    next.set("tier", String(tier));
    next.set("zone", zone);
    setSearchParams(next);
  };

  const zoneGroups = useMemo(
    () => (monsters ? groupMonstersByZone(monsters) : null),
    [monsters]
  );

  const bossQuery = useQuery({
    ...convexQuery(api.seed.getScaledBoss, {
      tier: selectedTier,
      playerId: player._id,
    }),
    ...convexQueryCacheOptions,
  });
  const boss = bossQuery.data;
  const taskQueue = useTaskQueue(player._id);
  const taskQueueData = taskQueue.data;
  const selectedTierRef = useRef(selectedTier);
  const selectedZoneRef = useRef(selectedZone);
  const currentFightRef = useRef(currentFight);
  const respawnTimerRef = useRef(respawnTimer);
  const isStartingRef = useRef(false);
  const enqueueAutoBattle = useEnqueueAutoBattle();

  selectedTierRef.current = selectedTier;
  selectedZoneRef.current = selectedZone;
  currentFightRef.current = currentFight;
  respawnTimerRef.current = respawnTimer;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRespawnTimer((previous) => {
        if (previous <= 0) return 0;
        return Math.max(0, previous - 100);
      });
    }, 100);

    return () => window.clearInterval(timer);
  }, [setRespawnTimer]);

  // Build a lookup from balance key -> value
  const tierMultiplier = (balance.tierScaleMultiplier as number) ?? 2;
  const tierMsReduction = (balance.tierScaleMsReduction as number) ?? 50;
  const minAttackMs = (balance.minAttackMs as number) ?? 800;
  const monsterPower =
    typeof balance.monsterPowerMultiplier === "number" &&
    Number.isFinite(balance.monsterPowerMultiplier) &&
    balance.monsterPowerMultiplier > 0
      ? balance.monsterPowerMultiplier
      : DEFAULT_MONSTER_POWER_MULTIPLIER;
  const respawnTimeMs =
    typeof balance.respawnTimeMs === "number" &&
    Number.isSafeInteger(balance.respawnTimeMs) &&
    balance.respawnTimeMs >= 0
      ? balance.respawnTimeMs
      : 5_000;
  const bossUnlockLevelPerTier =
    typeof balance.bossUnlockLevelPerTier === "number" &&
    Number.isSafeInteger(balance.bossUnlockLevelPerTier) &&
    balance.bossUnlockLevelPerTier >= 1
      ? balance.bossUnlockLevelPerTier
      : 20;
  const playerLevel =
    typeof player.level === "number" ? player.level : 0;
  const bossRequiredLevel = selectedTier * bossUnlockLevelPerTier;
  const bossLevelLocked = playerLevel < bossRequiredLevel;
  const isTaskQueueFull =
    taskQueueData !== undefined &&
    taskQueueData.usedSlots >= taskQueueData.capacity;
  const hasQueuedTasks =
    taskQueueData !== undefined &&
    (taskQueueData.active != null ||
      (taskQueueData.queued?.length ?? 0) > 0);
  const manualFightBlocked =
    !autoBattleSettings.enabled && hasQueuedTasks;

  if (
    !currentFight &&
    (monsters === undefined || balanceRows === undefined) &&
    (monstersQuery.isPending || balanceQuery.isPending)
  ) {
    return (
      <Card className="forest-card box-glow-green min-h-[400px] p-6">
        <div className="flex min-h-[348px] items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Preparing the wilds...
          </p>
        </div>
      </Card>
    );
  }

  if (
    !currentFight &&
    ((monstersQuery.isError && !monsters) ||
      (balanceQuery.isError && !balanceRows))
  ) {
    return (
      <Card className="forest-card box-glow-green min-h-[400px] p-6">
        <div className="flex min-h-[348px] items-center justify-center">
          <p className="text-sm text-blood-light" role="alert">
            Unable to load combat data.
          </p>
        </div>
      </Card>
    );
  }

  const handleStartFight = async () => {
    if (
      currentFightRef.current ||
      isStartingRef.current ||
      respawnTimerRef.current > 0
    ) {
      return false;
    }

    if (!autoBattleSettings.enabled && hasQueuedTasks) {
      return false;
    }

    const tier = selectedTierRef.current;
    const zone = selectedZoneRef.current;
    isStartingRef.current = true;
    setIsStarting(true);

    if (autoBattleSettings.enabled) {
      const numericTarget = Number(autoBattleSettings.target);
      if (
        autoBattleSettings.mode === "count" &&
        (!Number.isSafeInteger(numericTarget) || numericTarget < 1)
      ) {
        setAutoBattleError("Enter a whole number of battles greater than zero.");
        isStartingRef.current = false;
        setIsStarting(false);
        return false;
      }
      if (
        autoBattleSettings.mode === "duration" &&
        (!Number.isFinite(numericTarget) || numericTarget <= 0)
      ) {
        setAutoBattleError("Enter an online duration greater than zero.");
        isStartingRef.current = false;
        setIsStarting(false);
        return false;
      }

      try {
        const queuedTask = await enqueueAutoBattle({
          playerId: player._id,
          tier,
          zone,
          mode: autoBattleSettings.mode,
          ...(autoBattleSettings.mode === "count"
            ? { targetBattles: numericTarget }
            : {}),
          ...(autoBattleSettings.mode === "duration"
            ? { targetDurationMs: Math.floor(numericTarget * 60_000) }
            : {}),
        });
        setAutoBattleTaskId(queuedTask?._id ?? null);
        setAutoBattleError(null);
        return true;
      } catch (error) {
        setAutoBattleError(
          error instanceof Error
            ? error.message
            : "Unable to add auto-battle to the queue."
        );
        return false;
      } finally {
        isStartingRef.current = false;
        setIsStarting(false);
      }
    }

    if (!monsters || monsters.length === 0) {
      isStartingRef.current = false;
      setIsStarting(false);
      return false;
    }

    try {
      // Weighted random selection within the chosen zone — weaker monsters
      // appear more often. Falls back to the full pool if the zone is empty.
      const zonePool = monstersInZone(monsters, zone);
      const pool = zonePool.length > 0 ? zonePool : monsters;
      const maxStrength = Math.max(...pool.map((m) => m.strength));
      const weights = pool.map((m) => maxStrength - m.strength + 1);
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let rand = Math.random() * totalWeight;
      let baseMonster = pool[pool.length - 1];
      for (let i = 0; i < pool.length; i++) {
        rand -= weights[i];
        if (rand <= 0) {
          baseMonster = pool[i];
          break;
        }
      }

      // Exponential tier scaling
      const mult = Math.pow(tierMultiplier, tier - 1);
      const scaledMonster = {
        ...baseMonster,
        str: Math.round(baseMonster.str * mult),
        dex: Math.round(baseMonster.dex * mult),
        int: Math.round(baseMonster.int * mult),
        luk: Math.round(baseMonster.luk * mult),
        con: Math.round(baseMonster.con * mult),
        baseMsPerAttack: Math.max(
          minAttackMs,
          baseMonster.baseMsPerAttack - (tier - 1) * tierMsReduction
        ),
      };

      const fight = createFight(scaledMonster, tier, false, zone, monsterPower);

      currentFightRef.current = fight;
      setCurrentFight(fight);
      setPlayerHp(player.health);
      setPlayerMaxHp(player.health);
      setFightPhase("fighting");
      setEventTracker({
        type: "fighting",
        monsterName: fight.monsterName,
        tier,
      });
    } finally {
      isStartingRef.current = false;
      setIsStarting(false);
    }
    return true;
  };

  const handleStartBossFight = () => {
    const tier = selectedTierRef.current;
    if (
      !boss ||
      boss.tier !== tier ||
      playerLevel < tier * bossUnlockLevelPerTier ||
      currentFightRef.current ||
      isStartingRef.current ||
      respawnTimerRef.current > 0 ||
      hasQueuedTasks
    ) {
      return false;
    }

    isStartingRef.current = true;
    setIsStarting(true);

    try {
      const fight = createFight(
        {
          type: boss.bossId,
          name: boss.name,
          str: boss.str,
          dex: boss.dex,
          int: boss.int,
          luk: boss.luk,
          con: boss.con,
        },
        tier,
        true
      );
      currentFightRef.current = fight;
      setCurrentFight(fight);
      setPlayerHp(player.health);
      setPlayerMaxHp(player.health);
      setFightPhase("fighting");
      setEventTracker({
        type: "fighting",
        monsterName: fight.monsterName,
        tier,
      });
    } finally {
      isStartingRef.current = false;
      setIsStarting(false);
    }

    return true;
  };

  const handleStartNextFight = () => false;

  if (currentFight) {
    return (
      <ActiveFight
        player={player}
        respawnTimeMs={respawnTimeMs}
        onStartNextFight={handleStartNextFight}
      />
    );
  }

  const isRespawning = respawnTimer > 0;
  const respawnSeconds = Math.ceil(respawnTimer / 1000);
  const queuedAutoBattle =
    toBattleTask(taskQueueData?.active) ??
    toBattleTask(
      taskQueueData?.queued.find((task) => task._id === autoBattleTaskId)
    );

  if (queuedAutoBattle) {
    return (
      <AutoBattleStatus
        playerId={player._id}
        task={queuedAutoBattle}
        respawnTimeMs={respawnTimeMs}
        onStopped={() => setAutoBattleTaskId(null)}
      />
    );
  }

  return (
    <Card className="forest-card box-glow-green min-h-[400px] p-6">
      <div className="flex flex-col items-center justify-center space-y-4 py-12">
        <div className="text-center">
          {isRespawning ? (
            <>
              <p className="text-gold font-heading text-lg glow-gold mb-2">Recovering...</p>
              <p className="text-3xl font-bold text-gold-light glow-gold mb-2">{respawnSeconds}s</p>
              <p className="text-sm text-muted-foreground">The forest grants you time to heal your wounds.</p>
            </>
          ) : (
            <>
              <p className="text-forest-glow/70 mb-2 font-heading text-lg">Choose your tier</p>
              <p className="text-sm text-muted-foreground mb-4">
                Max tier reached: {player.maxTierReached || 1}
              </p>
            </>
          )}
        </div>

        {!isRespawning && (
          <>
            {/* Tier Selection Buttons */}
            <div className="grid grid-cols-6 gap-2 w-full max-w-sm">
              {Array.from({ length: Math.min(12, maxTier) }, (_, i) => i + 1).map((tier) => (
                <button
                  key={tier}
                  onClick={() => updateCombatParams(tier, selectedZone)}
                  disabled={isStarting}
                  className={`py-1 px-2 rounded text-xs font-heading transition-colors ${
                    selectedTier === tier
                      ? "bg-gold/30 text-gold-light border border-gold glow-gold"
                      : "bg-forest-dark/50 text-foreground/60 border border-forest-light/20 hover:border-forest-light/40 hover:text-foreground/80"
                  } disabled:opacity-50`}
                >
                  T{tier}
                </button>
              ))}
            </div>

            {/* Hunting Zone Selection */}
            <div className="w-full max-w-sm space-y-2">
              <p className="text-center font-heading text-sm text-forest-glow/70">
                Hunting zone · Tier {selectedTier}
              </p>
              <div
                className="grid grid-cols-3 gap-2"
                role="group"
                aria-label="Hunting zone"
              >
                {COMBAT_ZONE_VALUES.map((zone) => {
                  const zoneMonsters = zoneGroups?.[zone] ?? [];
                  const isActive = selectedZone === zone;
                  return (
                    <button
                      key={zone}
                      type="button"
                      onClick={() => updateCombatParams(selectedTier, zone)}
                      disabled={isStarting}
                      aria-pressed={isActive}
                      className={`rounded border px-2 py-2 transition-colors disabled:opacity-50 ${
                        isActive
                          ? "border-gold bg-gold/30 text-gold-light glow-gold"
                          : "border-forest-light/20 bg-forest-dark/50 text-foreground/60 hover:border-forest-light/40 hover:text-foreground/80"
                      }`}
                    >
                      <span className="block font-heading text-xs">
                        {COMBAT_ZONE_LABELS[zone]}
                      </span>
                      <span className="mt-1 block text-[10px] leading-tight text-muted-foreground">
                        {zoneMonsters.length > 0
                          ? zoneMonsters.map((m) => m.name).join(" · ")
                          : "No monsters"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-center text-[11px] text-muted-foreground">
                Each zone holds a third of the tier's monsters, easiest to
                hardest — pick the zone closest to your level or hunt specific
                monsters.
              </p>
            </div>

          </>
        )}

        <AutomationControls
          player={player}
          tier={selectedTier}
          zone={selectedZone}
          settings={autoBattleSettings}
          onEnabledChange={(enabled) => {
            setAutoBattleError(null);
            setAutoBattleSettings((current) => ({ ...current, enabled }));
          }}
          onModeChange={(mode: AutoBattleMode) => {
            setAutoBattleError(null);
            setAutoBattleSettings((current) => ({ ...current, mode }));
          }}
          onTargetChange={(target) => {
            setAutoBattleError(null);
            setAutoBattleSettings((current) => ({ ...current, target }));
          }}
          isQueueing={isStarting}
          error={
            autoBattleError ??
            (autoBattleSettings.enabled && isTaskQueueFull
              ? "The task queue is full. Stop or finish a task before entering the wilds."
              : null)
          }
        />

        <div className="flex w-full max-w-2xl flex-col gap-3 sm:flex-row">
          <Button
            size="lg"
            onClick={() => {
              void handleStartFight();
            }}
            disabled={
              isStarting ||
              isRespawning ||
              manualFightBlocked ||
              (!autoBattleSettings.enabled &&
                (!monsters || monsters.length === 0)) ||
              (autoBattleSettings.enabled && isTaskQueueFull)
            }
            className="flex-1 bg-forest-mid text-lg text-gold-light hover:bg-forest-light border border-gold/20 disabled:bg-forest-dark/50 disabled:text-muted-foreground disabled:border-forest-light/10"
          >
            {isRespawning
              ? `Recovering (${respawnSeconds}s)`
              : isStarting
                ? "Venturing forth..."
              : "⚔ Enter the Wilds"}
          </Button>
          <Button
            size="lg"
            onClick={() => {
              handleStartBossFight();
            }}
            disabled={
              isStarting ||
              isRespawning ||
              bossQuery.isPending ||
              !boss ||
              bossLevelLocked ||
              hasQueuedTasks
            }
            className="flex-1 bg-blood/80 text-lg text-gold-light hover:bg-blood border border-blood-light/40 disabled:bg-forest-dark/50 disabled:text-muted-foreground disabled:border-forest-light/10"
          >
            {isRespawning
              ? `Recovering (${respawnSeconds}s)`
              : isStarting
                ? "Preparing..."
                : bossLevelLocked
                ? `Requires level ${bossRequiredLevel}`
                : bossQuery.isPending
                  ? "Loading boss..."
                : boss
                  ? "👑 Challenge Boss"
                  : "Boss not yet reached"}
          </Button>
        </div>
        {autoBattleSettings.enabled && hasQueuedTasks && !isRespawning && (
          <p className="text-center text-xs text-muted-foreground" role="status">
            Finish or stop your queued tasks before challenging a boss.
          </p>
        )}
        {manualFightBlocked && !isRespawning && (
          <p className="text-center text-xs text-muted-foreground" role="status">
            Finish or stop your queued tasks before entering the wilds or
            challenging a boss. Battles can only be queued once you unlock
            battle automation in the passive skill tree.
          </p>
        )}
      </div>
    </Card>
  );
}
