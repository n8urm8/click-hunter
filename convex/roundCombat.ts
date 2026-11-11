import {
  castDueAbilities,
  damageWithBuffs,
  mitigateWithBuffs,
} from "./abilityCombat";
import type { AbilityCombatState } from "./abilityCombat";

/**
 * Shared round-exchange core for the discrete-round encounters: the PvP
 * arena, ranked bouts, and guild raids.
 *
 * All three fight the same way — every fighter casts its due abilities,
 * then every fighter swings, then the round is judged — so the order and the
 * damage pipeline live here once instead of being copied per encounter. The
 * pure ability core in `abilityCombat.ts` owns cast resolution; this module
 * owns the round around it.
 *
 * What legitimately differs per encounter is the numbers, and those arrive
 * through the seams below: how hard a fighter swings (`planSwing`), how a
 * fighter reduces what it receives (`reduceIncoming`), and where an ally
 * heal lands (`RoundSide.allyHeal`).
 */

/** One swing of a fighter at one target, before any buff or reduction. */
export interface RoundSwing {
  target: RoundFighter;
  /** Raw damage, before the attacker's buffs and the target's mitigations. */
  damage: number;
  isCrit: boolean;
}

/**
 * A fighter inside a round exchange.
 *
 * The exchange mutates `hp`, `alive`, `damageDealt`, and the frozen
 * `abilityState` in place, so callers persist the same objects they passed
 * in — no copying of cooldowns or buffs.
 */
export interface RoundFighter {
  /** Stable identity, used to key the round log. */
  id: string;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Mitigation used when this fighter is the target of an ability. */
  defense: number;
  magicalDefense: number;
  /** Elemental ward, used by raid dragon breath. */
  ward?: number;
  /** Frozen ability state (round-based cooldowns). Mutated in place. */
  abilityState?: AbilityCombatState;
  /** Cumulative damage dealt. Threat and reporting read this. */
  damageDealt?: number;
  /**
   * Plan this fighter's swings for the round. Receives every fighter of the
   * opposing side (alive or not) and the round number.
   */
  planSwing: (opponents: RoundFighter[], round: number) => RoundSwing[];
  /**
   * Reduction applied to damage this fighter receives, after mitigation
   * buffs. The arena rounds and clamps; the raid dragon's tough skin
   * scales. Omit for no reduction.
   */
  reduceIncoming?: (damage: number) => number;
  /**
   * Multiplier applied to this fighter's outgoing ability damage (the raid's
   * tough skin). Defaults to 1.
   */
  abilityDamageMultiplier?: number;
}

/** One side of an exchange: the fighters acting, and where ally heals land. */
export interface RoundSide {
  fighters: RoundFighter[];
  /**
   * Sink for `target: "ally"` heals, returning the HP actually restored.
   * When omitted an ally heal lands on the caster (the 1v1 encounters).
   */
  allyHeal?: (amount: number) => number;
}

/** What one round did, keyed by fighter id. */
export interface RoundExchangeLog {
  round: number;
  /** Damage dealt this round (abilities + swings). */
  damage: Record<string, number>;
  /** Ability damage only. */
  abilityDamage: Record<string, number>;
  /** Swing damage only. */
  swingDamage: Record<string, number>;
  /** Whether the fighter landed a crit this round. */
  crit: Record<string, boolean>;
  /** HP after the round. */
  hp: Record<string, number>;
}

function living(fighter: RoundFighter): boolean {
  return fighter.alive && fighter.hp > 0;
}

/**
 * Run one round of an exchange: every fighter casts, then every fighter
 * swings.
 *
 * A fighter that is already down does not act. A swing at a fallen opponent
 * still lands its damage (the fight ends on the same round), matching how
 * the encounters counted damage before.
 */
export function runRoundExchange(
  sides: RoundSide[],
  options: { round: number; roundIntervalMs: number }
): RoundExchangeLog {
  const { round, roundIntervalMs } = options;
  const log: RoundExchangeLog = {
    round,
    damage: {},
    abilityDamage: {},
    swingDamage: {},
    crit: {},
    hp: {},
  };

  const add = (
    bucket: Record<string, number>,
    id: string,
    amount: number
  ): void => {
    bucket[id] = (bucket[id] ?? 0) + amount;
  };

  // Phase 1 — every fighter casts before anyone swings, so a heal cast this
  // round still lands before the enemy's swing.
  for (let s = 0; s < sides.length; s += 1) {
    const side = sides[s];
    const opposing = sides[(s + 1) % sides.length];
    for (const fighter of side.fighters) {
      if (!living(fighter)) continue;
      const state = fighter.abilityState;
      if (!state || state.runtimes.length === 0) continue;
      const target = opposing?.fighters.find(living) ?? null;
      if (!target) continue;
      const cast = castDueAbilities({
        state,
        at: round,
        retryAt: round + 1,
        playerHp: fighter.hp,
        playerMaxHp: fighter.maxHp,
        enemyHp: target.hp,
        enemyStats: {
          defense: target.defense,
          magicalDefense: target.magicalDefense,
        },
        weapon: {
          weaponType: state.weaponType,
          element: state.weaponElement,
        },
        durationUnitMs: roundIntervalMs,
        enemyDamageMultiplier: fighter.abilityDamageMultiplier ?? 1,
        ...(side.allyHeal ? { allyHeal: side.allyHeal } : {}),
      });
      fighter.hp = cast.playerHp;
      fighter.damageDealt = (fighter.damageDealt ?? 0) + cast.damageDealt;
      target.hp = cast.enemyHp;
      target.alive = target.hp > 0;
      add(log.abilityDamage, fighter.id, cast.damageDealt);
      add(log.damage, fighter.id, cast.damageDealt);
    }
  }

  // Phase 2 — every fighter swings.
  for (let s = 0; s < sides.length; s += 1) {
    const side = sides[s];
    const opponents = sides[(s + 1) % sides.length]?.fighters ?? [];
    for (const fighter of side.fighters) {
      if (!living(fighter)) continue;
      if (opponents.length === 0) continue;
      for (const swing of fighter.planSwing(opponents, round)) {
        const target = swing.target;
        if (!target) continue;
        const buffed = damageWithBuffs(
          swing.damage,
          fighter.abilityState?.buffs ?? [],
          round
        );
        const mitigated = mitigateWithBuffs(
          buffed,
          target.abilityState?.buffs ?? [],
          round
        );
        const reduced = target.reduceIncoming
          ? target.reduceIncoming(mitigated)
          : mitigated;
        const dealt = Math.max(0, reduced);
        target.hp = Math.max(0, target.hp - dealt);
        target.alive = target.hp > 0;
        fighter.damageDealt = (fighter.damageDealt ?? 0) + dealt;
        add(log.swingDamage, fighter.id, dealt);
        add(log.damage, fighter.id, dealt);
        if (swing.isCrit) log.crit[fighter.id] = true;
      }
    }
  }

  for (const side of sides) {
    for (const fighter of side.fighters) {
      log.hp[fighter.id] = fighter.hp;
    }
  }
  return log;
}

/** Most swings one fighter takes in a single round, however fast it is. */
export const MAX_SWINGS_PER_ROUND = 10;

/**
 * How many times a fighter swings in `round`, so attack speed matters in the
 * round-based encounters the same way it does in real-time ones.
 *
 * A fighter averages `attackSpeed × roundIntervalMs / 1000` swings a round.
 * The fraction carries over between rounds without stored state: the swings
 * due in a round are the whole swings completed by its end minus those
 * completed by the end of the previous one. At the default 0.5 attacks per
 * second and 2s rounds that is exactly one swing a round. A fighter with no
 * attack speed (snapshots taken before speed counted) swings once.
 */
export function swingsInRound(
  round: number,
  attackSpeed: number | undefined,
  roundIntervalMs: number
): number {
  if (attackSpeed === undefined) return 1;
  const perRound = Math.min(
    MAX_SWINGS_PER_ROUND,
    Math.max(0, (attackSpeed * roundIntervalMs) / 1000)
  );
  // The epsilon keeps float error (0.7 × 3 = 2.0999…) from dropping a swing.
  const completed = (r: number) => Math.floor(r * perRound + 1e-9);
  return Math.max(0, completed(round) - completed(round - 1));
}

/** How a duel ended. */
export type DuelVerdict =
  | { type: "ongoing" }
  | { type: "draw" }
  | { type: "win"; winner: 0 | 1; reason: "knockout" | "rounds" };

/**
 * Judge a two-fighter duel after a round.
 *
 * A knockout decides it outright. When the round limit is reached the
 * fighter with the larger remaining HP fraction wins. Ranked additionally
 * draws when both fighters are on the same remaining HP (`drawOnEqualHp`),
 * even if their pools differ.
 */
export function resolveDuelVerdict(args: {
  hpA: number;
  maxHpA: number;
  hpB: number;
  maxHpB: number;
  round: number;
  maxRounds: number;
  drawOnEqualHp?: boolean;
}): DuelVerdict {
  const { hpA, hpB, maxHpA, maxHpB, round, maxRounds } = args;
  if (hpA <= 0 && hpB <= 0) return { type: "draw" };
  if (hpA <= 0) return { type: "win", winner: 1, reason: "knockout" };
  if (hpB <= 0) return { type: "win", winner: 0, reason: "knockout" };
  if (round < maxRounds) return { type: "ongoing" };
  if (args.drawOnEqualHp && hpA === hpB) return { type: "draw" };
  const fracA = hpA / Math.max(1, maxHpA);
  const fracB = hpB / Math.max(1, maxHpB);
  if (fracA === fracB) return { type: "draw" };
  return { type: "win", winner: fracA > fracB ? 0 : 1, reason: "rounds" };
}
