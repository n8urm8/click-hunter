/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as abilities from "../abilities.js";
import type * as abilityBooks from "../abilityBooks.js";
import type * as abilityCombat from "../abilityCombat.js";
import type * as abilityUi from "../abilityUi.js";
import type * as accountModeration from "../accountModeration.js";
import type * as accounts from "../accounts.js";
import type * as achievements from "../achievements.js";
import type * as admin from "../admin.js";
import type * as adminAuth from "../adminAuth.js";
import type * as adminConfig from "../adminConfig.js";
import type * as arena from "../arena.js";
import type * as balance from "../balance.js";
import type * as bazaar from "../bazaar.js";
import type * as biomes from "../biomes.js";
import type * as bossData from "../bossData.js";
import type * as bossFights from "../bossFights.js";
import type * as characterLevel from "../characterLevel.js";
import type * as chat from "../chat.js";
import type * as chatSeedData from "../chatSeedData.js";
import type * as combat from "../combat.js";
import type * as consumableSlots from "../consumableSlots.js";
import type * as crons from "../crons.js";
import type * as endgameGate from "../endgameGate.js";
import type * as events from "../events.js";
import type * as fightHistory from "../fightHistory.js";
import type * as forestCraftingSeed from "../forestCraftingSeed.js";
import type * as guildBuildings from "../guildBuildings.js";
import type * as guildObjectives from "../guildObjectives.js";
import type * as guildRaids from "../guildRaids.js";
import type * as guildStash from "../guildStash.js";
import type * as guilds from "../guilds.js";
import type * as hitRoll from "../hitRoll.js";
import type * as hpProjection from "../hpProjection.js";
import type * as infusion from "../infusion.js";
import type * as init from "../init.js";
import type * as itemTypes from "../itemTypes.js";
import type * as items from "../items.js";
import type * as leaderboards from "../leaderboards.js";
import type * as leatherwork from "../leatherwork.js";
import type * as loot from "../loot.js";
import type * as maintenance from "../maintenance.js";
import type * as migrations from "../migrations.js";
import type * as moderation from "../moderation.js";
import type * as monsterStats from "../monsterStats.js";
import type * as passiveTree from "../passiveTree.js";
import type * as playerAuth from "../playerAuth.js";
import type * as playerBlocks from "../playerBlocks.js";
import type * as playerHp from "../playerHp.js";
import type * as playerProgress from "../playerProgress.js";
import type * as players from "../players.js";
import type * as pvpLoadout from "../pvpLoadout.js";
import type * as pvpSnapshot from "../pvpSnapshot.js";
import type * as ranked from "../ranked.js";
import type * as rebirth from "../rebirth.js";
import type * as recipeValidation from "../recipeValidation.js";
import type * as roundCombat from "../roundCombat.js";
import type * as seed from "../seed.js";
import type * as simLive from "../simLive.js";
import type * as simShared from "../simShared.js";
import type * as skillBonuses from "../skillBonuses.js";
import type * as skillProgression from "../skillProgression.js";
import type * as skills from "../skills.js";
import type * as taskSettlement from "../taskSettlement.js";
import type * as taskTiming from "../taskTiming.js";
import type * as tasks from "../tasks.js";
import type * as testIdentity from "../testIdentity.js";
import type * as testPlayers from "../testPlayers.js";
import type * as tierClears from "../tierClears.js";
import type * as upgrades from "../upgrades.js";
import type * as wisdom from "../wisdom.js";
import type * as zones from "../zones.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  abilities: typeof abilities;
  abilityBooks: typeof abilityBooks;
  abilityCombat: typeof abilityCombat;
  abilityUi: typeof abilityUi;
  accountModeration: typeof accountModeration;
  accounts: typeof accounts;
  achievements: typeof achievements;
  admin: typeof admin;
  adminAuth: typeof adminAuth;
  adminConfig: typeof adminConfig;
  arena: typeof arena;
  balance: typeof balance;
  bazaar: typeof bazaar;
  biomes: typeof biomes;
  bossData: typeof bossData;
  bossFights: typeof bossFights;
  characterLevel: typeof characterLevel;
  chat: typeof chat;
  chatSeedData: typeof chatSeedData;
  combat: typeof combat;
  consumableSlots: typeof consumableSlots;
  crons: typeof crons;
  endgameGate: typeof endgameGate;
  events: typeof events;
  fightHistory: typeof fightHistory;
  forestCraftingSeed: typeof forestCraftingSeed;
  guildBuildings: typeof guildBuildings;
  guildObjectives: typeof guildObjectives;
  guildRaids: typeof guildRaids;
  guildStash: typeof guildStash;
  guilds: typeof guilds;
  hitRoll: typeof hitRoll;
  hpProjection: typeof hpProjection;
  infusion: typeof infusion;
  init: typeof init;
  itemTypes: typeof itemTypes;
  items: typeof items;
  leaderboards: typeof leaderboards;
  leatherwork: typeof leatherwork;
  loot: typeof loot;
  maintenance: typeof maintenance;
  migrations: typeof migrations;
  moderation: typeof moderation;
  monsterStats: typeof monsterStats;
  passiveTree: typeof passiveTree;
  playerAuth: typeof playerAuth;
  playerBlocks: typeof playerBlocks;
  playerHp: typeof playerHp;
  playerProgress: typeof playerProgress;
  players: typeof players;
  pvpLoadout: typeof pvpLoadout;
  pvpSnapshot: typeof pvpSnapshot;
  ranked: typeof ranked;
  rebirth: typeof rebirth;
  recipeValidation: typeof recipeValidation;
  roundCombat: typeof roundCombat;
  seed: typeof seed;
  simLive: typeof simLive;
  simShared: typeof simShared;
  skillBonuses: typeof skillBonuses;
  skillProgression: typeof skillProgression;
  skills: typeof skills;
  taskSettlement: typeof taskSettlement;
  taskTiming: typeof taskTiming;
  tasks: typeof tasks;
  testIdentity: typeof testIdentity;
  testPlayers: typeof testPlayers;
  tierClears: typeof tierClears;
  upgrades: typeof upgrades;
  wisdom: typeof wisdom;
  zones: typeof zones;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  aggregate: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"aggregate">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
