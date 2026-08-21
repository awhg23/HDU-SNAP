# HDU-SNAP 产品下载站

HDU-SNAP 的极简公共下载页。页面由 Sites 托管，正式 DMG 从 `RELEASES` R2 独立分发；GitHub 仅作为公开源码和历史发布记录入口。

## 本地验证

Node.js 要求 `>=22.13.0`。

```bash
npm ci
npm run dev
npm run lint
npm test
```

本地构建不下载正式 DMG。

## 发布边界

- `.openai/hosting.json` 只声明 Sites 项目标识和 `RELEASES` R2 绑定，不含密钥。
- `lib/release.ts` 是唯一发布记录；对象缺失或元数据不一致时下载路由返回 `503`。
- 不接入 D1、账号、分析、下载计数或 GitHub 下载回退。
- DMG 不进入源码 Git。
