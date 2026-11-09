import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requirePlayer, requirePlayerRead, requirePlayerOwner } from "./playerAuth";
import { settleTasksBeforeInteraction } from "./taskSettlement";
import {
  canUseAbilityWithWeapon,
  equipAbility as equipAbilityRow,
  getAbilityDefinition,
  getPlayerAbilities,
  getPlayerEquippedAbilities,
  unequipAbility as unequipAbilityRow,
} from "./abilities";
import { consumeAbilityBook, getPlayerAbilityBooks } from "./abilityBooks";
import { getEquippedWeapon } from "./items";
import {
  getMaxEquippedAbilities,
  getPlayerWisdomProgress,
  getWisdomPowerMultiplier,
  readWisdomBalance,
} from "./wisdom";

/**
 * Player-facing abilities API. This is the read/write surface the inventory
 * "Abilities" tab consumes; the gameplay helpers live in `abilities.ts` and
 * `abilityCombat.ts`.
 *
 * The slot cap is a balance value (`wisdomMaxSlots`), not a constant here.
 */

/** Shape returned for one learned ability (also embedded inside a slot). */
interface AbilityEntry {
  abilityId: string;
  name: string;
  description: string;
  type: string;
  target: string;
  weaponType: string;
  element: string | null;
  tier: number;
  icon: string | null;
  level: number;
  experience: number;
  totalExperience: number;
  maxLevel: number | null;
  equippedSlot: number | null;
  usableWithWeapon: boolean;
}

/**
 * Read everything the abilities tab needs in one subscription: unlocked slots
 * and their contents, every learned ability with its level, active wisdom
 * progress, and any ability books on hand.
 */
export const getAbilityPanel = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requirePlayerOwner(ctx, playerId);

    const [wisdom, wisdomBalance, learnedRows, equippedRows, weapon, books] =
      await Promise.all([
        getPlayerWisdomProgress(ctx, playerId),
        readWisdomBalance(ctx),
        getPlayerAbilities(ctx, playerId),
        getPlayerEquippedAbilities(ctx, playerId),
        getEquippedWeapon(ctx, playerId),
        getPlayerAbilityBooks(ctx, playerId),
      ]);

    // The balance already caps the slot count at `wisdomMaxSlots`.
    const maxSlots = getMaxEquippedAbilities(wisdom.level, wisdomBalance);
    const powerMultiplier = getWisdomPowerMultiplier(wisdom.level, wisdomBalance);
    const weaponType = weapon?.weaponType ?? null;
    const equippedByAbility = new Map(
      equippedRows.map((row) => [row.abilityId, row.slot])
    );

    const known: AbilityEntry[] = [];
    for (const learned of learnedRows) {
      const ability = await getAbilityDefinition(ctx, learned.abilityId);
      if (!ability || !ability.enabled) continue;
      known.push({
        abilityId: ability.abilityId,
        name: ability.name,
        description: ability.description,
        type: ability.type,
        target: ability.target,
        weaponType: ability.weaponType,
        element: ability.element ?? null,
        tier: ability.tier,
        icon: ability.icon ?? null,
        level: learned.level,
        experience: learned.experience,
        totalExperience: learned.totalExperience,
        maxLevel: ability.maxLevel ?? null,
        equippedSlot: equippedByAbility.get(ability.abilityId) ?? null,
        usableWithWeapon: canUseAbilityWithWeapon(ability, weaponType),
      });
    }
    known.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

    const equippedBySlot = new Map(equippedRows.map((row) => [row.slot, row]));
    const slots: Array<{
      slot: number;
      locked: boolean;
      ability: AbilityEntry | null;
    }> = [];
    for (let slot = 0; slot < wisdomBalance.maxSlots; slot += 1) {
      if (slot >= maxSlots) {
        slots.push({ slot, locked: true, ability: null });
        continue;
      }
      const equipped = equippedBySlot.get(slot);
      const ability = equipped
        ? known.find((entry) => entry.abilityId === equipped.abilityId) ?? null
        : null;
      slots.push({ slot, locked: false, ability });
    }

    return {
      maxSlots,
      maxPossibleSlots: wisdomBalance.maxSlots,
      wisdom,
      powerMultiplier,
      weaponType,
      slots,
      known,
      books: books.map((book) => ({
        playerItemId: book.playerItemId,
        abilityId: book.abilityId,
        itemId: book.itemId,
        itemName: book.itemName,
        quantity: book.quantity,
        bookTier: book.bookTier,
        xpValue: book.xpValue,
      })),
    };
  },
});

/** Equip a learned ability into one unlocked slot (moving/swapping as needed). */
export const equipAbility = mutation({
  args: {
    playerId: v.id("players"),
    abilityId: v.string(),
    slot: v.number(),
  },
  handler: async (ctx, { playerId, abilityId, slot }) => {
    await requirePlayerOwner(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
    if (!Number.isSafeInteger(slot)) {
      throw new Error("Invalid ability slot");
    }
    // Support drag/click movement: clear the ability's old slot and the target
    // slot's current occupant before writing, so equipping never fails with
    // "already equipped/occupied".
    const equipped = await getPlayerEquippedAbilities(ctx, playerId);
    for (const row of equipped) {
      if (row.abilityId === abilityId && row.slot !== slot) {
        await unequipAbilityRow(ctx, playerId, row.slot);
      } else if (row.slot === slot && row.abilityId !== abilityId) {
        await unequipAbilityRow(ctx, playerId, row.slot);
      }
    }
    await equipAbilityRow(ctx, playerId, abilityId, slot);
    return { abilityId, slot };
  },
});

/** Clear one ability slot. */
export const unequipAbility = mutation({
  args: {
    playerId: v.id("players"),
    slot: v.number(),
  },
  handler: async (ctx, { playerId, slot }) => {
    await requirePlayerOwner(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
    if (!Number.isSafeInteger(slot) || slot < 0) {
      throw new Error("Invalid ability slot");
    }
    await unequipAbilityRow(ctx, playerId, slot);
    return { slot, cleared: true as const };
  },
});

/** Consume ability books from the inventory to grant ability XP. */
export const useAbilityBook = mutation({
  args: {
    playerId: v.id("players"),
    playerItemId: v.id("playerItems"),
    quantity: v.optional(v.number()),
  },
  handler: async (ctx, { playerId, playerItemId, quantity }) => {
    await requirePlayerOwner(ctx, playerId);
    await settleTasksBeforeInteraction(ctx, playerId);
    const granted = await consumeAbilityBook(
      ctx,
      playerId,
      playerItemId,
      quantity ?? 1
    );
    if (!granted) {
      throw new Error("That item is not a usable ability book");
    }
    return granted;
  },
});
