import { env } from "cloudflare:workers";
import { serveRelease } from "../../../lib/download.mjs";
import { CURRENT_RELEASE } from "../../../lib/release";

type ReleaseEnvironment = Readonly<{ RELEASES: R2Bucket }>;

function bucket(): R2Bucket {
  return (env as unknown as ReleaseEnvironment).RELEASES;
}

export async function GET(request: Request): Promise<Response> {
  return serveRelease(request, bucket(), CURRENT_RELEASE);
}

export async function HEAD(request: Request): Promise<Response> {
  return serveRelease(request, bucket(), CURRENT_RELEASE, true);
}
