# HDU-SNAP

HDU-SNAP 是一个自动做英语单词题的小工具。

你手动登录网页后，它会自动：

- 读取题目
- 把题目发给本地后端
- 自动选答案
- 自动点“下一题”
- 在第 100 题停住，不会自动提交

这份首页教程只写 Windows，而且目标很明确：

**让你用最简单的方法跑通三级级联**

三级级联指的是：

- Tier 1：字典匹配
- Tier 2：本地向量模型
- Tier 3：DeepSeek 大模型

## Windows 快速开始

先准备好 3 样东西：

- `Python 3.10` 或更高版本
- `Chrome`
- 你自己的 `DeepSeek API Key`

然后按下面做。

1. 下载并解压项目。
2. 打开项目文件夹。
3. 在空白处按住 `Shift` 再点鼠标右键，点击“在此处打开 PowerShell 窗口”。
4. 输入下面这条命令，创建 `.env` 文件：

```powershell
copy .env.example .env
```

5. 输入下面这条命令，打开 `.env`：

```powershell
notepad .env
```

6. 把 `DEEPSEEK_API_KEY=` 后面填成你自己的 key，保存并关闭。
7. 输入下面这条命令，一次性装好三级级联需要的依赖和本地向量模型：

```powershell
powershell -ExecutionPolicy Bypass -File .\setup_full_windows.ps1
```

8. 输入下面这条命令启动后端：

```powershell
.\.venv\Scripts\python.exe main.py
```

9. 程序启动后，输入 `1`，进入正常模式。
10. 打开 Chrome，在地址栏输入 `chrome://extensions/`。
11. 打开右上角“开发者模式”。
12. 点击“加载已解压的扩展程序”。
13. 选择项目里的 `extension` 文件夹。
14. 回到目标网站，手动登录。
15. 进入答题页面，手动点一次“开始”。
16. 后面程序会自动答题，到最后一题会自动停住，等你自己检查。

## 怎样确认三级级联已经开启

后端启动后，在浏览器打开：

- [http://127.0.0.1:8765/health](http://127.0.0.1:8765/health)

如果你看到：

- `vector_mode` 是 `embedding`
- `.env` 里已经填了 `DEEPSEEK_API_KEY`

就说明现在已经具备：

- 字典匹配
- 本地向量模型
- 大模型兜底

也就是三级级联已经跑起来了。

## 调试模式

如果你想专门记录错题，启动后输入 `0`。

一轮结束后，按提示这样输入：

```text
12:B 45:D 79:C
```

意思是：

- 第 12 题正确答案是 `B`
- 第 45 题正确答案是 `D`
- 第 79 题正确答案是 `C`

程序会自动：

- 记录错题
- 记录错选和正选
- 自动写入补丁区 `patch_rules.jsonc`

## 其他文档

- [Mac 教程](./MACOS_GUIDE.md)
- [技术文档](./TECHNICAL.md)
