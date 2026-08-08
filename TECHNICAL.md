# HDU-SNAP 技术文档

## 架构

```text
main.py / hdu-snap CLI
        │
        ▼
src/hdu_snap/
├── config.py              # Pydantic Settings、路径和客户端安全配置
├── domain/                # 纯领域类型与文本处理
├── application/           # Solver Pipeline 与调试反馈
├── infrastructure/        # SQLite、补丁、日志、向量和 LLM
├── api/                   # FastAPI、HTTP 与 WebSocket 协议
└── reporting/             # 调试报表

extension/
├── src/                   # 后台、内容脚本、设置页与共享源码
├── dist/                  # ESBuild 生成并提交的 Chrome 可加载产物
├── manifest.json
└── options.html
```

Python 模块导入不会创建文件、加载向量模型或发起网络请求。服务资源由 FastAPI lifespan 显式初始化，并可在测试中注入替代实现。

## 答题流程

1. 用户手动登录并进入题目页。
2. 内容脚本等待后端安全配置，然后监听题目 DOM。
3. 后台脚本通过 WebSocket 将题目发送到本地后端。
4. Solver 按 `补丁 -> 字典 -> 向量 -> LLM/兜底` 决策。
5. 内容脚本点击选项并翻页。
6. 达到配置数量后挂起，不点击提交。
7. 调试模式下，结果页错题会回传并写入补丁及调试记录。

## API 协议

- `GET /health`：兼容健康检查和运行状态。
- `GET /api/v1/client-config`：插件可见的无敏感配置，当前 `schema_version=1`、`protocol_version=1`。
- `WS /ws/solve`：答题和复盘协议。

客户端消息：`solve_item`、`batch_complete`、`review_results`。

服务端消息：`decision`、`error`、`batch_summary`、`review_results_ack`。

协议字段保持与重构前兼容。插件设置页仅保存 loopback 后端地址，不保存 API Key。

## 配置

配置优先级：

```text
CLI 参数 > 进程环境变量 > 根目录 .env > 默认值/交互输入
```

所有环境变量由 `Settings` 加载和校验。完整列表见 `.env.example`，主要分为：

- 运行模式和答题数量
- 服务 host、port 与日志级别
- 数据、词库、补丁和模型路径
- 向量阈值、LLM 地址与模型
- 插件延迟、重连、TTL 和移动端模拟配置

默认数据位置保持兼容：

- `runtime/hdu_snap.db`
- `runtime/debug_recent_10000.json`
- `runtime/debug_error_1000.json`
- `patch_rules.jsonc`
- `CET/Data.lexicon.cache.json`
- `.models/moka-ai_m3e-base`

`HDU_SNAP_DATA_DIR` 只改变数据库、调试日志和报表目录，不自动迁移旧数据。

## 开发与验证

```bash
python -m pip install -e ".[dev]"
python -m pytest
cd extension
npm ci
npm test
npm run build
```

CI 在 Ubuntu Python 3.10/3.12、macOS 3.10 和 Windows 3.10 上运行轻量测试；插件任务验证测试、构建以及 `dist/` 是否与源码同步。CI 不下载向量模型、不请求 DeepSeek、不访问真实题目站点。
