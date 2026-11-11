/**
 * Test helper: insert a character across `players`, `playerProgress` and
 * `playerHp`. Tests describe a character with the legacy flat shape (gold, XP,
 * stat XP and HP on one object), and this writes each part to its own row.
 * Not a Convex function; only the test files import it.
 */
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  insertPlayerProgress,
  readPlayerProgress,
  readPlayerProgressOrNull,
} from "./playerProgress";
import { readPlayerHpOrNull } from "./playerHp";

/** The legacy flat character: the stable row plus wallet and HP fields. */
type TestWalletFields = {
  gold?: number;
  totalExperience?: number;
  statXp?: Doc<"playerProgress">["statXp"];
  currentHp?: number;
  currentHpUpdatedAt?: number;
};

export type TestPlayerInput = Omit<Doc<"players">, "_id" | "_creationTime"> &
  TestWalletFields;

export type TestPlayerPatch = Partial<Omit<Doc<"players">, "_id" | "_creationTime">> &
  TestWalletFields;

/** Read a character as the flat shape tests expect; wallet and HP come from their rows. */
export async function playerWithRecords(ctx: QueryCtx | MutationCtx, playerId: Id<"players">) {
  const player = await ctx.db.get(playerId);
  if (!player) return null;
  const progress = await readPlayerProgressOrNull(ctx, playerId);
  const hp = await readPlayerHpOrNull(ctx, playerId);
  return {
    ...player,
    gold: progress?.gold,
    totalExperience: progress?.totalExperience,
    statXp: progress?.statXp,
    currentHp: hp?.currentHp,
    currentHpUpdatedAt: hp?.currentHpUpdatedAt,
  };
}

/** Patch a character given in the flat shape, writing each field to its row. */
export async function patchPlayerWithRecords(
  ctx: MutationCtx,
  playerId: Id<"players">,
  patch: TestPlayerPatch
): Promise<void> {
  const { gold, totalExperience, statXp, currentHp, currentHpUpdatedAt, ...stable } = patch;
  if (Object.keys(stable).length > 0) {
    await ctx.db.patch(playerId, stable);
  }
  const walletPatch = {
    ...(gold === undefined ? {} : { gold }),
    ...(totalExperience === undefined ? {} : { totalExperience }),
    ...(statXp === undefined ? {} : { statXp }),
  };
  if (Object.keys(walletPatch).length > 0) {
    const progress = await readPlayerProgress(ctx, playerId);
    // A test that stamps lastUpdated (the stale-edit token) stamps the wallet row too.
    await ctx.db.patch(progress._id, { ...walletPatch, updatedAt: stable.lastUpdated ?? Date.now() });
  }
  if (currentHp !== undefined || currentHpUpdatedAt !== undefined) {
    const hp = await readPlayerHpOrNull(ctx, playerId);
    const hpPatch = {
      ...(currentHp === undefined ? {} : { currentHp }),
      ...(currentHpUpdatedAt === undefined ? {} : { currentHpUpdatedAt }),
    };
    if (hp) await ctx.db.patch(hp._id, hpPatch);
    else await ctx.db.insert("playerHp", { playerId, ...hpPatch });
  }
}

export async function insertPlayerWithRecords(
  ctx: MutationCtx,
  input: TestPlayerInput
): Promise<Id<"players">> {
  const {
    gold = 0,
    totalExperience = 0,
    statXp,
    currentHp,
    currentHpUpdatedAt,
    ...player
  } = input;
  const playerId = await ctx.db.insert("players", player);
  await insertPlayerProgress(ctx, playerId, {
    gold,
    totalExperience,
    statXp,
    updatedAt: player.lastUpdated,
  });
  if (currentHp !== undefined || currentHpUpdatedAt !== undefined) {
    await ctx.db.insert("playerHp", { playerId, currentHp, currentHpUpdatedAt });
  }
  return playerId;
}
