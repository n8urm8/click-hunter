import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";

const mocks = vi.hoisted(() => {
  const bolt = {
    abilityId: "arcane_bolt",
    name: "Arcane Bolt",
    description: "A starter spell.",
    type: "attack",
    target: "enemy",
    weaponType: "staff",
    element: "arcane",
    tier: 0,
    icon: null,
    level: 3,
    experience: 0,
    totalExperience: 0,
    maxLevel: 10,
    equippedSlot: 0,
    usableWithWeapon: true,
  };
  const heal = {
    abilityId: "healing_touch",
    name: "Healing Touch",
    description: "Restores health.",
    type: "heal",
    target: "self",
    weaponType: "any",
    element: null,
    tier: 2,
    icon: null,
    level: 1,
    experience: 0,
    totalExperience: 0,
    maxLevel: null,
    equippedSlot: null,
    usableWithWeapon: true,
  };
  return {
    panel: {
      isPending: false,
      data: {
        maxSlots: 2,
        maxPossibleSlots: 4,
        wisdom: { level: 34, currentXp: 0, xpToNext: 100 },
        powerMultiplier: 1.25,
        weaponType: "staff",
        slots: [
          { slot: 0, locked: false, ability: bolt },
          { slot: 1, locked: false, ability: null },
          { slot: 2, locked: true, ability: null },
          { slot: 3, locked: true, ability: null },
        ],
        known: [bolt, heal],
        books: [
          {
            playerItemId: "playerItems_1",
            abilityId: "arcane_bolt",
            itemId: "ability_book_arcane_bolt_1",
            itemName: "Tome of Arcane Bolt",
            quantity: 2,
            bookTier: 1,
            xpValue: 200,
          },
        ],
      },
    },
    equip: vi.fn(),
    unequip: vi.fn(),
    useBook: vi.fn(),
  };
});

vi.mock("~/hooks/useAbilities", () => ({
  useAbilityPanel: () => mocks.panel,
  useEquipAbility: () => mocks.equip,
  useUnequipAbility: () => mocks.unequip,
  useUseAbilityBook: () => mocks.useBook,
}));

import { AbilitiesPanel } from "./AbilitiesPanel";

test("renders slots, known abilities, locked slots, and ability books", () => {
  const html = renderToStaticMarkup(
    <AbilitiesPanel playerId={"players_1" as Id<"players">} />
  );

  expect(html).toContain("Wisdom Lv 34");
  expect(html).toContain("+25% ability power");
  expect(html).toContain("2/4 slots");
  expect(html).toContain("Arcane Bolt");
  expect(html).toContain("Healing Touch");
  expect(html).toContain("Locked");
  expect(html).toContain("Tome of Arcane Bolt");
  expect(html).toContain("+200 XP");
});
