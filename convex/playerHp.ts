import { readBalanceMap } from "./balance";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/** Stored HP fields, read from the `playerHp` row (absent until first write). */
export type StoredHp = {
  currentHp?: number;
  currentHpUpdatedAt?: number;
};

export async function readPlayerHpOrNull(
  ctx: QueryCtx | MutationCtx,
  playerId: Id<"players">
): Promise<Doc<"playerHp"> | null> {
  return await ctx.db
    .query("playerHp")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .unique();
}

export const HP_REGEN_BALANCE_DEFAULTS = [
  {
    key: "combatConRegenBasePercent",
    value: 0.01,
    description:
      "Base HP regen as a fraction of max HP per second (0.01 = 1%/s before CON scaling)",
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
  return { base, perPoint, cap };
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
 * Resolve persistent HP, applying wall-clock regen for elapsed time while out
 * of combat. The rate is the same HP regen used inside fights (no out-of-
 * combat multiplier), so the HUD bar and hunt bars all tick at one rate.
 * Returns current HP clamped to [0, maxHp]. Does not write; caller persists.
 */
export function resolveCurrentHp(
  hp: StoredHp | null,
  maxHp: number,
  conTotal: number,
  regenBalance: { base: number; perPoint: number; cap: number },
  now: number,
  inCombat: boolean
): { currentHp: number; maxHp: number } {
  const safeMax = Math.max(1, Math.ceil(maxHp));
  const stored = hp?.currentHp;
  const storedAt = hp?.currentHpUpdatedAt;
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
      const rate = conRegenPerSecond(safeMax, conTotal, regenBalance);
      current = Math.min(safeMax, current + (rate * elapsedMs) / 1000);
    }
  }
  // Max-HP shrinks (gear/passive change) clamp down; growth does not auto-fill.
  return { currentHp: current, maxHp: safeMax };
}

export async function writePlayerHp(
  ctx: MutationCtx,
  playerId: Id<"players">,
  currentHp: number,
  maxHp: number,
  now: number
) {
  const safeMax = Math.max(1, Math.ceil(maxHp));
  const clamped = Math.min(safeMax, Math.max(0, currentHp));
  const row = await readPlayerHpOrNull(ctx, playerId);
  if (row) {
    await ctx.db.patch(row._id, { currentHp: clamped, currentHpUpdatedAt: now });
  } else {
    await ctx.db.insert("playerHp", {
      playerId,
      currentHp: clamped,
      currentHpUpdatedAt: now,
    });
  }
  return clamped;
}
