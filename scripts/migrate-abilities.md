# Abilities System Migration Guide

## Quick Commands

```bash
# Run all migrations at once
pnpm run migrate:all

# Run individual migrations
pnpm run migrate:wisdom
pnpm run migrate:rebirthAbilities
pnpm run migrate:startingStatsWisdom

# Seed abilities (requires admin player ID)
pnpm run seed:abilities
# Or manually:
# npx convex run seed:populateAll '{"playerId":"YOUR_ADMIN_PLAYER_ID"}' --env-file ./docker/.env.selfhosted
```

## Migration Order

1. **migrate:wisdom** - Adds `wis` stat and `statXp.wis` to all existing players
2. **migrate:rebirthAbilities** - Adds `rebirthAbilityBonuses` field to all players
3. **migrate:startingStatsWisdom** - Updates `startingStats` balance to include `wis: 1`
4. **seed:abilities** - Seeds all 24 ability definitions + book items + boss loot tables

## After Migration

- Existing players get `wis = 1`, `statXp.wis = 0`
- Existing players get empty `rebirthAbilityBonuses = {}`
- New players start with `wis = 1`
- Wisdom levels up by using abilities in combat
- Ability books drop from bosses (tier 1-8 = book tier 1, 9-16 = book tier 2, etc.)

## Admin Setup

1. Create an admin player in the database (or use existing)
2. Set `role: "admin"` on the player document
3. Use that player ID for seeding: `npx convex run seed:populateAll '{"playerId":"..."}'`

## Verify

```bash
# Check players have wisdom
npx convex run migrations:backfillWisdom  # should return { updated: 0 } if already done

# Check abilities seeded
npx convex query api.seed.getAllAbilities  # should return 24 abilities

# Check books in loot tables
npx convex query api.loot.getLootTable '{"sourceType":"boss","sourceId":"boss_1","tier":1}'
```
