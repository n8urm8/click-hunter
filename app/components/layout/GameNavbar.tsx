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
import type { ActivePanel } from "~/store/gameStore";
import type { Id } from "../../../convex/_generated/dataModel";
import { TaskQueueMenu } from "./TaskQueueMenu";

export type GameNavbarPlayer = PlayerSummaryStats & {
  _id: Id<"players">;
  name: string;
  role?: string;
};

interface GameNavbarProps {
  player: GameNavbarPlayer;
  activePanel: ActivePanel;
  onPanelChange: (panel: ActivePanel) => void;
}

const PANEL_ITEMS: Array<{
  value: ActivePanel;
  label: string;
}> = [
  { value: "combat", label: "Combat" },
  { value: "skills", label: "Skills" },
  { value: "shop", label: "Shop" },
  { value: "inventory", label: "Inventory" },
  { value: "rebirth", label: "Rebirth" },
  { value: "leaderboard", label: "Board" },
  { value: "admin", label: "Admin" },
];

function PanelNavigation({
  items,
  activePanel,
  onPanelChange,
  mobile = false,
}: {
  items: Array<{ value: ActivePanel; label: string }>;
  activePanel: ActivePanel;
  onPanelChange: (panel: ActivePanel) => void;
  mobile?: boolean;
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
        const isActive = activePanel === item.value;
        return (
          <button
            key={item.value}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onPanelChange(item.value)}
            className="game-nav-link"
          >
            {item.label}
          </button>
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

export function GameNavbar({
  player,
  activePanel,
  onPanelChange,
}: GameNavbarProps) {
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const panelItems = PANEL_ITEMS.filter(
    (item) => item.value !== "admin" || player.role === "admin"
  );
  const isProfileRoute =
    location.pathname === "/profile" || location.pathname === "/profile/";
  const currentPanelLabel = isProfileRoute
    ? "Profile"
    : PANEL_ITEMS.find((item) => item.value === activePanel)?.label;

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

  const handlePanelSelect = (panel: ActivePanel) => {
    onPanelChange(panel);
    setIsMenuOpen(false);
  };

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

          <PanelNavigation
            items={panelItems}
            activePanel={activePanel}
            onPanelChange={onPanelChange}
          />

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
              activePanel={activePanel}
              onPanelChange={handlePanelSelect}
              mobile
            />
            <PlayerStatsSummary player={player} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
