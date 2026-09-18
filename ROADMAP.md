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

## Phase 2 — Leaderboards

> Goal: Show top players by experience, tier, and rebirth count. Uses `@convex-dev/aggregate`.

- [ ] **leaderboards.ts** — Convex aggregate setup for `totalExperience`, `maxTierReached`, `rebirthCount`
- [ ] **players.ts** — Update aggregate counters when player stats change (on fight victory, rebirth)
- [ ] **LeaderboardPanel.tsx** — New UI tab showing top 10 players per category
- [ ] **GameLayout.tsx** — Add Leaderboard tab to navigation

---

## Phase 3 — Achievements

> Goal: Reward milestone moments (first kill, high tier, rebirth, rare monster).

- [ ] **Schema** — Add `achievements` table (definitions) + `playerAchievements` table (unlocked state)
- [ ] **seed.ts** — Seed achievement definitions (e.g. "Rat Slayer", "Archfiend Bane", "Tier 10 Veteran")
- [ ] **achievements.ts** — Check conditions after each fight victory; unlock and notify
- [ ] **AchievementsPanel.tsx** — Show locked/unlocked achievements with progress bars

---

## Phase 4 — Rebirth rewards

> Goal: Make rebirth feel meaningful with visible, persistent bonuses.

- [ ] **Schema** — Add `rebirthRewards` table (what each rebirth unlocks: multiplier, passive, unlock)
- [ ] **seed.ts** — Seed rebirth rewards (e.g. +10% gold, +5% XP, unlock new monster types)
- [ ] **players.ts** — Apply rebirth rewards on `rebirth()` call; store active rewards on player
- [ ] **RebirthPanel.tsx** — Show upcoming rewards before player commits; show active bonuses

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

## Phase 7 — Monster drops and loot tables

> Goal: Turn monster and boss victories into configurable item acquisition.

- [ ] **Schema** — Add loot-table definitions, monster/boss drop rules,
  weighted chances, quantity ranges, and drop-resolution history.
- [ ] **Combat reward path** — Roll drops server-side on victory, apply
  configured guarantees and rarity rules, and deliver rewards through the
  inventory system without bypassing capacity or ownership checks.
- [ ] **InventoryPanel.tsx** — Show newly acquired materials and equipment,
  including full-inventory handling and a useful reward summary.
- [ ] **Admin API / AdminPanel.tsx** — Manage drop tables, weights, quantities,
  and per-monster or per-boss overrides.

## Phase 8 — Equipment progression

> Goal: Build combat progression on the existing item and equipment-slot
> scaffold.

- [ ] **Schema** — Extend equipment definitions with configurable stats,
  effects, rarity/quality, level requirements, and unique/equip restrictions.
- [ ] **items.ts** — Validate equipment effects and calculate a player's
  active loadout without trusting client-provided stats.
- [ ] **Combat integration** — Apply equipped modifiers consistently to attack,
  defense, rewards, and any future PvP combat snapshots.
- [ ] **InventoryPanel.tsx** — Show equipment stats, compare candidates, and
  surface invalid or restricted loadouts.
- [ ] **AdminPanel.tsx** — Add editors for equipment stats, effects, rarity,
  and slot rules.

## Phase 9 — Crafting

> Goal: Convert monster materials into useful equipment and consumables.

- [ ] **Schema** — Add recipe definitions, ingredient requirements, outputs,
  unlock prerequisites, and crafting history.
- [ ] **crafting.ts** — Validate recipes, consume materials atomically,
  produce outputs through inventory rules, and support timed crafting through
  the task queue where appropriate.
- [ ] **InventoryPanel.tsx** — Add recipe browsing, ingredient availability,
  craft actions, progress, and failure/full-inventory states.
- [ ] **AdminPanel.tsx** — Add editors for recipes, costs, outputs, unlocks,
  and crafting durations.

## Phase 10 — Alliances and group battles

> Goal: Add persistent player groups and asynchronous cooperative combat.

- [ ] **Schema** — Add alliances, membership roles, invitations, shared
  channels, battle rosters, participation records, and battle results.
- [ ] **alliances.ts** — Enforce membership and role permissions for creating,
  joining, leaving, inviting, removing, and managing an alliance.
- [ ] **Group battles** — Build server-resolved encounters with persisted
  participant snapshots, contribution tracking, rewards, history, and
  idempotent result settlement.
- [ ] **AlliancePanel.tsx / GroupBattlePanel.tsx** — Add membership,
  roster, battle-status, result, and shared-channel views.
- [ ] **AdminPanel.tsx** — Add controls for alliance limits, battle windows,
  participation rules, and rewards.

## Phase 11 — PvP arena

> Goal: Provide fair, asynchronous player-versus-player competition.

- [ ] **Schema** — Add arena ratings, seasons, matchmaking records, combat
  snapshots, match results, and reward claims.
- [ ] **arena.ts** — Implement server-authoritative matchmaking, rating
  updates, season boundaries, result settlement, and anti-tamper validation.
- [ ] **ArenaPanel.tsx** — Show queue state, opponent/match status, history,
  ratings, standings, and earned rewards.
- [ ] **Leaderboards / AdminPanel.tsx** — Add seasonal rankings plus controls
  for matchmaking windows, rating rules, and reward tables.

## Phase 12 — Alliance wars

> Goal: Let alliances compete in scheduled, objective-based campaigns.

- [ ] **Schema** — Add war declarations, schedules, locked rosters,
  objectives, score events, standings, results, and reward claims.
- [ ] **allianceWars.ts** — Validate declarations and rosters, resolve
  asynchronous objectives and scores, close wars deterministically, and
  settle rewards exactly once.
- [ ] **AllianceWarsPanel.tsx** — Show upcoming wars, objectives, live
  standings, battle history, and post-war rewards.
- [ ] **AdminPanel.tsx** — Add controls for war cadence, objectives, scoring,
  eligibility, and rewards.

### New-system architecture constraints

- All tunable gameplay values must be seeded or configured Convex balance or
  domain records and exposed through the existing admin editor; do not add
  client-only gameplay constants.
- Task completion, loot rolls, equipment effects, crafting outputs, and
  multiplayer results must be server-authoritative and safe to retry.
- Alliances, group battles, arena matches, and wars are planned as
  asynchronous/server-resolved systems rather than real-time combat.
- Replace anonymous-ID authorization with authenticated Convex identity checks
  before production use of alliance membership, shared rewards, or PvP
  ownership.

---

## Migrations Completed

| Date       | Migration                           | Description                                                       |
| ---------- | ----------------------------------- | ----------------------------------------------------------------- |
| 2026-07-19 | `migrations:backfillMaxTierReached` | Populate `maxTierReached` from `currentTier` for existing players |
| 2026-09-08 | `migrations:backfillAdminRoles`     | Assign the temporary admin role to existing development players   |
| 2026-09-09 | `migrations:backfillStatUpgradePurchaseCounts` | Initialize paid stat-upgrade purchase counts for legacy records |
| 2026-09-11 | `migrations:backfillTaskQueueConfig`, `migrations:backfillTaskDefinitions` | Seed task queue balances and the built-in auto-battle definition |
