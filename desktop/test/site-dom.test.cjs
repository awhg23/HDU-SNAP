"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractCorrectTarget,
  extractQuestionCore,
  extractWrongTarget,
  isWrongQuestionResult,
  nextActionAfterDecision,
  parseOptionLine
} = require("../src/site/dom.cjs");

test("question and A-D option fixtures are normalized", () => {
  assert.equal(extractQuestionCore("第 14 题  管理，经营？"), "管理，经营");
  assert.deepEqual(parseOptionLine("C. manage"), { letter: "C", text: "manage" });
  assert.equal(parseOptionLine("提交"), null);
});

test("automatic-next pages wait for DOM advancement without a text button", () => {
  assert.equal(nextActionAfterDecision({ isFinal: false, nextAvailable: false }), "wait");
  assert.equal(nextActionAfterDecision({ isFinal: false, nextAvailable: true }), "next");
  assert.equal(nextActionAfterDecision({ isFinal: true, nextAvailable: false }), "finish");
});

test("result-page answer markers identify only recordable wrong questions", () => {
  assert.equal(extractCorrectTarget("回答错误 正确答案是 B"), "B");
  assert.equal(extractCorrectTarget("正确答案为：c。"), "C");
  assert.equal(extractWrongTarget("您的答案为 C，正确答案是 B"), "C");
  assert.equal(extractCorrectTarget("正确 97 错误 3"), null);
  assert.equal(isWrongQuestionResult("回答错误 正确答案是 B"), true);
  assert.equal(isWrongQuestionResult("回答正确 正确答案是 B"), false);
});
