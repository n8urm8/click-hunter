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

- [ ] **gameBalance admin mutation** — Update any `gameBalance` key from dashboard (e.g. double XP)
- [ ] **Schema** — Add `gameEvents` table (start/end timestamps, effect type, value)
- [ ] **events.ts** — Query active events and apply multipliers to gold/XP
- [ ] **EventBanner.tsx** — Show active event banner in game UI

---

## Migrations Completed
| Date       | Migration | Description |
|------------|-----------|-------------|
| 2026-07-19 | `migrations:backfillMaxTierReached` | Populate `maxTierReached` from `currentTier` for existing players |
