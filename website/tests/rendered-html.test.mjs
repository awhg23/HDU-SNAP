import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { serveRelease } from "../lib/download.mjs";

const RELEASE_SIZE = 138_263_106;
const RELEASE_SHA = "4f42ab03d7b72576b59d630436413b828073d8531f7002b281ce83869bfc94bd";
const DOWNLOAD_PATH = "/downloads/HDU-SNAP-v2.4.0.dmg";
const RELEASE = {
  fileName: "HDU-SNAP.dmg",
  objectKey: "releases/v2.4.0/HDU-SNAP.dmg",
  size: RELEASE_SIZE,
  sha256: RELEASE_SHA,
};

function streamFixture() {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("fixture"));
      controller.close();
    },
  });
}

function releaseObject(range) {
  return {
    key: "releases/v2.4.0/HDU-SNAP.dmg",
    version: "fixture",
    size: RELEASE_SIZE,
    etag: "fixture-etag",
    httpEtag: '"fixture-etag"',
    uploaded: new Date("2026-08-21T20:25:50Z"),
    httpMetadata: {},
    customMetadata: { sha256: RELEASE_SHA },
    checksums: {},
    storageClass: "Standard",
    body: streamFixture(),
    bodyUsed: false,
    range,
  };
}

function fakeBucket({ missing = false } = {}) {
  return {
    async head() {
      return missing ? null : releaseObject(undefined);
    },
    async get(_key, options) {
      return missing ? null : releaseObject(options?.range);
    },
  };
}

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function fetchSite(path = "/", options = {}, bucket = fakeBucket()) {
  const siteWorker = await worker();
  return siteWorker.fetch(
    new Request(new URL(path, "http://localhost"), options),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      RELEASES: bucket,
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

function fetchDownload(options = {}, bucket = fakeBucket()) {
  const request = new Request(new URL(DOWNLOAD_PATH, "http://localhost"), options);
  return serveRelease(request, bucket, RELEASE, options.method === "HEAD");
}

test("server-renders the minimal HDU-SNAP download page", async () => {
  const response = await fetchSite();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]+lang="zh-CN"/i);
  assert.match(html, /HDU-SNAP｜我爱记单词自动化答题脚本/);
  assert.match(html, /我爱记单词/);
  assert.match(html, /自动化答题脚本/);
  assert.match(html, /Apple Silicon/);
  assert.match(html, /macOS 13\+/);
  assert.match(html, /首次运行请在 Finder 中右键 App/);
  assert.match(html, new RegExp(DOWNLOAD_PATH.replaceAll(".", "\\.")));
  assert.match(html, /https:\/\/github\.com\/awhg23\/HDU-SNAP/);
  assert.match(html, /http:\/\/localhost:3000\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
  assert.doesNotMatch(html, /github\.com\/awhg23\/HDU-SNAP\/releases\/download/i);
  assert.doesNotMatch(html, /WHAT IT DOES|PRIVACY BY DESIGN|五步开始/);
});

test("serves the immutable DMG with safe download headers", async () => {
  const response = await fetchDownload();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-apple-diskimage");
  assert.equal(response.headers.get("content-length"), String(RELEASE_SIZE));
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="HDU-SNAP.dmg"');
  assert.match(response.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(response.headers.get("location"), null);

  const head = await fetchDownload({ method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(RELEASE_SIZE));
  assert.equal(await head.text(), "");
});

test("supports one resumable byte range and rejects invalid ranges", async () => {
  const partial = await fetchDownload({ headers: { range: "bytes=0-1023" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-length"), "1024");
  assert.equal(partial.headers.get("content-range"), `bytes 0-1023/${RELEASE_SIZE}`);

  const suffix = await fetchDownload({ headers: { range: "bytes=-512" } });
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get("content-length"), "512");
  assert.equal(suffix.headers.get("content-range"), `bytes ${RELEASE_SIZE - 512}-${RELEASE_SIZE - 1}/${RELEASE_SIZE}`);

  const invalid = await fetchDownload({ headers: { range: "bytes=0-1,4-5" } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), `bytes */${RELEASE_SIZE}`);
});

test("fails closed when the release object is missing and rejects unknown paths", async () => {
  const missing = await fetchDownload({}, fakeBucket({ missing: true }));
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get("location"), null);
  assert.match(await missing.text(), /安装包暂不可用/);

  const unknown = await fetchSite("/downloads/not-a-release.dmg");
  assert.equal(unknown.status, 404);
});

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, root);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.(?:css|ts|tsx)$/.test(entry.name) ? [url] : [];
  }));
  return nested.flat();
}

test("ships without starter, analytics, remote download fallbacks, or upload endpoints", async () => {
  const files = await sourceFiles(new URL("../app/", import.meta.url));
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");

  assert.doesNotMatch(source, /releases\/download|google-analytics|googletagmanager|segment\.com|posthog|plausible/i);
  assert.doesNotMatch(source, /api\/admin|uploadId|UPLOAD_SECRET/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|drizzle/i);
  assert.equal(files.some((file) => file.pathname.includes("/_sites-preview/")), false);
});
