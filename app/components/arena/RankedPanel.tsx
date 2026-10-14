import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  useFightRankedBattle,
  useJoinRankedLeague,
  useLastRankedSeason,
  useMyRankedBattles,
  useRankedConfig,
  useRankedLeaderboard,
  useRankedOpponents,
  useRankedStatus,
} from "~/hooks/useRanked";

type RankedPlayer = {
  _id: Id<"players">;
  name: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function SectionError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-sm text-blood-light" role="alert">
      {message}
    </p>
  );
}

const WEEK_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;

/** Next Monday 00:00 UTC — the weekly reset the settlement cron runs on. */
function nextWeeklyResetMs(now: number): number {
  const daysSinceMonday = (new Date(now).getUTCDay() + 6) % 7;
  const thisMonday = now - (now % DAY_MS) - daysSinceMonday * DAY_MS;
  return thisMonday + WEEK_MS;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function ResetCountdown() {
  const clockMs = useTaskClock(true, 1000);
  return (
    <>Resets in {formatCountdown(nextWeeklyResetMs(clockMs) - clockMs)}</>
  );
}

import {
  BattleViewer,
  DuelGearLists,
  type DuelGearPiece,
  type PlaybackRound,
} from "~/components/arena/DuelPlayback";
import { useTaskClock } from "~/hooks/useTaskClock";

type RankedBout = {
  attackerName: string;
  defenderName: string;
  maxHpA: number;
  maxHpB: number;
  attackerGear: DuelGearPiece[];
  defenderGear: DuelGearPiece[];
  log: PlaybackRound[];
  won: boolean;
  draw: boolean;
  rounds: number;
  pointSwing: number;
  foughtAt: number;
};

export function RankedPanel({ player }: { player: RankedPlayer }) {
  const config = useRankedConfig();
  const status = useRankedStatus(player._id);
  const opponents = useRankedOpponents(player._id);
  const leaderboard = useRankedLeaderboard();
  const battles = useMyRankedBattles(player._id);
  const lastSeason = useLastRankedSeason();
  const joinLeague = useJoinRankedLeague();
  const fightBattle = useFightRankedBattle();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastBout, setLastBout] = useState<RankedBout | null>(null);
  const [boutDone, setBoutDone] = useState(false);

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

  const member = status.data?.member === true ? status.data : null;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-2 text-sm font-semibold">League standing</h4>
        {status.isPending ? (
          <p className="text-sm text-muted-foreground">Loading standing...</p>
        ) : member ? (
          <div className="rounded bg-zinc-900 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {member.points.toLocaleString()} pts · Rank #
                {member.rank} of {member.totalFighters}
              </p>
              <Badge variant="secondary">
                {member.wins}W · {member.losses}L · {member.draws}D
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-xs text-muted-foreground">
                {member.battlesLeft} of {member.battlesPerDay}{" "}
                battles left today · <ResetCountdown />
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded bg-zinc-900 px-3 py-3">
            <p className="text-sm text-muted-foreground">
              {status.data?.eligible === true
                ? `Combat level ${status.data.combatLevel} — clear to enter at 1000 points. No stakes, no spectators: battles resolve instantly, even while your opponent is offline.`
                : `Ranked needs combat level ${status.data?.minCombat ?? 50} (stats only, no skills). Yours is ${status.data?.combatLevel ?? "?"}.`}
            </p>
            {status.data?.eligible === true && (
              <Button
                size="sm"
                className="mt-2"
                disabled={busy}
                onClick={() =>
                  run(() => joinLeague({ playerId: player._id }))
                }
              >
                Join the league
              </Button>
            )}
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Leaderboard</h4>
        {(leaderboard.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            Empty ladder — join and take the crown.
          </p>
        ) : (
          <div className="space-y-1">
            {leaderboard.data?.map((entry) => (
              <div
                key={entry.playerId}
                className="flex items-center justify-between gap-2 rounded bg-zinc-900 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate">
                  <span className="mr-2 tabular-nums text-muted-foreground">
                    #{entry.rank}
                  </span>
                  {entry.playerName}
                  {entry.playerId === player._id && (
                    <span className="ml-1 text-xs text-gold">· you</span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-xs text-gold">
                  {entry.points.toLocaleString()} pts
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {member && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">
            Opponents near you ({opponents.data?.length ?? 0})
          </h4>
          {lastBout && !boutDone ? (
            <div className="space-y-2">
              <BattleViewer
                key={lastBout.foughtAt}
                nameA={lastBout.attackerName}
                levelA={null}
                maxHpA={lastBout.maxHpA}
                nameB={lastBout.defenderName}
                levelB={null}
                maxHpB={lastBout.maxHpB}
                rounds={lastBout.log}
                autoplay
                resetKey={lastBout.foughtAt}
                onDone={() => setBoutDone(true)}
              />
              <DuelGearLists
                nameA={lastBout.attackerName}
                gearA={lastBout.attackerGear}
                nameB={lastBout.defenderName}
                gearB={lastBout.defenderGear}
              />
            </div>
          ) : (
            <>
              {opponents.isPending ? (
                <p className="text-sm text-muted-foreground">
                  Scouting the ladder...
                </p>
              ) : (opponents.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No challengers yet — be the first rivalry.
                </p>
              ) : (
                <div className="space-y-2">
                  {opponents.data?.map((opponent) => (
                    <div
                      key={opponent.playerId}
                      className="rounded bg-zinc-900 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium">
                          {opponent.playerName}{" "}
                          <span className="text-xs text-muted-foreground">
                            {opponent.points.toLocaleString()} pts ·{" "}
                            {opponent.wins}W/{opponent.losses}L
                            {opponent.combatLevel !== null &&
                              ` · combat ${opponent.combatLevel}`}
                          </span>
                        </p>
                        <div className="flex flex-none flex-wrap items-center gap-2">
                          <span className="text-xs tabular-nums">
                            <span className="text-forest-glow">
                              +{opponent.winGain}
                            </span>
                            {" / "}
                            <span className="text-blood-light">
                              −{opponent.lossCost}
                            </span>
                          </span>
                          <Button
                            size="xs"
                            disabled={busy || member.battlesLeft <= 0}
                            onClick={() =>
                              run(async () => {
                                const result = await fightBattle({
                                  playerId: player._id,
                                  defenderId: opponent.playerId,
                                });
                                setBoutDone(false);
                                setLastBout({
                                  attackerName: player.name,
                                  defenderName: opponent.playerName,
                                  maxHpA: result.attackerMaxHp,
                                  maxHpB: result.defenderMaxHp,
                                  attackerGear: result.attackerGear,
                                  defenderGear: result.defenderGear,
                                  log: result.log.map((round) => ({
                                    damageAtoB:
                                      round.damageAttackerToDefender,
                                    damageBtoA:
                                      round.damageDefenderToAttacker,
                                    hpA: round.attackerHp,
                                    hpB: round.defenderHp,
                                  })),
                                  won: result.won,
                                  draw: result.draw,
                                  rounds: result.rounds,
                                  pointSwing: result.pointSwing,
                                  foughtAt: Date.now(),
                                });
                              })
                            }
                          >
                            Fight
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {lastBout && boutDone && (
                <>
                  <p
                    className="mt-2 text-sm text-gold-light"
                    role="status"
                    aria-live="polite"
                  >
                    {lastBout.draw
                      ? `Draw with ${lastBout.defenderName} in ${lastBout.rounds} rounds — no points move.`
                      : lastBout.won
                        ? `You beat ${lastBout.defenderName} in ${lastBout.rounds} rounds (+${lastBout.pointSwing}).`
                        : `${lastBout.defenderName} beat you in ${lastBout.rounds} rounds (${lastBout.pointSwing}).`}
                  </p>
                  <div className="mt-2">
                    <DuelGearLists
                      nameA={lastBout.attackerName}
                      gearA={lastBout.attackerGear}
                      nameB={lastBout.defenderName}
                      gearB={lastBout.defenderGear}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {member && (battles.data?.length ?? 0) > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Your recent battles</h4>
          <div className="space-y-1">
            {battles.data?.map((battle) => {
              const mine =
                battle.attackerId === player._id
                  ? {
                      foe:
                        battle.defenderName,
                      won: battle.attackerWon,
                      swing: battle.pointSwing,
                    }
                  : {
                      foe: battle.attackerName,
                      won: !battle.attackerWon && !battle.draw,
                      swing: -battle.pointSwing,
                    };
              return (
                <div
                  key={battle._id}
                  className="flex items-center justify-between gap-2 rounded bg-zinc-900 px-3 py-1.5 text-xs"
                >
                  <span className="min-w-0 truncate">
                    {battle.draw ? "Draw" : mine.won ? "Win" : "Loss"} vs{" "}
                    {mine.foe} · R{battle.rounds}
                  </span>
                  <span
                    className={`shrink-0 tabular-nums ${battle.draw ? "text-muted-foreground" : mine.swing >= 0 ? "text-forest-glow" : "text-blood-light"}`}
                  >
                    {battle.draw
                      ? "±0"
                      : `${mine.swing >= 0 ? "+" : ""}${mine.swing}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lastSeason.data && lastSeason.data.standings.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Last week&apos;s payout</h4>
          <div className="space-y-1">
            {lastSeason.data.standings.slice(0, 5).map((standing) => (
              <div
                key={standing.playerId}
                className="flex items-center justify-between gap-2 rounded bg-zinc-900 px-3 py-1.5 text-xs"
              >
                <span className="min-w-0 truncate">
                  <span className="mr-2 tabular-nums text-muted-foreground">
                    #{standing.placement}
                  </span>
                  {standing.playerName} ·{" "}
                  {standing.points.toLocaleString()} pts
                </span>
                <span className="shrink-0 font-mono text-gold">
                  +{standing.rewardGold.toLocaleString()}g
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Top 10 each week earn gold, then everyone returns to{" "}
        {config.data?.startPoints ?? 1000} points every Monday.
      </p>
      <SectionError message={error} />
    </div>
  );
}
