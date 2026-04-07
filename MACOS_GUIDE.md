# HDU-SNAP Mac 教程

这份教程只做一件事：

**让你在 Mac 上用最简单的方法跑通三级级联**

三级级联指的是：

- Tier 1：字典匹配
- Tier 2：本地向量模型
- Tier 3：DeepSeek 大模型

## 开始前准备

先准备好 3 样东西：

- `Python 3.10` 或更高版本
- `Chrome`
- 你自己的 `DeepSeek API Key`

## Mac 快速开始

1. 打开“终端”。
2. 进入项目目录。
3. 输入下面这条命令，创建 `.env`：

```bash
cp .env.example .env
```

4. 输入下面这条命令，编辑 `.env`：

```bash
open -e .env
```

5. 把 `DEEPSEEK_API_KEY=` 后面填成你自己的 key，保存并关闭。
6. 打开 Chrome，在地址栏输入 `chrome://extensions/`。
7. 打开右上角“开发者模式”。
8. 点击“加载已解压的扩展程序”。
9. 选择项目里的 `extension` 文件夹。
10. 回到终端。
11. 输入下面这条命令，一次性装好三级级联需要的依赖和本地向量模型：

```bash
bash setup_full_macos.sh
```

12. 输入下面这条命令启动后端：

```bash
bash start_backend.sh full
```

13. 程序启动后，输入 `1`，进入正常模式。
14. 然后按提示输入答题数量。
15. 脚本会自动用 Chrome 打开目标网站。
16. 你手动登录。
17. 登录后，手动进入题目页面。在地址栏输入 https://skl.hdu.edu.cn/#/english/list
18. 进入题目页面后，插件会自动接管答题。
19. 答完后不会自动提交，你手动提交。

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

## 更多说明

更详细的项目说明请看：

- [技术文档](./TECHNICAL.md)
