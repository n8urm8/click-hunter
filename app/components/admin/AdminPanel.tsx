import {
  useEffect,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  useAdminConfig,
  useSaveEvent,
  useUpdateAchievement,
  useUpdateGameBalance,
  useUpdateHiddenSpot,
  useUpdateMonster,
  useUpdateRebirthReward,
  useUpdateUpgrade,
} from "~/hooks/useAdmin";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

const inputClass =
  "w-full border border-forest-light/30 bg-forest-dark/70 px-2 py-1.5 text-sm text-foreground outline-none focus:border-gold/70";
const textareaClass = `${inputClass} min-h-12 resize-y`;

interface AdminPanelProps {
  playerId: Id<"players">;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Save failed";
}

function requiredNumber(value: string, field: string, minimum = 0) {
  if (!value.trim()) {
    throw new Error(`${field} is required`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${field} must be a finite number >= ${minimum}`);
  }
  return parsed;
}

function optionalNumber(value: string, field: string, minimum = 0) {
  if (!value.trim()) return null;
  return requiredNumber(value, field, minimum);
}

function boundedNumber(
  value: string,
  field: string,
  minimum: number,
  maximum: number
) {
  const parsed = requiredNumber(value, field, minimum);
  if (parsed > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label role="cell" className={`block min-w-0 space-y-1 ${className}`}>
      <span className="sr-only">{label}</span>
      {children}
    </label>
  );
}

function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

function EditorShell({
  title,
  identifier,
  columns,
  onSubmit,
  isSaving,
  error,
  children,
}: {
  title: string;
  identifier: string;
  columns: string[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSaving: boolean;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={onSubmit}
      role="row"
      style={{
        gridTemplateColumns: `12rem repeat(${columns.length}, minmax(9rem, 1fr)) 5.5rem`,
      }}
      className="grid min-w-[58rem] items-start gap-3 border-b border-forest-light/20 px-4 py-2 transition-colors last:border-b-0 hover:bg-forest-mid/20"
    >
      <div
        role="cell"
        className="sticky left-0 z-10 min-w-0 bg-forest-deep/95"
      >
        <h4 className="font-semibold text-gold">{title}</h4>
        <p className="break-words font-mono text-[0.65rem] text-muted-foreground">
          {identifier}
        </p>
      </div>
      {children}
      <div
        role="cell"
        className="sticky right-0 z-10 flex min-w-20 flex-col items-end gap-2 bg-forest-deep/95"
      >
        <Button type="submit" size="xs" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
        {error && (
          <p className="max-w-20 text-right text-xs text-blood-light">{error}</p>
        )}
      </div>
    </form>
  );
}

function AdminSection({
  title,
  description,
  columns,
  children,
}: {
  title: string;
  description: string;
  columns: string[];
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-heading text-lg text-gold glow-gold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div
        role="table"
        aria-label={title}
        className="forest-card overflow-x-auto"
      >
        <div className="min-w-[58rem]">
          <div
            role="row"
            style={{
              gridTemplateColumns: `12rem repeat(${columns.length}, minmax(9rem, 1fr)) 5.5rem`,
            }}
            className="grid min-w-[58rem] gap-3 border-b border-forest-light/30 bg-forest-dark/80 px-4 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
          >
            <span
              role="columnheader"
              className="sticky left-0 z-10 bg-forest-dark/95"
            >
              Entry
            </span>
            {columns.map((column) => (
              <span key={column} role="columnheader">
                {column}
              </span>
            ))}
            <span
              role="columnheader"
              className="sticky right-0 z-10 bg-forest-dark/95"
            >
              Action
            </span>
          </div>
          <div role="rowgroup">{children}</div>
        </div>
      </div>
    </section>
  );
}

function BalanceEditor({
  playerId,
  row,
}: {
  playerId: Id<"players">;
  row: Doc<"gameBalance">;
}) {
  const update = useUpdateGameBalance();
  const [value, setValue] = useState(() => JSON.stringify(row.value, null, 2) ?? "null");
  const [description, setDescription] = useState(row.description);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setValue(JSON.stringify(row.value, null, 2) ?? "null");
    setDescription(row.description);
  }, [row]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      setError("Value must be valid JSON.");
      return;
    }

    setIsSaving(true);
    try {
      await update({
        playerId,
        balanceId: row._id,
        value: parsedValue,
        description,
      });
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell
      title={row.key}
      identifier={`Updated ${new Date(row.lastUpdated).toLocaleString()}`}
      columns={["Value (JSON)", "Description"]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Value (JSON)">
        <textarea
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          className={textareaClass}
          rows={2}
          spellCheck={false}
        />
      </Field>
      <Field label="Description">
        <TextInput
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </Field>
    </EditorShell>
  );
}

interface UpgradeForm {
  name: string;
  category: string;
  cost: string;
  description: string;
  effectType: string;
  effectStat: string;
  effectAmount: string;
  minTier: string;
  minLevel: string;
}

function upgradeForm(row: Doc<"upgrades">): UpgradeForm {
  return {
    name: row.name,
    category: row.category,
    cost: String(row.cost),
    description: row.description,
    effectType: row.effectType,
    effectStat: row.effectStat ?? "",
    effectAmount: row.effectAmount === undefined ? "" : String(row.effectAmount),
    minTier: row.minTier === undefined ? "" : String(row.minTier),
    minLevel: row.minLevel === undefined ? "" : String(row.minLevel),
  };
}

function UpgradeEditor({
  playerId,
  row,
}: {
  playerId: Id<"players">;
  row: Doc<"upgrades">;
}) {
  const update = useUpdateUpgrade();
  const [form, setForm] = useState(() => upgradeForm(row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(upgradeForm(row)), [row]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      setIsSaving(true);
      await update({
        playerId,
        upgradeId: row._id,
        name: form.name,
        category: form.category,
        cost: requiredNumber(form.cost, "Cost"),
        description: form.description,
        effectType: form.effectType,
        effectStat: form.effectStat.trim() || null,
        effectAmount: optionalNumber(form.effectAmount, "Effect amount"),
        minTier: optionalNumber(form.minTier, "Minimum tier", 1),
        minLevel: optionalNumber(form.minLevel, "Minimum level", 1),
      });
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell
      title={row.name}
      identifier={`ID: ${row.upgradeId}`}
      columns={[
        "Name",
        "Category",
        "Cost",
        "Effect type",
        "Effect stat",
        "Effect amount",
        "Minimum tier",
        "Minimum level",
        "Description",
      ]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Name">
        <TextInput
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
        />
      </Field>
      <Field label="Category">
        <TextInput
          value={form.category}
          onChange={(event) =>
            setForm({ ...form, category: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Cost">
        <TextInput
          type="number"
          min="0"
          value={form.cost}
          onChange={(event) => setForm({ ...form, cost: event.currentTarget.value })}
        />
      </Field>
      <Field label="Effect type">
        <TextInput
          value={form.effectType}
          onChange={(event) =>
            setForm({ ...form, effectType: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Effect stat">
        <TextInput
          placeholder="str, dex, int, luk, con"
          value={form.effectStat}
          onChange={(event) =>
            setForm({ ...form, effectStat: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Effect amount">
        <TextInput
          type="number"
          min="0"
          value={form.effectAmount}
          onChange={(event) =>
            setForm({ ...form, effectAmount: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Minimum tier">
        <TextInput
          type="number"
          min="1"
          value={form.minTier}
          onChange={(event) => setForm({ ...form, minTier: event.currentTarget.value })}
        />
      </Field>
      <Field label="Minimum level">
        <TextInput
          type="number"
          min="1"
          value={form.minLevel}
          onChange={(event) =>
            setForm({ ...form, minLevel: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Description">
        <textarea
          value={form.description}
          onChange={(event) =>
            setForm({ ...form, description: event.currentTarget.value })
          }
          className={textareaClass}
          rows={2}
        />
      </Field>
    </EditorShell>
  );
}

interface MonsterForm {
  name: string;
  str: string;
  dex: string;
  int: string;
  luk: string;
  con: string;
  goldDrop: string;
  experienceReward: string;
  baseMsPerAttack: string;
  strength: string;
}

function monsterForm(row: Doc<"monsters">): MonsterForm {
  return {
    name: row.name,
    str: String(row.str),
    dex: String(row.dex),
    int: String(row.int),
    luk: String(row.luk),
    con: String(row.con),
    goldDrop: String(row.goldDrop),
    experienceReward: String(row.experienceReward),
    baseMsPerAttack: String(row.baseMsPerAttack),
    strength: String(row.strength),
  };
}

function MonsterEditor({
  playerId,
  row,
}: {
  playerId: Id<"players">;
  row: Doc<"monsters">;
}) {
  const update = useUpdateMonster();
  const [form, setForm] = useState(() => monsterForm(row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(monsterForm(row)), [row]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      setIsSaving(true);
      await update({
        playerId,
        monsterId: row._id,
        name: form.name,
        str: requiredNumber(form.str, "STR"),
        dex: requiredNumber(form.dex, "DEX"),
        int: requiredNumber(form.int, "INT"),
        luk: requiredNumber(form.luk, "LUK"),
        con: requiredNumber(form.con, "CON"),
        goldDrop: requiredNumber(form.goldDrop, "Gold drop"),
        experienceReward: requiredNumber(
          form.experienceReward,
          "Experience reward"
        ),
        baseMsPerAttack: requiredNumber(
          form.baseMsPerAttack,
          "Base milliseconds per attack",
          1
        ),
        strength: requiredNumber(form.strength, "Difficulty weight"),
      });
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const statFields: Array<keyof Pick<MonsterForm, "str" | "dex" | "int" | "luk" | "con">> = [
    "str",
    "dex",
    "int",
    "luk",
    "con",
  ];

  return (
    <EditorShell
      title={row.name}
      identifier={`Type: ${row.type}`}
      columns={[
        "Name",
        "STR",
        "DEX",
        "INT",
        "LUK",
        "CON",
        "Gold drop",
        "Experience reward",
        "Base ms per attack",
        "Difficulty weight",
      ]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Name">
        <TextInput
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
        />
      </Field>
      {statFields.map((field) => (
        <Field key={field} label={field.toUpperCase()}>
          <TextInput
            type="number"
            min="0"
            value={form[field]}
            onChange={(event) =>
              setForm({ ...form, [field]: event.currentTarget.value })
            }
          />
        </Field>
      ))}
      <Field label="Gold drop">
        <TextInput
          type="number"
          min="0"
          value={form.goldDrop}
          onChange={(event) =>
            setForm({ ...form, goldDrop: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Experience reward">
        <TextInput
          type="number"
          min="0"
          value={form.experienceReward}
          onChange={(event) =>
            setForm({ ...form, experienceReward: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Base ms per attack">
        <TextInput
          type="number"
          min="1"
          value={form.baseMsPerAttack}
          onChange={(event) =>
            setForm({ ...form, baseMsPerAttack: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Difficulty weight">
        <TextInput
          type="number"
          min="0"
          value={form.strength}
          onChange={(event) =>
            setForm({ ...form, strength: event.currentTarget.value })
          }
        />
      </Field>
    </EditorShell>
  );
}

interface HiddenSpotForm {
  x: string;
  y: string;
  rewardUpgradeId: string;
  radius: string;
}

function hiddenSpotForm(row: Doc<"hiddenSpots">): HiddenSpotForm {
  return {
    x: String(row.x),
    y: String(row.y),
    rewardUpgradeId: row.rewardUpgradeId,
    radius: String(row.radius),
  };
}

function HiddenSpotEditor({
  playerId,
  row,
}: {
  playerId: Id<"players">;
  row: Doc<"hiddenSpots">;
}) {
  const update = useUpdateHiddenSpot();
  const [form, setForm] = useState(() => hiddenSpotForm(row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(hiddenSpotForm(row)), [row]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      setIsSaving(true);
      await update({
        playerId,
        spotId: row._id,
        x: boundedNumber(form.x, "X position", 0, 100),
        y: boundedNumber(form.y, "Y position", 0, 100),
        rewardUpgradeId: form.rewardUpgradeId,
        radius: requiredNumber(form.radius, "Radius", 1),
      });
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell
      title={row.spotId}
      identifier="Hidden reward location"
      columns={["X (%)", "Y (%)", "Reward upgrade ID", "Radius (px)"]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="X (%)">
        <TextInput
          type="number"
          min="0"
          max="100"
          value={form.x}
          onChange={(event) => setForm({ ...form, x: event.currentTarget.value })}
        />
      </Field>
      <Field label="Y (%)">
        <TextInput
          type="number"
          min="0"
          max="100"
          value={form.y}
          onChange={(event) => setForm({ ...form, y: event.currentTarget.value })}
        />
      </Field>
      <Field label="Reward upgrade ID">
        <TextInput
          value={form.rewardUpgradeId}
          onChange={(event) =>
            setForm({ ...form, rewardUpgradeId: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Radius (px)">
        <TextInput
          type="number"
          min="1"
          value={form.radius}
          onChange={(event) =>
            setForm({ ...form, radius: event.currentTarget.value })
          }
        />
      </Field>
    </EditorShell>
  );
}

interface AchievementForm {
  name: string;
  description: string;
  icon: string;
  condition: string;
}

function achievementForm(row: Doc<"achievements">): AchievementForm {
  return {
    name: row.name,
    description: row.description,
    icon: row.icon ?? "",
    condition: row.condition,
  };
}

function AchievementEditor({
  playerId,
  row,
}: {
  playerId: Id<"players">;
  row: Doc<"achievements">;
}) {
  const update = useUpdateAchievement();
  const [form, setForm] = useState(() => achievementForm(row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(achievementForm(row)), [row]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      setIsSaving(true);
      await update({
        playerId,
        achievementId: row._id,
        name: form.name,
        description: form.description,
        icon: form.icon.trim() || null,
        condition: form.condition,
      });
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell
      title={row.name}
      identifier={`ID: ${row.achievementId}`}
      columns={["Name", "Icon", "Condition", "Description"]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Name">
        <TextInput
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
        />
      </Field>
      <Field label="Icon">
        <TextInput
          value={form.icon}
          onChange={(event) => setForm({ ...form, icon: event.currentTarget.value })}
        />
      </Field>
      <Field label="Condition">
        <TextInput
          value={form.condition}
          onChange={(event) =>
            setForm({ ...form, condition: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Description">
        <textarea
          value={form.description}
          onChange={(event) =>
            setForm({ ...form, description: event.currentTarget.value })
          }
          className={textareaClass}
          rows={2}
        />
      </Field>
    </EditorShell>
  );
}

interface RebirthRewardForm {
  name: string;
  description: string;
  effectType: string;
  effectValue: string;
  effectData: string;
}

function rebirthRewardForm(row: Doc<"rebirthRewards">): RebirthRewardForm {
  return {
    name: row.name,
    description: row.description,
    effectType: row.effectType,
    effectValue: row.effectValue === undefined ? "" : String(row.effectValue),
    effectData: JSON.stringify(row.effectData ?? null, null, 2),
  };
}

function RebirthRewardEditor({
  playerId,
  row,
}: {
  playerId: Id<"players">;
  row: Doc<"rebirthRewards">;
}) {
  const update = useUpdateRebirthReward();
  const [form, setForm] = useState(() => rebirthRewardForm(row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(rebirthRewardForm(row)), [row]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    let effectData: unknown;
    try {
      effectData = JSON.parse(form.effectData);
    } catch {
      setError("Effect data must be valid JSON.");
      return;
    }

    try {
      setIsSaving(true);
      await update({
        playerId,
        rewardId: row._id,
        name: form.name,
        description: form.description,
        effectType: form.effectType,
        effectValue: optionalNumber(form.effectValue, "Effect value"),
        effectData,
      });
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell
      title={row.name}
      identifier={`Rebirth level: ${row.rebirthLevel}`}
      columns={["Name", "Effect type", "Effect value", "Description", "Effect data (JSON)"]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Name">
        <TextInput
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
        />
      </Field>
      <Field label="Effect type">
        <TextInput
          value={form.effectType}
          onChange={(event) =>
            setForm({ ...form, effectType: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Effect value">
        <TextInput
          type="number"
          min="0"
          value={form.effectValue}
          onChange={(event) =>
            setForm({ ...form, effectValue: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Description">
        <textarea
          value={form.description}
          onChange={(event) =>
            setForm({ ...form, description: event.currentTarget.value })
          }
          className={textareaClass}
          rows={2}
        />
      </Field>
      <Field label="Effect data (JSON)">
        <textarea
          value={form.effectData}
          onChange={(event) =>
            setForm({ ...form, effectData: event.currentTarget.value })
          }
          className={textareaClass}
          rows={2}
          spellCheck={false}
        />
      </Field>
    </EditorShell>
  );
}

interface EventForm {
  eventId: string;
  name: string;
  description: string;
  startTime: string;
  endTime: string;
  effectType: string;
  effectValue: string;
}

function toDatetimeLocal(timestamp: number) {
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset();
  return new Date(timestamp - offset * 60_000).toISOString().slice(0, 16);
}

function eventForm(row?: Doc<"gameEvents">): EventForm {
  return {
    eventId: row?.eventId ?? "",
    name: row?.name ?? "",
    description: row?.description ?? "",
    startTime: row ? toDatetimeLocal(row.startTime) : "",
    endTime: row ? toDatetimeLocal(row.endTime) : "",
    effectType: row?.effectType ?? "gold-multiplier",
    effectValue: row ? String(row.effectValue) : "1.1",
  };
}

function EventEditor({
  playerId,
  row,
}: {
  playerId: Id<"players">;
  row?: Doc<"gameEvents">;
}) {
  const save = useSaveEvent();
  const [form, setForm] = useState(() => eventForm(row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (row) setForm(eventForm(row));
  }, [row]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const startTime = Date.parse(form.startTime);
    const endTime = Date.parse(form.endTime);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      setError("Start and end times are required.");
      return;
    }

    try {
      setIsSaving(true);
      await save({
        playerId,
        eventId: form.eventId,
        name: form.name,
        description: form.description,
        startTime,
        endTime,
        effectType: form.effectType,
        effectValue: requiredNumber(form.effectValue, "Effect value", 0.000001),
      });
      if (!row) setForm(eventForm());
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell
      title={row ? row.name : "Create event"}
      identifier={row ? row.eventId : "New event"}
      columns={[
        "Event ID",
        "Name",
        "Start",
        "End",
        "Effect type",
        "Effect value",
        "Description",
        "Status",
      ]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Event ID">
        <TextInput
          value={form.eventId}
          disabled={Boolean(row)}
          onChange={(event) =>
            setForm({ ...form, eventId: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Name">
        <TextInput
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
        />
      </Field>
      <Field label="Start">
        <TextInput
          type="datetime-local"
          value={form.startTime}
          onChange={(event) =>
            setForm({ ...form, startTime: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="End">
        <TextInput
          type="datetime-local"
          value={form.endTime}
          onChange={(event) =>
            setForm({ ...form, endTime: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Effect type">
        <TextInput
          value={form.effectType}
          onChange={(event) =>
            setForm({ ...form, effectType: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Effect value">
        <TextInput
          type="number"
          min="0.000001"
          step="any"
          value={form.effectValue}
          onChange={(event) =>
            setForm({ ...form, effectValue: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Description">
        <textarea
          value={form.description}
          onChange={(event) =>
            setForm({ ...form, description: event.currentTarget.value })
          }
          className={textareaClass}
          rows={2}
        />
      </Field>
      <div role="cell" className="pt-1">
        {row && (
          <Badge
            variant="secondary"
            className={row.isActive ? "text-forest-glow" : "text-muted-foreground"}
          >
            {row.isActive ? "Active now" : "Inactive"}
          </Badge>
        )}
      </div>
    </EditorShell>
  );
}

export function AdminPanel({ playerId }: AdminPanelProps) {
  const config = useAdminConfig(playerId);

  if (config === undefined) {
    return (
      <Card className="forest-card p-4">
        <p className="text-sm text-muted-foreground">Loading admin configuration...</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="forest-card border border-gold/20 p-4">
        <h2 className="font-heading text-xl text-gold glow-gold">Admin controls</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Changes apply immediately to the live game, including stat-upgrade
          pricing and level requirements. Stable IDs and references are
          read-only so existing player progress remains valid.
        </p>
      </div>

      <AdminSection
        title="Global balance"
        description="Edit numeric modifiers, progression thresholds, and starting values as JSON."
        columns={["Value (JSON)", "Description"]}
      >
        {config.gameBalance.map((row) => (
          <BalanceEditor key={row._id} playerId={playerId} row={row} />
        ))}
      </AdminSection>

      <AdminSection
        title="Upgrades"
        description="Adjust shop prices, effects, descriptions, and unlock requirements."
        columns={[
          "Name",
          "Category",
          "Cost",
          "Effect type",
          "Effect stat",
          "Effect amount",
          "Minimum tier",
          "Minimum level",
          "Description",
        ]}
      >
        {config.upgrades.map((row) => (
          <UpgradeEditor key={row._id} playerId={playerId} row={row} />
        ))}
      </AdminSection>

      <AdminSection
        title="Monsters"
        description="Tune base stats, rewards, attack timing, and encounter weighting."
        columns={[
          "Name",
          "STR",
          "DEX",
          "INT",
          "LUK",
          "CON",
          "Gold drop",
          "Experience reward",
          "Base ms per attack",
          "Difficulty weight",
        ]}
      >
        {config.monsters.map((row) => (
          <MonsterEditor key={row._id} playerId={playerId} row={row} />
        ))}
      </AdminSection>

      <AdminSection
        title="Hidden spots"
        description="Move discoverable rewards and change their linked upgrade or click radius."
        columns={["X (%)", "Y (%)", "Reward upgrade ID", "Radius (px)"]}
      >
        {config.hiddenSpots.map((row) => (
          <HiddenSpotEditor key={row._id} playerId={playerId} row={row} />
        ))}
      </AdminSection>

      <AdminSection
        title="Achievements"
        description="Edit achievement copy, icons, and condition identifiers."
        columns={["Name", "Icon", "Condition", "Description"]}
      >
        {config.achievements.map((row) => (
          <AchievementEditor key={row._id} playerId={playerId} row={row} />
        ))}
      </AdminSection>

      <AdminSection
        title="Rebirth rewards"
        description="Adjust reward descriptions, effect values, and effect payloads."
        columns={[
          "Name",
          "Effect type",
          "Effect value",
          "Description",
          "Effect data (JSON)",
        ]}
      >
        {config.rebirthRewards.map((row) => (
          <RebirthRewardEditor key={row._id} playerId={playerId} row={row} />
        ))}
      </AdminSection>

      <AdminSection
        title="Live events"
        description="Create or update timed gold and experience modifiers."
        columns={[
          "Event ID",
          "Name",
          "Start",
          "End",
          "Effect type",
          "Effect value",
          "Description",
          "Status",
        ]}
      >
        <EventEditor playerId={playerId} />
        {config.gameEvents.map((row) => (
          <EventEditor key={row._id} playerId={playerId} row={row} />
        ))}
      </AdminSection>
    </div>
  );
}
