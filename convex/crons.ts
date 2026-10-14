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

export default crons;
