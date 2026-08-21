function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return "invalid";

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "invalid";
    const length = Math.min(suffixLength, size);
    return { offset: size - length, length };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    return "invalid";
  }
  const end = Math.min(requestedEnd, size - 1);
  return { offset: start, length: end - start + 1 };
}

function baseHeaders(release, size, etag) {
  return new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": `attachment; filename="${release.fileName}"`,
    "Content-Length": String(size),
    "Content-Type": "application/x-apple-diskimage",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  });
}

function unavailable() {
  return new Response("安装包暂不可用，请稍后重试。", {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": "300",
    },
  });
}

export async function serveRelease(request, bucket, release, headOnly = false) {
  const metadata = await bucket.head(release.objectKey);
  if (!metadata || metadata.size !== release.size || metadata.customMetadata?.sha256 !== release.sha256) {
    return unavailable();
  }

  const range = parseRange(request.headers.get("range"), metadata.size);
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${metadata.size}`,
      },
    });
  }

  const headers = baseHeaders(release, range?.length ?? metadata.size, metadata.httpEtag);
  if (range) headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
  if (headOnly) return new Response(null, { status: range ? 206 : 200, headers });

  const object = await bucket.get(release.objectKey, range ? { range } : undefined);
  if (!object) return unavailable();
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
