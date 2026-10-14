import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "../lib/queryCache";

export function usePvpConfig() {
  return useQuery({
    ...convexQuery(api.arena.getPvpConfig, {}),
    ...convexQueryCacheOptions,
  });
}

export function useOpenLobbies(playerId: Id<"players"> | null | undefined) {
  return useQuery({
    ...convexQuery(
      api.arena.getOpenLobbies,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useArenaLobby(
  playerId: Id<"players"> | null | undefined,
  lobbyId: Id<"arenaLobbies"> | null | undefined
) {
  return useQuery({
    ...convexQuery(
      api.arena.getLobby,
      playerId && lobbyId ? { playerId, lobbyId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useMyLobby(playerId: Id<"players"> | null | undefined) {
  return useQuery({
    ...convexQuery(api.arena.getMyLobby, playerId ? { playerId } : "skip"),
    ...convexQueryCacheOptions,
  });
}

export function useRecentArenaResults(
  playerId: Id<"players"> | null | undefined
) {
  return useQuery({
    ...convexQuery(
      api.arena.getRecentResults,
      playerId ? { playerId, limit: 20 } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useCreateLobby() {
  return useMutation(api.arena.createLobby);
}

export function useJoinLobbyAsFighter() {
  return useMutation(api.arena.joinLobbyAsFighter);
}

export function useQuickMatch() {
  return useMutation(api.arena.quickMatch);
}

export function useLeaveLobby() {
  return useMutation(api.arena.leaveLobby);
}

export function useCancelLobby() {
  return useMutation(api.arena.cancelLobby);
}

export function useJoinAsSpectator() {
  return useMutation(api.arena.joinAsSpectator);
}

export function useSetReady() {
  return useMutation(api.arena.setReady);
}

export function useKickFromLobby() {
  return useMutation(api.arena.kickFromLobby);
}

export function useTickFight() {
  return useMutation(api.arena.tickFight);
}

export function useForfeitFight() {
  return useMutation(api.arena.forfeitFight);
}

export function usePvpLoadout(playerId: Id<"players"> | null | undefined) {
  return useQuery({
    ...convexQuery(
      api.pvpLoadout.getPvpLoadout,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useSavePvpLoadout() {
  return useMutation(api.pvpLoadout.savePvpLoadout);
}

export function useClearPvpLoadout() {
  return useMutation(api.pvpLoadout.clearPvpLoadout);
}
