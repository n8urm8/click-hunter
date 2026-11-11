import { convexQuery } from "@convex-dev/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSkillPage, useSkillPanel } from "./useSkills";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  keepPreviousData: (data: unknown) => data,
}));
vi.mock("react", () => ({
  useMemo: (calculate: () => unknown) => calculate(),
}));

const playerId = "test-player" as Id<"players">;
const catalog = {
  definitions: [], tiers: [], activities: [], recipes: [], augmentations: [],
  skillXpBase: 1_000, skillTaskMsPerXp: 100, maxSkillBatchSize: 10_000,
};
const rows = [{
  _id: "test-skill", _creationTime: 0, playerId, skillId: "woodworking",
  level: 2, experience: 100, totalExperience: 1_100, actionsCompleted: 10,
  createdAt: 0, updatedAt: 0,
}];
const success = (data: unknown) => ({
  data, isPending: false, isError: false, error: null,
});

beforeEach(() => mocks.useQuery.mockReset());

test("panel uses the augmentation catalog and live progress queries with the existing data shape", () => {
  mocks.useQuery.mockReturnValueOnce(success(catalog)).mockReturnValueOnce(success(rows));
  const panel = useSkillPanel(playerId);
  expect(mocks.useQuery).toHaveBeenNthCalledWith(1, expect.objectContaining({
    queryKey: convexQuery(api.skills.getAugmentationCatalog, {}).queryKey,
  }));
  expect(mocks.useQuery).toHaveBeenNthCalledWith(2, expect.objectContaining({
    queryKey: convexQuery(api.skills.getPlayerSkills, { playerId }).queryKey,
  }));
  expect(panel.data).toEqual({
    ...catalog,
    playerSkills: [{ ...rows[0], xpRequiredForNextLevel: 3_000 }],
  });
  expect(panel.isPending).toBe(false);
});

test("panel waits for both results and surfaces errors instead of loading forever", () => {
  const error = new Error("Catalog unavailable");
  mocks.useQuery.mockReturnValueOnce({
    data: undefined, isPending: false, isError: true, error,
  }).mockReturnValueOnce({
    data: undefined, isPending: true, isError: false, error: null,
  });
  expect(useSkillPanel(playerId)).toEqual({
    data: undefined, isPending: false, isError: true, error,
  });
});

test("panel skips both subscriptions until a player is selected", () => {
  mocks.useQuery.mockReturnValue({
    data: undefined, isPending: true, isError: false, error: null,
  });
  expect(useSkillPanel(null).data).toBeUndefined();
  for (const [options] of mocks.useQuery.mock.calls) {
    expect(options.enabled).toBe(false);
  }
});

test("skill page asks for the selected skill and tier, and re-attaches item documents", () => {
  const item = { _id: "item-1", name: "Plank" };
  const page = {
    skill: { skillId: "woodworking" }, definitions: [], tiers: [],
    tierNumbers: [1, 2], selectedTier: 2,
    activities: [], augmentations: [],
    recipes: [{
      recipeId: "plank", tier: 2,
      ingredients: [{ itemId: "item-1", quantity: 2 }],
      outputs: [{ itemId: "missing", quantity: 1 }],
    }],
    items: { "item-1": item },
    skillXpBase: 1_000, skillTaskMsPerXp: 100, maxSkillBatchSize: 10_000, infusionRates: {},
  };
  mocks.useQuery.mockReturnValueOnce(success(page)).mockReturnValueOnce(success(rows));
  const result = useSkillPage(playerId, { skillId: "woodworking", tier: 2 });
  expect(mocks.useQuery).toHaveBeenNthCalledWith(1, expect.objectContaining({
    queryKey: convexQuery(api.skills.getSkillPage, { playerId, skillId: "woodworking", tier: 2 }).queryKey,
  }));
  expect(result.data?.selectedTier).toBe(2);
  expect(result.data?.playerSkills[0].xpRequiredForNextLevel).toBe(3_000);
  expect(result.data?.recipes[0].ingredients[0].item).toEqual(item);
  expect(result.data?.recipes[0].outputs[0].item).toBeNull();
});

test("skill page skips its subscriptions until a player is selected", () => {
  mocks.useQuery.mockReturnValue({
    data: undefined, isPending: true, isError: false, error: null,
  });
  expect(useSkillPage(null, {}).data).toBeUndefined();
  for (const [options] of mocks.useQuery.mock.calls) {
    expect(options.enabled).toBe(false);
  }
});
