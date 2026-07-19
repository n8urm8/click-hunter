/**
 * Jotai atoms for real-time game state
 * Combat and UI state is local, only outcomes persist to Convex
 */

import { atom } from "jotai";

export interface CurrentFight {
  monsterTier: number;
  monsterType: string;
  monsterHp: number;
  monsterMaxHp: number;
  monsterAttackSpeed: number; // attacks per second
}

export type FightPhase = "idle" | "fighting" | "victory" | "defeat";

export interface ClickAnimation {
  id: string;
  damage: number;
  x: number;
  y: number;
  timestamp: number;
}

// Current fight state (null = not in a fight)
export const currentFightAtom = atom<CurrentFight | null>(null);

// Player HP (local, updated in real-time during combat)
export const playerHpAtom = atom<number>(0);
export const playerMaxHpAtom = atom<number>(0);

// Combat state machine
export const inFightPhaseAtom = atom<FightPhase>("idle");

// Event tracker: what is the player currently doing?
export type GameEvent = 
  | { type: "idle" }
  | { type: "shopping" }
  | { type: "viewing_stats" }
  | { type: "viewing_upgrades" }
  | { type: "viewing_rebirth" }
  | { type: "fighting"; monsterName: string; tier: number }
  | { type: "victory"; reward: { gold: number; exp: number } }
  | { type: "defeat"; monsterName: string };

export const eventTrackerAtom = atom<GameEvent>({ type: "idle" });

// Respawn timer in milliseconds (0 = can fight)
export const respawnTimerAtom = atom<number>(0);
export const clickAnimationsAtom = atom<ClickAnimation[]>([]);

// Discovered hidden spots
// Discovered hidden spots (tracked locally)
export const discoveredSpotsAtom = atom<Set<string>>(
  new Set<string>()
);

// Active right panel tab
export const activePanelAtom = atom<"stats" | "shop" | "upgrades" | "rebirth" | "leaderboard">(
  "stats"
);

// Anonymous player ID (from localStorage)
export const anonymousIdAtom = atom<string>(() => {
  if (typeof window === "undefined") return "";
  const stored = localStorage.getItem("clickHunter_anonymousId");
  if (stored) return stored;
  const newId = crypto.randomUUID();
  localStorage.setItem("clickHunter_anonymousId", newId);
  return newId;
});

// Player name from localStorage
export const playerNameAtom = atom<string | null>(() => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("clickHunter_playerName");
});

// Persisted discovered spots (localStorage)
export const persistedDiscoveredSpotsAtom = atom<Set<string>>(() => {
  if (typeof window === "undefined") return new Set();
  const stored = localStorage.getItem("clickHunter_discoveredSpots");
  if (!stored) return new Set();
  try {
    return new Set(JSON.parse(stored));
  } catch {
    return new Set();
  }
});
