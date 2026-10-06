import { readBalanceMap } from "./balance";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

export const HP_REGEN_BALANCE_DEFAULTS = [
  {
    key: "combatConRegenBasePercent",
    value: 0.005,
    description:
      "Base HP regen as a fraction of max HP per second (0.005 = 0.5%/s before CON scaling)",
  },
  {
    key: "combatConRegenPerPoint",
    value: 0.0002,
    description:
      "Extra HP regen fraction of max HP per second per CON point (0.0002 = +0.02%/s per CON)",
  },
  {
    key: "combatConRegenCapPercent",
    value: 0.02,
    description:
      "Maximum CON-based HP regen as a fraction of max HP per second (0.02 = 2%/s cap)",
  },
  {
    key: "combatOutOfCombatRegenMultiplier",
    value: 3,
    description:
      "Multiplier on CON regen while not in an active fight (out-of-combat recovery speed)",
  },
] as const;

type DatabaseCtx = QueryCtx | MutationCtx;

function readFraction(value: unknown, fallback: number) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : fallback;
}

export async function readHpRegenBalance(ctx: DatabaseCtx) {
  const values = await readBalanceMap(
    ctx,
    HP_REGEN_BALANCE_DEFAULTS.map((entry) => entry.key)
  );
  const base = readFraction(
    values.get("combatConRegenBasePercent"),
    HP_REGEN_BALANCE_DEFAULTS[0].value
  );
  const perPoint = readFraction(
    values.get("combatConRegenPerPoint"),
    HP_REGEN_BALANCE_DEFAULTS[1].value
  );
  const cap = readFraction(
    values.get("combatConRegenCapPercent"),
    HP_REGEN_BALANCE_DEFAULTS[2].value
  );
  const outOfCombatRaw = readFraction(
    values.get("combatOutOfCombatRegenMultiplier"),
    HP_REGEN_BALANCE_DEFAULTS[3].value
  );
  return {
    base,
    perPoint,
    cap,
    outOfCombatMultiplier: Math.max(1, outOfCombatRaw),
  };
}

export function conRegenFraction(
  con: number,
  balance: { base: number; perPoint: number; cap: number }
) {
  const safeCon = Number.isFinite(con) ? Math.max(0, con) : 0;
  return Math.min(balance.cap, balance.base + safeCon * balance.perPoint);
}

export function conRegenPerSecond(
  maxHp: number,
  con: number,
  balance: { base: number; perPoint: number; cap: number }
) {
  if (!Number.isFinite(maxHp) || maxHp <= 0) return 0;
  return maxHp * conRegenFraction(con, balance);
}

/**
 * Resolve persistent HP, applying out-of-combat regen for elapsed wall time.
 * Returns current HP clamped to [0, maxHp]. Does not write; caller persists.
 */
export function resolveCurrentHp(
  player: Doc<"players">,
  maxHp: number,
  conTotal: number,
  regenBalance: { base: number; perPoint: number; cap: number; outOfCombatMultiplier: number },
  now: number,
  inCombat: boolean
): { currentHp: number; maxHp: number } {
  const safeMax = Math.max(1, Math.ceil(maxHp));
  const stored = player.currentHp;
  const storedAt = player.currentHpUpdatedAt;
  let current =
    typeof stored === "number" && Number.isFinite(stored)
      ? Math.min(safeMax, Math.max(0, stored))
      : safeMax;
  // First sight of the field: treat as full HP.
  if (stored === undefined || storedAt === undefined) {
    return { currentHp: current, maxHp: safeMax };
  }
  if (!inCombat && current < safeMax) {
    const elapsedMs = Math.max(0, now - storedAt);
    if (elapsedMs > 0) {
      const rate =
        conRegenPerSecond(safeMax, conTotal, regenBalance) *
        regenBalance.outOfCombatMultiplier;
      current = Math.min(safeMax, current + (rate * elapsedMs) / 1000);
    }
  }
  // Max-HP shrinks (gear/passive change) clamp down; growth does not auto-fill.
  return { currentHp: current, maxHp: safeMax };
}

export async function writePlayerHp(
  ctx: MutationCtx,
  playerId: Doc<"players">["_id"],
  currentHp: number,
  maxHp: number,
  now: number
) {
  const safeMax = Math.max(1, Math.ceil(maxHp));
  const clamped = Math.min(safeMax, Math.max(0, currentHp));
  await ctx.db.patch(playerId, {
    currentHp: clamped,
    currentHpUpdatedAt: now,
    lastUpdated: now,
  });
  return clamped;
}
