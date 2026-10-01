# Welcome to React Router!

A modern, production-ready template for building full-stack React applications using React Router.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/remix-run/react-router-templates/tree/main/default)

## Features

- 🚀 Server-side rendering
- ⚡️ Hot Module Replacement (HMR)
- 📦 Asset bundling and optimization
- 🔄 Data loading and mutations
- 🔒 TypeScript by default
- 🎉 TailwindCSS for styling
- 📖 [React Router docs](https://reactrouter.com/)

## Getting Started

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5175`.

### Convex query costs

The skill panel combines a shared `skills.getSkillCatalog` subscription with a
small player-specific `skills.getPlayerSkills` subscription. Catalog changes
remain reactive, but XP, gold, combat, and other player updates do not reread
recipes or item definitions. Repeated item references are read once per catalog
execution. `skills.getSkillPanel` remains available for older clients.

Task countdowns and auto-battle health animate locally, using a server-aligned
clock. The client calls `tasks.sync` at completion/recovery deadlines and at
configured reward-batch boundaries, rather than running a two-second gameplay
tick. Pure offline-capable timed tasks need no presence pings. Skills batch earned
XP/items (30 seconds by default), so displayed action counts and inventory remain
authoritative but can lag the animated timer until the next settlement.

Online-only tasks send lightweight `tasks.heartbeat({ presenceOnly: true })`
pings (10 seconds by default) to an isolated `taskPresence` record. These do not
update players/tasks or invalidate gameplay subscriptions. The existing
15-second grace window determines continuity: confirmed time is preserved across
disconnects, but disconnected gaps are never credited. Idle queues send no
periodic calls. Initial load, reconnect and return to a visible tab reconcile
progress. Older clients omitting `presenceOnly` retain gameplay settlement until
they reload.

Auto-battle encounters are generated once and persisted. Health, duration and
gold/XP rewards are fixed for that encounter; equipment, boosts and passives
affect encounters created after the change. Rewards stay server-authoritative
and settle idempotently at fight completion. Ending a duration run mid-fight
does not grant a completed-fight reward. Rebirth stops saved/queued battles.
Cancellation, enqueueing, spending/trading and modifier changes reconcile earned
work first; a large catch-up must finish before a conflicting interaction.

`taskSettlementIntervalMs` and `taskPresenceIntervalMs` are seeded balance
entries editable in the existing admin balance editor. Both accept whole
milliseconds from 1,000 to 300,000. Presence is capped at two thirds of the
configured grace window (minimum grace 1,500 ms). Deploy backend and frontend
together; the schema additions are optional/lazily initialized for existing
tasks. For an existing deployment, add missing settings without changing current
values:

```bash
pnpm exec convex run migrations:backfillTaskQueueConfig
```

Run the database read-set and heartbeat regression tests with `pnpm test`.

### Admin configuration snapshots

Gameplay never prefetches admin configuration. Admin tabs use one-time reads,
not live subscriptions, so gameplay rewards and player updates do not reread
the admin catalog. Only the active tab fetches data; visited tabs retain their
cached data and editor drafts without background queries.

`admin.getConfig({ playerId, section })` reads only the selected tab's tables
and dropdown dependencies. Players uses `admin.getPlayers` without loading
configuration; Tree reads only passive nodes. Omitting `section` retains the
full catalog for older clients.

Successful admin saves refresh the affected active snapshot and mark related
inactive tabs stale for their next visit. This includes shared item references,
rarity changes, recipe ingredients/outputs, passive-tree seeding, and the forest
crafting reset. Refresh configuration / Refresh players loads changes from
other sessions. Reload character fetches fresh server data before discarding
that character's draft; normal refreshes preserve unsaved edits. Character
saves retain the existing last-updated conflict check.

Every fetch and mutation still checks the persisted admin role. No schema
migration is required; deploy backend and frontend together to enable scoped
reads. Older clients keep their previous subscription behavior until reloaded.

### Automatic combat and weapon speed

Regular fights always use the server-authoritative auto-battle queue. Enter the
Wilds starts the selected count, online-duration, or until-stopped run; there is
no manual regular-fight mode or auto-attack toggle. Runs can still be stopped
from combat or the task queue. Boss challenges remain separate and attack
automatically, regardless of older players' stored automation setting.

Combat keeps equipped health, attack, defense, attack speed, and critical-hit
stats visible above tier/zone selection and during fights. Hunt stop conditions
(count, online time, or until stopped) remain available without a separate
automation panel. The stat strip reuses the player data already loaded by the
game shell; it adds no query or per-hit sync. Saved encounters show their actual
attack rate separately, including snapshot modifiers.

`combatAttackSpeedMultiplier` defaults to **0.5** and is editable in the admin
balance editor. It scales player attack speed after weapon speed, DEX, armor
penalties, and the minimum-speed floor; passives retain their relative effect.
Thus every weapon's effective rate is halved without changing its damage or
relative speed. With no DEX bonus, armor penalty, or speed passive, sword,
dagger, mace, bow, and staff rates are 0.5, 0.8, 0.325, 0.65, and 0.4 attacks/sec.

Regular monsters use `monsterPowerMultiplier`, which is restored to **1.0**
(their original HP and damage). The migration
`migrations:restoreMonsterPowerMultiplier` updates the previous 0.5 default and
preserves any other value set in the admin balance editor.
Monster attack rates are unchanged. Item editor speeds remain the unscaled
baseline; inventory displays the scaled base speed.

Character stats, server attack cooldowns, and auto-battle use the same
equipment/passive combat calculations. Character stats show permanent/equipped
values; auto-battle snapshots also include active consumables and show the
encounter's actual attack rate. New encounters resolve discrete hits at saved
player/monster attack intervals, using expected critical-hit damage. Health is
projected locally at those intervals; a slow weapon cannot finish a fight before
its first swing. Existing saved encounters finish with their original snapshot;
new encounters use the slower speed and discrete timing.

For an existing deployment, seed missing combat settings without overwriting
admin tuning or modifying weapon records:

```bash
pnpm exec convex run migrations:backfillCombatBalance
```

Deploy backend and frontend together. No player-data backfill is required:
existing players with auto attack disabled are treated as always enabled.

## Building for Production

Create a production build:

```bash
npm run build
```

## Deployment

### Docker Deployment

To build and run using Docker:

```bash
docker build -t my-app .

# Run the container
docker run -p 3000:3000 my-app
```

The containerized application can be deployed to any platform that supports Docker, including:

- AWS ECS
- Google Cloud Run
- Azure Container Apps
- Digital Ocean App Platform
- Fly.io
- Railway

### DIY Deployment

If you're familiar with deploying Node applications, the built-in app server is production-ready.

Make sure to deploy the output of `npm run build`

```
├── package.json
├── package-lock.json (or pnpm-lock.yaml, or bun.lockb)
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

Built with ❤️ using React Router.
