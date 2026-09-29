import { useState } from "react";
import {
  usePlayerUpgrades,
  useSetAutoAttack,
} from "~/hooks/usePlayer";
import { COMBAT_ZONE_LABELS, type CombatZone } from "~/lib/combatZones";

export type AutoBattleMode = "count" | "duration" | "until-stopped";

export interface AutoBattleSettings {
  enabled: boolean;
  mode: AutoBattleMode;
  target: string;
}

interface AutomationControlsProps {
  player: any;
  tier?: number;
  zone?: CombatZone;
  settings?: AutoBattleSettings;
  onEnabledChange?: (enabled: boolean) => void;
  onModeChange?: (mode: AutoBattleMode) => void;
  onTargetChange?: (target: string) => void;
  isQueueing?: boolean;
  error?: string | null;
}

export function AutomationControls({
  player,
  tier,
  zone,
  settings,
  onEnabledChange,
  onModeChange,
  onTargetChange,
  isQueueing = false,
  error = null,
}: AutomationControlsProps) {
  const ownedUpgrades = usePlayerUpgrades(player._id);
  const setAutoAttack = useSetAutoAttack();
  const [isToggling, setIsToggling] = useState(false);

  const ownsAutoAttack =
    ownedUpgrades.data?.some(
      (upgrade) => upgrade.upgradeId === "auto_attack" && upgrade.quantity > 0
    ) ?? false;
  const ownsAutoBattle =
    ownedUpgrades.data?.some(
      (upgrade) =>
        upgrade.upgradeId === "auto_start_fight" && upgrade.quantity > 0
    ) ?? false;
  const autoBattleConfig =
    tier !== undefined &&
    settings &&
    onEnabledChange &&
    onModeChange &&
    onTargetChange
      ? {
          tier,
          zone,
          settings,
          onEnabledChange,
          onModeChange,
          onTargetChange,
        }
      : null;

  if (!ownsAutoAttack && !(ownsAutoBattle && autoBattleConfig)) return null;

  const handleToggle = async () => {
    setIsToggling(true);
    try {
      await setAutoAttack({
        playerId: player._id,
        enabled: !player.autoAttackEnabled,
      });
    } catch (error) {
      console.error("Failed to update automation setting:", error);
    } finally {
      setIsToggling(false);
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
          onClick={() => void handleToggle()}
          disabled={isToggling}
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
            {isToggling ? "..." : player.autoAttackEnabled ? "ON" : "OFF"}
          </span>
        </button>
      )}
      {ownsAutoBattle && autoBattleConfig && (
        <div className="space-y-3 rounded border border-gold/20 bg-gold/5 px-3 py-3">
          <button
            type="button"
            role="switch"
            aria-checked={autoBattleConfig.settings.enabled}
            onClick={() =>
              autoBattleConfig.onEnabledChange(
                !autoBattleConfig.settings.enabled
              )
            }
            disabled={isQueueing}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="block text-sm text-foreground">
                Battle automation
              </span>
              <span className="block text-xs text-muted-foreground">
                Queue regular Tier {autoBattleConfig.tier}
                {autoBattleConfig.zone
                  ? ` · ${COMBAT_ZONE_LABELS[autoBattleConfig.zone]}`
                  : ""}{" "}
                battles when you enter the wilds. Owned upgrades remain usable
                at any level.
              </span>
            </span>
            <span
              className={
                autoBattleConfig.settings.enabled
                  ? "text-forest-glow"
                  : "text-muted-foreground"
              }
            >
              {autoBattleConfig.settings.enabled ? "ON" : "OFF"}
            </span>
          </button>

          {autoBattleConfig.settings.enabled && (
            <div className="grid gap-3 border-t border-gold/15 pt-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                <span className="block">Run mode</span>
                <select
                  value={autoBattleConfig.settings.mode}
                  onChange={(event) =>
                    autoBattleConfig.onModeChange(
                      event.currentTarget.value as AutoBattleMode
                    )
                  }
                  className="w-full border border-forest-light/30 bg-forest-dark/70 px-2 py-2 text-sm text-foreground"
                  disabled={isQueueing}
                >
                  <option value="until-stopped">Until stopped</option>
                  <option value="count">Battle count</option>
                  <option value="duration">Online duration</option>
                </select>
              </label>

              {autoBattleConfig.settings.mode !== "until-stopped" && (
                <label className="space-y-1 text-xs text-muted-foreground">
                  <span className="block">
                    {autoBattleConfig.settings.mode === "count"
                      ? "Number of battles"
                      : "Minutes online"}
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={autoBattleConfig.settings.target}
                    onChange={(event) =>
                      autoBattleConfig.onTargetChange(event.currentTarget.value)
                    }
                    className="w-full border border-forest-light/30 bg-forest-dark/70 px-2 py-2 text-sm text-foreground"
                    disabled={isQueueing}
                  />
                </label>
              )}

              <p className="text-xs text-muted-foreground sm:col-span-2">
                {autoBattleConfig.settings.mode === "until-stopped"
                  ? "The queue keeps battling until you stop it."
                  : autoBattleConfig.settings.mode === "count"
                    ? "Defeats count toward the target and the runner continues."
                    : "Only online time counts toward this target; offline progress is never added to battles."}
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-blood-light" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
