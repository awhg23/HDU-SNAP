import Image from "next/image";
import Link from "next/link";
import { CURRENT_RELEASE } from "../lib/release";

export default function Home() {
  return (
    <main className="page-shell">
      <header>
        <Link className="brand" href="/" aria-label="HDU-SNAP 首页">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>HDU-SNAP</span>
        </Link>
        <a className="github-link" href="https://github.com/awhg23/HDU-SNAP">
          GitHub 仓库 <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section className="download-card" aria-labelledby="page-title">
        <div className="copy">
          <p className="version">HDU-SNAP · v{CURRENT_RELEASE.version}</p>
          <h1 id="page-title">我爱记单词<br />自动化答题脚本</h1>
          <p className="platform">Apple Silicon · macOS 13+</p>

          <a className="download-button" href={CURRENT_RELEASE.downloadPath}>
            下载 {CURRENT_RELEASE.fileName}
            <span aria-hidden="true">↓</span>
          </a>
          <p className="file-note">131.86 MiB · 未签名、未公证</p>
          <p className="open-note">首次运行请在 Finder 中右键 App，选择“打开”。</p>

          <details>
            <summary>校验安装包</summary>
            <dl>
              <div><dt>大小</dt><dd>{CURRENT_RELEASE.sizeLabel}</dd></div>
              <div><dt>SHA-256</dt><dd><code>{CURRENT_RELEASE.sha256}</code></dd></div>
            </dl>
          </details>
        </div>

        <div className="art" aria-hidden="true">
          <span className="art-backdrop" />
          <Image src="/study-companion.png" alt="" width={734} height={647} priority />
        </div>
      </section>

      <footer>
        <span>公开源码</span>
        <span aria-hidden="true">·</span>
        <a href="https://github.com/awhg23/HDU-SNAP">awhg23/HDU-SNAP</a>
      </footer>
    </main>
  );
}
