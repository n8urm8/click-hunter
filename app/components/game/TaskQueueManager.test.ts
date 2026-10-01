import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { TaskQueueManager } from "./TaskQueueManager";

const mocks = vi.hoisted(() => ({
  sync: vi.fn(async () => ({
    serverTime: Date.now(), nextSettlementAt: null as number | null,
    requiresPresence: false, presenceIntervalMs: 10_000, settlementIntervalMs: 30_000,
  })),
  heartbeat: vi.fn(async () => null),
  effects: [] as Array<() => void | (() => void)>,
  connected: true,
  queue: {
    data: {
      serverTime: 0, presenceIntervalMs: 10_000, settlementIntervalMs: 30_000,
      active: null as null | {
        taskType: "timed" | "battle"; canProgressOffline: boolean;
        nextSettlementAt: number | null; currentMonsterName: string; tier: number;
      },
      queued: [] as Array<{ id: string }>,
    },
  },
}));

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("convex/react", () => ({
  useConvexConnectionState: () => ({ isWebSocketConnected: mocks.connected }),
}));
vi.mock("jotai", () => ({ useAtom: () => [{ type: "idle" }, vi.fn()] }));
vi.mock("~/store/gameStore", () => ({ eventTrackerAtom: {} }));
vi.mock("~/hooks/useTasks", () => ({
  useSyncTaskQueue: () => mocks.sync,
  useTaskHeartbeat: () => mocks.heartbeat,
  useTaskQueue: () => mocks.queue,
}));

const playerId = "test-player" as Id<"players">;
let cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(1_000_000);
  vi.clearAllMocks();
  mocks.effects.length = 0;
  mocks.connected = true;
  mocks.queue.data = {
    serverTime: 0, presenceIntervalMs: 10_000, settlementIntervalMs: 30_000,
    active: null, queued: [],
  };
  mocks.sync.mockImplementation(async () => ({
    serverTime: Date.now(), nextSettlementAt: null, requiresPresence: false,
    presenceIntervalMs: 10_000, settlementIntervalMs: 30_000,
  }));
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  vi.stubGlobal("navigator", { onLine: true });
});

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mountManager() {
  TaskQueueManager({ playerId });
  for (const effect of mocks.effects) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
}

test("idle queues only sync on mount and reconnect", async () => {
  mountManager();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  expect(mocks.heartbeat).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.sync).toHaveBeenCalledTimes(3);
});

test("online work sends presence every ten seconds and settles every thirty", async () => {
  mocks.sync.mockImplementation(async () => ({
    serverTime: Date.now(), nextSettlementAt: Date.now() + 30_000,
    requiresPresence: true, presenceIntervalMs: 10_000, settlementIntervalMs: 30_000,
  }));
  mountManager();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.sync).toHaveBeenCalledTimes(3);
  expect(mocks.heartbeat).toHaveBeenCalledTimes(4);
  expect(mocks.heartbeat).toHaveBeenLastCalledWith({ playerId, presenceOnly: true });
});

test("offline-capable work waits for its deadline without presence pings", async () => {
  mocks.sync.mockImplementation(async () => ({
    serverTime: Date.now(),
    nextSettlementAt: mocks.sync.mock.calls.length === 1 ? Date.now() + 60_000 : null,
    requiresPresence: false, presenceIntervalMs: 10_000, settlementIntervalMs: 30_000,
  }));
  mountManager();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.sync).toHaveBeenCalledTimes(2);
  expect(mocks.heartbeat).not.toHaveBeenCalled();
});

test("battle completion deadlines override the reward batch interval", async () => {
  mocks.sync.mockImplementation(async () => ({
    serverTime: Date.now(),
    nextSettlementAt: mocks.sync.mock.calls.length === 1 ? Date.now() + 2_500 : null,
    requiresPresence: false, presenceIntervalMs: 10_000, settlementIntervalMs: 30_000,
  }));
  mountManager();
  await vi.advanceTimersByTimeAsync(2_499);
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.sync).toHaveBeenCalledTimes(2);
});

test("offline browsers stop sending calls and sync on reconnect", async () => {
  mocks.sync.mockImplementation(async () => ({
    serverTime: Date.now(), nextSettlementAt: Date.now() + 30_000,
    requiresPresence: true, presenceIntervalMs: 10_000, settlementIntervalMs: 30_000,
  }));
  mountManager();
  await vi.advanceTimersByTimeAsync(0);
  vi.stubGlobal("navigator", { onLine: false });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  expect(mocks.heartbeat).not.toHaveBeenCalled();
  vi.stubGlobal("navigator", { onLine: true });
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.sync).toHaveBeenCalledTimes(2);
});

test("a reconnect while sync is in flight is not dropped", async () => {
  let finish: (() => void) | undefined;
  mocks.sync.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => { finish = resolve; });
    return {
      serverTime: Date.now(), nextSettlementAt: null, requiresPresence: false,
      presenceIntervalMs: 10_000, settlementIntervalMs: 30_000,
    };
  });
  mountManager();
  await vi.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new Event("online"));
  finish?.();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.sync).toHaveBeenCalledTimes(2);
});

test("server clock calibration prevents immediate retry loops with client clock skew", async () => {
  let serverTime = 100_000;
  mocks.sync.mockImplementation(async () => ({
    serverTime,
    nextSettlementAt: serverTime + 30_000,
    requiresPresence: false, presenceIntervalMs: 10_000, settlementIntervalMs: 30_000,
  }));
  mountManager();
  await vi.advanceTimersByTimeAsync(29_999);
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  serverTime += 30_000;
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.sync).toHaveBeenCalledTimes(2);
});

test("a queue change wakes an idle manager", async () => {
  mountManager();
  await vi.advanceTimersByTimeAsync(0);
  mocks.queue.data = {
    ...mocks.queue.data,
    serverTime: Date.now(),
    active: {
      taskType: "timed", canProgressOffline: true,
      nextSettlementAt: Date.now() + 5_000, currentMonsterName: "", tier: 1,
    },
  };
  mocks.effects[0]();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(mocks.sync).toHaveBeenCalledTimes(2);
});

test("an old snapshot with the same timestamp cannot trigger a sync loop", async () => {
  mocks.queue.data.serverTime = Date.now();
  mocks.queue.data.active = {
    taskType: "battle", canProgressOffline: false,
    nextSettlementAt: Date.now(), currentMonsterName: "Rat", tier: 1,
  };
  mocks.sync.mockImplementation(async () => ({
    serverTime: Date.now(), nextSettlementAt: Date.now() + 30_000,
    requiresPresence: true, presenceIntervalMs: 10_000, settlementIntervalMs: 30_000,
  }));
  mountManager();
  await vi.advanceTimersByTimeAsync(29_999);
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  expect(mocks.heartbeat).toHaveBeenCalledTimes(2);
});

test("buffered requests do not fast-forward the clock or trigger premature settlement", async () => {
  let finish: (() => void) | undefined;
  mocks.sync.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => { finish = resolve; });
    return {
      serverTime: Date.now(), nextSettlementAt: Date.now() + 30_000,
      requiresPresence: false, presenceIntervalMs: 10_000, settlementIntervalMs: 30_000,
    };
  });
  mountManager();
  await vi.advanceTimersByTimeAsync(60_000);
  finish?.();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.sync).toHaveBeenCalledTimes(2);
});
