# HDU-SNAP

HDU-SNAP 是一款本地运行的 macOS 英语单词答题工具。它把内嵌学习网页、答题核心、补丁维护、记录和诊断整合在一个自包含 App 中；最终提交始终由用户亲自完成。

当前正式版为 **v2.4.0**，第二阶段已经完成。该版本补齐记录分页与日期筛选、诊断隐私确认和崩溃上下文、固定公开版本清单，并正式删除第一阶段 Chrome 插件、本地 HTTP/WebSocket 服务和 CLI。覆盖安装、真实答题、最终题人工提交、错题记录和全部人工门禁均已通过。

开发者可先阅读 [开发文件指南](docs/DEVELOPMENT_FILE_GUIDE.md)，了解现存文件的职责和必备性。完整需求见 [PRD-001](docs/prd/PRD-001.md)。

## 正式版下载

- 官网：[hdu-snap.awhg23.chatgpt.site](https://hdu-snap.awhg23.chatgpt.site)
- DMG：[HDU-SNAP.dmg](https://hdu-snap.awhg23.chatgpt.site/downloads/HDU-SNAP-v2.4.0.dmg)
- 公开源码：[awhg23/HDU-SNAP](https://github.com/awhg23/HDU-SNAP)
- 历史发布记录：[HDU-SNAP v2.4.0](https://github.com/awhg23/HDU-SNAP/releases/tag/v2.4.0)
- 系统：Apple Silicon、macOS 13+
- 交付方式：未签名、未公证 DMG
- 发布时间：`2026-08-21T20:25:50Z`
- 文件大小：`138,263,106` 字节
- SHA-256：`4f42ab03d7b72576b59d630436413b828073d8531f7002b281ce83869bfc94bd`

官网从独立对象存储分发 DMG，不依赖 GitHub Release 下载链路。首次运行方式见 [macOS 使用指南](MACOS_GUIDE.md)。

## 产品能力

- App 内手动登录并保留一份跨重启的网站会话。
- 默认 100 题，快捷题量为 90、95、100，也可输入任意正整数。
- 决策顺序固定为“补丁规则 → 词典 → DeepSeek → 确定性兜底”。
- 支持暂停、继续、停止、同题三次重试和异常自动暂停。
- 最后一题只选择答案，绝不自动点击提交。
- 结果页可由用户逐题点击“记录错题”，也可手动添加或导入 JSON/JSONC 补丁。
- 记录支持状态、起止日期筛选和每页 50 条分页；CSV/JSON 导出覆盖当前筛选的全部结果。
- 诊断包只有在用户勾选隐私确认后才能导出，且排除密码、Cookie、会话令牌和 DeepSeek Key。
- 版本检查读取固定的公开清单，只展示版本和公开 Release 记录，不保存 GitHub Token，也不自动下载或安装。

App 不识别或保存姓名学号，不保存密码，不提供账号隔离、调试复盘、向量模型或逐题持久化。

## 安装与使用

1. 打开 DMG，将 HDU-SNAP 拖入“应用程序”。
2. 在 Finder 中右键 App 并选择“打开”；若仍被阻止，在“系统设置 → 隐私与安全性”中允许。
3. 完成首次自检。DeepSeek Key 可跳过；保存时由 macOS 钥匙串保护。
4. 输入题量并进入学习站点，手动登录和导航到题目页。
5. 识别成功后点击“开始答题”。达到目标后亲自检查并提交。

用户数据位于：

```text
~/Library/Application Support/HDU-SNAP/
```

升级前会自动保留最近三份数据结构备份。内置补丁首次完整播种，升级只补入缺失题目，不覆盖用户已有修正。

## 源码开发

要求 Xcode、Apple Silicon Mac、Node.js 和 Python 3.10+。

```bash
python3.12 -m venv .venv
.venv/bin/pip install -e ".[full,dev]"
cd desktop
npm ci
```

日常桌面调试无需安装 DMG。先完全退出已安装版，再从仓库根目录运行：

```bash
bash scripts/run_macos_dev.sh
```

默认复用正式 App 的本地数据和登录会话；隔离测试使用：

```bash
bash scripts/run_macos_dev.sh --isolated
```

完整自动化验证：

```bash
.venv/bin/python -m pytest
cd desktop
npm test
npm run build
npm run test:electron-exit
```

仅发布候选或安装验收需要构建 DMG：

```bash
cd desktop
npm run make:dmg
```

产物位于 `desktop/out/make/`。构建过程会生成 Apple Silicon Python sidecar，并校验安装包中的词典、补丁基线、架构和资源布局。

## 架构边界

```text
Electron 本地 UI + 隔离 WebContentsView
                  │
                  │ JSON Lines 标准输入/输出
                  ▼
          Python sidecar
                  │
                  ▼
       Solver / 词典 / 补丁 / DeepSeek
```

Mac App 不监听本机 HTTP/WebSocket 端口。跨平台协议模型保留在 `hdu_snap.protocol`，但第一阶段的 Chrome 插件、FastAPI 服务、CLI、调试报表和旧启动脚本已在 v2.4.0 正式版中退场。

更多资料：

- [技术文档](TECHNICAL.md)
- [macOS 使用指南](MACOS_GUIDE.md)
- [技术选型 ADR](docs/architecture/ADR-001-macos-app-stack.md)
- [PRD 台账](docs/PRD_REGISTRY.md)
