# ADR 0001: Deliver leathercrafting to existing deployments

- Status: Accepted
- Date: 2026-10-19

## Context

Leathercrafting content already exists in the codebase (`convex/forestCraftingSeed.ts`):

- the `leathercrafting` skill and eight tier definitions;
- cured leather, belts, bags, and light armor for troll, wyvern, and dragon hides;
- tier-gated recipes for every item;
- belt consumable-slot and bag inventory-slot bonuses in `convex/leatherwork.ts`;
- hide loot tables for troll, wyvern, and dragon at a 35% drop chance.

It was added in commit `d4d1d9e` ("new crafting") on 2026-10-06. Existing
deployments were seeded before that date. In the running self-hosted backend,
the hide items and loot tables are present, but `skillDefinitions` has no
leathercrafting row and no leather items or recipes exist.

`seedForestCraftingContent` is a full content sync: it patches every forest
crafting item, skill, tier, and recipe. Running it on an existing database
would overwrite admin edits outside leathercrafting. The admin reset is more
invasive and can touch player inventory.

## Decision

Add `migrations:backfillLeathercrafting`, backed by
`seedLeathercraftingContent` in `convex/forestCraftingSeed.ts`:

- insert only rows that are missing;
- never patch, delete, or recreate existing rows;
- cover the skill, tier definitions, leather items, recipes, recipe
  ingredients/outputs, leather balance keys, and hide loot tables/sources;
- leave player data and all non-leather content untouched;
- be safe to re-run, returning all-zero counts once content is present.

The backfill also runs as part of `pnpm migrate:all`, so `pnpm
deploy:migrations` reaches current deployments. `seedForestCraftingContent`
remains the canonical, rerunnable content sync for deliberate reseeds.

Two supporting fixes ship with the backfill:

1. Leather materials, hides, and belts use the existing
   `app/assets/icons/leather.svg` icon instead of the generic gem.
2. Bag descriptions are written from the configured
   `bagInventorySlotsPerTier` value rather than a hardcoded `+10` per tier.

Hide drops stay at 35% from troll, wyvern, and dragon. Leathercrafting tier
levels stay aligned with the other skills (`1/14/26/39/52/65/77/90`).

## Consequences

- Current deployments need one migration run (`pnpm migrate:leathercrafting`)
  or the normal `pnpm deploy:migrations` flow.
- Fresh databases continue to receive leathercrafting through `init.ts` and
  `seedForestCraftingContent`.
- Admin changes to leather rows are preserved across backfill runs. A full
  content sync is still required when deliberately resetting content.
- The insert-only path does not repair partially missing child rows for an
  existing recipe. Use `seed:upsertForestCrafting` for that case.

## Known issue: leathercrafting progression cost

All crafting recipes award `tier * 50` XP. Shared tier gates require level 14
for tier 2, which is 455,000 XP at the default `skillXpPerLevel` of 1,000.
Unlike the other crafting skills, leathercrafting has no paired gathering
activity, so its only XP source consumes hides:

- curing one leather costs 3 hides;
- reaching tier 2 costs roughly 9,100 crafts and 27,300 hides if only tier-1
  cures are used.

Raising recipe XP reduces the material cost but not wall-clock time, because
skill action duration scales with XP. Fixing this properly requires a balance
decision affecting the shared skill curve or adding a leathercrafting XP
source. It is intentionally out of scope for this delivery and should be
tracked separately.

## Alternatives considered

- **Full forest-crafting upsert:** simpler, but overwrites unrelated admin
  edits and is too broad for a missing-content fix.
- **One-off manual seed:** leaves the next deployment with the same hole.
- **Destructive reset/populate:** risks player items and progress.
- **Lower leathercrafting tier gates:** rejected because the requirements
  should match the other crafting skills.
