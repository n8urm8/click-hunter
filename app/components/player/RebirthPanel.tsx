import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { useCanRebirth, useRebirth } from "~/hooks/usePlayer";
import { useSkillPanel } from "~/hooks/useSkills";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import { convexQueryCacheOptions } from "../../lib/queryCache";
import {
  REBIRTH_SKILL_BONUS_PERCENT_FALLBACK,
  REBIRTH_STAT_BONUS_PERCENT_FALLBACK,
  REBIRTH_STAT_KEYS,
  REBIRTH_STAT_LEVEL_REQUIREMENT_FALLBACK,
  SKILL_LEVEL_SPEED_BONUS_PER_LEVEL_FALLBACK,
  getRebirthSkillBonuses,
  getRebirthStatBonuses,
  type RebirthStatKey,
} from "../../../convex/rebirth";

interface RebirthPanelProps {
  player: any;
}

function readRequirement(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1
    ? value
    : REBIRTH_STAT_LEVEL_REQUIREMENT_FALLBACK;
}

function readFraction(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

const STAT_LABELS: Record<RebirthStatKey, string> = {
  str: "STR",
  dex: "DEX",
  int: "INT",
  luk: "LUK",
  con: "CON",
};

function ProgressRow({
  label,
  value,
  requirement,
  bonusBadge,
}: {
  label: string;
  value: number;
  requirement: number;
  bonusBadge: string | null;
}) {
  const qualified = value >= requirement;
  const progress = Math.min(100, (value / requirement) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground/80">{label}</span>
        <span className="text-muted-foreground">
          {value} / {requirement}
          {bonusBadge && (
            <span className="ml-2 font-semibold text-mystic-glow">
              {bonusBadge}
            </span>
          )}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden bg-forest-deep">
        <div
          className={`h-full transition-[width] ${
            qualified ? "bg-mystic-glow" : "bg-gold"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export function RebirthPanel({ player }: RebirthPanelProps) {
  const canRebirthQuery = useCanRebirth(player._id);
  const rebirthMutation = useRebirth();
  const skillPanel = useSkillPanel(player._id);
  const requirementQuery = useQuery({
    ...convexQuery(api.seed.getGameBalance, {
      key: "rebirthStatLevelRequirement",
    }),
    ...convexQueryCacheOptions,
  });
  const statBonusQuery = useQuery({
    ...convexQuery(api.seed.getGameBalance, {
      key: "rebirthStatBonusPercent",
    }),
    ...convexQueryCacheOptions,
  });
  const skillBonusQuery = useQuery({
    ...convexQuery(api.seed.getGameBalance, {
      key: "rebirthSkillBonusPercent",
    }),
    ...convexQueryCacheOptions,
  });
  const levelSpeedQuery = useQuery({
    ...convexQuery(api.seed.getGameBalance, {
      key: "skillLevelSpeedBonusPerLevel",
    }),
    ...convexQueryCacheOptions,
  });
  const requirement = readRequirement(requirementQuery.data?.value);
  const statBonusPercent = readFraction(
    statBonusQuery.data?.value,
    REBIRTH_STAT_BONUS_PERCENT_FALLBACK
  );
  const skillBonusPercent = readFraction(
    skillBonusQuery.data?.value,
    REBIRTH_SKILL_BONUS_PERCENT_FALLBACK
  );
  const levelSpeedPercent = readFraction(
    levelSpeedQuery.data?.value,
    SKILL_LEVEL_SPEED_BONUS_PER_LEVEL_FALLBACK
  );
  const canRebirth = canRebirthQuery.data === true;
  const statBonuses = getRebirthStatBonuses(player);
  const skillBonuses = getRebirthSkillBonuses(player);
  const qualifyingStats = REBIRTH_STAT_KEYS.filter(
    (stat) => (player[stat] ?? 1) >= requirement
  );
  const skillDefinitions = skillPanel.data?.definitions ?? [];
  const playerSkillById = new Map(
    (skillPanel.data?.playerSkills ?? []).map((skill) => [
      skill.skillId,
      skill.level,
    ])
  );
  const qualifyingSkills = skillDefinitions.filter(
    (skill) => (playerSkillById.get(skill.skillId) ?? 1) >= requirement
  );

  const handleRebirth = async () => {
    if (canRebirthQuery.data === true) {
      await rebirthMutation({ playerId: player._id });
    }
  };

  if (
    canRebirthQuery.isPending ||
    skillPanel.isPending ||
    requirementQuery.isPending ||
    statBonusQuery.isPending ||
    skillBonusQuery.isPending ||
    levelSpeedQuery.isPending
  ) {
    return (
      <Card className="forest-card box-glow-purple min-h-[260px] p-4">
        <p className="text-sm text-muted-foreground">Loading rebirth...</p>
      </Card>
    );
  }

  if (
    (canRebirthQuery.isError && !canRebirthQuery.data) ||
    (requirementQuery.isError && !requirementQuery.data) ||
    (statBonusQuery.isError && !statBonusQuery.data) ||
    (skillBonusQuery.isError && !skillBonusQuery.data) ||
    (levelSpeedQuery.isError && !levelSpeedQuery.data) ||
    (skillPanel.isError && !skillPanel.data)
  ) {
    return (
      <Card className="forest-card box-glow-purple min-h-[260px] p-4">
        <p className="text-sm text-blood-light" role="alert">
          Unable to load rebirth data.
        </p>
      </Card>
    );
  }

  const statBonusLabel = `+${Math.round(statBonusPercent * 100)}%`;
  const skillBonusLabel = `+${Math.round(skillBonusPercent * 100)}%`;
  const rewardLabels = [
    ...qualifyingStats.map((stat) => `${statBonusLabel} ${STAT_LABELS[stat]}`),
    ...qualifyingSkills.map(
      (skill) => `${skillBonusLabel} ${skill.name} speed`
    ),
  ];

  return (
    <Card className="forest-card box-glow-purple p-4 space-y-4">
      <div>
        <h3 className="font-heading text-mystic-glow glow-purple mb-2">Rebirth</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-foreground/70">Rebirths Completed</span>
            <span className="font-bold">{player.rebirthCount}</span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Combat stats
        </p>
        {REBIRTH_STAT_KEYS.map((stat) => {
          const value = player[stat] ?? 1;
          const count = statBonuses[stat] ?? 0;
          return (
            <ProgressRow
              key={stat}
              label={STAT_LABELS[stat]}
              value={value}
              requirement={requirement}
              bonusBadge={
                count > 0 ? `${statBonusLabel} ×${count}` : null
              }
            />
          );
        })}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Skills · +{Math.round(levelSpeedPercent * 100)}% speed per level
        </p>
        {skillDefinitions.map((skill) => {
          const value = playerSkillById.get(skill.skillId) ?? 1;
          const count = skillBonuses[skill.skillId] ?? 0;
          return (
            <ProgressRow
              key={skill.skillId}
              label={skill.name}
              value={value}
              requirement={requirement}
              bonusBadge={
                count > 0 ? `${skillBonusLabel} ×${count}` : null
              }
            />
          );
        })}
      </div>

      {canRebirth ? (
        <Button
          onClick={handleRebirth}
          className="w-full bg-mystic/30 hover:bg-mystic/50 text-mystic-glow border border-mystic/40"
        >
          ✨ REBIRTH ({rewardLabels.join(", ")})
        </Button>
      ) : (
        <Button disabled className="w-full bg-forest-dark/50 text-muted-foreground border border-forest-light/10">
          Train a stat or skill to {requirement} to Rebirth
        </Button>
      )}

      <div className="forest-panel p-3 text-xs text-muted-foreground">
        <p className="mb-2">
          Rebirth resets all stats and skills to level 1, clears combat
          experience, and returns you to Tier 1. You will pick a new starter
          weapon for the next run. Each stat at {requirement} banks a
          permanent {statBonusLabel} bonus to that stat, and each skill at{" "}
          {requirement} banks {skillBonusLabel} action speed for that skill —
          max the same stat or skill again next run to stack it.
        </p>
      </div>
    </Card>
  );
}
