# Glossary

Project-specific terms used in design notes and ADRs.

## Content and deployment

**Backfill** — A migration that adds rows missing from an existing database. A
backfill should be safe to re-run. The leathercrafting backfill is insert-only.

**Content sync** — A seed function that patches, inserts, and removes content to
match the code. `seedForestCraftingContent` / `seed:upsertForestCrafting` is the
full forest crafting content sync. It can overwrite admin edits.

**Seed** — Initial data written to a fresh deployment. `convex/init.ts` runs
once when tables are empty; `convex/seed.ts` exposes admin and CLI seed paths.

**Insert-only** — A migration policy that inserts missing rows and never
patches or deletes existing ones. Admin edits and player data survive re-runs.

## Loot

**Loot source** — The mapping from a combat source (`monster` or `boss`, plus
an ID and optional tier) to a loot table (`lootSources`).

**Loot table** — A named, enabled collection of entries with a roll count
(`lootTables`).

**Loot table entry** — One possible drop: item, weight, drop chance, quantity
range, and purpose (`lootTableEntries`). The leather backfill only adds a hide
entry when the table has no entry for that hide.

**Hide** — A monster crafting drop used by leathercrafting: Troll Moss Hide,
Wyvern Moon Scale, or Dragon Ember Scale. Hides drop from their matching
monster at 35% per victory.

## Leathercrafting

**Leathercrafting** — The craft-only skill (`skillId: "leathercrafting"`). It has
no paired gathering skill; hides come from combat loot.

**Cured leather** — A tiered crafting material made from three hides of one
monster. Tier N also consumes the tier N-1 cured leather, so the line upgrades
stepwise.

**Leather line** — The per-monster family of cured leather and the equipment
made from it. Each line carries one stat: trollhide STR, wyvernscale DEX,
dragonhide INT.

**Leather tier** — The crafting tier (1–8) of a cured leather or leather item.
It is separate from combat tier and from the tier gate required to craft it.

**Tier gate** — The skill level required by `skillTierDefinitions`. All
crafting skills currently share `1/14/26/39/52/65/77/90`.

**Craft-only skill** — A skill whose XP comes only from crafting recipes, with
no `gatheringActivities` rows.

**Consumable slot** — An equipment slot for alchemy items. Equipping a leather
belt unlocks slot 2 at tier 4 and slot 3 at tier 8; both thresholds are balance
entries (`beltSecondSlotTier`, `beltThirdSlotTier`).

**Bag capacity** — Extra inventory space from an equipped leather bag, equal to
bag tier × `bagInventorySlotsPerTier` (default 10).

## Combat encounters

**Encounter** — One fight the player takes part in. Auto-battle, boss fights,
arena lobbies, ranked bouts, and guild raids are encounters. They differ in
how they are triggered and how long they last, not in the combat rules.

**Round exchange** — The shared shape of the discrete-round encounters
(arena, ranked, guild raid): every fighter casts its due abilities, then
every fighter swings, then the round is judged. `convex/roundCombat.ts` owns
the order and the damage pipeline; each encounter supplies the numbers
(how hard a fighter swings, how it reduces what it receives).

**Swing** — A fighter's basic attack in a round exchange. Raw damage first,
then the attacker's damage buffs, then the target's mitigation buffs, then
the target's own reduction.

**Round** — One turn of a round exchange. Cooldowns and buff durations in
round-based encounters are counted in whole rounds.

**Settlement** — Paying out a finished fight: gold, experience, loot, and the
record that it happened. `settleCombatFight` in `convex/loot.ts` is the
settlement module for monster and boss fights.

**Settlement key** — The dedupe key that identifies one settlement
(`${playerId}:${scope}:${ref}`). Every key is player-prefixed, so no caller
can claim another player's key and cancel their later payout. Built with
`fightHistoryKey` in `convex/fightHistory.ts`.

**Fight history** — The record that a fight settled (`fightHistory`). One row
per settlement, keyed by its settlement key.

**Hit roll** — The random damage of one attack, before any buff, mitigation,
or reduction. `convex/hitRoll.ts` owns the two roll shapes: a variance band
for players, fighters, and dragons, and a flat range for monsters.

**Combat profile** — Everything a player brings into a fight: stats, weapon,
armor, ward, passives, and boosts. `readPlayerCombatProfile` in
`convex/combat.ts` builds it, from live equipment or from equipment the
caller already resolved.

**Fighter snapshot** — The frozen combat profile the PvP encounters fight
with. The arena lobby and the ranked bout both snapshot into it
(`convex/pvpSnapshot.ts`).

## Loadouts

**Loadout slot** — One of the positions a player fills with a consumable or
an ability. The two loadouts share the shape, not the rules: consumable
slots come from the belt tier and passives, ability slots from the wisdom
level, and each has its own cap in `gameBalance` (`maxConsumableSlots`,
`wisdomMaxSlots`).

## Abilities

**Ability** — A learned action a player can equip and cast during combat.
Abilities are gated by weapon type and scale with wisdom.

**Ability slot** — One of the equipped ability positions on a player. The
number of unlocked slots comes from the wisdom level (`wisdomBaseSlots`,
`wisdomLevelsPerSlot`, `wisdomMaxSlots`).

**Auto-cast** — Casting equipped abilities automatically during combat
instead of choosing them by hand. Every encounter supports it.

**Wisdom XP** — The experience a player earns for using abilities. It is
awarded when a fight settles, not when the ability is cast.
