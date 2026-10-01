import { beforeEach, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Id } from "../../../convex/_generated/dataModel";
import gameShellSource from "../../routes/game.tsx?raw";
import gameRootSource from "../game/GameRoot.tsx?raw";
import { AdminPanel } from "./AdminPanel";

const mocks = vi.hoisted(() => ({
  tab: "players",
  config: {
    gameBalance: [], upgrades: [], itemRarities: [], items: [],
    monsters: [], bosses: [], hiddenSpots: [], achievements: [],
    rebirthRewards: [], gameEvents: [], taskDefinitions: [],
    skillDefinitions: [], skillTierDefinitions: [], gatheringActivities: [],
    recipes: [], recipeIngredients: [], recipeOutputs: [],
    augmentationDefinitions: [], lootTables: [], lootTableEntries: [],
    lootSources: [], passiveNodes: [],
  },
  visited: [] as string[],
  failed: false,
  query: vi.fn(),
  refetch: vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock("react-router", () => ({
  useSearchParams: () => [
    new URLSearchParams({ adminTab: mocks.tab }), vi.fn(),
  ],
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.query }),
  useMutation: () => vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tab = "players";
  mocks.visited = [];
  mocks.failed = false;
  mocks.useQuery.mockImplementation((options: {
    queryKey: readonly string[]; enabled: boolean;
  }) => {
    const section = options.queryKey[2];
    const loaded = (options.enabled || mocks.visited.includes(section)) && !mocks.failed;
    return {
      data: loaded ? section === "players" ? [] : mocks.config : undefined,
      isPending: !loaded && !mocks.failed,
      isFetching: false,
      isError: mocks.failed && options.enabled,
      error: new Error("Snapshot unavailable"),
      refetch: mocks.refetch,
    };
  });
});

const playerId = "admin" as Id<"players">;

test("neither gameplay shell prefetches admin data", () => {
  for (const source of [gameShellSource, gameRootSource]) {
    expect(source).not.toContain("api.admin.");
    expect(source).not.toContain("admin configuration");
  }
});

test.each(["players", "monsters", "items", "skills", "tree", "general"])(
  "the %s tab enables only its own snapshot",
  (tab) => {
    mocks.tab = tab;
    const markup = renderToStaticMarkup(<AdminPanel playerId={playerId} />);
    const enabled = mocks.useQuery.mock.calls
      .map(([options]) => options)
      .filter((options) => options.enabled);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].queryKey).toEqual(["adminSnapshot", playerId, tab]);
    expect(markup).toContain(tab === "players" ? "Refresh players" : "Refresh configuration");
    expect(mocks.query).not.toHaveBeenCalled();
  }
);

test("visited inactive editors remain mounted without enabled queries", () => {
  mocks.tab = "general";
  mocks.visited = ["skills", "tree"];
  const markup = renderToStaticMarkup(<AdminPanel playerId={playerId} />);
  expect(markup).toContain("Skill definitions");
  expect(markup).toContain("Passive skill web");
  expect(markup.match(/role="tabpanel"/g)).toHaveLength(6);
  expect(markup.match(/\shidden=""/g)).toHaveLength(5);
  expect(markup).toContain("[&amp;[hidden]]:hidden");
  for (const [options] of mocks.useQuery.mock.calls) {
    expect(options.enabled).toBe(options.queryKey[2] === "general");
  }
});

test("failed snapshots expose the error and keep refresh controls available", () => {
  mocks.tab = "items";
  mocks.failed = true;
  const markup = renderToStaticMarkup(<AdminPanel playerId={playerId} />);
  expect(markup).toContain("Unable to load current configuration: Snapshot unavailable");
  expect(markup).toContain("Refresh configuration");
  expect(markup).toContain("Admin controls");
});

test("invalid tab parameters load only the default player snapshot", () => {
  mocks.tab = "invalid";
  renderToStaticMarkup(<AdminPanel playerId={playerId} />);
  const enabled = mocks.useQuery.mock.calls.filter(([options]) => options.enabled);
  expect(enabled).toHaveLength(1);
  expect(enabled[0][0].queryKey[2]).toBe("players");
});
