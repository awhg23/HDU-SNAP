import { describe, expect, it } from "vitest";

import { nextActionAfterDecision } from "../src/content/automation-policy.js";
import { extractQuestionCore, parseOptionLine } from "../src/content/dom.js";
import { inferTargetsFromText, pageShowsWrongStatus } from "../src/content/review.js";
import { activateReviewMode } from "../src/content/review-state.js";
import { AGENT_CONFIG, applyClientConfig, createAgentState } from "../src/content/state.js";

describe("question DOM text helpers", () => {
  it("extracts normalized questions and options from fixture text", () => {
    expect(extractQuestionCore("QUESTION 8 CET-4 新闻？ 自动下一题")).toBe("新闻");
    expect(parseOptionLine("A. news。 ")).toEqual({ letter: "A", text: "news" });
  });
});

describe("post-decision policy", () => {
  it("finishes without considering a submit button on the final item", () => {
    expect(nextActionAfterDecision({ isLastItem: true, submitButton: {}, nextButton: null })).toBe("finish");
  });

  it("never treats a submit-only page as next", () => {
    expect(nextActionAfterDecision({ isLastItem: false, submitButton: {}, nextButton: null })).toBe("suspend");
  });

  it("advances only when an explicit next button exists", () => {
    expect(nextActionAfterDecision({ isLastItem: false, submitButton: null, nextButton: {} })).toBe("next");
  });
});

describe("review adapter state", () => {
  it("parses wrong and correct targets from result text", () => {
    expect(inferTargetsFromText("你的答案：b 正确答案：A")).toEqual({ wrongTarget: "B", correctTarget: "A" });
    expect(pageShowsWrongStatus("回答错误，正确答案是 A")).toBe(true);
  });

  it("resets review collections when review mode starts", () => {
    const state = createAgentState();
    state.reviewResults.push({ itemId: 1 });
    activateReviewMode(state, { phase: "await_history", recordOpened: false });
    expect(state.reviewEnabled).toBe(true);
    expect(state.reviewResults).toEqual([]);
    expect(state.reviewPhase).toBe("await_history");
  });

  it("applies safe server configuration to the current content session", () => {
    const state = createAgentState();
    applyClientConfig(state, {
      answer_count: 30,
      automation: { scan_debounce_ms: 200, min_action_delay_ms: 120, max_action_delay_ms: 350 }
    });
    expect(state.maxItems).toBe(30);
    expect(AGENT_CONFIG.scanDebounceMs).toBe(200);
    expect(AGENT_CONFIG.minActionDelayMs).toBe(120);
    expect(AGENT_CONFIG.maxActionDelayMs).toBe(350);
  });
});
