"use strict";

const { EventEmitter } = require("node:events");

const RECOVERABLE_CODES = new Set([
  "CORE_EXITED",
  "CORE_NOT_RUNNING",
  "CoreNotInitializedError"
]);

class CoreSupervisor extends EventEmitter {
  constructor(client, options = {}) {
    super();
    this.client = client;
    this.initializeParams = options.initializeParams || (() => ({}));
    this.initializeTimeoutMs = options.initializeTimeoutMs || 120_000;
    this.logger = options.logger;
    this.health = null;
    this.error = null;
    this.initializing = null;
    client.on("exit", (details) => {
      this.health = null;
      if (!details.expected) this.error = "答题核心已退出（" + (details.signal || details.code) + "）";
      this.emit("state", this.snapshot());
    });
  }

  snapshot() {
    return { health: this.health, error: this.error, ready: this.isReady() };
  }

  isReady() {
    return Boolean(this.health?.ok && this.client.isRunning());
  }

  async initialize({ force = false } = {}) {
    if (this.initializing) return this.initializing;
    if (!force && this.isReady()) return this.health;
    this.initializing = (async () => {
      if (!this.client.isRunning()) this.client.start();
      try {
        this.health = await this.client.request(
          "initialize",
          this.initializeParams(),
          this.initializeTimeoutMs
        );
        this.error = null;
        this.emit("state", this.snapshot());
        return this.health;
      } catch (error) {
        this.health = null;
        this.error = "答题核心初始化失败：" + error.message;
        this.emit("state", this.snapshot());
        throw error;
      }
    })();
    try {
      return await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  async request(method, params = {}, timeoutMs = 30_000) {
    await this.initialize();
    try {
      return await this.client.request(method, params, timeoutMs);
    } catch (error) {
      if (!RECOVERABLE_CODES.has(error.code)) throw error;
      this.logger?.warn("core request recovery", `method=${method} code=${error.code}`);
      this.health = null;
      await this.initialize({ force: true });
      return this.client.request(method, params, timeoutMs);
    }
  }

  close() {
    return this.client.close();
  }
}

module.exports = { CoreSupervisor, RECOVERABLE_CODES };
