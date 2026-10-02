import alchemyPotionIcon from "../assets/icons/alchemyPotion.svg";
import backpackIcon from "../assets/icons/backpack.svg";
import bootsIcon from "../assets/icons/boots.png";
import bowIcon from "../assets/icons/bow.svg";
import chestIcon from "../assets/icons/chest.svg";
import daggerIcon from "../assets/icons/dagger.png";
import gemIcon from "../assets/icons/gem.svg";
import helmetIcon from "../assets/icons/helmet.svg";
import herbsIcon from "../assets/icons/herbs.svg";
import ingotIcon from "../assets/icons/ingot.png";
import legsIcon from "../assets/icons/legs.png";
import logIcon from "../assets/icons/log.svg";
import maceIcon from "../assets/icons/mace.png";
import oreIcon from "../assets/icons/ore.png";
import plankIcon from "../assets/icons/plank.png";
import refinedAlchemyIcon from "../assets/icons/refinedAlchemy.png";
import shieldIcon from "../assets/icons/shield.svg";
import staffIcon from "../assets/icons/staff.png";
import swordIcon from "../assets/icons/sword.svg";

/**
 * Minimal item shape needed for default icon resolution. Accepts full
 * `Doc<"items">` rows as well as partial projections (skills panel labels,
 * bazaar order items) that only carry a name.
 */
export interface ItemIconInput {
  category?: string;
  allowedEquipmentSlots?: ReadonlyArray<string>;
  itemFamily?: string | null;
  itemId?: string;
  name?: string;
  craftingSkillId?: string | null;
}

const WEAPON_ICONS = {
  sword: swordIcon,
  dagger: daggerIcon,
  mace: maceIcon,
  bow: bowIcon,
  staff: staffIcon,
} as const;

type WeaponKind = keyof typeof WEAPON_ICONS;

/** Seeded monster-trophy ids (gem placeholders); kept as exact ids so
 * substrings like "heart", "shard", or "scale" can't misroute resources. */
const MONSTER_TROPHY_ITEM_IDS = new Set([
  "moonlit-rat-fang",
  "goblin-thorn-charm",
  "orc-heartwood-shard",
  "troll-moss-hide",
  "wyvern-moon-scale",
  "dragon-ember-scale",
  "demon-ash-seed",
  "nightmare-dreamleaf",
  "archfiend-horn",
]);

function detectWeaponKind(item: ItemIconInput): WeaponKind | null {
  const haystacks = [
    item.itemFamily ?? "",
    item.itemId ?? "",
    item.name ?? "",
  ].map((value) => value.toLowerCase());
  for (const kind of Object.keys(WEAPON_ICONS) as WeaponKind[]) {
    if (haystacks.some((haystack) => haystack.includes(kind))) return kind;
  }
  return null;
}

function equipmentIcon(item: ItemIconInput): string {
  const slot = item.allowedEquipmentSlots?.[0];
  switch (slot) {
    case "head":
      return helmetIcon;
    case "chest":
      return chestIcon;
    case "legs":
      return legsIcon;
    case "feet":
      return bootsIcon;
    case "offHand":
      return shieldIcon;
    case "bag":
      return backpackIcon;
    case "accessory1":
    case "accessory2":
    case "craftingEquipment":
      return gemIcon;
    case "mainHand":
      return WEAPON_ICONS[detectWeaponKind(item) ?? "sword"];
    default:
      // Items without a slot (e.g. partial projections) still resolve by
      // weapon-kind keywords so starter weapons map correctly.
      return WEAPON_ICONS[detectWeaponKind(item) ?? "sword"];
  }
}

function craftingIcon(item: ItemIconInput): string {
  switch (item.itemFamily) {
    case "harvesting-resource":
      return herbsIcon;
    case "mining-resource":
      return oreIcon;
    case "woodcutting-resource":
      return logIcon;
    case "alchemy-essence":
    case "alchemy-powder":
    case "alchemy-extract":
      return refinedAlchemyIcon;
    case "woodworking-lumber":
      return plankIcon;
    case "forging-ingot":
      return ingotIcon;
    case "alchemy-might":
    case "alchemy-focus":
    case "alchemy-swiftness":
    case "alchemy-wisdom":
      return alchemyPotionIcon;
    case "monster-augmentation":
      return gemIcon;
    case "boss-catalyst":
      return gemIcon;
    default:
      break;
  }

  switch (item.craftingSkillId) {
    case "harvesting":
      return herbsIcon;
    case "mining":
      return oreIcon;
    case "woodcutting":
      return logIcon;
    case "woodworking":
      return plankIcon;
    case "forging":
      return ingotIcon;
    case "alchemy":
      return alchemyPotionIcon;
    default:
      break;
  }

  const itemId = (item.itemId ?? "").toLowerCase();
  const itemName = (item.name ?? "").toLowerCase();
  // Combat loot summaries only carry a Convex document id + display name, so
  // keyword matching must consider the name too. The combined haystack lets a
  // partial projection like { itemId: <convex id>, name: "Moonlit Rat Fang" }
  // resolve to the same icon as the full item doc in inventory/skills.
  const haystack = `${itemId} ${itemName}`;
  // Normalized display name ("Moonlit Rat Fang" -> "moonlit-rat-fang") so
  // exact monster-trophy / boss-token matching works without a slug.
  const nameSlug = itemName
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  if (
    haystack.includes("essence") ||
    haystack.includes("powder") ||
    haystack.includes("extract")
  ) {
    return refinedAlchemyIcon;
  }
  if (haystack.includes("lumber")) return plankIcon;
  if (haystack.includes("ingot")) return ingotIcon;
  if (
    haystack.includes("tonic") ||
    haystack.includes("draught") ||
    haystack.includes("salve") ||
    haystack.includes("elixir")
  ) {
    return alchemyPotionIcon;
  }
  // Exact monster-trophy and boss-token ids first: substrings like "heart"
  // (heartwood), "shard", or "scale" also appear in gathering resources.
  // Check the display-name slug too so partial projections without a stored
  // slug (combat loot summaries) still hit before the generic ore/log/herb
  // keywords below.
  if (
    MONSTER_TROPHY_ITEM_IDS.has(itemId) ||
    MONSTER_TROPHY_ITEM_IDS.has(nameSlug)
  )
    return gemIcon;
  if (
    itemId.startsWith("forest-boss-token") ||
    haystack.includes("forest-boss-token") ||
    haystack.includes("token") ||
    haystack.includes("heart of the grove")
  ) {
    return gemIcon;
  }
  // Best-effort keyword fallback for projections that only carry an itemId
  // (e.g. combat loot summaries). Ordered ore → log → herb so shared
  // substrings ("root" in root-amber, "vine" in thornvine) resolve correctly.
  if (
    haystack.includes("amber") ||
    haystack.includes("iron") ||
    haystack.includes("moonstone") ||
    haystack.includes("emberstone") ||
    haystack.includes("stormsilver") ||
    haystack.includes("voidquartz") ||
    haystack.includes("nightsteel") ||
    haystack.includes("-ore") ||
    haystack.includes(" ore") ||
    haystack.includes("shard")
  ) {
    return oreIcon;
  }
  if (
    haystack.includes("-log") ||
    haystack.includes(" log") ||
    haystack.includes("bark") ||
    haystack.includes("thornvine") ||
    haystack.includes("emberwood") ||
    haystack.includes("tidewood") ||
    haystack.includes("voidwood") ||
    haystack.includes("dreadwood") ||
    haystack.includes("worldheart")
  ) {
    return logIcon;
  }
  if (
    haystack.includes("herb") ||
    haystack.includes("leaf") ||
    haystack.includes("moss") ||
    haystack.includes("mushroom") ||
    haystack.includes("bloom") ||
    haystack.includes("blossom") ||
    haystack.includes("spore") ||
    haystack.includes("flower") ||
    haystack.includes("orchid") ||
    haystack.includes("petal") ||
    haystack.includes("lichen") ||
    haystack.includes("root") ||
    haystack.includes("vine") ||
    haystack.includes("fern") ||
    haystack.includes("cap") ||
    haystack.includes("crown") ||
    haystack.includes("seed")
  ) {
    return herbsIcon;
  }
  if (
    haystack.includes("fang") ||
    haystack.includes("charm") ||
    haystack.includes("hide") ||
    haystack.includes("scale") ||
    haystack.includes("dreamleaf") ||
    haystack.includes("ash") ||
    haystack.includes("horn")
  ) {
    return gemIcon;
  }

  return gemIcon;
}

/**
 * Default placeholder icon for an item. Equipment resolves by slot (main-hand
 * weapons resolve further by weapon kind via family/id/name keywords);
 * crafting materials resolve by item family (harvested herbs/ore/log, refined
 * alchemy/lumber/ingot, brewed potions, gem monster drops and boss
 * tokens). Unknown items fall back to the gem icon.
 */
export function getItemIcon(item: ItemIconInput | null | undefined): string {
  if (!item) return gemIcon;
  if (item.category === "equipment") return equipmentIcon(item);
  if (item.category === "crafting") return craftingIcon(item);
  // Partial projections without a category (e.g. combat loot summaries that
  // only carry a document id + display name): try weapon keywords, then
  // family, then the same crafting keyword fallback used for full docs so a
  // partial resolves to the same icon as inventory/skills. Unknown items fall
  // back to the gem icon inside craftingIcon.
  const weaponKind = detectWeaponKind(item);
  if (weaponKind) return WEAPON_ICONS[weaponKind];
  if (item.itemFamily) return craftingIcon({ ...item, category: "crafting" });
  if (item.itemId ?? item.name) return craftingIcon(item);
  return gemIcon;
}

export const ITEM_ICONS = {
  alchemyPotionIcon,
  backpackIcon,
  bootsIcon,
  bowIcon,
  chestIcon,
  daggerIcon,
  gemIcon,
  helmetIcon,
  herbsIcon,
  ingotIcon,
  legsIcon,
  logIcon,
  maceIcon,
  oreIcon,
  plankIcon,
  refinedAlchemyIcon,
  shieldIcon,
  staffIcon,
  swordIcon,
} as const;
