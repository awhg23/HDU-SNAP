"use strict";

const { SUPPORTED_HOSTS } = require("./constants.cjs");

function requirePlainObject(value, label = "value") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(label + " must be an object");
  }
  return value;
}

function cleanText(value, label, maxLength = 500) {
  const normalized = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new TypeError(label + " cannot be empty");
  }
  if (normalized.length > maxLength) {
    throw new TypeError(label + " is too long");
  }
  return normalized;
}

function positiveInteger(value, label = "value") {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(label + " must be a positive integer");
  }
  return number;
}

function normalizeNavigationUrl(value) {
  let raw = cleanText(value, "URL", 4096);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    raw = "https://" + raw;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("URL must be valid");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new TypeError("only HTTP and HTTPS URLs are supported");
  }
  if (!url.hostname) {
    throw new TypeError("URL hostname is required");
  }
  return {
    url: url.toString(),
    protocol: url.protocol,
    requiresHttpConfirmation: url.protocol === "http:",
    supportedAutomationHost: SUPPORTED_HOSTS.has(url.hostname.toLowerCase())
  };
}

function isSupportedAutomationUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && SUPPORTED_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function validateOptions(value) {
  const options = requirePlainObject(value, "options");
  const result = {};
  for (const letter of ["A", "B", "C", "D"]) {
    result[letter] = cleanText(options[letter], "option " + letter, 300);
  }
  return result;
}

module.exports = {
  cleanText,
  isSupportedAutomationUrl,
  normalizeNavigationUrl,
  positiveInteger,
  requirePlainObject,
  validateOptions
};
