export function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

export function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text || "");
}

export function parseOptionLine(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/^([ABCD])[\.\s:：、\)]\s*(.+)$/i);
  if (!match) {
    return null;
  }
  return {
    letter: match[1].toUpperCase(),
    text: normalizeText(match[2]).replace(/[ .。?？:：;；]+$/g, "")
  };
}

export function extractQuestionCore(text) {
  let normalized = normalizeText(text);
  normalized = normalized.replace(/^QUESTION\s*\d+\s*/i, "");
  normalized = normalized.replace(/^第\s*\d+\s*题\s*/i, "");
  normalized = normalized.replace(/^CET\s*[- ]\s*\d+\s+/i, "");
  normalized = normalized.replace(/^(?:CET[- ]?[46])\s+/i, "");
  normalized = normalized.replace(/(自动下一题|题卡|上一题|下一题).*$/i, "");
  normalized = normalized.split(/\sA[\.\s:：、\)]/)[0];
  return normalized.replace(/^[：:.。\s]+|[：:.。?？\s]+$/g, "");
}
