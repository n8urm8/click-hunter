import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { CurrentFight } from "~/store/gameStore";
import { Button } from "~/components/ui/button";
import { BattleRunSettings } from "./BattleRunSettings";
import { CombatStats } from "./CombatStats";
import type { PlayerWithDerivedStats } from "~/hooks/usePlayer";
import type { Id } from "../../../convex/_generated/dataModel";
import { FightArea } from "./FightArea";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(async () => ({ _id: "queued-battle" })),
  setFight: vi.fn(),
  effects: [] as Array<() => void | (() => void)>,
  currentFight: null as CurrentFight | null,
  stateIndex: 0,
  queryIndex: 0,
  settings: { mode: "until-stopped", target: "10" },
  usedSlots: 0,
  queryState: "ready",
  respawnTimer: 0,
  active: null as Record<string, unknown> | null,
  cancel: vi.fn(async () => null),
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect),
  useRef: (current: unknown) => ({ current }),
  useMemo: (calculate: () => unknown) => calculate(),
  useState: (initial: unknown) => {
    const index = mocks.stateIndex++;
    return [index === 1 ? mocks.settings : initial, vi.fn()];
  },
}));
vi.mock("jotai", () => ({
  useAtom: (atom: string) => atom === "fight"
    ? [mocks.currentFight, mocks.setFight]
    : [atom === "respawn" ? mocks.respawnTimer : 0, vi.fn()],
}));
vi.mock("~/store/gameStore", () => ({
  currentFightAtom: "fight", playerHpAtom: "hp", playerMaxHpAtom: "maxHp",
  inFightPhaseAtom: "phase", eventTrackerAtom: "event", respawnTimerAtom: "respawn",
}));
vi.mock("react-router", () => ({
  useSearchParams: () => [new URLSearchParams("tier=3&zone=hard"), vi.fn()],
}));
vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: (data: unknown) => data,
  useQuery: () => {
    if (mocks.queryState !== "ready") {
      return {
        data: undefined,
        isPending: mocks.queryState === "loading",
        isError: mocks.queryState === "error",
      };
    }
    const data = [
      [{ type: "rat", name: "Rat", strength: 1 }],
      [],
      null,
    ][mocks.queryIndex++];
    return { data, isPending: false, isError: false };
  },
}));
vi.mock("~/hooks/useTasks", () => ({
  useEnqueueAutoBattle: () => mocks.enqueue,
  useCancelTask: () => mocks.cancel,
  useTaskQueue: () => ({ data: {
    active: mocks.active, queued: [], usedSlots: mocks.usedSlots, capacity: 5,
  } }),
}));
vi.mock("~/hooks/useTaskClock", () => ({ useTaskClock: () => 0 }));
vi.mock("./ActiveFight", () => ({ ActiveFight: () => null }));
vi.mock("~/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
vi.mock("~/components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("~/components/ui/progress", () => ({ Progress: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stateIndex = 0;
  mocks.queryIndex = 0;
  mocks.effects.length = 0;
  mocks.currentFight = null;
  mocks.settings = { mode: "until-stopped", target: "10" };
  mocks.usedSlots = 0;
  mocks.active = null;
  mocks.queryState = "ready";
  mocks.respawnTimer = 0;
});

const player: PlayerWithDerivedStats = {
  _id: "hunter" as Id<"players">, _creationTime: 0, anonymousId: "hunter",
  name: "Hunter", str: 1, dex: 1, int: 1, luk: 1, con: 1,
  gold: 0, totalExperience: 0, rebirthCount: 0, rebirthTierThreshold: 5,
  currentTier: 1, autoAttackEnabled: false, autoStartFightEnabled: false,
  createdAt: 0, lastUpdated: 0, level: 5,
  health: 120, attack: 17.2, defense: 5.6, attackSpeed: 0.325,
  critChance: 2.5, critDamageMultiplier: 1.5,
  attackSpeedMultiplier: 0.5, damageType: "physical",
};

type ElementProps = { children?: ReactNode; disabled?: boolean; onClick?: () => void };
function findStartButton(tree: ReactNode, label = "Enter the Wilds"): ReactElement<ElementProps> | null {
  if (!isValidElement<ElementProps>(tree)) return null;
  if (tree.type === Button && Children.toArray(tree.props.children)
    .some((child) => typeof child === "string" && child.includes(label))) {
    return tree;
  }
  for (const child of Children.toArray(tree.props.children)) {
    const button = findStartButton(child, label);
    if (button) return button;
  }
  return null;
}

test.each([
  ["until-stopped", "10", {}],
  ["count", "3", { targetBattles: 3 }],
  ["duration", "2", { targetDurationMs: 120_000 }],
])("entering the wilds always queues server combat in %s mode", async (mode, target, extra) => {
  mocks.settings = { mode, target };
  const start = findStartButton(FightArea({ player }));
  expect(start?.props.disabled).toBe(false);
  start?.props.onClick?.();
  await Promise.resolve();
  expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith({
    playerId: "hunter", tier: 3, zone: "hard", mode, ...extra,
  });
  expect(mocks.setFight).not.toHaveBeenCalled();
});

test("queue capacity remains enforced with no manual-fight fallback", () => {
  mocks.usedSlots = 5;
  const start = findStartButton(FightArea({ player }));
  expect(start?.props.disabled).toBe(true);
  expect(mocks.enqueue).not.toHaveBeenCalled();
});

test("compact stop conditions retain count and time limits without automation copy", () => {
  const markup = renderToStaticMarkup(<BattleRunSettings
    settings={{ mode: "count", target: "3" }}
    onModeChange={vi.fn()} onTargetChange={vi.fn()}
  />);
  expect(markup).toContain("Stop after");
  expect(markup).toContain("combat-input--select");
  expect(markup).toContain('aria-hidden="true"');
  expect(markup).toContain("right-3");
  expect(markup).toContain("Number of battles");
  expect(markup).not.toContain("Attacks are automatic");
  expect(markup).not.toContain('role="switch"');
  expect(markup).not.toContain("OFF");
});

test("combat stats use equipment-derived values including very slow weapons", () => {
  const markup = renderToStaticMarkup(<CombatStats player={player} />);
  for (const text of ["Equipped combat stats", "Max health", "120", "17.2", "5.6",
    "Attack speed", "0.33/s", "2.5%", "Crit damage", "1.50x"]) {
    expect(markup).toContain(text);
  }
  expect(markup).not.toContain("0.50/s");
});

test("idle combat shows equipped stats with labeled tier and zone radios", () => {
  const markup = renderToStaticMarkup(FightArea({ player }));
  expect(markup).toContain("Equipped combat stats");
  expect(markup).toContain("Hunting tier");
  expect(markup).toContain("Hunting zone");
  expect(markup.match(/type="radio"/g)).toHaveLength(7);
  expect(markup.match(/checked=""/g)).toHaveLength(2);
  expect(markup).not.toContain("Attacks are automatic");
  expect(markup).not.toContain("Run mode");
  expect(markup).not.toContain("Each zone holds");
});

test("active hunts retain stats, actual encounter speed, rewards and a stop action", () => {
  mocks.active = {
    _id: "battle", taskType: "battle", status: "active", displayName: "Hunt",
    tier: 3, zone: "hard", battleMode: "until-stopped",
    completedBattles: 2, progressMs: 0, updatedAt: 0, onlineCreditMs: 0,
    currentMonsterName: "Dragon", currentMonsterHealth: 80, currentMonsterMaxHealth: 100,
    currentPlayerHealth: 120, currentPlayerMaxHealth: 120,
    totalGoldEarned: 20, totalExperienceEarned: 5,
    battleEncounter: {
      monsterType: "dragon", monsterName: "Dragon", monsterMaxHealth: 100,
      playerMaxHealth: 120, monsterDamagePerSecond: 1, playerDamagePerSecond: 1,
      playerAttackSpeed: 0.4, durationMs: 10_000, won: true,
    },
  };
  const markup = renderToStaticMarkup(FightArea({ player }));
  expect(markup).toContain("Equipped combat stats");
  expect(markup).toContain("This encounter: 0.40 attacks/s");
  expect(markup).toContain("Stop hunt");
  expect(markup).toContain("Monsters defeated");
  expect(markup).toContain("Loot gained");
  expect(markup).not.toContain("Battle automation");
  expect(markup).not.toContain("Health animates locally");
});

test("boss fights keep the same stat strip", () => {
  mocks.currentFight = {
    settlementKey: "boss", monsterTier: 3, monsterType: "boss", monsterName: "Boss",
    isBoss: true, monsterHp: 100, monsterMaxHp: 100,
    monsterAttack: 10, monsterAttackSpeed: 1,
  };
  const markup = renderToStaticMarkup(FightArea({ player }));
  expect(markup).toContain("Equipped combat stats");
});

test.each([
  ["loading", "Preparing the wilds..."],
  ["error", "Unable to load combat data."],
])("combat stats remain visible when combat data is %s", (queryState, message) => {
  mocks.queryState = queryState;
  const markup = renderToStaticMarkup(FightArea({ player }));
  expect(markup).toContain("Equipped combat stats");
  expect(markup).toContain(message);
});

test("recovery keeps stats visible and disables new hunt controls", () => {
  mocks.respawnTimer = 5_000;
  const screen = FightArea({ player });
  const markup = renderToStaticMarkup(screen);
  expect(markup).toContain("Equipped combat stats");
  expect(markup).toContain("Recovering after defeat. Ready in 5s.");
  expect(findStartButton(screen, "Recovering")?.props.disabled).toBe(true);
  expect(markup.match(/<fieldset disabled=""/g)).toHaveLength(2);
});
