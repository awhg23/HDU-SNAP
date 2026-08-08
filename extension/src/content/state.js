export const AGENT_CONFIG = {
  defaultMaxItems: 100,
  scanDebounceMs: 180,
  minActionDelayMs: 100,
  maxActionDelayMs: 300
};

export const LETTERS = ["A", "B", "C", "D"];

export function createAgentState() {
  return {
    sessionId: `tab-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    active: true,
    solving: false,
    suspended: false,
    batchCompleteSent: false,
    observerStarted: false,
    lastFingerprint: null,
    sequenceCounter: 0,
    answeredCount: 0,
    maxItems: AGENT_CONFIG.defaultMaxItems,
    scanTimer: null,
    reviewEnabled: false,
    reviewPhase: "idle",
    reviewTimer: null,
    reviewWorking: false,
    reviewRecordOpened: false,
    reviewQueue: [],
    reviewCollected: new Set(),
    reviewResults: [],
    reviewResultsSent: false,
    answerHistory: {},
    reviewVisited: new Set(),
    reviewNavigationMode: "card",
    mobileEmulationEnabled: false,
    examEmulationReleaseRequested: false
  };
}

export function applyClientConfig(state, config) {
  const answerCount = Number(config?.answer_count);
  if (Number.isFinite(answerCount) && answerCount > 0) {
    state.maxItems = answerCount;
  }
  const automation = config?.automation || {};
  const scanDebounce = Number(automation.scan_debounce_ms);
  const minimumDelay = Number(automation.min_action_delay_ms);
  const maximumDelay = Number(automation.max_action_delay_ms);
  if (Number.isFinite(scanDebounce) && scanDebounce >= 0) {
    AGENT_CONFIG.scanDebounceMs = scanDebounce;
  }
  if (Number.isFinite(minimumDelay) && minimumDelay >= 0) {
    AGENT_CONFIG.minActionDelayMs = minimumDelay;
  }
  if (Number.isFinite(maximumDelay) && maximumDelay >= minimumDelay) {
    AGENT_CONFIG.maxActionDelayMs = maximumDelay;
  }
}
