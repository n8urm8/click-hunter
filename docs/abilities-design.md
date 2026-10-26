# Abilities System Design

## Overview
Abilities are special combat attacks/spells/buffs learned from ability books dropped by bosses. They integrate with the existing auto-battle system as additional attack patterns with independent cooldowns.

---

## 1. Schema Changes

### 1.1 Players Table — Add Wisdom Stat + Rebirth Ability Bonuses
```typescript
// In schema.ts, extend players table:
players: defineTable({
  // ... existing fields ...
  
  // Wisdom: new combat stat (6th stat)
  wis: v.number(),                    // base wisdom level (starts at 1)
  statXp: v.optional(v.object({
    str: v.number(),
    dex: v.number(),
    int: v.number(),
    luk: v.number(),
    con: v.number(),
    wis: v.number(),                  // NEW: wisdom XP pool
  })),
  // Rebirth ability bonuses (per-ability, like rebirthSkillBonuses)
  rebirthAbilityBonuses: v.optional(v.record(v.string(), v.number())),
  // ... rest unchanged ...
})
```

### 1.2 Abilities Definitions Table
```typescript
const abilityTypeValidator = v.union(
  v.literal("attack"),      // damaging ability (weapon-specific or universal)
  v.literal("heal"),        // restores HP
  v.literal("buff_offense"), // increases damage/crit/speed
  v.literal("buff_defense"), // increases defense/ward/regen
  v.literal("utility")      // other (cleanse, teleport, etc.)
);

const abilityTargetValidator = v.union(
  v.literal("self"),
  v.literal("enemy"),
  v.literal("ally")         // future: guild raids
);

const weaponTypeValidator = v.union(
  v.literal("sword"),
  v.literal("dagger"),
  v.literal("mace"),
  v.literal("bow"),
  v.literal("staff"),
  v.literal("any")          // weapon-agnostic
);

// New table: abilities
abilities: defineTable({
  abilityId: v.string(),           // "fireball", "whirlwind", "healing_light"
  name: v.string(),
  description: v.string(),
  type: abilityTypeValidator,
  target: abilityTargetValidator,
  weaponType: weaponTypeValidator, // which weapon can use this (or "any")
  element: v.optional(v.string()), // elemental tag for scaling
  
  // Base power at ability level 1
  basePower: v.number(),           // damage/heal amount or buff magnitude
  powerScalingPerLevel: v.number(), // % increase per ability level (e.g., 0.05 = 5%)
  
  // Combat timing
  cooldownMs: v.number(),          // base cooldown between uses
  castTimeMs: v.optional(v.number()), // optional wind-up (default 0 = instant)
  
  // Costs
  manaCost: v.optional(v.number()), // future: mana system (default 0)
  hpCost: v.optional(v.number()),   // HP sacrifice abilities
  
  // Buff-specific fields (for buff_offense/buff_defense)
  buffDurationMs: v.optional(v.number()),
  buffStat: v.optional(v.string()), // which stat/effect is modified
  buffValue: v.optional(v.number()), // flat or percent
  buffIsPercent: v.optional(v.boolean()),
  
  // Progression
  maxLevel: v.optional(v.number()), // undefined = uncapped
  
  // Metadata
  icon: v.optional(v.string()),
  tier: v.number(),                // unlock tier (1+)
  enabled: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_abilityId", ["abilityId"])
  .index("by_type", ["type"])
  .index("by_weaponType", ["weaponType"])
  .index("by_tier", ["tier"])
  .index("by_enabled", ["enabled"]);
```

### 1.3 Player Abilities (Learned/Leveled)
```typescript
// New table: playerAbilities
playerAbilities: defineTable({
  playerId: v.id("players"),
  abilityId: v.string(),
  level: v.number(),               // current ability level (starts at 1)
  experience: v.number(),          // XP toward next level
  totalExperience: v.number(),     // lifetime XP earned
  learnedAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_playerId", ["playerId"])
  .index("by_playerId_and_abilityId", ["playerId", "abilityId"])
  .index("by_abilityId", ["abilityId"]);
```

### 1.4 Equipped Abilities (Active Loadout)
```typescript
// New table: playerEquippedAbilities
playerEquippedAbilities: defineTable({
  playerId: v.id("players"),
  slot: v.number(),                // 0, 1, 2, 3 (max 4 slots)
  abilityId: v.string(),
  equippedAt: v.number(),
})
  .index("by_playerId", ["playerId"])
  .index("by_playerId_and_slot", ["playerId", "slot"])
  .index("by_playerId_and_abilityId", ["playerId", "abilityId"]);
```

### 1.5 Ability Books (as Items)
Ability books are regular items with category `"abilityBook"`. The item definition stores metadata:

```typescript
// In items table, abilityBook items have:
{
  itemId: "ability_book_fireball_1",
  name: "Tome of Fireball I",
  category: "abilityBook",          // NEW category value
  description: "Teaches Fireball (Ability Tier 1). Grants 100 Fireball XP.",
  stackable: true,
  maxStackSize: 99,
  // Custom fields for ability books:
  effectType: "ability_book",
  effectAmount: 100,                // XP granted when consumed
  // Custom metadata (stored in effectData or new fields):
  // abilityId: "fireball"
  // bookTier: 1                     // 1 = tiers 1-8, 2 = tiers 9-16, etc.
}
```

Add to `ITEM_CATEGORY_VALUES` in `itemTypes.ts`:
```typescript
export const ITEM_CATEGORY_VALUES = [
  "crafting", 
  "equipment", 
  "abilityBook"    // NEW
] as const;
```

### 1.6 Admin Config Section
```typescript
// In adminConfig.ts:
export const ADMIN_CONFIG_TABLES = {
  // ... existing ...
  abilities: [
    "abilities", "items"  // items for ability books
  ],
  // ... existing ...
} as const;
```

---

## 2. Wisdom System

### 2.1 Wisdom Level Calculation
Wisdom uses the **same XP curve as skills** (`skillXpPerLevel` balance, `applySkillExperience` function).

```typescript
// In characterLevel.ts or new wisdom.ts:
export function calculateWisdomLevel(wisdomXp: number, xpBase: number): number {
  let level = 1;
  let remainingXp = wisdomXp;
  let required = getSkillXpRequiredForLevel(level, xpBase);
  
  while (remainingXp >= required) {
    remainingXp -= required;
    level += 1;
    required = getSkillXpRequiredForLevel(level, xpBase);
    if (!Number.isSafeInteger(required)) break;
  }
  return level;
}
```

### 2.2 Max Equipped Abilities by Wisdom Level
```
Wisdom Level 1   → 1 slot
Wisdom Level 25  → 2 slots
Wisdom Level 50  → 3 slots
Wisdom Level 100 → 4 slots
```

Formula: `maxSlots = 1 + floor((wisdomLevel - 1) / 33)` clamped to max 4.

Or configurable via balance:
```typescript
// gameBalance keys:
"wisdomSlotsPerLevel": 33,     // every 33 levels = +1 slot
"wisdomBaseSlots": 1,
"wisdomMaxSlots": 4,
```

### 2.3 Wisdom Power Bonus
Each wisdom level grants a small % bonus to ability power:
```typescript
// gameBalance key:
"wisdomPowerBonusPerLevel": 0.005  // 0.5% per level

// At wisdom 100: 50% bonus to all ability power
```

### 2.4 Wisdom XP Gain
- Using an ability in combat grants wisdom XP
- Amount: `baseXp * abilityLevel * (1 + wisdomBonus)`
- Base XP per cast: configurable (e.g., 10 XP base)
- Server-authoritative: awarded in `settleCombatFight` / `simulateRegularBattle`

---

## 3. Ability Book Tier System

### 3.1 Book Tier Mapping
```
Boss Tier 1-8   → Book Tier 1 (grants base XP)
Boss Tier 9-16  → Book Tier 2 (grants 2x base XP)
Boss Tier 17-24 → Book Tier 3 (grants 3x base XP)
...etc.
```

Formula: `bookTier = ceil(bossTier / 8)`

### 3.2 Book XP Scaling
```typescript
// gameBalance:
"abilityBookBaseXp": 100,        // Tier 1 book grants 100 XP
"abilityBookXpPerTier": 1.0,     // multiplier per book tier (linear)
// Tier 1: 100 XP
// Tier 2: 200 XP  
// Tier 3: 300 XP
// etc.
```

### 3.3 Boss Loot Tables
Each boss tier has a loot table that drops ability books appropriate for that tier range.

```typescript
// Seed data pattern:
// Boss tier 1-8 loot table includes: ability_book_fireball_1, ability_book_heal_1, etc.
// Boss tier 9-16 loot table includes: ability_book_fireball_2, ability_book_heal_2, etc.
// Book tier encoded in itemId suffix (_1, _2, _3) or item metadata
```

---

## 4. Combat Integration

### 4.1 Ability State in Combat
Each equipped ability tracks its own cooldown during a fight:

```typescript
interface AbilityCombatState {
  abilityId: string;
  level: number;
  nextAvailableAt: number;    // timestamp when off cooldown
  power: number;              // calculated: basePower * (1 + powerScalingPerLevel)^(level-1) * (1 + wisdomBonus)
}
```

### 4.2 Auto-Battle Simulation (simulateRegularBattle)
Modified to process abilities alongside auto-attacks:

```typescript
// In simulateRegularBattle:
// 1. Build player combat profile (includes wisdom level, wisdom bonus)
// 2. Load equipped abilities → build AbilityCombatState[]
// 3. Simulation loop (discrete time steps at attack intervals):
//    - Check each ability: if now >= nextAvailableAt and conditions met → CAST
//    - Apply ability effect (damage, heal, buff)
//    - Set nextAvailableAt = now + cooldownMs * (1 - haste)  // haste from DEX/passives?
//    - Award wisdom XP on cast
// 4. Continue until monster or player dies
```

### 4.3 Boss Fights (bossSessions)
Same system applies to manual boss fights. Abilities available as action buttons in UI, but also auto-fire if configured.

### 4.4 Ability Effect Resolution
### 4.4 Ability Effect Resolution
```typescript
// In combat.ts or new abilities.ts:
async function resolveAbilityEffect(
  ctx: MutationCtx,
  player: Player,
  ability: Doc<"abilities">,
  abilityLevel: number,
  wisdomLevel: number,
  wisdomBonus: number,
  target: "self" | "enemy",
  monster: ScaledMonster,
  now: number
): Promise<AbilityResult> {
  const power = ability.basePower * 
    Math.pow(1 + ability.powerScalingPerLevel, abilityLevel - 1) * 
    (1 + wisdomBonus);
  
  switch (ability.type) {
    case "attack":
      // Deal damage: power * (1 + player damage mods) vs monster defense
      return { damage: calculatedDamage, wisdomXp: baseXp * abilityLevel };
    case "heal":
      // Heal player: power * (1 + heal mods)
      return { heal: calculatedHeal, wisdomXp: baseXp * abilityLevel };
    case "buff_offense":
    case "buff_defense":
      // Apply temporary buff (tracked in combat state)
      return { buffApplied: true, wisdomXp: baseXp * abilityLevel };
    // ...
  }
}
```

### 4.5 Activation Requirements (TODO — implement in Phase 3)

Cooldown-ready must not mean auto-cast. Every equipped ability needs trigger
conditions evaluated in the combat loop before casting. Seed stub:
`meetsActivationRequirements` in `convex/abilities.ts` (currently always
true).

- **Heals (Healing Touch, Greater Heal, Holy Light lifesteal n/a):** only
  cast while player HP is below `activationHpBelowPercent` (per-ability
  config, e.g. 70 for Healing Touch, 50 for Greater Heal). Clamp the heal to
  missing HP so logs never report overheal. Never cast at full HP — wasted
  cooldown and wasted wisdom-XP pacing.
- **Execute (Executioner's Strike):** only cast while enemy HP is below
  `activationEnemyHpBelowPercent` (e.g. 30, matching the bonus window).
- **Offense buffs (Battle Cry, Berserker Rage):** cast at fight start or
  when the previous instance expired; never refresh an active instance.
  Optional: hold Berserker Rage until enemy HP is above some floor so the
  -defense downside doesn't overlap the kill window.
- **Defense buffs (Iron Will, Warding Light):** cast when HP drops below
  threshold OR when the active instance expired mid-fight; never pre-cast
  at full HP unless the fight is a known burst opener (boss telegraphs —
  future work).
- **Priority:** when several abilities are ready on the same tick, cast in
  slot order (player-arranged priority), one cast per tick max. Document in
  the equip UI ("lower slot = higher priority").
- **Manual vs auto:** boss fights expose equipped abilities as buttons that
  bypass thresholds (player's call, still pays cooldown); auto-battle
  always enforces thresholds server-side. Ranked/arena reuse the
  auto-battle rule set.
- **Schema additions needed:** `activationHpBelowPercent`,
  `activationEnemyHpBelowPercent` (both optional; absent = always
  triggerable), seeded per ability in `populateAbilities`, admin-editable
  via the abilities section.

---

## 5. Balance Configuration (gameBalance keys)

```typescript
// Wisdom
"wisdomXpPerAbilityUse": 10,           // base wisdom XP per ability cast
"wisdomPowerBonusPerLevel": 0.005,     // 0.5% ability power per wisdom level
"wisdomBaseSlots": 1,                   // slots at level 1
"wisdomLevelsPerSlot": 33,              // levels per additional slot
"wisdomMaxSlots": 4,                    // hard cap

// Ability Books
"abilityBookBaseXp": 100,               // XP from tier 1 book
"abilityBookXpPerBookTier": 1.0,        // linear multiplier per book tier

// Ability Cooldown Scaling (optional)
"abilityCooldownHastePerDex": 0.001,    // DEX reduces cooldown slightly
```

---

## 6. Implementation Files

### New Files
```
convex/
  abilities.ts          // Core ability logic (definitions, learning, equipping, specs)
  abilityCombat.ts      // Shared auto-cast core: cooldowns, buffs, damage/heal math
  abilityBooks.ts       // Book consumption, XP granting, validation
  abilityUi.ts          // Player panel query + equip/unequip/use-book mutations
  roundCombat.ts        // Shared round exchange for arena, ranked, and guild raid
  fightHistory.ts       // Settlement key derivation + fight-history writes
  hitRoll.ts            // Shared attack rolls (variance band, flat range)
  pvpSnapshot.ts        // Frozen PvP fighter model + its swing rule
  wisdom.ts             // Wisdom XP, level calculation, slot limits, power bonus

app/
  components/inventory/
    AbilitiesPanel.tsx        // Abilities tab inside the inventory shell
  hooks/
    useAbilities.ts           // React hooks for the abilities panel
```

### Modified Files
```
convex/
  schema.ts               // Add ability tables, extend players, freeze encounter ability state
  itemTypes.ts            // Add "abilityBook" category
  combat.ts               // Auto-battle ability path via abilityCombat
  bossFights.ts           // Interleaved real-time ability timeline
  arena.ts / ranked.ts    // Round-based auto-cast during PvP, via roundCombat
  guildRaids.ts           // Round-based auto-cast, ally heals, tough-skin damage
  loot.ts                 // Award wisdom XP on combat victory, settle via fightHistory
  migrations.ts           // Clear legacy arena lobby settlement keys
  balance.ts              // New balance keys
  seed.ts                 // Seed ability definitions + book items
  adminConfig.ts          // Add "abilities" admin section
  admin.ts                // Admin CRUD for abilities
  playerHp.ts             // Heal abilities interact with HP system

app/
  components/inventory/InventoryPanel.tsx  // Abilities tab in the inventory shell
  lib/gameRoutes.ts                        // /inventory/abilities route param
```

---

## 7. Migration Plan

### 7.1 Schema Migration
```typescript
// convex/migrations.ts
export const addWisdomToPlayers = migration({
  // Add wis=1, statXp.wis=0 to all existing players
  // Backfill: wis = 1 for all, statXp.wis = 0
});

export const backfillAbilityTables = migration({
  // Create empty tables (abilities, playerAbilities, playerEquippedAbilities)
  // No data migration needed - fresh start
});
```

### 7.2 Seed Data — Ability Definitions & Drop Table

#### Weapon Abilities (2 per weapon: Lesser + Greater)

| Weapon | Ability | Type | Tier Drop | Book Tier | Description |
|--------|---------|------|-----------|-----------|-------------|
| **Sword** | **Whirlwind** | attack (AoE) | 2 | 1 | Spin attack hitting all enemies in range. Base power scales with STR. |
| | **Executioner's Strike** | attack (execute) | 6 | 1 | Single-target strike dealing bonus damage below 30% enemy HP. Greater version of Whirlwind concept. |
| **Dagger** | **Backstab** | attack (positional) | 1 | 1 | High crit chance attack. Bonus damage when attacking from stealth/behind (simulated via RNG). |
| | **Shadow Dance** | attack (multi-hit) | 5 | 1 | Rapid 4-hit combo. Each hit applies stacking poison DoT. Greater version of Backstab. |
| **Mace** | **Smite** | attack (stun) | 3 | 1 | Heavy blow with chance to stun enemy for 1 round (skip their attack). Scales with STR. |
| | **Crushing Judgment** | attack (armor break) | 7 | 1 | Deals damage and permanently reduces enemy defense for the fight. Greater version of Smite. |
| **Bow** | **Piercing Shot** | attack (penetration) | 2 | 1 | Ignores 50% of enemy defense. Scales with DEX. |
| | **Rain of Arrows** | attack (AoE) | 6 | 1 | Volley hitting 3 random enemies (or same enemy 3x). Greater version of Piercing Shot. |
| **Staff** | **Fireball** | attack (fire) | 1 | 1 | Ranged fire damage. +25% power if staff element = fire, -15% if water. |
| | **Scorching Ray** | attack (fire) | 5 | 1 | Concentrated fire beam, 3 hits over 2s. Each hit applies Burn (DoT). +25% fire, -15% water. |
| | **Ice Shard** | attack (water/ice) | 2 | 1 | Water damage + applies Chill (reduces enemy attack speed 20%). +25% water, -15% fire. |
| | **Glacial Spike** | attack (water/ice) | 6 | 1 | Heavy ice projectile that shatters. On Chill target: consumes Chill for 2x damage + Freeze (stun 1 round). +25% water, -15% fire. |
| | **Lightning Bolt** | attack (wind/lightning) | 3 | 1 | Wind damage with chain chance (25% to hit 2nd target). +25% wind, -15% earth. |
| | **Storm Call** | attack (wind/lightning) | 7 | 1 | Summons lightning storm: 4 random strikes over 3s. Each strike chains independently. +25% wind, -15% earth. |
| | **Stone Spikes** | attack (earth) | 4 | 1 | Earth damage + applies Bleed. +25% earth, -15% wind. |
| | **Seismic Slam** | attack (earth) | 8 | 1 | Ground slam AoE. Enemies hit gain Petrify (defense -30%, cannot act 1 round). +25% earth, -15% wind. |
| | **Holy Light** | attack (light) | 5 | 1 | **Damage + Heal**: Light damage to enemy, heals self for 40% of damage dealt. Bonus vs undead/dark. +25% light, -15% dark. |
| | **Radiant Judgment** | attack (light) | 8 | 1 | **Greater**: Blinding light — high light damage, applies Blind (enemy miss chance 30% for 2 rounds), heals 25% max HP. +25% light, -15% dark. |
| | **Shadow Bolt** | attack (dark) | 6 | 1 | Dark damage, applies Curse (reduces enemy defense 15%). +25% dark, -15% light. |
| | **Void Tendrils** | attack (dark) | 8 | 1 | **Greater**: Shadow tendrils lash out — 3 hits, each steals 10% of damage as HP. Applies Dread (enemy damage -15%). +25% dark, -15% light. |
| | **Arcane Explosion** | attack (arcane/AoE) | 7 | 1 | Non-elemental AoE centered on target. Scales with INT only. No elemental interaction. |

#### Universal Abilities (Non-Weapon Specific)

| Category | Ability | Type | Tier Drop | Book Tier | Description |
|----------|---------|------|-----------|-----------|-------------|
| **Healing** | **Healing Touch** | heal | 1 | 1 | Restore HP = 15% max HP + INT×2. 12s cooldown. |
| | **Greater Heal** | heal | 5 | 1 | Restore HP = 35% max HP + INT×5. 20s cooldown. Greater version. |
| **Offense Buff** | **Battle Cry** | buff_offense | 2 | 1 | +15% damage, +10% crit chance for 20s. 30s cooldown. |
| | **Berserker Rage** | buff_offense | 6 | 1 | +30% damage, +20% attack speed, -20% defense for 15s. 45s cooldown. Greater version. |
| **Defense Buff** | **Iron Will** | buff_defense | 3 | 1 | +40% defense, +25% magical defense for 25s. 30s cooldown. |
| | **Warding Light** | buff_defense | 7 | 1 | +30% all defense, gain elemental wards (all elements +20) for 20s. 40s cooldown. Greater version. |

---

#### Boss Tier → Ability Book Mapping

**Book Tier 1** (dropped by bosses tiers 1-8): All abilities listed above drop as Tier 1 books (base XP: 100)

| Boss Tier | Abilities Available (Book Tier 1) |
|-----------|-----------------------------------|
| 1 | Backstab (Dagger), Fireball (Staff), Healing Touch |
| 2 | Whirlwind (Sword), Piercing Shot (Bow), Ice Shard (Staff), Battle Cry |
| 3 | Smite (Mace), Lightning Bolt (Staff), Iron Will |
| 4 | Stone Spikes (Staff) |
| 5 | Shadow Dance (Dagger), Greater Heal, Holy Light (Staff) |
| 6 | Executioner's Strike (Sword), Rain of Arrows (Bow), Shadow Bolt (Staff), Berserker Rage |
| 7 | Crushing Judgment (Mace), Warding Light, Arcane Explosion (Staff) |
| 8 | Meteor Swarm (Staff) |

---

#### Elemental Interaction Rules (Staff Abilities Only)

```typescript
// In abilities.ts combat resolution:
const ELEMENT_OPPOSITES: Record<string, string> = {
  fire: "water",
  water: "fire",
  wind: "earth",
  earth: "wind",
  light: "dark",
  dark: "light",
  arcane: null,  // no opposite
};

function calculateStaffElementalMultiplier(
  abilityElement: string,
  staffElement: string | null
): number {
  if (!staffElement) return 1.0;
  if (staffElement === abilityElement) return 1.25;      // Same element: +25%
  if (ELEMENT_OPPOSITES[abilityElement] === staffElement) return 0.85; // Opposite: -15%
  return 1.0;  // Neutral: no modifier
}
```

**Staff Design Rationale**:
- Staff has ~30% lower base auto-attack DPS than sword/mace (by design)
- **10 elemental abilities** (2 per element: fire, water, wind, earth, light, dark) + 1 non-elemental = versatile toolkit
- **2 spells per element**: lesser (tiers 1-4) + greater (tiers 5-8) for progression
- Element matching rewards preparation (craft/enchant staff for specific boss)
- No hard requirement — can use any ability on any staff, just suboptimal vs opposed
- Arcane Explosion gives non-elemental fallback

---

#### Ability Book Items (Seed Data)

```typescript
// convex/seed.ts additions:
async function seedAbilityBooks(ctx: MutationCtx) {
  const abilityBooks = [
    // Tier 1 books (boss tiers 1-8)
    // Weapon abilities
    { itemId: "ability_book_backstab_1", name: "Tome of Backstab I", abilityId: "backstab", bookTier: 1, xp: 100 },
    { itemId: "ability_book_shadow_dance_1", name: "Tome of Shadow Dance I", abilityId: "shadow_dance", bookTier: 1, xp: 100 },
    { itemId: "ability_book_whirlwind_1", name: "Tome of Whirlwind I", abilityId: "whirlwind", bookTier: 1, xp: 100 },
    { itemId: "ability_book_executioner_strike_1", name: "Tome of Executioner's Strike I", abilityId: "executioner_strike", bookTier: 1, xp: 100 },
    { itemId: "ability_book_smite_1", name: "Tome of Smite I", abilityId: "smite", bookTier: 1, xp: 100 },
    { itemId: "ability_book_crushing_judgment_1", name: "Tome of Crushing Judgment I", abilityId: "crushing_judgment", bookTier: 1, xp: 100 },
    { itemId: "ability_book_piercing_shot_1", name: "Tome of Piercing Shot I", abilityId: "piercing_shot", bookTier: 1, xp: 100 },
    { itemId: "ability_book_rain_of_arrows_1", name: "Tome of Rain of Arrows I", abilityId: "rain_of_arrows", bookTier: 1, xp: 100 },
    // Staff abilities - Fire (2)
    { itemId: "ability_book_fireball_1", name: "Tome of Fireball I", abilityId: "fireball", bookTier: 1, xp: 100 },
    { itemId: "ability_book_scorching_ray_1", name: "Tome of Scorching Ray I", abilityId: "scorching_ray", bookTier: 1, xp: 100 },
    // Staff abilities - Water/Ice (2)
    { itemId: "ability_book_ice_shard_1", name: "Tome of Ice Shard I", abilityId: "ice_shard", bookTier: 1, xp: 100 },
    { itemId: "ability_book_glacial_spike_1", name: "Tome of Glacial Spike I", abilityId: "glacial_spike", bookTier: 1, xp: 100 },
    // Staff abilities - Wind/Lightning (2)
    { itemId: "ability_book_lightning_bolt_1", name: "Tome of Lightning Bolt I", abilityId: "lightning_bolt", bookTier: 1, xp: 100 },
    { itemId: "ability_book_storm_call_1", name: "Tome of Storm Call I", abilityId: "storm_call", bookTier: 1, xp: 100 },
    // Staff abilities - Earth (2)
    { itemId: "ability_book_stone_spikes_1", name: "Tome of Stone Spikes I", abilityId: "stone_spikes", bookTier: 1, xp: 100 },
    { itemId: "ability_book_seismic_slam_1", name: "Tome of Seismic Slam I", abilityId: "seismic_slam", bookTier: 1, xp: 100 },
    // Staff abilities - Light (2)
    { itemId: "ability_book_holy_light_1", name: "Tome of Holy Light I", abilityId: "holy_light", bookTier: 1, xp: 100 },
    { itemId: "ability_book_radiant_judgment_1", name: "Tome of Radiant Judgment I", abilityId: "radiant_judgment", bookTier: 1, xp: 100 },
    // Staff abilities - Dark (2)
    { itemId: "ability_book_shadow_bolt_1", name: "Tome of Shadow Bolt I", abilityId: "shadow_bolt", bookTier: 1, xp: 100 },
    { itemId: "ability_book_void_tendrils_1", name: "Tome of Void Tendrils I", abilityId: "void_tendrils", bookTier: 1, xp: 100 },
    // Staff abilities - Arcane (1)
    { itemId: "ability_book_arcane_explosion_1", name: "Tome of Arcane Explosion I", abilityId: "arcane_explosion", bookTier: 1, xp: 100 },
    // Universal abilities
    { itemId: "ability_book_healing_touch_1", name: "Tome of Healing Touch I", abilityId: "healing_touch", bookTier: 1, xp: 100 },
    { itemId: "ability_book_greater_heal_1", name: "Tome of Greater Heal I", abilityId: "greater_heal", bookTier: 1, xp: 100 },
    { itemId: "ability_book_battle_cry_1", name: "Tome of Battle Cry I", abilityId: "battle_cry", bookTier: 1, xp: 100 },
    { itemId: "ability_book_berserker_rage_1", name: "Tome of Berserker Rage I", abilityId: "berserker_rage", bookTier: 1, xp: 100 },
    { itemId: "ability_book_iron_will_1", name: "Tome of Iron Will I", abilityId: "iron_will", bookTier: 1, xp: 100 },
    { itemId: "ability_book_warding_light_1", name: "Tome of Warding Light I", abilityId: "warding_light", bookTier: 1, xp: 100 },
    
    // Tier 2 books (boss tiers 9-16) - 2x XP
    { itemId: "ability_book_backstab_2", name: "Tome of Backstab II", abilityId: "backstab", bookTier: 2, xp: 200 },
    { itemId: "ability_book_shadow_dance_2", name: "Tome of Shadow Dance II", abilityId: "shadow_dance", bookTier: 2, xp: 200 },
    { itemId: "ability_book_whirlwind_2", name: "Tome of Whirlwind II", abilityId: "whirlwind", bookTier: 2, xp: 200 },
    { itemId: "ability_book_executioner_strike_2", name: "Tome of Executioner's Strike II", abilityId: "executioner_strike", bookTier: 2, xp: 200 },
    { itemId: "ability_book_smite_2", name: "Tome of Smite II", abilityId: "smite", bookTier: 2, xp: 200 },
    { itemId: "ability_book_crushing_judgment_2", name: "Tome of Crushing Judgment II", abilityId: "crushing_judgment", bookTier: 2, xp: 200 },
    { itemId: "ability_book_piercing_shot_2", name: "Tome of Piercing Shot II", abilityId: "piercing_shot", bookTier: 2, xp: 200 },
    { itemId: "ability_book_rain_of_arrows_2", name: "Tome of Rain of Arrows II", abilityId: "rain_of_arrows", bookTier: 2, xp: 200 },
    { itemId: "ability_book_fireball_2", name: "Tome of Fireball II", abilityId: "fireball", bookTier: 2, xp: 200 },
    { itemId: "ability_book_scorching_ray_2", name: "Tome of Scorching Ray II", abilityId: "scorching_ray", bookTier: 2, xp: 200 },
    { itemId: "ability_book_ice_shard_2", name: "Tome of Ice Shard II", abilityId: "ice_shard", bookTier: 2, xp: 200 },
    { itemId: "ability_book_glacial_spike_2", name: "Tome of Glacial Spike II", abilityId: "glacial_spike", bookTier: 2, xp: 200 },
    { itemId: "ability_book_lightning_bolt_2", name: "Tome of Lightning Bolt II", abilityId: "lightning_bolt", bookTier: 2, xp: 200 },
    { itemId: "ability_book_storm_call_2", name: "Tome of Storm Call II", abilityId: "storm_call", bookTier: 2, xp: 200 },
    { itemId: "ability_book_stone_spikes_2", name: "Tome of Stone Spikes II", abilityId: "stone_spikes", bookTier: 2, xp: 200 },
    { itemId: "ability_book_seismic_slam_2", name: "Tome of Seismic Slam II", abilityId: "seismic_slam", bookTier: 2, xp: 200 },
    { itemId: "ability_book_holy_light_2", name: "Tome of Holy Light II", abilityId: "holy_light", bookTier: 2, xp: 200 },
    { itemId: "ability_book_radiant_judgment_2", name: "Tome of Radiant Judgment II", abilityId: "radiant_judgment", bookTier: 2, xp: 200 },
    { itemId: "ability_book_shadow_bolt_2", name: "Tome of Shadow Bolt II", abilityId: "shadow_bolt", bookTier: 2, xp: 200 },
    { itemId: "ability_book_void_tendrils_2", name: "Tome of Void Tendrils II", abilityId: "void_tendrils", bookTier: 2, xp: 200 },
    { itemId: "ability_book_arcane_explosion_2", name: "Tome of Arcane Explosion II", abilityId: "arcane_explosion", bookTier: 2, xp: 200 },
    { itemId: "ability_book_healing_touch_2", name: "Tome of Healing Touch II", abilityId: "healing_touch", bookTier: 2, xp: 200 },
    { itemId: "ability_book_greater_heal_2", name: "Tome of Greater Heal II", abilityId: "greater_heal", bookTier: 2, xp: 200 },
    { itemId: "ability_book_battle_cry_2", name: "Tome of Battle Cry II", abilityId: "battle_cry", bookTier: 2, xp: 200 },
    { itemId: "ability_book_berserker_rage_2", name: "Tome of Berserker Rage II", abilityId: "berserker_rage", bookTier: 2, xp: 200 },
    { itemId: "ability_book_iron_will_2", name: "Tome of Iron Will II", abilityId: "iron_will", bookTier: 2, xp: 200 },
    { itemId: "ability_book_warding_light_2", name: "Tome of Warding Light II", abilityId: "warding_light", bookTier: 2, xp: 200 },
    
    // Tier 3 books (boss tiers 17-24) - 3x XP
    // ... repeat for all abilities with bookTier: 3, xp: 300
  ];
  
  for (const book of abilityBooks) {
    await ctx.db.insert("items", {
      itemId: book.itemId,
      name: book.name,
      category: "abilityBook",
      description: `Teaches ${book.abilityId.replace(/_/g, " ")} (Book Tier ${book.bookTier}). Grants ${book.xp} ability XP.`,
      stackable: true,
      maxStackSize: 99,
      effectType: "ability_book",
      effectAmount: book.xp,
      // Custom metadata stored in effectData or separate fields
      // abilityId: book.abilityId
      // bookTier: book.bookTier
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}
```

---

#### Loot Table Entries for Bosses (by tier)

```typescript
// Boss tier 1 loot table: Backstab, Fireball, Healing Touch (weight 10 each)
// Boss tier 2 loot table: + Whirlwind, Piercing Shot, Ice Shard, Battle Cry (weight 8 each)
// Boss tier 3 loot table: + Smite, Lightning Bolt, Iron Will (weight 8 each)
// Boss tier 4 loot table: + Stone Spikes (weight 8)
// Boss tier 5 loot table: + Shadow Dance, Greater Heal, Holy Light, Scorching Ray (weight 6 each)
// Boss tier 6 loot table: + Executioner's Strike, Rain of Arrows, Shadow Bolt, Berserker Rage, Glacial Spike (weight 6 each)
// Boss tier 7 loot table: + Crushing Judgment, Warding Light, Arcane Explosion, Storm Call (weight 5 each)
// Boss tier 8 loot table: + Seismic Slam, Radiant Judgment, Void Tendrils (weight 4, guaranteed 1 per kill)

// Higher tier bosses also include lower-tier books (so tier 8 boss can drop any book)
// Weight favors current-tier books but doesn't exclude earlier ones
```

---

#### Staff Elemental Affinity UI Hint

```typescript
// In AbilityPanel.tsx for staff abilities:
function getElementalHint(ability: Doc<"abilities">, equippedStaff: Doc<"playerItems"> | null) {
  const staffElement = equippedStaff?.element;
  const abilityElement = ability.element;
  
  if (!staffElement) return "No staff element — neutral damage";
  if (staffElement === abilityElement) return `⚡ ${abilityElement} staff: +25% power!`;
  if (ELEMENT_OPPOSITES[abilityElement] === staffElement) return `⚠️ ${abilityElement} vs ${staffElement}: -15% power`;
  return `Neutral (${staffElement} staff vs ${abilityElement} ability)`;
}
```

---

### 7.3 Migration Plan (Updated)
```typescript
// convex/migrations.ts
export const addWisdomToPlayers = migration({
  // Add wis=1, statXp.wis=0, rebirthAbilityBonuses={} to all existing players
});

export const backfillAbilityTables = migration({
  // Create empty tables (abilities, playerAbilities, playerEquippedAbilities)
});

export const seedAbilitiesAndBooks = migration({
  // Run after schema push: seed ability definitions + book items + boss loot tables
  // This is a one-time seed migration
});
```

---

## 8. UI/UX Considerations

### 8.1 Abilities Panel
- **Learned Tab**: List all learned abilities with level/XP bar, "Level Up" button (consumes books)
- **Equip Tab**: Drag-drop or click to assign to slots 1-4 (locked slots show wisdom requirement)
- **Books Tab**: Inventory view of ability books, "Use" button consumes and grants XP

### 8.2 Combat UI
- Show equipped ability icons with cooldown rings during fight
- Wisdom XP gain shown in combat log
- Wisdom level displayed in stats panel

### 8.3 Wisdom Progression
- Wisdom bar in character stats (like other combat stats)
- Tooltip shows: current level, XP to next, max slots, power bonus %

---

## 9. Testing Strategy

### 9.1 Unit Tests (convex/abilities.test.ts)
- Wisdom level calculation at various XP values
- Max slots at wisdom levels 1, 25, 50, 100
- Ability power scaling with level + wisdom
- Book consumption grants correct XP by tier
- Equip/unequip validation (slot limits, duplicates)

### 9.2 Integration Tests
- Auto-battle with equipped abilities fires correctly
- Wisdom XP awarded on ability cast
- Boss drops correct book tier for boss tier
- Admin panel CRUD works

### 9.3 Sim Tests (simLive.test.ts)
- Full combat simulation with abilities vs without
- Wisdom progression over many fights
- Book drop → learn → level up → equip flow

---

## 10. Phased Rollout

### Phase 1: Core Schema + Wisdom
- Add wisdom to players table (+ `rebirthAbilityBonuses` field)
- Wisdom XP curve, level calculation, slot limits
- Basic admin UI for wisdom balance
- **Rebirth integration**: wisdom qualifies for rebirth, earns `rebirthStatBonuses.wis`

### Phase 2: Abilities Definitions + Books
- Abilities table + seed data
- Ability book items + boss loot integration
- Learn/level up mechanics
- **Rebirth integration**: `resetAllPlayerAbilities`, `clearEquippedAbilities`, ability rebirth bonuses

### Phase 3: Equip System + Combat Integration
- Equipped abilities table + UI
- Auto-battle ability casting
- Wisdom XP on cast

### Phase 4: Polish
- Combat log ability events
- Ability animations/effects in UI
- Balance tuning via admin

### Implementation Status

- The shared core (`abilityCombat.ts`) is used by auto-battle, boss, arena,
  ranked, and guild raid, so damage/heal/buff math and cooldowns cannot drift.
- Real-time encounters (auto-battle, boss) cast on millisecond cooldowns;
  round-based encounters (arena, ranked, raid) cast once per round.
- The round-based encounters share one round exchange (`roundCombat.ts`):
  every fighter casts, then every fighter swings, then the round is judged.
  Arena, ranked, and the guild raid supply only their own numbers.
- Heals defer while they would overheal. Ally heals land on the caster in 1v1
  and on the most-injured living member in raids.
- The equip/learn/book UI is the **Abilities** tab in the inventory
  (`/inventory/abilities`), backed by `abilityUi.ts`.
- PvP casts earn no wisdom XP; raid wisdom XP is paid only to participants who
  clear the existing raid-XP damage gate.
- Settled fights are recorded through one seam (`fightHistory.ts`): the
  settlement key is derived, not hand-built, and is always player-prefixed.
- The slot cap is a balance value (`wisdomMaxSlots`), so raising it in the
  admin editor unlocks the higher slots everywhere — panel, equip path, and
  the starter-ability migration.

---

## 11. Open Questions / Future Extensions

1. **Mana System**: Abilities have `manaCost` field reserved. Add mana pool + regen later.
2. **Ability Synergies**: Certain ability combos grant bonus effects.
3. **Ultimate Abilities**: High-cooldown, high-impact abilities unlocked at wisdom 100.
4. **PvP Abilities**: Separate balancing for arena (cooldown reduction, dampening).
5. **Guild Raid Abilities**: Support `target: "ally"` for raid heals/buffs.
6. **Ability Mastery**: Max-level abilities unlock passive bonuses.

---

## 11. Rebirth Integration

### 11.1 Wisdom on Rebirth
- **Full reset**: `wis` → 1, `statXp.wis` → 0 (like str/dex/int/luk/con)
- **Rebirth eligibility**: Wisdom level counts as 6th combat stat. If `wis >= rebirthStatRequirement`, qualifies for rebirth and earns `rebirthStatBonuses.wis += 1`
- **Permanent bonus**: Each banked wisdom bonus adds `rebirthStatBonusPercent` (default 5%) to effective wisdom, flowing into:
  - Max equipped ability slots
  - Ability power bonus
  - Wisdom XP gain rate (if we add that scaling)

### 11.2 Abilities on Rebirth
- **Knowledge persists**: `playerAbilities` rows are **not deleted** — you keep the list of learned abilities
- **Levels reset**: Each `playerAbilities` row patched to `level: 1, experience: 0, totalExperience: 0` (like `resetAllPlayerSkills`)
- **Equipped abilities cleared**: `playerEquippedAbilities` rows deleted (re-equip after rebirth)
- **Ability books persist**: Items in `playerItems` with `category: "abilityBook"` are NOT wiped (they're regular items)

### 11.3 Ability Rebirth Bonuses (Optional but Recommended)
Each ability can earn a permanent rebirth bonus like skills do:

```typescript
// In rebirth.ts, extend rebirth mutation:
const qualifyingAbilities = await qualifyingRebirthAbilities(ctx, playerId, requirement);
const abilityBonuses = getRebirthAbilityBonuses(player); // new helper
for (const abilityId of qualifyingAbilities) {
  abilityBonuses[abilityId] = (abilityBonuses[abilityId] ?? 0) + 1;
}
await ctx.db.patch(playerId, {
  // ... existing fields ...
  rebirthAbilityBonuses: abilityBonuses, // NEW field on players table
});
```

**Effect**: Each banked ability bonus adds `rebirthAbilityBonusPercent` (new balance, default 3-5%) to:
- Ability power (damage/heal/buff magnitude)
- Ability cooldown reduction (faster casts)
- Wisdom XP gained from using that ability

### 11.4 Schema Addition for Rebirth Ability Bonuses
```typescript
// In players table:
rebirthAbilityBonuses: v.optional(v.record(v.string(), v.number())), // keyed by abilityId
```

### 11.5 Rebirth Rewards for Abilities
The existing `rebirthRewards` table can grant ability-related perks at milestones:
- Rebirth 1: Unlock 2nd ability slot (wisdom requirement reduced)
- Rebirth 3: +10% ability power globally
- Rebirth 5: Unlock "Ability Mastery" passive node branch
- Rebirth 10: Ability cooldowns reduced by 15%

### 11.6 Updated Rebirth Mutation Flow
```typescript
// In players.ts rebirth mutation:
1. Check eligibility: qualifyingStats (now includes wis) OR qualifyingSkills OR qualifyingAbilities
2. Calculate bonuses for stats, skills, AND abilities
3. resetAllStatUpgrades (unchanged)
4. clearPlayerPassives (unchanged)
5. resetAllPlayerSkills (unchanged)
6. resetAllPlayerAbilities (NEW - patches levels to 1)
7. clearEquippedAbilities (NEW - deletes playerEquippedAbilities rows)
8. Patch player: reset stats, statXp (including wis), rebirth bonuses, etc.
9. Return new rebirth state including ability bonuses
```

### 11.7 New Helper Functions (rebirth.ts)
```typescript
export async function qualifyingRebirthAbilities(
  ctx: DatabaseCtx,
  playerId: PlayerId,
  requirement: number
): Promise<string[]> {
  const abilities = await ctx.db
    .query("playerAbilities")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();
  return abilities
    .filter((a) => a.level >= requirement)
    .map((a) => a.abilityId);
}

export function getRebirthAbilityBonuses(player: Doc<"players">): Record<string, number> {
  const stored = player.rebirthAbilityBonuses;
  if (!stored || typeof stored !== "object") return {};
  const bonuses: Record<string, number> = {};
  for (const [abilityId, count] of Object.entries(stored)) {
    if (typeof count === "number" && count > 0) bonuses[abilityId] = count;
  }
  return bonuses;
}

export async function resetAllPlayerAbilities(ctx: MutationCtx, playerId: PlayerId) {
  const rows = await ctx.db
    .query("playerAbilities")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();
  const now = Date.now();
  for (const row of rows) {
    await ctx.db.patch(row._id, {
      level: 1,
      experience: 0,
      totalExperience: 0,
      updatedAt: now,
    });
  }
}

export async function clearEquippedAbilities(ctx: MutationCtx, playerId: PlayerId) {
  const rows = await ctx.db
    .query("playerEquippedAbilities")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
}
```

### 11.8 New Balance Keys
```typescript
"rebirthAbilityBonusPercent": 0.03,      // 3% per rebirth per qualifying ability
"rebirthAbilityCooldownReductionPerBonus": 0.02, // 2% cooldown reduction per bonus
"rebirthAbilityWisdomXpBonusPerBonus": 0.05,     // 5% more wisdom XP per bonus
```

---

## 12. Convex Guidelines Compliance

- All tunable values in `gameBalance` (admin-editable)
- Server-authoritative combat resolution (no client trust)
- Idempotent book consumption (settlementKey pattern)
- Bounded queries with `.take()` limits
- Proper index coverage for new tables
- Migration-safe schema additions (optional fields, defaults in readers)