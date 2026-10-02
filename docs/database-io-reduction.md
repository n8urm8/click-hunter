# Convex Database I/O Reduction — Reference

Source: Database I/O breakdown screenshot (Dev: 804.74 MB total).
Top consumers: `tasks.sync` 331 MB, `admin.getConfig` 159 MB,
`players.getPlayerByAnonymousId` 139 MB, `passiveTree.getTree` 87 MB,
`items.getPlayerInventory` 32 MB, `tasks.getQueue` 24 MB.

Background:
- https://stack.convex.dev/convex-query-performance
- https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf

Core model: query cost = documents in the `withIndex` range.
`.filter()` runs after the index scan and does not reduce I/O.
`.collect()` without a bound scans everything in range.
Reactive queries re-run on any write to a subscribed table, so a
high-churn write (heartbeat / progress patch) multiplies all readers.
Mutations are billed for reads + writes.

Indexes in this repo are generally correct. The problem is
`docs read per call x calls per minute`, plus N+1 fan-out and
duplicate reads — not missing indexes.

> Note: screenshot badge is `Dev`. HMR, StrictMode double-effects,
> and `PlayerDataPrefetch` (`app/routes/game.tsx:15`, `app/components/game/GameRoot.tsx:11`)
> inflate dev numbers. Fix the patterns below and prod follows.

## 1. `tasks.sync` (331 MB)

Entry: `convex/tasks.ts:1293`. Scheduler: `app/components/game/TaskQueueManager.tsx:91-197`.
Hooks: `app/hooks/useTasks.ts:8-23`.

Why it costs so much per call (`settleTaskQueue`, `convex/tasks.ts:1038`):
- `getActiveTask` queried ~4x per sync (`convex/tasks.ts:1039,586,234,1302`).
- ~20 `gameBalance` point reads per battle sync: `readCombatBalance` does 14x
  `by_key` reads (`convex/items.ts:485`), `simulateRegularBattle` +5
  (`convex/combat.ts:246`), `readTaskSyncSettings` +2 (`convex/taskTiming.ts:73`),
  plus `offlineTaskWindowMs`, `taskHeartbeatGraceMs`, `maxTier`.
- `simulateRegularBattle` full-scans monsters (`convex/combat.ts:230`
  `query("monsters").collect()`).
- `getActiveEventMultipliers` full-scans events with `.filter`
  (`convex/loot.ts:119-128`) — the exact full-table-scan antipattern from the docs.
- Combat profile fans out 5 ways (`convex/combat.ts:179`):
  `getEquippedStatBonuses` (`convex/items.ts:89`), `getEquippedWeapon`,
  `getEquippedArmorTotals` (`convex/items.ts:723`), `getPassiveBonuses`,
  `readCombatBalance`. The two equipment helpers each `collect(playerItems
  by_playerId)` then `db.get` per row + `collect` augments per row.
- Unconditional patches even with zero progress (`convex/tasks.ts:1021`,
  `convex/tasks.ts:175`). Each write costs I/O and invalidates
  `getQueue` / player / inventory / tree subscribers, causing cascade re-reads.

Actions:
1. Slow the clock (biggest lever). Raise via admin General tab / `gameBalance`:
   - `taskSettlementIntervalMs` default 30s (`convex/taskTiming.ts:7`)
   - `taskPresenceIntervalMs` default 10s (`convex/taskTiming.ts:10`)
   - `taskHeartbeatGraceMs` fallback 15s (`convex/tasks.ts:87`)
   Keep the `settlementDue ? sync : heartbeat` split
   (`TaskQueueManager.tsx:130`); `heartbeat({ presenceOnly: true })`
   (`convex/tasks.ts:1315`) is cheap, full `sync` is not.
2. No-op guard: return early from `settleTaskQueue` / `processAutoBattle`
   without patching `taskPresence` / `playerTasks` when `onlineCreditMs`,
   `elapsedMs`, and battle wins are all zero.
3. Thread `activeTask` through `settleTaskQueue -> resolveTimedQueue ->
   processAutoBattle -> sync response` instead of re-querying.
4. Batch `gameBalance`: when a call needs 3+ keys, do one
   `query("gameBalance").collect()` and pick keys in memory
   (or reuse `seed.getAllGameBalance`). Applies to `readCombatBalance`,
   `simulateRegularBattle`, `readTaskSyncSettings`.
5. Index `gameEvents` (e.g. `by_endTime` or `by_isActive`) and query with
   `withIndex` instead of `.filter` on `startTime`/`endTime`.
6. Merge `getEquippedStatBonuses` + `getEquippedArmorTotals` into one
   `playerItems by_playerId` collect + one batched item/augment fetch.
7. Bound monster pool: query by zone index or cache monster list;
   avoid `monsters.collect()` per encounter.

## 2. `admin.getConfig` (159 MB)

Entry: `convex/admin.ts:460`. Sections: `convex/adminConfig.ts:1-15`.
Client: `app/hooks/useAdmin.ts:33-45`.

- Handler does 22x `.collect()` in `Promise.all` (`convex/admin.ts:507-530`).
  No-arg callers (old clients) read every table.
- Client already scopes by `section` and uses `staleTime: Infinity`, but
  `refetchOnMount: "always"` re-collects on every mount.

Actions:
1. Always pass `section`; treat section-less calls as legacy only.
2. Paginate large tables (`items`, `monsters`, `players`, `lootTableEntries`)
   with `.paginate()` / `.take(n)` instead of `.collect()`.
3. Return only editor-needed fields, not full docs.
4. Invalidate only the edited section on save (already done via
   `adminSectionsForTables` in `app/hooks/useAdmin.ts:57-87`) — verify no
   wildcard invalidation remains.

## 3. `players.getPlayerByAnonymousId` (139 MB)

Entry: `convex/players.ts:252`. Client: `app/hooks/usePlayer.ts:20-44`.

- Fans out to `readPlayerCombatProfile` (`convex/combat.ts:173`, 5 parallel
  reads incl. 14 balance reads) + `calculateCharacterLevel`
  (`convex/characterLevel.ts:57`: enabled-skills scan + playerSkills collect).
- Subscribed live, so any equipment / passive / skill write re-runs everything.

Actions:
1. Split into a light live query (bare `players` doc) + heavy derived stats
   (`effectiveStats`, `combatStats`, `characterLevel`) fetched on demand or
   denormalized onto the player doc on equip/passive/level change.
2. Short term: reuse the existing `equipmentBonuses` pass-through in
   `readPlayerCombatProfile` (`convex/combat.ts:177`) to avoid double
   `playerItems` collects; share one `readCombatBalance` result per call.

## 4. `passiveTree.getTree` (87 MB)

Entry: `convex/passiveTree.ts:571`.

- `query("passiveNodes").take(500)` (`:577`) has no `withIndex` — defaults to
  `by_creation_time` scan, then filters `enabled` in JS.
- `playerPassives` collected 3x per call (`:578`, inside `getPassivePoints`
  `:115-118`, inside `getPassiveBonuses` `:239-242`) plus a second
  `passiveNodes` scan by `by_enabled` (`:246-249`).
- Static content (~54 nodes) served as a live query.

Actions:
1. Use `.withIndex("by_enabled", q => q.eq("enabled", true))` instead of
   post-filter.
2. Collect `playerPassives` once in `getTree` and pass to `getPassivePoints` /
   `getPassiveBonuses` (or inline them).
3. Long client `staleTime` / one-shot fetch; tree only changes on admin edit
   or unlock (unlock already returns `{ unlocked }`).

## 5. `items.getPlayerInventory` (32 MB)

Entry: `convex/items.ts:829`. Client: `app/hooks/useInventory.ts:8-16`.
Helper: `getOwnedItemRows` (`convex/items.ts:818-827`, already bounded with
`take(capacity + ...)` — keep).

- N+1 loop (`convex/items.ts:853-873`): per owned row `db.get(itemId)` +
  `collect(augments by_playerItemId)`. 50 slots ≈ 100 reads/call.
- Always reads `itemRarities.collect()` + `pendingRewards.take(100)` +
  attack-speed balance (`:836-846`) even when the UI only needs equipment.

Actions:
1. Batch: collect needed `itemId`s / `playerItemId`s first, fetch with one
   `Promise.all`, then assemble. Bound augments with `.take(n)`.
2. Make `pendingRewards`, `rarities`, and `attackSpeedMultiplier` opt-in args.
3. Subscribe a light version (counts/equipment) live; fetch full inventory
   only on the inventory screen.

## 6. `tasks.getQueue` (24 MB)

Entry: `convex/tasks.ts:1279`, snapshot `getQueueSnapshot` (`:1180`).
Client: `app/hooks/useTasks.ts:8-15`, prefetch in `game.tsx:122-128`.

- Duplicate `getQueueCapacity` (two `gameBalance` reads, `:1188` vs `:1198`).
- Per battle task `collect(taskBattleStats)` (`:1218-1227`).
- Always reads `taskHistory.take(10)` + sync settings even when the UI only
  needs `active` + `nextSettlementAt`.

Actions:
1. Read capacity once, pass it to `getQueuedTasks`.
2. `.take(n)` battle stats instead of `.collect()`.
3. Gate `history` / `battleStats` / `offlineWindowMs` behind
   `includeHistory`-style args.

## Cross-cutting checklist

- [ ] Every query uses `withIndex` for its selective predicate; `.filter`
      only for residual predicates on an already-narrow range.
- [ ] No unbounded `.collect()` on user-scoped tables; use `.take(n)` /
      `.paginate(paginationOptsValidator)`.
- [ ] No per-row `db.get` / query in a loop without batching; no duplicate
      reads of the same doc/key in one function.
- [ ] High-churn writes (presence `lastSeenAt`, `progressMs`,
      `lastHeartbeatAt`) don't rewrite otherwise-stable docs on every tick;
      no-op when nothing changed.
- [ ] Heavy derived reads (combat profile, character level, tree bonuses,
      inventory joins) are not on a hot reactive subscription; subscribe
      light, fetch heavy on demand.
- [ ] `gameBalance` many-key reads use one `collect` + lookup, not N
      `by_key` queries.
- [ ] Admin content queries are section-scoped + paginated.

## Suggested implementation order (ROI)

1. Raise `taskSettlementIntervalMs` / `taskPresenceIntervalMs` / grace.
2. No-op guard on `sync`/`heartbeat` writes.
3. Batch `gameBalance` reads; dedupe `getActiveTask` / `getQueueCapacity`.
4. Index `gameEvents`; bound `monsters` and `taskBattleStats` reads.
5. Merge equipment-profile collects; split light/heavy player query.
6. Fix `getTree` index + triple `playerPassives` collect.
7. Batch inventory N+1; gate `pendingRewards` / `history` extras.
8. Paginate `admin.getConfig` per section.
