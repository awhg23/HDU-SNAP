# HDU-SNAP 项目记忆

本文件供维护者和编码代理使用。内容必须保持中文、客观、简洁；架构、配置、路线图或验收状态变化时同步更新。

## 项目定位与版本状态

HDU-SNAP 是 Apple Silicon、macOS 13+ 的自包含英语单词答题 App。用户在 App 内手动登录、导航、运行答题、人工提交、维护补丁、查看记录和导出诊断，不需要外部 Python、Node、Chrome 或浏览器插件。

- 当前稳定分支：`main`；功能修改通过独立分支和 PR 合入。
- 当前正式版：`v2.4.0`，第二阶段已经完成，覆盖安装、真实答题和全部人工门禁均已通过。
- 产品官网：`https://hdu-snap.awhg23.chatgpt.site`；正式下载不依赖 GitHub。
- 公开仓库：`https://github.com/awhg23/HDU-SNAP`。
- 正式 Release：`https://github.com/awhg23/HDU-SNAP/releases/tag/v2.4.0`。
- 官网 DMG：`https://hdu-snap.awhg23.chatgpt.site/downloads/HDU-SNAP-v2.4.0.dmg`。
- 正式 DMG：`138,263,106` 字节，SHA-256 为 `4f42ab03d7b72576b59d630436413b828073d8531f7002b281ce83869bfc94bd`。
- 发布提交：`ff18bf9b7f970709940f0995bb0ad1e72bb7984b`；发布时间为 `2026-08-21T20:25:50Z`。
- 第二阶段需求：[docs/prd/PRD-001.md](docs/prd/PRD-001.md)。
- 技术选型：[docs/architecture/ADR-001-macos-app-stack.md](docs/architecture/ADR-001-macos-app-stack.md)。
- `v2.3.0` Release 继续保留，不得删除或覆盖。

长期方向是在不重复实现 Solver 的前提下扩展 Windows 和 Android。本阶段不实现这两个平台。

## 当前架构

```text
desktop/
├── src/main/       Electron 生命周期、网页容器、数据、诊断、更新、sidecar
├── src/preload/    本地 UI 最小 IPC 白名单
├── src/renderer/   首次引导、首页、学习、记录、设置、诊断
├── src/site/       隔离站点适配器与 DOM 自动化
├── src/shared/     批次状态机、常量和校验
├── test/           桌面领域、服务、安全和退出冒烟测试
└── scripts/        前端构建和发布资源检查

Electron 主进程
    → JSON Lines 标准输入/输出
    → src/hdu_snap/sidecar.py
    → Solver / 词典 / 补丁 / DeepSeek

website/
    → Sites 单页下载站
    → RELEASES R2
    → releases/v2.4.0/HDU-SNAP.dmg
```

Mac App 不启动 FastAPI，不监听 HTTP/WebSocket 端口。网站只使用一份持久数据分区；不识别或记录姓名学号，不保存密码，不提供账号隔离。

Python 保留：

```text
src/hdu_snap/
├── config.py
├── protocol.py
├── bootstrap.py
├── sidecar.py
├── domain/
├── application/
└── infrastructure/
```

第一阶段的 `extension/`、FastAPI API、CLI、报表、兼容入口、requirements 文件和旧安装/启动脚本已在 v2.4.0 正式版中删除，不得重新引入。版本化协议模型迁至 `hdu_snap.protocol`，必须完整保留 `solve_item`、`batch_complete`、`review_results`、`decision`、`error`、`batch_summary` 和 `review_results_ack` 的字段与解析语义。

## 产品与数据不变量

- 最后一题只选择答案，绝不自动提交。
- 保留手动登录、暂停、继续、停止和异常时人工接管。
- Mac App 只提供正常答题；不恢复调试模式、自动复盘或逐题持久化。
- 不恢复本地向量模型。决策顺序固定为“补丁规则 → 词典 → DeepSeek → 确定性兜底”。
- DeepSeek 不可用时固定选择 A，并明确标记“确定性兜底”。
- App 不识别或保存账号身份；记录与导出不含姓名、学号、模式或逐题内容。
- Cookie、Local Storage、IndexedDB 和缓存只存在唯一网站分区。
- 密码、Cookie、会话令牌、DeepSeek Key 和钥匙串内容不得进入 Git、日志、记录、诊断包、网页或 renderer。
- App 不接入遥测，不自动上传，不保存 GitHub Token，不自动下载或安装更新。
- `patch_rules.jsonc` 是可人工审查的发布补丁基线；新安装完整播种，升级只补缺失题目，不覆盖用户同题修正。
- `CET/Data.lexicon.cache.json` 是内置词典种子。
- 用户数据位于 `~/Library/Application Support/HDU-SNAP/`，数据结构当前为 V3，升级前保留最近三份备份。
- `runtime/`、`.models/`、`.venv/`、`.env`、依赖、数据库、日志、备份和生成报告不得进入版本控制。

## 官网与下载不变量

- 官网保持极简单页，核心文案固定为“我爱记单词自动化答题脚本”，保留系统要求、下载按钮和公开 GitHub 仓库链接。
- 官网复用奶油纸、陶土、芥末黄和深橄榄风格，不加载远程字体、图片或分析脚本。
- `website/.openai/hosting.json` 绑定 `RELEASES` R2，不使用 D1、账号、遥测或下载计数。
- v2.4.0 的 R2 key 固定为 `releases/v2.4.0/HDU-SNAP.dmg`；下载路由支持 GET、HEAD 和单区间 Range。
- R2 对象缺失或大小、SHA-256 元数据不匹配时返回 `503`，绝不跳转或回退到 GitHub。
- DMG 不进入源码 Git；官网发布记录必须与正式包的文件名、大小和 SHA-256 一致。
- App 内更新清单和 GitHub Release 链接保持现有机制，不因官网分发而修改。

## 桌面行为基线

- 首页每次启动默认 100 题，快捷题量固定为 90、95、100。
- 点击“进入学习站点”必须实际导航到设置的学习首页，并返回最新公共状态后再进入学习页。
- 412px 移动画布在主内容区水平居中；右侧答题详情贴近窗口右侧，最新题目置顶并可滚动查看，但只保存在主进程内存。
- 界面使用奶油纸、陶土、芥末黄和深橄榄暖色，不恢复蓝白商务风；视觉资源必须本地打包，不使用网络字体或远程图片。
- 自动化只允许 `skl.hdu.edu.cn` 和 `skl.hduhelp.com`；任意 HTTPS 可浏览，HTTP 逐次确认，证书错误阻断。
- 真实站点默认“自动下一题”且可能没有文字按钮；选择答案后应等待 DOM 自动切题，不能因缺少显式下一题按钮判定失败。
- 运行中最小化继续；睡眠、网页崩溃、加载失败或页面不可执行时自动暂停。
- 同题失败三次进入错误暂停；继续或重试前必须重新读取页面。
- 原生网页视图只由 renderer 当前页面显式控制可见性。创建时保持隐藏，销毁必须发生在窗口 `close` 阶段并保持幂等。
- 禁止在 Electron 43 的 `WebContentsView` 上调用 `enableDeviceEmulation()`；当前使用固定宽度、移动 UA 和 DevTools Protocol 平台/触摸覆盖。

## 补丁、记录、诊断与更新

- 补丁可通过设置页手动维护、JSON/JSONC 导入、旧项目迁移和结果页当前错题扫描写入。
- “记录错题”只扫描用户当前翻到的一题，不自动翻页、不批量采集；重复规则不重复写入，冲突必须确认后覆盖。
- 手动补丁草稿只在当前 renderer 进程保留，跨页面和设置标签不丢失；保存成功后清空。
- 补丁文件保持写入顺序，UI 使用副本倒序展示，最新规则在上。
- 记录每页 50 条，支持状态、起止日期筛选；结束日期包含当天，导出覆盖当前筛选全部页面，最多保留 1000 批。
- 诊断导出前必须勾选明确的隐私确认；主进程异常和网页崩溃上下文经脱敏后写入诊断包。
- 版本清单固定为 `https://raw.githubusercontent.com/awhg23/HDU-SNAP-update-manifest/main/manifest.json`。
- 清单只接受 `schema_version=1`、合法 stable/test 频道、SemVer、ISO 时间、64 位 SHA-256 和 `https://github.com/awhg23/HDU-SNAP/releases/tag/<version>`。
- 自动检查每 24 小时最多一次，手动检查不限；状态区分有新版本、已是最新和没有适用版本。
- 手动检查必须显示检查中状态，并在成功、无适用版本或失败时给出明确反馈；检查中禁止重复请求。

## Sidecar 与 LLM 约束

sidecar 只允许以下方法：

- `initialize`
- `health`
- `solve`
- `patch_list`
- `patch_update`
- `patch_delete`
- `check_api_key`
- `shutdown`

sidecar 初始化必须串行。运行中遇到 `CoreNotInitializedError` 或进程退出时，只重新初始化并重试当前核心请求一次，恢复失败后才进入题目层失败计数。stdout 只承载 JSON Lines；日志写 stderr。关联日志只能记录 PID、请求号、方法和错误类型，不能记录参数或密钥。

默认模型是 `deepseek-v4-flash`，地址为 `https://api.deepseek.com`。单字母分类必须传递 `extra_body={"thinking": {"type": "disabled"}}`，当前 `max_tokens=8`，并校验最终内容是 A–D。HTTP 200 不代表解析成功。

## 开发、测试与发布命令

```bash
.venv/bin/pip install -e ".[full,dev]"
.venv/bin/python -m pytest

cd desktop
npm ci
npm test
npm run build
npm run test:electron-exit

cd ../website
npm ci
npm run lint
npm test
```

日常真实站点验证必须先退出安装版，然后运行：

```bash
bash scripts/run_macos_dev.sh
```

`--isolated` 使用已忽略的 `runtime/desktop-dev/`。不能把每次修复都重新安装 DMG 作为日常流程。

只有发布候选与安装验收才运行：

```bash
cd desktop
npm run make:dmg
```

构建必须确认：arm64、sidecar 可初始化、补丁基线逐字节一致、不含 FastAPI/Uvicorn/向量依赖/旧插件资源、`prepared` 不重复进入 `app.asar` 和 `Resources`、DMG 可只读挂载。

## v2.4.0 发布验收记录

以下门禁已于正式发布前全部通过：

- 新本地用户首次引导、自检和可选 Key。
- 登录跨重启保留，清除网页登录数据后退出。
- 最小化继续；睡眠、断网、页面崩溃后安全暂停。
- 一次真实正常答题，最后一题由用户手动提交。
- 真实结果页记录错题：可识别、无法识别、重复和冲突补丁。
- 旧版补丁和 Key 迁入，重复迁移不重复写入。
- 记录日期筛选、分页、CSV/JSON、诊断 ZIP 和敏感信息扫描。
- 从 v2.3.0 覆盖安装候选版，数据、Cookie、Key、补丁和备份正常。
- 公开 Release 页面和官网独立下载入口均可匿名访问。

## 后续发布顺序

v2.4.0 已按以下顺序完成。后续版本继续遵循同一门禁：

1. 在功能分支完成、测试并推送。
2. 创建 PR，CI 全绿后普通合并到 `main`，禁止强制推送。
3. 从合并后的同一提交构建候选 DMG。
4. 用户使用该 DMG 完成人工门禁。
5. 仅在验收通过后创建对应版本 Tag 和公开 Release，上传同一份 DMG。
6. 将同一份 DMG 上传到官网 R2，核对文件大小和 SHA-256，并发布版本化下载路由。
7. 将实际发布时间、SHA-256 和 Release 链接写入公开清单。
8. 后续文档 PR 更新正式包信息，并核对 `main`、Tag、Release、清单、官网和工作区。

## 开放问题

- 结果页“记录错题”在更多真实 DOM 变体中是否需要新选择器。
- 未签名 DMG 在不同 macOS 13+ 小版本中的 Gatekeeper 操作是否一致。
- Windows 是否继续使用 PyInstaller sidecar。
- Android WebView 自动化和核心运行方案。
