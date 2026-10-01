import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { useConvexConnectionState } from "convex/react";
import { getTaskServerNow, observeTaskServerTime } from "~/lib/taskClock";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  useTaskQueue,
  useSyncTaskQueue,
  useTaskHeartbeat,
} from "~/hooks/useTasks";
import { eventTrackerAtom } from "~/store/gameStore";

interface TaskQueueManagerProps {
  playerId: Id<"players">;
}

type QueueEvent =
  | { type: "auto_battling"; monsterName: string; tier: number }
  | { type: "skilling"; skillName: string };

export function TaskQueueManager({ playerId }: TaskQueueManagerProps) {
  const sync = useSyncTaskQueue();
  const heartbeat = useTaskHeartbeat();
  const taskQueue = useTaskQueue(playerId);
  const { isWebSocketConnected } = useConvexConnectionState();
  const [event, setEventTracker] = useAtom(eventTrackerAtom);
  const queueRef = useRef(taskQueue.data);
  const connectedRef = useRef(isWebSocketConnected);
  const wakeRef = useRef<(() => void) | null>(null);
  const reconnectRef = useRef<(() => void) | null>(null);
  const queueEventRef = useRef<QueueEvent | null>(null);

  useEffect(() => {
    queueRef.current = taskQueue.data;
    wakeRef.current?.();
  }, [taskQueue.data]);

  useEffect(() => {
    connectedRef.current = isWebSocketConnected;
    if (isWebSocketConnected) reconnectRef.current?.();
  }, [isWebSocketConnected]);

  useEffect(() => {
    const activeTask = taskQueue.data?.active;
    const nextQueueEvent: QueueEvent | null =
      activeTask?.taskType === "battle"
        ? {
            type: "auto_battling",
            monsterName: activeTask.currentMonsterName ?? "the wilds",
            tier: activeTask.tier ?? 1,
          }
        : activeTask?.taskType === "timed" &&
            activeTask.definitionId === "skill_action"
          ? {
              type: "skilling",
              skillName: activeTask.displayName,
            }
          : null;

    const previousQueueEvent = queueEventRef.current;
    if (nextQueueEvent) {
      queueEventRef.current = nextQueueEvent;
      const alreadyShowingTask =
        nextQueueEvent.type === "auto_battling"
          ? event.type === "auto_battling" &&
            event.monsterName === nextQueueEvent.monsterName &&
            event.tier === nextQueueEvent.tier
          : event.type === "skilling" &&
            event.skillName === nextQueueEvent.skillName;
      if (!alreadyShowingTask) {
        setEventTracker(nextQueueEvent);
      }
      return;
    }

    queueEventRef.current = null;
    if (!previousQueueEvent) return;

    const wasShowingTask =
      previousQueueEvent.type === "auto_battling"
        ? event.type === "auto_battling" &&
          event.monsterName === previousQueueEvent.monsterName &&
          event.tier === previousQueueEvent.tier
        : event.type === "skilling" &&
          event.skillName === previousQueueEvent.skillName;
    if (wasShowingTask) {
      setEventTracker({ type: "idle" });
    }
  }, [event, setEventTracker, taskQueue.data?.active]);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let timer: number | undefined;
    let nextPresenceAt = 0;
    let syncRequest = 1;
    let settledSyncRequest = 0;
    let retryAt = 0;
    let syncPlan: Awaited<ReturnType<typeof sync>> | null = null;
    let settledQueue: typeof queueRef.current;

    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (disposed || inFlight || !connectedRef.current || !navigator.onLine) return;
      const queue = queueRef.current;
      const plan = syncPlan &&
        (!queue || queue === settledQueue || queue.serverTime < syncPlan.serverTime)
        ? syncPlan
        : queue
          ? {
              ...queue,
              nextSettlementAt: queue.active?.nextSettlementAt ??
                (queue.queued.length > 0 ? getTaskServerNow() : null),
              requiresPresence: Boolean(queue.active &&
                (queue.active.taskType === "battle" || !queue.active.canProgressOffline)),
            }
          : null;
      const due = syncRequest !== settledSyncRequest
        ? getTaskServerNow()
        : Math.min(
            plan?.nextSettlementAt ?? Infinity,
            plan?.requiresPresence ? nextPresenceAt : Infinity
          );
      if (!Number.isFinite(due)) return;
      timer = window.setTimeout(() => {
        const settlementDue = syncRequest !== settledSyncRequest ||
          (plan?.nextSettlementAt !== null &&
            plan?.nextSettlementAt !== undefined &&
            plan.nextSettlementAt <= getTaskServerNow());
        void run(settlementDue ? "sync" : "heartbeat");
      }, Math.min(2_147_483_647, Math.max(0, due - getTaskServerNow(), retryAt - getTaskServerNow())));
    };

    const run = async (
      operation: "sync" | "heartbeat"
    ) => {
      if (
        disposed ||
        inFlight ||
        !connectedRef.current ||
        (typeof navigator !== "undefined" && !navigator.onLine)
      ) {
        return;
      }

      inFlight = true;
      try {
        if (operation === "sync") {
          const currentSyncRequest = syncRequest;
          settledQueue = queueRef.current;
          syncPlan = await sync({ playerId });
          if (disposed) return;
          observeTaskServerTime(syncPlan.serverTime);
          settledSyncRequest = currentSyncRequest;
        } else {
          await heartbeat({ playerId, presenceOnly: true });
        }
        nextPresenceAt = getTaskServerNow() +
          (syncPlan?.presenceIntervalMs ?? queueRef.current?.presenceIntervalMs ?? 0);
        retryAt = 0;
      } catch (error) {
        if (!disposed) {
          console.error(`Task queue ${operation} failed:`, error);
          retryAt = getTaskServerNow() +
            (syncPlan?.settlementIntervalMs ?? queueRef.current?.settlementIntervalMs ?? 1_000);
        }
      } finally {
        inFlight = false;
        schedule();
      }
    };

    wakeRef.current = schedule;
    schedule();
    const handleOnline = () => {
      syncRequest += 1;
      schedule();
    };
    reconnectRef.current = handleOnline;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleOnline();
      }
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      wakeRef.current = null;
      reconnectRef.current = null;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [heartbeat, playerId, sync]);

  return null;
}
