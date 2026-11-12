import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { readBalanceMap } from "./balance";

/**
 * The endgame gate: tiers from `endgameGateTier` up are locked until the
 * player has enough rebirths AND has beaten the boss of the tier just below
 * the gate during the current life (rebirth clears the boss kill, so every
 * life replays the main game before breaking in again).
 *
 * Helpers only: this module registers no Convex functions, so client code
 * that imports gameplay modules stays clean.
 */

type DatabaseCtx = QueryCtx | MutationCtx;

export const ENDGAME_GATE_BALANCE_DEFAULTS = [
  {
    key: "endgameGateTier",
    value: 9,
    description:
      "First endgame tier. Tiers at or above it need the rebirth requirement and this life's boss kill on the tier below",
  },
  {
    key: "endgameRebirthRequirement",
    value: 3,
    description: "Rebirths required before the endgame tiers can be entered",
  },
  {
    key: "endgameTierJumpMultiplier",
    value: 3,
    description:
      "One-time monster and boss stat multiplier from the endgame gate tier up, on top of the per-tier scaling",
  },
];

export type EndgameGate = {
  /** First locked tier. */
  gateTier: number;
  rebirthRequirement: number;
};

export type EndgameGateStatus = EndgameGate & {
  rebirthCount: number;
  /** Highest boss tier beaten since the last rebirth. */
  highestBossDefeated: number;
  hasRebirths: boolean;
  hasGateBoss: boolean;
  unlocked: boolean;
};

function readInteger(value: unknown, fallback: number, minimum: number) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
    ? value
    : fallback;
}

export async function readEndgameGate(ctx: DatabaseCtx): Promise<EndgameGate> {
  const balance = await readBalanceMap(
    ctx,
    ENDGAME_GATE_BALANCE_DEFAULTS.map((entry) => entry.key)
  );
  return {
    gateTier: readInteger(balance.get("endgameGateTier"), 9, 2),
    rebirthRequirement: readInteger(
      balance.get("endgameRebirthRequirement"),
      3,
      0
    ),
  };
}

export function endgameGateStatus(
  player: Pick<Doc<"players">, "rebirthCount" | "highestBossDefeated">,
  gate: EndgameGate
): EndgameGateStatus {
  const rebirthCount = player.rebirthCount ?? 0;
  const highestBossDefeated = player.highestBossDefeated ?? 0;
  const hasRebirths = rebirthCount >= gate.rebirthRequirement;
  const hasGateBoss = highestBossDefeated >= gate.gateTier - 1;
  return {
    ...gate,
    rebirthCount,
    highestBossDefeated,
    hasRebirths,
    hasGateBoss,
    unlocked: hasRebirths && hasGateBoss,
  };
}

/** Why `tier` is locked for this player, or null when it can be fought. */
export function endgameLockReason(
  status: EndgameGateStatus,
  tier: number
): string | null {
  if (tier < status.gateTier || status.unlocked) return null;
  if (!status.hasRebirths) {
    return `Tier ${status.gateTier}+ requires ${status.rebirthRequirement} rebirths (you have ${status.rebirthCount})`;
  }
  return `Defeat the Tier ${status.gateTier - 1} boss in this life to break into Tier ${status.gateTier}`;
}

/** The endgame difficulty jump, in the shape `tierStatScale` takes. */
export async function readEndgameJump(
  ctx: DatabaseCtx
): Promise<{ gateTier: number; jumpMultiplier: number }> {
  const [gate, jump] = await Promise.all([
    readEndgameGate(ctx),
    readBalanceMap(ctx, ["endgameTierJumpMultiplier"]),
  ]);
  const value = jump.get("endgameTierJumpMultiplier");
  return {
    gateTier: gate.gateTier,
    jumpMultiplier:
      typeof value === "number" && Number.isFinite(value) && value >= 1 ? value : 3,
  };
}

/** Throw when `tier` is behind the endgame gate for this player. */
export async function assertTierUnlocked(
  ctx: DatabaseCtx,
  player: Doc<"players">,
  tier: number
): Promise<void> {
  const reason = endgameLockReason(
    endgameGateStatus(player, await readEndgameGate(ctx)),
    tier
  );
  if (reason) throw new Error(reason);
}
