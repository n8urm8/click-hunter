import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { ChartNoAxesCombined, Menu, X } from "lucide-react";
import { NavLink, useLocation } from "react-router";
import { Button } from "~/components/ui/button";
import { EventTracker } from "../player/EventTracker";
import {
  PlayerStatsSummary,
  type PlayerSummaryStats,
} from "../player/PlayerStatsSummary";
import { cn } from "~/lib/utils";
import { GAME_PATHS, inventoryPath, navPanelForPath } from "~/lib/gameRoutes";
import type { Id } from "../../../convex/_generated/dataModel";
import { TaskQueueMenu } from "./TaskQueueMenu";

export type GameNavbarPlayer = PlayerSummaryStats & {
  _id: Id<"players">;
  name: string;
  role?: string;
};

interface GameNavbarProps {
  player: GameNavbarPlayer;
}

const PANEL_ITEMS: Array<{
  to: string;
  label: string;
  matchPrefix: string;
  end?: boolean;
}> = [
  { to: GAME_PATHS.combat, label: "Combat", matchPrefix: "/combat", end: true },
  { to: GAME_PATHS.skills, label: "Skills", matchPrefix: "/skills" },
  { to: GAME_PATHS.shopStore, label: "Shop", matchPrefix: "/shop" },
  { to: inventoryPath("crafting"), label: "Inventory", matchPrefix: "/inventory" },
  { to: GAME_PATHS.rebirth, label: "Rebirth", matchPrefix: "/rebirth", end: true },
  { to: GAME_PATHS.board, label: "Board", matchPrefix: "/board" },
  { to: GAME_PATHS.admin, label: "Admin", matchPrefix: "/admin" },
];

const PANEL_LABELS: Record<string, string> = {
  combat: "Combat",
  skills: "Skills",
  shop: "Shop",
  inventory: "Inventory",
  rebirth: "Rebirth",
  leaderboard: "Board",
  admin: "Admin",
  profile: "Profile",
};

function PanelNavigation({
  items,
  pathname,
  mobile = false,
  onNavigate,
}: {
  items: Array<{ to: string; label: string; matchPrefix: string; end?: boolean }>;
  pathname: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav
      aria-label="Game navigation"
      className={cn(
        "game-nav-links",
        mobile ? "game-nav-links--menu" : "game-nav-links--desktop"
      )}
    >
      {items.map((item) => {
        const isActive = item.end
          ? pathname === item.matchPrefix
          : pathname === item.matchPrefix ||
            pathname.startsWith(`${item.matchPrefix}/`);
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            aria-current={isActive ? "page" : undefined}
            onClick={onNavigate}
            className="game-nav-link"
          >
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

function PlayerStatsPopover({ player }: { player: GameNavbarPlayer }) {
  return (
    <div className="game-navbar-stats-trigger">
      <Popover.Root>
        <Popover.Trigger
          aria-label="Open character stats"
          title="Character stats"
          render={
            <Button
              variant="outline"
              size="icon-sm"
              className="border-forest-light/30 text-foreground hover:border-gold/60 hover:bg-forest-dark/60"
            />
          }
        >
          <ChartNoAxesCombined aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            side="bottom"
            align="start"
            sideOffset={8}
            className="z-[100]"
          >
            <Popover.Popup className="game-stats-popover">
              <div className="game-stats-popover-header">
                <Popover.Title className="font-heading text-base text-gold">
                  Character stats
                </Popover.Title>
                <Popover.Description className="text-xs text-muted-foreground">
                  Attributes, combat, progression, and gold.
                </Popover.Description>
              </div>
              <PlayerStatsSummary player={player} />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

export function GameNavbar({ player }: GameNavbarProps) {
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const panelItems = PANEL_ITEMS.filter(
    (item) => item.matchPrefix !== "/admin" || player.role === "admin"
  );
  const navPanel = navPanelForPath(location.pathname);
  const currentPanelLabel = navPanel ? PANEL_LABELS[navPanel] : undefined;

  useEffect(() => {
    if (!isMenuOpen) return;

    const desktop = window.matchMedia("(min-width: 64rem)");
    const closeOnDesktop = () => {
      if (desktop.matches) {
        setIsMenuOpen(false);
      }
    };

    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [isMenuOpen]);

  // Close the mobile menu on route change.
  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname, location.search]);

  return (
    <Dialog.Root open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <header ref={headerRef} className="game-navbar">
        <div className="game-navbar-row">
          <div className="game-navbar-player">
            <h1 className="game-navbar-name">
              <NavLink to="/profile" title="Open profile settings">
                {player.name}
              </NavLink>
            </h1>
            <EventTracker className="game-navbar-status" />
          </div>

          <PlayerStatsPopover player={player} />

          <div className="game-navbar-queue">
            <TaskQueueMenu playerId={player._id} />
          </div>

          <PanelNavigation items={panelItems} pathname={location.pathname} />

          <span className="game-navbar-page" aria-label="Current page">
            {currentPanelLabel}
          </span>
          <Dialog.Trigger
            ref={menuButtonRef}
            aria-label="Open game navigation"
            render={
              <Button
                variant="ghost"
                size="icon-lg"
                className="shrink-0 lg:hidden"
              />
            }
          >
            <Menu aria-hidden="true" />
          </Dialog.Trigger>
        </div>
      </header>

      <Dialog.Portal>
        <Dialog.Backdrop className="game-menu-backdrop" />
        <Dialog.Popup
          className="game-menu"
          finalFocus={() =>
            window.matchMedia("(min-width: 64rem)").matches
              ? headerRef.current?.querySelector<HTMLButtonElement>(
                  '[aria-current="page"]'
                ) ?? false
              : menuButtonRef.current
          }
        >
          <div className="game-menu-header">
            <Dialog.Title className="text-base font-semibold">
              Menu
            </Dialog.Title>
            <Dialog.Close
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Close game navigation"
                />
              }
            >
              <X aria-hidden="true" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Navigate between pages and view your character stats.
          </Dialog.Description>

          <div className="game-menu-body">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  <NavLink
                    to="/profile"
                    onClick={() => setIsMenuOpen(false)}
                    className="min-w-0 break-words font-heading text-lg text-foreground no-underline hover:text-primary"
                  >
                    {player.name}
                  </NavLink>
                  <EventTracker />
                </div>
              </div>
            </div>

            <PanelNavigation
              items={panelItems}
              pathname={location.pathname}
              onNavigate={() => setIsMenuOpen(false)}
              mobile
            />
            <PlayerStatsSummary player={player} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
