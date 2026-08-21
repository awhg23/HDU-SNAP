# HDU-SNAP macOS 使用指南

## 安装正式版

当前正式版是 v2.3.0。要求 Apple Silicon Mac 与 macOS 13 或更高版本，运行时不需要外部 Python、Node、Chrome、插件或项目源码。

1. 下载并打开 `HDU-SNAP.dmg`。
2. 将 HDU-SNAP 拖入“应用程序”。
3. 因 App 未签名、未公证，请在 Finder 中右键 HDU-SNAP 并选择“打开”。
4. 若系统仍阻止启动，进入“系统设置 → 隐私与安全性”，对 HDU-SNAP 选择“仍要打开”。
5. 完成 App 内自检。DeepSeek Key 可跳过；验证成功后由 macOS 钥匙串保护。

覆盖安装会保留数据、唯一的网站登录会话、Key 和用户补丁。结构升级前 App 会自动备份并保留最近三份。

## 日常使用

1. 首页输入题量。每次启动默认 100，快捷项为 90、95、100。
2. 点击“进入学习站点”，在内嵌网页中手动登录并进入题目页。
3. 识别成功后点击“开始答题”。
4. 运行中可暂停、继续或停止；睡眠、网页崩溃、加载失败或页面不可执行时自动暂停。
5. 最后一题选中后 App 自动挂起。请亲自检查并提交，App 绝不点击提交按钮。
6. 提交确认后只保存批次摘要，不保存账号身份或逐题内容。

最小化时答题会继续。睡眠或错误暂停后必须由用户手动继续；继续前 App 会重新读取当前页面，不重放旧点击。

## 补丁维护

在“设置 → 补丁库”中可以：

- 手动添加、编辑或删除补丁；
- 导入、导出 JSON/JSONC；
- 从旧项目目录迁入根目录 `patch_rules.jsonc`。

在结果页可以自行翻到一条错题，然后点击“记录错题”。每次只扫描当前题和页面标示的正确答案，不会自动翻页、批量采集或恢复调试模式。重复补丁不会重复写入；冲突补丁必须确认后才能覆盖。

仓库发布基线会随安装包携带。新安装完整播种，升级只补入缺失题目，不覆盖用户已有同题修正。

## 记录、诊断与更新

记录页面按状态、起始日期和结束日期筛选，每页 50 条。结束日期包含当天全部记录；CSV/JSON 导出覆盖当前筛选的全部页。

App 不接入遥测或自动上传。诊断 ZIP 可能包含题目、决策、日志、崩溃上下文和网页中可见的个人信息，因此必须先勾选隐私确认。密码、Cookie、会话令牌、DeepSeek Key 和钥匙串内容始终排除。

版本检查只读取固定公开清单。自动检查每 24 小时最多一次，手动检查不限；App 只打开私有 GitHub Release 页面，不保存 GitHub Token，不自动下载或安装更新。无仓库权限时，浏览器会显示 GitHub 的权限页面。

用户数据目录：

```text
~/Library/Application Support/HDU-SNAP/
```

## 从源码运行

开发环境要求 Xcode、Apple Silicon Mac、Node.js 和 Python 3.10+。

首次准备：

```bash
python3.12 -m venv .venv
.venv/bin/pip install -e ".[full,dev]"
cd desktop
npm ci
```

日常修复无需反复安装 DMG。先完全退出 `/Applications/HDU-SNAP.app`，再从仓库根目录执行：

```bash
bash scripts/run_macos_dev.sh
```

该模式复用正式 App 的数据和网页登录会话。隔离测试使用：

```bash
bash scripts/run_macos_dev.sh --isolated
```

隔离数据位于已忽略的 `runtime/desktop-dev/`。源码版与安装版受单实例保护，不能同时操作同一个数据目录。

## 开发验证与构建 DMG

```bash
.venv/bin/python -m pytest
cd desktop
npm test
npm run build
npm run test:electron-exit
```

仅发布候选和安装验收需要构建 DMG：

```bash
cd desktop
npm run make:dmg
```

产物位于 `desktop/out/make/`。构建会自动生成 Apple Silicon sidecar，并检查安装包内补丁基线、资源位置和打包结果。v2.4.0 的正式 Tag 和 Release 只能在覆盖安装、真实答题、错题记录、诊断和更新检查全部人工验收通过后创建。

## 第一阶段退场说明

v2.4.0 候选代码已经删除 Chrome 插件、FastAPI/HTTP/WebSocket、本地 CLI、调试报表和旧安装/启动脚本。开发与运行均以桌面 App 为唯一产品入口；跨平台 Solver 和版本化协议模型继续保留。
