/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("a visitor who is not signed in has no account state", async () => {
  const t = convexTest(schema, modules);

  const status = await t.query(api.accounts.getAccountStatus, {});

  expect(status).toEqual({
    signedIn: false,
    mutedUntil: 0,
    muteReason: null,
    bannedUntil: 0,
    banReason: null,
  });
});

test("a signed-in account with no moderation reads clean state", async () => {
  const t = convexTest(schema, modules);
  const account = t.withIdentity({ subject: "clerk_user_clean" });

  const status = await account.query(api.accounts.getAccountStatus, {});

  expect(status).toMatchObject({ signedIn: true, mutedUntil: 0, bannedUntil: 0 });
});

test("account status reports the mute and ban keyed to its token identifier", async () => {
  const t = convexTest(schema, modules);
  const account = t.withIdentity({ subject: "clerk_user_moderated" });
  const identity = await account.run((ctx) => ctx.auth.getUserIdentity());
  if (identity === null) throw new Error("expected an identity");
  const now = Date.now();

  await t.run(async (ctx) => {
    await ctx.db.insert("accountModeration", {
      userId: identity.tokenIdentifier,
      mutedUntil: now + 60_000,
      muteReason: "spam",
      bannedUntil: 0,
      updatedAt: now,
    });
  });

  const status = await account.query(api.accounts.getAccountStatus, {});

  expect(status).toMatchObject({
    signedIn: true,
    mutedUntil: now + 60_000,
    muteReason: "spam",
    bannedUntil: 0,
  });
});

test("moderation is not shared with a different account", async () => {
  const t = convexTest(schema, modules);
  const banned = t.withIdentity({ subject: "clerk_user_banned" });
  const other = t.withIdentity({ subject: "clerk_user_other" });
  const bannedIdentity = await banned.run((ctx) => ctx.auth.getUserIdentity());
  if (bannedIdentity === null) throw new Error("expected an identity");

  await t.run(async (ctx) => {
    await ctx.db.insert("accountModeration", {
      userId: bannedIdentity.tokenIdentifier,
      mutedUntil: 0,
      bannedUntil: Number.MAX_SAFE_INTEGER,
      banReason: "cheating",
      updatedAt: Date.now(),
    });
  });

  const status = await other.query(api.accounts.getAccountStatus, {});

  expect(status).toMatchObject({ signedIn: true, bannedUntil: 0, banReason: null });
});
