import { useState } from "react";
import {
  usePlayerUpgrades,
  useSetAutoAttack,
  useSetAutoStartFight,
} from "~/hooks/usePlayer";

interface AutomationControlsProps {
  player: any;
}

export function AutomationControls({ player }: AutomationControlsProps) {
  const ownedUpgrades = usePlayerUpgrades(player._id);
  const setAutoAttack = useSetAutoAttack();
  const setAutoStartFight = useSetAutoStartFight();
  const [isToggling, setIsToggling] = useState<
    "autoAttack" | "autoStartFight" | null
  >(null);

  const ownsAutoAttack =
    ownedUpgrades?.some(
      (upgrade) => upgrade.upgradeId === "auto_attack" && upgrade.quantity > 0
    ) ?? false;
  const ownsAutoStartFight =
    ownedUpgrades?.some(
      (upgrade) =>
        upgrade.upgradeId === "auto_start_fight" && upgrade.quantity > 0
    ) ?? false;

  if (!ownsAutoAttack && !ownsAutoStartFight) return null;

  const handleToggle = async (
    automation: "autoAttack" | "autoStartFight"
  ) => {
    setIsToggling(automation);
    try {
      if (automation === "autoAttack") {
        await setAutoAttack({
          playerId: player._id,
          enabled: !player.autoAttackEnabled,
        });
      } else {
        await setAutoStartFight({
          playerId: player._id,
          enabled: !player.autoStartFightEnabled,
        });
      }
    } catch (error) {
      console.error("Failed to update automation setting:", error);
    } finally {
      setIsToggling(null);
    }
  };

  return (
    <div className="w-full space-y-2 rounded border border-forest-light/20 bg-forest-dark/30 p-3">
      <p className="text-xs font-heading uppercase tracking-wider text-forest-glow/70">
        Automation
      </p>
      {ownsAutoAttack && (
        <button
          type="button"
          role="switch"
          aria-checked={player.autoAttackEnabled}
          onClick={() => void handleToggle("autoAttack")}
          disabled={isToggling === "autoAttack"}
          className="flex w-full items-center justify-between rounded border border-forest-light/20 px-3 py-2 text-left hover:border-gold/50 disabled:opacity-50"
        >
          <span>
            <span className="block text-sm text-foreground">Auto attack</span>
            <span className="block text-xs text-muted-foreground">
              Strike at your attack speed
            </span>
          </span>
          <span
            className={
              player.autoAttackEnabled
                ? "text-forest-glow"
                : "text-muted-foreground"
            }
          >
            {isToggling === "autoAttack"
              ? "..."
              : player.autoAttackEnabled
                ? "ON"
                : "OFF"}
          </span>
        </button>
      )}
      {ownsAutoStartFight && (
        <button
          type="button"
          role="switch"
          aria-checked={player.autoStartFightEnabled}
          onClick={() => void handleToggle("autoStartFight")}
          disabled={isToggling === "autoStartFight"}
          className="flex w-full items-center justify-between rounded border border-forest-light/20 px-3 py-2 text-left hover:border-gold/50 disabled:opacity-50"
        >
          <span>
            <span className="block text-sm text-foreground">Auto battle</span>
            <span className="block text-xs text-muted-foreground">
              Start the selected tier after recovery
            </span>
          </span>
          <span
            className={
              player.autoStartFightEnabled
                ? "text-forest-glow"
                : "text-muted-foreground"
            }
          >
            {isToggling === "autoStartFight"
              ? "..."
              : player.autoStartFightEnabled
                ? "ON"
                : "OFF"}
          </span>
        </button>
      )}
    </div>
  );
}
