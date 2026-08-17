# HDU-SNAP macOS 教程

## 安装自包含 App

- Apple Silicon Mac
- macOS 13 或更高版本
- `HDU-SNAP.dmg`

打开 DMG 并将 HDU-SNAP 拖入“应用程序”。当前版本未签名、未公证，首次启动请：

1. 在 Finder 的“应用程序”中右键 HDU-SNAP，选择“打开”。
2. 若仍被阻止，进入“系统设置 → 隐私与安全性”，对 HDU-SNAP 选择“仍要打开”。
3. 完成 App 内严格自检。DeepSeek Key 可跳过；填写后仅保存到 macOS 钥匙串。

App 不需要 Python、Node、Chrome、插件或项目源码。App 内只有一份跨重启保留的网站登录会话，不识别或记录姓名学号，也不保存密码。

## 使用流程

1. 首页输入正整数题量，然后进入内嵌站点。
2. 在站点中手动登录并导航到题目页；登录状态会保留到下次启动。
3. 待题目识别通过后点击“开始答题”。
4. 运行中可暂停、继续或停止；睡眠恢复后必须手动继续。
5. 最后一题选择后自动挂起。请亲自检查并提交，App 绝不点击提交按钮。
6. 提交确认后保存无账号身份、无逐题内容的批次摘要。

在“设置 → 纠错补丁”中可以手动填写题目、正确答案、可选错误答案和备注。也可以直接导入旧版 JSON/JSONC 补丁文件，或在“迁移与数据”中选择第一阶段项目目录迁入根目录 `patch_rules.jsonc`。

安装包已经内置发布时仓库根目录中的完整补丁基线。首次启动会复制这份基线；升级只补齐缺失题目，不会覆盖用户已经手动修正的同题规则。

用户数据位于：

```bash
~/Library/Application Support/HDU-SNAP/
```

升级前 App 会保留最近三份结构备份。旧项目补丁和可选 Key 可在“设置 → 迁移与数据”中导入；迁移不会修改旧目录，也不会迁入调试记录或 Chrome Cookie。

## 无需安装的源码验收

日常修复后无需反复构建、拖入和覆盖安装 DMG。完全退出已安装的 HDU-SNAP 后，在项目根目录运行：

```bash
bash scripts/run_macos_dev.sh
```

该命令构建前端小型产物并直接启动源码 App，使用与已安装版相同的用户数据目录，所以已有网站登录会话和记录可以继续用于真实站点验证。单实例保护会阻止源码版和已安装版同时操作同一份数据。

如需不影响正式数据的测试环境，运行：

```bash
bash scripts/run_macos_dev.sh --isolated
```

隔离数据位于仓库内已忽略的 `runtime/desktop-dev/`，需要单独登录。DMG 只在准备交付版本和执行最终安装验收时重新构建。

## 从源码构建 DMG

仅开发者需要 Xcode、Node 与 Python 3.10+：

```bash
python3.12 -m venv .venv
.venv/bin/pip install -e ".[full,dev]"
bash setup_full_macos.sh
bash scripts/build_macos_sidecar.sh
cd desktop
npm ci
npm test
npm run make:dmg
```

产物位于 `desktop/out/make/`。打包脚本只支持 Apple Silicon；模型必须已存在于 `.models/moka-ai_m3e-base/`。`npm run make:dmg` 会在生成后校验 `.app` 内的 `patch_rules.jsonc` 与仓库发布基线完全一致，不一致时构建失败。

## 第一阶段旧版入口

Mac App 完成真实正常答题、安装和迁移验收前，旧插件与 CLI 仍保留。旧版调试能力只存在于这条兼容链路。需要对照旧行为时：

```bash
bash start_backend.sh full
```

也可以使用：

```bash
.venv/bin/python main.py
.venv/bin/hdu-snap serve
```

该入口仍需要 Chrome 插件和 Python 环境。Mac App 验收完成后才会按 PRD 的退场顺序删除旧入口。

## 诊断与隐私

App 不接入遥测或自动上传。批次记录不保存姓名学号；诊断包可以包含题目、决策、网页快照、日志及页面中可见的个人信息，因此导出前需要明确确认。密码、Cookie、会话令牌、DeepSeek Key 和钥匙串内容会被排除。
