# HDU-SNAP 开发文件指南

本文解释 HDU-SNAP 当前仓库中各文件的职责、所属产品形态和必备性。阅读完本文后，维护者应能判断一个文件属于命令行版、Chrome 插件、桌面版、共享核心，还是仅为本地生成物，并能在删除或重构前知道它是否仍被使用。

本文以 macOS App 2.2.0 和第一阶段兼容版并存的仓库状态为准。新增、移动或删除文件，以及改变入口、打包资源或退场范围时，应同步更新本文和根目录 `AGENTS.md`。

## 1. 阅读口径

### 1.1 产品形态

| 标记 | 含义 |
|---|---|
| 共享 | 命令行版和桌面版共同复用的 Python 答题核心或数据资源。 |
| CLI | 第一阶段 Python 命令行后端；通过本机 HTTP/WebSocket 服务插件。 |
| 插件 | 第一阶段 Chrome Manifest V3 自动化客户端，必须与 CLI 后端配套。 |
| 桌面 | 第二阶段 Electron macOS App，包括 UI、内嵌网页和 sidecar 桥。 |
| 开发 | 测试、CI、构建、文档或维护工具，不直接进入最终运行路径。 |

### 1.2 必备性

| 标记 | 判断标准 |
|---|---|
| 必备 | 当前对应产品无法运行、构建或保证关键数据语义时不能删除。 |
| 兼容期必备 | 仅第一阶段 CLI/插件仍保留时必备；完成 Mac App 全部验收和旧版退场后可以整组删除。 |
| 发布必备 | 日常源码运行不一定需要，但制作自包含 App/DMG 时必需。 |
| 开发必备 | 最终用户运行不需要，但可靠开发、测试或可复现安装需要。 |
| 可生成 | 不应手改；删除后可以通过构建或安装命令重新产生。 |
| 可选 | 缺失时有降级路径或只影响辅助能力。 |
| 本地私有 | 只属于当前机器，禁止提交 Git。 |
| 非项目文件 | 操作系统或工具留下的垃圾/缓存，可以删除。 |

### 1.3 “每个文件”的范围

本文逐个列出项目自有源码、配置、脚本、测试、文档和已知构建入口。以下内容由第三方工具批量生成，按目录说明，不逐个枚举其内部成千上万个文件：

- `.git/`
- `.venv/`、`.venv-python*-backup-*/`
- `desktop/node_modules/`、`extension/node_modules/`
- `.models/moka-ai_m3e-base/`
- `build/`、`desktop/out/`、`desktop/resources/prepared/`
- `src/hdu_snap.egg-info/`、`__pycache__/`、`.pytest_cache/`

## 2. 两条运行链路

命令行版和桌面版共用 Solver，但入口和网页自动化方式不同。

```text
第一阶段命令行版

main.py / hdu-snap CLI
  → hdu_snap.cli
  → hdu_snap.api（FastAPI + HTTP/WebSocket）
  → ServiceContainer
  → SolverPipeline
  ← Chrome extension/

第二阶段桌面版

desktop/src/main/index.cjs（Electron）
  → SidecarClient / CoreSupervisor
  → JSON Lines 标准输入输出
  → hdu_snap.sidecar
  → ServiceContainer
  → SolverPipeline
  ← WebContentsView + desktop/src/site/
```

关键边界：

- `src/hdu_snap/domain/`、`application/`、`infrastructure/` 是共享核心，不能依赖 Electron、Chrome 或 FastAPI 的专用实现。
- `src/hdu_snap/api/`、`cli.py`、`browser.py` 和 `extension/` 属于第一阶段命令行版体系。
- `src/hdu_snap/sidecar.py` 和整个 `desktop/` 属于桌面版体系。
- 桌面版主路径不启动 FastAPI，不监听本机端口，也不读取根目录 `.env` 保存用户 Key。
- `CET/Data.lexicon.cache.json` 与 `patch_rules.jsonc` 同时服务两条链路。

## 3. 根目录文件

| 文件 | 归属 | 作用 | 必备性 |
|---|---|---|---|
| `.env` | CLI | 当前机器的 CLI 环境变量和 DeepSeek Key。Pydantic Settings 会加载它；桌面安装版不用它。 | CLI 可选、本地私有，禁止提交。 |
| `.env.example` | CLI / 开发 | 所有 CLI 环境变量的无密钥模板、默认值和范围说明。 | 兼容期开发必备。 |
| `.gitattributes` | 开发 | 统一文本 LF 行尾，并把数据库、图片、PDF 标记为二进制。 | 仓库维护必备。 |
| `.gitignore` | 开发 | 排除密钥、模型、虚拟环境、依赖、运行数据和构建产物。 | 安全与仓库维护必备。 |
| `AGENTS.md` | 开发 | 中文项目记忆、架构边界、安全约束和当前验收状态；编码代理的规范来源。 | 维护必备，不进入运行时。 |
| `README.md` | 开发 | 项目总入口、快速开始和两种产品形态的常用命令。 | 维护必备。 |
| `TECHNICAL.md` | 开发 | 架构、协议、配置和开发验证的技术说明。 | 维护必备。 |
| `MACOS_GUIDE.md` | 桌面 / 开发 | macOS App 安装、源码验收、DMG 构建和 Gatekeeper 操作指南。 | 桌面发布文档必备。 |
| `VERSION` | 开发 | 只包含 `1.0.0`，当前没有代码或构建脚本读取。 | 非必备；不能作为版本真源。清理前应先统一三处实际版本源。 |
| `pyproject.toml` | 共享 / CLI / 桌面 | Python 3.10+ 元数据、基础/full/dev 依赖、pytest 配置，以及 `hdu-snap`、`hdu-snap-sidecar` 命令入口。 | Python 开发、CLI 安装和 sidecar 构建必备。 |
| `requirements-lite.txt` | CLI | 兼容旧安装方式，等价于可编辑安装基础包 `-e .`。 | 兼容期必备。 |
| `requirements.txt` | CLI / 桌面发布 | 兼容完整安装，等价于 `-e .[full]`；准备本地模型和 sidecar 构建环境时使用。 | 兼容期与桌面发布必备。 |
| `main.py` | CLI | `python main.py` 的薄兼容入口，转发到 `hdu_snap.cli:main`。 | 兼容期必备。 |
| `generate_debug_report.py` | CLI | 旧的调试报告命令入口，转发到 `hdu_snap.reporting.report:main`。 | 兼容期必备。 |
| `start_backend.sh` | CLI | 根目录兼容包装器，转发到 `scripts/start_backend.sh`。 | 兼容期必备。 |
| `setup_full_macos.sh` | CLI | 根目录 macOS 完整环境安装兼容包装器。 | 兼容期必备；桌面开发也可借它准备完整 Python 环境。 |
| `setup_full_windows.ps1` | CLI | 根目录 Windows 完整环境安装兼容包装器。 | Windows CLI 兼容期必备。 |
| `install_vector_tier.sh` | CLI / 共享 | 根目录向量模型安装兼容包装器。 | 完整向量模式可选；兼容期保留。 |
| `patch_rules.jsonc` | 共享 | 经过确认的纠错规则；CLI 直接使用，也是桌面安装包的内置补丁基线。 | 共享运行和桌面发布必备，不能随意删除或有损改写。 |
| `CET/Data.lexicon.cache.json` | 共享 | 内置词典种子，初始化 SQLite 词典缓存和答题匹配。 | 共享运行和桌面发布必备。 |
| `.DS_Store`、`CET/.DS_Store` | 非项目 | Finder 自动生成的目录元数据。 | 不需要，可删除且不得提交。 |

版本真源目前分散在：

- Python/CLI：`pyproject.toml` 的 `[project].version`
- 桌面版：`desktop/package.json` 的 `version`
- 插件版：`extension/manifest.json` 和 `extension/package.json` 的 `version`

## 4. 共享 Python 核心

### 4.1 包入口与配置

| 文件 | 作用 | 必备性 |
|---|---|---|
| `src/hdu_snap/__init__.py` | Python 包标记和 CLI 包版本 `__version__`。 | 共享必备；版本需与 `pyproject.toml` 同步。 |
| `src/hdu_snap/config.py` | Pydantic Settings v2、路径解析、环境变量别名、数值/安全校验和客户端安全配置。 | 共享必备。桌面 sidecar 注入路径和 Key，CLI 额外加载 `.env`。 |
| `src/hdu_snap/bootstrap.py` | 创建 `ServiceContainer`，在显式启动阶段组装词典、向量、LLM、补丁和调试存储。 | 共享必备。 |
| `src/hdu_snap/api/__init__.py` | 当前协议模型所在包的标记；虽然包名是 `api`，桌面 sidecar 也会导入其中的协议模型。 | 当前共享包结构必备。 |
| `src/hdu_snap/api/contracts.py` | `solve_item`、`batch_complete`、`review_results` 及响应的 Pydantic 协议模型和输入规范化；CLI WebSocket 与桌面 sidecar 共用。 | 共享协议必备，未来移动时必须保持语义兼容。 |
| `src/hdu_snap/application/__init__.py` | application 子包标记和职责说明。 | 共享包结构必备。 |
| `src/hdu_snap/application/solver.py` | 核心答题流水线；保持“补丁 → 词典 → 向量 → LLM/确定性兜底”，记录调试数据并处理复盘结果。 | 共享业务必备。 |

### 4.2 领域层

| 文件 | 作用 | 必备性 |
|---|---|---|
| `src/hdu_snap/domain/__init__.py` | domain 子包标记。 | 共享包结构必备。 |
| `src/hdu_snap/domain/models.py` | `TierDecision`、`RuntimeOptions`、`RunStats`、向量分数和字典结果等纯领域类型。 | 共享业务必备。 |
| `src/hdu_snap/domain/text.py` | 题目/选项清洗、中文释义切分、规范化和轻量相似度函数。 | 共享业务必备。 |

### 4.3 基础设施层

| 文件 | 作用 | 必备性 |
|---|---|---|
| `src/hdu_snap/infrastructure/__init__.py` | infrastructure 子包标记。 | 共享包结构必备。 |
| `src/hdu_snap/infrastructure/dictionary.py` | 从词典 JSON 初始化/读取 SQLite，执行精确匹配、翻译提示和冲突判断。 | 共享业务必备。 |
| `src/hdu_snap/infrastructure/models.py` | 本地 Sentence Transformers 向量决策与 DeepSeek LLM 适配；负责阈值、重试、V4 禁用思考和确定性兜底。 | 共享必备；无模型/Key 时部分能力降级。 |
| `src/hdu_snap/infrastructure/stores.py` | 调试 JSON 存储、旧文件迁移和 JSONC 补丁增删改查；负责内置补丁按题目补缺且不覆盖用户规则。 | 共享数据必备。 |

## 5. 第一阶段命令行后端

以下入口只服务 CLI、本机 FastAPI 和 Chrome 插件通信。注意协议模型目前仍位于 `src/hdu_snap/api/contracts.py`，并被桌面 sidecar 复用，不属于可直接删除的 CLI 专用实现。

| 文件 | 作用 | 必备性 |
|---|---|---|
| `src/hdu_snap/cli.py` | `hdu-snap serve/report/config --check` 参数解析、交互回退、日志配置和 Uvicorn 启动。 | CLI 兼容期必备。 |
| `src/hdu_snap/browser.py` | 按配置打开 Chrome/系统浏览器目标页面；只属于 CLI 自动打开站点功能。 | CLI 兼容期必备。 |
| `src/hdu_snap/api/app.py` | FastAPI 工厂、lifespan、`/health`、`/api/v1/client-config` 和 `/ws/solve`。 | CLI 兼容期必备。 |
| `src/hdu_snap/reporting/__init__.py` | reporting 子包标记。 | CLI 调试报告兼容期必备。 |
| `src/hdu_snap/reporting/report.py` | 汇总 CLI 调试 JSON，生成 HTML 报告和 JSON 摘要。 | CLI 调试能力必备，普通答题可不调用。 |

## 6. 桌面版 Python sidecar

| 文件 | 作用 | 必备性 |
|---|---|---|
| `src/hdu_snap/sidecar.py` | 桌面版无端口 Python 入口；通过 JSON Lines 提供应答、健康检查、补丁管理和 Key 验证。仍保留第一阶段兼容所需的复盘方法，但 Mac App 不调用。负责首次复制安装包补丁、升级补缺和 stdout/stderr 隔离。 | 桌面运行与发布必备；不属于 CLI HTTP 服务。 |

sidecar 通过 `pyproject.toml` 的 `hdu-snap-sidecar` 命令或 PyInstaller 冻结可执行文件启动。Electron 不应直接导入 Python 模块，而应始终经过此协议边界。

## 7. 根目录 `scripts/`

| 文件 | 归属 | 作用 | 必备性 |
|---|---|---|---|
| `scripts/lib/python_env.sh` | CLI / 开发 | macOS/Linux 共用的 Python 3.10+ 探测、旧 `.venv` 安全备份和新环境创建函数。 | CLI 安装脚本必备。 |
| `scripts/start_backend.sh` | CLI | 安装 lite/full 依赖并执行 `main.py`；使用标记文件避免每次重复安装。 | CLI 兼容期必备。 |
| `scripts/setup_full_macos.sh` | CLI / 桌面开发 | 准备完整 Python 依赖和本地向量模型。 | CLI 完整模式必备；桌面发布环境准备需要。 |
| `scripts/setup_full_windows.ps1` | CLI | Windows Python 版本检查、旧虚拟环境备份、依赖和模型安装。 | Windows CLI 兼容期必备。 |
| `scripts/install_vector_tier.sh` | CLI / 共享 | 安装 Torch/Sentence Transformers 并下载 `moka-ai/m3e-base` 到 `.models/`。 | 向量完整模式和桌面发布资源准备需要；lite 模式可选。 |
| `scripts/run_macos_dev.sh` | 桌面 | 启动桌面源码版；默认复用正式 App 数据，`--isolated` 使用 `runtime/desktop-dev/`。 | 桌面日常开发必备。 |
| `scripts/build_macos_sidecar.sh` | 桌面发布 | 用 Apple Silicon Python 和 PyInstaller 生成 onedir sidecar 到桌面准备资源目录。 | DMG 发布必备，日常源码运行可不执行。 |

## 8. Chrome 插件 `extension/`

整个目录属于第一阶段命令行版的浏览器客户端。Mac App 的 `WebContentsView` 不加载这些文件。完成 Mac App 正常答题、旧版补丁迁移和安装验收后，按 PRD 退场顺序可以整目录删除。

### 8.1 配置和可直接加载文件

| 文件 | 作用 | 必备性 |
|---|---|---|
| `extension/manifest.json` | Manifest V3 权限、HDU 域名、loopback 权限、Service Worker、内容脚本和设置页入口。 | 插件兼容期必备。 |
| `extension/options.html` | 插件后端地址设置页结构。 | 插件兼容期必备。 |
| `extension/options.css` | 设置页样式。 | 插件兼容期必备。 |
| `extension/package.json` | ESBuild/Vitest 依赖和 `build/test/check` 命令。 | 插件开发必备。 |
| `extension/package-lock.json` | 锁定 Node 依赖，保证 CI 和本地构建一致。 | 插件可复现开发必备。 |
| `extension/scripts/build.mjs` | 把后台、内容端和设置页三个入口打包到 `dist/`。 | 插件构建必备。 |

### 8.2 插件源码

| 文件 | 作用 | 必备性 |
|---|---|---|
| `extension/src/shared/backend-url.js` | 只允许 localhost/127.0.0.1，读取插件存储并生成 HTTP/WS 地址。 | 插件必备。 |
| `extension/src/background/index.js` | Service Worker 主入口；获取客户端配置、管理 WebSocket、消息排队/路由、标签状态和 Chrome Debugger 移动模拟。 | 插件必备。 |
| `extension/src/background/tab-state-store.js` | 按标签页把考试/复盘状态写入内存和 `chrome.storage.local`，并按 TTL 清理。 | 插件必备。 |
| `extension/src/background/transport-policy.js` | WebSocket 指数退避和会话/题目路由键生成。 | 插件必备。 |
| `extension/src/content/automation-policy.js` | 根据是否最后一题、是否存在下一题/提交按钮决定继续、等待或挂起。 | 插件必备。 |
| `extension/src/content/dom.js` | 插件题目与 A–D 选项的纯 DOM 文本规范化工具。 | 插件必备。 |
| `extension/src/content/state.js` | 插件运行状态、默认延迟、题量和后端安全配置应用。 | 插件必备。 |
| `extension/src/content/review.js` | 从结果页文本推断错选/正确选项和错误状态。 | 调试复盘必备。 |
| `extension/src/content/review-state.js` | 初始化复盘状态机字段。 | 调试复盘必备。 |
| `extension/src/content/index.js` | 内容脚本主入口；扫描题目、请求决策、点击/翻页、最终挂起、结果页采集和 ACK 流程。 | 插件必备。 |
| `extension/src/options/index.js` | 设置页加载、地址校验、保存、恢复默认和连接测试。 | 插件设置必备。 |

### 8.3 插件构建产物

这些文件由 `npm run build` 生成，但当前必须提交，因为用户直接在 Chrome 加载 `extension/`。

| 文件 | 源文件 | 必备性 |
|---|---|---|
| `extension/dist/background.js` | `src/background/index.js` bundle。 | 插件运行必备、可重新生成，不手改。 |
| `extension/dist/content.js` | `src/content/index.js` bundle。 | 插件运行必备、可重新生成，不手改。 |
| `extension/dist/options.js` | `src/options/index.js` bundle。 | 插件设置必备、可重新生成，不手改。 |

### 8.4 插件测试

| 文件 | 覆盖内容 | 必备性 |
|---|---|---|
| `extension/test/backend-url.test.js` | loopback 后端地址校验与 URL 拼接。 | 插件开发/CI 必备。 |
| `extension/test/content-policy.test.js` | 翻页、等待和最终题挂起策略。 | 插件开发/CI 必备。 |
| `extension/test/manifest.test.js` | Manifest 路径和权限。 | 插件开发/CI 必备。 |
| `extension/test/options.test.js` | 设置页保存、恢复和连接测试。 | 插件开发/CI 必备。 |
| `extension/test/tab-state-store.test.js` | 标签状态持久化和过期清理。 | 插件开发/CI 必备。 |
| `extension/test/transport-policy.test.js` | 重连退避和路由键。 | 插件开发/CI 必备。 |

## 9. macOS 桌面版 `desktop/`

### 9.1 工程和打包配置

| 文件 | 作用 | 必备性 |
|---|---|---|
| `desktop/package.json` | Electron 版本、桌面版版本、入口和 dev/test/package/DMG 命令。 | 桌面开发与发布必备；桌面版本真源。 |
| `desktop/package-lock.json` | 锁定 Electron、Forge、ESBuild 和 archiver 依赖。 | 可复现开发/发布必备。 |
| `desktop/forge.config.cjs` | App Bundle ID、macOS 13 最低版本、未签名 arm64 App/DMG 和额外资源配置。 | 桌面发布必备。 |
| `desktop/resources/.gitkeep` | 让空的资源工作目录保留在 Git 中。 | 目录占位，可生成资源存在后不影响运行。 |
| `desktop/scripts/build.mjs` | 打包两个 preload，并复制 renderer HTML/CSS/JS 到 `desktop/dist/`。 | 桌面开发/发布必备。 |
| `desktop/scripts/prepare-resources.mjs` | 把词典、补丁基线和 M3E 模型复制到待打包资源目录。 | 桌面发布必备。 |
| `desktop/scripts/verify-packaged-resources.mjs` | Forge 完成后逐字节比较仓库补丁和 `.app` 内补丁；不一致则构建失败。 | 桌面发布安全校验必备。 |

### 9.2 Electron 主进程

| 文件 | 作用 | 必备性 |
|---|---|---|
| `desktop/src/main/index.cjs` | Electron 总入口；窗口生命周期、单实例、IPC 注册、自检、批次编排、提交检测、内存逐题展示、设置、补丁迁移和退出清理。 | 桌面运行必备。 |
| `desktop/src/main/browser-controller.cjs` | 创建隔离 `WebContentsView`、唯一持久分区、导航安全、证书/权限/下载处理、移动端配置、保持 412px 画布在主内容区居中，并与贴右侧的自适应答题面板保持安全间距及幂等销毁。 | 桌面网页运行必备。 |
| `desktop/src/main/sidecar-client.cjs` | 启动 Python 子进程，关联 JSON Lines 请求/响应、超时、stderr 日志和退出状态。 | 桌面核心通信必备。 |
| `desktop/src/main/core-supervisor.cjs` | 串行初始化 sidecar、核心就绪门控，并对可恢复故障只重启重试一次。 | 桌面稳定性必备。 |
| `desktop/src/main/store.cjs` | 桌面 JSON 数据结构、V1→V2 迁移、备份/恢复、批次上限、筛选和迁移指纹。 | 桌面数据必备。 |
| `desktop/src/main/secret-store.cjs` | 使用 Electron `safeStorage` 加密存取 DeepSeek Key。 | 配置 Key 时必备；无 Key 可运行。 |
| `desktop/src/main/logger.cjs` | 本地日志、敏感值脱敏以及 30 天/100 MB 清理。 | 桌面诊断必备。 |
| `desktop/src/main/diagnostics.cjs` | 生成诊断 ZIP，清除密码、Cookie、令牌和 Key 模式，并统计日志大小。 | 桌面诊断功能必备。 |
| `desktop/src/main/exports.cjs` | 导出无账号身份的批次 CSV/JSON。 | 记录导出功能必备。 |
| `desktop/src/main/migration.cjs` | 扫描旧项目补丁和可选 `.env` Key，生成幂等导入预览；明确忽略旧调试记录。 | 旧版迁移功能必备。 |
| `desktop/src/main/update-checker.cjs` | 24 小时间隔判断和公开版本清单解析；不自动下载。 | 版本检查可选；未配置清单时不影响答题。 |

### 9.3 本地 UI 和 IPC

| 文件 | 作用 | 必备性 |
|---|---|---|
| `desktop/src/preload/app.cjs` | 给本地 renderer 暴露白名单 IPC 方法，不暴露 Node/Electron 全量 API。 | 桌面安全与 UI 必备。 |
| `desktop/src/renderer/index.html` | 本地应用壳和严格 CSP。 | 桌面 UI 必备。 |
| `desktop/src/renderer/styles.css` | 首页、学习、记录、设置和诊断界面样式；保证学习页运行栏在最小窗口宽度下不换行遮挡网页。 | 桌面 UI 必备。 |
| `desktop/src/renderer/app.js` | 本地 UI 渲染与交互；管理页面导航、批次按钮、右侧滚动答题详情、补丁、记录、设置和诊断。 | 桌面 UI 必备。 |

### 9.4 共享桌面状态与校验

| 文件 | 作用 | 必备性 |
|---|---|---|
| `desktop/src/shared/constants.cjs` | Schema/协议版本、状态枚举、站点白名单、移动配置、重试/超时和日志上限。 | 桌面运行必备。 |
| `desktop/src/shared/batch-machine.cjs` | 正常答题批次状态机和所有合法转换，保证停止、异常退出和最终待提交状态明确；不包含调试/复盘状态。 | 桌面业务必备。 |
| `desktop/src/shared/validation.cjs` | IPC 对象、正整数、A–D 选项、HTTPS/HTTP 和支持域名校验。 | 桌面安全必备。 |

### 9.5 站点适配器

| 文件 | 作用 | 必备性 |
|---|---|---|
| `desktop/src/site/dom.cjs` | 可单测的题目/选项文本解析，以及“最终题绝不提交”的纯策略。 | 桌面自动化必备。 |
| `desktop/src/site/preload.cjs` | 运行在隔离远程网页中的适配器；扫描 DOM、应用答案、等待自动下一题并观察人工提交，不采集调试复盘。 | 桌面自动化必备；不得访问 Key 或 sidecar。 |

### 9.6 桌面构建产物

`desktop/dist/` 由 `npm run build` 生成。Electron 运行时需要这些文件，但可以随时重建，不应直接修改。

| 文件 | 来源 | 必备性 |
|---|---|---|
| `desktop/dist/app-preload.cjs` | `src/preload/app.cjs` bundle。 | 运行时必备、可生成。 |
| `desktop/dist/site-preload.cjs` | `src/site/preload.cjs` bundle。 | 运行时必备、可生成。 |
| `desktop/dist/index.html` | `src/renderer/index.html` 复制。 | 运行时必备、可生成。 |
| `desktop/dist/styles.css` | `src/renderer/styles.css` 复制。 | 运行时必备、可生成。 |
| `desktop/dist/app.js` | `src/renderer/app.js` 复制。 | 运行时必备、可生成。 |

### 9.7 桌面测试

| 文件 | 覆盖内容 | 必备性 |
|---|---|---|
| `desktop/test/batch-machine.test.cjs` | 最终挂起、三次失败、人工提交、无调试字段和非法转换。 | 桌面开发/CI 必备。 |
| `desktop/test/browser-controller.test.cjs` | 原生 View 销毁幂等和窗口销毁后的安全退出。 | 桌面开发/CI 必备。 |
| `desktop/test/core-supervisor.test.cjs` | 并发初始化、核心恢复和单次重试。 | 桌面开发/CI 必备。 |
| `desktop/test/electron-exit-smoke.cjs` | 启动 Electron 后关闭窗口，验证主进程不会弹 JavaScript 错误。 | macOS 冒烟测试必备，普通 Node CI 不直接运行。 |
| `desktop/test/local-services.test.cjs` | Key 加密、日志脱敏、诊断清理、版本间隔和无身份导出。 | 桌面开发/CI 必备。 |
| `desktop/test/migration.test.cjs` | 旧版补丁/Key 迁移以及调试记录忽略策略。 | 桌面开发/CI 必备。 |
| `desktop/test/security.test.cjs` | sandbox/CSP、禁止自动提交、无身份、补丁入口、核心门控和打包资源。 | 桌面安全回归必备。 |
| `desktop/test/site-dom.test.cjs` | 题目/选项和无显式下一题页面。 | 站点适配开发/CI 必备。 |
| `desktop/test/store.test.cjs` | V2 数据迁移、1000 批限制、异常恢复、备份和降级阻断。 | 桌面数据开发/CI 必备。 |
| `desktop/test/validation.test.cjs` | 导航、HTTP 确认、协议拒绝、题量和选项校验。 | 桌面安全开发/CI 必备。 |

## 10. Python 测试 `tests/`

| 文件 | 覆盖内容 | 主要归属 | 必备性 |
|---|---|---|---|
| `tests/conftest.py` | 把 `src/` 加入测试导入路径。 | 共享开发 | Python 测试必备。 |
| `tests/test_config.py` | 配置优先级、交互回退、非法 host/延迟、脱敏和客户端配置。 | CLI / 共享 | 开发/CI 必备。 |
| `tests/test_domain_and_protocol.py` | 文本清洗和 WebSocket 协议模型。 | 共享 / CLI | 开发/CI 必备。 |
| `tests/test_solver.py` | 补丁最高优先级、字典冲突和决策链。 | 共享 | 开发/CI 必备。 |
| `tests/test_infrastructure.py` | 词典、补丁、调试存储、向量/LLM 和发布补丁无冲突。 | 共享 | 开发/CI 必备。 |
| `tests/test_api.py` | `/health`、客户端配置、WebSocket 批次和复盘模式。 | CLI | 兼容期开发/CI 必备。 |
| `tests/test_reporting.py` | 报表使用注入的数据目录。 | CLI | 兼容期开发/CI 必备。 |
| `tests/test_imports.py` | 导入 Python 包不会创建文件、加载模型或访问网络。 | 共享 | 架构回归必备。 |
| `tests/test_sidecar.py` | sidecar 初始化、答题、补丁播种/升级、复盘确认、手动补丁和错误脱敏。 | 桌面 / 共享 | 桌面开发/CI 必备。 |

## 11. 文档和自动化

| 文件 | 作用 | 必备性 |
|---|---|---|
| `docs/DEVELOPMENT_FILE_GUIDE.md` | 本文；逐文件解释归属、职责和必备性。 | 维护必备。 |
| `docs/prd/PRD-001.md` | 第二阶段 macOS App 产品需求、用户故事、验收和边界。 | 产品与验收必备。 |
| `docs/PRD_REGISTRY.md` | PRD 台账和文档索引。 | 产品维护必备。 |
| `docs/architecture/ADR-001-macos-app-stack.md` | Electron + WebContentsView + PyInstaller sidecar 的技术决策记录。 | 架构维护必备。 |
| `.github/workflows/ci.yml` | Python 跨平台轻量测试、插件测试/构建同步检查和桌面源码测试/构建。 | CI 必备。 |
| `.github/agents/code-explainer-zh.agent.md` | GitHub/Copilot 可调用的只读中文代码解读代理定义。 | 开发辅助可选，不影响产品运行。 |

仓库当前没有 `CONTRIBUTING.md`、`CLAUDE.md`、`.cursorrules` 或嵌套 `AGENTS.md`；根目录 `AGENTS.md` 是唯一项目指令真源。

## 12. 本地数据、依赖和构建产物

### 12.1 仓库内本地目录

| 路径 | 内容 | 是否必备/能否删除 |
|---|---|---|
| `.venv/` | 当前 Python 3.10+ 依赖环境。 | 本地私有、可重建；运行 CLI 或源码 sidecar 前需要。 |
| `.venv-python3.9.6-backup-20260808-223152/` | 安装脚本保留的旧 Python 3.9 虚拟环境。 | 不属于当前运行；确认无需回滚后可删除。 |
| `.models/moka-ai_m3e-base/` | 本地 M3E 向量模型。 | CLI embedding 模式和桌面 DMG 发布必备；本地私有、可重新下载。 |
| `extension/node_modules/` | 插件 Node 依赖。 | 可由 `npm ci` 重建。 |
| `desktop/node_modules/` | Electron 桌面 Node 依赖。 | 可由 `npm ci` 重建。 |
| `src/hdu_snap.egg-info/` | Python 可编辑安装生成的包元数据。 | 可生成，不提交。 |
| `__pycache__/`、`tests/__pycache__/` | Python 字节码缓存。 | 非项目文件，可删除。 |
| `.pytest_cache/` | pytest 缓存。 | 非项目文件，可删除。 |
| `build/macos-sidecar/` | PyInstaller spec、work 和分析日志。 | 可生成，不进入 DMG 的最终资源。 |
| `desktop/resources/prepared/core-resources/` | 待打包的词典、补丁和模型副本。 | 发布时生成；删除后运行 `npm run prepare:resources`。 |
| `desktop/resources/prepared/sidecar/` | 冻结后的 Python sidecar。 | 发布时生成；删除后运行 `bash scripts/build_macos_sidecar.sh`。 |
| `desktop/out/HDU-SNAP-darwin-arm64/` | Electron Forge 生成的 `.app`。 | 发布产物，可重建。 |
| `desktop/out/make/HDU-SNAP.dmg` | 当前未签名 Apple Silicon 安装镜像。 | 交付产物，可重建，不应提交普通源码 Git。 |
| `desktop/.DS_Store` | Finder 元数据。 | 非项目文件，可删除。 |

### 12.2 `runtime/`

CLI 默认把运行数据写在仓库 `runtime/`；桌面源码隔离模式也把数据写在 `runtime/desktop-dev/`。正式安装版不使用这里，而使用 `~/Library/Application Support/HDU-SNAP/`。

| 文件/目录 | 作用 | 处理原则 |
|---|---|---|
| `runtime/.gitkeep` | 让空目录保留在仓库。 | 可保留，应提交。 |
| `runtime/hdu_snap.db` | CLI 词典 SQLite 缓存。 | 本地生成，可重建，不提交。 |
| `runtime/debug_recent_10000.json` | CLI 调试模式最近逐题记录。 | 用户数据，不提交；删除会丢失调试历史。 |
| `runtime/debug_error_1000.json` | CLI 已确认错题记录。 | 用户数据，不提交；迁移/报表会读取。 |
| `runtime/debug_report.html` | CLI 生成的可视化调试报告。 | 可重新生成。 |
| `runtime/debug_report_summary.json` | CLI 报告摘要。 | 可重新生成。 |
| `runtime/desktop-dev/` | `run_macos_dev.sh --isolated` 的桌面测试数据和浏览器分区。 | 本地私有；删除会清空隔离登录和测试记录。 |
| `runtime/.DS_Store` | Finder 元数据。 | 非项目文件，可删除。 |

### 12.3 正式桌面 App 数据

正式桌面数据不在仓库中：

```text
~/Library/Application Support/HDU-SNAP/
├── data/                     # state、SQLite、补丁和结构备份
├── logs/                     # 脱敏本地日志
├── browser/或Electron分区数据 # Cookie、Local Storage、IndexedDB、缓存
└── DeepSeek 加密文件         # safeStorage 加密，明文不落盘
```

这些是用户数据，不是可随意清理的构建缓存。删除前必须精确枚举目标并明确告知会丢失登录、记录、补丁或 Key。应用内“全部重置”应优先于手工删除。

## 13. 哪些文件可以在旧版退场时删除

只有满足 PRD 的 Mac App 自动测试、正常真实答题、旧版补丁迁移和最终 DMG 安装验收后，才可以执行旧版退场。届时可删除的主要范围是：

- `extension/` 整个目录
- `main.py`
- `generate_debug_report.py`
- `src/hdu_snap/cli.py`
- `src/hdu_snap/browser.py`
- `src/hdu_snap/api/`，但协议模型语义应迁到共享边界后再删
- `src/hdu_snap/reporting/`，前提是桌面诊断完全替代旧报表
- 根目录 CLI 包装脚本及对应 `scripts/start_backend.sh`、CLI 安装脚本
- `requirements-lite.txt`、`requirements.txt` 的旧兼容入口，前提是桌面构建已有新的依赖锁定方案
- 只覆盖 CLI/API/插件的测试和 CI job

退场时必须保留：

- `src/hdu_snap/domain/`
- `src/hdu_snap/application/`
- `src/hdu_snap/infrastructure/`
- `src/hdu_snap/bootstrap.py`
- `src/hdu_snap/sidecar.py`（除非以后替换 sidecar 技术）
- `CET/Data.lexicon.cache.json`
- `patch_rules.jsonc`
- `desktop/`
- 共享协议语义、共享测试、PRD、ADR 和项目记忆

## 14. 常用开发命令

### 14.1 共享 Python 与 CLI

```bash
.venv/bin/python -m pytest
.venv/bin/hdu-snap config --check
.venv/bin/hdu-snap serve
```

### 14.2 Chrome 插件

```bash
cd extension
npm ci
npm test
npm run build
```

### 14.3 桌面源码版

```bash
cd desktop
npm ci
npm test
npm run build
cd ..
bash scripts/run_macos_dev.sh
```

隔离用户数据：

```bash
bash scripts/run_macos_dev.sh --isolated
```

### 14.4 桌面发布

```bash
bash scripts/build_macos_sidecar.sh
cd desktop
npm run make:dmg
```

`npm run make:dmg` 会准备词典、补丁和模型，并在生成后验证 `.app` 中的补丁与根目录 `patch_rules.jsonc` 完全一致。

## 15. 维护检查清单

修改文件结构时执行以下检查：

1. 判断新文件属于共享、CLI、插件、桌面还是开发工具。
2. 在本文增加或修改对应条目，不把可生成文件误写成源码。
3. 若改变共享 Python 边界，运行完整 `pytest`。
4. 若改变插件源码，运行插件测试和构建，并检查 `extension/dist/` 同步。
5. 若改变桌面源码，运行桌面测试和构建；涉及原生视图退出时再运行 Electron 退出冒烟。
6. 若改变 sidecar 或打包资源，重新冻结 sidecar 并构建 DMG。
7. 若改变命令、用户行为、架构或路线图，同步更新 `README.md`、`TECHNICAL.md`、`MACOS_GUIDE.md` 和 `AGENTS.md`。
8. 永远不要提交 `.env`、Key、Cookie、模型、虚拟环境、运行数据库、日志或诊断包。
