"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BatchMachine,
  InvalidBatchTransitionError
} = require("../src/shared/batch-machine.cjs");
const { BATCH_STATUS } = require("../src/shared/constants.cjs");

function machine(input = {}) {
  return new BatchMachine({
    answerCount: 2,
    ...input
  }, () => new Date("2026-08-09T00:00:00Z"));
}

test("batch reaches final pending without any submit action", () => {
  const batch = machine();
  batch.start();
  batch.recordDecision({ target: "A", method: "词典" }, {
    itemId: 1,
    sourceText: "one",
    options: { A: "一", B: "二", C: "三", D: "四" }
  });
  const state = batch.recordDecision({ target: "C", method: "确定性兜底" }, {
    itemId: 2,
    sourceText: "three",
    options: { A: "一", B: "二", C: "三", D: "四" }
  });
  assert.equal(state.status, BATCH_STATUS.FINAL_PENDING);
  assert.equal(state.answeredCount, 2);
  assert.deepEqual(state.decisionStats, { 词典: 1, 确定性兜底: 1 });
});

test("three failures pause and retry resets the counter", () => {
  const batch = machine();
  batch.start();
  batch.recordFailure("network");
  batch.recordFailure("network");
  let state = batch.recordFailure("network");
  assert.equal(state.status, BATCH_STATUS.ERROR_PAUSED);
  state = batch.start();
  assert.equal(state.status, BATCH_STATUS.RUNNING);
  assert.equal(state.retryCount, 0);
});

test("pending submission interruption is distinct", () => {
  const batch = machine({ answerCount: 1 });
  batch.start();
  batch.recordDecision({ target: "A", method: "补丁规则" }, {
    itemId: 1,
    sourceText: "one",
    options: { A: "一", B: "二", C: "三", D: "四" }
  });
  assert.equal(batch.interrupt().status, BATCH_STATUS.SUBMISSION_UNCONFIRMED);
});

test("manual submission fallback is enabled only after detection timeout", () => {
  const machine = new BatchMachine({ answerCount: 1 });
  machine.start();
  machine.recordDecision({ target: "A", method: "字典匹配" });
  assert.equal(machine.state.submissionTimedOut, false);
  machine.beginSubmissionConfirmation();
  assert.equal(machine.state.submissionTimedOut, false);
  machine.submissionDetectionTimedOut();
  assert.equal(machine.state.status, BATCH_STATUS.FINAL_PENDING);
  assert.equal(machine.state.submissionTimedOut, true);
});

test("desktop batches do not expose a mode or review payload", () => {
  const batch = machine({ mode: "debug", answerCount: 1 });
  assert.equal("mode" in batch.state, false);
  assert.equal("reviewStatus" in batch.state, false);
  assert.equal("debugItems" in batch.state, false);
});

test("invalid transitions fail closed", () => {
  const batch = machine();
  assert.throws(() => batch.pause(), InvalidBatchTransitionError);
});
