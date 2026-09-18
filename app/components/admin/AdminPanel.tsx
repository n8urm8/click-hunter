import {
  useEffect,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import {
  useCreateAugmentationDefinition,
  useCreateGatheringActivity,
  useCreateTaskDefinition,
  useCreateItem,
  useCreateItemRarity,
  useCreateLootSource,
  useCreateLootTable,
  useCreateLootTableEntry,
  useCreateRecipe,
  useCreateSkillDefinition,
  useCreateSkillTierDefinition,
  useAdminConfig,
  useAdminPlayers,
  useSaveEvent,
  useUpdateAchievement,
  useUpdateAugmentationDefinition,
  useUpdateBoss,
  useUpdateGameBalance,
  useUpdateGatheringActivity,
  useUpdateHiddenSpot,
  useUpdateItem,
  useUpdateItemRarity,
  useUpdateLootSource,
  useUpdateLootTable,
  useUpdateLootTableEntry,
  useUpdateMonster,
  useUpdatePlayer,
  useUpdateRecipe,
  useResetForestCrafting,
  useUpdateRebirthReward,
  useUpdateSkillDefinition,
  useUpdateSkillTierDefinition,
  useUpdateTaskDefinition,
  useUpdateUpgrade,
} from "~/hooks/useAdmin";
import {
  calculateDerivedStats,
  calculatePlayerLevel,
} from "~/lib/statCalculations";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  DEFAULT_ITEM_RARITY_LEVEL,
  EQUIPMENT_SLOT_VALUES,
  ITEM_EFFECT_STAT_VALUES,
  ITEM_CATEGORY_VALUES,
  type EquipmentSlot,
  type ItemEffectStat,
  type ItemCategory,
} from "../../../convex/itemTypes";

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

function requiredInteger(value: string, field: string, minimum = 0) {
  const parsed = requiredNumber(value, field, minimum);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${field} must be an integer`);
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

function CharacterField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 space-y-1 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
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
        className="forest-card overflow-hidden"
      >
        <div className="overflow-x-auto">
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
      </div>
    </section>
  );
}

type AdminTab = "players" | "monsters" | "items" | "skills" | "general";

const ADMIN_TAB_PARAM = "adminTab";
const DEFAULT_ADMIN_TAB: AdminTab = "players";
const ADMIN_TABS: Array<{ value: AdminTab; label: string }> = [
  { value: "players", label: "Players" },
  { value: "monsters", label: "Monsters" },
  { value: "items", label: "Items" },
  { value: "skills", label: "Skills" },
  { value: "general", label: "General" },
];

function isAdminTab(value: string | null): value is AdminTab {
  return ADMIN_TABS.some((tab) => tab.value === value);
}

type AdminPlayer = {
  _id: Id<"players">;
  name: string;
  anonymousId: string;
  str: number;
  dex: number;
  int: number;
  luk: number;
  con: number;
  gold: number;
  totalExperience: number;
  currentTier: number;
  maxTierReached: number;
  rebirthCount: number;
  rebirthTierThreshold: number;
  lastUpdated: number;
};

type CharacterForm = {
  name: string;
  str: string;
  dex: string;
  int: string;
  luk: string;
  con: string;
  gold: string;
  totalExperience: string;
  currentTier: string;
  maxTierReached: string;
  rebirthCount: string;
  rebirthTierThreshold: string;
};

const characterStatFields = ["str", "dex", "int", "luk", "con"] as const;

function characterForm(player?: AdminPlayer | null): CharacterForm {
  return {
    name: player?.name ?? "",
    str: String(player?.str ?? 1),
    dex: String(player?.dex ?? 1),
    int: String(player?.int ?? 1),
    luk: String(player?.luk ?? 1),
    con: String(player?.con ?? 1),
    gold: String(player?.gold ?? 0),
    totalExperience: String(player?.totalExperience ?? 0),
    currentTier: String(player?.currentTier ?? 1),
    maxTierReached: String(
      player?.maxTierReached ?? player?.currentTier ?? 1
    ),
    rebirthCount: String(player?.rebirthCount ?? 0),
    rebirthTierThreshold: String(player?.rebirthTierThreshold ?? 1),
  };
}

function playerOptionLabel(player: AdminPlayer) {
  const name = player.name.trim() || "Unnamed character";
  return `${name} - ${player.anonymousId.slice(-8)}`;
}

function CharacterEditorCard({ playerId }: { playerId: Id<"players"> }) {
  const playersQuery = useAdminPlayers(playerId);
  const updatePlayer = useUpdatePlayer();
  const players = playersQuery.data ?? [];
  const [selectedPlayerId, setSelectedPlayerId] =
    useState<Id<"players"> | null>(playerId);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<CharacterForm>(() => characterForm());
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [expectedLastUpdated, setExpectedLastUpdated] = useState<number | null>(
    null
  );
  const [isDirty, setIsDirty] = useState(false);

  const selectedPlayer =
    players.find((player) => player._id === selectedPlayerId) ?? null;

  useEffect(() => {
    if (players.length === 0) {
      if (selectedPlayerId !== null) {
        setSelectedPlayerId(null);
      }
      return;
    }

    if (
      selectedPlayerId !== null &&
      players.some((player) => player._id === selectedPlayerId)
    ) {
      return;
    }

    const currentPlayer = players.find((player) => player._id === playerId);
    setSelectedPlayerId(currentPlayer?._id ?? players[0]._id);
  }, [playerId, players, selectedPlayerId]);

  useEffect(() => {
    setForm(characterForm(selectedPlayer));
    setExpectedLastUpdated(selectedPlayer?.lastUpdated ?? null);
    setIsDirty(false);
    setError(null);
  }, [selectedPlayer?._id]);

  useEffect(() => {
    if (!selectedPlayer || isDirty) return;
    setForm(characterForm(selectedPlayer));
    setExpectedLastUpdated(selectedPlayer.lastUpdated);
  }, [selectedPlayer?.lastUpdated]);

  const updateFormField = <K extends keyof CharacterForm>(
    field: K,
    value: string
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
    setIsDirty(true);
  };

  const handleReload = () => {
    if (!selectedPlayer) return;
    setForm(characterForm(selectedPlayer));
    setExpectedLastUpdated(selectedPlayer.lastUpdated);
    setIsDirty(false);
    setError(null);
  };

  const hasRemoteUpdate =
    isDirty &&
    selectedPlayer !== null &&
    expectedLastUpdated !== null &&
    selectedPlayer.lastUpdated !== expectedLastUpdated;

  const normalizedSearch = search.trim().toLowerCase();
  const matchingPlayers = players.filter(
    (player) =>
      normalizedSearch.length === 0 ||
      player.name.toLowerCase().includes(normalizedSearch) ||
      player.anonymousId.toLowerCase().includes(normalizedSearch) ||
      player._id.toLowerCase().includes(normalizedSearch)
  );
  const selectablePlayers =
    selectedPlayer &&
    !matchingPlayers.some((player) => player._id === selectedPlayer._id)
      ? [selectedPlayer, ...matchingPlayers]
      : matchingPlayers;

  const statValues = {
    str: Number(form.str),
    dex: Number(form.dex),
    int: Number(form.int),
    luk: Number(form.luk),
    con: Number(form.con),
  };
  const hasValidStats = Object.values(statValues).every(Number.isFinite);
  const derivedStats = hasValidStats
    ? calculateDerivedStats(
        statValues.str,
        statValues.dex,
        statValues.int,
        statValues.luk,
        statValues.con
      )
    : null;
  const derivedLevel = hasValidStats
    ? calculatePlayerLevel(
        statValues.str,
        statValues.dex,
        statValues.int,
        statValues.luk,
        statValues.con
      )
    : null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!selectedPlayer) {
      setError("Select a player before saving.");
      return;
    }
    if (expectedLastUpdated === null) {
      setError("Character data is still loading. Try again.");
      return;
    }

    try {
      setIsSaving(true);
      const result = await updatePlayer({
        adminPlayerId: playerId,
        targetPlayerId: selectedPlayer._id,
        expectedLastUpdated,
        name: form.name,
        str: requiredInteger(form.str, "STR", 1),
        dex: requiredInteger(form.dex, "DEX", 1),
        int: requiredInteger(form.int, "INT", 1),
        luk: requiredInteger(form.luk, "LUK", 1),
        con: requiredInteger(form.con, "CON", 1),
        gold: requiredInteger(form.gold, "Gold"),
        totalExperience: requiredInteger(
          form.totalExperience,
          "Total experience"
        ),
        currentTier: requiredInteger(form.currentTier, "Current tier", 1),
        maxTierReached: requiredInteger(
          form.maxTierReached,
          "Best tier",
          1
        ),
        rebirthCount: requiredInteger(form.rebirthCount, "Rebirth count"),
        rebirthTierThreshold: requiredInteger(
          form.rebirthTierThreshold,
          "Rebirth tier threshold",
          1
        ),
      });
      setForm((current) => ({ ...current, name: current.name.trim() }));
      setExpectedLastUpdated(result.lastUpdated);
      setIsDirty(false);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="forest-card box-glow-gold">
      <CardHeader>
        <CardTitle className="text-gold glow-gold">Character data</CardTitle>
        <CardDescription>
          Select any player to adjust resources, base stats, and progression.
          Level and combat values update from the base stats and are read-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {playersQuery.isPending ? (
          <p className="text-sm text-muted-foreground">
            Loading player characters...
          </p>
        ) : playersQuery.isError ? (
          <p className="text-sm text-blood-light" role="alert">
            Unable to load player characters.
          </p>
        ) : players.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No player characters are available.
          </p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <CharacterField label="Find player">
                <TextInput
                  value={search}
                  placeholder="Name or account ID"
                  disabled={isSaving}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                />
              </CharacterField>
              <CharacterField label="Player">
                <select
                  value={selectedPlayerId ?? ""}
                  onChange={(event) => {
                    setSelectedPlayerId(
                      event.currentTarget.value as Id<"players">
                    );
                    setError(null);
                  }}
                  disabled={isSaving}
                  className={inputClass}
                >
                  {selectablePlayers.map((player) => (
                    <option key={player._id} value={player._id}>
                      {playerOptionLabel(player)}
                    </option>
                  ))}
                </select>
              </CharacterField>
            </div>

            {selectedPlayer ? (
              <form onSubmit={handleSubmit}>
                <fieldset disabled={isSaving} className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <CharacterField label="Name" className="sm:col-span-2">
                    <TextInput
                      value={form.name}
                      onChange={(event) =>
                        updateFormField("name", event.currentTarget.value)
                      }
                    />
                  </CharacterField>
                  <CharacterField label="Gold">
                    <TextInput
                      type="number"
                      min="0"
                      step="1"
                      value={form.gold}
                      onChange={(event) =>
                        updateFormField("gold", event.currentTarget.value)
                      }
                    />
                  </CharacterField>
                  <CharacterField label="Total XP">
                    <TextInput
                      type="number"
                      min="0"
                      step="1"
                      value={form.totalExperience}
                      onChange={(event) =>
                        updateFormField(
                          "totalExperience",
                          event.currentTarget.value
                        )
                      }
                    />
                  </CharacterField>
                </div>

                <div className="space-y-3">
                  <div>
                    <h4 className="font-heading text-base text-gold">
                      Base stats
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Set the five attributes used to derive level and combat
                      values.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {characterStatFields.map((field) => (
                      <CharacterField key={field} label={field.toUpperCase()}>
                        <TextInput
                          type="number"
                          min="1"
                          step="1"
                          value={form[field]}
                          onChange={(event) =>
                            updateFormField(field, event.currentTarget.value)
                          }
                        />
                      </CharacterField>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <h4 className="font-heading text-base text-gold">
                      Progression
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Best tier must be at least the current tier.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <CharacterField label="Current tier">
                      <TextInput
                        type="number"
                        min="1"
                        step="1"
                        value={form.currentTier}
                        onChange={(event) =>
                          updateFormField(
                            "currentTier",
                            event.currentTarget.value
                          )
                        }
                      />
                    </CharacterField>
                    <CharacterField label="Best tier">
                      <TextInput
                        type="number"
                        min="1"
                        step="1"
                        value={form.maxTierReached}
                        onChange={(event) =>
                          updateFormField(
                            "maxTierReached",
                            event.currentTarget.value
                          )
                        }
                      />
                    </CharacterField>
                    <CharacterField label="Rebirth count">
                      <TextInput
                        type="number"
                        min="0"
                        step="1"
                        value={form.rebirthCount}
                        onChange={(event) =>
                          updateFormField(
                            "rebirthCount",
                            event.currentTarget.value
                          )
                        }
                      />
                    </CharacterField>
                    <CharacterField label="Rebirth threshold">
                      <TextInput
                        type="number"
                        min="1"
                        step="1"
                        value={form.rebirthTierThreshold}
                        onChange={(event) =>
                          updateFormField(
                            "rebirthTierThreshold",
                            event.currentTarget.value
                          )
                        }
                      />
                    </CharacterField>
                  </div>
                </div>

                <div className="forest-panel grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Derived level
                    </p>
                    <p className="mt-1 font-heading text-xl text-gold">
                      {derivedLevel ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Health
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {derivedStats ? Math.floor(derivedStats.health) : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Attack
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {derivedStats ? Math.floor(derivedStats.attack) : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Defense
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {derivedStats ? Math.floor(derivedStats.defense) : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Attack speed
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {derivedStats
                        ? `${derivedStats.attackSpeed.toFixed(2)}/s`
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Crit chance
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {derivedStats
                        ? `${derivedStats.critChance.toFixed(1)}%`
                        : "-"}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {isDirty
                      ? "You have unsaved character changes."
                      : "Character changes apply immediately to the selected player."}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasRemoteUpdate && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={handleReload}
                      >
                        Reload latest
                      </Button>
                    )}
                    <Button
                      type="submit"
                      disabled={isSaving || hasRemoteUpdate}
                    >
                      {isSaving ? "Saving..." : "Save character"}
                    </Button>
                  </div>
                </div>
                {hasRemoteUpdate && (
                  <p className="text-xs text-gold-light" role="alert">
                    This character changed elsewhere while you were editing.
                    Reload the latest values before saving.
                  </p>
                )}
                {error && (
                  <p className="text-xs text-blood-light" role="alert">
                    {error}
                  </p>
                )}
                </fieldset>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a player to edit their character data.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
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


type SkillCategory = Doc<"skillDefinitions">["category"];
type LootSourceType = Doc<"lootTables">["sourceType"];
type LootPurpose = Doc<"lootTableEntries">["purpose"];
type RecipeItemInput = { itemId: string; quantity: number };

function sortedItems(items: Doc<"items">[]) {
  return [...items].sort((left, right) =>
    left.itemId.localeCompare(right.itemId)
  );
}

function itemStableId(items: Doc<"items">[], itemId?: Id<"items">) {
  if (itemId === undefined) return "";
  return items.find((item) => item._id === itemId)?.itemId ?? itemId;
}

function defaultSkillId(skills: Doc<"skillDefinitions">[], category?: SkillCategory) {
  return (
    skills.find((skill) => category === undefined || skill.category === category)
      ?.skillId ??
    skills[0]?.skillId ??
    ""
  );
}

function recipeRowsJson(
  rows: Array<{ itemId: Id<"items">; quantity: number }>,
  items: Doc<"items">[]
) {
  return JSON.stringify(
    rows.map((row) => ({
      itemId: itemStableId(items, row.itemId),
      quantity: row.quantity,
    })),
    null,
    2
  );
}

function parseRecipeItems(value: string, field: string): RecipeItemInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${field} must be valid JSON.`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${field} must be a non-empty JSON array.`);
  }
  return parsed.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${field}[${index}] must be an object.`);
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.itemId !== "string" || row.itemId.trim() === "") {
      throw new Error(`${field}[${index}].itemId is required.`);
    }
    if (typeof row.quantity !== "number" || !Number.isInteger(row.quantity) || row.quantity < 1) {
      throw new Error(`${field}[${index}].quantity must be an integer >= 1.`);
    }
    return { itemId: row.itemId.trim(), quantity: row.quantity };
  });
}

function itemOptions(items: Doc<"items">[]) {
  return sortedItems(items).map((item) => (
    <option key={item._id} value={item.itemId}>
      {item.itemId} · {item.name}
    </option>
  ));
}

function skillOptions(skills: Doc<"skillDefinitions">[], category?: SkillCategory) {
  return skills
    .filter((skill) => category === undefined || skill.category === category)
    .map((skill) => (
      <option key={skill._id} value={skill.skillId}>
        {skill.skillId} · {skill.name}
      </option>
    ));
}

interface SkillDefinitionForm {
  skillId: string;
  name: string;
  category: SkillCategory;
  pairedSkillId: string;
  description: string;
  enabled: boolean;
  maxLevel: string;
}

function skillDefinitionForm(row?: Doc<"skillDefinitions">): SkillDefinitionForm {
  return {
    skillId: row?.skillId ?? "",
    name: row?.name ?? "",
    category: row?.category ?? "gathering",
    pairedSkillId: row?.pairedSkillId ?? "",
    description: row?.description ?? "",
    enabled: row?.enabled ?? true,
    maxLevel: String(row?.maxLevel ?? 99),
  };
}

function SkillDefinitionEditor({
  playerId,
  row,
  skills,
}: {
  playerId: Id<"players">;
  row?: Doc<"skillDefinitions">;
  skills: Doc<"skillDefinitions">[];
}) {
  const create = useCreateSkillDefinition();
  const update = useUpdateSkillDefinition();
  const [form, setForm] = useState(() => skillDefinitionForm(row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(skillDefinitionForm(row)), [row]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      setIsSaving(true);
      const args = {
        playerId,
        name: form.name,
        category: form.category,
        pairedSkillId: form.pairedSkillId.trim() || null,
        description: form.description,
        enabled: form.enabled,
        maxLevel: requiredInteger(form.maxLevel, "Maximum level", 1),
      };
      if (row) {
        await update({ ...args, skillDefinitionId: row._id });
      } else {
        await create({ ...args, skillId: form.skillId });
        setForm(skillDefinitionForm());
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell
      title={row ? row.name : "Create skill"}
      identifier={row ? `ID: ${row.skillId}` : "New skill"}
      columns={["Skill ID", "Name", "Category", "Paired skill", "Max level", "Enabled", "Description"]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Skill ID">
        <TextInput
          value={form.skillId}
          disabled={Boolean(row)}
          onChange={(event) => setForm({ ...form, skillId: event.currentTarget.value })}
        />
      </Field>
      <Field label="Name">
        <TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} />
      </Field>
      <Field label="Category">
        <select value={form.category} onChange={(event) => setForm({ ...form, category: event.currentTarget.value as SkillCategory })} className={inputClass}>
          <option value="gathering">gathering</option>
          <option value="crafting">crafting</option>
        </select>
      </Field>
      <Field label="Paired skill">
        <select value={form.pairedSkillId} onChange={(event) => setForm({ ...form, pairedSkillId: event.currentTarget.value })} className={inputClass}>
          <option value="">None</option>
          {skills.filter((skill) => skill.skillId !== form.skillId).map((skill) => (
            <option key={skill._id} value={skill.skillId}>{skill.skillId} · {skill.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Max level">
        <TextInput type="number" min="1" step="1" value={form.maxLevel} onChange={(event) => setForm({ ...form, maxLevel: event.currentTarget.value })} />
      </Field>
      <Field label="Enabled">
        <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.currentTarget.checked })} className="mt-2 size-4 accent-gold" />
      </Field>
      <Field label="Description">
        <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} className={textareaClass} rows={2} />
      </Field>
    </EditorShell>
  );
}

interface SkillTierForm {
  skillId: string;
  tier: string;
  name: string;
  description: string;
  requiredLevel: string;
  enabled: boolean;
}

function skillTierForm(skills: Doc<"skillDefinitions">[], row?: Doc<"skillTierDefinitions">): SkillTierForm {
  return {
    skillId: row?.skillId ?? defaultSkillId(skills),
    tier: String(row?.tier ?? 1),
    name: row?.name ?? "",
    description: row?.description ?? "",
    requiredLevel: String(row?.requiredLevel ?? 1),
    enabled: row?.enabled ?? true,
  };
}

function SkillTierDefinitionEditor({
  playerId,
  row,
  skills,
}: {
  playerId: Id<"players">;
  row?: Doc<"skillTierDefinitions">;
  skills: Doc<"skillDefinitions">[];
}) {
  const create = useCreateSkillTierDefinition();
  const update = useUpdateSkillTierDefinition();
  const [form, setForm] = useState(() => skillTierForm(skills, row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(skillTierForm(skills, row)), [row, skills]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      setIsSaving(true);
      const args = {
        playerId,
        name: form.name,
        description: form.description,
        requiredLevel: requiredInteger(form.requiredLevel, "Required level", 1),
        enabled: form.enabled,
      };
      if (row) {
        await update({ ...args, skillTierDefinitionId: row._id });
      } else {
        await create({
          ...args,
          skillId: form.skillId,
          tier: requiredInteger(form.tier, "Tier", 1),
        });
        setForm(skillTierForm(skills));
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell
      title={row ? row.name : "Create tier"}
      identifier={row ? `${row.skillId} · Tier ${row.tier}` : "New skill tier"}
      columns={["Skill", "Tier", "Name", "Required level", "Enabled", "Description"]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Skill">
        <select value={form.skillId} disabled={Boolean(row)} onChange={(event) => setForm({ ...form, skillId: event.currentTarget.value })} className={inputClass}>
          {skillOptions(skills)}
        </select>
      </Field>
      <Field label="Tier">
        <TextInput type="number" min="1" step="1" value={form.tier} disabled={Boolean(row)} onChange={(event) => setForm({ ...form, tier: event.currentTarget.value })} />
      </Field>
      <Field label="Name">
        <TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} />
      </Field>
      <Field label="Required level">
        <TextInput type="number" min="1" step="1" value={form.requiredLevel} onChange={(event) => setForm({ ...form, requiredLevel: event.currentTarget.value })} />
      </Field>
      <Field label="Enabled">
        <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.currentTarget.checked })} className="mt-2 size-4 accent-gold" />
      </Field>
      <Field label="Description">
        <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} className={textareaClass} rows={2} />
      </Field>
    </EditorShell>
  );
}

interface GatheringActivityForm {
  activityId: string;
  skillId: string;
  tier: string;
  name: string;
  description: string;
  outputItemId: string;
  minYield: string;
  maxYield: string;
  durationMs: string;
  experienceReward: string;
  enabled: boolean;
}

function gatheringActivityForm(
  skills: Doc<"skillDefinitions">[],
  items: Doc<"items">[],
  row?: Doc<"gatheringActivities">
): GatheringActivityForm {
  return {
    activityId: row?.activityId ?? "",
    skillId: row?.skillId ?? defaultSkillId(skills, "gathering"),
    tier: String(row?.tier ?? 1),
    name: row?.name ?? "",
    description: row?.description ?? "",
    outputItemId: row ? itemStableId(items, row.outputItemId) : sortedItems(items)[0]?.itemId ?? "",
    minYield: String(row?.minYield ?? 1),
    maxYield: String(row?.maxYield ?? 1),
    durationMs: String(row?.durationMs ?? 30000),
    experienceReward: String(row?.experienceReward ?? 0),
    enabled: row?.enabled ?? true,
  };
}

function GatheringActivityEditor({
  playerId,
  row,
  skills,
  items,
}: {
  playerId: Id<"players">;
  row?: Doc<"gatheringActivities">;
  skills: Doc<"skillDefinitions">[];
  items: Doc<"items">[];
}) {
  const create = useCreateGatheringActivity();
  const update = useUpdateGatheringActivity();
  const [form, setForm] = useState(() => gatheringActivityForm(skills, items, row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(gatheringActivityForm(skills, items, row)), [row, skills, items]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      setIsSaving(true);
      const minYield = requiredInteger(form.minYield, "Minimum yield", 1);
      const args = {
        playerId,
        skillId: form.skillId,
        tier: requiredInteger(form.tier, "Tier", 1),
        name: form.name,
        description: form.description,
        outputItemId: form.outputItemId,
        minYield,
        maxYield: requiredInteger(form.maxYield, "Maximum yield", minYield),
        durationMs: requiredInteger(form.durationMs, "Duration", 1),
        experienceReward: requiredInteger(form.experienceReward, "Experience reward", 0),
        enabled: form.enabled,
      };
      if (row) {
        await update({ ...args, gatheringActivityId: row._id });
      } else {
        await create({ ...args, activityId: form.activityId });
        setForm(gatheringActivityForm(skills, items));
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell
      title={row ? row.name : "Create gathering"}
      identifier={row ? `ID: ${row.activityId}` : "New gathering activity"}
      columns={["Activity ID", "Skill", "Tier", "Name", "Output item", "Yield", "Duration", "XP", "Enabled", "Description"]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Activity ID"><TextInput value={form.activityId} disabled={Boolean(row)} onChange={(event) => setForm({ ...form, activityId: event.currentTarget.value })} /></Field>
      <Field label="Skill"><select value={form.skillId} onChange={(event) => setForm({ ...form, skillId: event.currentTarget.value })} className={inputClass}>{skillOptions(skills, "gathering")}</select></Field>
      <Field label="Tier"><TextInput type="number" min="1" step="1" value={form.tier} onChange={(event) => setForm({ ...form, tier: event.currentTarget.value })} /></Field>
      <Field label="Name"><TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field>
      <Field label="Output item"><select value={form.outputItemId} onChange={(event) => setForm({ ...form, outputItemId: event.currentTarget.value })} className={inputClass}>{itemOptions(items)}</select></Field>
      <Field label="Yield"><div className="grid grid-cols-2 gap-2"><TextInput aria-label="Minimum yield" type="number" min="1" step="1" value={form.minYield} onChange={(event) => setForm({ ...form, minYield: event.currentTarget.value })} /><TextInput aria-label="Maximum yield" type="number" min="1" step="1" value={form.maxYield} onChange={(event) => setForm({ ...form, maxYield: event.currentTarget.value })} /></div></Field>
      <Field label="Duration"><TextInput type="number" min="1" step="1" value={form.durationMs} onChange={(event) => setForm({ ...form, durationMs: event.currentTarget.value })} /></Field>
      <Field label="XP"><TextInput type="number" min="0" step="1" value={form.experienceReward} onChange={(event) => setForm({ ...form, experienceReward: event.currentTarget.value })} /></Field>
      <Field label="Enabled"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.currentTarget.checked })} className="mt-2 size-4 accent-gold" /></Field>
      <Field label="Description"><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} className={textareaClass} rows={2} /></Field>
    </EditorShell>
  );
}

interface RecipeForm {
  recipeId: string;
  skillId: string;
  tier: string;
  name: string;
  description: string;
  durationMs: string;
  experienceReward: string;
  outputFamily: string;
  stage: "" | "refinement" | "product";
  requiresMonsterDrop: boolean;
  enabled: boolean;
  ingredients: string;
  outputs: string;
}

function recipeForm(
  skills: Doc<"skillDefinitions">[],
  items: Doc<"items">[],
  ingredientRows: Doc<"recipeIngredients">[],
  outputRows: Doc<"recipeOutputs">[],
  row?: Doc<"recipes">
): RecipeForm {
  const firstItem = sortedItems(items)[0]?.itemId ?? "";
  return {
    recipeId: row?.recipeId ?? "",
    skillId: row?.skillId ?? defaultSkillId(skills, "crafting"),
    tier: String(row?.tier ?? 1),
    name: row?.name ?? "",
    description: row?.description ?? "",
    durationMs: String(row?.durationMs ?? 45000),
    experienceReward: String(row?.experienceReward ?? 0),
    outputFamily: row?.outputFamily ?? "",
    stage: row?.stage ?? "",
    requiresMonsterDrop: row?.requiresMonsterDrop ?? false,
    enabled: row?.enabled ?? true,
    ingredients: row ? recipeRowsJson(ingredientRows, items) : JSON.stringify(firstItem ? [{ itemId: firstItem, quantity: 1 }] : [], null, 2),
    outputs: row ? recipeRowsJson(outputRows, items) : JSON.stringify(firstItem ? [{ itemId: firstItem, quantity: 1 }] : [], null, 2),
  };
}

function RecipeEditor({
  playerId,
  row,
  skills,
  items,
  ingredients,
  outputs,
}: {
  playerId: Id<"players">;
  row?: Doc<"recipes">;
  skills: Doc<"skillDefinitions">[];
  items: Doc<"items">[];
  ingredients: Doc<"recipeIngredients">[];
  outputs: Doc<"recipeOutputs">[];
}) {
  const create = useCreateRecipe();
  const update = useUpdateRecipe();
  const [form, setForm] = useState(() => recipeForm(skills, items, ingredients, outputs, row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(recipeForm(skills, items, ingredients, outputs, row)), [row, skills, items, ingredients, outputs]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      setIsSaving(true);
      const args = {
        playerId,
        skillId: form.skillId,
        tier: requiredInteger(form.tier, "Tier", 1),
        name: form.name,
        description: form.description,
        durationMs: requiredInteger(form.durationMs, "Duration", 1),
        experienceReward: requiredInteger(form.experienceReward, "Experience reward", 0),
        outputFamily: form.outputFamily.trim() || null,
        ...(form.stage === "" ? {} : { stage: form.stage }),
        requiresMonsterDrop: form.requiresMonsterDrop,
        enabled: form.enabled,
        ingredients: parseRecipeItems(form.ingredients, "Ingredients"),
        outputs: parseRecipeItems(form.outputs, "Outputs"),
      };
      if (row) {
        await update({ ...args, recipeDefinitionId: row._id });
      } else {
        await create({ ...args, recipeId: form.recipeId });
        setForm(recipeForm(skills, items, [], []));
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell
      title={row ? row.name : "Create recipe"}
      identifier={row ? `ID: ${row.recipeId}` : "New recipe"}
      columns={["Recipe ID", "Skill", "Tier", "Name", "Duration", "XP", "Output family", "Stage", "Monster drop", "Enabled", "Ingredients", "Outputs", "Description"]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Recipe ID"><TextInput value={form.recipeId} disabled={Boolean(row)} onChange={(event) => setForm({ ...form, recipeId: event.currentTarget.value })} /></Field>
      <Field label="Skill"><select value={form.skillId} onChange={(event) => setForm({ ...form, skillId: event.currentTarget.value })} className={inputClass}>{skillOptions(skills, "crafting")}</select></Field>
      <Field label="Tier"><TextInput type="number" min="1" step="1" value={form.tier} onChange={(event) => setForm({ ...form, tier: event.currentTarget.value })} /></Field>
      <Field label="Name"><TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field>
      <Field label="Duration"><TextInput type="number" min="1" step="1" value={form.durationMs} onChange={(event) => setForm({ ...form, durationMs: event.currentTarget.value })} /></Field>
      <Field label="XP"><TextInput type="number" min="0" step="1" value={form.experienceReward} onChange={(event) => setForm({ ...form, experienceReward: event.currentTarget.value })} /></Field>
      <Field label="Output family"><TextInput value={form.outputFamily} onChange={(event) => setForm({ ...form, outputFamily: event.currentTarget.value })} /></Field>
      <Field label="Stage">
        <select
          value={form.stage}
          onChange={(event) =>
            setForm({
              ...form,
              stage: event.currentTarget.value as RecipeForm["stage"],
              requiresMonsterDrop:
                event.currentTarget.value === "product"
                  ? form.requiresMonsterDrop
                  : false,
            })
          }
          className={inputClass}
        >
          <option value="">Legacy / unclassified</option>
          <option value="refinement">Refinement</option>
          <option value="product">Product</option>
        </select>
      </Field>
      <Field label="Requires monster drop">
        <input
          type="checkbox"
          checked={form.requiresMonsterDrop}
          disabled={form.stage !== "product"}
          onChange={(event) =>
            setForm({ ...form, requiresMonsterDrop: event.currentTarget.checked })
          }
          className="mt-2 size-4 accent-gold"
        />
      </Field>
      <Field label="Enabled"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.currentTarget.checked })} className="mt-2 size-4 accent-gold" /></Field>
      <Field label="Ingredients"><textarea value={form.ingredients} onChange={(event) => setForm({ ...form, ingredients: event.currentTarget.value })} className={`${textareaClass} min-h-24 font-mono text-xs`} rows={4} spellCheck={false} /></Field>
      <Field label="Outputs"><textarea value={form.outputs} onChange={(event) => setForm({ ...form, outputs: event.currentTarget.value })} className={`${textareaClass} min-h-24 font-mono text-xs`} rows={4} spellCheck={false} /></Field>
      <Field label="Description"><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} className={textareaClass} rows={2} /></Field>
    </EditorShell>
  );
}

interface AugmentationForm {
  augmentationId: string;
  skillId: string;
  tier: string;
  name: string;
  description: string;
  baseItemFamily: string;
  allowedEquipmentSlots: EquipmentSlot[];
  requiredMaterialItemId: string;
  requiredMaterialQuantity: string;
  bossCatalystItemId: string;
  bossCatalystQuantity: string;
  effectType: string;
  effectStat: ItemEffectStat | "";
  effectAmount: string;
  enabled: boolean;
}

function augmentationForm(
  skills: Doc<"skillDefinitions">[],
  items: Doc<"items">[],
  row?: Doc<"augmentationDefinitions">
): AugmentationForm {
  const firstItem = sortedItems(items)[0]?.itemId ?? "";
  return {
    augmentationId: row?.augmentationId ?? "",
    skillId: row?.skillId ?? defaultSkillId(skills, "crafting"),
    tier: String(row?.tier ?? 1),
    name: row?.name ?? "",
    description: row?.description ?? "",
    baseItemFamily: row?.baseItemFamily ?? "",
    allowedEquipmentSlots: row?.allowedEquipmentSlots ?? [],
    requiredMaterialItemId: row ? itemStableId(items, row.requiredMaterialItemId) : firstItem,
    requiredMaterialQuantity: String(row?.requiredMaterialQuantity ?? 1),
    bossCatalystItemId: row ? itemStableId(items, row.bossCatalystItemId) : "",
    bossCatalystQuantity: row?.bossCatalystQuantity === undefined ? "" : String(row.bossCatalystQuantity),
    effectType: row?.effectType ?? "stat-bonus",
    effectStat: row?.effectStat ?? "",
    effectAmount: String(row?.effectAmount ?? 1),
    enabled: row?.enabled ?? true,
  };
}

function AugmentationDefinitionEditor({
  playerId,
  row,
  skills,
  items,
}: {
  playerId: Id<"players">;
  row?: Doc<"augmentationDefinitions">;
  skills: Doc<"skillDefinitions">[];
  items: Doc<"items">[];
}) {
  const create = useCreateAugmentationDefinition();
  const update = useUpdateAugmentationDefinition();
  const [form, setForm] = useState(() => augmentationForm(skills, items, row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(augmentationForm(skills, items, row)), [row, skills, items]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      setIsSaving(true);
      const args = {
        playerId,
        skillId: form.skillId,
        tier: requiredInteger(form.tier, "Tier", 1),
        name: form.name,
        description: form.description,
        baseItemFamily: form.baseItemFamily.trim() || null,
        allowedEquipmentSlots: form.allowedEquipmentSlots,
        requiredMaterialItemId: form.requiredMaterialItemId,
        requiredMaterialQuantity: requiredInteger(form.requiredMaterialQuantity, "Required material quantity", 1),
        bossCatalystItemId: form.bossCatalystItemId.trim() || null,
        bossCatalystQuantity: optionalNumber(form.bossCatalystQuantity, "Boss catalyst quantity", 1),
        effectType: form.effectType,
        effectStat: form.effectStat || null,
        effectAmount: requiredNumber(form.effectAmount, "Effect amount", 0),
        enabled: form.enabled,
      };
      if (row) {
        await update({ ...args, augmentationDefinitionId: row._id });
      } else {
        await create({ ...args, augmentationId: form.augmentationId });
        setForm(augmentationForm(skills, items));
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell
      title={row ? row.name : "Create augmentation"}
      identifier={row ? `ID: ${row.augmentationId}` : "New augmentation"}
      columns={["Augmentation ID", "Skill", "Tier", "Name", "Base family", "Slots", "Material", "Qty", "Catalyst", "Catalyst qty", "Effect type", "Effect stat", "Amount", "Enabled", "Description"]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Augmentation ID"><TextInput value={form.augmentationId} disabled={Boolean(row)} onChange={(event) => setForm({ ...form, augmentationId: event.currentTarget.value })} /></Field>
      <Field label="Skill"><select value={form.skillId} onChange={(event) => setForm({ ...form, skillId: event.currentTarget.value })} className={inputClass}>{skillOptions(skills, "crafting")}</select></Field>
      <Field label="Tier"><TextInput type="number" min="1" step="1" value={form.tier} onChange={(event) => setForm({ ...form, tier: event.currentTarget.value })} /></Field>
      <Field label="Name"><TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field>
      <Field label="Base family"><TextInput value={form.baseItemFamily} onChange={(event) => setForm({ ...form, baseItemFamily: event.currentTarget.value })} /></Field>
      <Field label="Slots"><div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1 text-xs">{EQUIPMENT_SLOT_VALUES.map((slot) => (<label key={slot} className="flex items-center gap-1"><input type="checkbox" checked={form.allowedEquipmentSlots.includes(slot)} onChange={(event) => setForm({ ...form, allowedEquipmentSlots: event.currentTarget.checked ? [...form.allowedEquipmentSlots, slot] : form.allowedEquipmentSlots.filter((selectedSlot) => selectedSlot !== slot) })} className="size-3 accent-gold" /><span>{itemSlotLabel(slot)}</span></label>))}</div></Field>
      <Field label="Material"><select value={form.requiredMaterialItemId} onChange={(event) => setForm({ ...form, requiredMaterialItemId: event.currentTarget.value })} className={inputClass}>{itemOptions(items)}</select></Field>
      <Field label="Qty"><TextInput type="number" min="1" step="1" value={form.requiredMaterialQuantity} onChange={(event) => setForm({ ...form, requiredMaterialQuantity: event.currentTarget.value })} /></Field>
      <Field label="Catalyst"><select value={form.bossCatalystItemId} onChange={(event) => setForm({ ...form, bossCatalystItemId: event.currentTarget.value })} className={inputClass}><option value="">None</option>{itemOptions(items)}</select></Field>
      <Field label="Catalyst qty"><TextInput type="number" min="1" step="1" value={form.bossCatalystQuantity} onChange={(event) => setForm({ ...form, bossCatalystQuantity: event.currentTarget.value })} /></Field>
      <Field label="Effect type"><TextInput value={form.effectType} onChange={(event) => setForm({ ...form, effectType: event.currentTarget.value })} /></Field>
      <Field label="Effect stat"><select value={form.effectStat} onChange={(event) => setForm({ ...form, effectStat: event.currentTarget.value as ItemEffectStat | "" })} className={inputClass}><option value="">None</option>{ITEM_EFFECT_STAT_VALUES.map((stat) => (<option key={stat} value={stat}>{stat.toUpperCase()}</option>))}</select></Field>
      <Field label="Amount"><TextInput type="number" min="0" step="any" value={form.effectAmount} onChange={(event) => setForm({ ...form, effectAmount: event.currentTarget.value })} /></Field>
      <Field label="Enabled"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.currentTarget.checked })} className="mt-2 size-4 accent-gold" /></Field>
      <Field label="Description"><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} className={textareaClass} rows={2} /></Field>
    </EditorShell>
  );
}

interface LootTableForm {
  lootTableId: string;
  name: string;
  sourceType: LootSourceType;
  tier: string;
  rollCount: string;
  enabled: boolean;
}

function lootTableForm(row?: Doc<"lootTables">): LootTableForm {
  return {
    lootTableId: row?.lootTableId ?? "",
    name: row?.name ?? "",
    sourceType: row?.sourceType ?? "monster",
    tier: row?.tier === undefined ? "" : String(row.tier),
    rollCount: String(row?.rollCount ?? 1),
    enabled: row?.enabled ?? true,
  };
}

function LootTableEditor({ playerId, row }: { playerId: Id<"players">; row?: Doc<"lootTables"> }) {
  const create = useCreateLootTable();
  const update = useUpdateLootTable();
  const [form, setForm] = useState(() => lootTableForm(row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(lootTableForm(row)), [row]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      setIsSaving(true);
      const args = {
        playerId,
        name: form.name,
        sourceType: form.sourceType,
        tier: optionalNumber(form.tier, "Tier", 1),
        rollCount: requiredInteger(form.rollCount, "Roll count", 1),
        enabled: form.enabled,
      };
      if (row) {
        await update({ ...args, lootTableDefinitionId: row._id });
      } else {
        await create({ ...args, lootTableId: form.lootTableId });
        setForm(lootTableForm());
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell title={row ? row.name : "Create loot table"} identifier={row ? `ID: ${row.lootTableId}` : "New loot table"} columns={["Loot table ID", "Name", "Source type", "Tier", "Roll count", "Enabled"]} onSubmit={handleSubmit} isSaving={isSaving} error={error}>
      <Field label="Loot table ID"><TextInput value={form.lootTableId} disabled={Boolean(row)} onChange={(event) => setForm({ ...form, lootTableId: event.currentTarget.value })} /></Field>
      <Field label="Name"><TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field>
      <Field label="Source type"><select value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.currentTarget.value as LootSourceType })} className={inputClass}><option value="monster">monster</option><option value="boss">boss</option></select></Field>
      <Field label="Tier"><TextInput type="number" min="1" step="1" value={form.tier} onChange={(event) => setForm({ ...form, tier: event.currentTarget.value })} /></Field>
      <Field label="Roll count"><TextInput type="number" min="1" step="1" value={form.rollCount} onChange={(event) => setForm({ ...form, rollCount: event.currentTarget.value })} /></Field>
      <Field label="Enabled"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.currentTarget.checked })} className="mt-2 size-4 accent-gold" /></Field>
    </EditorShell>
  );
}

interface LootEntryForm {
  lootTableId: string;
  itemId: string;
  weight: string;
  dropChance: string;
  minQuantity: string;
  maxQuantity: string;
  guaranteed: boolean;
  purpose: LootPurpose;
  enabled: boolean;
}

function lootEntryForm(
  lootTables: Doc<"lootTables">[],
  items: Doc<"items">[],
  row?: Doc<"lootTableEntries">
): LootEntryForm {
  return {
    lootTableId: row?.lootTableId ?? lootTables[0]?.lootTableId ?? "",
    itemId: row ? itemStableId(items, row.itemId) : sortedItems(items)[0]?.itemId ?? "",
    weight: String(row?.weight ?? 1),
    dropChance: String(row?.dropChance ?? 1),
    minQuantity: String(row?.minQuantity ?? 1),
    maxQuantity: String(row?.maxQuantity ?? 1),
    guaranteed: row?.guaranteed ?? false,
    purpose: row?.purpose ?? "augmentation",
    enabled: row?.enabled ?? true,
  };
}

function LootTableEntryEditor({
  playerId,
  row,
  lootTables,
  items,
}: {
  playerId: Id<"players">;
  row?: Doc<"lootTableEntries">;
  lootTables: Doc<"lootTables">[];
  items: Doc<"items">[];
}) {
  const create = useCreateLootTableEntry();
  const update = useUpdateLootTableEntry();
  const [form, setForm] = useState(() => lootEntryForm(lootTables, items, row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(lootEntryForm(lootTables, items, row)), [row, lootTables, items]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      setIsSaving(true);
      const minQuantity = requiredInteger(form.minQuantity, "Minimum quantity", 1);
      const args = {
        playerId,
        weight: requiredNumber(form.weight, "Weight", 0),
        dropChance: boundedNumber(form.dropChance, "Drop chance", 0, 1),
        minQuantity,
        maxQuantity: requiredInteger(form.maxQuantity, "Maximum quantity", minQuantity),
        guaranteed: form.guaranteed,
        purpose: form.purpose,
        enabled: form.enabled,
      };
      if (row) {
        await update({ ...args, lootTableEntryId: row._id });
      } else {
        await create({ ...args, lootTableId: form.lootTableId, itemId: form.itemId });
        setForm(lootEntryForm(lootTables, items));
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell title={row ? `${form.lootTableId} · ${form.itemId}` : "Create loot entry"} identifier={row ? "Table/item IDs are immutable" : "New loot entry"} columns={["Loot table", "Item", "Weight", "Drop chance", "Quantity", "Guaranteed", "Purpose", "Enabled"]} onSubmit={handleSubmit} isSaving={isSaving} error={error}>
      <Field label="Loot table"><select value={form.lootTableId} disabled={Boolean(row)} onChange={(event) => setForm({ ...form, lootTableId: event.currentTarget.value })} className={inputClass}>{lootTables.map((table) => (<option key={table._id} value={table.lootTableId}>{table.lootTableId} · {table.name}</option>))}</select></Field>
      <Field label="Item"><select value={form.itemId} disabled={Boolean(row)} onChange={(event) => setForm({ ...form, itemId: event.currentTarget.value })} className={inputClass}>{itemOptions(items)}</select></Field>
      <Field label="Weight"><TextInput type="number" min="0" step="any" value={form.weight} onChange={(event) => setForm({ ...form, weight: event.currentTarget.value })} /></Field>
      <Field label="Drop chance"><TextInput type="number" min="0" max="1" step="0.01" value={form.dropChance} onChange={(event) => setForm({ ...form, dropChance: event.currentTarget.value })} /></Field>
      <Field label="Quantity"><div className="grid grid-cols-2 gap-2"><TextInput aria-label="Minimum quantity" type="number" min="1" step="1" value={form.minQuantity} onChange={(event) => setForm({ ...form, minQuantity: event.currentTarget.value })} /><TextInput aria-label="Maximum quantity" type="number" min="1" step="1" value={form.maxQuantity} onChange={(event) => setForm({ ...form, maxQuantity: event.currentTarget.value })} /></div></Field>
      <Field label="Guaranteed"><input type="checkbox" checked={form.guaranteed} onChange={(event) => setForm({ ...form, guaranteed: event.currentTarget.checked })} className="mt-2 size-4 accent-gold" /></Field>
      <Field label="Purpose"><select value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.currentTarget.value as LootPurpose })} className={inputClass}><option value="augmentation">augmentation</option><option value="boss-catalyst">boss-catalyst</option></select></Field>
      <Field label="Enabled"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.currentTarget.checked })} className="mt-2 size-4 accent-gold" /></Field>
    </EditorShell>
  );
}

interface LootSourceForm {
  sourceType: LootSourceType;
  sourceId: string;
  tier: string;
  lootTableId: string;
}

function lootSourceForm(lootTables: Doc<"lootTables">[], row?: Doc<"lootSources">): LootSourceForm {
  return {
    sourceType: row?.sourceType ?? "monster",
    sourceId: row?.sourceId ?? "",
    tier: row?.tier === undefined ? "" : String(row.tier),
    lootTableId: row?.lootTableId ?? lootTables[0]?.lootTableId ?? "",
  };
}

function LootSourceEditor({
  playerId,
  row,
  lootTables,
}: {
  playerId: Id<"players">;
  row?: Doc<"lootSources">;
  lootTables: Doc<"lootTables">[];
}) {
  const create = useCreateLootSource();
  const update = useUpdateLootSource();
  const [form, setForm] = useState(() => lootSourceForm(lootTables, row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(lootSourceForm(lootTables, row)), [row, lootTables]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      setIsSaving(true);
      if (row) {
        await update({ playerId, lootSourceId: row._id, lootTableId: form.lootTableId });
      } else {
        await create({
          playerId,
          sourceType: form.sourceType,
          sourceId: form.sourceId,
          tier: optionalNumber(form.tier, "Tier", 1),
          lootTableId: form.lootTableId,
        });
        setForm(lootSourceForm(lootTables));
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell title={row ? `${row.sourceType} · ${row.sourceId}` : "Create loot source"} identifier={row ? "Source identifiers are immutable" : "New loot source"} columns={["Source type", "Source ID", "Tier", "Loot table"]} onSubmit={handleSubmit} isSaving={isSaving} error={error}>
      <Field label="Source type"><select value={form.sourceType} disabled={Boolean(row)} onChange={(event) => setForm({ ...form, sourceType: event.currentTarget.value as LootSourceType })} className={inputClass}><option value="monster">monster</option><option value="boss">boss</option></select></Field>
      <Field label="Source ID"><TextInput value={form.sourceId} disabled={Boolean(row)} onChange={(event) => setForm({ ...form, sourceId: event.currentTarget.value })} /></Field>
      <Field label="Tier"><TextInput type="number" min="1" step="1" value={form.tier} disabled={Boolean(row)} onChange={(event) => setForm({ ...form, tier: event.currentTarget.value })} /></Field>
      <Field label="Loot table"><select value={form.lootTableId} onChange={(event) => setForm({ ...form, lootTableId: event.currentTarget.value })} className={inputClass}>{lootTables.map((table) => (<option key={table._id} value={table.lootTableId}>{table.lootTableId} · {table.name}</option>))}</select></Field>
    </EditorShell>
  );
}

interface TaskDefinitionForm {
  taskId: string;
  name: string;
  category: string;
  description: string;
  durationMs: string;
  canProgressOffline: boolean;
  requiresOnline: boolean;
  enabled: boolean;
  prerequisites: string;
  rewards: string;
}

function taskDefinitionForm(row?: Doc<"taskDefinitions">): TaskDefinitionForm {
  return {
    taskId: row?.taskId ?? "",
    name: row?.name ?? "",
    category: row?.category ?? "crafting",
    description: row?.description ?? "",
    durationMs: row?.durationMs === undefined ? "60000" : String(row.durationMs),
    canProgressOffline: row?.canProgressOffline ?? true,
    requiresOnline: row?.requiresOnline ?? false,
    enabled: row?.enabled ?? true,
    prerequisites: JSON.stringify(row?.prerequisites ?? null, null, 2),
    rewards: JSON.stringify(row?.rewards ?? null, null, 2),
  };
}

function TaskDefinitionEditor({
  playerId,
  row,
}: {
  playerId: Id<"players">;
  row?: Doc<"taskDefinitions">;
}) {
  const create = useCreateTaskDefinition();
  const update = useUpdateTaskDefinition();
  const [form, setForm] = useState(() => taskDefinitionForm(row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(taskDefinitionForm(row)), [row]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    let prerequisites: unknown;
    let rewards: unknown;
    try {
      prerequisites = JSON.parse(form.prerequisites);
      rewards = JSON.parse(form.rewards);
    } catch {
      setError("Prerequisites and rewards must be valid JSON.");
      return;
    }

    try {
      setIsSaving(true);
      const args = {
        playerId,
        name: form.name,
        category: form.category,
        description: form.description,
        durationMs:
          form.category === "battle"
            ? null
            : form.durationMs.trim()
              ? requiredNumber(form.durationMs, "Duration", 1)
              : null,
        canProgressOffline: form.canProgressOffline,
        requiresOnline: form.requiresOnline,
        enabled: form.enabled,
        prerequisites,
        rewards,
      };

      if (row) {
        await update({ ...args, taskDefinitionId: row._id });
      } else {
        await create({ ...args, taskId: form.taskId });
        setForm(taskDefinitionForm());
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell
      title={row ? row.name : "Create task"}
      identifier={row ? `ID: ${row.taskId}` : "New task"}
      columns={[
        "Task ID",
        "Name",
        "Category",
        "Duration (ms)",
        "Offline",
        "Online only",
        "Enabled",
        "Prerequisites (JSON)",
        "Rewards (JSON)",
        "Description",
      ]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Task ID">
        <TextInput
          value={form.taskId}
          disabled={Boolean(row)}
          onChange={(event) =>
            setForm({ ...form, taskId: event.currentTarget.value })
          }
        />
      </Field>
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
      <Field label="Duration (ms)">
        <TextInput
          type="number"
          min="1"
          value={form.durationMs}
          disabled={form.category === "battle"}
          onChange={(event) =>
            setForm({ ...form, durationMs: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Offline">
        <input
          type="checkbox"
          checked={form.canProgressOffline}
          disabled={form.requiresOnline}
          onChange={(event) =>
            setForm({ ...form, canProgressOffline: event.currentTarget.checked })
          }
          className="mt-2 size-4 accent-gold"
        />
      </Field>
      <Field label="Online only">
        <input
          type="checkbox"
          checked={form.requiresOnline}
          onChange={(event) =>
            setForm({
              ...form,
              requiresOnline: event.currentTarget.checked,
              canProgressOffline: event.currentTarget.checked
                ? false
                : form.canProgressOffline,
            })
          }
          className="mt-2 size-4 accent-gold"
        />
      </Field>
      <Field label="Enabled">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(event) =>
            setForm({ ...form, enabled: event.currentTarget.checked })
          }
          className="mt-2 size-4 accent-gold"
        />
      </Field>
      <Field label="Prerequisites (JSON)">
        <textarea
          value={form.prerequisites}
          onChange={(event) =>
            setForm({ ...form, prerequisites: event.currentTarget.value })
          }
          className={textareaClass}
          rows={2}
          spellCheck={false}
        />
      </Field>
      <Field label="Rewards (JSON)">
        <textarea
          value={form.rewards}
          onChange={(event) =>
            setForm({ ...form, rewards: event.currentTarget.value })
          }
          className={textareaClass}
          rows={2}
          spellCheck={false}
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

interface ItemRarityForm {
  level: string;
  name: string;
  color: string;
}

function itemRarityForm(row?: Doc<"itemRarities">): ItemRarityForm {
  return {
    level: row ? String(row.level) : "",
    name: row?.name ?? "",
    color: row?.color ?? "#9ca3af",
  };
}

function ItemRarityEditor({
  playerId,
  row,
}: {
  playerId: Id<"players">;
  row?: Doc<"itemRarities">;
}) {
  const create = useCreateItemRarity();
  const update = useUpdateItemRarity();
  const [form, setForm] = useState(() => itemRarityForm(row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(itemRarityForm(row)), [row]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      setIsSaving(true);
      const args = {
        playerId,
        level: requiredInteger(form.level, "Rarity level", 1),
        name: form.name,
        color: form.color,
      };

      if (row) {
        await update({ ...args, rarityId: row._id });
      } else {
        await create(args);
        setForm(itemRarityForm());
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const isValidColor = /^#[0-9a-f]{6}$/i.test(form.color.trim());

  return (
    <EditorShell
      title={row ? row.name : "Create rarity"}
      identifier={row ? `Level: ${row.level}` : "New rarity"}
      columns={["Level", "Name", "Color"]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Level">
        <TextInput
          type="number"
          min="1"
          step="1"
          value={form.level}
          onChange={(event) =>
            setForm({ ...form, level: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Name">
        <TextInput
          value={form.name}
          onChange={(event) =>
            setForm({ ...form, name: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Color">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={isValidColor ? form.color.trim() : "#9ca3af"}
            onChange={(event) =>
              setForm({ ...form, color: event.currentTarget.value })
            }
            className="size-7 shrink-0 cursor-pointer border border-forest-light/40 bg-transparent p-0.5"
            aria-label="Choose rarity color"
            title="Choose rarity color"
          />
          <TextInput
            value={form.color}
            placeholder="#9ca3af"
            onChange={(event) =>
              setForm({ ...form, color: event.currentTarget.value })
            }
          />
        </div>
      </Field>
    </EditorShell>
  );
}

interface ItemForm {
  itemId: string;
  name: string;
  category: ItemCategory;
  description: string;
  stackable: boolean;
  maxStackSize: string;
  allowedEquipmentSlots: EquipmentSlot[];
  rarityLevel: string;
  itemFamily: string;
  craftingSkillId: string;
  craftingTier: string;
  effectType: string;
  effectStat: ItemEffectStat | "";
  effectAmount: string;
  effectDurationMs: string;
  augmentSlots: string;
}

function itemForm(
  row?: Doc<"items">,
  defaultRarityLevel = DEFAULT_ITEM_RARITY_LEVEL
): ItemForm {
  return {
    itemId: row?.itemId ?? "",
    name: row?.name ?? "",
    category: row?.category ?? "crafting",
    description: row?.description ?? "",
    stackable: row?.stackable ?? true,
    maxStackSize: row ? String(row.maxStackSize) : "99",
    allowedEquipmentSlots: row?.allowedEquipmentSlots ?? [],
    rarityLevel: String(row?.rarityLevel ?? defaultRarityLevel),
    itemFamily: row?.itemFamily ?? "",
    craftingSkillId: row?.craftingSkillId ?? "",
    craftingTier:
      row?.craftingTier === undefined ? "" : String(row.craftingTier),
    effectType: row?.effectType ?? "",
    effectStat: row?.effectStat ?? "",
    effectAmount:
      row?.effectAmount === undefined ? "" : String(row.effectAmount),
    effectDurationMs:
      row?.effectDurationMs === undefined ? "" : String(row.effectDurationMs),
    augmentSlots:
      row?.augmentSlots === undefined ? "" : String(row.augmentSlots),
  };
}

function itemSlotLabel(slot: EquipmentSlot) {
  return slot
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function ItemEditor({
  playerId,
  row,
  rarities,
}: {
  playerId: Id<"players">;
  row?: Doc<"items">;
  rarities: Doc<"itemRarities">[];
}) {
  const create = useCreateItem();
  const update = useUpdateItem();
  const defaultRarityLevel =
    rarities[0]?.level ?? DEFAULT_ITEM_RARITY_LEVEL;
  const [form, setForm] = useState(() => itemForm(row, defaultRarityLevel));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(itemForm(row, defaultRarityLevel)), [
    row,
    defaultRarityLevel,
  ]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      setIsSaving(true);
      const maxStackSize = form.stackable
        ? requiredNumber(form.maxStackSize, "Maximum stack size", 1)
        : 1;
      const allowedEquipmentSlots =
        form.category === "equipment" ? form.allowedEquipmentSlots : [];

      if (form.category === "equipment" && allowedEquipmentSlots.length === 0) {
        throw new Error("Select at least one compatible equipment slot.");
      }

      const args = {
        playerId,
        name: form.name,
        category: form.category,
        description: form.description,
        stackable: form.stackable,
        maxStackSize,
        allowedEquipmentSlots,
        rarityLevel: requiredInteger(form.rarityLevel, "Rarity level", 1),
        itemFamily: form.itemFamily.trim() || null,
        craftingSkillId: form.craftingSkillId.trim() || null,
        craftingTier: optionalNumber(form.craftingTier, "Crafting tier", 1),
        effectType: form.effectType.trim() || null,
        effectStat: form.effectStat || null,
        effectAmount: optionalNumber(form.effectAmount, "Effect amount", 0),
        effectDurationMs: optionalNumber(
          form.effectDurationMs,
          "Effect duration",
          1
        ),
        augmentSlots: optionalNumber(form.augmentSlots, "Augmentation slots", 0),
      };

      if (row) {
        await update({ ...args, itemId: row._id });
      } else {
        await create({ ...args, itemId: form.itemId });
        setForm(itemForm(undefined, defaultRarityLevel));
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EditorShell
      title={row ? row.name : "Create item"}
      identifier={row ? `ID: ${row.itemId}` : "New item"}
      columns={[
        "Item ID",
        "Name",
        "Category",
        "Rarity",
        "Stackable",
        "Maximum stack",
        "Equipment slots",
        "Item family",
        "Crafting skill",
        "Crafting tier",
        "Effect type",
        "Effect stat",
        "Effect amount",
        "Effect duration",
        "Augmentation slots",
        "Description",
      ]}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      error={error}
    >
      <Field label="Item ID">
        <TextInput
          value={form.itemId}
          disabled={Boolean(row)}
          onChange={(event) =>
            setForm({ ...form, itemId: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Name">
        <TextInput
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
        />
      </Field>
      <Field label="Category">
        <select
          value={form.category}
          onChange={(event) => {
            const category = event.currentTarget.value as ItemCategory;
            setForm({
              ...form,
              category,
              stackable: category === "equipment" ? false : form.stackable,
              maxStackSize:
                category === "equipment" ? "1" : form.maxStackSize,
              allowedEquipmentSlots:
                category === "equipment" ? form.allowedEquipmentSlots : [],
            });
          }}
          className={inputClass}
        >
          {ITEM_CATEGORY_VALUES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Rarity">
        <select
          value={form.rarityLevel}
          onChange={(event) =>
            setForm({ ...form, rarityLevel: event.currentTarget.value })
          }
          className={inputClass}
        >
          {rarities.map((rarity) => (
            <option key={rarity._id} value={rarity.level}>
              {rarity.level} · {rarity.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Stackable">
        <input
          type="checkbox"
          checked={form.stackable}
          disabled={form.category === "equipment"}
          onChange={(event) =>
            setForm({
              ...form,
              stackable: event.currentTarget.checked,
              maxStackSize: event.currentTarget.checked ? form.maxStackSize : "1",
            })
          }
          className="mt-2 size-4 accent-gold"
        />
      </Field>
      <Field label="Maximum stack">
        <TextInput
          type="number"
          min="1"
          value={form.stackable ? form.maxStackSize : "1"}
          disabled={!form.stackable}
          onChange={(event) =>
            setForm({ ...form, maxStackSize: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Equipment slots">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1 text-xs">
          {EQUIPMENT_SLOT_VALUES.map((slot) => (
            <label key={slot} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={form.allowedEquipmentSlots.includes(slot)}
                disabled={form.category !== "equipment"}
                onChange={(event) =>
                  setForm({
                    ...form,
                    allowedEquipmentSlots: event.currentTarget.checked
                      ? [...form.allowedEquipmentSlots, slot]
                      : form.allowedEquipmentSlots.filter(
                          (selectedSlot) => selectedSlot !== slot
                        ),
                  })
                }
                className="size-3 accent-gold"
              />
              <span>{itemSlotLabel(slot)}</span>
            </label>
          ))}
        </div>
      </Field>
      <Field label="Item family">
        <TextInput
          value={form.itemFamily}
          onChange={(event) =>
            setForm({ ...form, itemFamily: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Crafting skill">
        <TextInput
          value={form.craftingSkillId}
          onChange={(event) =>
            setForm({ ...form, craftingSkillId: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Crafting tier">
        <TextInput
          type="number"
          min="1"
          step="1"
          value={form.craftingTier}
          onChange={(event) =>
            setForm({ ...form, craftingTier: event.currentTarget.value })
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
      <Field label="Effect stat">
        <select
          value={form.effectStat}
          onChange={(event) =>
            setForm({
              ...form,
              effectStat: event.currentTarget.value as ItemEffectStat | "",
            })
          }
          className={inputClass}
        >
          <option value="">None</option>
          {ITEM_EFFECT_STAT_VALUES.map((stat) => (
            <option key={stat} value={stat}>
              {stat.toUpperCase()}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Effect amount">
        <TextInput
          type="number"
          min="0"
          step="any"
          value={form.effectAmount}
          onChange={(event) =>
            setForm({ ...form, effectAmount: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Effect duration">
        <TextInput
          type="number"
          min="1"
          step="1"
          value={form.effectDurationMs}
          onChange={(event) =>
            setForm({ ...form, effectDurationMs: event.currentTarget.value })
          }
        />
      </Field>
      <Field label="Augmentation slots">
        <TextInput
          type="number"
          min="0"
          step="1"
          value={form.augmentSlots}
          onChange={(event) =>
            setForm({ ...form, augmentSlots: event.currentTarget.value })
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

function getMonsterEncounterRates(monsters: Doc<"monsters">[]) {
  if (monsters.length === 0) {
    return new Map<Id<"monsters">, number>();
  }

  const maxStrength = Math.max(...monsters.map((monster) => monster.strength));
  const weights = monsters.map((monster) => ({
    id: monster._id,
    weight: maxStrength - monster.strength + 1,
  }));
  const totalWeight = weights.reduce((total, entry) => total + entry.weight, 0);

  return new Map(
    weights.map((entry) => [
      entry.id,
      totalWeight > 0 ? (entry.weight / totalWeight) * 100 : 0,
    ])
  );
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
  encounterRate,
}: {
  playerId: Id<"players">;
  row: Doc<"monsters">;
  encounterRate: number;
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
        "Encounter rate",
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
      <div
        role="cell"
        className="pt-2 text-sm font-semibold tabular-nums text-forest-glow"
        title="Derived from all monster difficulty weights"
      >
        {encounterRate.toFixed(2)}%
      </div>
    </EditorShell>
  );
}

interface BossForm {
  name: string;
  str: string;
  dex: string;
  int: string;
  luk: string;
  con: string;
  rewardMultiplier: string;
}

function bossForm(row: Doc<"bosses">): BossForm {
  return {
    name: row.name,
    str: String(row.str),
    dex: String(row.dex),
    int: String(row.int),
    luk: String(row.luk),
    con: String(row.con),
    rewardMultiplier: String(row.rewardMultiplier),
  };
}

function BossEditor({
  playerId,
  row,
}: {
  playerId: Id<"players">;
  row: Doc<"bosses">;
}) {
  const update = useUpdateBoss();
  const [form, setForm] = useState(() => bossForm(row));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(bossForm(row)), [row]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      setIsSaving(true);
      await update({
        playerId,
        bossId: row._id,
        name: form.name,
        str: requiredNumber(form.str, "STR"),
        dex: requiredNumber(form.dex, "DEX"),
        int: requiredNumber(form.int, "INT"),
        luk: requiredNumber(form.luk, "LUK"),
        con: requiredNumber(form.con, "CON"),
        rewardMultiplier: requiredNumber(
          form.rewardMultiplier,
          "Reward multiplier"
        ),
      });
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const statFields: Array<keyof Pick<BossForm, "str" | "dex" | "int" | "luk" | "con">> = [
    "str",
    "dex",
    "int",
    "luk",
    "con",
  ];

  return (
    <EditorShell
      title={row.name}
      identifier={`Tier ${row.tier} · ID: ${row.bossId}`}
      columns={[
        "Name",
        "Tier",
        "STR",
        "DEX",
        "INT",
        "LUK",
        "CON",
        "Reward multiplier",
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
      <div role="cell" className="pt-2 text-sm text-muted-foreground">
        {row.tier}
      </div>
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
      <Field label="Reward multiplier">
        <TextInput
          type="number"
          min="0"
          step="any"
          value={form.rewardMultiplier}
          onChange={(event) =>
            setForm({ ...form, rewardMultiplier: event.currentTarget.value })
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
  const resetForestCrafting = useResetForestCrafting();
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const handleResetForestCrafting = async () => {
    if (
      !window.confirm(
        "Reset all forest crafting skills, recipes, inventory, drops, and queued gathering/crafting tasks, then reseed them? Combat progress and fight history will remain."
      )
    ) {
      return;
    }
    setResetStatus("Resetting...");
    try {
      const result = await resetForestCrafting({ playerId });
      setResetStatus(result.message);
    } catch (error) {
      setResetStatus(errorMessage(error));
    }
  };

  if (config.isPending) {
    return (
      <Card className="forest-card p-4">
        <p className="text-sm text-muted-foreground">Loading admin configuration...</p>
      </Card>
    );
  }

  if (!config.data) {
    return (
      <Card className="forest-card p-4">
        <p className="text-sm text-blood-light" role="alert">
          Unable to load admin configuration.
        </p>
      </Card>
    );
  }

  const encounterRates = getMonsterEncounterRates(config.data.monsters);
  const itemRarities = [...config.data.itemRarities].sort(
    (left, right) => left.level - right.level
  );
  const requestedTab = searchParams.get(ADMIN_TAB_PARAM);
  const activeTab = isAdminTab(requestedTab)
    ? requestedTab
    : DEFAULT_ADMIN_TAB;

  const handleTabChange = (value: string) => {
    if (!isAdminTab(value)) return;

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set(ADMIN_TAB_PARAM, value);
    setSearchParams(nextSearchParams, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div className="forest-card border border-gold/20 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-heading text-xl text-gold glow-gold">
              Admin controls
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Changes apply immediately to the live game, including stat-upgrade
              pricing and level requirements. Stable IDs and references are
              read-only so existing player progress remains valid.
            </p>
          </div>
          <div className="shrink-0">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => void handleResetForestCrafting()}
            >
              Reset forest crafting data
            </Button>
            {resetStatus && (
              <p className="mt-1 max-w-xs text-right text-[10px] text-muted-foreground">
                {resetStatus}
              </p>
            )}
          </div>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="gap-6"
      >
        <div className="overflow-x-auto border-b border-forest-light/30">
          <TabsList
            variant="forest"
            aria-label="Admin configuration sections"
            className="min-w-max"
          >
            {ADMIN_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent
          value="players"
          keepMounted
          className="space-y-6 outline-none"
        >
          <CharacterEditorCard playerId={playerId} />
        </TabsContent>

        <TabsContent
          value="monsters"
          keepMounted
          className="space-y-6 outline-none"
        >
          <AdminSection
            title="Monsters"
            description="Tune base stats, rewards, attack timing, and encounter weighting. Rates are derived from the difficulty weights."
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
              "Encounter rate",
            ]}
          >
            {config.data.monsters.map((row) => (
              <MonsterEditor
                key={row._id}
                playerId={playerId}
                row={row}
                encounterRate={encounterRates.get(row._id) ?? 0}
              />
            ))}
          </AdminSection>

          <AdminSection
            title="Bosses"
            description="Tune generated tier bosses, their names, tier-scaled stats, and reward multipliers."
            columns={[
              "Name",
              "Tier",
              "STR",
              "DEX",
              "INT",
              "LUK",
              "CON",
              "Reward multiplier",
            ]}
          >
            {config.data.bosses.map((row) => (
              <BossEditor key={row._id} playerId={playerId} row={row} />
            ))}
          </AdminSection>

          <AdminSection
            title="Loot tables"
            description="Create and edit loot tables used by monster and boss reward sources."
            columns={[
              "Loot table ID",
              "Name",
              "Source type",
              "Tier",
              "Roll count",
              "Enabled",
            ]}
          >
            <LootTableEditor playerId={playerId} />
            {config.data.lootTables.map((row) => (
              <LootTableEditor key={row._id} playerId={playerId} row={row} />
            ))}
          </AdminSection>

          <AdminSection
            title="Loot table entries"
            description="Configure each table's item drops, chance, quantity range, and drop purpose."
            columns={[
              "Loot table",
              "Item",
              "Weight",
              "Drop chance",
              "Quantity",
              "Guaranteed",
              "Purpose",
              "Enabled",
            ]}
          >
            <LootTableEntryEditor
              playerId={playerId}
              lootTables={config.data.lootTables}
              items={config.data.items}
            />
            {config.data.lootTableEntries.map((row) => (
              <LootTableEntryEditor
                key={row._id}
                playerId={playerId}
                row={row}
                lootTables={config.data.lootTables}
                items={config.data.items}
              />
            ))}
          </AdminSection>

          <AdminSection
            title="Loot sources"
            description="Map combat source identifiers to loot tables. Source identifiers are immutable after creation."
            columns={["Source type", "Source ID", "Tier", "Loot table"]}
          >
            <LootSourceEditor
              playerId={playerId}
              lootTables={config.data.lootTables}
            />
            {config.data.lootSources.map((row) => (
              <LootSourceEditor
                key={row._id}
                playerId={playerId}
                row={row}
                lootTables={config.data.lootTables}
              />
            ))}
          </AdminSection>
        </TabsContent>

        <TabsContent
          value="items"
          keepMounted
          className="space-y-6 outline-none"
        >
          <AdminSection
            title="Item rarities"
            description="Create and update item rarity names and colors. Higher numeric levels are more rare; changing a level updates assigned items."
            columns={["Level", "Name", "Color"]}
          >
            <ItemRarityEditor playerId={playerId} />
            {itemRarities.map((row) => (
              <ItemRarityEditor key={row._id} playerId={playerId} row={row} />
            ))}
          </AdminSection>

          <AdminSection
            title="Items"
            description="Create item definitions, assign rarity, and configure stacking and compatible equipment slots. Item definitions do not grant items to players."
            columns={[
              "Item ID",
              "Name",
              "Category",
              "Rarity",
              "Stackable",
              "Maximum stack",
              "Equipment slots",
              "Description",
            ]}
          >
            <ItemEditor playerId={playerId} rarities={itemRarities} />
            {config.data.items.map((row) => (
              <ItemEditor
                key={row._id}
                playerId={playerId}
                row={row}
                rarities={itemRarities}
              />
            ))}
          </AdminSection>
        </TabsContent>

        <TabsContent
          value="skills"
          keepMounted
          className="space-y-6 outline-none"
        >
          <AdminSection
            title="Skill definitions"
            description="Create and edit gathering and crafting skills. Stable skill IDs are immutable after creation."
            columns={[
              "Skill ID",
              "Name",
              "Category",
              "Paired skill",
              "Max level",
              "Enabled",
              "Description",
            ]}
          >
            <SkillDefinitionEditor
              playerId={playerId}
              skills={config.data.skillDefinitions}
            />
            {config.data.skillDefinitions.map((row) => (
              <SkillDefinitionEditor
                key={row._id}
                playerId={playerId}
                row={row}
                skills={config.data.skillDefinitions}
              />
            ))}
          </AdminSection>

          <AdminSection
            title="Skill tiers"
            description="Configure level gates for each skill tier. Skill ID and tier are immutable on existing rows."
            columns={[
              "Skill",
              "Tier",
              "Name",
              "Required level",
              "Enabled",
              "Description",
            ]}
          >
            <SkillTierDefinitionEditor
              playerId={playerId}
              skills={config.data.skillDefinitions}
            />
            {config.data.skillTierDefinitions.map((row) => (
              <SkillTierDefinitionEditor
                key={row._id}
                playerId={playerId}
                row={row}
                skills={config.data.skillDefinitions}
              />
            ))}
          </AdminSection>

          <AdminSection
            title="Gathering activities"
            description="Edit timed gathering actions, item yields, XP rewards, and output items."
            columns={[
              "Activity ID",
              "Skill",
              "Tier",
              "Name",
              "Output item",
              "Yield",
              "Duration",
              "XP",
              "Enabled",
              "Description",
            ]}
          >
            <GatheringActivityEditor
              playerId={playerId}
              skills={config.data.skillDefinitions}
              items={config.data.items}
            />
            {config.data.gatheringActivities.map((row) => (
              <GatheringActivityEditor
                key={row._id}
                playerId={playerId}
                row={row}
                skills={config.data.skillDefinitions}
                items={config.data.items}
              />
            ))}
          </AdminSection>

          <AdminSection
            title="Recipes"
            description="Edit crafting recipes, inputs, outputs, XP, and output families."
            columns={[
              "Recipe ID",
              "Skill",
              "Tier",
              "Name",
              "Duration",
              "XP",
              "Output family",
              "Enabled",
              "Ingredients",
              "Outputs",
              "Description",
            ]}
          >
            <RecipeEditor
              playerId={playerId}
              skills={config.data.skillDefinitions}
              items={config.data.items}
              ingredients={[]}
              outputs={[]}
            />
            {config.data.recipes.map((row) => (
              <RecipeEditor
                key={row._id}
                playerId={playerId}
                row={row}
                skills={config.data.skillDefinitions}
                items={config.data.items}
                ingredients={config.data.recipeIngredients.filter(
                  (ingredient) => ingredient.recipeId === row.recipeId
                )}
                outputs={config.data.recipeOutputs.filter(
                  (output) => output.recipeId === row.recipeId
                )}
              />
            ))}
          </AdminSection>

          <AdminSection
            title="Augmentations"
            description="Edit equipment augmentation materials, catalysts, slot restrictions, and effects."
            columns={[
              "Augmentation ID",
              "Skill",
              "Tier",
              "Name",
              "Base family",
              "Slots",
              "Material",
              "Qty",
              "Catalyst",
              "Catalyst qty",
              "Effect type",
              "Effect stat",
              "Amount",
              "Enabled",
              "Description",
            ]}
          >
            <AugmentationDefinitionEditor
              playerId={playerId}
              skills={config.data.skillDefinitions}
              items={config.data.items}
            />
            {config.data.augmentationDefinitions.map((row) => (
              <AugmentationDefinitionEditor
                key={row._id}
                playerId={playerId}
                row={row}
                skills={config.data.skillDefinitions}
                items={config.data.items}
              />
            ))}
          </AdminSection>
        </TabsContent>

        <TabsContent
          value="general"
          keepMounted
          className="space-y-6 outline-none"
        >
          <AdminSection
            title="Global balance"
            description="Edit numeric modifiers, progression thresholds, and starting values as JSON."
            columns={["Value (JSON)", "Description"]}
          >
            {config.data.gameBalance.map((row) => (
              <BalanceEditor key={row._id} playerId={playerId} row={row} />
            ))}
          </AdminSection>

          <AdminSection
            title="Task definitions"
            description="Configure universal timed-task metadata, offline eligibility, prerequisites, and rewards."
            columns={[
              "Task ID",
              "Name",
              "Category",
              "Duration (ms)",
              "Offline",
              "Online only",
              "Enabled",
              "Prerequisites (JSON)",
              "Rewards (JSON)",
              "Description",
            ]}
          >
            <TaskDefinitionEditor playerId={playerId} />
            {config.data.taskDefinitions.map((row) => (
              <TaskDefinitionEditor key={row._id} playerId={playerId} row={row} />
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
            {config.data.upgrades.map((row) => (
              <UpgradeEditor key={row._id} playerId={playerId} row={row} />
            ))}
          </AdminSection>

          <AdminSection
            title="Hidden spots"
            description="Move discoverable rewards and change their linked upgrade or click radius."
            columns={["X (%)", "Y (%)", "Reward upgrade ID", "Radius (px)"]}
          >
            {config.data.hiddenSpots.map((row) => (
              <HiddenSpotEditor key={row._id} playerId={playerId} row={row} />
            ))}
          </AdminSection>

          <AdminSection
            title="Achievements"
            description="Edit achievement copy, icons, and condition identifiers."
            columns={["Name", "Icon", "Condition", "Description"]}
          >
            {config.data.achievements.map((row) => (
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
            {config.data.rebirthRewards.map((row) => (
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
            {config.data.gameEvents.map((row) => (
              <EventEditor key={row._id} playerId={playerId} row={row} />
            ))}
          </AdminSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}
