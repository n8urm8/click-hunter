import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "../lib/queryCache";

export function useTaskQueue(
  playerId: Id<"players"> | null
) {
  return useQuery({
    ...convexQuery(api.tasks.getQueue, playerId ? { playerId } : "skip"),
    ...convexQueryCacheOptions,
  });
}

export function useSyncTaskQueue() {
  return useMutation(api.tasks.sync);
}

export function useTaskHeartbeat() {
  return useMutation(api.tasks.heartbeat);
}

export function useEnqueueTimedTask() {
  return useMutation(api.tasks.enqueueTimedTask);
}

export function useEnqueueSkillAction() {
  return useMutation(api.tasks.enqueueSkillAction);
}

export function useEnqueueAutoBattle() {
  return useMutation(api.tasks.enqueueAutoBattle);
}

export function useCancelTask() {
  return useMutation(api.tasks.cancel);
}
