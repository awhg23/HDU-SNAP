# HDU-SNAP

HDU-SNAP 是一个面向英文词汇学习网页的本地自动化测试项目，用于在浏览器中接管做题流程，完成前端 UI 交互测试与 NLP 自动判题联动。

项目由两部分组成：

- Chrome Extension：负责监听页面、抓取题目、点击选项、翻页与最后一题挂起
- FastAPI Backend：负责三级 NLP 决策、日志输出、性能统计与 WebSocket 服务

当前代码已经覆盖以下核心链路：

- 用户手动登录页面
- 插件接管当前做题页
- 插件抓取题干和四个选项
- 通过 WebSocket 将题目发送给本地后端
- 后端按 `字典 -> 向量 -> 大模型` 三级级联决策返回答案
- 插件点击目标选项，并在 100-300ms 随机延迟后点击“下一项”
- 到第 100 题时自动挂起，绝不自动提交
- 后端收到完成信号后打印最终统计信息

## 1 分钟快速开始

如果你只想最快跑起来，按这个顺序就够了：

1. 在项目根目录启动后端

```bash
cd /Users/awhg23/mycode/HDU-SNAP
bash start_backend.sh lite
```

如果你要启用真实向量模型和 DeepSeek 兜底，用：

```bash
cd /Users/awhg23/mycode/HDU-SNAP
bash start_backend.sh full
```

2. 打开 Chrome，访问 `chrome://extensions/`
3. 打开“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择目录 [extension](/Users/awhg23/mycode/HDU-SNAP/extension)
6. 启动后端时会自动尝试打开默认英语网站
7. 手动登录并进入答题页
8. 手动点一次“开始”，之后插件会自动接管，不需要回终端按回车

补充：

- 如果要启用 DeepSeek，把 [.env.example](/Users/awhg23/mycode/HDU-SNAP/.env.example) 复制成 `.env`，填入 `DEEPSEEK_API_KEY`
- `lite` 模式适合先联调流程
- `full` 模式适合追求准确率

## 目录结构

```text
HDU-SNAP/
├── extension/
│   ├── background.js
│   ├── content.js
│   └── manifest.json
├── install_vector_tier.sh
├── .env.example
├── requirements-lite.txt
├── requirements.txt
├── runtime/
│   └── hdu_snap.db              # 运行时自动生成
├── start_backend.sh
├── CET/
│   └── Data.lexicon.cache.json  # 项目内置词库缓存
├── main.py
└── README.md
```

## 架构概览

### 后端三级 NLP 引擎

后端收到题目后，按以下顺序处理：

1. Tier 1 `字典匹配`
   从 `CET/Data.lexicon.cache.json` 导入 SQLite，本地精确匹配官方释义与候选项。
2. Tier 2 `向量相似度`
   当本地存在向量模型目录时，使用 `sentence-transformers` 真正执行 embedding 相似度；如果模型目录不存在，会自动退化到轻量级字符 n-gram 回退逻辑。
3. Tier 3 `大模型决策`
   当 Tier 2 最高分与次高分差值 `<= 0.05` 时，调用 DeepSeek 兼容接口兜底，统计 `ai_call_count`。

### 前后端通信

- 插件与本地后端使用 WebSocket 通信
- 默认地址：`ws://127.0.0.1:8765/ws/solve`
- 后端健康检查：`http://127.0.0.1:8765/health`

### UI 自动化约束

- 插件通过 `MutationObserver` 监听异步渲染
- 选项点击与“下一项”点击之间强制插入 `100ms - 300ms` 随机延迟
- 第 100 题只点击答案，不点击提交
- 检测到疑似提交态但没有“下一项”按钮时，也会主动挂起，避免误提交

## 运行环境

建议环境：

- Python `3.10+`
- Chrome 最新稳定版
- macOS / Windows / Linux

推荐 Python 依赖：

```bash
fastapi
uvicorn
pydantic
openai
sentence-transformers
torch
```

仓库里已经提供：

- [requirements.txt](/Users/awhg23/mycode/HDU-SNAP/requirements.txt)：完整依赖
- [requirements-lite.txt](/Users/awhg23/mycode/HDU-SNAP/requirements-lite.txt)：仅跑通联调用的最小依赖

说明：

- `openai` 用于兼容 DeepSeek API
- `sentence-transformers` 与 `torch` 用于真实向量检索
- 如果没安装 `openai` 或 `sentence-transformers`，项目仍可启动，但会自动进入降级模式，适合先联调流程，不适合追求最终准确率

## 第一步：安装后端依赖

最省事的方式是直接运行：

```bash
cd /Users/awhg23/mycode/HDU-SNAP
bash start_backend.sh lite
```

如果你想手动安装，也可以这样：

```bash
cd /Users/awhg23/mycode/HDU-SNAP
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
```

如果你只想先验证链路是否能跑通，不追求真实向量和大模型，可以少装两个依赖：

```bash
pip install -r requirements-lite.txt
```

## 第二步：配置 DeepSeek API Key

如果需要启用 Tier 3 大模型决策，先设置环境变量：

```bash
export DEEPSEEK_API_KEY="你的密钥"
```

或者在项目根目录新建 `.env`：

```bash
cp .env.example .env
```

然后把 `.env` 中的 `DEEPSEEK_API_KEY` 填好。

如果不配置：

- 后端仍可启动
- Tier 3 不会真正调用远程模型
- 会自动退回到本地确定性回退逻辑

## 第三步：启动后端

在项目根目录执行：

```bash
cd /Users/awhg23/mycode/HDU-SNAP
bash start_backend.sh lite
```

或者完整模式：

```bash
cd /Users/awhg23/mycode/HDU-SNAP
bash start_backend.sh full
```

如果你已经手动装好了环境，也可以继续使用：

```bash
source .venv/bin/activate
python3 main.py
```

默认监听：

- HTTP: `http://127.0.0.1:8765`
- WebSocket: `ws://127.0.0.1:8765/ws/solve`

首次启动时，后端会自动把 `CET/Data.lexicon.cache.json` 导入 SQLite，生成：

- [runtime/hdu_snap.db](/Users/awhg23/mycode/HDU-SNAP/runtime/hdu_snap.db)

启动成功后，你可以访问健康检查接口：

- [http://127.0.0.1:8765/health](http://127.0.0.1:8765/health)

## 第四步：加载 Chrome 插件

1. 打开 Chrome
2. 进入 `chrome://extensions/`
3. 打开右上角“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择目录：

- [extension](/Users/awhg23/mycode/HDU-SNAP/extension)

加载完成后，插件会自动注入到以下域名：

- `https://skl.hdu.edu.cn/*`
- `https://skl.hduhelp.com/*`

## 第五步：实际使用流程

1. 启动后端 `python3 main.py`
2. 确认 Chrome 插件已加载
3. 打开目标词汇学习网页
4. 手动完成登录
5. 手动进入做题页面
6. 手动点击页面中的“开始”
7. 插件检测到题面和选项后自动开始工作
8. 插件逐题发送给后端，接收答案并执行点击
9. 到第 100 题后自动挂起，等待人工核验
10. 测试工程师确认无误后，手动点击提交

## 消息协议

### 题目请求

前端发送给后端：

```json
{
  "type": "solve_item",
  "session_id": "tab-1711900000000-7a1d9f0c",
  "item_id": 1,
  "source_text": "affect",
  "options": {
    "A": "影响",
    "B": "效果",
    "C": "喜爱",
    "D": "效率"
  }
}
```

### 判题响应

后端返回给前端：

```json
{
  "type": "decision",
  "session_id": "tab-1711900000000-7a1d9f0c",
  "item_id": 1,
  "target": "A",
  "method": "字典匹配",
  "confidence": 1.0,
  "detail": "affect -> 影响 (Data.lexicon.cache.json)"
}
```

### 批量完成信号

前端在第 100 题挂起后发送：

```json
{
  "type": "batch_complete",
  "session_id": "tab-1711900000000-7a1d9f0c",
  "total_items": 100
}
```

### 汇总响应

后端返回：

```json
{
  "type": "batch_summary",
  "session_id": "tab-1711900000000-7a1d9f0c",
  "total_items": 100,
  "ai_call_count": 7,
  "status": "pending_manual_confirmation"
}
```

## 后端日志格式

每题完成后，后端会在控制台打印：

```text
[节点校验日志]
第1题: affect
候选项: A. 影响 | B. 效果 | C. 喜爱 | D. 效率
处理方式: 字典匹配
决策结果: A
------------------------
```

测试批次完成后，后端会打印：

```text
========================
[自动化测试运行结束]
总计处理测试项: 100 个
触发大模型 (Tier 3) 决策总次数: X 次
状态: 挂起，等待人工确认表单...
========================
```

## 关键实现说明

### `main.py`

- FastAPI 应用入口
- `/ws/solve` WebSocket 服务
- `DictionaryEngine`：JSON -> SQLite 导入与精确匹配
- `VectorEngine`：真实 embedding 或本地回退相似度计算
- `LLMEngine`：DeepSeek 兼容调用、超时与重试
- `NLPPipeline`：三级级联决策与日志打印

文件位置：

- [main.py](/Users/awhg23/mycode/HDU-SNAP/main.py)

### `extension/background.js`

- 维护与后端的 WebSocket 长连接
- 处理断线重连和消息排队
- 在后端与内容脚本之间做路由转发
- 使用 `session_id + item_id` 防止多标签页串消息

文件位置：

- [extension/background.js](/Users/awhg23/mycode/HDU-SNAP/extension/background.js)

### `extension/content.js`

- 监听页面异步渲染
- 抓取题目、选项、进度和下一项按钮
- 调用后端判题
- 执行安全点击和随机延迟
- 第 100 题挂起并提示人工确认

文件位置：

- [extension/content.js](/Users/awhg23/mycode/HDU-SNAP/extension/content.js)

## 当前实现的默认行为

### 关于题型

当前后端已经兼容：

- 英文题干 -> 中文选项
- 中文题干 -> 英文选项

### 关于向量模型

默认代码中预留的模型名是：

```text
moka-ai/m3e-base
```

如果本地环境可正常加载该模型，则 Tier 2 使用真实向量相似度。
如果本地模型目录不存在，或当前环境没有 `sentence-transformers`，会自动降级到本地字符级相似度回退逻辑。

### 关于 DeepSeek

默认接口配置：

- Base URL: `https://api.deepseek.com`
- Model: `deepseek-chat`
- 环境变量：`DEEPSEEK_API_KEY`

大模型调用仅在 Tier 2 分差不足时触发。

## 常见排错

### 1. 插件没有自动开始

排查顺序：

1. 确认已进入真正的做题页，而不是列表页
2. 确认页面已经显示题目和 A/B/C/D 四个选项
3. 打开浏览器控制台，查看是否有 `[HDU-SNAP][content]` 日志
4. 确认后端已经启动且 `ws://127.0.0.1:8765/ws/solve` 可用

### 2. 后端能启动，但提示缺少模型

如果你想启用真正的第二层向量模型，直接执行：

```bash
cd /Users/awhg23/mycode/HDU-SNAP
./install_vector_tier.sh
```

执行完成后，向量模型会被下载到：

- `/Users/awhg23/mycode/HDU-SNAP/.models/moka-ai_m3e-base`

如果看到类似提示：

```text
vector model directory not found, fallback scorer enabled: /Users/awhg23/mycode/HDU-SNAP/.models/moka-ai_m3e-base
```

这说明：

- 项目仍然能跑
- 但当前不是最终高精度模式

这说明当前第二层还没有启用真实 embedding，只是在用回退算法。

### 3. 插件误识别了提交按钮

当前插件已经做了两层保护：

- 第 100 题时绝不自动点击提交
- 如果检测到“提交/保存”但没检测到“下一项”，会立即挂起

如果实际页面按钮文案发生变化，可以修改：

- [extension/content.js](/Users/awhg23/mycode/HDU-SNAP/extension/content.js)

重点检查函数：

- `findNextButton()`
- `findSubmitButton()`
- `collectOptions()`
- `findQuestionElement()`

### 4. 题目抓取不稳定

这是页面 DOM 变化最常见的影响点。

建议排查：

1. 实际题干节点是否仍包含 `question/title/stem/topic` 等类名
2. 选项是否还是 `A. xxx` 这种可解析格式
3. 选项文字是否被拆到了多个子节点
4. 页面是否被放进了 iframe

当前插件已经实现多组选择器和回退扫描，但如果学校页面结构变化很大，仍可能需要手动补选择器。

### 5. DeepSeek 调用失败

排查：

1. 是否设置了 `DEEPSEEK_API_KEY`
2. 网络是否可访问 `https://api.deepseek.com`
3. 当前模型名是否仍为 `deepseek-chat`
4. 是否触发了接口限流或超时

后端已经实现简单重试；连续失败后会退回本地 top-1 候选，避免整个流程阻塞。

## 性能建议

如果你的目标是稳定达到：

- 100 题总耗时小于 6 分钟
- 准确率高于 95%

建议：

1. 本地安装真实 `sentence-transformers` 模型，不要只用回退相似度
2. 配置 `DEEPSEEK_API_KEY`，保留 Tier 3 兜底
3. 尽量保证本地网络稳定，减少大模型请求抖动
4. 在正式测试前，用 10-20 题先做一次 DOM 选择器回归检查
5. 避免浏览器打开过多标签页，降低内容脚本噪音

## 安全与边界

本项目当前默认遵守以下边界：

- 不负责自动登录
- 不负责自动点击“开始”
- 不负责自动点击最终提交
- 最后一步始终留给人工确认

这样设计是为了：

- 降低误提交风险
- 方便测试工程师人工验收最后结果
- 更符合你提出的“流程挂起、保留现场”的要求

## 开发建议

如果后续你准备继续迭代，推荐优先做这几件事：

1. 给后端补 `requirements.txt` 或 `pyproject.toml`
2. 给插件补一个 popup 面板，用来显示连接状态、当前题号、最近判题方式
3. 给内容脚本增加调试快照导出能力，便于 DOM 变化时定位
4. 将选择器配置抽成独立文件，方便适配多个站点版本
5. 增加 WebSocket 心跳与题目去重缓存

## 许可证与使用提醒

本项目仅供本地测试、学习研究与自动化工程实践使用。

在实际使用前，请自行确认目标平台、学校或业务系统的相关规则与合规要求。
