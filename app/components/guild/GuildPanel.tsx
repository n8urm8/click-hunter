import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Progress } from "~/components/ui/progress";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import type { Id } from "../../../convex/_generated/dataModel";
import { guildPath, type GuildView } from "~/lib/gameRoutes";
import {
  useAcceptApplication,
  useAcceptInvite,
  useApplyToGuild,
  useBeginRaid,
  useClaimObjectiveReward,
  useCreateGuild,
  useCreateRaidParty,
  useDeclineApplication,
  useDepositGold,
  useDonateBuildingMaterial,
  useDemoteMember,
  useDisbandGuild,
  useGuildBuildings,
  useGuildConfig,
  useGuildLeaderboard,
  useGuildMembers,
  useGuildRaids,
  useGuildSearch,
  useGuildStash,
  useJoinRaid,
  useKickMember,
  useLeaveGuild,
  useMyGuild,
  usePendingApplications,
  usePromoteMember,
  useRaidLeaderboard,
  useRaidStatus,
  useStartRaid,
  useTickRaid,
  useUpgradeGuildBuilding,
  useWeeklyObjectives,
  useWithdrawFromGuildStash,
  useWithdrawGold,
} from "~/hooks/useGuild";

type GuildPlayer = {
  _id: Id<"players">;
  name: string;
  gold: number;
  level: number;
};

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

function HallView({ player }: { player: GuildPlayer }) {
  const myGuild = useMyGuild(player._id);
  const raids = useGuildRaids(player._id);
  const leaveGuild = useLeaveGuild();
  const disbandGuild = useDisbandGuild();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (myGuild.isPending) {
    return <p className="text-sm text-muted-foreground">Loading guild...</p>;
  }
  if (myGuild.isError || !myGuild.data) {
    return (
      <Card className="p-4">
        <p className="text-sm text-blood-light" role="alert">
          Unable to load your guild.
        </p>
      </Card>
    );
  }
  const { guild, membership, bonus, memberCount } = myGuild.data;
  const activeRaids =
    raids.data?.filter((r) => r.status === "forming" || r.status === "active") ??
    [];

  const handleLeave = async () => {
    setBusy(true);
    setError(null);
    try {
      await leaveGuild({ playerId: player._id });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDisband = async () => {
    if (!window.confirm(`Disband ${guild.name}? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await disbandGuild({ playerId: player._id });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">
              {guild.name} <span className="text-gold">[{guild.tag}]</span>
            </h3>
            <p className="text-sm text-muted-foreground">
              {guild.description || "No description."}
            </p>
          </div>
          <Badge variant="secondary">
            Lv {guild.level} · {memberCount} members
          </Badge>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded bg-zinc-900 px-2 py-2">
            <p className="text-xs text-muted-foreground">Gold bonus</p>
            <p className="font-mono text-sm text-gold">+{bonus.goldBonusPercent}%</p>
          </div>
          <div className="rounded bg-zinc-900 px-2 py-2">
            <p className="text-xs text-muted-foreground">XP bonus</p>
            <p className="font-mono text-sm text-blue-400">+{bonus.xpBonusPercent}%</p>
          </div>
          <div className="rounded bg-zinc-900 px-2 py-2">
            <p className="text-xs text-muted-foreground">Stat bonus</p>
            <p className="font-mono text-sm text-green-400">+{bonus.statBonusPercent}%</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Your role: {membership.role} · Bank: {guild.gold.toLocaleString()}g ·
          Guild XP: {guild.xp.toLocaleString()}
        </p>
      </Card>

      <Card className="p-4">
        <h4 className="mb-2 text-sm font-semibold">Active raids ({activeRaids.length})</h4>
        {activeRaids.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No raids running. Start one from the Raids tab.
          </p>
        ) : (
          <div className="space-y-2">
            {activeRaids.map((raid) => (
              <div
                key={raid._id}
                className="flex items-center justify-between rounded bg-zinc-900 px-3 py-2"
              >
                <span className="text-sm">
                  Tier {raid.tier} · {raid.status} ·{" "}
                  {raid.participants.length} hunters
                </span>
                <Link
                  to={guildPath("raids")}
                  className="text-sm text-gold-light hover:underline"
                >
                  View
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h4 className="mb-2 text-sm font-semibold">Danger zone</h4>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={handleLeave}>
            Leave guild
          </Button>
          {membership.role === "master" && (
            <Button variant="outline" disabled={busy} onClick={handleDisband}>
              Disband guild
            </Button>
          )}
        </div>
        <SectionError message={error} />
      </Card>
    </div>
  );
}

function RosterView({ player }: { player: GuildPlayer }) {
  const myGuild = useMyGuild(player._id);
  const guildId = myGuild.data?.guild._id ?? null;
  const members = useGuildMembers(player._id, guildId);
  const incoming = usePendingApplications(player._id, guildId);
  const acceptApplication = useAcceptApplication();
  const declineApplication = useDeclineApplication();
  const kickMember = useKickMember();
  const promoteMember = usePromoteMember();
  const demoteMember = useDemoteMember();
  const [error, setError] = useState<string | null>(null);

  const myRole = myGuild.data?.membership.role;
  const canManage = myRole === "master" || myRole === "officer";

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h4 className="mb-2 text-sm font-semibold">Members</h4>
        {members.isPending ? (
          <p className="text-sm text-muted-foreground">Loading roster...</p>
        ) : (
          <div className="space-y-2">
            {members.data?.map((member) => (
              <div
                key={member._id}
                className="flex items-center justify-between gap-2 rounded bg-zinc-900 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{member.playerName}</p>
                  <p className="text-xs text-muted-foreground">
                    {member.role} · {member.contributionXp.toLocaleString()} XP
                    donated
                  </p>
                </div>
                {canManage && member.playerId !== player._id && (
                  <div className="flex shrink-0 gap-1">
                    {myRole === "master" && (
                      <>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            run(() =>
                              promoteMember({
                                playerId: player._id,
                                targetPlayerId: member.playerId,
                              })
                            )
                          }
                        >
                          Promote
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            run(() =>
                              demoteMember({
                                playerId: player._id,
                                targetPlayerId: member.playerId,
                              })
                            )
                          }
                        >
                          Demote
                        </Button>
                      </>
                    )}
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        run(() =>
                          kickMember({
                            playerId: player._id,
                            targetPlayerId: member.playerId,
                          })
                        )
                      }
                    >
                      Kick
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {canManage && (
        <Card className="p-4">
          <h4 className="mb-2 text-sm font-semibold">Applications</h4>
          {incoming.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No pending applications. Recruits apply from Browse.
            </p>
          )}
          <div className="space-y-2">
            {incoming.data?.map((app) => {
              if (!("playerName" in app)) return null;
              return (
              <div
                key={app._id}
                className="flex items-center justify-between gap-2 rounded bg-zinc-900 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{app.playerName}</p>
                  {app.message && (
                    <p className="truncate text-xs text-muted-foreground">
                      {app.message}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="xs"
                    onClick={() =>
                      run(() =>
                        acceptApplication({
                          playerId: player._id,
                          applicationId: app._id,
                        })
                      )
                    }
                  >
                    Accept
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      run(() =>
                        declineApplication({
                          playerId: player._id,
                          applicationId: app._id,
                        })
                      )
                    }
                  >
                    Decline
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        </Card>
      )}
      <SectionError message={error} />
    </div>
  );
}

function BankView({ player }: { player: GuildPlayer }) {
  const myGuild = useMyGuild(player._id);
  const guildConfig = useGuildConfig();
  const depositGold = useDepositGold();
  const withdrawGold = useWithdrawGold();
  const [amount, setAmount] = useState("100");
  const [error, setError] = useState<string | null>(null);

  const guild = myGuild.data?.guild;
  const role = myGuild.data?.membership.role;
  const canWithdraw = role === "master" || role === "officer";

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h4 className="mb-1 text-sm font-semibold">Guild bank</h4>
        <p className="font-mono text-2xl text-gold">
          {(guild?.gold ?? 0).toLocaleString()}g
        </p>
        <p className="text-xs text-muted-foreground">
          Your gold: {player.gold.toLocaleString()}g
        </p>
      </Card>
      <Card className="p-4">
        <h4 className="mb-2 text-sm font-semibold">Deposit / withdraw</h4>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClassName}
            aria-label="Gold amount"
          />
          <Button
            onClick={() =>
              run(() =>
                depositGold({ playerId: player._id, amount: Number(amount) })
              )
            }
          >
            Deposit
          </Button>
          {canWithdraw && (
            <Button
              variant="outline"
              onClick={() =>
                run(() =>
                  withdrawGold({ playerId: player._id, amount: Number(amount) })
                )
              }
            >
              Withdraw
            </Button>
          )}
        </div>
      </Card>
      <Card className="p-4">
        <h4 className="mb-2 text-sm font-semibold">Guild XP</h4>
        <p className="text-sm text-muted-foreground">
          Guilds earn {guildConfig.data?.activityXpPercent ?? 1}% of every
          member&apos;s combat and skilling XP as bonus guild XP — your own
          gains are never reduced. Higher guild levels unlock member bonuses.
        </p>
      </Card>
      <SectionError message={error} />
    </div>
  );
}

function BuildingsView({ player }: { player: GuildPlayer }) {
  const buildings = useGuildBuildings(player._id);
  const donate = useDonateBuildingMaterial();
  const upgrade = useUpgradeGuildBuilding();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (buildings.isPending) {
    return <p className="text-sm text-muted-foreground">Loading buildings...</p>;
  }
  if (buildings.isError || !buildings.data) {
    return (
      <Card className="p-4">
        <p className="text-sm text-blood-light" role="alert">
          Unable to load guild buildings.
        </p>
      </Card>
    );
  }
  const { canUpgrade } = buildings.data;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h4 className="mb-1 text-sm font-semibold">Guild buildings</h4>
        <p className="text-sm text-muted-foreground">
          Permanent upgrades every member shares. Raid kills drop Dragon Scales
          into the guild stash; members donate crafted goods.
 Officers spend the stash to raise a building.
        </p>
      </Card>
      <SectionError message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        {buildings.data.buildings.map((building) => (
          <Card key={building.buildingId} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h5 className="font-semibold">{building.name}</h5>
                <p className="text-xs text-muted-foreground">{building.description}</p>
              </div>
              <Badge variant="secondary">
                Lv {building.level}/{building.maxLevel}
              </Badge>
            </div>
            <p className="mt-2 text-sm">
              {building.bonus ? (
                <span className="font-mono text-green-400">{building.bonus}</span>
              ) : (
                <span className="text-muted-foreground">No bonus yet</span>
              )}
              {building.nextBonus && (
                <span className="text-muted-foreground"> → {building.nextBonus}</span>
              )}
            </p>
            {building.cost.length > 0 && (
              <ul className="mt-2 space-y-1">
                {building.cost.map((row) => {
                  const missing = Math.max(0, row.needed - row.inStash);
                  const give = Math.min(missing, row.inInventory);
                  const key = `${building.buildingId}:${row.itemSlug}`;
                  return (
                    <li key={row.itemSlug} className="flex items-center justify-between gap-2 text-xs">
                      <span>
                        {row.itemName}{" "}
                        <span className={row.inStash >= row.needed ? "font-mono text-green-400" : "font-mono text-muted-foreground"}>
                          {row.inStash}/{row.needed}
                        </span>
                        {!row.donatable && (
                          <span className="text-muted-foreground"> · from raids</span>
                        )}
                      </span>
                      {row.donatable && give > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() =>
                            run(key, () =>
                              donate({ playerId: player._id, itemSlug: row.itemSlug, quantity: give })
                            )
                          }
                        >
                          {busy === key ? "Donating..." : `Donate ${give}`}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {canUpgrade && building.level < building.maxLevel && (
              <Button
                className="mt-3 w-full"
                disabled={!building.affordable || busy !== null}
                onClick={() =>
                  run(building.buildingId, () =>
                    upgrade({ playerId: player._id, buildingId: building.buildingId })
                  )
                }
              >
                {busy === building.buildingId ? "Building..." : `Upgrade to Lv ${building.level + 1}`}
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function RaidsView({ player }: { player: GuildPlayer }) {
  const raids = useGuildRaids(player._id);
  const raidStatus = useRaidStatus(player._id);
  const raidBoard = useRaidLeaderboard(player._id);
  const stash = useGuildStash(player._id);
  const startRaid = useStartRaid();
  const createParty = useCreateRaidParty();
  const joinRaid = useJoinRaid();
  const beginRaid = useBeginRaid();
  const tickRaid = useTickRaid();
  const withdrawStash = useWithdrawFromGuildStash();
  const [tier, setTier] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(getErrorMessage(e));
      return null;
    }
  };

  // Automatic combat: the server simulates every due round per tick and there
  // is no manual battling. To keep four guildmates from all writing the same
  // lobby, one member drives it (lowest player id in the party); the others
  // take over if that leader stalls, and the server's not-due guard makes any
  // stray tick cheap.
  const raidsRef = useRef(raids.data ?? []);
  raidsRef.current = raids.data ?? [];
  useEffect(() => {
    const timer = window.setInterval(() => {
      const at = Date.now();
      for (const raid of raidsRef.current) {
        if (raid.status !== "active") continue;
        const interval = raid.roundIntervalMs ?? 2000;
        const last = raid.lastTickAt ?? raid.startedAt ?? 0;
        if (at - last < interval) continue;
        const ids = raid.participants.map((p) => p.playerId as string);
        const leader = ids.length > 0 ? [...ids].sort()[0] : null;
        const abandoned = at - last > interval * 3;
        if (leader !== player._id && !abandoned) continue;
        void tickRaid({ playerId: player._id, raidId: raid._id }).catch(
          () => {}
        );
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [player._id, tickRaid]);

  return (
    <div className="space-y-4">
      {!raidStatus.isPending && raidStatus.data && !raidStatus.data.isSaturday && (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">
            Raid dragons unlock on Saturday (UTC). Lobbies reset to tier 1
            each week — climb as high as your guild can.
          </p>
        </Card>
      )}
      <Card className="p-4">
        <h4 className="mb-2 text-sm font-semibold">
          Summon a dragon (officers) · open a party (any member)
        </h4>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className={inputClassName}
            aria-label="Boss tier"
          />
          <Button
            onClick={() =>
              run(() => startRaid({ playerId: player._id, tier: Number(tier) }))
            }
          >
            Summon
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              run(() =>
                createParty({ playerId: player._id, tier: Number(tier) })
              )
            }
          >
            Party
          </Button>
        </div>
        {!raidStatus.isPending && raidStatus.data?.summonCost !== undefined && raidStatus.data.summonCost > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Summoning costs {raidStatus.data.summonCost.toLocaleString()} guild
            gold.
          </p>
        )}
      </Card>

      {raids.isPending ? (
        <p className="text-sm text-muted-foreground">Loading raids...</p>
      ) : (
        <div className="space-y-3">
          {raids.data?.map((raid) => (
            <Card key={raid._id} className="p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">
                  Tier {raid.tier} · {raid.status}
                </h4>
                <Badge variant="secondary">
                  {Math.ceil(raid.bossHp).toLocaleString()} /{" "}
                  {raid.bossMaxHp.toLocaleString()} HP
                </Badge>
              </div>
              <Progress
                value={
                  raid.bossMaxHp > 0
                    ? ((raid.bossMaxHp - raid.bossHp) / raid.bossMaxHp) * 100
                    : 0
                }
                className="mt-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {raid.participants.length}/4 hunters · boss-tier XP for every
                damager · kill loot to the guild stash
                {raid.status === "superseded" &&
                  " · already slain by another party — stand down"}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {raid.status === "forming" && (
                  <>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        run(() => joinRaid({ playerId: player._id, raidId: raid._id }))
                      }
                    >
                      Join
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        run(() => beginRaid({ playerId: player._id, raidId: raid._id }))
                      }
                    >
                      Begin
                    </Button>
                  </>
                )}
                {raid.status === "active" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Fighting automatically — round {raid.raidRound ?? 0}.
                  </p>
                )}
              </div>
              <div className="mt-2 space-y-1">
                {raid.participants.map((p) => (
                  <p key={p.playerId} className="text-xs text-muted-foreground">
                    {p.playerName} — {p.damageDealt.toLocaleString()} damage
                    {p.maxHp !== undefined &&
                      ` · ${Math.max(0, Math.ceil(p.hp ?? 0)).toLocaleString()} / ${Math.ceil(p.maxHp).toLocaleString()} HP`}
                    {p.alive === false && " · down"}
                  </p>
                ))}
              </div>
            </Card>
          ))}
          {raids.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No raids yet.</p>
          )}
        </div>
      )}
      <Card className="p-4">
        <h4 className="mb-2 text-sm font-semibold">Guild stash (kill loot)</h4>
        {stash.isPending ? (
          <p className="text-sm text-muted-foreground">Loading stash...</p>
        ) : stash.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Empty — slay a raid dragon to fill it.
          </p>
        ) : (
          <div className="space-y-1">
            {stash.data?.map((row) => (
              <div
                key={row._id}
                className="flex items-center justify-between gap-2"
              >
                <p className="text-xs text-muted-foreground">
                  {row.itemName} × {row.quantity.toLocaleString()}
                </p>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    run(() =>
                      withdrawStash({
                        playerId: player._id,
                        stashId: row._id,
                        quantity: row.quantity,
                      })
                    )
                  }
                >
                  Withdraw
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card className="p-4">
        <h4 className="mb-2 text-sm font-semibold">
          Raid leaderboard (highest tier + damage)
        </h4>
        {raidBoard.isPending ? (
          <p className="text-sm text-muted-foreground">Loading board...</p>
        ) : raidBoard.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No raids this week yet.
          </p>
        ) : (
          <div className="space-y-1">
            {raidBoard.data?.map((entry, i) => (
              <p key={entry.guildId} className="text-xs text-muted-foreground">
                #{i + 1} [{entry.guildTag}] {entry.guildName} — tier{" "}
                {entry.highestTierKilled} ·{" "}
                {entry.totalDamage.toLocaleString()} damage
              </p>
            ))}
          </div>
        )}
      </Card>
      <SectionError message={error} />
    </div>
  );
}

function ObjectivesView({ player }: { player: GuildPlayer }) {
  const objectives = useWeeklyObjectives(player._id);
  const claimReward = useClaimObjectiveReward();
  const [error, setError] = useState<string | null>(null);

  if (objectives.isPending) {
    return <p className="text-sm text-muted-foreground">Loading objectives...</p>;
  }
  if (!objectives.data) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Join a guild to see objectives.</p>
      </Card>
    );
  }
  const rows = objectives.data.objectives;
  const isPreview = objectives.data.preview === true;

  return (
    <div className="space-y-3">
      {isPreview && (
        <p className="text-xs text-muted-foreground">
          Preview for this week — progress starts tracking on your next fight.
        </p>
      )}
      {rows.map((objective) => {
        const pct =
          objective.target > 0
            ? Math.min(100, (objective.progress / objective.target) * 100)
            : 0;
        const complete = objective.progress >= objective.target;
        return (
          <Card key={objective.objectiveId} className="p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">{objective.objectiveId}</h4>
              <Badge variant="secondary">
                {objective.progress.toLocaleString()} / {objective.target.toLocaleString()}
              </Badge>
            </div>
            <Progress value={pct} className="mt-2" />
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Reward: {objective.rewardGold.toLocaleString()}g +{" "}
                {objective.rewardXp.toLocaleString()} guild XP
              </p>
              {!isPreview &&
                !objective.claimed &&
                complete && (
                  <Button
                    size="xs"
                    onClick={async () => {
                      setError(null);
                      try {
                        await claimReward({
                          playerId: player._id,
                          objectiveId: objective.objectiveId,
                        });
                      } catch (e) {
                        setError(getErrorMessage(e));
                      }
                    }}
                  >
                    Claim
                  </Button>
                )}
              {objective.claimed && (
                <Badge variant="secondary">Claimed</Badge>
              )}
            </div>
          </Card>
        );
      })}
      <SectionError message={error} />
    </div>
  );
}

function BrowseView({ player }: { player: GuildPlayer }) {
  const [search, setSearch] = useState("");
  const results = useGuildSearch(search);
  const leaderboard = useGuildLeaderboard();
  const guildConfig = useGuildConfig();
  const applyToGuild = useApplyToGuild();
  const acceptInvite = useAcceptInvite();
  const declineApplication = useDeclineApplication();
  const myInvites = usePendingApplications(player._id, null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {myInvites.data && myInvites.data.length > 0 && (
        <Card className="p-4">
          <h4 className="mb-2 text-sm font-semibold">Your invites</h4>
          <div className="space-y-2">
            {myInvites.data.map((invite) => {
              if (!("guildName" in invite)) return null;
              return (
              <div
                key={invite._id}
                className="flex items-center justify-between gap-2 rounded bg-zinc-900 px-3 py-2"
              >
                <span className="text-sm">
                  {invite.guildName} [{invite.guildTag}]
                </span>
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    onClick={async () => {
                      setError(null);
                      try {
                        await acceptInvite({
                          playerId: player._id,
                          applicationId: invite._id,
                        });
                      } catch (e) {
                        setError(getErrorMessage(e));
                      }
                    }}
                  >
                    Accept
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={async () => {
                      setError(null);
                      try {
                        await declineApplication({
                          playerId: player._id,
                          applicationId: invite._id,
                        });
                      } catch (e) {
                        setError(getErrorMessage(e));
                      }
                    }}
                  >
                    Decline
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h4 className="mb-2 text-sm font-semibold">Find a guild</h4>
        <p className="mb-2 text-xs text-muted-foreground">
          Joining a guild requires character level{" "}
          {guildConfig.data?.joinMinLevel ?? 50} (you are level {player.level}).
        </p>
        <input
          type="text"
          placeholder="Search by name or tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputClassName}
          aria-label="Search guilds"
        />
        <div className="mt-2 space-y-2">
          {results.data?.map((guild) => (
            <div
              key={guild._id}
              className="flex items-center justify-between gap-2 rounded bg-zinc-900 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {guild.name} <span className="text-gold">[{guild.tag}]</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Lv {guild.level} · {guild.memberCount} members
                </p>
              </div>
              <Button
                size="xs"
                variant="outline"
                onClick={async () => {
                  setError(null);
                  try {
                    await applyToGuild({
                      playerId: player._id,
                      guildId: guild._id,
                      ...(message ? { message } : {}),
                    });
                  } catch (e) {
                    setError(getErrorMessage(e));
                  }
                }}
              >
                Apply
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h4 className="mb-2 text-sm font-semibold">Top guilds</h4>
        <div className="space-y-2">
          {leaderboard.data?.map((entry, index) => (
            <div
              key={entry.guildId}
              className="flex items-center justify-between rounded bg-zinc-900 px-3 py-2"
            >
              <span className="text-sm">
                #{index + 1} {entry.guildName} [{entry.guildTag}]
              </span>
              <span className="font-mono text-xs text-gold">
                Lv {entry.level} · {entry.memberCount} members
              </span>
            </div>
          ))}
        </div>
      </Card>
      <SectionError message={error} />
    </div>
  );
}

function CreateView({ player }: { player: GuildPlayer }) {
  const createGuild = useCreateGuild();
  const guildConfig = useGuildConfig();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const creationCost = guildConfig.data?.creationCost ?? 50000;
  const createMinLevel = guildConfig.data?.createMinLevel ?? 100;
  const meetsLevel = player.level >= createMinLevel;
  const meetsGold = player.gold >= creationCost;
  const canSubmit =
    !busy && name.trim().length > 0 && tag.trim().length > 0 && meetsLevel && meetsGold;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createGuild({
        playerId: player._id,
        name,
        tag,
        description,
      });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <h4 className="mb-2 text-sm font-semibold">Found a guild</h4>
      <div className="mb-3 space-y-1 rounded bg-zinc-900 px-3 py-2 text-sm">
        <p>
          Cost:{" "}
          <span className="font-mono text-gold">
            {creationCost.toLocaleString()}g
          </span>{" "}
          <span className="text-xs text-muted-foreground">
            (you have {player.gold.toLocaleString()}g)
          </span>
        </p>
        <p>
          Requires character level {createMinLevel}{" "}
          <span className="text-xs text-muted-foreground">
            (you are level {player.level})
          </span>
        </p>
        {!meetsLevel && (
          <p className="text-xs text-blood-light" role="alert">
            Reach level {createMinLevel} to found a guild.
          </p>
        )}
        {meetsLevel && !meetsGold && (
          <p className="text-xs text-blood-light" role="alert">
            You need {(creationCost - player.gold).toLocaleString()} more gold.
          </p>
        )}
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="text"
          placeholder="Guild name (3-24 chars)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          className={inputClassName}
          aria-label="Guild name"
        />
        <input
          type="text"
          placeholder="Tag (2-5 letters/numbers)"
          value={tag}
          onChange={(e) => setTag(e.target.value.toUpperCase())}
          maxLength={5}
          className={inputClassName}
          aria-label="Guild tag"
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={280}
          className={inputClassName}
          aria-label="Guild description"
        />
        <Button type="submit" disabled={!canSubmit}>
          {busy ? "Founding..." : `Found guild (${creationCost.toLocaleString()}g)`}
        </Button>
      </form>
      <SectionError message={error} />
    </Card>
  );
}

export function GuildPanel({
  player,
  view,
}: {
  player: GuildPlayer;
  view: GuildView;
}) {
  const myGuild = useMyGuild(player._id);
  const inGuild = !!myGuild.data;
  const tabs: Array<{ value: GuildView; label: string }> = inGuild
    ? [
        { value: "hall", label: "Hall" },
        { value: "roster", label: "Roster" },
        { value: "bank", label: "Bank" },
        { value: "buildings", label: "Buildings" },
        { value: "raids", label: "Raids" },
        { value: "objectives", label: "Objectives" },
        { value: "browse", label: "Browse" },
      ]
    : [
        { value: "browse", label: "Browse" },
        { value: "create", label: "Create" },
      ];
  const activeView = tabs.some((t) => t.value === view) ? view : tabs[0].value;

  return (
    <div className="space-y-4">
      <Tabs value={activeView} className="gap-0">
        <TabsList variant="forest" aria-label="Guild sections" className="min-w-max">
          {tabs.map((tab) => (
            <Link key={tab.value} to={guildPath(tab.value)}>
              <TabsTrigger value={tab.value}>{tab.label}</TabsTrigger>
            </Link>
          ))}
        </TabsList>
      </Tabs>
      {activeView === "hall" && <HallView player={player} />}
      {activeView === "roster" && <RosterView player={player} />}
      {activeView === "bank" && <BankView player={player} />}
      {activeView === "buildings" && <BuildingsView player={player} />}
      {activeView === "raids" && <RaidsView player={player} />}
      {activeView === "objectives" && <ObjectivesView player={player} />}
      {activeView === "browse" && <BrowseView player={player} />}
      {activeView === "create" && <CreateView player={player} />}
    </div>
  );
}
