export function activateReviewMode(state, { phase, recordOpened }) {
  state.reviewEnabled = true;
  state.reviewPhase = phase;
  state.reviewRecordOpened = recordOpened;
  state.reviewQueue = [];
  state.reviewCollected = new Set();
  state.reviewResults = [];
  state.reviewResultsSent = false;
  state.reviewVisited = new Set();
  state.reviewNavigationMode = "card";
}
