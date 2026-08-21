# HDU-SNAP 技术文档

本文描述 v2.4.0 正式版的实际架构。第二阶段已经完成；第一阶段的 Chrome 插件、FastAPI/HTTP/WebSocket、CLI、调试报表和旧启动脚本已经删除，跨平台答题核心与版本化协议模型继续保留。

## 1. 总体架构

```text
Electron 主进程
├── 本地 renderer（严格 CSP、sandbox、contextIsolation）
├── WebContentsView（单一 persist: 网站分区）
│   └── 隔离站点 preload（DOM 识别、选择答案、提交观察）
├── 批次状态机、记录、V3 迁移、诊断、崩溃上下文与版本检查
├── safeStorage / macOS Keychain（DeepSeek Key）
└── JSON Lines stdin/stdout
    └── PyInstaller Apple Silicon sidecar
        ├── SolverPipeline
        ├── 词典与补丁存储
        └── DeepSeek / 确定性兜底
```

Mac App 主路径不启动本地服务，也不监听端口。远程网页不能访问 Node、Electron API、Key 或 sidecar。Electron 与 Python 仅以逐行 JSON 通信；stdout 专用于协议，日志写入 stderr。

产品官网位于 `website/`，是独立的 Sites 工程。页面仅展示产品定位、平台要求、下载入口和公开源码链接；正式 DMG 存于 `RELEASES` R2，下载路由支持 `GET`、`HEAD` 和单区间续传。对象不存在或元数据与发布记录不一致时返回 `503`，不跳转或回退到 GitHub。

## 2. Python 核心

依赖方向固定为：

```text
sidecar → bootstrap → application → domain
                         ↓
                  infrastructure
```

- `hdu_snap.protocol`：保留 `solve_item`、`batch_complete`、`review_results`、`decision`、`error`、`batch_summary`、`review_results_ack` 的字段和解析语义，供未来平台复用。桌面主路径只使用 `solve_item`。
- `hdu_snap.config.Settings`：显式接收 sidecar 注入的资源、数据和 Key；不读取 `.env` 或进程环境变量。
- `SolverPipeline`：只负责单题正常决策，不创建调试文件、不保存逐题内容。
- `ServiceContainer`：在 sidecar `initialize` 阶段显式创建词典、补丁和 LLM 适配器；导入包无文件、模型或网络副作用。
- `hdu_snap.sidecar`：只暴露 `initialize`、`health`、`solve`、补丁增删改查、`check_api_key` 和 `shutdown`。

决策顺序固定为：

1. 补丁规则；
2. 本地词典；
3. DeepSeek；
4. 固定选择 A 的确定性兜底。

DeepSeek V4 单字母请求关闭思考模式，并校验最终内容必须是 A–D。密钥缺失或请求失败时必须标记“确定性兜底”，不能伪装成大模型结果。

## 3. Electron 安全与网页容器

- 本地 UI 和远程网页启用 `sandbox`、`contextIsolation`、`webSecurity`，禁用 Node 集成。
- 任意 HTTPS 可浏览；HTTP 每次确认；证书错误直接拒绝。
- 自动化只对 `skl.hdu.edu.cn` 和 `skl.hduhelp.com` 启用。
- 网站数据只存于一个持久分区；不解析或保存姓名、学号等身份。
- 网页 preload 只发送结构化题目、状态和单题错题扫描结果；主进程重新校验所有输入。
- 页面加载失败、网页进程崩溃或不可执行时，主进程记录脱敏上下文并自动暂停运行中的批次。
- 原生视图在 `BrowserWindow` 的 `close` 阶段幂等销毁，不能在 `closed` 后访问已销毁对象。

答题页使用 412px 逻辑画布、移动 UA，以及 DevTools Protocol 的平台和触摸覆盖。Electron 43 在 `WebContentsView` 上调用 `enableDeviceEmulation()` 会导致原生崩溃，因此禁止重新启用该 API。

## 4. 批次与答题流程

批次状态由 `desktop/src/shared/batch-machine.cjs` 管理：待就绪、可开始、运行中、暂停、错误暂停、最终待提交、正在确认提交、完成、中止、异常中止和未确认提交。

运行中锁定本地导航和用户网页点击。最小化时继续；睡眠、网页崩溃、加载失败或页面不可执行时暂停。每题自动化最多重试三次，继续或重试前必须重新读取当前 DOM。

达到目标后只选择最后一题答案并挂起，绝不触发提交按钮。用户手动提交后，App 最多等待 15 秒识别结果页；超时只允许用户二次确认本地状态。

右侧答题详情仅保存在主进程内存，退出或新建批次即清空，不进入记录、导出或诊断状态。

## 5. 补丁与结果页错题

仓库根目录 `patch_rules.jsonc` 是发布基线。构建时原样复制到 App 资源；首次启动完整播种，升级仅按规范化题目补入缺失项，用户已有同题规则优先。打包结束后必须逐字节比较源文件和 `.app` 内文件。

补丁入口包括：

- 设置页手动添加、编辑和删除；
- JSON/JSONC 导入与导出；
- 从旧项目目录幂等迁入 `patch_rules.jsonc`；
- 结果页由用户翻到当前错题后点击一次“记录错题”。

结果页扫描只读取当前题、A–D 选项、网页标示的正确答案和可选错选；不自动翻页、不批量采集、不生成调试记录。重复规则提示已存在；冲突规则必须明确确认后覆盖。

## 6. 数据结构与记录

数据位于 `~/Library/Application Support/HDU-SNAP/`。V3 升级会先创建备份并只保留最近三份，随后删除旧的自定义版本清单 URL；更新频道和上次检查时间继续保留。旧 App 遇到更高数据版本时必须阻止运行。

记录只保存批次摘要，不保存账号身份、运行模式或逐题内容。全局最多 1000 批，超限删除最旧记录。

记录查询支持：

- 状态；
- 起始日期；
- 结束日期，包含该日期整天；
- 每页固定 50 条；
- 删除最后一页数据后自动收敛到仍有效的页码。

CSV/JSON 导出忽略当前页码，覆盖当前筛选条件下的全部记录。

## 7. 诊断与崩溃上下文

日志只保存在本地，并按 30 天或 100 MB 清理。主进程异常、网页进程崩溃和加载失败保存为单份 `last-crash.json`，内容仅包含时间、类型、错误名、脱敏消息/堆栈、退出原因和不含 query/hash 的页面地址。

诊断 ZIP 可包含日志、组件状态、崩溃上下文和用户主动提供的网页上下文，但必须排除密码、Cookie、会话令牌、DeepSeek Key 和钥匙串内容。诊断页必须显示明确的隐私确认复选框，未勾选时导出按钮不可用。

## 8. 版本检查

App 固定读取：

```text
https://raw.githubusercontent.com/awhg23/HDU-SNAP-update-manifest/main/manifest.json
```

清单 Schema：

```json
{
  "schema_version": 1,
  "releases": [
    {
      "version": "2.4.0",
      "channel": "stable",
      "published_at": "2026-08-21T20:25:50Z",
      "summary": "第二阶段正式完成：补齐记录、诊断和版本检查，删除第一阶段插件与本地服务入口。",
      "sha256": "4f42ab03d7b72576b59d630436413b828073d8531f7002b281ce83869bfc94bd",
      "release_url": "https://github.com/awhg23/HDU-SNAP/releases/tag/v2.4.0"
    }
  ]
}
```

解析器严格校验 Schema、频道、SemVer、时间、摘要、哈希和 Release URL，并按 SemVer 排序。状态区分“有新版本”“已是最新”和“没有适用版本”。自动检查每 24 小时最多一次，手动检查不限；App 只允许打开指定仓库的 `/releases/tag/<version>` 路径，不保存 Token、不下载或替换自身。

## 9. 构建、测试与发布

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

构建发布候选 DMG：

```bash
cd desktop
npm run make:dmg
```

打包要求 Apple Silicon、macOS 13+、Xcode、Node 和 Python 3.10+。PyInstaller sidecar 不含 FastAPI、Uvicorn、Torch、Sentence Transformers 或 M3E 模型。`prepared` 资源只作为 `extraResource` 复制一次，不得同时进入 `app.asar`。

CI 在 Ubuntu Python 3.10/3.12、macOS Python 3.10 和 Windows Python 3.10 上运行核心测试；桌面任务运行测试、构建和 `dist` 同步检查，macOS 额外执行 Electron 退出冒烟；官网任务使用 Node 22 运行 lint、路由测试和生产构建。CI 不访问真实账号、不调用 DeepSeek、不下载模型或正式 DMG。

v2.4.0 已从 `main` 提交 `ff18bf9` 构建并验收同一份 DMG，[Tag 与公开 Release](https://github.com/awhg23/HDU-SNAP/releases/tag/v2.4.0)、公开清单和[独立下载页](https://hdu-snap.awhg23.chatgpt.site)均已发布。正式包大小为 `138,263,106` 字节，SHA-256 为 `4f42ab03d7b72576b59d630436413b828073d8531f7002b281ce83869bfc94bd`；v2.3.0 Release 继续保留。
