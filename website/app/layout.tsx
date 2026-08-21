import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "HDU-SNAP｜我爱记单词自动化答题脚本";
const description = "面向 Apple Silicon、macOS 13+ 的我爱记单词自动化答题脚本。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", base).toString();

  return {
    metadataBase: base,
    title,
    description,
    icons: {
      icon: "/study-companion.png",
      apple: "/study-companion.png",
    },
    openGraph: {
      type: "website",
      url: base,
      siteName: "HDU-SNAP",
      title,
      description,
      images: [{ url: socialImage, width: 1672, height: 941, alt: "HDU-SNAP 产品官网" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
