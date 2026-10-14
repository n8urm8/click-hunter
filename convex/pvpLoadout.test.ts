/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const base = convexTest(schema, modules);
  rateLimiterTest.register(base);
  const stats = { str: 12, dex: 12, int: 12, luk: 12, con: 12 };
  const makePlayer = (subject: string, name: string) =>
    base.run((ctx) =>
      ctx.db.insert("players", {
        anonymousId: `loadout-${subject}`,
        name,
        authSubject: subject,
        role: "admin",
        ...stats,
        gold: 10_000,
        totalExperience: 0,
        rebirthCount: 0,
        rebirthTierThreshold: 5,
        currentTier: 1,
        maxTierReached: 1,
        autoAttackEnabled: true,
        autoStartFightEnabled: false,
        createdAt: 0,
        lastUpdated: 0,
      })
    );
  const makeWeapon = (slug: string, baseDamage: number) =>
    base.run(async (ctx) => {
      const itemId = await ctx.db.insert("items", {
        itemId: slug,
        name: slug,
        category: "equipment",
        description: `${slug} weapon`,
        stackable: false,
        maxStackSize: 1,
        allowedEquipmentSlots: ["mainHand"],
        baseDamage,
        attackSpeed: 1.3,
        damageStat: "dex",
        damageType: "physical",
        createdAt: 0,
        updatedAt: 0,
      });
      return itemId;
    });
  const grant = (
    playerId: Id<"players">,
    itemId: Id<"items">,
    equipped: boolean
  ) =>
    base.run((ctx) =>
      ctx.db.insert("playerItems", {
        playerId,
        itemId,
        quantity: 1,
        ...(equipped ? { equippedSlot: "mainHand" as const } : {}),
        acquiredAt: 0,
        updatedAt: 0,
      })
    );
  const [fighter1, fighter2] = await Promise.all([
    makePlayer("loadout-one", "LoadoutOne"),
    makePlayer("loadout-two", "LoadoutTwo"),
  ]);
  const [strongDef, weakDef] = await Promise.all([
    makeWeapon("strong-blade", 50),
    makeWeapon("weak-blade", 5),
  ]);
  const t = base.withIdentity({ subject: "loadout-one" });
  const t2 = base.withIdentity({ subject: "loadout-two" });
  return { base, t, t2, fighter1, fighter2, strongDef, weakDef, grant };
}

async function startDuel(
  t: Awaited<ReturnType<typeof setup>>["t"],
  t2: Awaited<ReturnType<typeof setup>>["t2"],
  fighter1: Id<"players">,
  fighter2: Id<"players">
) {
  const lobby = await t.mutation(api.arena.createLobby, {
    playerId: fighter1,
    visibility: "general",
    stake: 0,
  });
  await t2.mutation(api.arena.joinLobbyAsFighter, {
    playerId: fighter2,
    lobbyId: lobby._id,
  });
  await t.mutation(api.arena.setReady, {
    playerId: fighter1,
    lobbyId: lobby._id,
    ready: true,
  });
  await t2.mutation(api.arena.setReady, {
    playerId: fighter2,
    lobbyId: lobby._id,
    ready: true,
  });
  vi.setSystemTime(Date.now() + 60_000);
  const started = await t.mutation(api.arena.tickFight, {
    playerId: fighter1,
    lobbyId: lobby._id,
  });
  expect(started.status).toBe("active");
  return started;
}

test("saving validates ownership, slot fit, and equipment-only", async () => {
  const { base, t, t2, fighter1, fighter2, strongDef } = await setup();
  const strongRow = await base.run((ctx) =>
    ctx.db.insert("playerItems", {
      playerId: fighter1,
      itemId: strongDef,
      quantity: 1,
      acquiredAt: 0,
      updatedAt: 0,
    })
  );
  // Another player's row is not yours.
  await expect(
    t2.mutation(api.pvpLoadout.savePvpLoadout, {
      playerId: fighter2,
      slots: [{ slot: "mainHand", playerItemId: strongRow }],
    })
  ).rejects.toThrow("do not own");
  // A weapon does not go on your head.
  await expect(
    t.mutation(api.pvpLoadout.savePvpLoadout, {
      playerId: fighter1,
      slots: [{ slot: "head", playerItemId: strongRow }],
    })
  ).rejects.toThrow("cannot go in that slot");
  // Stackable materials are not equipment.
  const potionDef = await base.run((ctx) =>
    ctx.db.insert("items", {
      itemId: "fiber",
      name: "Fiber",
      category: "crafting",
      description: "Material",
      stackable: true,
      maxStackSize: 99,
      allowedEquipmentSlots: [],
      createdAt: 0,
      updatedAt: 0,
    })
  );
  const potionRow = await base.run((ctx) =>
    ctx.db.insert("playerItems", {
      playerId: fighter1,
      itemId: potionDef,
      quantity: 3,
      acquiredAt: 0,
      updatedAt: 0,
    })
  );
  await expect(
    t.mutation(api.pvpLoadout.savePvpLoadout, {
      playerId: fighter1,
      slots: [{ slot: "mainHand", playerItemId: potionRow }],
    })
  ).rejects.toThrow("cannot go in that slot");
  // The happy path saves exactly what was sent.
  const saved = await t.mutation(api.pvpLoadout.savePvpLoadout, {
    playerId: fighter1,
    slots: [{ slot: "mainHand", playerItemId: strongRow }],
  });
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ slot: "mainHand" });
});

test("loadout query reports saved pieces and equipped fallback", async () => {
  const { t, fighter1, strongDef, weakDef, grant } = await setup();
  const [strongRow, weakRow] = await Promise.all([
    grant(fighter1, strongDef, true),
    grant(fighter1, weakDef, false),
  ]);
  void strongRow;
  await t.mutation(api.pvpLoadout.savePvpLoadout, {
    playerId: fighter1,
    slots: [{ slot: "mainHand", playerItemId: weakRow }],
  });
  const loadout = await t.query(api.pvpLoadout.getPvpLoadout, {
    playerId: fighter1,
  });
  expect(loadout.hasSaved).toBe(true);
  expect(loadout.saved.mainHand?.itemName).toBe("weak-blade");
  // Effective corner uses the saved piece…
  expect(loadout.effective.mainHand?.itemName).toBe("weak-blade");
  // …while unset slots keep showing equipped gear (nothing equipped here).
  expect(loadout.effective.chest).toBeNull();
});

test("arena snapshots fight with the saved loadout, not equipped gear", async () => {
  const { t, t2, fighter1, fighter2, strongDef, weakDef, grant } = await setup();
  // Both fighters share stats; only their steel differs.
  const [aStrong, aWeak] = await Promise.all([
    grant(fighter1, strongDef, true),
    grant(fighter1, weakDef, false),
  ]);
  void aStrong;
  await grant(fighter2, weakDef, true);
  // Fighter one wields steel but banks the weak blade for PvP.
  await t.mutation(api.pvpLoadout.savePvpLoadout, {
    playerId: fighter1,
    slots: [{ slot: "mainHand", playerItemId: aWeak }],
  });

  const started = await startDuel(t, t2, fighter1, fighter2);
  // Both corners resolve the weak blade: identical attack.
  expect(started.fighter1Snapshot?.attack).toBe(
    started.fighter2Snapshot?.attack
  );
  // Corner gear is frozen into the fight record…
  expect(
    started.fighter1Gear?.find((piece) => piece.slot === "mainHand")?.itemName
  ).toBe("weak-blade");
  expect(
    started.fighter2Gear?.find((piece) => piece.slot === "mainHand")?.itemName
  ).toBe("weak-blade");

  // …so re-gearing mid-fight changes nothing viewers see.
  await t.mutation(api.pvpLoadout.savePvpLoadout, {
    playerId: fighter1,
    slots: [{ slot: "mainHand", playerItemId: aStrong }],
  });
  const midFight = await t.query(api.arena.getLobby, {
    playerId: fighter1,
    lobbyId: started._id,
  });
  expect(
    midFight?.fighter1Gear?.find((piece) => piece.slot === "mainHand")?.itemName
  ).toBe("weak-blade");

  // Clearing restores equipped steel in the next snapshot.
  await t.mutation(api.arena.leaveLobby, {
    playerId: fighter1,
    lobbyId: started._id,
  });
  await t.mutation(api.pvpLoadout.clearPvpLoadout, { playerId: fighter1 });
  const rematch = await startDuel(t, t2, fighter1, fighter2);
  expect(rematch.fighter1Snapshot?.attack).toBeGreaterThan(
    rematch.fighter2Snapshot?.attack ?? 0
  );
});

test("stale saved rows fall back to equipped gear", async () => {
  const { base, t, fighter1, strongDef, weakDef, grant } = await setup();
  const [strongRow, weakRow] = await Promise.all([
    grant(fighter1, strongDef, true),
    grant(fighter1, weakDef, false),
  ]);
  void strongRow;
  await t.mutation(api.pvpLoadout.savePvpLoadout, {
    playerId: fighter1,
    slots: [{ slot: "mainHand", playerItemId: weakRow }],
  });
  // The saved blade leaves the inventory (sold/traded/consumed).
  await base.run((ctx) => ctx.db.delete(weakRow));
  const loadout = await t.query(api.pvpLoadout.getPvpLoadout, {
    playerId: fighter1,
  });
  expect(loadout.effective.mainHand?.itemName).toBe("strong-blade");
});
