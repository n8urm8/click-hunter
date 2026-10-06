/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as achievements from "../achievements.js";
import type * as admin from "../admin.js";
import type * as adminAuth from "../adminAuth.js";
import type * as adminConfig from "../adminConfig.js";
import type * as auth from "../auth.js";
import type * as balance from "../balance.js";
import type * as bazaar from "../bazaar.js";
import type * as bossData from "../bossData.js";
import type * as bossFights from "../bossFights.js";
import type * as characterLevel from "../characterLevel.js";
import type * as chat from "../chat.js";
import type * as chatSeedData from "../chatSeedData.js";
import type * as combat from "../combat.js";
import type * as consumableSlots from "../consumableSlots.js";
import type * as events from "../events.js";
import type * as forestCraftingSeed from "../forestCraftingSeed.js";
import type * as http from "../http.js";
import type * as infusion from "../infusion.js";
import type * as init from "../init.js";
import type * as itemTypes from "../itemTypes.js";
import type * as items from "../items.js";
import type * as leaderboards from "../leaderboards.js";
import type * as leatherwork from "../leatherwork.js";
import type * as loot from "../loot.js";
import type * as migrations from "../migrations.js";
import type * as passiveTree from "../passiveTree.js";
import type * as playerAuth from "../playerAuth.js";
import type * as playerHp from "../playerHp.js";
import type * as players from "../players.js";
import type * as recipeValidation from "../recipeValidation.js";
import type * as seed from "../seed.js";
import type * as skillBonuses from "../skillBonuses.js";
import type * as skillProgression from "../skillProgression.js";
import type * as skills from "../skills.js";
import type * as taskSettlement from "../taskSettlement.js";
import type * as taskTiming from "../taskTiming.js";
import type * as tasks from "../tasks.js";
import type * as upgrades from "../upgrades.js";
import type * as zones from "../zones.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  achievements: typeof achievements;
  admin: typeof admin;
  adminAuth: typeof adminAuth;
  adminConfig: typeof adminConfig;
  auth: typeof auth;
  balance: typeof balance;
  bazaar: typeof bazaar;
  bossData: typeof bossData;
  bossFights: typeof bossFights;
  characterLevel: typeof characterLevel;
  chat: typeof chat;
  chatSeedData: typeof chatSeedData;
  combat: typeof combat;
  consumableSlots: typeof consumableSlots;
  events: typeof events;
  forestCraftingSeed: typeof forestCraftingSeed;
  http: typeof http;
  infusion: typeof infusion;
  init: typeof init;
  itemTypes: typeof itemTypes;
  items: typeof items;
  leaderboards: typeof leaderboards;
  leatherwork: typeof leatherwork;
  loot: typeof loot;
  migrations: typeof migrations;
  passiveTree: typeof passiveTree;
  playerAuth: typeof playerAuth;
  playerHp: typeof playerHp;
  players: typeof players;
  recipeValidation: typeof recipeValidation;
  seed: typeof seed;
  skillBonuses: typeof skillBonuses;
  skillProgression: typeof skillProgression;
  skills: typeof skills;
  taskSettlement: typeof taskSettlement;
  taskTiming: typeof taskTiming;
  tasks: typeof tasks;
  upgrades: typeof upgrades;
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
