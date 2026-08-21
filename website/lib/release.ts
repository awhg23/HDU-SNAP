export type ReleaseInfo = Readonly<{
  version: string;
  channel: "stable";
  publishedAt: string;
  publishedAtLabel: string;
  fileName: string;
  objectKey: string;
  size: number;
  sizeLabel: string;
  sha256: string;
  downloadPath: string;
}>;

export const CURRENT_RELEASE: ReleaseInfo = Object.freeze({
  version: "2.4.0",
  channel: "stable",
  publishedAt: "2026-08-21T20:25:50Z",
  publishedAtLabel: "2026-08-22 04:25（北京时间）",
  fileName: "HDU-SNAP.dmg",
  objectKey: "releases/v2.4.0/HDU-SNAP.dmg",
  size: 138_263_106,
  sizeLabel: "138,263,106 字节（131.86 MiB）",
  sha256: "4f42ab03d7b72576b59d630436413b828073d8531f7002b281ce83869bfc94bd",
  downloadPath: "/downloads/HDU-SNAP-v2.4.0.dmg",
});
