import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CurrentFight } from "~/store/gameStore";
import type { PlayerWithDerivedStats } from "~/hooks/usePlayer";
import type { Id } from "../../../convex/_generated/dataModel";
import { AttackButton } from "./AttackButton";

const mocks = vi.hoisted(() => ({
  attempt: vi.fn(async () => ({ allowed: true, retryAfterMs: 4_000, cooldownMs: 4_000 })),
  effects: [] as Array<() => void | (() => void)>,
  fight: null as CurrentFight | null,
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock("jotai", () => ({
  useAtom: (atom: string) => [{
    fight: mocks.fight, phase: "fighting", hp: 100, floaters: [],
  }[atom], vi.fn()],
}));
vi.mock("~/store/gameStore", () => ({
  currentFightAtom: "fight", clickAnimationsAtom: "floaters",
  inFightPhaseAtom: "phase", playerHpAtom: "hp", eventTrackerAtom: "event",
}));
vi.mock("~/hooks/usePlayer", () => ({
  useAttemptAttack: () => mocks.attempt,
  useRecordFight: () => vi.fn(),
  useAdvanceTierProgression: () => vi.fn(),
}));
vi.mock("~/lib/statCalculations", () => ({ calculateDamage: () => 1 }));

const player: PlayerWithDerivedStats = {
  _id: "hunter" as Id<"players">, _creationTime: 0, anonymousId: "hunter",
  name: "Hunter", str: 1, dex: 1, int: 1, luk: 1, con: 1, gold: 0,
  totalExperience: 0, rebirthCount: 0, rebirthTierThreshold: 5, currentTier: 1,
  createdAt: 0, lastUpdated: 0, autoAttackEnabled: false, autoStartFightEnabled: false,
  level: 5, health: 30, attack: 5, defense: 1, attackSpeed: 0.325,
  critChance: 0.1, critDamageMultiplier: 1.5, attackSpeedMultiplier: 0.5,
  damageType: "physical",
};
let cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.effects.length = 0;
  mocks.fight = {
    settlementKey: "boss-fight", monsterTier: 1, monsterType: "boss",
    monsterName: "Boss", monsterAttack: 10, monsterAttackSpeed: 0.5,
    isBoss: true, monsterHp: 1_000, monsterMaxHp: 1_000,
  };
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("boss attacks are mandatory, respect slow weapons and follow the server retry time", async () => {
  AttackButton({ player, onStartNextFight: () => false });
  for (const effect of mocks.effects) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
  await vi.advanceTimersByTimeAsync(3_076);
  expect(mocks.attempt).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.attempt).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3_999);
  expect(mocks.attempt).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.attempt).toHaveBeenCalledTimes(2);
});

test("unmounting cancels automatic attacks", async () => {
  AttackButton({ player, onStartNextFight: () => false });
  for (const effect of mocks.effects) effect()?.();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mocks.attempt).not.toHaveBeenCalled();
});

test("restarting the timer during an in-flight attack does not permanently stop auto attack", async () => {
  let complete: ((result: { allowed: boolean; retryAfterMs: number; cooldownMs: number }) => void) | undefined;
  mocks.attempt.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  AttackButton({ player, onStartNextFight: () => false });
  const effect = mocks.effects[0];
  const firstCleanup = effect();
  await vi.advanceTimersByTimeAsync(3_077);
  expect(mocks.attempt).toHaveBeenCalledTimes(1);
  if (firstCleanup) firstCleanup();
  const cleanup = effect();
  if (cleanup) cleanups.push(cleanup);
  await vi.advanceTimersByTimeAsync(3_077);
  expect(mocks.attempt).toHaveBeenCalledTimes(1);
  complete?.({ allowed: true, retryAfterMs: 4_000, cooldownMs: 4_000 });
  await vi.advanceTimersByTimeAsync(3_077);
  expect(mocks.attempt).toHaveBeenCalledTimes(2);
});
