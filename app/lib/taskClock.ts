let serverAnchor: { serverTime: number; clientTime: number } | null = null;

export function observeTaskServerTime(serverTime: number) {
  // Buffered/offline requests make round-trip latency correction unreliable.
  serverAnchor = { serverTime, clientTime: performance.now() };
}

export function getTaskServerNow() {
  return serverAnchor
    ? serverAnchor.serverTime + Math.max(0, performance.now() - serverAnchor.clientTime)
    : Date.now();
}
