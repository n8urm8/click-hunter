import { useEffect, useState } from "react";
import { useConvexConnectionState } from "convex/react";
import { getTaskServerNow } from "~/lib/taskClock";

export function useTaskClock(enabled: boolean, intervalMs = 250, requiresOnline = false) {
  const [now, setNow] = useState(getTaskServerNow);
  const { isWebSocketConnected } = useConvexConnectionState();
  useEffect(() => {
    if (!enabled || (requiresOnline && !isWebSocketConnected)) return;
    const tick = () => setNow(getTaskServerNow());
    tick();
    const interval = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(interval);
  }, [enabled, intervalMs, isWebSocketConnected, requiresOnline]);
  return now;
}
