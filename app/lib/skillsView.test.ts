import { expect, test } from "vitest";
import {
  parseTierParam,
  readStoredSkillsView,
  SKILLS_VIEW_STORAGE_KEY,
  skillsViewSearch,
  writeStoredSkillsView,
} from "./skillsView";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

test("tier params accept positive integers and all, and ignore anything else", () => {
  expect(parseTierParam("3")).toBe(3);
  expect(parseTierParam("all")).toBe("all");
  expect(parseTierParam("0")).toBeUndefined();
  expect(parseTierParam("-2")).toBeUndefined();
  expect(parseTierParam("2.5")).toBeUndefined();
  expect(parseTierParam("high")).toBeUndefined();
  expect(parseTierParam(null)).toBeUndefined();
});

test("the search string round-trips the skill and tier", () => {
  expect(skillsViewSearch({ skill: "alchemy", tier: 3 })).toBe("?skill=alchemy&tier=3");
  expect(skillsViewSearch({ skill: "alchemy", tier: "all" })).toBe("?skill=alchemy&tier=all");
});

test("the last view is stored and read back", () => {
  const storage = memoryStorage();
  writeStoredSkillsView({ skill: "forging", tier: 5 }, storage);
  expect(readStoredSkillsView(storage)).toEqual({ skill: "forging", tier: 5 });
});

test("a stored view with a bad tier keeps the skill and drops the tier", () => {
  const storage = memoryStorage({
    [SKILLS_VIEW_STORAGE_KEY]: JSON.stringify({ skill: "mining", tier: "nope" }),
  });
  expect(readStoredSkillsView(storage)).toEqual({ skill: "mining", tier: undefined });
});

test("corrupt or empty storage reads as no stored view", () => {
  expect(readStoredSkillsView(memoryStorage())).toBeNull();
  expect(readStoredSkillsView(memoryStorage({ [SKILLS_VIEW_STORAGE_KEY]: "{not json" }))).toBeNull();
  expect(readStoredSkillsView(memoryStorage({ [SKILLS_VIEW_STORAGE_KEY]: "42" }))).toBeNull();
  expect(readStoredSkillsView(undefined)).toBeNull();
});
