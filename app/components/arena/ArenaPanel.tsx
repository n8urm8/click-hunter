import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Progress } from "~/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { calculateCombatLevel } from "~/lib/statCalculations";
import { RankedPanel } from "~/components/arena/RankedPanel";
import { LoadoutPanel } from "~/components/arena/LoadoutPanel";
import { LobbyChat } from "~/components/arena/LobbyChat";
import {
  BattleViewer,
  DuelGearLists,
} from "~/components/arena/DuelPlayback";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  useArenaLobby,
  useCancelLobby,
  useCreateLobby,
  useForfeitFight,
  useJoinAsSpectator,
  useJoinLobbyAsFighter,
  useKickFromLobby,
  useLeaveLobby,
  useMyLobby,
  useOpenLobbies,
  usePvpConfig,
  useQuickMatch,
  useRecentArenaResults,
  useSetReady,
  useTickFight,
} from "~/hooks/useArena";
import { useTaskClock } from "~/hooks/useTaskClock";

type ArenaPlayer = {
  _id: Id<"players">;
  name: string;
  gold: number;
  level: number;
  str: number;
  dex: number;
  int: number;
  luk: number;
  con: number;
  wis?: number;
  agi?: number;
};

type MyLobbyData = NonNullable<ReturnType<typeof useMyLobby>["data"]>;
type OpenLobbyData = NonNullable<
  ReturnType<typeof useOpenLobbies>["data"]
>[number];
type LobbyData = MyLobbyData | NonNullable<ReturnType<typeof useArenaLobby>["data"]>;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const inputClassName =
  "w-full px-3 py-2 bg-forest-dark/50 border border-forest-light/40 rounded-lg text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/40";

function SectionError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-sm text-blood-light" role="alert">
      {message}
    </p>
  );
}

function endReasonLabel(reason: LobbyData["endReason"]) {
  switch (reason) {
    case "knockout":
      return "by knockout";
    case "rounds":
      return "on rounds";
    case "forfeit":
      return "by forfeit";
    case "draw":
      return "draw";
    default:
      return "";
  }
}

function winnerName(lobby: LobbyData): string | null {
  if (!lobby.winnerId) return null;
  if (lobby.winnerId === lobby.fighter1Id) return lobby.fighter1Name ?? null;
  return lobby.fighter2Name ?? null;
}

function FighterCard({
  name,
  level,
  stake,
  ready,
  hp,
  maxHp,
  isWinner,
  isCreator,
  onKick,
}: {
  name: string;
  level: number;
  stake: number;
  ready?: boolean;
  hp?: number;
  maxHp?: number;
  isWinner?: boolean;
  isCreator?: boolean;
  onKick?: () => void;
}) {
  const pct =
    hp !== undefined && maxHp !== undefined && maxHp > 0
      ? Math.max(0, Math.min(100, (hp / maxHp) * 100))
      : null;
  return (
    <div className="rounded bg-zinc-900 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium">
          {name}{" "}
          <span className="text-xs text-muted-foreground">Lv {level}</span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {isWinner && <Badge variant="secondary">Winner</Badge>}
          {isCreator && <Badge variant="secondary">Creator</Badge>}
          {ready !== undefined && (
            <Badge variant="secondary">{ready ? "Ready" : "Not ready"}</Badge>
          )}
          {onKick && (
            <Button size="xs" variant="outline" onClick={onKick}>
              Kick
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Stake: <span className="font-mono text-gold">{stake.toLocaleString()}g</span>
      </p>
      {pct !== null && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-foreground/70">Health</span>
            <span className="tabular-nums text-foreground">
              {Math.ceil(hp ?? 0)} / {Math.ceil(maxHp ?? 0)}
            </span>
          </div>
          <Progress value={pct} className="mt-1 h-2 hp-bar-monster" />
        </div>
      )}
    </div>
  );
}

function OpenCornerSlot({
  requiredStake,
  playerGold,
  locked,
  password,
  onPasswordChange,
  busy,
  onFight,
  showJoin,
}: {
  requiredStake: number;
  playerGold: number;
  locked: boolean;
  password: string;
  onPasswordChange: (value: string) => void;
  busy: boolean;
  onFight: () => void;
  showJoin: boolean;
}) {
  const canAfford = playerGold >= requiredStake;
  return (
    <div className="rounded bg-zinc-900 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Open corner — waiting for a fighter...
        </p>
        {showJoin && (
          <div className="flex flex-wrap items-center gap-2">
            {locked && (
              <input
                type="password"
                placeholder="Lobby password"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                className={inputClassName}
                aria-label="Lobby password"
              />
            )}
            <Button size="sm" disabled={busy || !canAfford} onClick={onFight}>
              Fight ({requiredStake.toLocaleString()}g)
            </Button>
          </div>
        )}
      </div>
      {showJoin && !canAfford && (
        <p className="mt-1 text-xs text-blood-light" role="alert">
          You need {(requiredStake - playerGold).toLocaleString()} more gold
          to match.
        </p>
      )}
    </div>
  );
}

function CopyLobbyLinkButton({ lobbyId }: { lobbyId: Id<"arenaLobbies"> }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={copied}
      onClick={() => {
        const url = `${window.location.origin}/arena?lobby=${lobbyId}`;
        const done = () => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        };
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(url).then(done, () => {
            setCopied(false);
          });
          return;
        }
        const textarea = document.createElement("textarea");
        textarea.value = url;
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand("copy");
          done();
        } catch {
          setCopied(false);
        }
        document.body.removeChild(textarea);
      }}
    >
      {copied ? "Copied!" : "Share"}
    </Button>
  );
}

function WaitingRoom({
  player,
  lobby,
  eligible,
  minStake,
  onExit,
}: {
  player: ArenaPlayer;
  lobby: LobbyData;
  eligible: boolean;
  minStake: number;
  onExit: () => void;
}) {
  const setReady = useSetReady();
  const kickFromLobby = useKickFromLobby();
  const cancelLobby = useCancelLobby();
  const leaveLobby = useLeaveLobby();
  const joinAsFighter = useJoinLobbyAsFighter();
  const joinAsSpectator = useJoinAsSpectator();
  const tickFight = useTickFight();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isFighter =
    lobby.fighter1Id === player._id || lobby.fighter2Id === player._id;
  const isCreator = lobby.creatorId === player._id;
  const isSpectating = lobby.spectators.some((s) => s.playerId === player._id);
  const myReady =
    lobby.fighter1Id === player._id
      ? (lobby.fighter1Ready ?? false)
      : lobby.fighter2Id === player._id
        ? (lobby.fighter2Ready ?? false)
        : false;
  // Symmetric stakes: taking a corner escrows the seated fighter's amount
  // (or the minimum when the room is empty).
  const requiredStake =
    lobby.fighter1Id !== undefined
      ? (lobby.fighter1Stake ?? 0)
      : lobby.fighter2Id !== undefined
        ? (lobby.fighter2Stake ?? 0)
        : minStake;
  const takeCorner = () =>
    run(() =>
      joinAsFighter({
        playerId: player._id,
        lobbyId: lobby._id,
        ...(lobby.locked ? { password } : {}),
      })
    );
  const countingDown = lobby.countdownEndsAt !== undefined;
  const clockMs = useTaskClock(countingDown, 500);
  const countdownSecs =
    lobby.countdownEndsAt !== undefined
      ? Math.max(0, Math.ceil((lobby.countdownEndsAt - clockMs) / 1000))
      : null;

  // Drive the server countdown: any viewer ticks it, and the server opens
  // the fight once the deadline passes with both fighters still ready.
  useEffect(() => {
    if (!countingDown) return;
    const timer = window.setInterval(() => {
      tickFight({ playerId: player._id, lobbyId: lobby._id }).catch(
        (e: unknown) => {
          setError(getErrorMessage(e));
        }
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countingDown, lobby._id, player._id, tickFight]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleKick = (targetPlayerId: Id<"players">) =>
    run(() => kickFromLobby({ playerId: player._id, lobbyId: lobby._id, targetPlayerId }));

  const pot =
    (lobby.fighter1Stake ?? 0) + (lobby.fighter2Stake ?? 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          {lobby.visibility === "private" ? "Private" : "General"} lobby ·{" "}
          {lobby.status}
          {lobby.locked && " · locked"}
        </h4>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="secondary">{pot.toLocaleString()}g pot</Badge>
          <CopyLobbyLinkButton lobbyId={lobby._id} />
        </div>
      </div>
      {countingDown && (
        <p className="mt-2 text-sm text-gold-light" role="status">
          Starting in {countdownSecs ?? "…"}s — unready to stop the clock.
        </p>
      )}
      <div className="mt-3 space-y-2">
        {lobby.fighter1Id ? (
          <FighterCard
            name={lobby.fighter1Name ?? "Unknown"}
            level={lobby.fighter1Level ?? 0}
            stake={lobby.fighter1Stake ?? 0}
            ready={lobby.fighter1Ready ?? false}
            isCreator={lobby.creatorId === lobby.fighter1Id}
            onKick={
              isCreator && lobby.fighter1Id !== player._id
                ? () => handleKick(lobby.fighter1Id as Id<"players">)
                : undefined
            }
          />
        ) : (
          <OpenCornerSlot
            requiredStake={requiredStake}
            playerGold={player.gold}
            locked={lobby.locked}
            password={password}
            onPasswordChange={setPassword}
            busy={busy}
            onFight={takeCorner}
            showJoin={!isFighter && eligible}
          />
        )}
        {lobby.fighter2Id ? (
          <FighterCard
            name={lobby.fighter2Name ?? "Unknown"}
            level={lobby.fighter2Level ?? 0}
            stake={lobby.fighter2Stake ?? 0}
            ready={lobby.fighter2Ready ?? false}
            isCreator={lobby.creatorId === lobby.fighter2Id}
            onKick={
              isCreator && lobby.fighter2Id !== player._id
                ? () => handleKick(lobby.fighter2Id as Id<"players">)
                : undefined
            }
          />
        ) : (
          <OpenCornerSlot
            requiredStake={requiredStake}
            playerGold={player.gold}
            locked={lobby.locked}
            password={password}
            onPasswordChange={setPassword}
            busy={busy}
            onFight={takeCorner}
            showJoin={!isFighter && eligible}
          />
        )}
      </div>

      {isFighter && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run(() =>
                setReady({
                  playerId: player._id,
                  lobbyId: lobby._id,
                  ready: !myReady,
                })
              )
            }
          >
            {myReady ? "Unready" : "Ready"}
          </Button>
          {isCreator && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await cancelLobby({
                    playerId: player._id,
                    lobbyId: lobby._id,
                  });
                  onExit();
                })
              }
            >
              Cancel (refund)
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await leaveLobby({
                  playerId: player._id,
                  lobbyId: lobby._id,
                });
                onExit();
              })
            }
          >
            Leave
          </Button>
        </div>
      )}
      {!isFighter && (
        <p className="mt-3 text-xs text-muted-foreground">
          {isCreator
            ? "You inherited this lobby — manage it, or take a corner yourself."
            : "Leaving hands the lobby to the next player in line; your stake is refunded."}
        </p>
      )}
      {!isFighter && !isCreator && (
        <div className="mt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await leaveLobby({
                  playerId: player._id,
                  lobbyId: lobby._id,
                });
                onExit();
              })
            }
          >
            {isSpectating ? "Stop spectating" : "Leave"}
          </Button>
        </div>
      )}
      {isCreator && !isFighter && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await leaveLobby({
                  playerId: player._id,
                  lobbyId: lobby._id,
                });
                onExit();
              })
            }
          >
            Leave (passes creator on)
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await cancelLobby({
                  playerId: player._id,
                  lobbyId: lobby._id,
                });
                onExit();
              })
            }
          >
            Cancel (refund)
          </Button>
        </div>
      )}

      {!isFighter && !isSpectating && (
        <div className="mt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(() =>
                joinAsSpectator({ playerId: player._id, lobbyId: lobby._id })
              )
            }
          >
            Spectate
          </Button>
        </div>
      )}

      {lobby.spectators.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-xs text-muted-foreground">
            Spectating ({lobby.spectatorCount})
          </p>
          {lobby.spectators.map((s) => (
            <div
              key={s.playerId}
              className="flex items-center justify-between gap-2 rounded bg-zinc-900 px-3 py-1.5 text-xs"
            >
              <span>
                {s.playerName}
                {lobby.creatorId === s.playerId && (
                  <span className="ml-1 text-gold">· Creator</span>
                )}
              </span>
              {isCreator && s.playerId !== player._id && (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => handleKick(s.playerId)}
                >
                  Kick
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3">
        <LobbyChat playerId={player._id} lobbyId={lobby._id} />
      </div>
      <SectionError message={error} />
    </div>
  );
}

function FightView({
  player,
  lobby,
  onExit,
}: {
  player: ArenaPlayer;
  lobby: LobbyData;
  onExit: () => void;
}) {
  const tickFight = useTickFight();
  const forfeitFight = useForfeitFight();
  const leaveLobby = useLeaveLobby();
  const [error, setError] = useState<string | null>(null);

  const isFighter =
    lobby.fighter1Id === player._id || lobby.fighter2Id === player._id;

  // Server-authoritative round clock: anyone viewing ticks the server, which
  // applies every due round and declares the result. The client only renders.
  useEffect(() => {
    if (lobby.status !== "active") return;
    const timer = window.setInterval(() => {
      tickFight({ playerId: player._id, lobbyId: lobby._id }).catch((e) => {
        setError(getErrorMessage(e));
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [lobby.status, lobby._id, player._id, tickFight]);

  const rounds = [...(lobby.recentRounds ?? [])].reverse().slice(0, 10);

  return (
    <div className="space-y-2">
      <BattleViewer
      nameA={lobby.fighter1Name ?? "Unknown"}
      levelA={lobby.fighter1Level ?? null}
      maxHpA={lobby.fighter1MaxHp}
      nameB={lobby.fighter2Name ?? "Unknown"}
      levelB={lobby.fighter2Level ?? null}
      maxHpB={lobby.fighter2MaxHp}
      rounds={(lobby.recentRounds ?? []).map((round) => ({
        damageAtoB: round.damage1to2,
        damageBtoA: round.damage2to1,
        hpA: round.fighter1Hp,
        hpB: round.fighter2Hp,
      }))}
      resetKey={`${lobby._id}:${lobby.startedAt ?? 0}`}
      title={
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">
            Round {lobby.round ?? 0}
            {lobby.maxRounds ? ` / ${lobby.maxRounds}` : ""} ·{" "}
            <span className="text-gold-light">fighting</span>
          </h4>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary">
              {((lobby.fighter1Stake ?? 0) + (lobby.fighter2Stake ?? 0)).toLocaleString()}g
              pot
            </Badge>
            <CopyLobbyLinkButton lobbyId={lobby._id} />
          </div>
        </div>
      }
      logList={
        rounds.length > 0 ? (
          <ul className="space-y-1" aria-label="Recent rounds">
            {rounds.map((round) => (
              <li
                key={round.round}
                className="flex items-center justify-between gap-2 rounded bg-zinc-900 px-3 py-1.5 text-xs"
              >
                <span className="text-muted-foreground">R{round.round}</span>
                <span className="tabular-nums">
                  {lobby.fighter1Name ?? "?"} −{round.damage2to1} ·{" "}
                  {lobby.fighter2Name ?? "?"} −{round.damage1to2}
                  {(round.crit1 || round.crit2) && (
                    <span className="ml-1 text-gold">crit</span>
                  )}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {round.fighter1Hp} / {round.fighter2Hp}
                </span>
              </li>
            ))}
          </ul>
        ) : undefined
      }
      actions={
        <div className="flex flex-wrap gap-2">
          {isFighter && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                forfeitFight({ playerId: player._id, lobbyId: lobby._id }).catch(
                  (e) => setError(getErrorMessage(e))
                )
              }
            >
              Forfeit
            </Button>
          )}
          {!isFighter && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await leaveLobby({
                    playerId: player._id,
                    lobbyId: lobby._id,
                  });
                  onExit();
                } catch (e) {
                  setError(getErrorMessage(e));
                }
              }}
            >
              Stop spectating
            </Button>
          )}
        </div>
      }
    />
    <DuelGearLists
      nameA={lobby.fighter1Name ?? "Unknown"}
      gearA={lobby.fighter1Gear ?? []}
      nameB={lobby.fighter2Name ?? "Unknown"}
      gearB={lobby.fighter2Gear ?? []}
    />
    <LobbyChat playerId={player._id} lobbyId={lobby._id} />
    <SectionError message={error} />
    </div>
  );
}

function ResultView({
  player,
  lobby,
  onExit,
}: {
  player: ArenaPlayer;
  lobby: LobbyData;
  onExit: () => void;
}) {
  const leaveLobby = useLeaveLobby();
  const [error, setError] = useState<string | null>(null);
  const name = winnerName(lobby);
  return (
    <div>
      <h4 className="text-sm font-semibold">
        {lobby.status === "completed" ? (
          <>
            {name ? `${name} wins ${endReasonLabel(lobby.endReason)}` : "Draw"}
          </>
        ) : (
          <>Lobby {lobby.status}</>
        )}
      </h4>
      <p className="mt-1 text-xs text-muted-foreground">
        {lobby.fighter1Name ?? "?"} ({(lobby.fighter1Stake ?? 0).toLocaleString()}g) vs{" "}
        {lobby.fighter2Name ?? "?"} (
        {(lobby.fighter2Stake ?? 0).toLocaleString()}g)
        {lobby.status === "completed" &&
          lobby.potPaid !== undefined &&
          lobby.potPaid > 0 &&
          ` · winner took ${lobby.potPaid.toLocaleString()}g (${(lobby.taxPaid ?? 0).toLocaleString()}g tax burned)`}
        {lobby.status === "completed" &&
          lobby.endReason === "draw" &&
          " · stakes refunded"}
        {lobby.round !== undefined && lobby.round > 0 && ` · ${lobby.round} rounds`}
      </p>
      <div className="mt-2">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await leaveLobby({ playerId: player._id, lobbyId: lobby._id });
            } catch (e) {
              setError(getErrorMessage(e));
            } finally {
              onExit();
            }
          }}
        >
          Back to lobbies
        </Button>
      </div>
      <SectionError message={error} />
    </div>
  );
}

function CreateLobbyForm({
  player,
  minStake,
  maxStake,
  disabled,
}: {
  player: ArenaPlayer;
  minStake: number;
  maxStake: number;
  disabled: boolean;
}) {
  const createLobby = useCreateLobby();
  const [visibility, setVisibility] = useState<"general" | "private">("general");
  const [stake, setStake] = useState("100");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold">Open a lobby</h4>
      <div className="space-y-2">
        <div className="flex gap-2" role="radiogroup" aria-label="Lobby type">
          {(["general", "private"] as const).map((option) => (
            <label key={option} className="combat-choice">
              <input
                type="radio"
                name="lobby-visibility"
                value={option}
                checked={visibility === option}
                onChange={() => setVisibility(option)}
                className="sr-only"
              />
              <span className="capitalize">{option}</span>
            </label>
          ))}
        </div>
        {visibility === "private" && (
          <input
            type="password"
            placeholder="Short password (1-16 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={16}
            className={inputClassName}
            aria-label="Lobby password"
          />
        )}
        <div className="flex gap-2">
          <input
            type="number"
            min={minStake}
            max={maxStake}
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            className={inputClassName}
            aria-label="Your stake in gold"
          />
          <Button
            disabled={busy || disabled}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await createLobby({
                  playerId: player._id,
                  visibility,
                  ...(visibility === "private" ? { password } : {}),
                  stake: Math.floor(Number(stake)),
                });
              } catch (e) {
                setError(getErrorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Opening..." : "Open lobby"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Your stake is escrowed now and refunded if nobody joins. Winner takes
          the pot minus tax.
        </p>
      </div>
      <SectionError message={error} />
    </div>
  );
}

function OpenLobbyRow({
  player,
  lobby,
  eligible,
  minStake,
  onView,
}: {
  player: ArenaPlayer;
  lobby: OpenLobbyData;
  eligible: boolean;
  minStake: number;
  onView: () => void;
}) {
  const joinAsFighter = useJoinLobbyAsFighter();
  const joinAsSpectator = useJoinAsSpectator();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Symmetric stakes: the Fight button matches the seated amount.
  const requiredStake =
    lobby.fighter1Id !== undefined
      ? (lobby.fighter1Stake ?? 0)
      : lobby.fighter2Id !== undefined
        ? (lobby.fighter2Stake ?? 0)
        : minStake;
  const canAfford = player.gold >= requiredStake;

  return (
    <div className="rounded bg-zinc-900 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {lobby.fighter1Name ?? lobby.fighter2Name ?? "Empty lobby"}{" "}
          <span className="text-xs text-muted-foreground">
            {lobby.fighter1Id
              ? `Lv ${lobby.fighter1Level ?? 0} · `
              : lobby.fighter2Id
                ? `Lv ${lobby.fighter2Level ?? 0} · `
                : ""}
            {requiredStake.toLocaleString()}g · {lobby.visibility}
            {lobby.locked ? " · locked" : ""}
          </span>
        </p>
        <div className="flex flex-none flex-wrap items-center gap-2">
          {eligible && lobby.locked && (
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-[90px] flex-none rounded-lg border border-forest-light/40 bg-forest-dark/50 px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-gold/40 focus:outline-none focus:ring-2 focus:ring-gold/50"
              aria-label="Lobby password"
            />
          )}
          {eligible && (
            <Button
              size="xs"
              disabled={busy || !canAfford}
              title={
                canAfford
                  ? `Match ${requiredStake.toLocaleString()}g`
                  : "Not enough gold to match"
              }
              onClick={() =>
                run(() =>
                  joinAsFighter({
                    playerId: player._id,
                    lobbyId: lobby._id,
                    ...(lobby.locked ? { password } : {}),
                  })
                )
              }
            >
              Fight ({requiredStake.toLocaleString()}g)
            </Button>
          )}
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(() =>
                joinAsSpectator({ playerId: player._id, lobbyId: lobby._id })
              )
            }
          >
            Spectate
          </Button>
          <Button size="xs" variant="outline" disabled={busy} onClick={onView}>
            View
          </Button>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {lobby.spectatorCount} watching
        </span>
      </div>
      <SectionError message={error} />
    </div>
  );
}

type ArenaTab = "staked" | "ranked" | "loadout" | "results";

export function ArenaPanel({ player }: { player: ArenaPlayer }) {
  const config = usePvpConfig();
  const myLobby = useMyLobby(player._id);
  const openLobbies = useOpenLobbies(player._id);
  const recentResults = useRecentArenaResults(player._id);
  const quickMatch = useQuickMatch();
  const [tab, setTab] = useState<ArenaTab>("staked");
  const [searchParams, setSearchParams] = useSearchParams();
  // Deep-linkable lobbies: /arena?lobby=<id> opens a room, so links pasted
  // in chat (rendered by ChatMessageContent) land directly on the fight.
  const [focusedLobbyId, setFocusedLobbyId] = useState<Id<"arenaLobbies"> | null>(
    () => {
      const param = searchParams.get("lobby");
      return param ? (param as Id<"arenaLobbies">) : null;
    }
  );
  const [settledLobbyId, setSettledLobbyId] =
    useState<Id<"arenaLobbies"> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // Matches the server's matchmaking level, which counts wisdom and agility.
  const combatLevel =
    calculateCombatLevel(
      player.str,
      player.dex,
      player.int,
      player.luk,
      player.con
    ) +
    (player.wis ?? 1) +
    (player.agi ?? 1);

  // Keep showing a settled lobby (result screen) after getMyLobby stops
  // returning it — completed lobbies belong to history, not to "mine".
  const liveLobbyId = focusedLobbyId ?? myLobby.data?._id ?? null;
  useEffect(() => {
    if (liveLobbyId) setSettledLobbyId(liveLobbyId);
  }, [liveLobbyId]);
  const focusedLobby = useArenaLobby(
    player._id,
    liveLobbyId ?? settledLobbyId
  );
  // A disabled ("skip") query keeps its last payload: only trust it while an
  // id is actually selected, otherwise Back/Leave appears to do nothing.
  const selectedLobbyId = liveLobbyId ?? settledLobbyId;
  const activeLobby: LobbyData | null | undefined = selectedLobbyId
    ? (focusedLobby.data ?? myLobby.data ?? null)
    : (myLobby.data ?? null);

  const clearFocus = () => {
    setFocusedLobbyId(null);
    setSettledLobbyId(null);
    setSearchParams({}, { replace: true });
    void myLobby.refetch();
    void openLobbies.refetch();
  };

  const focusLobby = (lobbyId: Id<"arenaLobbies">) => {
    setFocusedLobbyId(lobbyId);
    setSearchParams({ lobby: lobbyId }, { replace: true });
  };

  // A shared link pointing at a gone room: deleted/unknown ids resolve to
  // null, malformed ids fail argument validation (query error). A held seat
  // must not mask it — the fallback in activeLobby would hide the warning.
  const linkBroken =
    searchParams.get("lobby") !== null &&
    focusedLobbyId !== null &&
    !focusedLobby.isPending &&
    (focusedLobby.data == null || focusedLobby.isError) &&
    myLobby.data?._id !== focusedLobbyId;

  const minLevel = config.data?.minLevel ?? 50;
  const eligible = player.level >= minLevel;
  const busyLobby =
    myLobby.data?.status === "waiting" || myLobby.data?.status === "active";

  const openCount = openLobbies.data?.length ?? 0;

  return (
    <Card className="p-4 [--card-spacing:--spacing(2)]">
      <div>
        <h3 className="text-lg font-semibold">PvP Arena</h3>
        <p className="text-sm text-muted-foreground">
          {eligible
            ? `You are level ${player.level} — clear to fight.`
            : `Fighting requires character level ${minLevel} (you are level ${player.level}). Spectating is open to everyone.`}
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ArenaTab)}
        className="gap-0"
      >
        <TabsList variant="forest" aria-label="Arena sections" className="min-w-max">
          <TabsTrigger value="staked">Staked Battles</TabsTrigger>
          <TabsTrigger value="ranked">Ranked</TabsTrigger>
          <TabsTrigger value="loadout">Loadout</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "staked" && (
        <div className="space-y-2">
          {linkBroken && (
            <p
              className="rounded bg-zinc-900 px-3 py-2 text-sm text-blood-light"
              role="alert"
            >
              That lobby link is stale — the room closed or never existed.{" "}
              <button
                type="button"
                onClick={clearFocus}
                className="font-semibold text-gold-light underline hover:text-gold"
              >
                Browse open lobbies
              </button>
            </p>
          )}
          {activeLobby && activeLobby.status === "waiting" && (
            <WaitingRoom
              player={player}
              lobby={activeLobby}
              eligible={eligible}
              minStake={config.data?.minStake ?? 0}
              onExit={clearFocus}
            />
          )}
          {activeLobby && activeLobby.status === "active" && (
            <FightView player={player} lobby={activeLobby} onExit={clearFocus} />
          )}
          {activeLobby &&
            (activeLobby.status === "completed" ||
              activeLobby.status === "cancelled" ||
              activeLobby.status === "expired") && (
              <ResultView
                player={player}
                lobby={activeLobby}
                onExit={clearFocus}
              />
            )}
          <div>
            {eligible && !busyLobby && (
              <div className="mb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={async () => {
                      setActionError(null);
                      try {
                        await quickMatch({ playerId: player._id });
                      } catch (e) {
                        setActionError(getErrorMessage(e));
                      }
                    }}
                  >
                    Quick match
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowCreate((open) => !open)}
                    aria-expanded={showCreate}
                  >
                    {showCreate ? "Hide create" : "Create lobby"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Combat level {combatLevel} · joins the closest general
                    lobby at its stake, or opens a{" "}
                    {(config.data?.minStake ?? 0).toLocaleString()}g lobby.
                  </p>
                </div>
                <SectionError message={actionError} />
                {showCreate && (
                  <div className="mt-3 rounded bg-zinc-900 px-3 py-3">
                    <CreateLobbyForm
                      player={player}
                      minStake={config.data?.minStake ?? 0}
                      maxStake={config.data?.maxStake ?? 1000000}
                      disabled={false}
                    />
                  </div>
                )}
              </div>
            )}
            <h4 className="mb-2 text-sm font-semibold">
              Open lobbies ({openCount})
            </h4>
            {openLobbies.isPending ? (
              <p className="text-sm text-muted-foreground">Loading lobbies...</p>
            ) : openCount === 0 && !activeLobby ? (
              <p className="text-sm text-muted-foreground">
                No open lobbies. Create one or hit quick match.
              </p>
            ) : (
              <div className="space-y-2">
                {openLobbies.data
                  ?.filter((lobby) => lobby._id !== activeLobby?._id)
                  .map((lobby) => (
                    <OpenLobbyRow
                      key={lobby._id}
                      player={player}
                      lobby={lobby}
                      eligible={eligible && !busyLobby}
                      minStake={config.data?.minStake ?? 0}
                      onView={() => focusLobby(lobby._id)}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "ranked" && (
        <div>
          <RankedPanel player={player} />
        </div>
      )}

      {tab === "loadout" && (
        <div>
          <LoadoutPanel playerId={player._id} />
        </div>
      )}

      {tab === "results" && (
        <div>
          {(recentResults.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No fights settled yet.</p>
          ) : (
            <div className="space-y-2">
              {recentResults.data?.map((result) => (
                <div
                  key={result._id}
                  className="flex items-center justify-between gap-2 rounded bg-zinc-900 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {winnerName(result) ?? "Draw"}{" "}
                    <span className="text-xs text-muted-foreground">
                      {result.fighter1Name} vs {result.fighter2Name ?? "?"} ·{" "}
                      {endReasonLabel(result.endReason)}
                      {result.round ? ` · R${result.round}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {result.potPaid !== undefined && result.potPaid > 0 && (
                      <span className="font-mono text-xs text-gold">
                        +{result.potPaid.toLocaleString()}g
                      </span>
                    )}
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        focusLobby(result._id);
                        setTab("staked");
                      }}
                    >
                      View
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
