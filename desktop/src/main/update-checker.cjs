"use strict";

const semver = require("semver");
const {
  RELEASE_HOST,
  RELEASE_PATH_PREFIX,
  UPDATE_CHECK_INTERVAL_MS
} = require("../shared/constants.cjs");

function shouldCheck(lastCheckedAt, now = Date.now()) {
  if (!lastCheckedAt) return true;
  const timestamp = new Date(lastCheckedAt).getTime();
  return !Number.isFinite(timestamp) || now - timestamp >= UPDATE_CHECK_INTERVAL_MS;
}

function isAllowedReleaseUrl(value, version) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.hostname === RELEASE_HOST
      && parsed.username === ""
      && parsed.password === ""
      && parsed.search === ""
      && parsed.hash === ""
      && parsed.pathname === `${RELEASE_PATH_PREFIX}tag/v${version}`;
  } catch {
    return false;
  }
}

function validateRelease(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`invalid release at index ${index}`);
  }
  const expectedKeys = ["channel", "published_at", "release_url", "sha256", "summary", "version"];
  const actualKeys = Object.keys(raw).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, position) => key !== expectedKeys[position])) {
    throw new TypeError(`invalid release schema at index ${index}`);
  }
  const version = String(raw.version || "").trim();
  const channel = String(raw.channel || "").trim();
  const publishedAt = String(raw.published_at || "").trim();
  const summary = String(raw.summary || "").trim();
  const sha256 = String(raw.sha256 || "").trim().toLowerCase();
  const releaseUrl = String(raw.release_url || "").trim();
  if (semver.valid(version) !== version || !["stable", "test"].includes(channel)) {
    throw new TypeError(`invalid release version or channel at index ${index}`);
  }
  if (channel === "stable" && semver.prerelease(version) !== null) {
    throw new TypeError(`stable release cannot be a prerelease at index ${index}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(publishedAt)
      || !Number.isFinite(Date.parse(publishedAt)) || !summary || summary.length > 500) {
    throw new TypeError(`invalid release metadata at index ${index}`);
  }
  if (!/^[a-f0-9]{64}$/.test(sha256) || !isAllowedReleaseUrl(releaseUrl, version)) {
    throw new TypeError(`invalid release integrity metadata at index ${index}`);
  }
  return Object.freeze({
    version,
    channel,
    published_at: publishedAt,
    summary,
    sha256,
    release_url: releaseUrl
  });
}

function validateManifest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.schema_version !== 1) {
    throw new TypeError("invalid version manifest schema");
  }
  const keys = Object.keys(raw).sort();
  if (keys.length !== 2 || keys[0] !== "releases" || keys[1] !== "schema_version") {
    throw new TypeError("invalid version manifest schema");
  }
  if (!Array.isArray(raw.releases)) throw new TypeError("invalid version manifest releases");
  const releases = raw.releases.map(validateRelease);
  const identities = new Set();
  for (const release of releases) {
    const identity = `${release.channel}:${release.version}`;
    if (identities.has(identity)) throw new TypeError("duplicate version manifest release");
    identities.add(identity);
  }
  return Object.freeze({
    schema_version: 1,
    releases
  });
}

async function fetchManifest(url, channel, currentVersion, fetchImpl = fetch) {
  if (!url) throw new TypeError("version manifest URL is required");
  if (!["stable", "test"].includes(channel)) throw new TypeError("invalid update channel");
  if (!semver.valid(currentVersion)) throw new TypeError("invalid current application version");
  const response = await fetchImpl(url, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error("version manifest HTTP " + response.status);
  const manifest = validateManifest(await response.json());
  const eligible = manifest.releases.filter((release) =>
    channel === "test" || release.channel === "stable"
  ).sort((left, right) => semver.rcompare(left.version, right.version));
  const latest = eligible[0] || null;
  if (!latest) return { status: "no_eligible_release", latest: null };
  return {
    status: semver.gt(latest.version, currentVersion) ? "update_available" : "up_to_date",
    latest
  };
}

module.exports = {
  fetchManifest,
  isAllowedReleaseUrl,
  shouldCheck,
  validateManifest
};
