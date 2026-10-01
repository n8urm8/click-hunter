import { beforeEach, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerStatsSummary } from "~/components/player/PlayerStatsSummary";
import { usePlayer } from "./usePlayer";

const mocks = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  keepPreviousData: (data: unknown) => data,
}));

beforeEach(() => vi.clearAllMocks());

test("player stats and the character summary retain server equipment calculations without reclamping speed", () => {
  mocks.useQuery.mockReturnValue({
    data: {
      _id: "player", name: "Hunter", str: 1, dex: 1, int: 1, luk: 1, con: 1,
      gold: 0, totalExperience: 0, rebirthCount: 0, currentTier: 1,
      characterLevel: 5, autoAttackEnabled: false,
      effectiveStats: { str: 1, dex: 2, int: 1, luk: 1, con: 1 },
      combatStats: {
        attack: 7.2, health: 30, defense: 0.8, attackSpeed: 0.325,
        critChance: 0.1, critDamageMultiplier: 1.5, attackSpeedMultiplier: 0.5,
        damageType: "physical",
      },
    },
  });
  const player = usePlayer("hunter").data;
  expect(player).toMatchObject({
    autoAttackEnabled: true, attackSpeed: 0.325, dex: 2, level: 5, attack: 7.2,
  });
  if (!player) throw new Error("Missing player");
  const markup = renderToStaticMarkup(<PlayerStatsSummary player={player} />);
  expect(markup).toContain("0.33/s");
  expect(markup).toContain("Health: 30");
});

test("player query retains loading and missing-player states", () => {
  for (const data of [undefined, null]) {
    mocks.useQuery.mockReturnValue({ data, isPending: data === undefined });
    expect(usePlayer("hunter").data).toBe(data);
  }
});
