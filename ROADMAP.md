# Click Hunter — Implementation Roadmap

## Phase 1 — Wire frontend to database ✅ / 🔄

> Goal: Replace hardcoded config with live database reads so balance can be updated without redeploy.

- [x] **Schema** — Add `monsters`, `upgrades`, `gameBalance`, `hiddenSpots` tables
- [x] **seed.ts** — `populateAll` mutation to upsert all config data
- [x] **init.ts** — Auto-seed tables on first deploy
- [x] **FightArea.tsx** — Uses `useQuery(api.seed.getAllMonsters)` + `getAllGameBalance`; weighted random + tier scaling runs client-side with live DB data
- [x] **ShopPanel.tsx** — Fetches upgrades from `api.seed.getAllUpgrades`; filters by `minTier`
- [x] **HiddenSpots.tsx** — Fetches spots from `api.seed.getHiddenSpots`
- [x] **ActiveFight.tsx** — Looks up monster name from DB instead of static MONSTERS map
- [x] **RebirthPanel.tsx** — Reads `rebirthThresholds` from `api.seed.getGameBalance`
- [x] **convex/upgrades.ts** — `purchaseUpgrade` + `applyUpgradeEffect` read from `upgrades` table (no more frontend import)
- [x] **gameConfig.ts cleanup** — Reduced to types only (`StatType`, `UpgradeCategory`, `MonsterType`); all runtime data in DB

---

## Phase 2 — Leaderboards ✅ (direct tables; write-path unwired)

> Goal: Show top players by experience, tier, and rebirth count.
> Implemented with direct `leaderboardByExperience` / `leaderboardByTier` /
> `leaderboardByRebirth` tables, not `@convex-dev/aggregate`.

- [x] **leaderboards.ts** — `getTopByExperience` / `getTopByTier` / `getTopByRebirth` + `getPlayerRanks` queries; `updateLeaderboards` internal writer
- [x] **LeaderboardPanel.tsx + board route** — Top-10 per category with player ranks; nav via `GameNavbar.tsx` (`/board`), not `GameLayout.tsx`
- [ ] **players.ts** — Wire `updateLeaderboards` on fight victory / rebirth. The writer exists but has no live callers yet (noted in `leaderboards.ts:5-6`), so boards only reflect backfilled/manual rows.

---

## Phase 3 — Achievements ✅ (conditions hardcoded)

> Goal: Reward milestone moments (first kill, high tier, rebirth, rare monster).

- [x] **Schema** — `achievements` table (definitions) + `playerAchievements` table (unlocked state)
- [x] **seed.ts** — Seeds achievement definitions (`first-kill`, `tier-5/10/20`, `first-rebirth`, `tier-100-xp`)
- [x] **achievements.ts** — `unlockAchievement`, `getPlayerAchievements`, `checkAchievementConditions` (server row wins over client claims)
- [x] **AchievementsPanel.tsx** — Locked/unlocked list with progress count
- [x] **AdminPanel.tsx / admin.ts** — `updateAchievement` editor
- [ ] Follow-up: conditions are hardcoded to the 6 IDs above, not table-driven rules; no monster-specific (e.g. "Rat Slayer") or rarity-based checks.

---

## Phase 4 — Rebirth rewards ✅

> Goal: Make rebirth feel meaningful with visible, persistent bonuses.

- [x] **Schema** — `rebirthRewards` + `playerRebirthRewards` tables
- [x] **seed.ts** — Seeds rebirth rewards (gold/XP multipliers, unlocks)
- [x] **players.ts (`canRebirth` / `rebirth`) + rebirth.ts helpers** — Applies rewards on `rebirth()`; stores active rewards on player
- [x] **RebirthPanel.tsx** — Shows upcoming rewards before commit + active bonuses
- [x] **AdminPanel.tsx / admin.ts** — `updateRebirthReward` editor

---

## Phase 5 — Live game management

> Goal: Admin tools to adjust balance and run events without redeploying.

- [x] **Admin role** — Add a temporary server-side player role; new and migrated development accounts are admins
- [x] **Admin API** — Protect immediate-save updates for balance, upgrades, monsters, hidden spots, achievements, rebirth rewards, and events
- [x] **AdminPanel.tsx** — Add role-gated editors with server-validated forms and event creation
- [x] **Schema** — Add `gameEvents` table (start/end timestamps, effect type, value)
- [x] **events.ts / upgrades.ts** — Query active events, apply multipliers to fight rewards, and protect event writes
- [x] **EventBanner.tsx** — Show active event banner in game UI

> The current role is intentionally temporary because the app still uses anonymous IDs. Replace it with authenticated Convex identity-based authorization before production use.

### Live chat

- [x] Persistent World and Private chat card below the fight area
- [x] Extensible channel-keyed message storage for future guild channels
- [x] Server-side recipient validation and 280-character message validation
- [x] Seeded example World messages with idempotent seed identifiers
- [x] Bottom-aware scrolling that pauses while reading older messages
- [x] Private chat list with unread indicators and sender-name private-message actions
- [ ] Group chats with shared channels, participant membership, and group-specific unread state

### Progressive stat-upgrade balance

- [x] Repeatable stat upgrades use paid purchase levels with configurable
  exponential pricing.
- [x] Character-level requirements use an admin-editable Fibonacci sequence.
- [x] Hidden-spot rewards persist and reapply their permanent stat bonuses
  after rebirth without advancing paid shop purchase levels.
- [x] Paid stat-upgrade levels reset on rebirth while automation purchases
  remain permanent.

---

## Phase 6 — Task queue and offline tasking

> Goal: Let players schedule bounded activities that resolve reliably while
> they are online or away.

- [x] **Schema** — Add configurable task definitions, player task queues,
  task state/history, and idempotent completion records.
- [x] **tasks.ts** — Validate task ownership, queue capacity, durations,
  prerequisites, cancellation, and reward settlement on the server.
- [x] **Scheduler** — Resolve due tasks and calculate bounded offline catch-up
  from persisted timestamps rather than client-side timers.
- [x] **TaskQueuePanel.tsx** — Show active, queued, completed, and claimable
  tasks with clear progress and capacity states.
- [x] **AdminPanel.tsx** — Add editors for task definitions, durations,
  capacity, prerequisites, and rewards.
- [x] **Auto-battle** — Queue regular battles by tier for a count, online
  duration, or until stopped; boss fights never run through the queue.

## Phase 7 — Monster drops and loot tables ✅

> Goal: Turn monster and boss victories into configurable item acquisition.

- [x] **Schema** — `lootTables`, `lootSources`, `lootTableEntries`, `lootAwards` tables
- [x] **Combat reward path** — `loot.ts:settleCombatFight` rolls drops server-side on victory (guarantees, rarity rules, idempotent `settlementKey`); called from combat/tasks/boss paths. No direct client-facing query — helper-only by design.
- [x] **InventoryPanel.tsx (cache tab)** — Newly acquired materials/equipment, full-inventory handling, reward summary via `pendingRewards` + `claimPendingReward(s)`
- [x] **Admin API / AdminPanel.tsx** — `create/updateLootTable`, `create/updateLootTableEntry`, `create/updateLootSource` editors + per-monster/boss overrides

## Phase 8 — Equipment progression ✅

> Goal: Build combat progression on the existing item and equipment-slot
> scaffold.

- [x] **Schema** — `items` + `itemRarities` with configurable stats, effects, rarity/quality, level requirements, unique/equip restrictions
- [x] **items.ts** — `getPlayerInventory`, `equipItem/unequipItem`, `grantItemToInventory/consumeItems`, `getEquippedWeapon/getEquippedProfile`; server-side loadout calc, never trusts client stats
- [x] **Combat integration** — Equipped modifiers (incl. enchant/augment tiers) applied via `getEquippedWeapon/Profile` to attack, defense, rewards, and PvP snapshots (`arena.ts`, `pvpLoadout.ts`)
- [x] **InventoryPanel.tsx + Equipment.tsx + ConsumableSlots** — Equipment stats, compare candidates, invalid/restricted loadout surfacing, consumable slots
- [x] **AdminPanel.tsx / admin.ts** — `create/updateItem`, `create/updateItemRarity` editors

## Phase 9 — Crafting ✅ (as skills system; no `crafting.ts`)

> Goal: Convert monster materials into useful equipment and consumables.

- [x] **Schema** — `recipes`, `recipeIngredients`, `recipeOutputs`, `gatheringActivities`, `augmentationDefinitions`, plus `skillDefinitions` / `skillTierDefinitions`
- [x] **tasks.ts (`enqueueSkillAction`) + infusion.ts + recipeValidation.ts** — Atomic validate/consume/produce through inventory rules; timed gathering/crafting/augmentation via the task queue; boss-key-gated `resolveInfusionCraft` / `enchantEquipment`. There is intentionally no single `crafting.ts`.
- [x] **SkillsPanel.tsx + InventoryPanel.tsx + Equipment.tsx** — Recipe browsing, ingredient availability, craft actions, progress, failure/full-inventory states
- [x] **AdminPanel.tsx / admin.ts** — `create/updateSkillDefinition`, `create/updateSkillTierDefinition`, `create/updateGatheringActivity`, `create/updateRecipe`, augmentation editors
- [x] **Leathercrafting** — Hide drops, cured leather, belts, bags, and light armor; delivered to existing deployments with the insert-only `migrations:backfillLeathercrafting` (see `docs/adr/0001-leathercrafting-backfill.md`)

## Phase 10 — Alliances and group battles 🔄 (as guilds; no `alliances.ts`)

> Goal: Add persistent player groups and asynchronous cooperative combat.
> Implemented as **guilds**, not alliances: `guilds.ts` + `guildRaids.ts` +
> `guildObjectives.ts` + `GuildPanel.tsx`.

- [x] **Schema** — `guilds`, `guildMembers`, `guildApplications`, `guildBonuses`, `guildRaids`, `guildWeeklyObjectives`, `guildLeaderboard`
- [x] **guilds.ts** — 21 exports: create/disband/leave/invite/apply/accept/decline/kick/promote/demote/deposit/withdraw + `getMyGuild/getGuildById/getMembers/getPendingApplications/getGuildBonuses/getGuildConfig/searchGuilds/getGuildLeaderboard`
- [x] **Group battles (as raids)** — `guildRaids.ts:startRaid/createRaidParty/joinRaid/beginRaid/tickRaid/getGuildRaids` with persisted snapshots, automatic rounds (no manual battling) + `guildObjectives.ts:progressWeeklyObjectives`
- [x] **GuildPanel.tsx + guild routes** — hall/roster/bank/raids/objectives/browse/create views (`/guild/:view`)
- [x] **AdminPanel.tsx (guilds section)** — Guild admin editors via `admin.getConfig({ section: "guilds" })`
- [ ] Still missing vs spec: file named `alliances.ts` / `GroupBattlePanel.tsx`, guild shared-channel chat (see group-chat item in Phase 5), admin battle-window/participation-rule controls beyond current guilds section.
- [ ] **TODO — raid dragon summoning cost (guild bank).** Balance key `guildRaidSummonGoldCost` exists (default `0` = free) and `startRaid` already deducts it from guild gold when the tier's first lobby is summoned (`convex/guildRaids.ts:711-724`). Still to decide: flat vs per-tier escalating price, whether the week's first summon is free, boss-key alternative, and officer-only spend/permission rules. Do not hardcode a price — set it through the admin/seeded balance entry. Related gap: `createRaidParty` currently only checks tier unlock/slain state, so a plain member can open the first lobby for a tier without an officer summon; decide whether to require an existing summon row (per the "officers summon, members party" rule) before wiring the cost.
- [ ] **TODO — raid boss reward tuning.** Current payout: every qualifying damager gets full solo-boss gold + XP once per player per tier per week (dedup via `guildRaidXpGrants`), and the killing blow rolls the tier boss loot table into the guild stash. Multipliers `guildRaidRewardGoldMultiplier` / `guildRaidRewardXpMultiplier` are both `1` (`convex/guilds.ts:54-58`). Still to decide: flat split vs damage-share, per-tier reward scaling, weekly lockouts, and stash withdrawal/entitlement rules for members who did not fight. Keep all tunables in `gameBalance` and expose them via the admin editor.

## Phase 11 — PvP arena ✅ (lobby-based; in working tree, uncommitted)

> Goal: Provide fair, asynchronous player-versus-player competition.
> NOTE: implemented as **lobby-based duels with `tickFight` + spectators**,
> not the async-matchmaking design in the original spec. Files exist in the
> working tree but are still untracked (`git status`).

- [x] **Schema** — Arena lobbies/matches/snapshots/results, ranked seasons/league, PvP loadouts
- [x] **arena.ts** — 16 exports: `createLobby/joinLobbyAsFighter/quickMatch/leaveLobby/cancelLobby/kickFromLobby/joinAsSpectator/setReady/tickFight/forfeitFight/expireStaleLobbies` + `getPvpConfig/getOpenLobbies/getLobby/getMyLobby/getRecentResults`
- [x] **ranked.ts + pvpLoadout.ts** — `joinRankedLeague/fightRankedBattle/settleRankedWeek` + seasonal leaderboard/opponents; `getPvpLoadout/savePvpLoadout/clearPvpLoadout`
- [x] **ArenaPanel.tsx / RankedPanel.tsx / LoadoutPanel.tsx / DuelPlayback.tsx / LobbyChat.tsx + `/arena` route** — Queue/lobby state, opponent/match status, history, ratings, standings, rewards
- [x] **Tests** — `arena.test.ts`, `ranked.test.ts`, `pvpLoadout.test.ts`, `chatArena.test.ts`
- [ ] Admin matchmaking/rating/reward controls live only in general balance entries (`backfillArenaBalance`, `backfillRankedBalance`) — no dedicated arena section in `admin.getConfig` (sections: monsters/items/skills/tree/guilds/general).

## Phase 12 — Alliance wars ❌ (not started)

> Goal: Let alliances compete in scheduled, objective-based campaigns.

- [ ] **Schema** — No war tables exist (no declarations, schedules, locked rosters, objectives, score events, standings, results, reward claims)
- [ ] **allianceWars.ts** — Does not exist
- [ ] **AllianceWarsPanel.tsx** — Does not exist
- [ ] **AdminPanel.tsx** — No war cadence/objective/scoring/eligibility/reward controls

### New-system architecture constraints

- All tunable gameplay values must be seeded or configured Convex balance or
  domain records and exposed through the existing admin editor; do not add
  client-only gameplay constants.
- Task completion, loot rolls, equipment effects, crafting outputs, and
  multiplayer results must be server-authoritative and safe to retry.
- Alliances, group battles, arena matches, and wars were planned as
  asynchronous/server-resolved systems rather than real-time combat.
  Deviation: the shipped arena is lobby-based with `tickFight` + spectators,
  not async matchmaking. Keep this in mind for wars design.
- Replace anonymous-ID authorization with authenticated Convex identity checks
  before production use of alliance membership, shared rewards, or PvP
  ownership. Current state: `convex/auth.ts` is Anonymous-only;
  `playerAuth.ts:requirePlayer` enforces ownership on anonymous sessions.

---

## Shipped beyond the original phases

These systems exist in code but never had roadmap phases; listed here so the
roadmap matches the repo:

- **Skills / gathering / augmentation** — `skills.ts` (catalog queries) + `tasks.ts:enqueueSkillAction` + `SkillsPanel.tsx`; `backfillSkillTaskBalance`, `backfillSkillXpProgression`, `backfillSkillRebirthBalance`
- **Passive tree** — `passiveTree.ts:getTree/unlockNode/seedDefaultTree` + `PassiveTree.tsx` + admin tree section
- **Bazaar / marketplace** — `bazaar.ts:placeSellOrder/placeBuyOrder/fulfillOrder/cancelOrder` + `BazaarPanel.tsx` + browse/sell/buy/orders views; 5% tax via `bazaarTaxPercent`; `backfillBazaarBalance`
- **Boss fights + infusion/enchantment** — `bossFights.ts:startBossFight/strikeBoss/checkBossFight` (boss-key gated) + `infusion.ts:enchantEquipment/resolveInfusionCraft` + `backfillBosses`, `backfillInfusionBalance`
- **Consumables** — `consumableSlots.ts` + `ConsumableSlots.tsx`, `useSkillBoost/useCombatBoost`
- **Zones / combat tuning** — `zones.ts` helpers + `combat.ts` profiles/simulation; `backfillCombatBalance`, `restoreMonsterPowerMultiplier`
- **Guild raids + weekly objectives** — `guildRaids.ts`, `guildObjectives.ts`; `retuneGuildActivityXp`
- **Ranked seasons** — `ranked.ts` + `RankedPanel.tsx`; `backfillRankedBalance`, `backfillArenaBalance`
- **Sim / perf harness** — `simLive.ts`, `simShared.ts`, `simHarness.test.ts`, `simLive.test.ts`, `performance.test.ts`, `docs/sim-testing.md`
- **Arena lobby chat** — `LobbyChat.tsx` + `chatArena.test.ts` (arena-scoped; World/Private chat in `chat.ts` remains the only global chat)

---

## Remaining work (ordered)

1. **Commit the working tree** — `arena.ts`, `ranked.ts`, `guilds.ts`, `guildRaids.ts`, `pvpLoadout.ts`, `crons.ts`, `simLive.ts`, `/arena` + `/guild` routes and panels are untracked; 32 files modified.
2. **Phase 12 alliance wars** — only phase with zero code (see above).
3. **Group chat** (Phase 5 open item) — channel-keyed storage exists; add membership/shared-channel/unread mutations + UI.
4. **Leaderboard write-path** (Phase 2 open item) — call `updateLeaderboards` from fight-victory/rebirth settlement.
5. **Real auth** — replace Anonymous provider before production use of guilds/rewards/PvP.
6. **Polish** — `app/lib/logger.ts:49` Sentry TODO; `InventoryPanel.tsx` crafting empty-state copy predates loot; table-drive achievement conditions; dedicated admin arena section if PvP tuning outgrows general balance.
7. **Repo hygiene** — `dist/` is committed; `.gitignore` covers `build/` but not `dist/`.

---

## Migrations Completed

| Date       | Migration                           | Description                                                       |
| ---------- | ----------------------------------- | ----------------------------------------------------------------- |
| 2026-07-19 | `migrations:backfillMaxTierReached` | Populate `maxTierReached` from `currentTier` for existing players |
| 2026-09-08 | `migrations:backfillAdminRoles`     | Assign the temporary admin role to existing development players   |
| 2026-09-09 | `migrations:backfillStatUpgradePurchaseCounts` | Initialize paid stat-upgrade purchase counts for legacy records |
| 2026-09-11 | `migrations:backfillTaskQueueConfig`, `migrations:backfillTaskDefinitions` | Seed task queue balances and the built-in auto-battle definition |
| — | `migrations:backfillCombatBalance`, `migrations:restoreMonsterPowerMultiplier` | Seed combat/attack-speed settings; restore monster power to 1.0 |
| — | `migrations:backfillInfusionBalance`, `migrations:backfillPlayerItemAugmentTiers` | Seed infusion costs; backfill augment tiers |
| — | `migrations:backfillSkillTaskBalance`, `migrations:backfillSkillXpProgression`, `migrations:backfillSkillRebirthBalance` | Seed skill task/XP/rebirth tuning |
| — | `migrations:backfillBosses`, `migrations:backfillBossUnlockLevelPerTier` | Seed bosses + per-tier unlock levels |
| — | `migrations:backfillItemRarities`, `migrations:backfillInventorySlotCapacity` | Seed rarities; backfill inventory capacity |
| — | `migrations:backfillRebirthStatBalance` | Seed rebirth stat tuning |
| — | `migrations:backfillArenaBalance`, `migrations:backfillRankedBalance` | Seed arena/ranked tuning (working tree) |
| — | `migrations:backfillBazaarBalance` | Seed bazaar tax tuning |
| — | `migrations:backfillSimLiveBalance` | Seed sim-harness tuning |
| — | `migrations:consolidatePendingRewards`, `migrations:retuneGuildActivityXp` | Consolidate pending rewards; retune guild activity XP |
