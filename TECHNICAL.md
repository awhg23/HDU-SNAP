# HDU-SNAP 技术文档

## 架构

第二阶段 macOS App：

```text
Electron 主进程
├── 本地应用 UI（严格 CSP、sandbox、contextIsolation）
├── WebContentsView（单一持久 persist: 分区）
│   └── 站点适配器预加载（DOM 识别、选择答案、翻页、提交观察）
├── 批次状态机、记录、迁移、诊断与版本检查
├── safeStorage / macOS Keychain（仅 DeepSeek Key）
└── JSON Lines stdio
    └── PyInstaller Python sidecar
        └── 现有 Solver、词典、向量、DeepSeek 与补丁存储
```

Mac App 主路径不启动 FastAPI，也不开放本机端口。`src/hdu_snap/sidecar.py` 复用现有应用层和基础设施，通过逐行 JSON 请求响应与 Electron 通信；协议输出固定走 stdout，诊断日志固定走 stderr。网页永远无法访问 Key 或 sidecar。

Electron 主进程通过单实例锁避免两个进程同时操作同一数据目录。`CoreSupervisor` 串行化 sidecar 初始化，所有业务请求先经过就绪门控；若运行中收到 `CoreNotInitializedError` 或发现 sidecar 意外退出，只重新初始化并重试当前请求一次。题目层的三次重试只统计恢复后仍然失败的请求。新增的 IPC 关联日志只记录 sidecar PID、请求编号、方法和错误类型，不记录请求参数或 Key；原有节点校验日志仍按产品诊断语义保留题目和选项。

远程网页使用 `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true` 和 `webSecurity=true`。任意 HTTPS 可浏览，但自动化只对 `skl.hduhelp.com` 与 `skl.hdu.edu.cn` 启用；HTTP 需要逐次确认，证书错误直接拒绝。App 只使用一个持久化 session partition，不解析账号身份；V1.0 升级时沿用一个旧分区以保留登录状态。

学习页的 412px `WebContentsView` 始终在侧栏以外的主内容区水平居中；本地答题详情面板独立贴近窗口右侧，宽度在 214–280px 范围内自适应，窗口最小宽度为 1100px，面板不得覆盖移动画布。主进程在内存中维护当前批次的逐题展示数据，renderer 将最新一题置顶并提供独立滚动；该数组不进入 `DesktopStore`、批次导出或诊断状态，新建批次和退出进程后清空。

本地 renderer 使用仓库级设计规范 `design-system/hdu-snap/MASTER.md`：颜色限定为奶油纸、陶土、芥末黄和深橄榄，图标使用内嵌 SVG，字体只使用 macOS 系统字体栈。`desktop/src/renderer/assets/study-companion.png` 是首次引导和首页共用的本地插画，`desktop/scripts/build.mjs` 会把它复制到 `desktop/dist/assets/`。CSP 继续禁止 renderer 网络请求，因此视觉资源不会绕过本地打包边界。

原生网页视图的可见性由 renderer 当前页面单向驱动：`BrowserController.open()` 只创建隐藏视图并等待学习首页加载，不自行显示；任务创建完成后主进程返回包含待就绪批次的最新 `publicState()`，renderer 更新状态后再进入学习页。renderer 每次渲染都会显式发送显示或隐藏意图，不缓存上一次意图，避免主进程创建视图后出现状态竞态、开始按钮缺失或网页覆盖本地设置页。

结果页纠错使用显式单次请求链路：renderer 的“记录错题”触发站点 preload 扫描当前 DOM；preload 只返回当前题目、A–D 选项、页面标示的正确选项和可选错选项；主进程重新校验支持域名、结果页状态、文本长度、四个选项和 A–D 目标，再调用 sidecar `patch_update`。请求设有 5 秒超时且同一时间只允许一个，网页不能直接写补丁文件。该链路不自动翻页、不写调试记录，也不恢复自动复盘。

第一阶段兼容架构（Mac App 真实验收前保留）：

```text
main.py / hdu-snap CLI
        │
        ▼
src/hdu_snap/
├── config.py              # Pydantic Settings、路径和客户端安全配置
├── domain/                # 纯领域类型与文本处理
├── application/           # Solver Pipeline 与调试反馈
├── infrastructure/        # SQLite、补丁、日志、向量和 LLM
├── api/                   # FastAPI、HTTP 与 WebSocket 协议
└── reporting/             # 调试报表

extension/
├── src/                   # 后台、内容脚本、设置页与共享源码
├── dist/                  # ESBuild 生成并提交的 Chrome 可加载产物
├── manifest.json
└── options.html
```

Python 模块导入不会创建文件、加载向量模型或发起网络请求。服务资源由 FastAPI lifespan 显式初始化，并可在测试中注入替代实现。

## 答题流程

Mac App 的运行控制由 `desktop/src/shared/batch-machine.cjs` 管理。运行中锁定导航和用户网页点击；睡眠会自动暂停；同题失败三次进入错误暂停。达到目标题量后，站点适配器只选择答案并发送 `final-pending`，随后解锁网页供用户亲自提交。只有检测到用户提交点击后才开始 15 秒结果页识别，超时允许人工二次确认。

纠错补丁可以在设置页手动添加，至少填写题目和正确答案；同题冲突需确认后替换。未保存表单只在 renderer 内存中保留，跨页面渲染不丢失，保存成功后清空且不进入持久状态。补丁存储继续按写入顺序返回，renderer 使用副本倒序渲染，使最新规则位于列表顶部而不改写补丁文件。用户也可以在结果页手动记录当前错题。直接导入接受 JSON/JSONC，旧项目迁移读取根目录 `patch_rules.jsonc`，所有入口最终调用同一个 sidecar 补丁存储。

Mac App 只提供正常答题，不自动遍历结果页、不自动复盘，也不持久化逐题调试内容。结果页仅支持由用户逐题触发的当前错题扫描。第一阶段 CLI/插件仍保留原有调试协议；共享 sidecar 的兼容复盘方法不作为桌面 UI 功能暴露。

仓库根目录 `patch_rules.jsonc` 同时是 Mac App 的发布补丁基线。资源准备脚本将其原样复制到 `Contents/Resources/prepared/core-resources/`；sidecar 在首次启动时原样复制到应用数据目录，升级时按规范化题目只合并缺失来源，已有用户规则优先。核心健康检查要求内置补丁非空，Electron 自检同时检查资源文件存在。Forge 完成后 `verify-packaged-resources.mjs` 对源文件和 `.app` 内文件做逐字节校验。

旧插件流程：

1. 用户手动登录并进入题目页。
2. 内容脚本等待后端安全配置，然后监听题目 DOM。
3. 后台脚本通过 WebSocket 将题目发送到本地后端。
4. Solver 按 `补丁 -> 字典 -> 向量 -> LLM/兜底` 决策。
5. 内容脚本点击选项并翻页。
6. 达到配置数量后挂起，不点击提交。
7. 旧版调试模式下，结果页错题会回传并写入补丁及调试记录；此能力不属于 Mac App。

## API 协议

- `GET /health`：兼容健康检查和运行状态。
- `GET /api/v1/client-config`：插件可见的无敏感配置，当前 `schema_version=1`、`protocol_version=1`。
- `WS /ws/solve`：答题和复盘协议。

客户端消息：`solve_item`、`batch_complete`、`review_results`。

服务端消息：`decision`、`error`、`batch_summary`、`review_results_ack`。

协议字段保持与重构前兼容。插件设置页仅保存 loopback 后端地址，不保存 API Key。

## 配置

配置优先级：

```text
CLI 参数 > 进程环境变量 > 根目录 .env > 默认值/交互输入
```

所有环境变量由 `Settings` 加载和校验。完整列表见 `.env.example`，主要分为：

- 运行模式和答题数量
- 服务 host、port 与日志级别
- 数据、词库、补丁和模型路径
- 向量阈值、LLM 地址与模型
- 插件延迟、重连、TTL 和移动端模拟配置

默认数据位置保持兼容：

- `runtime/hdu_snap.db`
- `runtime/debug_recent_10000.json`
- `runtime/debug_error_1000.json`
- `patch_rules.jsonc`
- `CET/Data.lexicon.cache.json`
- `.models/moka-ai_m3e-base`

`HDU_SNAP_DATA_DIR` 只改变数据库、调试日志和报表目录，不自动迁移旧数据。

## 开发与验证

```bash
python -m pip install -e ".[dev]"
python -m pytest
cd extension
npm ci
npm test
npm run build

cd ../desktop
npm ci
npm test
npm run build
```

真实站点的日常源码验收从仓库根目录执行：

```bash
bash scripts/run_macos_dev.sh
```

该模式使用默认应用数据目录，与安装版共享网页登录会话和记录，因此必须先完全退出已安装版。`bash scripts/run_macos_dev.sh --isolated` 改用 `runtime/desktop-dev/`，适合破坏性或首次引导测试。单实例锁按数据目录生效；日常修改不生成 DMG，只有发布和安装验收才执行下面的打包流程。

打包要求 Xcode、Apple Silicon Python 3.10+ 和完整本地模型。`scripts/build_macos_sidecar.sh` 生成冻结核心，`desktop/scripts/prepare-resources.mjs` 准备词典、补丁基线和模型，Electron Forge 生成未签名 App/DMG；构建末尾会校验安装包补丁与仓库基线一致。技术选型记录见 `docs/architecture/ADR-001-macos-app-stack.md`。

CI 在 Ubuntu Python 3.10/3.12、macOS 3.10 和 Windows 3.10 上运行轻量测试；插件任务验证测试、构建以及 `dist/` 是否与源码同步。CI 不下载向量模型、不请求 DeepSeek、不访问真实题目站点。
