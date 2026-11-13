/**
 * Copy and world data shared by the landing page options.
 * Biome names come straight from the game's world map so the pages stay in
 * sync when biomes are renamed.
 */
import { BIOMES } from "../../../convex/biomes";

export const GAME_NAME = "Gloamwake";
export const TAGLINE = "The hunt goes on after dark.";

export const MAIN_BIOMES = BIOMES.map((b) => ({
  tier: b.tier,
  name: b.name,
  apex: b.monsters.apex,
  element: b.element,
}));

export const PILLARS = [
  {
    key: "hunt",
    title: "Hunt, even while you're away",
    body:
      "Queue up fights and skills, then step away. Your progress keeps building, and the gold, experience and materials are waiting when you return.",
  },
  {
    key: "craft",
    title: "Craft from what you kill",
    body:
      "Every land drops its own hides, bones, ichor and trophies. Turn them into weapons and armor strong enough for the next land.",
  },
  {
    key: "rebirth",
    title: "Rebirth stronger",
    body:
      "When you hit your limit, start over with permanent bonuses. Rebirths unlock a passive tree and abilities that carry into every new run.",
  },
] as const;

export const FELLOWSHIP = [
  {
    title: "Guilds",
    body: "Join a guild to share a bank, build up your hall and take on raids together.",
  },
  {
    title: "The Bazaar",
    body: "Trade materials and gear with other players. Buy, sell, or post an order for what you need.",
  },
  {
    title: "The Arena",
    body: "Put your build up against other players and climb the leaderboards.",
  },
] as const;
