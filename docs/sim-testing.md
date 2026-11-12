# Simulated testing with AI prompts

This project ships two simulation harnesses: hermetic `convex-test`
scenarios (`Sim` in `convex/simHarness.test.ts`) for fast iteration, and a
live-database harness (`convex/simLive.ts`, internal functions) for testing
against your self-hosted backend. Both run the same guild core code, so level
gates, gold costs, and role checks execute for real in both.

## Why this shape

- Every scenario is a `convex/*.test.ts` file run with `npx vitest run <file>`.
- Each test gets a **fresh, empty database** and **faked auth identities**, so
  simulated players call the **real public mutations** (`api.guilds.*`,
  `api.guildRaids.*`, …). Ownership checks, level gates, gold costs, and role
  permissions all execute exactly as in production.
- You drive it by prompting an AI agent (or writing the file yourself): the
  agent writes a scenario file, runs it, reads the failures, and iterates.
  Nothing needs deploying, signing in, or cleaning up.

## Copy-paste prompts

### Guild applications (the canonical example)

> In `convex/`, write a sim scenario test using `Sim` from
> `./simHarness.test` (follow the tests already in that file): spawn a guild called
> "Night Owls" / tag "NOWL", spawn 6 applicants levels 40–90, have them all
> apply, assert under-50s are rejected by the join gate, accept the rest as
> the owner, and assert the final roster size. Run it with
> `npx vitest run convex/<file>.test.ts` and fix any failures.

### Variations

- **Raid load test:** "…start a tier-3 raid, join 10 spawned hunters, strike
  until completion, assert rewards were split and the raid is `completed`."
- **Bank permissions:** "…promote one member to officer, assert a recruit's
  `withdrawGold` throws but the officer's succeeds."
- **Rebirth edge:** "…spawn a level-120 guild master, run them through
  `players:rebirth`, assert they keep membership but new applicants are still
  gated."
- **Determinism:** every scenario takes a seed — `Sim.create(modules,
  { seed: 7 })` — so re-runs reproduce the same random players.

## Scenario skeleton

```ts
/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { Sim } from "./simHarness.test";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

test("my scenario", async () => {
  const sim = await Sim.create(modules, { seed: 42 });
  const { guild, owner } = await sim.spawnGuild({ name: "Owls", tag: "OWL" });
  const players = await sim.spawnPlayers(3, { level: 60 });
  const results = await sim.applyAll(players, guild._id);
  expect(results.every((r) => r.ok)).toBe(true);
  void owner;
});
```

Run with: `npx vitest run convex/<file>.test.ts`

## `Sim` reference

| Method | Purpose |
|---|---|
| `Sim.create(modules, { seed? })` | Fresh world. `modules` is always the `import.meta.glob` line above. |
| `spawnPlayer({ name?, level?, stats?, statXp?, gold?, totalExperience?, skills?, items? })` | One player + isolated identity. **Combat skills are the five stats** (`stats: { str: 99 }` — a stat's value *is* its level). **Non-combat skills** go in `skills: [{ skillId: "mining", level: 25 }]` (definitions auto-created). `level` is a target: explicit skill levels are subtracted first, then the remainder splits across unspecified stats. Returns the **actual** level — always assert against it. |
| `spawnPlayers(count, { level?, levelRange?, namePrefix?, names?, … })` | Batch spawn; `levelRange: [min, max]` rolls per player. Max 200. |
| `spawnGuild({ name, tag, description?, owner?, ownerOpts? })` | Owner defaults to level 120 / 100k gold; founds the guild via the real `createGuild`. |
| `applyAll(players, guildId, message?)` | Real `applyToGuild` per player; never throws per player — inspect `ok` / `error`. |
| `setStats(playerId, {...})`, `setGold(playerId, n)`, `setSkillLevel(playerId, { skillId, level })` | Direct edits, bypass gameplay. |
| `characterLevel(playerId)` | Actual level for assertions. |
| `player.as` | Identity-scoped client — call any `api.*` mutation/query **as that player**. |

`skills` entries auto-create minimal skill definitions:
`{ skillId, level, category?, name? }`.

`items` entries grant by stable slug and can equip:
`{ slug: "sim-test-sword", quantity?, equipSlot?: "mainHand" }`.
Unknown slugs throw with a hint to seed items first.

`SpawnedPlayer` gives `{ playerId, as, name, subject, level }`.

## Rules the sim enforces (same as production)

- Guild creation: costs `guildCreationCost` gold (default 50,000), requires
  character level `guildCreateMinLevel` (default 100).
- Guild joining (apply or invite-accept): requires `guildJoinMinLevel`
  (default 50). All three tunables live in `gameBalance` and are editable in
  the Admin → General tab.
- Character level = sum of the 5 combat stats + all enabled skill levels, so
  `spawnPlayer({ level: 60 })` in an empty world yields exactly 60, and higher
  once skills exist. Always assert against the returned `level`.
- Unstarted skills count: every **enabled** skill definition contributes at
  least 1 to everyone's level, so spawning a player with `skills:
  [{ skillId: "mining", level: 25 }]` raises the floor for all later spawns
  by 1. Prefer explicit `stats` + `skills` over `level` when exact totals
  matter, e.g. `spawnPlayer({ stats: { str: 99 }, skills:
  [{ skillId: "mining", level: 25 }] })`.

## Live-database sims (self-hosted backend)

Hermetic sims are for iteration speed. When you want sims acting inside your
real self-hosted database — e.g. applicants queuing on the guild *you*
created in the UI — use the `simLive:*` internal functions. They run the same
core functions as the public mutations, and CLI access (deployment
credentials) is the authorization boundary.

**1. Enable the harness** (seeds as `false`; keep it `false` in production):
flip `simLiveEnabled` to `true` in Admin → General, or edit the
`gameBalance` row in the self-hosted dashboard (`http://localhost:6791`).

**2. Run a scenario from the CLI** (every command needs the env file):

```bash
# Spawn a guild (owner defaults to level 120 / 100k gold)
npx convex run --env-file docker/.env.selfhosted \
  simLive:spawnGuild '{"name":"Night Owls","tag":"NOWL"}'

# Spawn 6 applicants, levels 40-90
npx convex run --env-file docker/.env.selfhosted \
  simLive:spawnPlayers '{"count":6,"namePrefix":"Applicant","levelRange":{"min":40,"max":90},"seed":7}'

# Have every unguilded sim player apply (use YOUR guild's ID from step 1)
npx convex run --env-file docker/.env.selfhosted \
  simLive:applyAll '{"guildId":"<guild-id>"}'

# Accept all pending as your real officer character
npx convex run --env-file docker/.env.selfhosted \
  simLive:acceptAll '{"guildId":"<guild-id>","officerPlayerId":"<your-player-id>"}'

# Inspect + clean up
npx convex run --env-file docker/.env.selfhosted simLive:status '{}'
npx convex run --env-file docker/.env.selfhosted simLive:cleanup '{}'
```

Prompt recipe for an agent:

> Against my self-hosted backend: spawn a guild "Night Owls"/"NOWL", spawn
> 6 applicants levels 40–90, apply them all, accept the eligible ones as my
> officer character (ask me for my player ID from the profile page if you
> need it), show `status`, then `cleanup`. Confirm each step's output before
> continuing. Remind me to flip `simLiveEnabled` back to false when done.

Notes:

- `applyAll` defaults to all unguilded `sim-live-*` players; pass explicit
  `playerIds` to target specific ones (sim or real).
- `setStats` / `setGold` / `setSkillLevel` refuse non-sim players; guild
  flows accept real ones (your officer approves, your character founds).
- `cleanup` removes sim players, their memberships/applications, and guilds
  left with no real members. Real players and their data are never touched.
- `status` lists sim players, guilds with member counts, and pending
  application counts — point the agent at it for verification.

## Balance report (biome world)

`convex/balanceSim.test.ts` plays a sword character's life through the real
combat code and prints pacing per tier, the tier 8 → 9 wall at 0/3/6 rebirths,
the Blighted gear ladder (tiers 9–16 with gear of the hunted tier at 3/6/10
rebirths), and material income per zone. It is opt-in because it takes several minutes:

```bash
BALANCE_SIM=1 npx vitest run convex/balanceSim.test.ts --silent=false
```

Re-run it after changing `tierScaleMultiplier`, `endgameTierJumpMultiplier`,
archetype drop rates in `convex/biomes.ts`, the Blighted gear constants, or
recipe costs. An always-on guard checks that tier 9/13/16 Blighted gear keeps
the easy zone farmable at 3 rebirths.
