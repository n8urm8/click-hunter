/**
 * Character level calculation
 *
 * Character level = sum of the 5 combat stat levels + sum of all skill levels.
 *
 * Skill levels are read from playerSkills, where rows are created lazily at
 * level 1 on first use (see ensurePlayerSkill in skills.ts), so enabled skills
 * the player has never started count as level 1.
 */

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type DatabaseCtx = MutationCtx | QueryCtx;

export type CombatStats = {
  str: number;
  dex: number;
  int: number;
  luk: number;
  con: number;
};

export type Character = { _id: Id<"players"> } & CombatStats;

const MAX_SKILL_ROWS = 300;

/**
 * Combat portion of the character level: the sum of the five combat stat
 * levels.
 */
export function calculateCombatLevel(stats: CombatStats): number {
  return stats.str + stats.dex + stats.int + stats.luk + stats.con;
}

/**
 * Sum of a player's skill levels across all enabled skills. Skills without a
 * playerSkills row count as level 1; rows for disabled skills are ignored.
 */
function sumSkillLevels(
  skillDefinitions: Doc<"skillDefinitions">[],
  playerSkills: Doc<"playerSkills">[]
): number {
  const levelsBySkillId = new Map(
    playerSkills.map((playerSkill) => [playerSkill.skillId, playerSkill.level])
  );
  return skillDefinitions.reduce(
    (total, definition) =>
      total + (levelsBySkillId.get(definition.skillId) ?? 1),
    0
  );
}

/**
 * Character level for a single player (combat stats + skill levels).
 */
export async function calculateCharacterLevel(
  ctx: DatabaseCtx,
  character: Character
): Promise<number> {
  const [skillDefinitions, playerSkills] = await Promise.all([
    ctx.db
      .query("skillDefinitions")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .take(MAX_SKILL_ROWS),
    ctx.db
      .query("playerSkills")
      .withIndex("by_playerId", (q) => q.eq("playerId", character._id))
      .take(MAX_SKILL_ROWS),
  ]);
  return (
    calculateCombatLevel(character) +
    sumSkillLevels(skillDefinitions, playerSkills)
  );
}

/**
 * Bulk character level lookup for callers that need levels for many players at
 * once (e.g. the admin player list): loads enabled skills and skill rows once,
 * then returns a synchronous resolver.
 */
export async function createCharacterLevelLookup(
  ctx: DatabaseCtx
): Promise<(character: Character) => number> {
  const [skillDefinitions, playerSkills] = await Promise.all([
    ctx.db
      .query("skillDefinitions")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .take(MAX_SKILL_ROWS),
    // Bounded to cover the admin player list (players take(2000) x skills).
    ctx.db.query("playerSkills").take(10000),
  ]);
  const playerSkillsByPlayer = new Map<Id<"players">, Doc<"playerSkills">[]>();
  for (const playerSkill of playerSkills) {
    const rows = playerSkillsByPlayer.get(playerSkill.playerId);
    if (rows) {
      rows.push(playerSkill);
    } else {
      playerSkillsByPlayer.set(playerSkill.playerId, [playerSkill]);
    }
  }
  return (character) =>
    calculateCombatLevel(character) +
    sumSkillLevels(
      skillDefinitions,
      playerSkillsByPlayer.get(character._id) ?? []
    );
}
