# HDU-SNAP 项目记忆

本文件是供维护者和编码代理使用的持久项目记忆。内容应保持客观、简洁，并在架构、配置或路线图发生变化时同步更新。

## 项目定位

HDU-SNAP 用于自动完成 HDU 学习站点的英语词汇答题流程。当前产品形态是本地 Python 后端配合 Chrome 插件：插件监听页面、将题目发送给后端、应用返回的答案，并在最终提交前停止，确保用户始终保留控制权。

长期演进方向：

1. 重构现有代码库：规范文件结构，统一环境变量和配置管理。
2. 将浏览器插件体验与后端生命周期整合进原生 macOS 应用。
3. 在不重复实现答题核心的前提下，演进为 macOS、Windows 和 Android 应用。

## 当前分支和阶段

- 重构分支：`refactor/extension-backend-architecture`。
- 第一阶段已在当前工作分支完成：包结构、类型化配置、插件构建、测试和 CI 均已建立。
- 用户已完成真实站点登录和实际答题测试，并确认流程运行正常；第一阶段已通过实际使用验收。
- 当前可以进入第二阶段的需求梳理和技术方案评估，但尚未确定或开始实现平台 UI。

## 当前架构

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
- 客户端协议：会话、答题、批次完成和复盘消息
- 答题页适配器：监听页面、规范化题目、应用决策
- 复盘页适配器：提交后采集纠错信息
- 平台服务：安全密钥存储、应用数据路径、日志、浏览器/WebView 控制和更新

Chrome 插件可以作为 macOS 过渡期的浏览器适配器，同时由原生应用接管后端生命周期和配置。是否改为嵌入式 WebView 或其他自动化机制，应作为独立决策并先完成站点兼容性原型。

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
- `CET/Data.lexicon.cache.json` 是内置词典种子。
- `runtime/`、`.models/`、`.venv/`、`.env`、缓存、数据库和生成报告不得纳入版本控制。
- 安装脚本要求 Python 3.10+；发现不兼容的 `.venv` 时，应先保存到已忽略的时间戳备份目录，再创建新环境。
- 调试/复盘模式必须与正常模式保持可区分。
- 密钥不得进入 Git 或客户端可见诊断信息。

## 已知重构风险

- 内存中的路由映射和 WebSocket 消息队列尚无明确的容量与过期约束。
- DOM 匹配依赖较宽泛的启发式规则及目标站点当前的中文标签和类名，应继续通过 fixture 测试隔离。
- 基于 Chrome Debugger 的移动端模拟属于浏览器专用能力，不能作为跨平台自动化抽象。
- 以仓库根目录为基准的路径仍是兼容默认值；原生应用必须注入平台数据和资源路径。
- `content/index.js` 仍包含站点专用的答题与复盘状态机；当适配器进一步分化时应继续拆分。

## 协作约定

- 第一阶段进行期间，保持 WebSocket 协议和现有端到端行为兼容。
- 修改应保持小而可审查；每次提取或修复后运行最接近的测试或冒烟检查。
- 不得提交 `.env`、API Key、模型文件、虚拟环境、运行时数据库/日志或生成报告。
- 路线图、架构边界、不变量或配置键发生变化时，必须更新本文件。
- 命令或用户可见行为发生变化时，同步更新 `README.md`、`TECHNICAL.md` 和平台安装指南。
- 未决定的技术选择应记录为开放问题，不得在未讨论时默认确定。

## 开放问题

- macOS 和 Windows 应用的打包与 UI 技术栈。
- 桌面应用应控制普通浏览器、附带浏览器插件，还是嵌入 WebView。
- Python 是否继续作为打包后的答题运行时，还是后续移植/共享答题核心。
- Android 自动化方案和站点兼容性边界。
- 如果未来允许非本机客户端连接，所需的身份验证和安全设计。
