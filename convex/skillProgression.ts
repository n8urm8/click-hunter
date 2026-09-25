export const SKILL_XP_BALANCE_DEFAULT = {
  key: "skillXpPerLevel",
  value: 1_000,
  description:
    "Base skill XP required to advance from level 1; each later level adds level x base XP",
} as const;

export function readSkillXpBase(value: unknown) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1
    ? value
    : SKILL_XP_BALANCE_DEFAULT.value;
}

export function getSkillXpRequiredForLevel(level: number, baseXp: number) {
  if (!Number.isSafeInteger(level) || level < 1) {
    throw new Error("Skill level must be a positive safe integer");
  }
  if (!Number.isSafeInteger(baseXp) || baseXp < 1) {
    throw new Error("Skill XP base must be a positive safe integer");
  }

  let requiredXp = baseXp;
  for (let requiredLevel = 2; requiredLevel <= level; requiredLevel += 1) {
    requiredXp += requiredLevel * baseXp;
    if (!Number.isSafeInteger(requiredXp)) {
      throw new Error("Skill XP requirement exceeds the supported limit");
    }
  }
  return requiredXp;
}

export function applySkillExperience(
  currentLevel: number,
  currentExperience: number,
  earnedExperience: number,
  maxLevel: number | undefined,
  baseXp: number
) {
  if (!Number.isSafeInteger(currentLevel) || currentLevel < 1) {
    throw new Error("Skill level must be a positive safe integer");
  }
  if (
    maxLevel !== undefined &&
    (!Number.isSafeInteger(maxLevel) || maxLevel < 1)
  ) {
    throw new Error("Skill maximum level must be a positive safe integer");
  }
  if (
    !Number.isSafeInteger(currentExperience) ||
    currentExperience < 0 ||
    !Number.isSafeInteger(earnedExperience) ||
    earnedExperience < 0
  ) {
    throw new Error("Skill experience values must be non-negative safe integers");
  }

  let level = currentLevel;
  let experience = currentExperience + earnedExperience;
  if (!Number.isSafeInteger(experience)) {
    throw new Error("Skill experience exceeds the supported limit");
  }

  const capped = maxLevel ?? Number.MAX_SAFE_INTEGER;
  let xpRequired = getSkillXpRequiredForLevel(level, baseXp);
  while (level < capped && experience >= xpRequired) {
    experience -= xpRequired;
    level += 1;
    if (level < capped) {
      xpRequired += level * baseXp;
      if (!Number.isSafeInteger(xpRequired)) {
        throw new Error("Skill XP requirement exceeds the supported limit");
      }
    }
  }

  return { level, experience };
}
