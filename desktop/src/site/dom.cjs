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

function extractCorrectTarget(text) {
  const match = normalizeText(text).match(
    /正确答案(?:是|为)?\s*[:：]?\s*([ABCD])(?=\s|$|[，。,.；;、])/i
  );
  return match ? match[1].toUpperCase() : null;
}

function extractWrongTarget(text) {
  const match = normalizeText(text).match(
    /(?:你的答案|您的答案|所选答案|选择答案|作答答案|你的选择|您的选择)(?:是|为)?\s*[:：]?\s*([ABCD])(?=\s|$|[，。,.；;、])/i
  );
  return match ? match[1].toUpperCase() : null;
}

function isWrongQuestionResult(text) {
  const normalized = normalizeText(text);
  return /(回答错误|答题错误|答案错误|回答有误|答错)/.test(normalized)
    && Boolean(extractCorrectTarget(normalized));
}

module.exports = {
  extractCorrectTarget,
  extractQuestionCore,
  extractWrongTarget,
  isWrongQuestionResult,
  nextActionAfterDecision,
  normalizeText,
  parseOptionLine
};
