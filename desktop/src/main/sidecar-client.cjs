"use strict";

const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

class SidecarClient extends EventEmitter {
  constructor(command, args = [], options = {}) {
    super();
    this.command = command;
    this.args = args;
    this.cwd = options.cwd;
    this.env = options.env;
    this.logger = options.logger;
    this.process = null;
    this.nextId = 1;
    this.pending = new Map();
    this.closing = false;
  }

  start() {
    if (this.isRunning()) return this.process;
    this.closing = false;
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let exitReported = false;
    this.process = child;
    this.logger?.info("core spawned", `pid=${child.pid}`);
    readline.createInterface({ input: child.stdout }).on("line", (line) => this._handleLine(line, child));
    readline.createInterface({ input: child.stderr }).on("line", (line) => {
      this.logger?.info("core", `pid=${child.pid} ${line}`);
    });
    child.on("error", (cause) => {
      if (exitReported) return;
      exitReported = true;
      const error = new Error("solver core failed to start: " + cause.message);
      error.code = "CORE_SPAWN_FAILED";
      this._rejectPending(error);
      if (this.process === child) this.process = null;
      this.emit("exit", { code: null, signal: null, pid: child.pid, expected: this.closing, error: cause.message });
    });
    child.on("exit", (code, signal) => {
      if (exitReported) return;
      exitReported = true;
      const error = new Error("solver core exited: " + (signal || code));
      error.code = "CORE_EXITED";
      this._rejectPending(error);
      if (this.process === child) this.process = null;
      this.emit("exit", { code, signal, pid: child.pid, expected: this.closing });
    });
    return child;
  }

  isRunning() {
    return Boolean(this.process && this.process.exitCode === null && !this.process.killed);
  }

  _rejectPending(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  _handleLine(line, child = this.process) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      this.logger?.warn("invalid core response");
      return;
    }
    const pending = this.pending.get(payload.id);
    if (!pending) return;
    this.pending.delete(payload.id);
    clearTimeout(pending.timer);
    this.logger?.info(
      "core response",
      `pid=${child?.pid || "unknown"} id=${payload.id} method=${pending.method} status=${payload.error ? "error" : "ok"}`
    );
    if (payload.error) {
      const error = new Error(payload.error.message || "core request failed");
      error.code = payload.error.code;
      pending.reject(error);
    } else {
      pending.resolve(payload.result);
    }
  }

  request(method, params = {}, timeoutMs = 30_000) {
    if (!this.isRunning()) {
      const error = new Error("solver core is not running");
      error.code = "CORE_NOT_RUNNING";
      return Promise.reject(error);
    }
    const id = this.nextId++;
    const child = this.process;
    this.logger?.info("core request", `pid=${child.pid} id=${id} method=${method}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error("core request timed out: " + method);
        error.code = "CORE_TIMEOUT";
        reject(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n", (writeError) => {
        if (!writeError || !this.pending.has(id)) return;
        clearTimeout(timer);
        this.pending.delete(id);
        const error = new Error("failed to send request to solver core");
        error.code = "CORE_WRITE_FAILED";
        reject(error);
      });
    });
  }

  async close() {
    if (!this.isRunning()) return;
    this.closing = true;
    try { await this.request("shutdown", {}, 2_000); } catch {}
    if (this.isRunning()) this.process.kill("SIGTERM");
  }
}

module.exports = { SidecarClient };
