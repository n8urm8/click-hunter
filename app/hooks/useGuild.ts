import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexQueryCacheOptions } from "../lib/queryCache";

export function useMyGuild(playerId: Id<"players"> | null | undefined) {
  return useQuery({
    ...convexQuery(api.guilds.getMyGuild, playerId ? { playerId } : "skip"),
    ...convexQueryCacheOptions,
  });
}

export function useGuildMembers(
  playerId: Id<"players"> | null | undefined,
  guildId: Id<"guilds"> | null | undefined
) {
  return useQuery({
    ...convexQuery(
      api.guilds.getGuildMembers,
      playerId && guildId ? { playerId, guildId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useGuildRaids(playerId: Id<"players"> | null | undefined) {
  return useQuery({
    ...convexQuery(api.guildRaids.getGuildRaids, playerId ? { playerId } : "skip"),
    ...convexQueryCacheOptions,
  });
}

export function useWeeklyObjectives(playerId: Id<"players"> | null | undefined) {
  return useQuery({
    ...convexQuery(
      api.guildObjectives.getWeeklyObjectives,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function usePendingApplications(
  playerId: Id<"players"> | null | undefined,
  guildId: Id<"guilds"> | null | undefined
) {
  return useQuery({
    ...convexQuery(
      api.guilds.getPendingApplications,
      playerId ? { playerId, ...(guildId ? { guildId } : {}) } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useGuildSearch(search: string) {
  return useQuery({
    ...convexQuery(api.guilds.searchGuilds, { search, limit: 20 }),
    ...convexQueryCacheOptions,
  });
}

export function useGuildLeaderboard() {
  return useQuery({
    ...convexQuery(api.guilds.getGuildLeaderboard, { limit: 20 }),
    ...convexQueryCacheOptions,
  });
}

export function useGuildConfig() {
  return useQuery({
    ...convexQuery(api.guilds.getGuildConfig, {}),
    ...convexQueryCacheOptions,
  });
}

export function useCreateGuild() {
  return useMutation(api.guilds.createGuild);
}

export function useDisbandGuild() {
  return useMutation(api.guilds.disbandGuild);
}

export function useLeaveGuild() {
  return useMutation(api.guilds.leaveGuild);
}

export function useInvitePlayer() {
  return useMutation(api.guilds.invitePlayer);
}

export function useApplyToGuild() {
  return useMutation(api.guilds.applyToGuild);
}

export function useAcceptInvite() {
  return useMutation(api.guilds.acceptInvite);
}

export function useAcceptApplication() {
  return useMutation(api.guilds.acceptApplication);
}

export function useDeclineApplication() {
  return useMutation(api.guilds.declineApplication);
}

export function useKickMember() {
  return useMutation(api.guilds.kickMember);
}

export function usePromoteMember() {
  return useMutation(api.guilds.promoteMember);
}

export function useDemoteMember() {
  return useMutation(api.guilds.demoteMember);
}

export function useDepositGold() {
  return useMutation(api.guilds.depositGold);
}

export function useWithdrawGold() {
  return useMutation(api.guilds.withdrawGold);
}

export function useStartRaid() {
  return useMutation(api.guildRaids.startRaid);
}

export function useCreateRaidParty() {
  return useMutation(api.guildRaids.createRaidParty);
}

export function useJoinRaid() {
  return useMutation(api.guildRaids.joinRaid);
}

export function useBeginRaid() {
  return useMutation(api.guildRaids.beginRaid);
}

export function useTickRaid() {
  return useMutation(api.guildRaids.tickRaid);
}

export function useRaidStatus(playerId: Id<"players"> | null | undefined) {
  return useQuery({
    ...convexQuery(api.guildRaids.getRaidStatus, playerId ? { playerId } : "skip"),
    ...convexQueryCacheOptions,
  });
}

export function useRaidLeaderboard(playerId: Id<"players"> | null | undefined) {
  return useQuery({
    ...convexQuery(
      api.guildRaids.getRaidLeaderboard,
      playerId ? { playerId } : "skip"
    ),
    ...convexQueryCacheOptions,
  });
}

export function useGuildStash(playerId: Id<"players"> | null | undefined) {
  return useQuery({
    ...convexQuery(api.guildStash.getGuildStash, playerId ? { playerId } : "skip"),
    ...convexQueryCacheOptions,
  });
}

export function useWithdrawFromGuildStash() {
  return useMutation(api.guildStash.withdrawFromGuildStash);
}

export function useClaimObjectiveReward() {
  return useMutation(api.guildObjectives.claimObjectiveReward);
}
