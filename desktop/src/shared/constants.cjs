"use strict";

const SCHEMA_VERSION = 3;
const PROTOCOL_VERSION = 1;
const MAX_BATCH_RECORDS = 1000;
const DEFAULT_ANSWER_COUNT = 100;
const QUESTION_RETRY_LIMIT = 3;
const SUBMISSION_DETECTION_TIMEOUT_MS = 15_000;
const PAGE_EXECUTION_GRACE_MS = 5_000;
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LOG_RETENTION_DAYS = 30;
const LOG_MAX_BYTES = 100 * 1024 * 1024;
const BROWSER_PARTITION = "persist:hdu-snap-browser";
const UPDATE_MANIFEST_URL =
  "https://raw.githubusercontent.com/awhg23/HDU-SNAP-update-manifest/main/manifest.json";
const RELEASE_HOST = "github.com";
const RELEASE_PATH_PREFIX = "/awhg23/HDU-SNAP/releases/";

const SUPPORTED_SITE_URLS = Object.freeze([
  "https://skl.hduhelp.com/?type=5#/english/list",
  "https://skl.hdu.edu.cn/#/english/list"
]);
const SUPPORTED_HOSTS = new Set(["skl.hduhelp.com", "skl.hdu.edu.cn"]);

const BATCH_STATUS = Object.freeze({
  READY: "ready",
  RUNNING: "running",
  PAUSED: "paused",
  ERROR_PAUSED: "error_paused",
  FINAL_PENDING: "final_pending",
  CONFIRMING_SUBMISSION: "confirming_submission",
  COMPLETED: "completed",
  STOPPED: "stopped",
  INTERRUPTED: "interrupted",
  SUBMISSION_UNCONFIRMED: "submission_unconfirmed"
});

const DEFAULT_MOBILE_PROFILE = Object.freeze({
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
  platform: "Android",
  width: 412,
  height: 915,
  deviceScaleFactor: 2.625,
  maxTouchPoints: 1
});

const DEFAULT_AUTOMATION_CONFIG = Object.freeze({
  scanDebounceMs: 180,
  minActionDelayMs: 100,
  maxActionDelayMs: 300,
  retryLimit: QUESTION_RETRY_LIMIT,
  submissionDetectionTimeoutMs: SUBMISSION_DETECTION_TIMEOUT_MS
});

module.exports = {
  BATCH_STATUS,
  BROWSER_PARTITION,
  DEFAULT_ANSWER_COUNT,
  DEFAULT_AUTOMATION_CONFIG,
  DEFAULT_MOBILE_PROFILE,
  LOG_MAX_BYTES,
  LOG_RETENTION_DAYS,
  MAX_BATCH_RECORDS,
  PAGE_EXECUTION_GRACE_MS,
  PROTOCOL_VERSION,
  QUESTION_RETRY_LIMIT,
  RELEASE_HOST,
  RELEASE_PATH_PREFIX,
  SCHEMA_VERSION,
  SUBMISSION_DETECTION_TIMEOUT_MS,
  SUPPORTED_HOSTS,
  SUPPORTED_SITE_URLS,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_MANIFEST_URL
};
