# HDU-SNAP 技术文档

## 项目结构

```text
HDU-SNAP/
├── extension/               # Chrome 插件
├── CET/                     # 内置词库缓存
├── runtime/                 # 运行时日志、数据库、报表
├── main.py                  # 后端主程序
├── patch_rules.jsonc        # 补丁区
├── generate_debug_report.py # 生成调试报表
└── README.md
```

## 工作流程

1. 用户手动登录网页
2. 插件默认对当前 Chrome 标签页开启手机端兼容
3. 用户手动进入题目页面
4. Chrome 插件监听题目 DOM
5. 插件把题目通过 WebSocket 发给本地后端
6. 后端按 `补丁规则 -> 字典 -> 向量 -> 大模型` 进行决策
7. 插件点击答案并翻到下一题
8. 第 100 题自动挂起，不提交

## 后端决策层级

### 1. 补丁规则

- 文件位置：`patch_rules.jsonc`
- 用于修正常见误判题
- 调试模式下可以自动写入

规则模板：

```json
{
  "source_text": "解决",
  "answer_text": "resolve",
  "wrong_answer_text": "dissolve",
  "note": "避免词库命中到 dissolve"
}
```

### 2. 字典匹配

- 词库来源：`CET/Data.lexicon.cache.json`
- 程序启动时自动导入 SQLite
- 如果字典只命中唯一候选项，则直接返回
- 如果同时命中多个候选项，则终止 Tier 1，直接交给 Tier 3

### 3. 向量相似度

- 本地模型目录：`.models/moka-ai_m3e-base`
- 当前阈值：
  - `top score >= 0.78`
  - `margin >= 0.10`

### 4. 大模型决策

- 使用 DeepSeek 兼容接口
- 环境变量：`DEEPSEEK_API_KEY`
- 当本地层级无法稳定决策时触发

## 调试模式

启动 `main.py` 后：

- 输入 `1`：正常模式
- 输入 `0`：调试模式

调试模式会生成：

- `runtime/debug_recent_10000.json`
- `runtime/debug_error_1000.json`

调试模式下，系统会自动：

- 在手动提交后进入历史记录页
- 自动点开最新记录
- 自动进入逐题答案页
- 自动从题卡中读取红色错题
- 自动补全错选和正选文本
- 自动写入 `patch_rules.jsonc`

## 可视化报表

运行：

```powershell
.\.venv\Scripts\python.exe generate_debug_report.py
```

会生成：

- `runtime/debug_report.html`
- `runtime/debug_report_summary.json`

## 健康检查

启动后访问：

- `http://127.0.0.1:8765/health`

可查看：

- 当前运行模式
- 词库路径
- 补丁区路径
- 补丁条数
- 向量模式
- 模型目录

## Chrome 插件说明

插件文件：

- `extension/manifest.json`
- `extension/background.js`
- `extension/content.js`

插件能力：

- 默认开启手机端兼容
- 自动监听题目变化
- 自动抓题
- 自动点击选项
- 选项点击和翻页之间插入随机延迟
- 最后一题自动挂起

## 依赖说明

基础依赖：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-lite.txt
```

如果你后面要更高准确率，可以再装完整依赖：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 注意

- `runtime/` 下的数据库和日志一般不需要提交到 GitHub
- `.venv/` 和 `.models/` 也不需要提交
- 真正需要长期维护的人工修正规则主要在 `patch_rules.jsonc`
