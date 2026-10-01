import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { adminSectionsForTables } from "../../convex/adminConfig";
import {
  adminSnapshotKey,
  useAdminConfig,
  useAdminPlayers,
  useUpdateItemRarity,
  useResetForestCrafting,
  useSeedAdminPassiveTree,
  useUpdateGameBalance,
  useUpdatePlayer,
} from "./useAdmin";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutate: vi.fn(),
  useQuery: vi.fn(),
  queryClient: null as QueryClient | null,
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useCallback: (callback: unknown) => callback,
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("convex/react")>(),
  useConvex: () => ({ query: mocks.query }),
  useMutation: () => mocks.mutate,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useQuery: mocks.useQuery,
  useQueryClient: () => mocks.queryClient,
}));

const playerId = "admin" as Id<"players">;
let observers: Array<() => void> = [];
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient();
  mocks.queryClient = client;
  mocks.query.mockResolvedValue([]);
  mocks.mutate.mockResolvedValue({ saved: true });
});
afterEach(() => {
  observers.forEach((unsubscribe) => unsubscribe());
  observers = [];
  client.clear();
  vi.unstubAllGlobals();
});

function observeLastQuery() {
  const options = mocks.useQuery.mock.lastCall?.[0];
  if (!options) throw new Error("No captured query options");
  const observer = new QueryObserver(client, options);
  observers.push(observer.subscribe(() => {}));
  return observer;
}

test("only the active tab fetches; cached snapshots do not refetch on focus or reconnect", async () => {
  useAdminConfig(playerId, "monsters", false);
  const monsters = observeLastQuery();
  useAdminConfig(playerId, "items", true);
  const items = observeLastQuery();
  useAdminPlayers(playerId, false);
  observeLastQuery();
  await vi.waitFor(() => expect(items.getCurrentResult().isSuccess).toBe(true));
  expect(mocks.query).toHaveBeenCalledExactlyOnceWith(
    api.admin.getConfig, { playerId, section: "items" }
  );
  expect(monsters.getCurrentResult().fetchStatus).toBe("idle");
  const options = mocks.useQuery.mock.calls[1][0];
  expect(options).toMatchObject({
    staleTime: Infinity, refetchOnWindowFocus: false,
    refetchOnReconnect: false, retry: false,
  });
});

test("snapshot cache entries never create live Convex adapter subscriptions", async () => {
  vi.stubGlobal("window", {});
  const { ConvexQueryClient, convexQuery } = await import("@convex-dev/react-query");
  const convex = new ConvexReactClient("https://test.convex.cloud");
  const watch = vi.spyOn(convex, "watchQuery").mockReturnValue({
    onUpdate: () => () => {},
    localQueryResult: () => undefined,
    journal: () => undefined,
  });
  const adapter = new ConvexQueryClient(convex);
  adapter.connect(client);
  try {
    useAdminConfig(playerId, "items", true);
    const items = observeLastQuery();
    await vi.waitFor(() => expect(items.getCurrentResult().isSuccess).toBe(true));
    expect(watch).not.toHaveBeenCalled();
    expect(adapter.subscriptions).toEqual({});

    // Positive control: the old key really does establish an adapter watch.
    client.getQueryCache().build(client, convexQuery(api.admin.getConfig, { playerId }));
    expect(watch).toHaveBeenCalledTimes(1);
    client.removeQueries({ queryKey: convexQuery(api.admin.getConfig, { playerId }).queryKey });
    expect(adapter.subscriptions).toEqual({});
  } finally {
    adapter.unsubscribe?.();
    await convex.close();
  }
});

test("saves refresh the active snapshot and only mark related inactive tabs stale", async () => {
  useAdminConfig(playerId, "items", true);
  const items = observeLastQuery();
  useAdminConfig(playerId, "skills", false);
  observeLastQuery();
  useAdminConfig(playerId, "monsters", false);
  observeLastQuery();
  await vi.waitFor(() => expect(items.getCurrentResult().isSuccess).toBe(true));
  for (const section of ["skills", "monsters", "general"] as const) {
    client.setQueryData(adminSnapshotKey(playerId, section), []);
  }
  mocks.query.mockClear();
  const result = await useUpdateItemRarity()({
    playerId, rarityId: "rarity" as Id<"itemRarities">,
    level: 99, name: "Test", color: "#abcdef",
  });
  expect(result).toEqual({ saved: true });
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(client.getQueryState(adminSnapshotKey(playerId, "skills"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(adminSnapshotKey(playerId, "monsters"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(adminSnapshotKey(playerId, "general"))?.isInvalidated).toBe(false);

  useAdminConfig(playerId, "skills", true);
  const skills = observeLastQuery();
  await vi.waitFor(() => expect(skills.getCurrentResult().isSuccess).toBe(true));
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.query).toHaveBeenLastCalledWith(
    api.admin.getConfig, { playerId, section: "skills" }
  );
});

test("manual refresh reads again while a failed save does not invalidate snapshots", async () => {
  useAdminConfig(playerId, "general", true);
  const general = observeLastQuery();
  await vi.waitFor(() => expect(general.getCurrentResult().isSuccess).toBe(true));
  await general.refetch();
  expect(mocks.query).toHaveBeenCalledTimes(2);
  mocks.mutate.mockRejectedValueOnce(new Error("Save rejected"));
  await expect(useUpdateGameBalance()({
    playerId, balanceId: "balance" as Id<"gameBalance">, value: 2, description: "Test",
  })).rejects.toThrow("Save rejected");
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(client.getQueryState(adminSnapshotKey(playerId, "general"))?.isInvalidated).toBe(false);
});

test("a successful save remains successful when refreshing fails, with an explicit query error", async () => {
  useAdminConfig(playerId, "general", true);
  const general = observeLastQuery();
  await vi.waitFor(() => expect(general.getCurrentResult().isSuccess).toBe(true));
  mocks.query.mockRejectedValueOnce(new Error("Snapshot unavailable"));
  await expect(useUpdateGameBalance()({
    playerId, balanceId: "balance" as Id<"gameBalance">, value: 2, description: "Test",
  })).resolves.toEqual({ saved: true });
  await vi.waitFor(() => expect(general.getCurrentResult().error?.message)
    .toBe("Snapshot unavailable"));
  expect(general.getCurrentResult().data).toEqual([]);
});

test("player saves, seeding and resets invalidate their affected snapshots", async () => {
  for (const section of ["players", "monsters", "items", "skills", "tree", "general"] as const) {
    client.setQueryData(adminSnapshotKey(playerId, section), []);
  }
  await useUpdatePlayer()({
    adminPlayerId: playerId, targetPlayerId: playerId, expectedLastUpdated: 0,
    name: "Admin", str: 1, dex: 1, int: 1, luk: 1, con: 1, gold: 1,
    totalExperience: 0, currentTier: 1, maxTierReached: 1,
    rebirthCount: 0, rebirthTierThreshold: 5,
  });
  expect(client.getQueryState(adminSnapshotKey(playerId, "players"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(adminSnapshotKey(playerId, "tree"))?.isInvalidated).toBe(false);
  await useSeedAdminPassiveTree()({ playerId });
  expect(client.getQueryState(adminSnapshotKey(playerId, "tree"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(adminSnapshotKey(playerId, "general"))?.isInvalidated).toBe(true);
  await useResetForestCrafting()({ playerId });
  expect(client.getQueryState(adminSnapshotKey(playerId, "monsters"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(adminSnapshotKey(playerId, "items"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(adminSnapshotKey(playerId, "skills"))?.isInvalidated).toBe(true);
  expect(mocks.query).not.toHaveBeenCalled();
});

test("shared catalog dependencies refresh every affected section, scoped to the admin", async () => {
  expect(adminSectionsForTables(["items"])).toEqual(["monsters", "items", "skills"]);
  expect(adminSectionsForTables(["skillDefinitions"])).toEqual(["skills", "players"]);
  expect(adminSectionsForTables(["recipeIngredients", "recipeOutputs"])).toEqual(["skills"]);
  const otherPlayerId = "other" as Id<"players">;
  client.setQueryData(adminSnapshotKey(otherPlayerId, "general"), []);
  await useUpdateGameBalance()({
    playerId, balanceId: "balance" as Id<"gameBalance">, value: 2, description: "Test",
  });
  expect(client.getQueryState(adminSnapshotKey(otherPlayerId, "general"))?.isInvalidated).toBe(false);
});
