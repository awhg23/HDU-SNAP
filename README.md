# HDU-SNAP

HDU-SNAP 是一个本地运行的英语单词题自动化工具。第二阶段正在将 Python 答题核心和网页自动化整合为自包含的 Apple Silicon macOS App；第一阶段的 Python 后端与 Chrome 插件暂时保留，用于行为对照和回退。

开发者可先阅读 [开发文件指南](docs/DEVELOPMENT_FILE_GUIDE.md)，了解每个文件属于命令行版、Chrome 插件、共享核心还是桌面版，以及是否可以删除或重新生成。

后端按照以下顺序选择答案：

1. 补丁规则
2. 本地词典
3. 本地向量模型
4. DeepSeek 或确定性兜底

无论使用 Mac App 还是旧插件，最后一题都只会选择答案，**不会自动提交**。

## macOS App（第二阶段）

要求 Apple Silicon 与 macOS 13+。运行时不依赖外部 Python、Node、Chrome 或浏览器插件，DeepSeek Key 仅保存到 macOS 钥匙串。

日常修复验证不需要重新生成或安装 DMG。先完全退出 `/Applications/HDU-SNAP.app`，再从源码启动；开发版直接使用现有的 `~/Library/Application Support/HDU-SNAP/`，因此网页登录会话和记录可以继续使用：

```bash
bash scripts/run_macos_dev.sh
```

首次运行前需要在 `desktop/` 执行一次 `npm ci`。如需完全隔离的临时数据和登录会话，可执行 `bash scripts/run_macos_dev.sh --isolated`；数据写入已忽略的 `runtime/desktop-dev/`。开发版与已安装版受单实例保护，不能同时运行。

自动测试与构建：

```bash
.venv/bin/pytest
cd desktop
npm test
npm run build
```

只有准备交付或做安装验收时才生成自包含 sidecar 和未签名 DMG：

```bash
.venv/bin/pip install -e ".[full,dev]"
bash scripts/build_macos_sidecar.sh
cd desktop
npm run make:dmg
```

DMG 位于 `desktop/out/make/`。未签名版本首次打开时，需要在 Finder 中右键 App 选择“打开”，或在“系统设置 → 隐私与安全性”中手动允许。

Mac App 使用一份持久网站数据容器，不识别或记录姓名学号。主路径通过标准输入/输出直接调用答题核心，不监听本机 HTTP/WebSocket 端口。桌面端只提供正常答题，不自动复盘，也不保存逐题调试内容。数据位于 `~/Library/Application Support/HDU-SNAP/`。提交后可手动翻到一条错题并点击“记录错题”，也可在设置页手动添加补丁、导入旧版 JSON/JSONC，或从第一阶段项目目录迁入 `patch_rules.jsonc`。

“记录错题”每次只扫描当前展示的错题并写入补丁库，不会自动翻页或采集整批结果。设置页尚未保存的手动补丁草稿会在本次 App 运行期间跨页面保留，保存成功后才清空。

补丁库按最新优先显示；这只是界面排序，不会改写 `patch_rules.jsonc` 的既有顺序或答题匹配逻辑。

桌面界面采用奶油纸、陶土、芥末黄和深橄榄组成的暖色设计，不使用蓝白商务风。应用图标均为随源码发布的 SVG，首页与首次引导使用本地打包的学习插画；界面不加载网络字体或远程视觉资源。学习页仍保持 412px 答题画布居中，答题详情独立贴近窗口右侧。

首页每次启动默认 100 题，并提供 90、95、100 三个快捷题量。点击“进入学习站点”后会等待内嵌网页实际切换到设置的学习首页，再显示带“开始答题”按钮的待就绪批次。

仓库根目录的 `patch_rules.jsonc` 是发布内置补丁基线。新安装会把它完整播种到用户数据目录；升级只补入用户补丁中尚不存在的题目，不覆盖已有手动修正。DMG 构建完成后会强制校验 App 内补丁与仓库基线逐字节一致。

## 旧版 Windows / 插件快速开始

需要 Python 3.10+、Chrome 和可选的 DeepSeek API Key。

1. 创建本地配置：

```powershell
copy .env.example .env
notepad .env
```

2. 如需大模型兜底，在 `.env` 填写 `DEEPSEEK_API_KEY`。
3. 安装完整依赖和本地向量模型：

```powershell
powershell -ExecutionPolicy Bypass -File .\setup_full_windows.ps1
```

安装脚本会验证 Python 版本。如果已有 `.venv` 低于 Python 3.10，会先将其移动到带时间戳的 `.venv-python*-backup-*` 目录，再用兼容解释器创建新环境，不会直接删除旧环境。

4. 在 `chrome://extensions/` 开启开发者模式，选择“加载已解压的扩展程序”，加载仓库中的 `extension` 文件夹。
5. 启动后端：

```powershell
.\.venv\Scripts\python.exe main.py
```

6. 选择正常或调试模式并输入答题数量。登录站点并手动进入题目页后，插件会开始工作。

旧入口继续受支持，也可以使用新的 CLI：

```powershell
.\.venv\Scripts\hdu-snap.exe serve
.\.venv\Scripts\hdu-snap.exe serve --mode normal --answer-count 100
.\.venv\Scripts\hdu-snap.exe config --check
```

## 后端与插件设置

默认后端地址是 `http://127.0.0.1:8765`。

- 健康检查：[http://127.0.0.1:8765/health](http://127.0.0.1:8765/health)
- 插件安全配置：[http://127.0.0.1:8765/api/v1/client-config](http://127.0.0.1:8765/api/v1/client-config)
- 自定义端口时，同时修改 `.env` 中的 `HDU_SNAP_SERVER_PORT`，并在 Chrome 扩展详情页打开 HDU-SNAP 的“扩展程序选项”保存新地址。

所有配置项及默认值见 [.env.example](./.env.example)。真实 `.env`、模型和运行时数据不会提交到 Git。

## 运行模式

- 正常模式：自动选择并翻页，在配置的最后一题挂起，等待用户检查和提交。
- 调试模式：提交后从结果页采集错题，写入 `runtime/` 调试记录，并更新 `patch_rules.jsonc`。

生成调试报告：

```powershell
.\.venv\Scripts\python.exe generate_debug_report.py
```

或：

```powershell
.\.venv\Scripts\hdu-snap.exe report
```

## 开发

Python 轻量开发环境：

```bash
python3.10 -m venv .venv
. .venv/bin/activate
python -m pip install -e ".[dev]"
python -m pytest
```

插件源码位于 `extension/src/`，可加载产物提交在 `extension/dist/`：

```bash
cd extension
npm ci
npm test
npm run build
```

如果安装时看到 `requires a different Python`，说明旧虚拟环境版本过低。更新代码后重新运行对应的 `setup_full_*` 脚本即可；若系统中没有 Python 3.10+，macOS 可先执行 `brew install python@3.12`。

更多内容：

- [Mac 教程](./MACOS_GUIDE.md)
- [技术文档](./TECHNICAL.md)
