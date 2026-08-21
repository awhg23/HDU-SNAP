# ADR-001：macOS App 技术栈与安全边界

- 状态：已接受；v2.4.0 候选实现完成
- 日期：2026-08-09
- 关联需求：`docs/prd/PRD-001.md`

## 决策

第二阶段使用 Electron 作为 macOS App 容器，以 `WebContentsView` 承载远程学习站点；现有 Python 答题核心通过 PyInstaller 打包为 Apple Silicon sidecar。主进程与 sidecar 使用 JSON Lines 标准输入/输出通信，不开启 HTTP 或 WebSocket 端口。

选择 Electron 的关键原因是：目标产品必须在同一 App 中承载任意网页、持久保留一份登录会话，并继续复用已真实验收的 JavaScript DOM 自动化逻辑。V1.1 取消账号档案和多账号隔离，新安装统一使用 `persist:hdu-snap-browser`；从 V1.0 升级时沿用一个既有分区以保留登录状态，但不再保存其账号身份或提供分区切换。

V1.3 取消 Mac App 调试模式和自动复盘。桌面端只创建正常批次，提交后保存摘要；纠错通过内置补丁、手动录入、结果页当前错题扫描或旧版补丁导入完成。

V1.4 删除本地向量模型层。Solver 顺序调整为“补丁 → 词典 → DeepSeek → 确定性兜底”，不再依赖 Torch、Sentence Transformers 或 M3E；DeepSeek 未配置或请求失败时固定使用可审计的确定性兜底。该变更同时消除 App 内的大模型权重和 Python 机器学习运行时。

V1.5 在 v2.4.0 正式退场第一阶段实现。Chrome 插件、FastAPI/HTTP/WebSocket、CLI、调试报表和旧启动脚本删除；协议模型迁至 `hdu_snap.protocol` 并保持字段和解析语义。sidecar 收敛为初始化、健康检查、答题、补丁维护、Key 验证和关闭，不保留调试文件或复盘流水线。

V1.6 数据结构升级到 V3：版本清单地址改为编译期固定的公开只读 URL，持久数据只保留更新频道和上次检查时间。记录增加日期筛选和每页 50 条分页；诊断增加显式隐私确认与脱敏崩溃上下文。

## 安全约束

- 本地 UI 和远程网页均启用 `sandbox`、`contextIsolation` 与 `webSecurity`，并禁用 Node 集成。
- 远程网页预加载脚本只允许向主进程发送结构化站点事件，不向页面暴露 Electron API。
- 任意 HTTPS 可浏览；自动化只允许两个 HDU 域名。HTTP 逐次确认，证书错误直接阻断。
- DeepSeek Key 使用 Electron `safeStorage`，在 macOS 上由系统钥匙串保护；Key 不进入渲染进程、网页、记录、日志或诊断。
- 主进程对来自网页适配器的题目、选项、题号与状态重新校验。
- 运行中阻止用户网页点击和应用导航；自动点击仍在隔离预加载世界内执行。
- 最终题分支只查找目标选项并选择，不查找、不触发提交按钮。提交检测只观察用户可信点击及结果页变化。
- 网页画布固定为 412 像素宽，并通过移动 UA 与 DevTools Protocol 覆盖 Android 平台和触摸点。Electron 43 的 `webContents.enableDeviceEmulation()` 在 `WebContentsView` 上会触发 macOS 原生崩溃，因此明确禁用该 API。

## 资源与数据

- 内置词典和补丁基线随 App 资源发布；不携带本地向量模型。
- 用户数据库、批次摘要、纠错和加密 Key 文件位于 macOS Application Support 目录。
- 批次与纠错不含账号身份；Cookie 和网站存储只保留在唯一的持久 partition 中。
- 数据结构升级前保留最近三份备份，更高版本数据会阻止旧 App 继续运行。
- 公开版本清单只接受固定 Schema 和指定私有仓库的 Release URL；App 不保存 GitHub Token、不下载或自动安装。

## 兼容与退场

领域层、应用层、Solver 和版本化协议模型继续保留。第一阶段的插件、CLI、本地 API、调试报表和旧脚本已在 v2.4.0 候选代码中删除；不再提供对应运行入口。协议模型的迁移不得改变既有字段或解析语义，以便未来 Windows、Android 或其他适配器复用。

## 后果

App 仍需自包含 Electron 与 Python sidecar，但不再携带 PyTorch、Sentence Transformers 和本地模型。打包时 `prepared` 资源只作为 `extraResource` 写入一次，不重复进入 `app.asar`，因此安装包和落盘体积明显下降。最终用户仍无需安装任何开发环境，并能在 App 内保留单一登录会话。Windows 后续可以复用 Electron 主体与 Python sidecar；Android 仍需独立评估 WebView 和核心运行方案。
