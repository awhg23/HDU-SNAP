"use strict";

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function parseOptionLine(text) {
  const match = normalizeText(text).match(/^([ABCD])[.\s:：、)]\s*(.+)$/i);
  if (!match) return null;
  return {
    letter: match[1].toUpperCase(),
    text: normalizeText(match[2]).replace(/[ .。?？:：;；]+$/g, "")
  };
}

function extractQuestionCore(text) {
  return normalizeText(text)
    .replace(/^QUESTION\s*\d+\s*/i, "")
    .replace(/^第\s*\d+\s*题\s*/i, "")
    .replace(/^CET\s*[- ]\s*\d+\s+/i, "")
    .replace(/^(?:CET[- ]?[46])\s+/i, "")
    .replace(/(自动下一题|题卡|上一题|下一题).*$/i, "")
    .split(/\sA[.\s:：、)]/)[0]
    .replace(/^[：:.。\s]+|[：:.。?？\s]+$/g, "");
}

function nextActionAfterDecision({ isFinal, nextAvailable }) {
  if (isFinal) return "finish";
  return nextAvailable ? "next" : "wait";
}

module.exports = {
  extractQuestionCore,
  nextActionAfterDecision,
  normalizeText,
  parseOptionLine
};
