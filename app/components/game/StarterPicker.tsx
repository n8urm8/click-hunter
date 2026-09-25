import { cn } from "~/lib/utils";

export type StarterId = "sword" | "dagger" | "mace" | "bow" | "staff";

const STARTERS: Array<{
  id: StarterId;
  name: string;
  weapon: string;
  chest: string;
  blurb: string;
}> = [
  {
    id: "sword",
    name: "Sword",
    weapon: "Worn Sword · balanced blade",
    chest: "Worn Mail · sturdy",
    blurb: "Balanced melee. Strength grows with every fight.",
  },
  {
    id: "dagger",
    name: "Dagger",
    weapon: "Worn Dagger · fast strikes",
    chest: "Worn Vest · light",
    blurb: "Fast striker. Dexterity grows with every fight.",
  },
  {
    id: "mace",
    name: "Mace",
    weapon: "Worn Mace · heavy hits",
    chest: "Worn Mail · sturdy",
    blurb: "Slow bruiser. Strength and grit in every swing.",
  },
  {
    id: "bow",
    name: "Bow",
    weapon: "Worn Bow · ranger's reach",
    chest: "Worn Vest · light",
    blurb: "Ranger. Dexterity and tempo from afar.",
  },
  {
    id: "staff",
    name: "Staff",
    weapon: "Worn Staff · true magic damage",
    chest: "Worn Robe · steeped in spells",
    blurb: "Caster. Intelligence grows — magic from fight one.",
  },
];

interface StarterPickerProps {
  value: StarterId;
  onChange: (starterId: StarterId) => void;
  disabled?: boolean;
}

export function StarterPicker({ value, onChange, disabled }: StarterPickerProps) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">
        Choose your first weapon. It shapes which stats your battles train.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Starting weapon">
        {STARTERS.map((starter) => {
          const selected = starter.id === value;
          return (
            <button
              key={starter.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(starter.id)}
              className={cn(
                "border p-3 text-left transition-colors",
                selected
                  ? "border-gold/60 bg-gold/10"
                  : "border-forest-light/25 bg-forest-dark/40 hover:border-forest-light/50"
              )}
            >
              <p className="text-sm font-semibold text-foreground">{starter.name}</p>
              <p className="mt-1 text-xs text-gold-light">{starter.weapon}</p>
              <p className="text-xs text-muted-foreground">{starter.chest}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{starter.blurb}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
