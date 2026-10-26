# ADR 0002: Derive settlement keys and share the combat core

- Status: Accepted
- Date: 2026-10-20

## Context

Two pieces of the combat code had grown apart from the modules that were
supposed to own them.

**Settlement.** `settleCombatFight` in `convex/loot.ts` is the settlement
module: it dedupes by `settlementKey`, pays gold and experience, grants loot,
and writes the `fightHistory` row. Its interface demands a key that starts
with `${playerId}:`, so that no caller can pre-claim another player's key and
force their later settlement to return as a duplicate with no rewards.

The guild raid could not use that module. Its rewards are split per
participant behind the `guildRaidXpGrants` dedupe, so it only needed the
history row — and it wrote that row by hand, with a key in a different shape
(`raid:${raidId}:${playerId}`) that the settlement module would have
rejected. The PvP arena went the other way: it wrote a `settlementKey` onto
every lobby row that nothing ever read.

**Round exchange.** The arena, ranked bouts, and guild raids all fight in
discrete rounds, and all three had their own copy of the same loop: every
fighter casts its due abilities, then every fighter swings, then the round is
judged. The copies had already drifted — the raid's swing did not apply the
arena's round-and-clamp rule, the arena and ranked had subtly different
round-limit draw rules, and each copy re-derived the buff pipeline
(`damageWithBuffs` → `mitigateWithBuffs` → the encounter's own reduction).

## Decision

1. **Settlement keys are derived, never hand-built.** `convex/fightHistory.ts`
   owns `fightHistoryKey(playerId, scope, ref)` and
   `recordFightHistory`. Every fight-history row is written through it, and
   every key is player-prefixed. The raid now records its row through the
   same seam with the key `${playerId}:raid:${raidId}`; the arena no longer
   writes a key at all.

2. **One round exchange, three adapters.** `convex/roundCombat.ts` owns the
   order of a round and the damage pipeline. Each encounter supplies its own
   numbers through the seams: `planSwing` (who a fighter strikes and how
   hard), `reduceIncoming` (the target's own reduction), `RoundSide.allyHeal`
   (where an ally heal lands), and `abilityDamageMultiplier` (the raid's
   tough skin). `resolveDuelVerdict` judges the two-fighter duels.

3. **The legacy arena key is cleared, not carried.** The `arenaLobbies`
   `settlementKey` field is now optional and is no longer written.
   `migrations:dropArenaLobbySettlementKeys` clears the values on existing
   rows; the field can be dropped from the schema once that migration has
   run everywhere.

4. **One hit roll, one combat profile source.** `convex/hitRoll.ts` owns
   every attack roll; the encounter supplies the defense model.
   `readPlayerCombatProfile` takes an explicit source — live equipment, or
   equipment the caller already resolved — instead of three optional
   parameters that had to be passed coherently.

5. **Slot caps are balance values.** The ability slot cap comes from
   `wisdomMaxSlots` and the consumable slot cap from `maxConsumableSlots`.
   No module hardcodes a slot count any more.

## Consequences

- One place decides how a fight is recorded, so a new encounter cannot
  invent a key format that the settlement module cannot read.
- The player-prefix guard survives: `recordFightHistory` rejects a key that
  does not belong to the player it settles for.
- Combat rules live in one module, so the arena, ranked, and raid cannot
  drift apart again. The encounter-specific numbers are explicit seams
  rather than copy-pasted branches.
- The arena and ranked keep their existing draw rules, which differ: ranked
  draws when both fighters are on the same remaining HP even if their pools
  differ, the arena compares HP fractions. `resolveDuelVerdict` takes
  `drawOnEqualHp` for that reason.
- Existing raid history rows keep their old key shape. Nothing reads them by
  key, so they are left alone.
- The combat profile's source is now a discriminant, so a caller cannot
  half-supply equipment. That surfaced a live bug: the auto-battle passed
  bonuses and armor but not the ward, so elemental ward never mitigated
  monster hits in auto-battle (it always did in boss fights). The auto-battle
  now reads the live profile, and the ward applies.
- Raising a slot cap in the admin editor now takes effect everywhere. It
  did not before: the abilities panel and the equip path both hardcoded
  four slots.
- The two loadouts (abilities, consumables) still have separate modules.
  They share a shape, not their rules — what fills a slot, how the count is
  derived, and the duplicate rule all differ, and a shared module would
  need a parameter per difference. The slot bounds and the caps were the
  only real duplication, and those are now balance values.

## Alternatives considered

- **Let the raid call `settleCombatFight`:** it would pay the boss loot and
  gold again on top of the raid's own split, double-awarding every
  participant.
- **Drop the player-prefix guard:** the key is predictable, so a caller
  could claim another player's key and cancel their payout.
- **Change the auto-battle settlement key format:** the key is baked into
  in-flight settlements, so changing its shape could pay the same battle
  twice across a deploy.
- **A shared slot-loadout module for abilities and consumables:** the
  interface would need the table, the slot column, the content column, the
  count resolver, the content validator, the duplicate rule, and the panel
  projection — as complex as the two implementations it replaces.
- **Keeping the hit rolls in their encounter modules:** the arena and the
  boss fight already rolled the same variance band by hand, and the boss and
  raid had byte-identical player rollers. The defense model, not the roll,
  is what actually differs.
