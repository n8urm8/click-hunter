import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
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
  const [event, setEventTracker] = useAtom(eventTrackerAtom);
  const inFlightRef = useRef(false);
  const queueEventRef = useRef<QueueEvent | null>(null);

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

    const run = async (
      operation: "sync" | "heartbeat"
    ) => {
      if (
        disposed ||
        inFlightRef.current ||
        (typeof navigator !== "undefined" && !navigator.onLine)
      ) {
        return;
      }

      inFlightRef.current = true;
      try {
        if (operation === "sync") {
          await sync({ playerId });
        } else {
          await heartbeat({ playerId });
        }
      } catch (error) {
        if (!disposed) {
          console.error(`Task queue ${operation} failed:`, error);
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    void run("sync");
    const interval = window.setInterval(() => {
      void run("heartbeat");
    }, 2_000);
    const handleOnline = () => {
      void run("sync");
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void run("sync");
      }
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [heartbeat, playerId, sync]);

  return null;
}
