export function computeReconnectDelay(attempt, maximumMs) {
  const normalizedAttempt = Math.max(0, Number(attempt) || 0);
  return Math.min(1000 * (2 ** normalizedAttempt), maximumMs);
}

export function sessionRouteKey(sessionId) {
  return sessionId || "default";
}

export function itemRouteKey(sessionId, itemId) {
  return `${sessionRouteKey(sessionId)}:${itemId}`;
}
