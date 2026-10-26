#!/bin/bash
# Setup script for abilities + wisdom system
# Run this against your self-hosted Convex deployment after deploying the backend

set -e

if [ ! -f ./docker/.env.selfhosted ]; then
    echo "Error: docker/.env.selfhosted not found. Copy from docker/.env.selfhosted.example"
    exit 1
fi

# Load env
set -a
source ./docker/.env.selfhosted
set +a

echo "=== Running Wisdom Migration ==="
npx convex run migrations:backfillWisdom

echo "=== Running Rebirth Ability Bonuses Migration ==="
npx convex run migrations:backfillRebirthAbilityBonuses

echo "=== Running Starting Stats Wisdom Migration ==="
npx convex run migrations:backfillStartingStatsWisdom

echo "=== Seeding Abilities and Books (requires admin player) ==="
echo "You need to provide an admin player ID. Get it from your database or create one."
read -p "Enter admin player ID: " ADMIN_PLAYER_ID

if [ -z "$ADMIN_PLAYER_ID" ]; then
    echo "Skipping seed - no admin player ID provided"
    exit 0
fi

npx convex run seed:populateAll "{\"playerId\":\"$ADMIN_PLAYER_ID\"}"

echo "=== Done! ==="
echo "Abilities system is now ready."
