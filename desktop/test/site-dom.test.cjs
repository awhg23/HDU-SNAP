"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractQuestionCore,
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
