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
import type * as events from "../events.js";
import type * as init from "../init.js";
import type * as leaderboards from "../leaderboards.js";
import type * as migrations from "../migrations.js";
import type * as players from "../players.js";
import type * as seed from "../seed.js";
import type * as upgrades from "../upgrades.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  achievements: typeof achievements;
  events: typeof events;
  init: typeof init;
  leaderboards: typeof leaderboards;
  migrations: typeof migrations;
  players: typeof players;
  seed: typeof seed;
  upgrades: typeof upgrades;
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
};
