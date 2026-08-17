# ADR-001：macOS App 技术栈与安全边界

- 状态：已接受并实现首版
- 日期：2026-08-09
- 关联需求：`docs/prd/PRD-001.md`

## 决策

第二阶段使用 Electron 作为 macOS App 容器，以 `WebContentsView` 承载远程学习站点；现有 Python 答题核心通过 PyInstaller 打包为 Apple Silicon sidecar。主进程与 sidecar 使用 JSON Lines 标准输入/输出通信，不开启 HTTP 或 WebSocket 端口。

选择 Electron 的关键原因是：目标产品必须在同一 App 中承载任意网页、持久保留一份登录会话，并继续复用已真实验收的 JavaScript DOM 自动化逻辑。V1.1 取消账号档案和多账号隔离，新安装统一使用 `persist:hdu-snap-browser`；从 V1.0 升级时沿用一个既有分区以保留登录状态，但不再保存其账号身份或提供分区切换。

V1.3 取消 Mac App 调试模式和自动复盘。桌面端只创建正常批次，提交后保存摘要；纠错通过内置补丁、手动录入或旧版补丁导入完成。共享 Python 核心与第一阶段兼容协议暂不删除调试能力。

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

- 内置词典和 M3E 模型随 App 资源发布。
- 用户数据库、批次摘要、纠错和加密 Key 文件位于 macOS Application Support 目录。
- 批次与纠错不含账号身份；Cookie 和网站存储只保留在唯一的持久 partition 中。
- 数据结构升级前保留最近三份备份，更高版本数据会阻止旧 App 继续运行。

## 兼容与退场

领域层、应用层、Solver 和版本化协议模型继续保留。第一阶段的插件、CLI 和本地 API 在 Mac App 自动测试、DMG 测试、真实正常答题和旧版补丁迁移通过前不删除，以便对照与回退。

## 后果

App 体积会显著增加，因为 Electron、PyTorch、Sentence Transformers 与本地模型均需自包含。换取的结果是最终用户无需安装任何开发环境，并能在 App 内保留单一登录会话。Windows 后续可以复用 Electron 主体与 Python sidecar；Android 仍需独立评估 WebView 和核心运行方案。
