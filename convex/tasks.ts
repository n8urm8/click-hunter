import { readBalanceMap, readBalanceValue } from "./balance";
import { internalMutation, mutation, query } from "./_generated/server";
import { requirePlayer, requirePlayerOwner } from "./playerAuth";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { calculateCharacterLevel } from "./characterLevel";
import {
  loadBattleContext,
  readPlayerCombatProfile,
  rollEncounter,
  type BattleContext,
} from "./combat";
import { resolveCurrentHp, readHpRegenBalance, writePlayerHp } from "./playerHp";
import { tickEquippedConsumables } from "./consumableSlots";
import { settleAutoBattleBatch, type BatchFight, type LootSummary } from "./loot";
import { getEquippedProfile } from "./items";
import {
  combatZoneValidator,
  isCombatZone,
  type CombatZone,
} from "./zones";
import {
  advanceSkillActionTask,
  prepareSkillAction,
  refundSkillTaskReservation,
  resolveSkillTask,
} from "./skills";
import { projectBattleHealth, readTaskSyncSettings } from "./taskTiming";
import { readNextSkillModifierChangeAt } from "./skillBonuses";

export const DEFAULT_TASK_QUEUE_CAPACITY = 5;
export const DEFAULT_OFFLINE_TASK_WINDOW_MS = 4 * 60 * 60 * 1000;
// Long enough to outlast browsers throttling background tabs to one timer a
// minute, so a hidden tab keeps hunting.
export const DEFAULT_TASK_HEARTBEAT_GRACE_MS = 90 * 1000;
export const DEFAULT_AUTO_BATTLE_BATCH_LIMIT = 50;
export const DEFAULT_AUTO_BATTLE_CREDIT_CAP_MS = 5 * 60 * 1000;
/** Below this fraction of max HP, a hunter rests instead of starting a fight. */
export const DEFAULT_AUTO_REST_BELOW_PERCENT = 0.5;
export const DEFAULT_AUTO_REST_UNTIL_PERCENT = 0.9;
export const DEFAULT_AUTO_BATTLE_RESPAWN_MS = 5 * 1000;

const MAX_AUTO_BATTLE_TARGET_BATTLES = 10_000;
const MAX_AUTO_BATTLE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_AUTO_BATTLE_BATCH_LIMIT = 100;
const HISTORY_QUERY_LIMIT = 10;

type DatabaseCtx = QueryCtx | MutationCtx;
type PlayerId = Id<"players">;
type PlayerTask = Doc<"playerTasks">;
type BattleStat = Doc<"taskBattleStats">;

async function getBalanceValue(ctx: DatabaseCtx, key: string) {
  return await readBalanceValue(ctx, key);
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
  const value = await getBalanceValue(ctx, "taskHeartbeatGraceMs");
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1_500
    ? value
    : DEFAULT_TASK_HEARTBEAT_GRACE_MS;
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

async function readAutoRestSettings(ctx: DatabaseCtx) {
  const values = await readBalanceMap(ctx, ["autoRestBelowPercent", "autoRestUntilPercent"]);
  const fraction = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : fallback;
  const below = fraction(values.get("autoRestBelowPercent"), DEFAULT_AUTO_REST_BELOW_PERCENT);
  return {
    below,
    until: Math.max(below, fraction(values.get("autoRestUntilPercent"), DEFAULT_AUTO_REST_UNTIL_PERCENT)),
  };
}

async function getPlayer(ctx: DatabaseCtx, playerId: PlayerId) {
  return await requirePlayer(ctx, playerId);
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

async function getPresence(ctx: DatabaseCtx, playerId: PlayerId) {
  return await ctx.db.query("taskPresence")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId)).unique();
}

async function startTaskPresence(ctx: MutationCtx, task: PlayerTask, now: number) {
  if (task.taskType !== "battle" && task.canProgressOffline) return;
  const presence = await getPresence(ctx, task.playerId);
  if (presence) {
    // Same-ms duplicate sync/heartbeat: skip the redundant write so repeated
    // calls don't pay write I/O or invalidate subscribers.
    if (presence.taskId === task._id &&
      presence.segmentStartedAt === now &&
      presence.lastSeenAt === now) {
      return;
    }
    await ctx.db.patch(presence._id, { taskId: task._id, segmentStartedAt: now, lastSeenAt: now });
  } else {
    await ctx.db.insert("taskPresence", { playerId: task.playerId, taskId: task._id, segmentStartedAt: now, lastSeenAt: now });
  }
}

async function consumeOnlineProgress(
  ctx: MutationCtx,
  task: PlayerTask,
  now: number
): Promise<ProgressSegment[]> {
  if (task.taskType !== "battle" && task.canProgressOffline) return [];
  const presence = await getPresence(ctx, task.playerId);
  const graceMs = await getHeartbeatGrace(ctx);
  // Older tasks have no isolated presence record. Credit only their last
  // short, confirmed interval, then switch to the new clock.
  const startAt = presence?.taskId === task._id
    ? presence.segmentStartedAt
    : task.taskType === "battle" ? task.lastHeartbeatAt : task.lastResolvedAt;
  const lastSeenAt = presence?.taskId === task._id
    ? presence.lastSeenAt
    : startAt;
  const endAt = now - lastSeenAt <= graceMs ? now : lastSeenAt;
  await startTaskPresence(ctx, task, now);
  const progressStartAt = Math.max(startAt, task.respawnUntil ?? startAt);
  return endAt > progressStartAt
    ? [{ startAt: progressStartAt, remainingMs: endAt - progressStartAt }]
    : [];
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
  const activated = await ctx.db.get(nextTask._id);
  if (activated) await startTaskPresence(ctx, activated, now);
  return activated;
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
      (entry.purpose === "augmentation" || entry.purpose === "boss-catalyst") &&
      (entry.itemSlug === undefined || typeof entry.itemSlug === "string") &&
      (entry.itemFamily === undefined || typeof entry.itemFamily === "string") &&
      (entry.category === undefined || typeof entry.category === "string")
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

async function validateAutoBattleRequest(
  ctx: MutationCtx,
  playerId: PlayerId,
  tier: number,
  mode: "count" | "duration" | "until-stopped",
  targetBattles: number | undefined,
  targetDurationMs: number | undefined,
  zone?: CombatZone
) {
  // Battle automation is available to everyone, no unlock required.
  // Any tier up to the content cap can be battled at any character level.
  await requirePlayerOwner(ctx, playerId);
  if (!Number.isSafeInteger(tier) || tier < 1) {
    throw new Error("Battle tier must be a positive integer");
  }
  if (zone !== undefined && !isCombatZone(zone)) {
    throw new Error("Battle zone must be easy, medium, or hard");
  }

  const maxTier = readIntegerBalance(
    await getBalanceValue(ctx, "maxTier"),
    20,
    1
  );
  if (tier > maxTier) {
    throw new Error("That battle tier does not exist yet");
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
    zone?: CombatZone;
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
    ...(args.zone === undefined ? {} : { zone: args.zone }),
    onlineCreditMs: 0,
    lastResolvedAt: now,
    lastHeartbeatAt: now,
    ...(status === "active" ? { startedAt: now } : {}),
    offlineCapped: false,
    ...(args.payload === undefined ? {} : { payload: args.payload }),
    createdAt: now,
    updatedAt: now,
  });
  const task = await ctx.db.get(taskId);
  if (task?.status === "active") await startTaskPresence(ctx, task, now);
  return task;
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
    ...(task.zone === undefined ? {} : { zone: task.zone }),
    ...(result === undefined ? {} : { result }),
    createdAt: task.createdAt,
    completedAt: now,
  });
  await ctx.db.delete(task._id);
  if (task.taskType === "battle" || !task.canProgressOffline) {
    const presence = await getPresence(ctx, task.playerId);
    if (presence?.taskId === task._id) await ctx.db.delete(presence._id);
  }
  return await ctx.db.get(historyId);
}

async function recordDefeatedMonster(
  ctx: MutationCtx,
  task: PlayerTask,
  result: {
    monsterType: string;
    monsterName: string;
    count: number;
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
      defeatedCount: existing.defeatedCount + result.count,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.insert("taskBattleStats", {
    playerId: task.playerId,
    taskId: task._id,
    monsterType: result.monsterType,
    monsterName: result.monsterName,
    defeatedCount: result.count,
    createdAt: now,
    updatedAt: now,
  });
}

async function resolveTimedQueue(
  ctx: MutationCtx,
  playerId: PlayerId,
  now: number,
  onlineSegments: ProgressSegment[] = []
) {
  let activeTask = await getActiveTask(ctx, playerId);
  if (!activeTask) {
    activeTask = await activateNextTask(ctx, playerId, now);
  }
  if (!activeTask) return null;

  if (activeTask.taskType === "battle") {
    return activeTask;
  }

  const offlineWindowMs = await getOfflineTaskWindow(ctx);
  const elapsedMs = Math.max(0, now - activeTask.lastResolvedAt);
  const onlineProgressAvailable = onlineSegments.length > 0;
  const availableMs = activeTask.canProgressOffline
    ? Math.min(elapsedMs, offlineWindowMs)
    : onlineSegments.reduce((total, segment) => total + segment.remainingMs, 0);
  const timeSegments = [
    ...(isRecord(activeTask.payload) &&
    activeTask.payload.skillTaskVersion === 1
      ? readProgressSegments(activeTask.payload.progressSegments)
      : []),
    ...(activeTask.canProgressOffline && availableMs > 0
      ? [{ startAt: activeTask.lastResolvedAt, remainingMs: availableMs }]
      : onlineSegments),
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
      (activeTask.canProgressOffline ||
        (!onlineProgressAvailable && getDeferredProgressMs(currentTask) === 0))
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
      // Auto-use equipped skilling consumables matching this task's category.
      const rawCategory = (currentTask.payload as Record<string, unknown>).skillCategory;
      const skillCategory = rawCategory === "crafting" ? "crafting" as const : "gathering" as const;
      await tickEquippedConsumables(ctx, playerId, { kind: "skill", skillCategory }, now);
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
  task: PlayerTask,
  now: number,
  onlineSegments: ProgressSegment[]
) {
  const playerId = task.playerId;
  // Auto-use equipped combat consumables whose buff expired, before the profile
  // read so a buff that starts now counts for this batch.
  const resting = task.respawnUntil !== undefined && now < task.respawnUntil;
  if (!resting && task.tier !== undefined) {
    await tickEquippedConsumables(ctx, playerId, { kind: "battle" }, now);
  }
  // One HP/combat-profile read per settlement: it serves the respawn-wait path
  // below, the fight loop, and the encounter that gets rolled for the next one.
  const hpPlayer = await getPlayer(ctx, playerId);
  const hpProfile = await readPlayerCombatProfile(ctx, hpPlayer, { now });
  const hpMax = Math.max(1, Math.ceil(hpProfile.combatStats.health));
  const regenBalance = await readHpRegenBalance(ctx);
  if (task.respawnUntil !== undefined && now < task.respawnUntil) {
    // Resting through a respawn wait: wall-clock CON regen applies.
    const rested = resolveCurrentHp(
      hpPlayer,
      hpMax,
      hpProfile.effectiveStats.con,
      regenBalance,
      now,
      false
    );
    await writePlayerHp(ctx, playerId, rested.currentHp, rested.maxHp, now);
    return task;
  }
  const onlineDeltaMs = onlineSegments.reduce(
    (total, segment) => total + segment.remainingMs, 0
  );
  const autoBattleCreditCapMs = await getAutoBattleCreditCap(ctx);
  const autoBattleRespawnMs = await getAutoBattleRespawnMs(ctx);
  let onlineCreditMs = Math.min(
    Math.max(autoBattleCreditCapMs, task.battleEncounter?.durationMs ?? 0),
    task.onlineCreditMs + onlineDeltaMs
  );
  let progressMs = task.progressMs;
  let completedBattles = task.completedBattles;
  let totalGoldEarned = task.totalGoldEarned ?? 0;
  let totalExperienceEarned = task.totalExperienceEarned ?? 0;
  const lootSummary = readLootSummary(task.lootSummary);
  let encounter = task.battleEncounter;
  let nextRespawnUntil: number | undefined;
  let wins = 0;
  let losses = 0;
  const batchLimit = await getAutoBattleBatchLimit(ctx);
  const autoRest = await readAutoRestSettings(ctx);
  const tier = task.tier;

  if (tier === undefined) {
    await completeTask(ctx, task, "failed", now, {
      reason: "Auto-battle task has no tier",
    });
    return await activateNextTask(ctx, playerId, now);
  }

  // Resolve persistent HP without wall-clock healing while actively
  // fighting: recovery comes from in-fight CON healing (applied in each sim
  // and its live projection) so chain-farming can't double-dip wall regen per
  // heartbeat. Coming
  // out of a respawn wait counts as rested (the wait just ended); idle
  // recovery also applies when no battle is running or this tick settles no
  // fights (below).
  const justRespawned = task.respawnUntil !== undefined;
  const hpState = resolveCurrentHp(
    hpPlayer,
    hpMax,
    hpProfile.effectiveStats.con,
    regenBalance,
    now,
    !justRespawned
  );
  let persistentHp = hpState.currentHp;
  let persistentMaxHp = hpState.maxHp;

  let completed = false;
  let defeated = false;
  // Fights resolve in memory against one loaded context, then settle together
  // below. A batch of fifty costs the same reads as a batch of one.
  let battle: BattleContext | null = null;
  let abilityCooldowns = encounter?.abilityCooldowns;
  const fights: BatchFight[] = [];
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

    if (!encounter) {
      // No HP to start a fight (e.g. the hunt began while defeated): wait for
      // regen instead of instant-failing. Defeats suffered in a fought battle
      // end the hunt below; this path only covers starting on empty.
      if (persistentHp <= 0) {
        if (autoBattleRespawnMs > 0 && nextRespawnUntil === undefined) {
          nextRespawnUntil = now + autoBattleRespawnMs;
          onlineCreditMs = 0;
        }
        break;
      }
      // Rest rather than walk into a fight on low HP. Banked online time pays for
      // the rest first; whatever's left waits out on the respawn clock, which
      // the client already shows as recovering.
      const regenPerSecond = hpProfile.conRegenPerSecond;
      if (persistentHp < autoRest.below * persistentMaxHp && regenPerSecond > 0) {
        const targetHp = autoRest.until * persistentMaxHp;
        const restMs = ((targetHp - persistentHp) / regenPerSecond) * 1_000;
        if (onlineCreditMs >= restMs) {
          onlineCreditMs -= restMs;
          persistentHp = targetHp;
        } else {
          persistentHp += (regenPerSecond * onlineCreditMs) / 1_000;
          nextRespawnUntil = now + Math.ceil(restMs - onlineCreditMs);
          onlineCreditMs = 0;
          break;
        }
      }
      battle ??= await loadBattleContext(ctx, hpPlayer, tier, {
        ...(task.zone === undefined ? {} : { zone: task.zone }),
        now,
        profile: hpProfile,
      });
      encounter = rollEncounter(battle, {
        startingHp: persistentHp,
        ...(abilityCooldowns === undefined ? {} : { abilityCooldowns }),
      });
      persistentMaxHp = encounter.playerMaxHealth;
    }
    const result = encounter;
    const durationToConsume =
      task.battleMode === "duration" && task.targetDurationMs !== undefined
        ? Math.min(
            result.durationMs,
            Math.max(1, task.targetDurationMs - progressMs)
          )
        : result.durationMs;
    if (onlineCreditMs < durationToConsume) {
      break;
    }

    onlineCreditMs -= durationToConsume;
    progressMs += durationToConsume;
    // A duration-limited run ending halfway through a fight has not won it.
    if (durationToConsume < result.durationMs) {
      completed = true;
      break;
    }
    completedBattles += 1;
    persistentHp = result.playerEndingHp ?? (result.won ? persistentHp : 0);
    abilityCooldowns = result.abilityCooldowns;
    encounter = undefined;
    fights.push({
      monsterType: result.monsterType,
      monsterName: result.monsterName,
      won: result.won,
      goldEarned: result.goldEarned ?? 0,
      experienceEarned: result.experienceEarned ?? 0,
      ...(result.abilityCasts === undefined ? {} : { abilityCasts: result.abilityCasts }),
    });
    if (result.won) {
      wins += 1;
    } else {
      losses += 1;
      defeated = true;
      break;
    }

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
  }

  if (fights.length > 0) {
    const settlement = await settleAutoBattleBatch(ctx, {
      player: hpPlayer,
      settlementKey: `${playerId}:${task._id}:${completedBattles}`,
      tier,
      ...(task.zone === undefined ? {} : { monsterZone: task.zone }),
      weaponDamageStat: hpProfile.weapon?.damageStat ?? null,
      fights,
    });
    totalGoldEarned += settlement.goldEarned;
    totalExperienceEarned += settlement.experienceEarned;
    mergeLootSummary(lootSummary, settlement.loot);
    const defeatedByType = new Map<string, { monsterType: string; monsterName: string; count: number }>();
    for (const fight of fights) {
      if (!fight.won) continue;
      const row = defeatedByType.get(fight.monsterType);
      if (row) row.count += 1;
      else defeatedByType.set(fight.monsterType, { monsterType: fight.monsterType, monsterName: fight.monsterName, count: 1 });
    }
    for (const row of defeatedByType.values()) {
      await recordDefeatedMonster(ctx, task, row, now);
    }
  }

  if (defeated) {
    // Dying kicks you out of the hunt: persist 0 HP, bank everything earned
    // so far, and close the task as failed so the UI returns to hunt
    // selection instead of recovering into the next encounter.
    await writePlayerHp(ctx, playerId, 0, persistentMaxHp, now);
    await completeTask(ctx, {
      ...task,
      progressMs,
      completedBattles,
      onlineCreditMs,
      totalGoldEarned,
      totalExperienceEarned,
      lootSummary,
    }, "failed", now, {
      reason: "Defeated",
      battles: completedBattles,
      wins,
      losses,
      goldEarned: totalGoldEarned,
      experienceEarned: totalExperienceEarned,
    });
    return await activateNextTask(ctx, playerId, now);
  }

  // Persist HP once per settlement (batch-safe). Mid-encounter, project
  // remaining HP from elapsed credit so a refresh keeps the bar instead of
  // snapping back up. When this tick settled no fights and there is no
  // in-progress encounter (blocked/offline/stalling), grant resting wall
  // regen instead — otherwise a queued battle task would pin HP forever.
  const fightsSettled = wins + losses;
  if (encounter) {
    const projected = projectBattleHealth(encounter, onlineCreditMs);
    persistentHp = projected.currentPlayerHealth;
    persistentMaxHp = projected.currentPlayerMaxHealth;
  } else if (fightsSettled === 0) {
    const rested = resolveCurrentHp(
      { ...hpPlayer, currentHp: persistentHp, currentHpUpdatedAt: hpPlayer.currentHpUpdatedAt },
      persistentMaxHp,
      hpProfile.effectiveStats.con,
      regenBalance,
      now,
      false
    );
    persistentHp = rested.currentHp;
    persistentMaxHp = rested.maxHp;
  }
  // A tick that settled nothing and left HP where it was has nothing to save, and
  // writing anyway would re-run every query reading this player.
  if (fightsSettled > 0 || persistentHp !== hpPlayer.currentHp) {
    await writePlayerHp(ctx, playerId, persistentHp, persistentMaxHp, now);
  }

  const encounterFields = encounter
    ? {
        currentMonsterName: encounter.monsterName,
        currentMonsterType: encounter.monsterType,
        ...projectBattleHealth(encounter, onlineCreditMs),
      }
    : {};
  if (completed) {
    const resolvedTask = {
      ...task,
      progressMs,
      completedBattles,
      onlineCreditMs,
      ...encounterFields,
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
    ...encounterFields,
    battleEncounter: encounter,
    totalGoldEarned,
    totalExperienceEarned,
    lootSummary,
    respawnUntil: nextRespawnUntil,
    lastHeartbeatAt: now,
    lastResolvedAt: now,
    updatedAt: now,
  });
  return await ctx.db.get(task._id);
}

async function settleTaskQueue(ctx: MutationCtx, playerId: PlayerId, now: number) {
  const before = await getActiveTask(ctx, playerId);
  const onlineSegments = before
    ? await consumeOnlineProgress(ctx, before, now)
    : [];
  const active = await resolveTimedQueue(ctx, playerId, now, onlineSegments);
  if (active?.taskType === "battle") {
    return await processAutoBattle(ctx, active, now, before?._id === active._id ? onlineSegments : []);
  }
  // Persistent HP is deliberately not touched here. Regen is a pure function
  // of the last combat write, so readers (combat.getHpStatus) project it and
  // only real fights persist it. Refilling the bar on every tick cost a full
  // combat-profile read plus a player write for a value that is recomputed on
  // read anyway.
  return active;
}

async function settleTaskQueueForInteraction(ctx: MutationCtx, playerId: PlayerId, now: number) {
  const active = await settleTaskQueue(ctx, playerId, now);
  if (active && (
    getDeferredProgressMs(active) > 0 ||
    (active.taskType === "battle" && active.onlineCreditMs > 0 &&
      (!active.battleEncounter || active.onlineCreditMs >= active.battleEncounter.durationMs))
  )) {
    throw new Error("Task catch-up is still running. Wait for it to finish before making this change.");
  }
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

function getNextSettlementAt(
  task: PlayerTask | null,
  settlementIntervalMs: number,
  offlineWindowMs: number,
  options: {
    nextModifierChangeAt?: number | null;
    skillSettlementGapMs?: number;
  } = {}
) {
  const {
    nextModifierChangeAt = null,
    skillSettlementGapMs = settlementIntervalMs,
  } = options;
  if (!task || task.status !== "active") return null;
  if (task.taskType === "battle") {
    if (task.respawnUntil !== undefined && task.respawnUntil > task.updatedAt) {
      return task.respawnUntil;
    }
    if (!task.battleEncounter) return task.updatedAt;
    const remainingMs = Math.max(0, Math.min(
      task.battleEncounter.durationMs,
      task.battleMode === "duration"
        ? Math.max(0, (task.targetDurationMs ?? 0) - task.progressMs)
        : task.battleEncounter.durationMs
    ) - task.onlineCreditMs);
    // The encounter is already simulated and frozen on the task, so nothing
    // needs the server until it resolves. Past that, fights bank online credit
    // and settle together: this interval, not fight length, sets the write rate.
    // A defeat settles on time because it ends the hunt, and a hunt with a target
    // settles as soon as its remaining fights or time could be used up.
    if (!task.battleEncounter.won) return task.updatedAt + remainingMs;
    const encounterMs = Math.max(1, task.battleEncounter.durationMs);
    const untilTargetMs =
      task.battleMode === "count"
        ? remainingMs +
          Math.max(0, (task.targetBattles ?? 0) - task.completedBattles - 1) * encounterMs
        : task.battleMode === "duration"
          ? Math.max(0, (task.targetDurationMs ?? 0) - task.progressMs - task.onlineCreditMs)
          : Infinity;
    return task.updatedAt + Math.min(
      untilTargetMs,
      Math.max(remainingMs, settlementIntervalMs)
    );
  }
  if (getDeferredProgressMs(task) > 0) return task.updatedAt;
  if (task.canProgressOffline && offlineWindowMs === 0) return null;
  const remainingMs = Math.max(
    0,
    (task.durationMs ?? task.progressMs) - task.progressMs
  );
  if (task.definitionId === "skill_action") {
    // A skill task's rate is piecewise-constant: between booster and event
    // boundaries the outcome is already decided, so settle at completion (or
    // at the next boundary). The gap caps how long the rate may go
    // un-re-resolved, because skill levels speed up their own tasks.
    const waits = [remainingMs, skillSettlementGapMs];
    if (nextModifierChangeAt !== null && nextModifierChangeAt > task.lastResolvedAt) {
      waits.push(nextModifierChangeAt - task.lastResolvedAt);
    }
    return task.lastResolvedAt + Math.min(...waits);
  }
  return task.lastResolvedAt + Math.min(
    remainingMs,
    !task.canProgressOffline ? settlementIntervalMs : offlineWindowMs
  );
}

async function getQueueSnapshot(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  snapshotTime?: number,
  options: { includeHistory?: boolean; includeBattleStats?: boolean } = {}
) {
  const includeHistory = options.includeHistory ?? true;
  const includeBattleStats = options.includeBattleStats ?? true;
  const [activeTask, capacity, history, offlineWindowMs, syncSettings] =
    await Promise.all([
      getActiveTask(ctx, playerId),
      getQueueCapacity(ctx),
      includeHistory
        ? ctx.db
            .query("taskHistory")
            .withIndex("by_playerId_and_completedAt", (q) =>
              q.eq("playerId", playerId)
            )
            .order("desc")
            .take(HISTORY_QUERY_LIMIT)
        : Promise.resolve([]),
      getOfflineTaskWindow(ctx),
      getHeartbeatGrace(ctx).then((graceMs) => readTaskSyncSettings(ctx, graceMs)),
    ]);
  const queuedTasks = await getQueuedTasks(ctx, playerId, capacity);
  const now = snapshotTime ?? Math.max(
    activeTask?.updatedAt ?? 0,
    ...queuedTasks.map((task) => task.updatedAt),
    history[0]?.completedAt ?? 0
  );

  const offlineWorkAheadMs = calculateOfflineWorkAheadMs(
    [activeTask, ...queuedTasks],
    now,
    offlineWindowMs
  );

  const battleStatsByTaskId = new Map<string, BattleStat[]>();
  const battleTasks = includeBattleStats
    ? [activeTask, ...queuedTasks].filter(
        (task): task is PlayerTask => task?.taskType === "battle"
      )
    : [];
  await Promise.all(
    battleTasks.map(async (task) => {
      const stats = await ctx.db
        .query("taskBattleStats")
        .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
        .order("desc")
        .take(100);
      battleStatsByTaskId.set(task._id, stats);
    })
  );

  // Skill tasks are the only ones whose outcome depends on state that changes
  // in the future, so their deadlines are scheduled against the next booster
  // or event boundary rather than a fixed poll interval.
  const hasSkillTask = [activeTask, ...queuedTasks].some(
    (task) => task?.taskType === "timed" && task.definitionId === "skill_action"
  );
  const nextModifierChangeAt = hasSkillTask
    ? await readNextSkillModifierChangeAt(ctx, playerId, now)
    : null;

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
    const nextSettlementAt = getNextSettlementAt(
      task, syncSettings.settlementIntervalMs, offlineWindowMs,
      { nextModifierChangeAt, skillSettlementGapMs: syncSettings.skillSettlementGapMs }
    );
    return {
      ...task,
      nextSettlementAt,
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
    ...syncSettings,
  };
}

export const getQueue = query({
  args: {
    playerId: v.id("players"),
    now: v.optional(v.number()),
    includeHistory: v.optional(v.boolean()),
    includeBattleStats: v.optional(v.boolean()),
  },
  handler: async (ctx, { playerId, now, includeHistory, includeBattleStats }) => {
    await requirePlayerOwner(ctx, playerId);
    if (now !== undefined && !Number.isFinite(now)) {
      throw new Error("Queue timestamp must be finite");
    }
    return await getQueueSnapshot(ctx, playerId, now, {
      ...(includeHistory === undefined ? {} : { includeHistory }),
      ...(includeBattleStats === undefined ? {} : { includeBattleStats }),
    });
  },
});

export const sync = mutation({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    await requirePlayerOwner(ctx, playerId);
    const now = Date.now();
    const active = await settleTaskQueue(ctx, playerId, now);
    const [settings, offlineWindowMs] = await Promise.all([
      getHeartbeatGrace(ctx).then((graceMs) => readTaskSyncSettings(ctx, graceMs)),
      getOfflineTaskWindow(ctx),
    ]);
    const nextModifierChangeAt = isSkillActionTask(active)
      ? await readNextSkillModifierChangeAt(ctx, playerId, now)
      : null;
    return {
      serverTime: now,
      nextSettlementAt: getNextSettlementAt(active, settings.settlementIntervalMs, offlineWindowMs, {
        nextModifierChangeAt,
        skillSettlementGapMs: settings.skillSettlementGapMs,
      }),
      requiresPresence: Boolean(active && (active.taskType === "battle" || !active.canProgressOffline)),
      ...settings,
    };
  },
});

function isSkillActionTask(task: PlayerTask | null): boolean {
  return Boolean(task && task.taskType === "timed" && task.definitionId === "skill_action");
}

/**
 * Scheduler-only view of the queue.
 *
 * `sync` and every presence heartbeat rewrite `playerTasks`, so anything the
 * sync loop subscribes to is re-read on each of those writes. This deliberately
 * excludes the history, per-task battle stats and queued rows the UI needs:
 * the loop only has to know when the active task next needs the server.
 */
export const getActivePlan = query({
  args: {
    playerId: v.id("players"),
  },
  handler: async (ctx, { playerId }) => {
    await requirePlayerOwner(ctx, playerId);
    const now = Date.now();
    const [activeTask, nextQueued, offlineWindowMs, heartbeatGraceMs] =
      await Promise.all([
        getActiveTask(ctx, playerId),
        ctx.db
          .query("playerTasks")
          .withIndex("by_playerId_and_status_and_queueOrder", (q) =>
            q.eq("playerId", playerId).eq("status", "queued")
          )
          .order("asc")
          .first(),
        getOfflineTaskWindow(ctx),
        getHeartbeatGrace(ctx),
      ]);
    const settings = await readTaskSyncSettings(ctx, heartbeatGraceMs);
    const nextModifierChangeAt = isSkillActionTask(activeTask)
      ? await readNextSkillModifierChangeAt(ctx, playerId, now)
      : null;
    return {
      serverTime: now,
      active: activeTask
        ? {
            _id: activeTask._id,
            taskType: activeTask.taskType,
            definitionId: activeTask.definitionId,
            displayName: activeTask.displayName,
            canProgressOffline: activeTask.canProgressOffline,
            tier: activeTask.tier ?? null,
            currentMonsterName: activeTask.currentMonsterName ?? null,
            nextSettlementAt: getNextSettlementAt(
              activeTask, settings.settlementIntervalMs, offlineWindowMs,
              { nextModifierChangeAt, skillSettlementGapMs: settings.skillSettlementGapMs }
            ),
          }
        : null,
      hasQueued: Boolean(nextQueued),
      requiresPresence: Boolean(
        activeTask && (activeTask.taskType === "battle" || !activeTask.canProgressOffline)
      ),
      ...settings,
    };
  },
});

export const heartbeat = mutation({
  args: {
    playerId: v.id("players"),
    presenceOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { playerId, presenceOnly }) => {
    await requirePlayerOwner(ctx, playerId);
    const now = Date.now();
    // Keep previously deployed clients progressing until they reload.
    if (!presenceOnly) {
      await settleTaskQueue(ctx, playerId, now);
      return null;
    }
    const presence = await getPresence(ctx, playerId);
    if (!presence) return null;
    const graceMs = await getHeartbeatGrace(ctx);
    if (now - presence.lastSeenAt > graceMs) {
      await settleTaskQueue(ctx, playerId, now);
    } else if (now > presence.lastSeenAt) {
      await ctx.db.patch(presence._id, { lastSeenAt: now });
    }
    return null;
  },
});

export const settleForInteraction = internalMutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await settleTaskQueueForInteraction(ctx, playerId, Date.now());
    return null;
  },
});

export const prepareRebirth = internalMutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    const now = Date.now();
    await settleTaskQueueForInteraction(ctx, playerId, now);
    const [active, capacity] = await Promise.all([
      getActiveTask(ctx, playerId), getQueueCapacity(ctx),
    ]);
    const queued = await getQueuedTasks(ctx, playerId, capacity);
    for (const task of [active, ...queued]) {
      if (task?.taskType === "battle") {
        await completeTask(ctx, task, "cancelled", now, { reason: "Rebirth" });
      }
    }
    await activateNextTask(ctx, playerId, now);
    return null;
  },
});

export const enqueueTimedTask = mutation({
  args: {
    playerId: v.id("players"),
    definitionId: v.string(),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, { playerId, definitionId, payload }) => {
    await settleTaskQueueForInteraction(ctx, playerId, Date.now());
    // Skill tasks must go through enqueueSkillAction, which validates tiers,
    // reserves ingredients server-side, and snapshots balanced rewards. The
    // generic path cannot trust a client-built skill payload.
    if (definitionId === "skill_action") {
      throw new Error("Skill tasks must use enqueueSkillAction");
    }
    if (
      payload !== undefined &&
      isRecord(payload) &&
      (payload.skillTaskVersion !== undefined ||
        payload.skillActionSnapshot !== undefined ||
        payload.reservedIngredients !== undefined)
    ) {
      throw new Error("Skill payloads must use enqueueSkillAction");
    }
    if (payload !== undefined) {
      const serialized = JSON.stringify(payload);
      if (serialized.length > 8192) {
        throw new Error("Task payload is too large");
      }
    }
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
    await settleTaskQueueForInteraction(ctx, playerId, Date.now());
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
      const augmentDef = await ctx.db
        .query("augmentationDefinitions")
        .withIndex("by_augmentationId", (q) =>
          q.eq("augmentationId", actionId)
        )
        .first();
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
      let queuedForItem = false;
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
        queuedForItem = true;
        reservedSlots += 1;
      }
      if (augmentDef?.requiresPreviousTier === true) {
        if (augmentDef.tier > 1) {
          const predecessor = existingAugments.find(
            (augment) => (augment.tier ?? 0) === augmentDef.tier - 1
          );
          if (!predecessor) {
            throw new Error(
              `That augmentation requires a tier ${augmentDef.tier - 1} augment first`
            );
          }
          // The predecessor is replaced on success, freeing its slot.
          if (queuedForItem) {
            throw new Error(
              "Finish the queued augmentation for this item first"
            );
          }
          if (existingAugments.length - 1 >= (item.augmentSlots ?? 1)) {
            throw new Error("That equipment has no open augmentation slots");
          }
        } else if (
          existingAugments.length + reservedSlots >=
          (item.augmentSlots ?? 1)
        ) {
          throw new Error("That equipment has no open augmentation slots");
        }
      } else if (
        existingAugments.length + reservedSlots >=
        (item.augmentSlots ?? 1)
      ) {
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
    zone: v.optional(combatZoneValidator),
    mode: v.union(
      v.literal("count"),
      v.literal("duration"),
      v.literal("until-stopped")
    ),
    targetBattles: v.optional(v.number()),
    targetDurationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await settleTaskQueueForInteraction(ctx, args.playerId, Date.now());
    await validateAutoBattleRequest(
      ctx,
      args.playerId,
      args.tier,
      args.mode,
      args.targetBattles,
      args.targetDurationMs,
      args.zone ?? undefined
    );
    const definition = await getTaskDefinition(ctx, "auto_battle");
    if (!definition || !definition.enabled) {
      throw new Error("Auto-battle task definition is not configured");
    }

    return await insertTask(ctx, {
      playerId: args.playerId,
      definition,
      taskType: "battle",
      displayName: "Auto-battle",
      battleMode: args.mode,
      targetBattles: args.targetBattles,
      targetDurationMs: args.targetDurationMs,
      tier: args.tier,
      ...(args.zone === undefined ? {} : { zone: args.zone }),
    });
  },
});

export const cancel = mutation({
  args: {
    playerId: v.id("players"),
    taskId: v.id("playerTasks"),
  },
  handler: async (ctx, { playerId, taskId }) => {
    await getPlayer(ctx, playerId);
    const task = await ctx.db.get(taskId);
    if (!task || task.playerId !== playerId) {
      throw new Error("Task not found");
    }

    const now = Date.now();
    const activeTask = await getActiveTask(ctx, playerId);
    if (activeTask?._id === task._id) {
      await settleTaskQueueForInteraction(ctx, playerId, now);
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
