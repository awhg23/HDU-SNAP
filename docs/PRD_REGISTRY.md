# HDU-SNAP PRD 总集

本台账只保留每个 PRD 的最新文档链接，历史版本通过 Git 追溯。

| 版本 | 标题 | 需求内容（详细摘要） | PRD 链接 |
|---|---|---|---|
| PRD-001 | HDU-SNAP 第二阶段：一体化 macOS App | 将现有 Python 后端和 Chrome 插件整合为 Apple Silicon、macOS 13+ 的自包含 App。支持单一持久网页登录会话、无账号身份的摘要记录、正常答题、最终题人工提交、手动/旧版补丁纠错、旧版补丁与 Key 迁移、完整诊断和私有 GitHub Release 更新。桌面端不提供调试模式或自动复盘；第一阶段兼容协议暂时保留。明确不做账号档案与身份记录、自动提交、密码保存、多标签、遥测上传、签名公证及 Windows/Android 实现。Mac App 验收后删除旧插件和 CLI，但保留跨平台答题核心及协议模型。 | [docs/prd/PRD-001.md](prd/PRD-001.md) |
