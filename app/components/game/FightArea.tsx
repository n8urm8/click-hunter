import {
  Card, CardContent, CardHeader, CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Crown, Swords } from "lucide-react";
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
  BattleRunSettings,
  type AutoBattleMode,
  type AutoBattleSettings,
} from "./BattleRunSettings";
import { CombatStats } from "./CombatStats";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import { convexQueryCacheOptions } from "~/lib/queryCache";
import {
  COMBAT_ZONE_LABELS,
  COMBAT_ZONE_VALUES,
  groupMonstersByZone,
  isCombatZone,
  type CombatZone,
} from "~/lib/combatZones";
import {
  useCancelTask,
  useEnqueueAutoBattle,
  useTaskQueue,
} from "~/hooks/useTasks";
import { useStartBossFight } from "~/hooks/useBossFight";
import { formatNumber } from "~/lib/utils";
import type { PlayerWithDerivedStats } from "~/hooks/usePlayer";
import { useTaskClock } from "~/hooks/useTaskClock";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { projectBattleHealth } from "../../../convex/taskTiming";

interface FightAreaProps {
  player: PlayerWithDerivedStats;
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
  updatedAt: number;
  onlineCreditMs: number;
  battleEncounter?: Doc<"playerTasks">["battleEncounter"];
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
    itemSlug?: string;
    itemFamily?: string;
    category?: string;
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

function BattleStatus({
  playerId,
  task,
  onStopped,
}: {
  playerId: Id<"players">;
  task: BattleTask;
  onStopped: () => void;
}) {
  const cancelTask = useCancelTask();
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isActive = task.status === "active";
  const clockMs = useTaskClock(isActive, 250, true);
  const encounter = task.battleEncounter;
  const encounterProgressMs = Math.min(
    encounter?.durationMs ?? 0,
    task.onlineCreditMs + (isActive
      ? Math.max(0, clockMs - Math.max(task.updatedAt, task.respawnUntil ?? 0))
      : 0)
  );
  const projectedProgressMs = Math.min(
    task.targetDurationMs ?? Infinity,
    task.progressMs + encounterProgressMs
  );
  const progressLabel =
    task.battleMode === "count"
      ? `${task.completedBattles} / ${task.targetBattles ?? "?"} battles`
      : task.battleMode === "duration"
        ? `${formatDuration(projectedProgressMs)} / ${formatDuration(
          task.targetDurationMs
        )} online`
        : `${task.completedBattles} battles completed`;
  const progressPercent =
    task.battleMode === "count" && task.targetBattles
      ? Math.min(100, (task.completedBattles / task.targetBattles) * 100)
      : task.battleMode === "duration" && task.targetDurationMs
        ? Math.min(100, (projectedProgressMs / task.targetDurationMs) * 100)
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
  const projectedHealth = encounter && !isRecovering
    ? projectBattleHealth(encounter, encounterProgressMs)
    : task;
  const healthSnapshot =
    typeof task.currentMonsterHealth === "number" &&
      typeof task.currentMonsterMaxHealth === "number" &&
      typeof task.currentPlayerHealth === "number" &&
      typeof task.currentPlayerMaxHealth === "number"
      ? {
        monsterHealth: projectedHealth.currentMonsterHealth ?? task.currentMonsterHealth,
        monsterMaxHealth: task.currentMonsterMaxHealth,
        playerHealth: projectedHealth.currentPlayerHealth ?? task.currentPlayerHealth,
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
          : "Unable to stop the hunt."
      );
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-2xl text-gold glow-gold">
            Tier {task.tier} ·{" "}
            {task.zone ? `${COMBAT_ZONE_LABELS[task.zone]} wilds` : "regular wilds"}
          </h2>
          <p className="text-sm text-muted-foreground" role="status">
            {isRecovering
              ? `Recovering after a defeat. Next encounter in ${formatDuration(
                recoveryRemainingMs
              )}.`
              : isActive
                ? "Hunting"
                : "This run will begin when the task ahead of it finishes."}
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          className="min-h-11"
          onClick={() => void handleStop()}
          disabled={isStopping}
        >
          {isStopping ? "Stopping..." : "Stop hunt"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="font-heading text-xl text-foreground">
            {currentMonster}
          </p>
          {encounter?.playerAttackSpeed !== undefined && !isRecovering && (
            <p className="text-xs text-muted-foreground">
              This encounter: {encounter.playerAttackSpeed.toFixed(2)} attacks/s
            </p>
          )}
          {healthSnapshot ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
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
              <div className="flex flex-col gap-1">
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

        <div className="flex flex-col gap-3 sm:border-l sm:pl-6">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span className="text-foreground">{progressLabel}</span>
          </div>
          {progressPercent !== null && (
            <Progress value={progressPercent} className="h-2" aria-label="Hunt progress" />
          )}
          <p className="text-xs text-muted-foreground">
            {task.battleMode === "until-stopped" ? "Until stopped · Online only" : "Online only"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="border-t pt-4" aria-labelledby="defeated-monsters-heading">
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
            <ul className="mt-3 flex flex-col gap-2" aria-label="Monsters defeated">
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
            <p className="mt-3 text-sm text-muted-foreground">
              No monsters defeated yet.
            </p>
          )}
        </section>

        <section className="border-t pt-4" aria-labelledby="loot-gained-heading">
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
            <ul className="mt-3 flex flex-col gap-2" aria-label="Item drops">
              {lootSummary.map((drop) => (
                <li
                  key={drop.itemId}
                  className="flex items-center justify-between gap-3 border-b border-forest-light/15 pb-2 text-sm last:border-0 last:pb-0"
                >
                  <span className="inline-flex min-w-0 items-center gap-2 text-foreground">
                    <ItemIcon
                      item={{
                        itemId: drop.itemSlug ?? drop.itemId,
                        name: drop.itemName,
                        itemFamily: drop.itemFamily,
                        category: drop.category,
                      }}
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
            <p className="mt-3 text-sm text-muted-foreground">
              No item drops recorded yet.
            </p>
          )}
        </section>
      </div>

      {error && (
        <p className="text-xs text-blood-light" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function createBossFight(
  combatant: CombatantStats,
  tier: number,
  playerId: string,
  session: { sessionId: string; settlementKey: string; monsterHp: number }
): CurrentFight {
  const combatantStats = calculateDerivedStats(
    combatant.str,
    combatant.dex,
    combatant.int,
    combatant.luk,
    combatant.con
  );

  return {
    settlementKey: session.settlementKey,
    sessionId: session.sessionId as CurrentFight["sessionId"],
    monsterTier: tier,
    monsterType: combatant.type,
    monsterName: combatant.name,
    isBoss: true,
    monsterHp: session.monsterHp,
    monsterMaxHp: Math.max(
      1,
      Math.round(combatantStats.health)
    ),
    monsterAttack: Math.max(1, combatantStats.attack),
    monsterAttackSpeed: combatantStats.attackSpeed,
  };
}

export function FightArea({ player }: FightAreaProps) {
  const renderScreen = (content: ReactNode) => (
    <Card className="forest-card gap-0 p-0">
      <CardHeader className="gap-4 border-b py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Combat</CardTitle>
          <p className="text-xs text-muted-foreground">
            Level {player.level} · Best tier {player.maxTierReached ?? 1}
          </p>
        </div>
        <CombatStats player={player} />
      </CardHeader>
      <CardContent className="py-6">{content}</CardContent>
    </Card>
  );
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
  // tier/zone combination is a shareable route. Only three tiers past the
  // player's best are listed; the grid shows two rows with a scrollbar.
  const reachedTier = Math.max(
    1,
    player.maxTierReached ?? player.currentTier ?? 1
  );
  const visibleTierCount = Math.min(maxTier, reachedTier + 3);
  const requestedTier = Number(searchParams.get("tier"));
  const selectedTier = Math.min(
    Number.isSafeInteger(requestedTier) && requestedTier >= 1
      ? requestedTier
      : player.currentTier,
    visibleTierCount
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
  const startBossFight = useStartBossFight();

  selectedTierRef.current = selectedTier;
  selectedZoneRef.current = selectedZone;
  currentFightRef.current = currentFight;
  respawnTimerRef.current = respawnTimer;

  useEffect(() => {
    if (currentFight && !currentFight.isBoss) {
      setCurrentFight(null);
      setFightPhase("idle");
      setEventTracker({ type: "idle" });
    }
  }, [currentFight, setCurrentFight, setFightPhase, setEventTracker]);

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
  const respawnTimeMs =
    typeof balance.respawnTimeMs === "number" &&
      Number.isSafeInteger(balance.respawnTimeMs) &&
      balance.respawnTimeMs >= 0
      ? balance.respawnTimeMs
      : 5_000;
  const isTaskQueueFull =
    taskQueueData !== undefined &&
    taskQueueData.usedSlots >= taskQueueData.capacity;
  const hasQueuedTasks =
    taskQueueData !== undefined &&
    (taskQueueData.active != null ||
      (taskQueueData.queued?.length ?? 0) > 0);

  if (
    !currentFight &&
    (monsters === undefined || balanceRows === undefined) &&
    (monstersQuery.isPending || balanceQuery.isPending)
  ) {
    return renderScreen(
      <div className="flex min-h-32 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Preparing the wilds...
        </p>
      </div>
    );
  }

  if (
    !currentFight &&
    ((monstersQuery.isError && !monsters) ||
      (balanceQuery.isError && !balanceRows))
  ) {
    return renderScreen(
      <div className="flex min-h-32 items-center justify-center">
        <p className="text-sm text-blood-light" role="alert">
          Unable to load combat data.
        </p>
      </div>
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

    const tier = selectedTierRef.current;
    const zone = selectedZoneRef.current;
    isStartingRef.current = true;
    setIsStarting(true);

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
          : "Unable to add the hunt to the queue."
      );
      return false;
    } finally {
      isStartingRef.current = false;
      setIsStarting(false);
    }
  };

  const handleStartBossFight = () => {
    const tier = selectedTierRef.current;
    if (
      !boss ||
      boss.tier !== tier ||
      currentFightRef.current ||
      isStartingRef.current ||
      respawnTimerRef.current > 0 ||
      hasQueuedTasks
    ) {
      return false;
    }

    isStartingRef.current = true;
    setIsStarting(true);

    void (async () => {
      try {
        // Server-authoritative session: HP, settlement key, and the final
        // verdict all come from convex/bossFights.
        const session = await startBossFight({
          playerId: player._id,
          tier,
        });
        const fight = createBossFight(
          {
            type: session.bossId,
            name: session.bossName,
            str: boss.str,
            dex: boss.dex,
            int: boss.int,
            luk: boss.luk,
            con: boss.con,
          },
          tier,
          player._id,
          session
        );
        currentFightRef.current = fight;
        setCurrentFight(fight);
        setPlayerHp(session.playerHp);
        setPlayerMaxHp(session.playerMaxHp);
        setFightPhase("fighting");
        setEventTracker({
          type: "fighting",
          monsterName: fight.monsterName,
          tier,
        });
      } catch (error) {
        setAutoBattleError(
          error instanceof Error
            ? error.message
            : "Unable to start the boss fight."
        );
      } finally {
        isStartingRef.current = false;
        setIsStarting(false);
      }
    })();

    return true;
  };

  const handleStartNextFight = () => false;

  if (currentFight) {
    return renderScreen(
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
    return renderScreen(
      <BattleStatus
        playerId={player._id}
        task={queuedAutoBattle}
        onStopped={() => setAutoBattleTaskId(null)}
      />
    );
  }

  return renderScreen(
    <div className="flex flex-col gap-6">
      {isRespawning && (
        <p className="text-sm text-muted-foreground" role="status">
          Recovering after defeat. Ready in {respawnSeconds}s.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        <fieldset disabled={isStarting || isRespawning} className="min-w-0">
          <legend className="mb-3 font-heading text-lg">Hunting tier</legend>
          <div className="grid max-h-[6rem] grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6">
            {Array.from({ length: visibleTierCount }, (_, i) => i + 1).map((tier) => (
              <label key={tier} className="combat-choice">
                <input
                  type="radio"
                  name="hunting-tier"
                  value={tier}
                  checked={selectedTier === tier}
                  onChange={() => updateCombatParams(tier, selectedZone)}
                  className="sr-only"
                />
                <span>T{tier}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset disabled={isStarting || isRespawning} className="min-w-0">
          <legend className="mb-3 font-heading text-lg">Hunting zone</legend>
          <div className="grid grid-cols-3 gap-2">
            {COMBAT_ZONE_VALUES.map((zone) => {
              const zoneMonsters = zoneGroups?.[zone] ?? [];
              return (
                <label key={zone} className="combat-choice combat-choice--zone">
                  <input
                    type="radio"
                    name="hunting-zone"
                    value={zone}
                    checked={selectedZone === zone}
                    onChange={() => updateCombatParams(selectedTier, zone)}
                    className="sr-only"
                  />
                  <span className="font-heading text-base">{COMBAT_ZONE_LABELS[zone]}</span>
                  <span className="text-xs leading-relaxed">
                    {zoneMonsters.length > 0
                      ? zoneMonsters.map((monster) => monster.name).join(" · ")
                      : "No monsters"}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>
      <div className="flex flex-col gap-4 border-t pt-5 xl:flex-row xl:items-end xl:justify-between">
        <BattleRunSettings
          settings={autoBattleSettings}
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
            (isTaskQueueFull
              ? "The task queue is full. Stop or finish a task before entering the wilds."
              : null)
          }
        />
        <div className="flex min-w-0 flex-col gap-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              size="lg"
              onClick={() => void handleStartFight()}
              disabled={isStarting || isRespawning || !monsters || monsters.length === 0 || isTaskQueueFull}
            >
              <Swords data-icon="inline-start" />
              {isRespawning
                ? `Recovering (${respawnSeconds}s)`
                : isStarting ? "Starting hunt..." : "Enter the Wilds"}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => handleStartBossFight()}
              disabled={isStarting || isRespawning || bossQuery.isPending || !boss || hasQueuedTasks}
            >
              <Crown data-icon="inline-start" />
              {bossQuery.isPending
                ? "Loading boss..."
                : boss ? "Challenge Boss" : "Boss unavailable"}
            </Button>
          </div>
          {hasQueuedTasks && !isRespawning && (
            <p className="text-xs text-muted-foreground" role="status">
              Finish or stop queued tasks before challenging a boss.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
