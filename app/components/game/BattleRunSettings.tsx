import { ChevronDown } from "lucide-react";

export type AutoBattleMode = "count" | "duration" | "until-stopped";

export interface AutoBattleSettings {
  mode: AutoBattleMode;
  target: string;
}

interface BattleRunSettingsProps {
  settings: AutoBattleSettings;
  onModeChange: (mode: AutoBattleMode) => void;
  onTargetChange: (target: string) => void;
  isQueueing?: boolean;
  error?: string | null;
}

export function BattleRunSettings({
  settings,
  onModeChange,
  onTargetChange,
  isQueueing = false,
  error = null,
}: BattleRunSettingsProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span>Stop after</span>
          <span className="relative inline-flex">
            <select
              value={settings.mode}
              onChange={(event) => onModeChange(event.currentTarget.value as AutoBattleMode)}
              className="combat-input combat-input--select"
              disabled={isQueueing}
            >
              <option value="until-stopped">Until stopped</option>
              <option value="count">Battle count</option>
              <option value="duration">Online duration</option>
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-foreground"
            />
          </span>
        </label>

        {settings.mode !== "until-stopped" && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>
              {settings.mode === "count" ? "Number of battles" : "Minutes online"}
            </span>
            <input
              type="number"
              min="1"
              step="1"
              value={settings.target}
              onChange={(event) => onTargetChange(event.currentTarget.value)}
              className="combat-input w-32"
              disabled={isQueueing}
            />
          </label>
        )}
      </div>
      {settings.mode !== "until-stopped" && (
        <p className="text-xs text-muted-foreground">
          {settings.mode === "count"
            ? "Defeats also count."
            : "Only online time counts."}
        </p>
      )}

      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
