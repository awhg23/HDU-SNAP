# HDU-SNAP

HDU-SNAP 是一个本地运行的英语单词题自动化工具，由 Python 后端和 Chrome 插件组成。

后端按照以下顺序选择答案：

1. 补丁规则
2. 本地词典
3. 本地向量模型
4. DeepSeek 或确定性兜底

插件负责识别网页题目、点击答案和翻页。最后一题只会选择答案，**不会自动提交**。

## Windows 快速开始

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
