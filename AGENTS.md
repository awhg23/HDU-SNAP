# HDU-SNAP 项目记忆

本文件是供维护者和编码代理使用的持久项目记忆。内容应保持客观、简洁，并在架构、配置或路线图发生变化时同步更新。

## 项目定位

HDU-SNAP 用于自动完成 HDU 学习站点的英语词汇答题流程。当前正在开发第二阶段的一体化 Apple Silicon macOS App：用户在 App 内登录、导航、运行答题、人工提交、维护补丁和管理记录，不需要外部 Python、Node、Chrome 或插件。第一阶段的 Python 后端与 Chrome 插件暂时保留，用于真实行为对照和回退。

长期演进方向：

1. 重构现有代码库：规范文件结构，统一环境变量和配置管理。
2. 将浏览器插件体验与后端生命周期整合进原生 macOS 应用。
3. 在不重复实现答题核心的前提下，演进为 macOS、Windows 和 Android 应用。

## 当前分支和阶段

- 重构分支：`refactor/extension-backend-architecture`。
- 第一阶段已在当前工作分支完成：包结构、类型化配置、插件构建、测试和 CI 均已建立。
- 用户已完成真实站点登录和实际答题测试，并确认流程运行正常；第一阶段已通过实际使用验收。
- 第二阶段需求文档已经确认，位于 `docs/prd/PRD-001.md`，台账位于 `docs/PRD_REGISTRY.md`。
- 第二阶段技术栈已经确定并开始实现：Electron + 隔离 `WebContentsView` + PyInstaller Python sidecar；决策记录位于 `docs/architecture/ADR-001-macos-app-stack.md`。
- Xcode 已安装，Electron 开发进程已经真实启动；sidecar 已成功加载内置词典和本地 M3E 模型并使用 Apple MPS。
- 2.1.0 起取消账号档案、身份识别和多账号隔离。App 只保留一份持久网页登录会话；站点适配器不得解析或上报姓名学号，批次、状态和导出不得保存登录身份。
- 用户已确认 2.1.0 当前功能运行正常。当前 App 数据中的 60 条无冲突纠错已同步为仓库发布基线；安装包必须携带这份 `patch_rules.jsonc`，新安装完整播种，升级只补缺失题目且不得覆盖用户同题修正。
- 2.1.0 未签名 DMG 已于 2026-08-17 成功生成；构建后校验和只读挂载检查均确认镜像内补丁与仓库基线逐字节一致。尚未记录覆盖安装后的人工验收结果。
- 2.2.0 起删除 Mac App 调试模式、自动复盘、模式筛选和桌面调试记录迁移。Mac App 只创建正常批次；纠错通过内置补丁、手动添加和旧版 JSON/JSONC 导入维护。第一阶段 CLI/插件的调试模式及稳定协议暂时保留。
- 2.2.0 学习页的 412px 移动画布在侧栏以外的主内容区水平居中；答题详情面板贴近窗口右侧并在 214–280px 范围内自适应，窗口最小宽度为 1100px，不能挤压或覆盖画布。最新题目置顶并可滚动查看本次全部答案、方法和置信度；逐题列表只能保存在主进程内存中，不得写入 `DesktopStore`、记录导出或诊断状态。
- 真实答题页默认开启“自动下一题”，且可能没有带文字的下一题按钮；选择答案后应等待 DOM 自动切题，不能把缺少显式下一题按钮计为自动化失败。
- Electron 原生视图必须在 `BrowserWindow` 的 `close` 阶段清理，并保持销毁操作幂等；不要在 `closed` 后访问已经销毁的 `contentView`。
- 用户已确认 2.2.0 源码版真实答题、调试模式退场、顶部运行栏、居中答题画布和右侧答题详情均无问题。最终 2.2.0 DMG 构建及安装验收尚未完成，因此旧插件、CLI、脚本和本地 API 暂不删除。

## 当前架构

第二阶段主架构：

```text
desktop/
├── src/main/                  # Electron 生命周期、浏览器、数据、Keychain、sidecar
├── src/preload/               # 本地 UI 的最小 IPC 桥
├── src/renderer/              # 首次引导、首页、学习、记录、设置、诊断
├── src/site/                  # 隔离站点适配器、DOM 识别和提交观察
├── src/shared/                # 批次状态机、常量和输入校验
├── test/                      # 桌面领域和平台服务测试
├── scripts/                   # ESBuild 与资源准备
└── forge.config.cjs           # Apple Silicon App/DMG 打包

Electron 主进程
    → JSON Lines 标准输入/输出
    → src/hdu_snap/sidecar.py
    → 现有 Solver / 领域层 / 基础设施
```

Mac App 主路径不启动 FastAPI，也不监听 HTTP/WebSocket 端口。网站只使用一个持久数据分区；V1.0 升级时可沿用一个旧分区以保留登录状态，但不再提供账号切换。远程网页启用沙箱、上下文隔离和 Web 安全，不能访问 Electron API、Key 或 sidecar。

第一阶段兼容架构：

```text
HDU-SNAP/
├── main.py                    # 向后兼容的 CLI 包装器
├── src/hdu_snap/
│   ├── config.py              # Pydantic Settings 和路径管理
│   ├── domain/                # 纯领域类型和文本处理工具
│   ├── application/           # 答题和反馈流程
│   ├── infrastructure/        # 存储、词典、向量和 LLM
│   ├── api/                   # FastAPI 和通信协议
│   └── reporting/             # 调试报告
├── extension/
│   ├── src/                   # 模块化插件源码
│   ├── dist/                  # 提交到版本库的 ESBuild 产物
│   ├── manifest.json
│   └── options.html
├── tests/                     # Python 特征测试和集成测试
├── CET/Data.lexicon.cache.json
├── patch_rules.jsonc          # 持久、可人工审查的纠错规则
├── generate_debug_report.py
├── runtime/                   # 生成的数据库、日志和报告；除 .gitkeep 外均忽略
├── .models/                   # 本地向量模型；忽略
├── .env                       # 本地密钥和配置；忽略
└── 安装与启动脚本
```

### 运行流程

Mac App：

1. 首次启动执行系统、核心、词典、向量模型、数据目录、网页组件和目标站点网络自检。
2. DeepSeek Key 可选；验证成功后通过 `safeStorage` 写入 macOS 钥匙串保护的加密文件。
3. Electron 使用唯一的持久化网页分区打开内嵌站点，用户在网页中手动登录。
4. 站点适配器只在两个 HDU 域名启用自动化，提取题目和 A–D 选项后发给主进程。
5. 主进程重新校验输入，并通过无端口 sidecar 调用现有 Solver；所有请求经过统一核心监督器和就绪门控。
6. 运行中锁定应用导航和用户网页点击；切换或最小化继续，睡眠后自动暂停。
7. 同题失败三次进入错误暂停；继续或重试前重新读取页面。
8. 达到目标题量后只选择答案并挂起，解锁网页供用户亲自提交。
9. 运行中在移动画布右侧显示仅当前进程保留的逐题详情；提交确认后只保存批次摘要。Mac App 不自动复盘、不持久化逐题内容，纠错通过设置页手动添加或导入旧版 JSON/JSONC 补丁。
10. 发布构建把根目录 `patch_rules.jsonc` 原样放入 App 资源；首次启动原样复制，升级只按题目合并缺失规则，已有用户规则优先。

Electron 对同一应用数据目录启用单实例保护。sidecar 初始化必须串行化；运行中遇到 `CoreNotInitializedError` 或进程意外退出时，只允许重新初始化并重试当前核心请求一次，恢复失败后才进入题目层三次失败计数。新增的 IPC 关联日志只能记录 PID、请求编号、方法和错误类型，不能记录参数或密钥；节点校验日志仍可按诊断需求记录题目和选项。

旧插件：

1. CLI 加载类型化配置，解析交互模式和答题数量，启动 FastAPI，并按配置打开目标站点。
2. `extension/src/content/` 等待客户端配置、监听 DOM 变化、提取一道题和 A–D 选项，再向 Service Worker 发送 `SOLVE_ITEM`。
3. `extension/src/background/` 从插件存储读取回环后端地址，将消息转换为 WebSocket JSON，并把响应路由回对应标签页和会话。
4. 后端按“补丁规则 → 词典 → 向量 → DeepSeek/兜底”的顺序选择答案。
5. 内容脚本点击选项，等待短暂随机延迟后进入下一题。
6. 到达配置的最后一题时，插件挂起并发送 `batch_complete`，绝不自动提交。
7. 调试模式下，插件随后读取复盘页面并发送 `review_results`；后端记录调试数据并更新 `patch_rules.jsonc`。

### 稳定通信协议

客户端发送给后端的 WebSocket 消息类型：

- `solve_item`：`session_id`、`item_id`、`source_text`、`options`
- `batch_complete`：`session_id`、`total_items`
- `review_results`：`session_id`、`errors`

后端发送给客户端的消息类型：

- `decision`
- `error`
- `batch_summary`
- `review_results_ack`

该协议是产品各端共享的 API。任何破坏性修改都必须先进行版本升级或提供兼容处理，因为未来的 macOS、Windows 和 Android 客户端都应复用同一套答题服务和核心逻辑。

## 配置基线

配置统一由 `hdu_snap.config.Settings` 管理。优先级为：CLI 的模式和答题数量覆盖进程环境变量，进程环境变量覆盖根目录 `.env`，`.env` 覆盖默认值。

### 现有环境变量

- `DEEPSEEK_API_KEY`
- `HDU_SNAP_AUTO_OPEN_SITE`
- `HDU_SNAP_TARGET_URL`
- `HDU_SNAP_MODE`（`normal`/`1` 或 `debug`/`0`）
- `HDU_SNAP_ANSWER_COUNT`
- `HDU_SNAP_EMBEDDING_MODEL_DIR`
- 服务、日志、数据路径、决策/LLM、客户端延迟、状态 TTL 和移动端模拟变量，详见 `.env.example`

插件默认连接 `http://127.0.0.1:8765`，用户可在设置页修改。安全的运行参数由 `/api/v1/client-config` 下发；密钥只保留在后端。

### 配置管理约束

- 只通过一个类型化后端配置对象和模块加载环境变量。
- `.env.example` 必须完整、无真实密钥，并说明默认值和合法范围。
- 环境变量覆盖文档中的默认值；交互询问只属于 CLI，不得隐藏在领域逻辑中。
- 不得将密钥写入插件存储、应用包、日志、健康检查或客户端可见配置。
- 只通过专用的版本化接口或握手向插件公开安全运行配置，不得让插件自行拼接后端 URL 和默认值。
- 本地服务默认只绑定回环地址；任何非回环访问都必须先完成明确的安全设计。
- 路径必须通过应用数据/配置抽象解析，避免打包应用依赖仓库根目录。
- 排查 LLM 鉴权问题时，应先确认实际生效的配置来源；终端中已导出的旧 `DEEPSEEK_API_KEY` 会覆盖 `.env` 中的新值。

## 第一阶段架构边界

具体名称可以演进，但依赖方向必须保持为：

```text
入口（CLI / 本地 API）
        → 应用服务
        → 领域答题流程
        → 端口/接口
        → 基础设施适配器（SQLite、文件、向量、LLM）

浏览器插件
        → 版本化客户端协议
        → 本地 API 适配器
```

已实现的目录结构：

```text
src/hdu_snap/
├── config.py
├── domain/
├── application/
├── infrastructure/
├── api/
└── cli.py
extension/
├── manifest.json
├── src/
└── dist/
tests/
scripts/
docs/
```

必须保持这些依赖边界。新增平台适配器应调用应用层和领域层，不得导入 Chrome 或 FastAPI 的专用实现。

### 第一阶段验收状态

- Python 与插件自动测试、构建产物一致性检查和 CI 基线已建立。
- Python 轻量测试已通过；DeepSeek V4 单字母决策修复已通过自动测试和真实 API 冒烟验证。
- 用户已在真实站点完成登录和实际答题测试，并确认没有问题。
- 尚未收到调试复盘流程单独验收的明确记录，不将该项标记为已人工验证。
- 后续第一阶段改动仅用于缺陷修复和兼容性维护，不得破坏稳定通信协议。

## LLM 运行约束

- 当前默认模型是 `deepseek-v4-flash`，接口地址为 `https://api.deepseek.com`。
- DeepSeek V4 默认启用思考模式。单字母分类请求必须显式传递 `extra_body={"thinking": {"type": "disabled"}}`，避免思考内容耗尽输出额度后导致最终 `content` 为空。
- 单字母决策应保留足够的小额输出空间；当前 `max_tokens` 为 `8`。
- API 返回 `200 OK` 不代表本地解析一定成功；必须校验最终 `content` 是否包含合法的 A–D 选项。
- LLM 重试耗尽后可以使用确定性向量第一名兜底，但决策方法必须标记为“向量兜底”，不得伪装成“大模型决策”。
- API Key 不得出现在异常、日志或调试报告中。

## 第二阶段：macOS 应用方向

macOS 应用应负责安装、配置、后端/核心生命周期、状态、日志和用户控制。站点专用自动化必须保持为适配器，不得渗入答题核心。

在选择最终 UI 或容器技术前，必须保留以下可替换边界：

- `Solver`：输入题目和选项，输出决策
- 客户端协议：会话、答题、批次完成和兼容期复盘消息
- 答题页适配器：监听页面、规范化题目、应用决策
- 补丁维护：桌面端通过手动录入或旧版补丁导入纠错；复盘页适配器仅属于第一阶段兼容实现
- 平台服务：安全密钥存储、应用数据路径、日志、浏览器/WebView 控制和更新

已经选择 Electron `WebContentsView` 作为内嵌网页容器，原因是它能同时满足任意网页浏览、单一会话持久化、移动端模拟和复用现有 JavaScript DOM 适配器。Chrome 插件仅在 Mac App 验收前作为对照实现保留。

Python 暂时继续作为打包后的答题运行时，由 PyInstaller 生成 Apple Silicon onedir sidecar。Electron 与 sidecar 只使用逐行 JSON 标准输入/输出；stdout 只承载协议，日志写 stderr。未来 Windows 可以复用该边界，Android 需要另外选择核心运行方式。

日常修复验收通过 `bash scripts/run_macos_dev.sh` 直接启动源码 App，复用默认应用数据；必须先退出已安装版。`--isolated` 使用已忽略的 `runtime/desktop-dev/`。只有发布候选和安装验收才重新构建 DMG，不能把“每次修改都安装 DMG”作为开发流程。

### 第二阶段数据与安全基线

- App 数据位于 `~/Library/Application Support/HDU-SNAP/`，不再依赖仓库根目录。
- 批次和纠错不保存账号身份；Cookie、Local Storage、IndexedDB 和缓存只存在唯一网站分区。
- 不识别或保存姓名学号，不保存账号密码，不自动登录，不自动提交。
- Key 不进入渲染进程、网页、日志、记录、诊断或版本清单。
- 任意 HTTPS 可浏览，HTTP 逐次确认，证书错误直接拒绝；自动化只允许两个 HDU 域名。
- Mac App 只保存无模式、无逐题内容的批次摘要；记录最多 1000 批。
- 活动批次异常退出后不恢复：最终待提交记为未确认提交，其余记为异常中止。
- 数据结构 V2 在备份后删除 V1 的档案及批次身份字段，同时沿用一个旧网站分区；后续升级仍保留最近三份备份，更高版本数据阻止旧 App 启动。
- 诊断只在用户确认后导出，允许包含答题上下文和网页快照中可见的个人信息，但必须清除密码、Cookie、令牌和 Key。

## 第三阶段：macOS、Windows 和 Android

- 在各平台共享答题领域层、应用层核心和协议语义。
- 将平台 UI、安全存储、文件路径、打包、更新以及浏览器/WebView 自动化隔离在适配器后面。
- 不得假设 Android 支持 Chrome 插件 API。
- 在确定框架前，先验证 Android 登录、会话行为和 WebView 兼容性。
- 尽量为配置结构和协议 fixture 保持单一事实来源，并在可行时生成或校验客户端表示。

## 行为和数据不变量

- 除非产品需求明确改变，否则绝不自动提交最终答题结果。
- 保留手动登录，以及用户暂停或接管流程的能力。
- 后端默认只允许本机访问。
- `patch_rules.jsonc` 是持久、可人工审查的纠错数据，避免有损迁移。
- Mac App 的发布补丁基线必须与根目录 `patch_rules.jsonc` 逐字节一致；`npm run make:dmg` 必须在 Forge 完成后执行安装包资源校验，不能只验证中间准备目录。
- `CET/Data.lexicon.cache.json` 是内置词典种子。
- `runtime/`、`.models/`、`.venv/`、`.env`、缓存、数据库和生成报告不得纳入版本控制。
- 安装脚本要求 Python 3.10+；发现不兼容的 `.venv` 时，应先保存到已忽略的时间戳备份目录，再创建新环境。
- Mac App 不得重新引入调试/复盘入口；第一阶段 CLI/插件的调试模式在兼容期内必须保持可区分。
- 密钥不得进入 Git 或客户端可见诊断信息。

## 已知重构风险

- 内存中的路由映射和 WebSocket 消息队列尚无明确的容量与过期约束。
- DOM 匹配依赖较宽泛的启发式规则及目标站点当前的中文标签和类名，应继续通过 fixture 测试隔离。
- 基于 Chrome Debugger 的移动端模拟属于浏览器专用能力，不能作为跨平台自动化抽象。
- 以仓库根目录为基准的路径仍是兼容默认值；原生应用必须注入平台数据和资源路径。
- `content/index.js` 仍包含站点专用的答题与复盘状态机；当适配器进一步分化时应继续拆分。
- Electron 站点适配器和 2.0.3 核心恢复已完成真实正常模式答题验证。2.1.0 已移除身份识别并加入手动补丁；2.2.0 删除桌面调试模式、重排顶部运行栏并增加右侧答题详情，已完成源码版真实复测，尚待当前版本 DMG 安装验收。
- Electron 43 在新建 `WebContentsView` 上直接调用 `webContents.enableDeviceEmulation()` 会造成 macOS 主进程原生段错误。不得重新启用该路径；当前使用 412 像素固定宽度、移动 UA，以及 DevTools Protocol 的平台/触摸覆盖，已验证登录页得到 `platform=Android`、`maxTouchPoints=1`、`innerWidth=412`。
- Electron + PyTorch + Sentence Transformers + 本地模型会产生较大的 DMG；必须在干净的 Apple Silicon、macOS 13+ 环境验证首次启动时间和磁盘占用。
- 未签名 DMG 依赖用户手动通过 Gatekeeper，文档必须始终保留正确的打开方式。
- 公开版本清单的正式地址尚未配置；当前实现不会在未配置时发起版本请求。

## 协作约定

- 第一阶段进行期间，保持 WebSocket 协议和现有端到端行为兼容。
- 修改应保持小而可审查；每次提取或修复后运行最接近的测试或冒烟检查。
- 不得提交 `.env`、API Key、模型文件、虚拟环境、运行时数据库/日志或生成报告。
- 路线图、架构边界、不变量或配置键发生变化时，必须更新本文件。
- 命令或用户可见行为发生变化时，同步更新 `README.md`、`TECHNICAL.md` 和平台安装指南。
- 未决定的技术选择应记录为开放问题，不得在未讨论时默认确定。

## 开放问题

- Mac App 在真实站点中的提交结果页是否需要新增站点专用选择器。
- 未签名 DMG 在不同 macOS 13+ 小版本中的 Gatekeeper 操作是否一致。
- 公开版本清单的托管地址、私有 Release 链接结构和稳定/测试频道发布流程。
- Python sidecar 在后续 Windows 版本中是否继续使用 PyInstaller，还是改为其他自包含运行时。
- Android 自动化方案和站点兼容性边界。
