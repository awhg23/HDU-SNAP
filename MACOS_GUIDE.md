# HDU-SNAP macOS 教程

## 准备

- Python 3.10 或更高版本
- Google Chrome
- 可选的 DeepSeek API Key

## 安装

进入项目目录并创建配置：

```bash
cp .env.example .env
open -e .env
```

需要大模型兜底时，填写 `DEEPSEEK_API_KEY`。然后安装完整依赖和本地向量模型：

```bash
bash setup_full_macos.sh
```

脚本会检查 `.venv` 的 Python 版本。若发现 Python 3.9 等旧环境，会先备份为 `.venv-python3.9.x-backup-时间戳`，然后使用已安装的 Python 3.10+ 重新创建 `.venv`。如果没有兼容解释器，先运行：

```bash
brew install python@3.12
```

也可以使用 uv：

```bash
uv python install 3.12
```

在 Chrome 中打开 `chrome://extensions/`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择项目的 `extension` 文件夹。

## 启动

```bash
bash start_backend.sh full
```

也可以使用：

```bash
.venv/bin/python main.py
.venv/bin/hdu-snap serve
```

选择模式和答题数量后，Chrome 会打开目标站点。手动登录并进入题目页面，插件随后自动答题；最后一题不会自动提交。

## 检查与自定义端口

默认健康检查地址：

- [http://127.0.0.1:8765/health](http://127.0.0.1:8765/health)

如修改 `.env` 中的 `HDU_SNAP_SERVER_PORT`：

1. 打开 `chrome://extensions/`。
2. 进入 HDU-SNAP 扩展详情。
3. 打开“扩展程序选项”。
4. 填写新的本机地址并点击“测试连接”和“保存”。

查看经过脱敏的有效配置：

```bash
.venv/bin/hdu-snap config --check
```

## 调试报告

```bash
.venv/bin/hdu-snap report
```

输出位于 `runtime/debug_report.html` 和 `runtime/debug_report_summary.json`。
