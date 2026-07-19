import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Create or update a game event (admin)
 */
export const createEvent = mutation({
  args: {
    eventId: v.string(),
    name: v.string(),
    description: v.string(),
    startTime: v.number(),
    endTime: v.number(),
    effectType: v.string(), // "gold-multiplier", "xp-multiplier"
    effectValue: v.number(),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("gameEvents")
      .withIndex("by_eventId")
      .filter((q) => q.eq(q.field("eventId"), args.eventId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        isActive: args.startTime <= Date.now() && args.endTime > Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("gameEvents", {
      ...args,
      isActive: args.startTime <= Date.now() && args.endTime > Date.now(),
      createdAt: Date.now(),
    });
  },
});

/**
 * Get all active events
 */
export const getActiveEvents = query({
  args: {},
  async handler(ctx) {
    const now = Date.now();
    return await ctx.db
      .query("gameEvents")
      .withIndex("by_isActive")
      .filter((q) => {
        const events = q.eq(q.field("isActive"), true);
        return events;
      })
      .collect();
  },
});

/**
 * Get active multipliers for kills (gold, xp)
 */
export const getActiveMultipliers = query({
  args: {},
  async handler(ctx) {
    const now = Date.now();
    const activeEvents = await ctx.db
      .query("gameEvents")
      .filter((q) => {
        const allEvents = q.gte(q.field("endTime"), now);
        return allEvents;
      })
      .collect();

    const active = activeEvents.filter((e) => e.startTime <= now && e.endTime > now);

    let goldMultiplier = 1;
    let xpMultiplier = 1;

    for (const event of active) {
      if (event.effectType === "gold-multiplier") {
        goldMultiplier *= event.effectValue;
      } else if (event.effectType === "xp-multiplier") {
        xpMultiplier *= event.effectValue;
      }
    }

    return { goldMultiplier, xpMultiplier, activeEvents: active };
  },
});

/**
 * Check and update event status (for cron or manual calls)
 */
export const refreshEventStatuses = mutation({
  args: {},
  async handler(ctx) {
    const now = Date.now();
    const allEvents = await ctx.db.query("gameEvents").collect();

    let updated = 0;
    for (const event of allEvents) {
      const shouldBeActive = event.startTime <= now && event.endTime > now;
      if (event.isActive !== shouldBeActive) {
        await ctx.db.patch(event._id, { isActive: shouldBeActive });
        updated++;
      }
    }

    return { updated, total: allEvents.length };
  },
});
