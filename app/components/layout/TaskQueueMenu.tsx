import { Popover } from "@base-ui/react/popover";
import { ClipboardList, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { useCancelTask, useTaskQueue } from "~/hooks/useTasks";
import type { Id } from "../../../convex/_generated/dataModel";

type QueueData = NonNullable<ReturnType<typeof useTaskQueue>["data"]>;
type QueueTask = NonNullable<QueueData["active"]> | QueueData["queued"][number];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readActionCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function getTaskProgress(
  task: QueueTask,
  now: number,
  offlineWindowMs: number,
  serverTime: number
) {
  const elapsedSinceSnapshot =
    task.taskType === "timed" &&
    task.status === "active" &&
    task.canProgressOffline
      ? Math.min(
          Math.max(0, now - serverTime),
          offlineWindowMs
        )
      : 0;
  const projectedProgressMs =
    task.taskType === "timed"
      ? Math.min(
          task.durationMs ?? task.progressMs,
          task.projectedProgressMs + elapsedSinceSnapshot
        )
      : task.projectedProgressMs;

  if (task.taskType === "battle") {
    if (task.battleMode === "count") {
      return `${task.completedBattles} / ${task.targetBattles ?? "?"} battles`;
    }
    if (task.battleMode === "duration") {
      return `${formatDuration(projectedProgressMs)} / ${formatDuration(
        task.targetDurationMs
      )} online`;
    }
    return `${task.completedBattles} battles`;
  }

  if (
    isRecord(task.payload) &&
    task.payload.skillTaskVersion === 1
  ) {
    const completedActions = readActionCount(task.payload.completedActions);
    if (task.payload.actionType === "gathering") {
      const targetActionCount = readActionCount(task.payload.targetActionCount);
      if (targetActionCount > 0) {
        return `${completedActions} / ${targetActionCount} actions`;
      }
      return `${completedActions} actions · ${formatDuration(
        projectedProgressMs
      )} / ${formatDuration(task.durationMs)}`;
    }
    const targetActionCount = readActionCount(task.payload.targetActionCount);
    return `${completedActions} / ${targetActionCount} actions`;
  }

  return `${formatDuration(projectedProgressMs)} / ${formatDuration(
    task.durationMs
  )}${
    task.status === "active" &&
    task.canProgressOffline &&
    now - task.lastResolvedAt > offlineWindowMs
      ? " · offline window capped"
      : ""
  }`;
}

function TaskRow({
  task,
  isActive,
  isCancelling,
  now,
  offlineWindowMs,
  serverTime,
  onCancel,
}: {
  task: QueueTask;
  isActive: boolean;
  isCancelling: boolean;
  now: number;
  offlineWindowMs: number;
  serverTime: number;
  onCancel: (taskId: Id<"playerTasks">) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-forest-light/20 bg-forest-dark/40 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm text-foreground">
          {task.displayName}
          {task.tier === undefined ? "" : ` · T${task.tier}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {isActive ? "Active" : "Queued"} ·{" "}
          {getTaskProgress(task, now, offlineWindowMs, serverTime)}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => onCancel(task._id)}
        disabled={isCancelling}
        className="shrink-0 text-muted-foreground hover:text-blood-light"
      >
        {isCancelling ? "..." : "Stop"}
      </Button>
    </div>
  );
}

export function TaskQueueMenu({ playerId }: { playerId: Id<"players"> }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [cancellingTaskId, setCancellingTaskId] =
    useState<Id<"playerTasks"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queue = useTaskQueue(playerId);
  const cancelTask = useCancelTask();

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [open]);

  const queueData = queue.data;
  const activeCount = queueData?.active ? 1 : 0;
  const queuedCount = queueData?.queued.length ?? 0;
  const taskCount = activeCount + queuedCount;
  const elapsedSinceSnapshot = queueData
    ? Math.min(
        Math.max(0, now - queueData.serverTime),
        queueData.offlineWindowMs
      )
    : 0;
  const remainingOfflineWindowMs = queueData
    ? Math.max(
        0,
        queueData.offlineWindowMs -
          Math.max(0, queueData.offlineWorkAheadMs - elapsedSinceSnapshot)
      )
    : 0;

  const handleCancel = async (taskId: Id<"playerTasks">) => {
    setCancellingTaskId(taskId);
    setError(null);
    try {
      await cancelTask({ playerId, taskId });
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "Unable to stop task."
      );
    } finally {
      setCancellingTaskId(null);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Task queue${taskCount > 0 ? `, ${taskCount} task${taskCount === 1 ? "" : "s"}` : ""}`}
        render={
          <Button
            variant="outline"
            size="sm"
            className="relative gap-1.5 border-forest-light/30 px-2.5 text-foreground hover:border-gold/60 hover:bg-forest-dark/60"
          />
        }
      >
        <ClipboardList aria-hidden="true" className="size-4" />
        <span className="hidden sm:inline">Queue</span>
        {queue.isPending ? (
          <span className="text-xs text-muted-foreground">...</span>
        ) : (
          <span
            className={
              taskCount > 0
                ? "min-w-4 rounded-full bg-gold/20 px-1 text-center text-[10px] text-gold-light"
                : "text-xs text-muted-foreground"
            }
          >
            {taskCount}
          </span>
        )}
        <ChevronDown
          aria-hidden="true"
          className={`size-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={8}
          className="z-[100]"
        >
          <Popover.Popup className="relative z-[101] w-[min(23rem,calc(100vw-1.5rem))] rounded border border-forest-light/30 bg-forest-deep p-3 text-foreground shadow-2xl outline-none">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <Popover.Title className="font-heading text-base text-gold">
                  Task queue
                </Popover.Title>
                <p className="mt-1 text-xs text-muted-foreground">
                  {queueData
                    ? `${queueData.usedSlots} / ${queueData.capacity} slots in use`
                    : "Loading queue..."}
                </p>
              </div>
              {queueData && (
                <span className="text-right text-[11px] leading-4 text-muted-foreground">
                  Offline window: {formatDuration(queueData.offlineWindowMs)}
                  <br />
                  Remaining: {formatDuration(remainingOfflineWindowMs)}
                  <br />
                  Battles: online only
                </span>
              )}
            </div>

            {queue.isPending ? (
              <p className="rounded border border-dashed border-forest-light/25 px-3 py-4 text-center text-sm text-muted-foreground">
                Loading task queue...
              </p>
            ) : queue.isError ? (
              <p className="rounded border border-dashed border-blood-light/25 px-3 py-4 text-center text-sm text-blood-light" role="alert">
                Unable to load task queue.
              </p>
            ) : (
              <div className="max-h-[min(24rem,60vh)] space-y-2 overflow-y-auto pr-1">
                {queueData?.active && (
                  <TaskRow
                    task={queueData.active}
                    isActive
                    isCancelling={cancellingTaskId === queueData.active._id}
                    now={now}
                    offlineWindowMs={queueData.offlineWindowMs}
                    serverTime={queueData.serverTime}
                    onCancel={(taskId) => void handleCancel(taskId)}
                  />
                )}
                {queueData?.queued.map((task) => (
                  <TaskRow
                    key={task._id}
                    task={task}
                    isActive={false}
                    isCancelling={cancellingTaskId === task._id}
                    now={now}
                    offlineWindowMs={queueData.offlineWindowMs}
                    serverTime={queueData.serverTime}
                    onCancel={(taskId) => void handleCancel(taskId)}
                  />
                ))}
                {!queueData?.active && queueData?.queued.length === 0 && (
                  <p className="rounded border border-dashed border-forest-light/25 px-3 py-4 text-center text-sm text-muted-foreground">
                    No tasks in progress.
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="mt-3 text-xs text-blood-light" role="alert">
                {error}
              </p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
