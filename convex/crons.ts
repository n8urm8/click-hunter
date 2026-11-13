import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Refund stakes held by waiting lobbies and abandoned fights nobody polls
// anymore. Hourly is plenty: lobby/fight expiry windows are hours/minutes
// long, and every lobby mutation also expires lazily on contact.
crons.interval(
  "expire stale arena lobbies",
  { hours: 1 },
  internal.arena.expireStaleLobbies,
  {}
);

// Monday 00:00 UTC: pay the ranked week's top 10 and restore everyone to
// start points. The settlement itself is idempotent per week.
crons.cron(
  "settle ranked week",
  "0 0 * * 1",
  internal.ranked.settleRankedWeek,
  {}
);

// Picks up balance edits made outside the admin panel. Two reads when idle.
crons.interval(
  "refresh balance snapshot",
  { minutes: 5 },
  internal.maintenance.refreshBalanceSnapshot,
  {}
);

// Copies top players into the board tables, writing only rows that moved.
crons.interval(
  "refresh leaderboards",
  { minutes: 30 },
  internal.leaderboards.refreshLeaderboards,
  {}
);

crons.interval(
  "prune history tables",
  { hours: 24 },
  internal.maintenance.pruneHistory,
  {}
);

// Chat keeps three days. Hourly so it's never much over, and an empty run reads
// nothing. Reports keep their own copy of the messages around them.
crons.interval(
  "prune chat messages",
  { hours: 1 },
  internal.chat.pruneMessages,
  {}
);

// Clears bans whose end has passed. Bans are checked without the clock, so a
// lapsed ban keeps blocking until this runs; five minutes is the worst case.
crons.interval(
  "expire account bans",
  { minutes: 5 },
  internal.moderation.expireBans,
  {}
);

export default crons;
