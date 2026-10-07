/**
 * Canonical game routes.
 *
 * Top-level screens each get their own path so nav links are real page
 * routes (deep-linkable, back/forward friendly). Nested marketplace and
 * panel filters live in path params + search params so they are shareable
 * and bookmarkable.
 */

export const GAME_PATHS = {
  combat: "/combat",
  skills: "/skills",
  tree: "/tree",
  bazaar: "/bazaar",
  inventory: "/inventory",
  rebirth: "/rebirth",
  board: "/board",
  admin: "/admin",
  profile: "/profile",
} as const;

export type BazaarView = "browse" | "sell" | "buy" | "orders";

export const BAZAAR_VIEWS: BazaarView[] = ["browse", "sell", "buy", "orders"];

export function isBazaarView(value: string | null): value is BazaarView {
  return (
    value === "browse" || value === "sell" || value === "buy" || value === "orders"
  );
}

export function bazaarPath(view: BazaarView): string {
  return `${GAME_PATHS.bazaar}/${view}`;
}

export type InventoryTab = "crafting" | "equipment" | "cache";

export function isInventoryTab(value: string | null): value is InventoryTab {
  return value === "crafting" || value === "equipment" || value === "cache";
}

export function inventoryPath(tab: InventoryTab): string {
  return `${GAME_PATHS.inventory}/${tab}`;
}

/**
 * Which top-level nav item owns a pathname. Used to highlight
 * Combat/Skills/Shop/Inventory/Rebirth/Board/Admin.
 */
export type NavPanel =
  | "combat"
  | "skills"
  | "tree"
  | "inventory"
  | "bazaar"
  | "rebirth"
  | "leaderboard"
  | "admin"
  | "profile";

export function navPanelForPath(pathname: string): NavPanel | null {
  if (pathname === "/" || pathname.startsWith("/combat")) return "combat";
  if (pathname.startsWith("/skills")) return "skills";
  if (pathname.startsWith("/tree")) return "tree";
  if (pathname.startsWith("/bazaar")) return "bazaar";
  if (pathname.startsWith("/inventory")) return "inventory";
  if (pathname.startsWith("/rebirth")) return "rebirth";
  if (pathname.startsWith("/board")) return "leaderboard";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/profile")) return "profile";
  return null;
}
