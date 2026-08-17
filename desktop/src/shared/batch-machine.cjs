"use strict";

const { randomUUID } = require("node:crypto");
const {
  BATCH_STATUS,
  DEFAULT_ANSWER_COUNT
} = require("./constants.cjs");
const { positiveInteger } = require("./validation.cjs");

class InvalidBatchTransitionError extends Error {}

class BatchMachine {
  constructor(input, clock = () => new Date()) {
    const answerCount = positiveInteger(input.answerCount ?? DEFAULT_ANSWER_COUNT, "answerCount");
    this.clock = clock;
    this.state = {
      id: input.id || randomUUID(),
      targetCount: answerCount,
      answeredCount: 0,
      status: BATCH_STATUS.READY,
      startedAt: null,
      endedAt: null,
      pauseReason: null,
      stopReason: null,
      submissionConfirmation: null,
      submissionTimedOut: false,
      siteScore: null,
      retryCount: 0,
      decisionStats: {},
      lastDecision: null
    };
  }

  static fromSnapshot(snapshot, clock = () => new Date()) {
    const machine = Object.create(BatchMachine.prototype);
    machine.clock = clock;
    machine.state = structuredClone(snapshot);
    delete machine.state.mode;
    delete machine.state.reviewStatus;
    delete machine.state.reviewCounts;
    delete machine.state.debugItems;
    return machine;
  }

  _assertStatus(...allowed) {
    if (!allowed.includes(this.state.status)) {
      throw new InvalidBatchTransitionError(
        "cannot transition from " + this.state.status + "; expected " + allowed.join(", ")
      );
    }
  }

  start() {
    this._assertStatus(BATCH_STATUS.READY, BATCH_STATUS.PAUSED, BATCH_STATUS.ERROR_PAUSED);
    if (!this.state.startedAt) {
      this.state.startedAt = this.clock().toISOString();
    }
    this.state.status = BATCH_STATUS.RUNNING;
    this.state.pauseReason = null;
    this.state.retryCount = 0;
    return this.snapshot();
  }

  pause(reason = "user") {
    this._assertStatus(BATCH_STATUS.RUNNING);
    this.state.status = BATCH_STATUS.PAUSED;
    this.state.pauseReason = String(reason);
    return this.snapshot();
  }

  recordFailure(reason) {
    this._assertStatus(BATCH_STATUS.RUNNING);
    this.state.retryCount += 1;
    if (this.state.retryCount >= 3) {
      this.state.status = BATCH_STATUS.ERROR_PAUSED;
      this.state.pauseReason = String(reason || "question_failed");
    }
    return this.snapshot();
  }

  recordDecision(decision, question = null) {
    this._assertStatus(BATCH_STATUS.RUNNING);
    this.state.retryCount = 0;
    this.state.answeredCount += 1;
    const method = String(decision.method || "未知方法");
    this.state.decisionStats[method] = (this.state.decisionStats[method] || 0) + 1;
    this.state.lastDecision = {
      itemId: question?.itemId ?? this.state.answeredCount,
      target: decision.target,
      method,
      confidence: decision.confidence ?? null,
      detail: decision.detail ?? null
    };
    if (this.state.answeredCount >= this.state.targetCount) {
      this.state.status = BATCH_STATUS.FINAL_PENDING;
      this.state.submissionTimedOut = false;
    }
    return this.snapshot();
  }

  extend(additionalCount) {
    this._assertStatus(BATCH_STATUS.FINAL_PENDING);
    this.state.targetCount += positiveInteger(additionalCount, "additionalCount");
    this.state.status = BATCH_STATUS.RUNNING;
    this.state.submissionTimedOut = false;
    return this.snapshot();
  }

  beginSubmissionConfirmation() {
    this._assertStatus(BATCH_STATUS.FINAL_PENDING);
    this.state.status = BATCH_STATUS.CONFIRMING_SUBMISSION;
    this.state.submissionTimedOut = false;
    return this.snapshot();
  }

  submissionDetectionTimedOut() {
    this._assertStatus(BATCH_STATUS.CONFIRMING_SUBMISSION);
    this.state.status = BATCH_STATUS.FINAL_PENDING;
    this.state.submissionTimedOut = true;
    return this.snapshot();
  }

  complete(confirmation = "detected", siteScore = null) {
    this._assertStatus(BATCH_STATUS.FINAL_PENDING, BATCH_STATUS.CONFIRMING_SUBMISSION);
    this.state.status = BATCH_STATUS.COMPLETED;
    this.state.submissionConfirmation = confirmation;
    this.state.siteScore = siteScore;
    this.state.endedAt = this.clock().toISOString();
    return this.snapshot();
  }

  stop(reason = "user") {
    this._assertStatus(
      BATCH_STATUS.READY,
      BATCH_STATUS.RUNNING,
      BATCH_STATUS.PAUSED,
      BATCH_STATUS.ERROR_PAUSED
    );
    this.state.status = BATCH_STATUS.STOPPED;
    this.state.stopReason = String(reason);
    this.state.endedAt = this.clock().toISOString();
    return this.snapshot();
  }

  interrupt() {
    if ([BATCH_STATUS.FINAL_PENDING, BATCH_STATUS.CONFIRMING_SUBMISSION].includes(this.state.status)) {
      this.state.status = BATCH_STATUS.SUBMISSION_UNCONFIRMED;
    } else if (![BATCH_STATUS.COMPLETED, BATCH_STATUS.STOPPED].includes(this.state.status)) {
      this.state.status = BATCH_STATUS.INTERRUPTED;
    }
    this.state.endedAt = this.clock().toISOString();
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.state);
  }
}

module.exports = {
  BatchMachine,
  InvalidBatchTransitionError
};
