export function inferTargetsFromText(text) {
  const wrongMatch = String(text || "").match(/(?:你的答案|所选答案|错误答案)\s*[:：]?\s*([ABCD])/i);
  const correctMatch = String(text || "").match(/(?:正确答案|参考答案|标准答案)\s*[:：]?\s*([ABCD])/i);
  return {
    wrongTarget: wrongMatch ? wrongMatch[1].toUpperCase() : null,
    correctTarget: correctMatch ? correctMatch[1].toUpperCase() : null
  };
}

export function pageShowsWrongStatus(text) {
  return /(回答错误|答错|错误答案|回答有误|正确答案是)/.test(String(text || ""));
}
