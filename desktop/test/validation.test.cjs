"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isSupportedAutomationUrl,
  normalizeNavigationUrl,
  positiveInteger,
  validateOptions
} = require("../src/shared/validation.cjs");

test("navigation URLs default to HTTPS and identify supported hosts", () => {
  const result = normalizeNavigationUrl("skl.hdu.edu.cn/#/english/list");
  assert.equal(result.protocol, "https:");
  assert.equal(result.requiresHttpConfirmation, false);
  assert.equal(result.supportedAutomationHost, true);
});

test("HTTP requires explicit confirmation", () => {
  const result = normalizeNavigationUrl("http://example.com/page");
  assert.equal(result.requiresHttpConfirmation, true);
  assert.equal(result.supportedAutomationHost, false);
});

test("unsupported schemes are rejected", () => {
  assert.throws(() => normalizeNavigationUrl("file:///etc/passwd"), /only HTTP and HTTPS/);
  assert.equal(isSupportedAutomationUrl("https://example.com"), false);
});

test("answer counts and A-D options are strict", () => {
  assert.equal(positiveInteger("100"), 100);
  assert.throws(() => positiveInteger(0), /positive integer/);
  assert.deepEqual(validateOptions({ A: "one", B: "two", C: "three", D: "four" }), {
    A: "one",
    B: "two",
    C: "three",
    D: "four"
  });
  assert.throws(() => validateOptions({ A: "one" }), /option B/);
});
