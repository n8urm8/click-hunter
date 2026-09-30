import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  SKILL_BONUS_SCOPE_VALUES,
  SKILL_TASK_EFFECT_TYPES,
  type SkillBonusScope,
  type SkillTaskEffectType,
} from "./itemTypes";

type DatabaseCtx = QueryCtx | MutationCtx;
export type SkillActionCategory = Exclude<SkillBonusScope, "all">;

export const DEFAULT_SKILL_TASK_MS_PER_XP = 100;
export const DEFAULT_SKILL_TASK_MULTIPLIER = 1;
export const MAX_SKILL_MODIFIER_MULTIPLIER = 1_000;
export const SKILL_TASK_BALANCE_DEFAULTS = [
  {
    key: "skillTaskMsPerXp",
    value: DEFAULT_SKILL_TASK_MS_PER_XP,
    description: "Base milliseconds per skill XP for gathering, crafting, and augmentations",
  },
  {
    key: "skillTaskSpeedMultiplierAll",
    value: DEFAULT_SKILL_TASK_MULTIPLIER,
    description: "Global skill action speed multiplier for all skills",
  },
  {
    key: "skillTaskSpeedMultiplierGathering",
    value: DEFAULT_SKILL_TASK_MULTIPLIER,
    description: "Global skill action speed multiplier for gathering",
  },
  {
    key: "skillTaskSpeedMultiplierCrafting",
    value: DEFAULT_SKILL_TASK_MULTIPLIER,
    description: "Global skill action speed multiplier for crafting",
  },
  {
    key: "skillTaskXpMultiplierAll",
    value: DEFAULT_SKILL_TASK_MULTIPLIER,
    description: "Global skill XP multiplier for all skills",
  },
  {
    key: "skillTaskXpMultiplierGathering",
    value: DEFAULT_SKILL_TASK_MULTIPLIER,
    description: "Global skill XP multiplier for gathering",
  },
  {
    key: "skillTaskXpMultiplierCrafting",
    value: DEFAULT_SKILL_TASK_MULTIPLIER,
    description: "Global skill XP multiplier for crafting",
  },
] as const;

const MAX_CONFIGURED_MULTIPLIER = MAX_SKILL_MODIFIER_MULTIPLIER;
const MAX_COMBINED_MULTIPLIER = MAX_SKILL_MODIFIER_MULTIPLIER;
const MAX_SKILL_EVENT_ROWS = 500;

type SkillModifier = {
  effectType: SkillTaskEffectType;
  effectScope: SkillBonusScope;
  amount: number;
  startsAt: number;
  endsAt: number;
};

export type SkillModifierTimeline = {
  globalSpeedMultipliers: Record<SkillBonusScope, number>;
  globalXpMultipliers: Record<SkillBonusScope, number>;
  events: SkillModifier[];
  itemBoosts: SkillModifier[];
  passiveSpeedMultipliers: Record<SkillBonusScope, number>;
  passiveXpMultipliers: Record<SkillBonusScope, number>;
};

async function getBalanceValue(ctx: DatabaseCtx, key: string) {
  return (
    await ctx.db
      .query("gameBalance")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first()
  )?.value;
}

function readMultiplier(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_CONFIGURED_MULTIPLIER
    ? value
    : DEFAULT_SKILL_TASK_MULTIPLIER;
}

export function getSkillTaskMsPerXp(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 60_000
    ? value
    : DEFAULT_SKILL_TASK_MS_PER_XP;
}

export async function readSkillTaskMsPerXp(ctx: DatabaseCtx) {
  return getSkillTaskMsPerXp(await getBalanceValue(ctx, "skillTaskMsPerXp"));
}

function readScope(value: unknown): SkillBonusScope | null {
  return SKILL_BONUS_SCOPE_VALUES.find((scope) => scope === value) ?? null;
}

function readSkillEffect(value: unknown): SkillTaskEffectType | null {
  return SKILL_TASK_EFFECT_TYPES.find((effectType) => effectType === value) ?? null;
}

function makeModifier(
  effectType: unknown,
  effectScope: unknown,
  amount: unknown,
  startsAt: unknown,
  endsAt: unknown
): SkillModifier | null {
  const validEffectType = readSkillEffect(effectType);
  const validScope = readScope(effectScope);
  if (
    !validEffectType ||
    !validScope ||
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > MAX_CONFIGURED_MULTIPLIER ||
    typeof startsAt !== "number" ||
    !Number.isFinite(startsAt) ||
    typeof endsAt !== "number" ||
    !Number.isFinite(endsAt) ||
    startsAt >= endsAt
  ) {
    return null;
  }

  return {
    effectType: validEffectType,
    effectScope: validScope,
    amount,
    startsAt,
    endsAt,
  };
}

export async function getSkillModifierTimeline(
  ctx: DatabaseCtx,
  playerId: Id<"players">,
  startsAt: number,
  endsAt: number
): Promise<SkillModifierTimeline> {
  const scopes = SKILL_BONUS_SCOPE_VALUES;
  const balanceKeys = scopes.flatMap((scope) => [
    `skillTaskSpeedMultiplier${scope === "all" ? "All" : scope === "gathering" ? "Gathering" : "Crafting"}`,
    `skillTaskXpMultiplier${scope === "all" ? "All" : scope === "gathering" ? "Gathering" : "Crafting"}`,
  ]);
  const [balanceValues, eventRows, boostRows, passiveRows] = await Promise.all([
    Promise.all(balanceKeys.map((key) => getBalanceValue(ctx, key))),
    ctx.db
      .query("gameEvents")
      .withIndex("by_startTime", (q) => q.lte("startTime", endsAt))
      .order("desc")
      .take(MAX_SKILL_EVENT_ROWS),
    ctx.db
      .query("playerSkillBoosts")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .take(SKILL_BONUS_SCOPE_VALUES.length * SKILL_TASK_EFFECT_TYPES.length),
    ctx.db
      .query("playerPassives")
      .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
      .take(500),
  ]);

  const globalSpeedMultipliers = {} as Record<SkillBonusScope, number>;
  const globalXpMultipliers = {} as Record<SkillBonusScope, number>;
  let balanceIndex = 0;
  for (const scope of scopes) {
    globalSpeedMultipliers[scope] = readMultiplier(
      balanceValues[balanceIndex++]
    );
    globalXpMultipliers[scope] = readMultiplier(
      balanceValues[balanceIndex++]
    );
  }

  const events = eventRows
    .filter((event) => event.endTime > startsAt)
    .map((event) =>
      makeModifier(
        event.effectType,
        event.effectScope ?? "all",
        event.effectValue,
        event.startTime,
        event.endTime
      )
    )
    .filter((modifier): modifier is SkillModifier => modifier !== null);

  const itemBoosts = boostRows
    .map((boost) =>
      makeModifier(
        boost.effectType,
        boost.effectScope,
        boost.effectAmount,
        boost.startedAt,
        boost.expiresAt
      )
    )
    .filter((modifier): modifier is SkillModifier => modifier !== null);

  const passiveSpeedMultipliers: Record<SkillBonusScope, number> = {
    all: 1,
    gathering: 1,
    crafting: 1,
  };
  const passiveXpMultipliers: Record<SkillBonusScope, number> = {
    all: 1,
    gathering: 1,
    crafting: 1,
  };
  if (passiveRows.length > 0) {
    const passiveNodeIds = new Set(passiveRows.map((row) => row.nodeId));
    const passiveNodes = await ctx.db
      .query("passiveNodes")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .take(500);
    for (const node of passiveNodes) {
      if (!passiveNodeIds.has(node.nodeId)) continue;
      if (
        node.effectType !== "skill-xp-multiplier" &&
        node.effectType !== "skill-speed-multiplier"
      ) {
        continue;
      }
      const scope =
        node.effectScope === "gathering" || node.effectScope === "crafting"
          ? node.effectScope
          : "all";
      if (
        typeof node.effectAmount !== "number" ||
        !Number.isFinite(node.effectAmount) ||
        node.effectAmount <= 0 ||
        node.effectAmount > MAX_SKILL_MODIFIER_MULTIPLIER
      ) {
        continue;
      }
      if (node.effectType === "skill-xp-multiplier") {
        passiveXpMultipliers[scope] = Math.min(
          MAX_SKILL_MODIFIER_MULTIPLIER,
          passiveXpMultipliers[scope] * node.effectAmount
        );
      } else {
        passiveSpeedMultipliers[scope] = Math.min(
          MAX_SKILL_MODIFIER_MULTIPLIER,
          passiveSpeedMultipliers[scope] * node.effectAmount
        );
      }
    }
  }

  return {
    globalSpeedMultipliers,
    globalXpMultipliers,
    events,
    itemBoosts,
    passiveSpeedMultipliers,
    passiveXpMultipliers,
  };
}

function scopeApplies(scope: SkillBonusScope, category: SkillActionCategory) {
  return scope === "all" || scope === category;
}

function activeMultiplier(
  modifiers: SkillModifier[],
  effectType: SkillTaskEffectType,
  category: SkillActionCategory,
  timestamp: number
) {
  return modifiers.reduce((multiplier, modifier) => {
    if (
      modifier.effectType !== effectType ||
      !scopeApplies(modifier.effectScope, category) ||
      timestamp < modifier.startsAt ||
      timestamp >= modifier.endsAt
    ) {
      return multiplier;
    }
    return Math.min(MAX_COMBINED_MULTIPLIER, multiplier * modifier.amount);
  }, 1);
}

export function getSkillModifiersAt(
  timeline: SkillModifierTimeline,
  category: SkillActionCategory,
  timestamp: number
) {
  const speedMultiplier = Math.min(
    MAX_COMBINED_MULTIPLIER,
    timeline.globalSpeedMultipliers.all *
      timeline.globalSpeedMultipliers[category] *
      (timeline.passiveSpeedMultipliers.all ?? 1) *
      (timeline.passiveSpeedMultipliers[category] ?? 1) *
      activeMultiplier(
        timeline.events,
        "skill-speed-multiplier",
        category,
        timestamp
      ) *
      activeMultiplier(
        timeline.itemBoosts,
        "skill-speed-multiplier",
        category,
        timestamp
      )
  );
  const xpMultiplier = Math.min(
    MAX_COMBINED_MULTIPLIER,
    timeline.globalXpMultipliers.all *
      timeline.globalXpMultipliers[category] *
      (timeline.passiveXpMultipliers.all ?? 1) *
      (timeline.passiveXpMultipliers[category] ?? 1) *
      activeMultiplier(
        timeline.events,
        "skill-xp-multiplier",
        category,
        timestamp
      ) *
      activeMultiplier(
        timeline.itemBoosts,
        "skill-xp-multiplier",
        category,
        timestamp
      )
  );
  return { speedMultiplier, xpMultiplier };
}

export function getSkillActionDurationMs(
  baseExperienceReward: number,
  msPerXp: number,
  speedMultiplier = DEFAULT_SKILL_TASK_MULTIPLIER
) {
  if (
    !Number.isSafeInteger(baseExperienceReward) ||
    baseExperienceReward < 1 ||
    !Number.isFinite(msPerXp) ||
    msPerXp <= 0 ||
    !Number.isFinite(speedMultiplier) ||
    speedMultiplier <= 0
  ) {
    throw new Error("Skill action timing configuration is invalid");
  }
  const durationMs =
    (baseExperienceReward * msPerXp) / speedMultiplier;
  return Math.max(
    1,
    Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(durationMs))
  );
}
