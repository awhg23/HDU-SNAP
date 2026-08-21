# HDU-SNAP 开发文件指南

本文按 v2.4.0 正式版说明每个项目自有文件的职责和必备性，并明确区分已退场的命令行版与当前桌面版。第三方依赖、缓存和构建目录按目录说明，不逐个枚举其中的生成文件。

## 1. 分类与必备性

| 分类 | 含义 |
|---|---|
| 共享核心 | 与 Electron 无关的 Python 领域、应用、协议和基础设施。未来平台应复用这一层。 |
| 桌面运行 | Electron 主进程、本地 UI、站点适配器和 sidecar 桥。 |
| 桌面发布 | 只在构建自包含 App/DMG 时需要。 |
| 开发 | 测试、CI、文档、设计规范或维护配置。 |
| 生成产物 | 由构建生成，不应手改；部分产物为保证可审查而提交。 |
| 本地私有 | 只属于当前机器，禁止提交。 |

| 必备性 | 含义 |
|---|---|
| 运行必备 | 缺失会导致 App 或答题核心无法运行。 |
| 发布必备 | 日常源码运行可缺失，但无法制作可靠安装包。 |
| 开发必备 | 最终用户不需要，但测试、维护或复现构建需要。 |
| 可选 | 缺失时只影响可选能力。 |
| 可生成 | 可由明确命令重新产生。 |

## 2. 当前唯一运行链路

```text
desktop/src/main/index.cjs
  → BrowserController + 本地 renderer + 站点 preload
  → CoreSupervisor / SidecarClient
  → JSON Lines stdin/stdout
  → src/hdu_snap/sidecar.py
  → ServiceContainer
  → SolverPipeline
```

第一阶段命令行版已经退场：仓库不再包含 Chrome 插件、FastAPI/HTTP/WebSocket 服务、`main.py`、`hdu-snap` CLI、调试报表、requirements 兼容文件或旧安装/启动脚本。`hdu_snap.protocol` 只保留协议模型，不代表本地服务仍存在。

## 3. 根目录

| 文件 | 分类 | 作用 | 必备性 |
|---|---|---|---|
| `.gitattributes` | 开发 | 统一文本属性并标记二进制资源。 | 仓库维护必备。 |
| `.gitignore` | 开发 | 排除密钥、虚拟环境、依赖、用户数据、备份和打包产物。 | 安全必备。 |
| `AGENTS.md` | 开发 | 中文项目记忆、架构边界、不变量、验收与发布门禁。 | 维护必备。 |
| `README.md` | 开发 | 产品入口、正式版信息、使用和常用开发命令。 | 维护必备。 |
| `TECHNICAL.md` | 开发 | 当前架构、数据、诊断、更新和发布技术说明。 | 维护必备。 |
| `MACOS_GUIDE.md` | 开发/桌面 | 安装、使用、源码验证、DMG 和 Gatekeeper 指南。 | 发布文档必备。 |
| `VERSION` | 开发 | 仓库可读版本标记，当前为 `2.4.0`；需与 Python 和桌面元数据同步。 | 维护必备。 |
| `pyproject.toml` | 共享核心/发布 | Python 3.10+ 包元数据、Pydantic/OpenAI/PyInstaller 和 pytest 配置。 | Python 安装、测试和 sidecar 发布必备。 |
| `patch_rules.jsonc` | 共享核心/发布 | 可审查的纠错规则和 App 内置补丁基线。 | 答题与发布必备；不得有损改写。 |
| `CET/Data.lexicon.cache.json` | 共享核心/发布 | 内置词典种子。 | 答题与发布必备。 |
| `runtime/.gitkeep` | 开发 | 保留空运行目录；实际数据均忽略。 | 占位文件，可选。 |
| `design-system/hdu-snap/MASTER.md` | 开发 | 暖色视觉、布局、焦点和无障碍规则。 | UI 维护必备。 |

版本必须同步到：`VERSION`、`pyproject.toml`、`src/hdu_snap/__init__.py` 和 `desktop/package.json`；`desktop/package-lock.json` 由 npm 同步。

## 4. GitHub 与文档

| 文件 | 作用 | 必备性 |
|---|---|---|
| `.github/workflows/ci.yml` | 跨平台 Python 核心测试、桌面测试/构建和 macOS Electron 退出冒烟。 | 开发必备。 |
| `.github/agents/code-explainer-zh.agent.md` | 中文代码讲解代理提示词，不参与运行。 | 可选开发资料。 |
| `docs/prd/PRD-001.md` | 第二阶段完整需求、修订、验收和边界。 | 产品维护必备。 |
| `docs/PRD_REGISTRY.md` | PRD 台账与最新摘要。 | 产品维护必备。 |
| `docs/architecture/ADR-001-macos-app-stack.md` | Electron、WebContentsView、Python sidecar 和安全边界决策。 | 架构维护必备。 |
| `docs/DEVELOPMENT_FILE_GUIDE.md` | 本文件；说明文件职责与退场边界。 | 维护必备。 |

`docs/.DS_Store` 是 Finder 生成的非项目文件，应保持忽略并可移到废纸篓。

## 5. 共享 Python 核心 `src/hdu_snap/`

### 5.1 包入口、配置与协议

| 文件 | 作用 | 必备性 |
|---|---|---|
| `src/hdu_snap/__init__.py` | Python 包标记和 `__version__`。 | 运行必备。 |
| `src/hdu_snap/config.py` | Pydantic 配置对象、资源/数据路径和安全的脱敏输出；由 sidecar 显式注入，不读取 `.env`。 | 运行必备。 |
| `src/hdu_snap/protocol.py` | 版本化请求/响应模型及旧协议解析语义。 | 跨平台兼容必备。 |
| `src/hdu_snap/bootstrap.py` | 显式组装词典、补丁、LLM 和 Solver 的 `ServiceContainer`。 | 运行必备。 |
| `src/hdu_snap/sidecar.py` | JSON Lines 无端口入口；提供初始化、健康、答题、补丁维护、Key 验证和关闭。 | 桌面运行/发布必备。 |

### 5.2 应用与领域层

| 文件 | 作用 | 必备性 |
|---|---|---|
| `src/hdu_snap/application/__init__.py` | application 子包标记。 | 包结构必备。 |
| `src/hdu_snap/application/solver.py` | 单题决策流水线，按补丁、词典、DeepSeek、兜底顺序返回决策。 | 业务运行必备。 |
| `src/hdu_snap/domain/__init__.py` | domain 子包标记。 | 包结构必备。 |
| `src/hdu_snap/domain/models.py` | `TierDecision`、`RunStats` 和字典结果等纯领域类型。 | 业务运行必备。 |
| `src/hdu_snap/domain/text.py` | 题目/选项清洗、中文释义切分和文本规范化。 | 业务运行必备。 |

### 5.3 基础设施层

| 文件 | 作用 | 必备性 |
|---|---|---|
| `src/hdu_snap/infrastructure/__init__.py` | infrastructure 子包标记。 | 包结构必备。 |
| `src/hdu_snap/infrastructure/dictionary.py` | 从词典 JSON 构建/读取 SQLite 并执行匹配和冲突判断。 | 业务运行必备。 |
| `src/hdu_snap/infrastructure/models.py` | DeepSeek 适配、重试、V4 单字母解析和确定性兜底。 | 无 Key 时可降级，但模块为运行必备。 |
| `src/hdu_snap/infrastructure/stores.py` | JSONC 补丁增删改查和内置基线补缺。 | 数据运行必备。 |

共享核心不得导入 Electron、Chrome、FastAPI 或平台 UI 实现。导入模块不得创建文件、访问网络或初始化模型。

## 6. 根目录脚本 `scripts/`

| 文件 | 分类 | 作用 | 必备性 |
|---|---|---|---|
| `scripts/run_macos_dev.sh` | 桌面开发 | 构建前端并启动源码 App；默认复用正式数据，`--isolated` 使用 `runtime/desktop-dev/`。 | 日常开发必备。 |
| `scripts/build_macos_sidecar.sh` | 桌面发布 | 用 PyInstaller 构建 Apple Silicon onedir sidecar，并检查不含已退场依赖。 | 发布必备。 |

根目录不再提供 `setup_full_*`、`start_backend*`、`main.py` 或调试报告命令。Python 依赖统一通过 `pip install -e ".[full,dev]"` 安装。

## 7. 桌面工程 `desktop/`

### 7.1 工程与打包

| 文件 | 作用 | 必备性 |
|---|---|---|
| `desktop/package.json` | Electron 入口、v2.4.0 版本、依赖和 dev/test/package/DMG 命令。 | 开发与发布必备。 |
| `desktop/package-lock.json` | 锁定 Electron、Forge、ESBuild、archiver 和 semver。 | 可复现构建必备。 |
| `desktop/forge.config.cjs` | Bundle ID、macOS 13、arm64、未签名 DMG 和 `extraResource`。 | 发布必备。 |
| `desktop/resources/.gitkeep` | 保留资源工作目录。 | 可选占位。 |
| `desktop/scripts/build.mjs` | 打包 preload，复制 renderer 与本地插画到 `dist/`。 | 开发与发布必备。 |
| `desktop/scripts/prepare-resources.mjs` | 准备 sidecar、词典和补丁资源，避免重复打包。 | 发布必备。 |
| `desktop/scripts/verify-packaged-resources.mjs` | 校验 App 内补丁、词典、sidecar、架构和已退场资源。 | 发布安全必备。 |

### 7.2 Electron 主进程

| 文件 | 作用 | 必备性 |
|---|---|---|
| `desktop/src/main/index.cjs` | 生命周期、单实例、IPC、自检、批次编排、暂停、错题记录、记录、诊断、更新和退出清理总入口。 | 桌面运行必备。 |
| `desktop/src/main/browser-controller.cjs` | 隔离 `WebContentsView`、单一持久会话、导航/安全/下载、移动参数、布局和幂等销毁。 | 网页运行必备。 |
| `desktop/src/main/core-supervisor.cjs` | 串行 sidecar 初始化、就绪门控和一次恢复重试。 | 稳定性必备。 |
| `desktop/src/main/sidecar-client.cjs` | 管理 Python 进程、JSON Lines 请求、超时、stderr 和退出。 | 核心通信必备。 |
| `desktop/src/main/store.cjs` | V3 数据、备份/恢复、记录筛选/分页/1000 批清理和迁移指纹。 | 数据运行必备。 |
| `desktop/src/main/secret-store.cjs` | 用 `safeStorage` 加密保存 DeepSeek Key。 | Key 功能必备，无 Key 可运行。 |
| `desktop/src/main/logger.cjs` | 本地日志、脱敏和 30 天/100 MB 清理。 | 诊断必备。 |
| `desktop/src/main/crash-store.cjs` | 保存单份脱敏主进程或网页崩溃上下文。 | v2.4 诊断必备。 |
| `desktop/src/main/diagnostics.cjs` | 生成脱敏诊断 ZIP并包含崩溃上下文。 | 诊断必备。 |
| `desktop/src/main/exports.cjs` | 导出当前筛选全部记录的 CSV/JSON。 | 记录导出必备。 |
| `desktop/src/main/migration.cjs` | 幂等扫描旧项目补丁和可选 Key，不迁移 Cookie 或调试记录。 | 旧数据迁移必备。 |
| `desktop/src/main/update-checker.cjs` | 固定清单抓取、严格校验、SemVer 排序和 24 小时限流。 | 版本检查必备。 |

### 7.3 本地 UI 与 IPC

| 文件 | 作用 | 必备性 |
|---|---|---|
| `desktop/src/preload/app.cjs` | 向本地 renderer 暴露最小 IPC 白名单。 | 桌面安全必备。 |
| `desktop/src/renderer/index.html` | 本地 App 壳与严格 CSP。 | UI 运行必备。 |
| `desktop/src/renderer/app.js` | 首次引导、首页、学习、记录、设置、诊断、补丁草稿、隐私确认和更新交互。 | UI 运行必备。 |
| `desktop/src/renderer/styles.css` | 暖色设计系统、页面布局、分页、诊断和学习详情样式。 | UI 运行必备。 |
| `desktop/src/renderer/assets/study-companion.png` | 首次引导和首页本地插画。 | 当前视觉必备。 |

### 7.4 远程站点与共享桌面逻辑

| 文件 | 作用 | 必备性 |
|---|---|---|
| `desktop/src/site/preload.cjs` | 隔离站点入口；观察页面、提取题目、执行答案、观察提交和扫描当前错题。 | 自动化运行必备。 |
| `desktop/src/site/dom.cjs` | 纯 DOM 识别、A–D 解析、结果页正确答案和站点状态工具。 | 自动化运行必备。 |
| `desktop/src/shared/batch-machine.cjs` | 批次状态机和合法转换。 | 业务运行必备。 |
| `desktop/src/shared/constants.cjs` | 数据版本、域名、移动参数、固定更新清单和 Release 白名单。 | 桌面运行必备。 |
| `desktop/src/shared/validation.cjs` | IPC、题量、URL、补丁和站点事件输入校验。 | 安全运行必备。 |

### 7.5 提交的构建产物 `desktop/dist/`

`dist` 由 `npm run build` 生成并提交，用户和源码开发流程可直接加载。所有文件都不应手改。

| 文件 | 来源 | 必备性 |
|---|---|---|
| `desktop/dist/index.html` | renderer `index.html`。 | 运行必备、可生成。 |
| `desktop/dist/app.js` | renderer `app.js`。 | 运行必备、可生成。 |
| `desktop/dist/styles.css` | renderer `styles.css`。 | 运行必备、可生成。 |
| `desktop/dist/app-preload.cjs` | 本地 preload bundle。 | 运行必备、可生成。 |
| `desktop/dist/site-preload.cjs` | 站点 preload bundle。 | 运行必备、可生成。 |
| `desktop/dist/assets/study-companion.png` | renderer 本地插画副本。 | 运行必备、可生成。 |

## 8. 测试文件

### 8.1 Python `tests/`

| 文件 | 覆盖内容 | 必备性 |
|---|---|---|
| `tests/conftest.py` | 测试路径和通用 fixture。 | 开发必备。 |
| `tests/test_config.py` | 显式配置、默认路径、非法值和脱敏。 | 开发必备。 |
| `tests/test_domain_and_protocol.py` | 文本领域逻辑和旧协议兼容字段/解析。 | 开发必备。 |
| `tests/test_imports.py` | 导入无副作用、旧入口不存在、包不依赖 FastAPI。 | 退场回归必备。 |
| `tests/test_infrastructure.py` | 词典、补丁、LLM 和基线补缺。 | 开发必备。 |
| `tests/test_solver.py` | 补丁、词典、DeepSeek、兜底和统计。 | 开发必备。 |
| `tests/test_sidecar.py` | sidecar 方法白名单、初始化、答题、补丁与 Key。 | 桌面核心回归必备。 |

### 8.2 桌面 `desktop/test/`

| 文件 | 覆盖内容 | 必备性 |
|---|---|---|
| `batch-machine.test.cjs` | 暂停、继续、停止、最终挂起和异常状态。 | 开发必备。 |
| `browser-controller.test.cjs` | 网页安全策略、视图布局和退出清理。 | 开发必备。 |
| `core-supervisor.test.cjs` | 串行初始化和一次恢复重试。 | 开发必备。 |
| `electron-exit-smoke.cjs` | macOS Electron 创建/退出无异常。 | CI/发布必备。 |
| `local-services.test.cjs` | 更新清单、诊断、崩溃、导出和本地服务。 | 开发必备。 |
| `migration.test.cjs` | 旧补丁/Key 迁移和幂等。 | 开发必备。 |
| `security.test.cjs` | CSP、IPC、秘密脱敏、Release URL 和旧能力退场。 | 安全回归必备。 |
| `site-dom.test.cjs` | 题目、选项、提交和当前错题 DOM fixture。 | 自动化回归必备。 |
| `store.test.cjs` | V3、日期边界、50 条分页、页码收敛和 1000 批清理。 | 数据回归必备。 |
| `validation.test.cjs` | URL、题量、补丁和站点消息校验。 | 安全回归必备。 |

## 9. 生成物与本地私有内容

以下内容不得提交：

- `.env`：遗留或本地开发密钥文件；当前 App 不读取它。
- `.venv/`、`src/*.egg-info/`、`__pycache__/`、`.pytest_cache/`。
- `desktop/node_modules/`、`desktop/out/`、`desktop/resources/prepared/`。
- `build/`：PyInstaller 工作目录。
- `runtime/desktop-dev/`、数据库、日志、诊断 ZIP 和备份。
- `.models/`：v2.3 前遗留模型目录，可移到废纸篓；不得恢复到发布包。
- `*.dmg`：发布资产保存在 GitHub Release，不进入源码 Git。
- `.DS_Store`：Finder 元数据。

## 10. 已退场的命令行版文件

下列类别已删除且不是“缺文件”：

- `extension/` 全目录；
- `src/hdu_snap/api/`、`cli.py`、`browser.py`、`reporting/`；
- 根目录 `main.py`、`generate_debug_report.py`、`requirements*.txt`；
- `setup_full_macos.sh`、`setup_full_windows.ps1`、`start_backend.sh`；
- `scripts/setup_full_*`、`scripts/start_backend.sh`、`scripts/lib/python_env.sh`；
- 旧 API、报表和插件测试。

若未来要支持 Windows 或 Android，应新增平台适配器并复用 `SolverPipeline` 与 `hdu_snap.protocol`，不能恢复 Chrome 插件或本地 FastAPI 服务作为跨平台架构。
