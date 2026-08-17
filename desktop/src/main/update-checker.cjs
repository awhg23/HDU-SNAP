"use strict";

const { UPDATE_CHECK_INTERVAL_MS } = require("../shared/constants.cjs");

function shouldCheck(lastCheckedAt, now = Date.now()) {
  if (!lastCheckedAt) return true;
  const timestamp = new Date(lastCheckedAt).getTime();
  return !Number.isFinite(timestamp) || now - timestamp >= UPDATE_CHECK_INTERVAL_MS;
}

async function fetchManifest(url, channel, fetchImpl = fetch) {
  if (!url) return { status: "not_configured" };
  const response = await fetchImpl(url, { redirect: "follow", cache: "no-store" });
  if (!response.ok) throw new Error("version manifest HTTP " + response.status);
  const manifest = await response.json();
  if (!Array.isArray(manifest.releases)) throw new TypeError("invalid version manifest");
  const eligible = manifest.releases.filter((release) =>
    channel === "test" || release.channel === "stable"
  );
  return { status: "ok", latest: eligible[0] || null };
}

module.exports = { fetchManifest, shouldCheck };
