import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { calculateCharacterLevel } from "./characterLevel";
import {
  settleRegularFight,
  simulateRegularBattle,
  type AutoBattleResult,
} from "./combat";
import type { LootSummary } from "./loot";
import { getEquippedStatBonuses } from "./items";
import {
  advanceSkillActionTask,
  prepareSkillAction,
  refundSkillTaskReservation,
  resolveSkillTask,
} from "./skills";

export const DEFAULT_TASK_QUEUE_CAPACITY = 5;
export const DEFAULT_OFFLINE_TASK_WINDOW_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_TASK_HEARTBEAT_GRACE_MS = 15 * 1000;
export const DEFAULT_AUTO_BATTLE_BATCH_LIMIT = 5;
export const DEFAULT_AUTO_BATTLE_CREDIT_CAP_MS = 5 * 60 * 1000;
export const DEFAULT_AUTO_BATTLE_RESPAWN_MS = 5 * 1000;

const MAX_AUTO_BATTLE_TARGET_BATTLES = 10_000;
const MAX_AUTO_BATTLE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_AUTO_BATTLE_BATCH_LIMIT = 100;
const HISTORY_QUERY_LIMIT = 10;

type DatabaseCtx = QueryCtx | MutationCtx;
type PlayerId = Id<"players">;
type PlayerTask = Doc<"playerTasks">;
type BattleStat = Doc<"taskBattleStats">;

function projectBattleHealth(
  result: AutoBattleResult,
  elapsedMs: number
) {
  const elapsed = Math.min(
    Math.max(0, elapsedMs),
    result.durationMs
  );
  return {
    currentMonsterHealth: Math.max(
      0,
      Math.ceil(
        result.monsterMaxHealth -
          (result.playerDamagePerSecond * elapsed) / 1000
      )
    ),
    currentMonsterMaxHealth: result.monsterMaxHealth,
    currentPlayerHealth: Math.max(
      0,
      Math.ceil(
        result.playerMaxHealth -
          (result.monsterDamagePerSecond * elapsed) / 1000
      )
    ),
    currentPlayerMaxHealth: result.playerMaxHealth,
  };
}

async function getBalanceValue(ctx: DatabaseCtx, key: string) {
  const row = await ctx.db
    .query("gameBalance")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  return row?.value;
}

function readIntegerBalance(value: unknown, fallback: number, minimum: number) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
    ? value
    : fallback;
}

function readNonNegativeBalance(value: unknown, fallback: number) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : fallback;
}

async function getQueueCapacity(ctx: DatabaseCtx) {
  const value = await getBalanceValue(ctx, "taskQueueCapacity");
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 100
    ? value
    : DEFAULT_TASK_QUEUE_CAPACITY;
}

async function getOfflineTaskWindow(ctx: DatabaseCtx) {
  return readNonNegativeBalance(
    await getBalanceValue(ctx, "offlineTaskWindowMs"),
    DEFAULT_OFFLINE_TASK_WINDOW_MS
  );
}

async function getHeartbeatGrace(ctx: DatabaseCtx) {
  return readNonNegativeBalance(
    await getBalanceValue(ctx, "taskHeartbeatGraceMs"),
    DEFAULT_TASK_HEARTBEAT_GRACE_MS
  );
}

async function getAutoBattleBatchLimit(ctx: DatabaseCtx) {
  return Math.min(
    MAX_AUTO_BATTLE_BATCH_LIMIT,
    readIntegerBalance(
      await getBalanceValue(ctx, "autoBattleBatchLimit"),
      DEFAULT_AUTO_BATTLE_BATCH_LIMIT,
      1
    )
  );
}

async function getAutoBattleCreditCap(ctx: DatabaseCtx) {
  return readNonNegativeBalance(
    await getBalanceValue(ctx, "autoBattleCreditCapMs"),
    DEFAULT_AUTO_BATTLE_CREDIT_CAP_MS
  );
}

async function getAutoBattleRespawnMs(ctx: DatabaseCtx) {
  return readIntegerBalance(
    await getBalanceValue(ctx, "respawnTimeMs"),
    DEFAULT_AUTO_BATTLE_RESPAWN_MS,
    0
  );
}

async function getPlayer(ctx: DatabaseCtx, playerId: PlayerId) {
  const player = await ctx.db.get(playerId);
  if (!player) {
    throw new Error("Player not found");
  }
  return player;
}

async function getTaskDefinition(
  ctx: DatabaseCtx,
  definitionId: string
) {
  return await ctx.db
    .query("taskDefinitions")
    .withIndex("by_taskId", (q) => q.eq("taskId", definitionId))
    .first();
}

async function getActiveTask(ctx: DatabaseCtx, playerId: PlayerId) {
  return await ctx.db
    .query("playerTasks")
    .withIndex("by_playerId_and_status", (q) =>
      q.eq("playerId", playerId).eq("status", "active")
    )
    .first();
}

async function getQueuedTasks(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  limit: number
) {
  return await ctx.db
    .query("playerTasks")
    .withIndex("by_playerId_and_status_and_queueOrder", (q) =>
      q.eq("playerId", playerId).eq("status", "queued")
    )
    .order("asc")
    .take(limit);
}

async function getNextQueueOrder(ctx: DatabaseCtx, playerId: PlayerId) {
  const lastTask = await ctx.db
    .query("playerTasks")
    .withIndex("by_playerId_and_queueOrder", (q) =>
      q.eq("playerId", playerId)
    )
    .order("desc")
    .first();
  return (lastTask?.queueOrder ?? Date.now()) + 1;
}

async function assertQueueHasCapacity(
  ctx: DatabaseCtx,
  playerId: PlayerId
) {
  const capacity = await getQueueCapacity(ctx);
  const [activeTask, queuedTasks] = await Promise.all([
    getActiveTask(ctx, playerId),
    ctx.db
      .query("playerTasks")
      .withIndex("by_playerId_and_status", (q) =>
        q.eq("playerId", playerId).eq("status", "queued")
      )
      .take(capacity),
  ]);

  if (queuedTasks.length + (activeTask ? 1 : 0) >= capacity) {
    throw new Error(`Task queue is full (${capacity} tasks maximum)`);
  }
}

async function activateNextTask(
  ctx: MutationCtx,
  playerId: PlayerId,
  now: number,
  startedAt = now
) {
  const activeTask = await getActiveTask(ctx, playerId);
  if (activeTask) return activeTask;

  const nextTask = await ctx.db
    .query("playerTasks")
    .withIndex("by_playerId_and_status_and_queueOrder", (q) =>
      q.eq("playerId", playerId).eq("status", "queued")
    )
    .order("asc")
    .first();
  if (!nextTask) return null;

  await ctx.db.patch(nextTask._id, {
    status: "active",
    startedAt,
    lastResolvedAt: startedAt,
    lastHeartbeatAt: now,
    offlineCapped: false,
    updatedAt: now,
  });
  return await ctx.db.get(nextTask._id);
}

function validateTimedDefinition(definition: Doc<"taskDefinitions">) {
  if (!definition.enabled) {
    throw new Error("That task is currently disabled");
  }
  if (definition.category === "battle") {
    throw new Error("Battle tasks must use auto-battle settings");
  }
  if (
    definition.durationMs === undefined ||
    !Number.isSafeInteger(definition.durationMs) ||
    definition.durationMs < 1
  ) {
    throw new Error("Timed task definition has no valid duration");
  }
  if (definition.requiresOnline && definition.canProgressOffline) {
    throw new Error("Task definition cannot require online play and progress offline");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLootSummary(value: unknown): LootSummary[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is LootSummary => {
    if (!isRecord(entry)) return false;
    const quantity = entry.quantity;
    const pending = entry.pending;
    return (
      typeof entry.itemId === "string" &&
      typeof entry.itemName === "string" &&
      typeof quantity === "number" &&
      Number.isSafeInteger(quantity) &&
      quantity >= 1 &&
      typeof pending === "number" &&
      Number.isSafeInteger(pending) &&
      pending >= 0 &&
      (entry.purpose === "augmentation" || entry.purpose === "boss-catalyst")
    );
  });
}

function mergeLootSummary(
  summary: LootSummary[],
  awards: LootSummary[]
) {
  for (const award of awards) {
    const existing = summary.find((entry) => entry.itemId === award.itemId);
    if (existing) {
      existing.quantity += award.quantity;
      existing.pending += award.pending;
    } else {
      summary.push({ ...award });
    }
  }
}

async function assertTaskPrerequisites(
  ctx: MutationCtx,
  player: Doc<"players">,
  definition: Doc<"taskDefinitions">
) {
  if (!isRecord(definition.prerequisites)) return;

  const { upgradeId, minTier, minLevel } = definition.prerequisites;
  if (upgradeId !== undefined) {
    if (typeof upgradeId !== "string" || upgradeId.length === 0) {
      throw new Error("Task definition has an invalid upgrade prerequisite");
    }
    const upgrade = await ctx.db
      .query("playerUpgrades")
      .withIndex("by_playerId", (q) => q.eq("playerId", player._id))
      .filter((q) => q.eq(q.field("upgradeId"), upgradeId))
      .first();
    if (!upgrade || upgrade.quantity <= 0) {
      throw new Error(`Task requires the ${upgradeId} upgrade`);
    }
  }

  if (minTier !== undefined) {
    if (
      typeof minTier !== "number" ||
      !Number.isSafeInteger(minTier) ||
      minTier < 1
    ) {
      throw new Error("Task definition has an invalid tier prerequisite");
    }
    const reachedTier = player.maxTierReached ?? player.currentTier;
    if (reachedTier < minTier) {
      throw new Error(`Task requires regular tier ${minTier}`);
    }
  }

  if (minLevel !== undefined) {
    if (
      typeof minLevel !== "number" ||
      !Number.isSafeInteger(minLevel) ||
      minLevel < 1
    ) {
      throw new Error("Task definition has an invalid level prerequisite");
    }
    if ((await calculateCharacterLevel(ctx, player)) < minLevel) {
      throw new Error(`Task requires player level ${minLevel}`);
    }
  }
}

async function ownsAutoBattleUpgrade(
  ctx: MutationCtx,
  playerId: PlayerId
) {
  const upgrades = await ctx.db
    .query("playerUpgrades")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();
  return upgrades.some(
    (upgrade) =>
      upgrade.upgradeId === "auto_start_fight" && upgrade.quantity > 0
  );
}

async function validateAutoBattleRequest(
  ctx: MutationCtx,
  playerId: PlayerId,
  tier: number,
  mode: "count" | "duration" | "until-stopped",
  targetBattles: number | undefined,
  targetDurationMs: number | undefined
) {
  const player = await getPlayer(ctx, playerId);
  if (!(await ownsAutoBattleUpgrade(ctx, playerId))) {
    throw new Error("Unlock Battle Automation before queueing auto-battle");
  }
  if (!Number.isSafeInteger(tier) || tier < 1) {
    throw new Error("Battle tier must be a positive integer");
  }

  const maxTier = readIntegerBalance(
    await getBalanceValue(ctx, "maxTier"),
    20,
    1
  );
  const reachedTier = player.maxTierReached ?? player.currentTier;
  if (tier > maxTier || tier > reachedTier) {
    throw new Error("You have not unlocked that regular battle tier");
  }

  if (mode === "count") {
    if (
      targetBattles === undefined ||
      !Number.isSafeInteger(targetBattles) ||
      targetBattles < 1 ||
      targetBattles > MAX_AUTO_BATTLE_TARGET_BATTLES
    ) {
      throw new Error(
        `Battle count must be an integer between 1 and ${MAX_AUTO_BATTLE_TARGET_BATTLES}`
      );
    }
    if (targetDurationMs !== undefined) {
      throw new Error("Battle count mode cannot include a duration");
    }
  } else if (mode === "duration") {
    if (
      targetDurationMs === undefined ||
      !Number.isSafeInteger(targetDurationMs) ||
      targetDurationMs < 1_000 ||
      targetDurationMs > MAX_AUTO_BATTLE_DURATION_MS
    ) {
      throw new Error(
        "Battle duration must be between 1 second and 7 days"
      );
    }
    if (targetBattles !== undefined) {
      throw new Error("Battle duration mode cannot include a battle count");
    }
  } else if (
    targetBattles !== undefined ||
    targetDurationMs !== undefined
  ) {
    throw new Error("Until-stopped mode cannot include a target");
  }
}

async function insertTask(
  ctx: MutationCtx,
  args: {
    playerId: PlayerId;
    definition: Doc<"taskDefinitions">;
    taskType: "timed" | "battle";
    displayName: string;
    durationMs?: number;
    battleMode?: "count" | "duration" | "until-stopped";
    targetBattles?: number;
    targetDurationMs?: number;
    tier?: number;
    payload?: unknown;
  }
) {
  await assertQueueHasCapacity(ctx, args.playerId);
  const now = Date.now();
  const activeTask = await getActiveTask(ctx, args.playerId);
  const status = activeTask ? "queued" : "active";
  const taskId = await ctx.db.insert("playerTasks", {
    playerId: args.playerId,
    taskType: args.taskType,
    definitionId: args.definition.taskId,
    displayName: args.displayName,
    status,
    queueOrder: await getNextQueueOrder(ctx, args.playerId),
    canProgressOffline:
      args.taskType === "timed" &&
      args.definition.canProgressOffline &&
      !args.definition.requiresOnline,
    requiresOnline: args.definition.requiresOnline,
    ...(args.durationMs === undefined ? {} : { durationMs: args.durationMs }),
    progressMs: 0,
    ...(args.battleMode === undefined
      ? {}
      : { battleMode: args.battleMode }),
    ...(args.targetBattles === undefined
      ? {}
      : { targetBattles: args.targetBattles }),
    ...(args.targetDurationMs === undefined
      ? {}
      : { targetDurationMs: args.targetDurationMs }),
    completedBattles: 0,
    totalGoldEarned: 0,
    totalExperienceEarned: 0,
    lootSummary: [],
    ...(args.tier === undefined ? {} : { tier: args.tier }),
    onlineCreditMs: 0,
    lastResolvedAt: now,
    lastHeartbeatAt: now,
    ...(status === "active" ? { startedAt: now } : {}),
    offlineCapped: false,
    ...(args.payload === undefined ? {} : { payload: args.payload }),
    createdAt: now,
    updatedAt: now,
  });
  return await ctx.db.get(taskId);
}

async function completeTask(
  ctx: MutationCtx,
  task: PlayerTask,
  status: "completed" | "cancelled" | "failed",
  now: number,
  result?: unknown
) {
  const completionKey = `${task._id}:${status}`;
  const existing = await ctx.db
    .query("taskHistory")
    .withIndex("by_completionKey", (q) => q.eq("completionKey", completionKey))
    .first();
  if (existing) {
    return existing;
  }

  const historyId = await ctx.db.insert("taskHistory", {
    playerId: task.playerId,
    taskId: task._id,
    definitionId: task.definitionId,
    displayName: task.displayName,
    taskType: task.taskType,
    status,
    completionKey,
    ...(task.durationMs === undefined ? {} : { durationMs: task.durationMs }),
    progressMs: task.progressMs,
    completedBattles: task.completedBattles,
    ...(task.totalGoldEarned === undefined
      ? {}
      : { totalGoldEarned: task.totalGoldEarned }),
    ...(task.totalExperienceEarned === undefined
      ? {}
      : { totalExperienceEarned: task.totalExperienceEarned }),
    ...(task.lootSummary === undefined
      ? {}
      : { lootSummary: task.lootSummary }),
    ...(task.tier === undefined ? {} : { tier: task.tier }),
    ...(result === undefined ? {} : { result }),
    createdAt: task.createdAt,
    completedAt: now,
  });
  await ctx.db.delete(task._id);
  return await ctx.db.get(historyId);
}

async function recordDefeatedMonster(
  ctx: MutationCtx,
  task: PlayerTask,
  result: {
    monsterType: string;
    monsterName: string;
  },
  now: number
) {
  const existing = await ctx.db
    .query("taskBattleStats")
    .withIndex("by_taskId_and_monsterType", (q) =>
      q.eq("taskId", task._id).eq("monsterType", result.monsterType)
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      monsterName: result.monsterName,
      defeatedCount: existing.defeatedCount + 1,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.insert("taskBattleStats", {
    playerId: task.playerId,
    taskId: task._id,
    monsterType: result.monsterType,
    monsterName: result.monsterName,
    defeatedCount: 1,
    createdAt: now,
    updatedAt: now,
  });
}

async function resolveTimedQueue(
  ctx: MutationCtx,
  playerId: PlayerId,
  now: number,
  resetBattleHeartbeat: boolean,
  onlineHeartbeat: boolean
) {
  let activeTask = await getActiveTask(ctx, playerId);
  if (!activeTask) {
    activeTask = await activateNextTask(ctx, playerId, now);
  }
  if (!activeTask) return null;

  if (activeTask.taskType === "battle") {
    if (resetBattleHeartbeat) {
      await ctx.db.patch(activeTask._id, {
        lastHeartbeatAt: now,
        updatedAt: now,
      });
      return await ctx.db.get(activeTask._id);
    }
    return activeTask;
  }

  const offlineWindowMs = await getOfflineTaskWindow(ctx);
  const heartbeatGraceMs = await getHeartbeatGrace(ctx);
  const elapsedMs = Math.max(0, now - activeTask.lastResolvedAt);
  const onlineProgressAvailable =
    onlineHeartbeat && elapsedMs <= heartbeatGraceMs;
  const availableMs = activeTask.canProgressOffline
    ? Math.min(elapsedMs, offlineWindowMs)
    : onlineProgressAvailable
      ? elapsedMs
      : 0;
  const timeSegments = [
    ...(isRecord(activeTask.payload) &&
    activeTask.payload.skillTaskVersion === 1
      ? readProgressSegments(activeTask.payload.progressSegments)
      : []),
    ...(availableMs > 0
      ? [{ startAt: activeTask.lastResolvedAt, remainingMs: availableMs }]
      : []),
  ];
  let segmentIndex = 0;
  let currentTask: PlayerTask | null = activeTask;
  let isFirstTask = true;

  while (currentTask && currentTask.taskType === "timed") {
    const durationMs = currentTask.durationMs;
    if (
      durationMs === undefined ||
      !Number.isSafeInteger(durationMs) ||
      durationMs < 1
    ) {
      await completeTask(ctx, currentTask, "failed", now, {
        reason: "Invalid timed task duration",
      });
      currentTask = await activateNextTask(ctx, playerId, now);
      isFirstTask = false;
      continue;
    }

    const wasOfflineCapped =
      isFirstTask &&
      currentTask.canProgressOffline &&
      elapsedMs > availableMs;
    if (
      !currentTask.canProgressOffline &&
      !onlineProgressAvailable &&
      timeSegments.length === 0
    ) {
      const payload = isRecord(currentTask.payload)
        ? { ...currentTask.payload }
        : currentTask.payload;
      if (isRecord(payload)) delete payload.progressSegments;
      await ctx.db.patch(currentTask._id, {
        ...(isRecord(payload) ? { payload } : {}),
        lastResolvedAt: now,
        offlineCapped: wasOfflineCapped,
        updatedAt: now,
      });
      return await ctx.db.get(currentTask._id);
    }

    if (
      isRecord(currentTask.payload) &&
      currentTask.payload.skillTaskVersion === 1
    ) {
      let skillTask = currentTask;
      while (
        currentTask &&
        currentTask.taskType === "timed" &&
        isRecord(currentTask.payload) &&
        currentTask.payload.skillTaskVersion === 1 &&
        segmentIndex < timeSegments.length
      ) {
        const segment = timeSegments[segmentIndex];
        const result = await advanceSkillActionTask(
          ctx,
          skillTask,
          segment.remainingMs,
          segment.startAt,
          now
        );
        segment.remainingMs -= result.consumedMs;
        segment.startAt += result.consumedMs;
        const nextPayload = { ...result.payload };
        delete nextPayload.progressSegments;
        const resolvedTask = {
          ...skillTask,
          durationMs: result.durationMs,
          progressMs: result.progressMs,
          payload: nextPayload,
          offlineCapped: wasOfflineCapped,
        };

        if (result.failureReason) {
          const refundedIngredients = await refundSkillTaskReservation(
            ctx,
            resolvedTask
          );
          await completeTask(ctx, resolvedTask, "failed", now, {
            reason: result.failureReason,
            ...(refundedIngredients === null
              ? {}
              : { refundedIngredients }),
          });
          const nextStartAt =
            segment.remainingMs > 0
              ? segment.startAt
              : timeSegments[segmentIndex + 1]?.startAt ?? now;
          currentTask = await activateNextTask(
            ctx,
            playerId,
            now,
            nextStartAt
          );
          isFirstTask = false;
          if (segment.remainingMs === 0) segmentIndex += 1;
          break;
        }

        if (result.complete) {
          await completeTask(ctx, resolvedTask, "completed", now, {
            progressMs: result.progressMs,
            offlineCapped: wasOfflineCapped,
            ...(result.skillResult === undefined
              ? {}
              : { skillResult: result.skillResult }),
          });
          const nextStartAt =
            segment.remainingMs > 0
              ? segment.startAt
              : timeSegments[segmentIndex + 1]?.startAt ?? now;
          currentTask = await activateNextTask(
            ctx,
            playerId,
            now,
            nextStartAt
          );
          isFirstTask = false;
          if (segment.remainingMs === 0) segmentIndex += 1;
          break;
        }

        if (result.deferred) {
          const deferredSegments = [
            ...(segment.remainingMs > 0 ? [segment] : []),
            ...timeSegments.slice(segmentIndex + 1),
          ].filter((pending) => pending.remainingMs > 0);
          await ctx.db.patch(skillTask._id, {
            durationMs: result.durationMs,
            progressMs: result.progressMs,
            payload: {
              ...nextPayload,
              progressSegments: deferredSegments,
            },
            lastResolvedAt: now,
            offlineCapped: wasOfflineCapped,
            updatedAt: now,
          });
          return await ctx.db.get(skillTask._id);
        }

        skillTask = resolvedTask;
        currentTask = resolvedTask;
        if (segment.remainingMs === 0) {
          segmentIndex += 1;
        }
      }

      if (
        currentTask &&
        currentTask.taskType === "timed" &&
        isRecord(currentTask.payload) &&
        currentTask.payload.skillTaskVersion === 1 &&
        segmentIndex >= timeSegments.length
      ) {
        const payload = { ...currentTask.payload };
        delete payload.progressSegments;
        // Persist consumed time: without progressMs the task's progress
        // resets to its enqueue value on every resolve, so duration-based
        // gathering tasks never finish and their countdown appears to refill.
        await ctx.db.patch(currentTask._id, {
          payload,
          progressMs: currentTask.progressMs,
          durationMs: currentTask.durationMs,
          lastResolvedAt: now,
          offlineCapped: wasOfflineCapped,
          updatedAt: now,
        });
        return await ctx.db.get(currentTask._id);
      }
      if (currentTask?.taskType === "battle") break;
      continue;
    }

    while (
      currentTask &&
      currentTask.taskType === "timed" &&
      segmentIndex < timeSegments.length
    ) {
      const segment = timeSegments[segmentIndex];
      const remainingMs = Math.max(0, durationMs - currentTask.progressMs);
      const appliedMs = Math.min(remainingMs, segment.remainingMs);
      const nextProgressMs: number = currentTask.progressMs + appliedMs;
      segment.remainingMs -= appliedMs;
      segment.startAt += appliedMs;

      if (nextProgressMs >= durationMs) {
        const skillResult =
          currentTask.payload &&
          isRecord(currentTask.payload) &&
          (currentTask.payload.actionType === "gathering" ||
            currentTask.payload.actionType === "crafting")
            ? await resolveSkillTask(ctx, currentTask, now)
            : undefined;
        const resolvedTask = {
          ...currentTask,
          progressMs: durationMs,
          offlineCapped: wasOfflineCapped,
        };
        await completeTask(ctx, resolvedTask, "completed", now, {
          progressMs: durationMs,
          offlineCapped: wasOfflineCapped,
          ...(skillResult === undefined ? {} : { skillResult }),
        });
        const nextStartAt =
          segment.remainingMs > 0
            ? segment.startAt
            : timeSegments[segmentIndex + 1]?.startAt ?? now;
        currentTask = await activateNextTask(
          ctx,
          playerId,
          now,
          nextStartAt
        );
        isFirstTask = false;
        if (segment.remainingMs === 0) segmentIndex += 1;
        break;
      }

      currentTask = {
        ...currentTask,
        progressMs: nextProgressMs,
      };
      if (segment.remainingMs > 0) {
        throw new Error("Timed task progress did not consume its available segment");
      }
      segmentIndex += 1;
      if (segmentIndex >= timeSegments.length) {
        await ctx.db.patch(currentTask._id, {
          progressMs: nextProgressMs,
          lastResolvedAt: now,
          offlineCapped: wasOfflineCapped,
          updatedAt: now,
        });
        return await ctx.db.get(currentTask._id);
      }
    }

    if (currentTask?.taskType === "battle") break;
    if (segmentIndex >= timeSegments.length) {
      if (currentTask && currentTask.taskType === "timed") {
        await ctx.db.patch(currentTask._id, {
          lastResolvedAt: now,
          offlineCapped: wasOfflineCapped,
          updatedAt: now,
        });
        return await ctx.db.get(currentTask._id);
      }
      return currentTask;
    }
  }

  return currentTask;
}

async function processAutoBattle(
  ctx: MutationCtx,
  playerId: PlayerId,
  now: number
) {
  const task = await getActiveTask(ctx, playerId);
  if (!task || task.taskType !== "battle") return task;

  const respawnUntil =
    typeof task.respawnUntil === "number" ? task.respawnUntil : undefined;
  if (respawnUntil !== undefined && now < respawnUntil) {
    return task;
  }

  const player = await getPlayer(ctx, playerId);
  const equipmentBonuses = await getEquippedStatBonuses(ctx, playerId);
  const heartbeatGraceMs = await getHeartbeatGrace(ctx);
  const elapsedSinceHeartbeat = Math.max(
    0,
    now - Math.max(task.lastHeartbeatAt, respawnUntil ?? 0)
  );
  const onlineDeltaMs =
    elapsedSinceHeartbeat <= heartbeatGraceMs ? elapsedSinceHeartbeat : 0;
  const autoBattleCreditCapMs = await getAutoBattleCreditCap(ctx);
  const autoBattleRespawnMs = await getAutoBattleRespawnMs(ctx);
  let onlineCreditMs = Math.min(
    autoBattleCreditCapMs,
    task.onlineCreditMs + onlineDeltaMs
  );
  let progressMs = task.progressMs;
  let completedBattles = task.completedBattles;
  let totalGoldEarned = task.totalGoldEarned ?? 0;
  let totalExperienceEarned = task.totalExperienceEarned ?? 0;
  const lootSummary = readLootSummary(task.lootSummary);
  let currentMonsterName = task.currentMonsterName;
  let currentMonsterType = task.currentMonsterType;
  let currentMonsterHealth = task.currentMonsterHealth;
  let currentMonsterMaxHealth = task.currentMonsterMaxHealth;
  let currentPlayerHealth = task.currentPlayerHealth;
  let currentPlayerMaxHealth = task.currentPlayerMaxHealth;
  let nextRespawnUntil: number | undefined;
  let wins = 0;
  let losses = 0;
  const batchLimit = await getAutoBattleBatchLimit(ctx);
  const tier = task.tier;

  if (tier === undefined) {
    await completeTask(ctx, task, "failed", now, {
      reason: "Auto-battle task has no tier",
    });
    return await activateNextTask(ctx, playerId, now);
  }

  let completed = false;
  for (let attempt = 0; attempt < batchLimit; attempt += 1) {
    if (
      task.battleMode === "count" &&
      task.targetBattles !== undefined &&
      completedBattles >= task.targetBattles
    ) {
      completed = true;
      break;
    }
    if (
      task.battleMode === "duration" &&
      task.targetDurationMs !== undefined &&
      progressMs >= task.targetDurationMs
    ) {
      completed = true;
      break;
    }

    const result = await simulateRegularBattle(
      ctx,
      player,
      tier,
      equipmentBonuses
    );
    currentMonsterName = result.monsterName;
    currentMonsterType = result.monsterType;
    const durationToConsume =
      task.battleMode === "duration" && task.targetDurationMs !== undefined
        ? Math.min(
            result.durationMs,
            Math.max(1, task.targetDurationMs - progressMs)
          )
        : result.durationMs;
    const healthSnapshot = projectBattleHealth(
      result,
      Math.min(onlineCreditMs, durationToConsume)
    );
    currentMonsterHealth = healthSnapshot.currentMonsterHealth;
    currentMonsterMaxHealth = healthSnapshot.currentMonsterMaxHealth;
    currentPlayerHealth = healthSnapshot.currentPlayerHealth;
    currentPlayerMaxHealth = healthSnapshot.currentPlayerMaxHealth;
    if (onlineCreditMs < durationToConsume) {
      break;
    }

    onlineCreditMs -= durationToConsume;
    progressMs += durationToConsume;
    completedBattles += 1;
    if (result.won) {
      wins += 1;
      await recordDefeatedMonster(ctx, task, result, now);
    } else {
      losses += 1;
    }

    const settlement = await settleRegularFight(ctx, {
      playerId,
      monsterTier: result.monsterTier,
      monsterType: result.monsterType,
      won: result.won,
      settlementKey: `${task._id}:${completedBattles}`,
      goldEarned: result.goldEarned,
      experienceEarned: result.experienceEarned,
    });
    totalGoldEarned += settlement.goldEarned;
    totalExperienceEarned += settlement.experienceEarned;
    mergeLootSummary(lootSummary, settlement.loot);

    if (
      task.battleMode === "count" &&
      task.targetBattles !== undefined &&
      completedBattles >= task.targetBattles
    ) {
      completed = true;
      break;
    }
    if (
      task.battleMode === "duration" &&
      task.targetDurationMs !== undefined &&
      progressMs >= task.targetDurationMs
    ) {
      completed = true;
      break;
    }
    if (!result.won && autoBattleRespawnMs > 0) {
      nextRespawnUntil = now + autoBattleRespawnMs;
      break;
    }
  }

  if (completed) {
    const resolvedTask = {
      ...task,
      progressMs,
      completedBattles,
      onlineCreditMs,
      ...(currentMonsterName === undefined ? {} : { currentMonsterName }),
      ...(currentMonsterType === undefined ? {} : { currentMonsterType }),
      ...(currentMonsterHealth === undefined
        ? {}
        : { currentMonsterHealth }),
      ...(currentMonsterMaxHealth === undefined
        ? {}
        : { currentMonsterMaxHealth }),
      ...(currentPlayerHealth === undefined
        ? {}
        : { currentPlayerHealth }),
      ...(currentPlayerMaxHealth === undefined
        ? {}
        : { currentPlayerMaxHealth }),
      totalGoldEarned,
      totalExperienceEarned,
      lootSummary,
    };
    await completeTask(ctx, {
      ...resolvedTask,
    }, "completed", now, {
      battles: completedBattles,
      wins,
      losses,
      goldEarned: totalGoldEarned,
      experienceEarned: totalExperienceEarned,
    });
    return await activateNextTask(ctx, playerId, now);
  }

  await ctx.db.patch(task._id, {
    progressMs,
    completedBattles,
    onlineCreditMs,
    ...(currentMonsterName === undefined ? {} : { currentMonsterName }),
    ...(currentMonsterType === undefined ? {} : { currentMonsterType }),
    ...(currentMonsterHealth === undefined
      ? {}
      : { currentMonsterHealth }),
    ...(currentMonsterMaxHealth === undefined
      ? {}
      : { currentMonsterMaxHealth }),
    ...(currentPlayerHealth === undefined
      ? {}
      : { currentPlayerHealth }),
    ...(currentPlayerMaxHealth === undefined
      ? {}
      : { currentPlayerMaxHealth }),
    totalGoldEarned,
    totalExperienceEarned,
    lootSummary,
    respawnUntil: nextRespawnUntil,
    lastHeartbeatAt: now,
    updatedAt: now,
  });
  return await ctx.db.get(task._id);
}

type ProgressSegment = {
  startAt: number;
  remainingMs: number;
};

function readProgressSegments(value: unknown): ProgressSegment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("Skill task has invalid deferred progress");
  }
  return value.map((segment) => {
    if (
      !isRecord(segment) ||
      typeof segment.startAt !== "number" ||
      !Number.isFinite(segment.startAt) ||
      typeof segment.remainingMs !== "number" ||
      !Number.isSafeInteger(segment.remainingMs) ||
      segment.remainingMs < 1
    ) {
      throw new Error("Skill task has invalid deferred progress");
    }
    return {
      startAt: segment.startAt,
      remainingMs: segment.remainingMs,
    };
  });
}

function getDeferredProgressMs(task: PlayerTask) {
  if (
    !isRecord(task.payload) ||
    task.payload.skillTaskVersion !== 1
  ) {
    return 0;
  }
  return readProgressSegments(task.payload.progressSegments).reduce(
    (total, segment) =>
      Math.min(Number.MAX_SAFE_INTEGER, total + segment.remainingMs),
    0
  );
}

function projectTimedProgress(
  task: PlayerTask,
  now: number,
  offlineWindowMs: number
) {
  const elapsedMs =
    task.taskType === "timed" &&
    task.status === "active" &&
    task.canProgressOffline
      ? Math.max(0, now - task.lastResolvedAt)
      : 0;
  return task.taskType === "timed"
    ? Math.min(
        task.durationMs ?? task.progressMs,
      task.progressMs +
        getDeferredProgressMs(task) +
        Math.min(elapsedMs, offlineWindowMs)
    )
    : task.progressMs;
}

function calculateOfflineWorkAheadMs(
  tasks: Array<PlayerTask | null>,
  now: number,
  offlineWindowMs: number
) {
  return tasks.reduce((total, task) => {
    if (
      !task ||
      task.taskType !== "timed" ||
      !task.canProgressOffline ||
      task.durationMs === undefined ||
      !Number.isSafeInteger(task.durationMs) ||
      task.durationMs < 1
    ) {
      return total;
    }
    const projectedProgress =
      task.status === "active"
        ? projectTimedProgress(task, now, offlineWindowMs)
        : task.progressMs;
    return Math.min(
      Number.MAX_SAFE_INTEGER,
      total + Math.max(0, task.durationMs - projectedProgress)
    );
  }, 0);
}

async function getQueueSnapshot(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  now: number
) {
  const [activeTask, queuedTasks, history, capacity, offlineWindowMs] =
    await Promise.all([
      getActiveTask(ctx, playerId),
      getQueueCapacity(ctx).then((queueCapacity) =>
        getQueuedTasks(ctx, playerId, queueCapacity)
      ),
      ctx.db
        .query("taskHistory")
        .withIndex("by_playerId_and_completedAt", (q) =>
          q.eq("playerId", playerId)
        )
        .order("desc")
        .take(HISTORY_QUERY_LIMIT),
      getQueueCapacity(ctx),
      getOfflineTaskWindow(ctx),
    ]);

  const offlineWorkAheadMs = calculateOfflineWorkAheadMs(
    [activeTask, ...queuedTasks],
    now,
    offlineWindowMs
  );

  const battleStatsByTaskId = new Map<string, BattleStat[]>();
  const battleTasks = [activeTask, ...queuedTasks].filter(
    (task): task is PlayerTask => task?.taskType === "battle"
  );
  await Promise.all(
    battleTasks.map(async (task) => {
      const stats = await ctx.db
        .query("taskBattleStats")
        .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
        .order("desc")
        .collect();
      battleStatsByTaskId.set(task._id, stats);
    })
  );

  const projectTask = (task: PlayerTask) => {
    const elapsedMs =
      task.taskType === "timed" &&
      task.status === "active" &&
      task.canProgressOffline
        ? Math.max(0, now - task.lastResolvedAt)
        : 0;
    const projectedProgressMs = projectTimedProgress(
      task,
      now,
      offlineWindowMs
    );
    return {
      ...task,
      projectedProgressMs,
      remainingMs:
        task.durationMs === undefined
          ? null
          : Math.max(0, task.durationMs - projectedProgressMs),
      projectedOfflineCapped:
        task.taskType === "timed" &&
        task.status === "active" &&
        elapsedMs > offlineWindowMs,
      ...(task.taskType === "battle"
        ? { battleStats: battleStatsByTaskId.get(task._id) ?? [] }
        : {}),
    };
  };

  return {
    active: activeTask ? projectTask(activeTask) : null,
    queued: queuedTasks.map(projectTask),
    history,
    capacity,
    usedSlots: (activeTask ? 1 : 0) + queuedTasks.length,
    offlineWindowMs,
    offlineWorkAheadMs,
    remainingOfflineWindowMs: Math.max(
      0,
      offlineWindowMs - offlineWorkAheadMs
    ),
    serverTime: now,
  };
}

export const getQueue = query({
  args: {
    playerId: v.id("players"),
    now: v.optional(v.number()),
  },
  handler: async (ctx, { playerId, now }) => {
    await getPlayer(ctx, playerId);
    const snapshotTime = now ?? Date.now();
    if (!Number.isFinite(snapshotTime)) {
      throw new Error("Queue timestamp must be finite");
    }
    return await getQueueSnapshot(ctx, playerId, snapshotTime);
  },
});

export const sync = mutation({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    await getPlayer(ctx, playerId);
    const now = Date.now();
    await resolveTimedQueue(ctx, playerId, now, true, false);
    return await getQueueSnapshot(ctx, playerId, now);
  },
});

export const heartbeat = mutation({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    await getPlayer(ctx, playerId);
    const now = Date.now();
    await resolveTimedQueue(ctx, playerId, now, false, true);
    await processAutoBattle(ctx, playerId, now);
    return await getQueueSnapshot(ctx, playerId, now);
  },
});

export const enqueueTimedTask = mutation({
  args: {
    playerId: v.id("players"),
    definitionId: v.string(),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, { playerId, definitionId, payload }) => {
    const player = await getPlayer(ctx, playerId);
    const definition = await getTaskDefinition(ctx, definitionId);
    if (!definition) {
      throw new Error("Task definition not found");
    }
    validateTimedDefinition(definition);
    await assertTaskPrerequisites(ctx, player, definition);

    return await insertTask(ctx, {
      playerId,
      definition,
      taskType: "timed",
      displayName: definition.name,
      durationMs: definition.durationMs,
      payload,
    });
  },
});

export const enqueueSkillAction = mutation({
  args: {
    playerId: v.id("players"),
    actionType: v.union(
      v.literal("gathering"),
      v.literal("crafting"),
      v.literal("augmentation")
    ),
    actionId: v.string(),
    durationOption: v.optional(
      v.union(
        v.literal("one-hour"),
        v.literal("two-hours"),
        v.literal("fill-remaining")
      )
    ),
    quantity: v.optional(v.number()),
    targetPlayerItemId: v.optional(v.id("playerItems")),
  },
  handler: async (
    ctx,
    {
      playerId,
      actionType,
      actionId,
      durationOption,
      quantity,
      targetPlayerItemId,
    }
  ) => {
    await assertQueueHasCapacity(ctx, playerId);
    const definition = await getTaskDefinition(ctx, "skill_action");
    if (!definition || !definition.enabled) {
      throw new Error("Skill action task definition is not configured");
    }
    if (
      definition.durationMs !== undefined &&
      definition.durationMs < 1
    ) {
      throw new Error("Skill action task definition has an invalid duration");
    }
    let gatheringDurationMs: number | undefined;
    if (actionType === "gathering") {
      if (
        targetPlayerItemId !== undefined ||
        (durationOption === undefined && quantity === undefined) ||
        (durationOption !== undefined && quantity !== undefined)
      ) {
        throw new Error(
          "Gathering tasks require either an action quantity or duration option"
        );
      }
      if (durationOption !== undefined) {
        if (durationOption === "one-hour") {
          gatheringDurationMs = 60 * 60 * 1000;
        } else if (durationOption === "two-hours") {
          gatheringDurationMs = 2 * 60 * 60 * 1000;
        } else {
          const [activeTask, offlineWindowMs, capacity] = await Promise.all([
            getActiveTask(ctx, playerId),
            getOfflineTaskWindow(ctx),
            getQueueCapacity(ctx),
          ]);
          const queuedTasks = await getQueuedTasks(ctx, playerId, capacity);
          const workAheadMs = calculateOfflineWorkAheadMs(
            [activeTask, ...queuedTasks],
            Date.now(),
            offlineWindowMs
          );
          gatheringDurationMs = Math.max(0, offlineWindowMs - workAheadMs);
          if (gatheringDurationMs < 1) {
            throw new Error("No offline queue time remains to fill");
          }
        }
      }
    } else if (actionType === "crafting") {
      if (
        durationOption !== undefined ||
        targetPlayerItemId !== undefined
      ) {
        throw new Error("Crafting tasks only accept a quantity");
      }
    } else if (
      durationOption !== undefined ||
      quantity !== undefined ||
      targetPlayerItemId === undefined
    ) {
      throw new Error("Augmentation tasks require one equipment target only");
    }

    if (actionType === "augmentation" && targetPlayerItemId) {
      const ownedItem = await ctx.db.get(targetPlayerItemId);
      if (
        !ownedItem ||
        ownedItem.playerId !== playerId ||
        ownedItem.quantity !== 1
      ) {
        throw new Error("Equipment item not found");
      }
      const item = await ctx.db.get(ownedItem.itemId);
      if (!item || item.category !== "equipment") {
        throw new Error("Only equipment can be augmented");
      }
      const existingAugments = await ctx.db
        .query("playerItemAugments")
        .withIndex("by_playerItemId", (q) =>
          q.eq("playerItemId", targetPlayerItemId)
        )
        .collect();
      const [activeTask, capacity] = await Promise.all([
        getActiveTask(ctx, playerId),
        getQueueCapacity(ctx),
      ]);
      const queuedTasks = await getQueuedTasks(ctx, playerId, capacity);
      let reservedSlots = 0;
      for (const task of [activeTask, ...queuedTasks]) {
        if (
          !task ||
          !isRecord(task.payload) ||
          task.payload.skillTaskVersion !== 1 ||
          task.payload.actionType !== "augmentation" ||
          task.payload.targetPlayerItemId !== targetPlayerItemId
        ) {
          continue;
        }
        if (task.payload.actionId === actionId) {
          throw new Error("That augmentation is already queued for this item");
        }
        reservedSlots += 1;
      }
      if (existingAugments.length + reservedSlots >= (item.augmentSlots ?? 1)) {
        throw new Error("That equipment has no open augmentation slots");
      }
    }

    const prepared = await prepareSkillAction(
      ctx,
      playerId,
      actionType,
      actionId,
      {
        ...(quantity === undefined ? {} : { quantity }),
        ...(targetPlayerItemId === undefined
          ? {}
          : { playerItemId: targetPlayerItemId }),
      }
    );
    const durationMs =
      actionType === "gathering" && gatheringDurationMs !== undefined
        ? gatheringDurationMs
        : prepared.baseDurationMs * (prepared.quantity ?? 1);
    if (
      durationMs === undefined ||
      !Number.isSafeInteger(durationMs) ||
      durationMs < 1
    ) {
      throw new Error("Skill task has an invalid estimated duration");
    }

    return await insertTask(ctx, {
      playerId,
      definition,
      taskType: "timed",
      displayName: prepared.displayName,
      durationMs,
      payload: {
        skillTaskVersion: 1,
        actionType: prepared.actionType,
        actionId: prepared.actionId,
        skillId: prepared.skillId,
        skillCategory: prepared.skillCategory,
        baseExperienceReward: prepared.baseExperienceReward,
        completedActions: 0,
        totalExperienceEarned: 0,
        ...(prepared.actionType === "gathering" &&
        gatheringDurationMs !== undefined
          ? {}
          : { targetActionCount: prepared.quantity }),
        ...("reservedIngredients" in prepared
          ? { reservedIngredients: prepared.reservedIngredients }
          : {}),
        ...("recipeSnapshot" in prepared
          ? { recipeSnapshot: prepared.recipeSnapshot }
          : {}),
        ...("targetPlayerItemId" in prepared
          ? { targetPlayerItemId: prepared.targetPlayerItemId }
          : {}),
        skillActionSnapshot: prepared.skillActionSnapshot,
      },
    });
  },
});

export const enqueueAutoBattle = mutation({
  args: {
    playerId: v.id("players"),
    tier: v.number(),
    mode: v.union(
      v.literal("count"),
      v.literal("duration"),
      v.literal("until-stopped")
    ),
    targetBattles: v.optional(v.number()),
    targetDurationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await validateAutoBattleRequest(
      ctx,
      args.playerId,
      args.tier,
      args.mode,
      args.targetBattles,
      args.targetDurationMs
    );
    const definition = await getTaskDefinition(ctx, "auto_battle");
    if (!definition || !definition.enabled) {
      throw new Error("Auto-battle task definition is not configured");
    }

    return await insertTask(ctx, {
      playerId: args.playerId,
      definition,
      taskType: "battle",
      displayName: `Auto-battle · Tier ${args.tier}`,
      battleMode: args.mode,
      targetBattles: args.targetBattles,
      targetDurationMs: args.targetDurationMs,
      tier: args.tier,
    });
  },
});

export const cancel = mutation({
  args: {
    playerId: v.id("players"),
    taskId: v.id("playerTasks"),
  },
  handler: async (ctx, { playerId, taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task || task.playerId !== playerId) {
      throw new Error("Task not found");
    }

    const now = Date.now();
    const activeTask = await getActiveTask(ctx, playerId);
    if (activeTask?._id === task._id && task.taskType === "timed") {
      await resolveTimedQueue(ctx, playerId, now, false, true);
    }

    const currentTask = await ctx.db.get(taskId);
    if (!currentTask) {
      return { cancelled: true };
    }
    const refundedIngredients = await refundSkillTaskReservation(
      ctx,
      currentTask
    );
    await completeTask(
      ctx,
      currentTask,
      "cancelled",
      now,
      refundedIngredients === null
        ? undefined
        : { refundedIngredients }
    );
    if (activeTask?._id === taskId) {
      await activateNextTask(ctx, playerId, now);
    }
    return { cancelled: true };
  },
});
