"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { CoreSupervisor } = require("../src/main/core-supervisor.cjs");
const { SidecarClient } = require("../src/main/sidecar-client.cjs");

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.starts = 0;
    this.initializeCalls = 0;
    this.solveCalls = 0;
    this.solveErrorCode = null;
  }

  start() {
    this.running = true;
    this.starts += 1;
  }

  isRunning() { return this.running; }

  async request(method) {
    if (method === "initialize") {
      this.initializeCalls += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return { ok: true };
    }
    if (method === "solve") {
      this.solveCalls += 1;
      if (this.solveErrorCode && this.solveCalls === 1) {
        const error = new Error("simulated core failure");
        error.code = this.solveErrorCode;
        throw error;
      }
      return { target: "C" };
    }
    return { ok: true };
  }
}

test("concurrent initialization starts and initializes the core only once", async () => {
  const client = new FakeClient();
  const supervisor = new CoreSupervisor(client, { initializeParams: () => ({}) });

  const [first, second] = await Promise.all([supervisor.initialize(), supervisor.initialize()]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(client.starts, 1);
  assert.equal(client.initializeCalls, 1);
  assert.equal(supervisor.isReady(), true);
});

test("an uninitialized core is reinitialized and the request is retried once", async () => {
  const client = new FakeClient();
  client.solveErrorCode = "CoreNotInitializedError";
  const supervisor = new CoreSupervisor(client, { initializeParams: () => ({}) });

  const result = await supervisor.request("solve", { source_text: "管理，经营" });

  assert.equal(result.target, "C");
  assert.equal(client.initializeCalls, 2);
  assert.equal(client.solveCalls, 2);
});

test("a non-recoverable request error is not retried", async () => {
  const client = new FakeClient();
  client.solveErrorCode = "ValueError";
  const supervisor = new CoreSupervisor(client, { initializeParams: () => ({}) });

  await assert.rejects(supervisor.request("solve"), { code: "ValueError" });
  assert.equal(client.initializeCalls, 1);
  assert.equal(client.solveCalls, 1);
});

test("SidecarClient requests cannot silently start an uninitialized process", async () => {
  const client = new SidecarClient("command-that-must-not-run");

  await assert.rejects(client.request("solve"), { code: "CORE_NOT_RUNNING" });
  assert.equal(client.process, null);
});
