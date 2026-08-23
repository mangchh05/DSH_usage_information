# DeepSeek 用量监控插件（DSH Desktop）

一个给 [DSH Desktop](https://github.com/deepseek-ai/DeepSeek-Harness) 用的便携插件：**托盘实时余额、低余额充值提醒、单日用量超速提醒、`/deepseek-usage` 查询命令**。整包即拷即用，不写死任何本机路径。

> **免责声明 / Disclaimer**：这是一个**非官方**的第三方插件，与 DeepSeek 及 DeepSeek Harness 官方**无任何关联，亦未获其认可或背书**。
> *This is an unofficial third-party plugin and is not affiliated with or endorsed by DeepSeek.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 功能

- 余额低于阈值 → 桌面弹出「充值提醒」，点击通知直达充值页
- 当日用量超过阈值 → 桌面弹出「用量速度过快」提醒
- 系统托盘常驻显示实时余额与今日用量（左键刷新，右键看详情）
- 对话内输入 `/deepseek-usage` 立即查看余额 / 今日用量明细
- 所有阈值 / 轮询间隔 / 密钥引用都能在 DSH「设置」界面在线修改
- 零外部依赖，复用 DSH 自带的 `@deepseek-ai/*` 核心包

## 快速开始

**前置**：目标机器已安装并运行过一次 DSH Desktop。

1. 下载本仓库（`Code → Download ZIP`，或 `git clone`）
2. 解压后，在仓库根目录打开 PowerShell，运行：
   ```powershell
   pwsh -File install.ps1
   ```
   - 脚本会自动识别 DSH Desktop 当前 profile（`desktop` / `web`）
   - 也可手动指定：`pwsh -File install.ps1 -ProfileName desktop`
   - 或指定主目录：`pwsh -File install.ps1 -DshHome "D:\MyDSH"`
3. **彻底退出并重开 DSH Desktop**（托盘菜单 → 退出，不是关窗口）

> 没有 pwsh？可用 Windows 自带 PowerShell：
> `powershell -ExecutionPolicy Bypass -File install.ps1`

## 配置

| 项目 | 说明 |
| --- | --- |
| **API Key（必须）** | DSH 设置 → 模型（Models）页填写 `DEEPSEEK_API_KEY` |
| 阈值 / 轮询间隔（可选） | 设置 → `deepseek-usage`：默认低余额 5 元、单日 30 元、每 5 分钟轮询 |

插件本身**不含任何 API Key**，密钥始终存在你自己的 DSH 设置里。

## 日常使用

- **托盘**：右键 DSH 图标 → `DeepSeek 余额 ¥… · 今日 ¥…`；左键=立即刷新；右键=详情 + 立即刷新 + 前往充值
- **余额 < 5 元**：弹窗提醒，点击直接打开充值页 `https://platform.deepseek.com/top_up`
- **单日用量 > 30 元**：弹窗提醒用量过快
- **对话里**：输入 `/deepseek-usage` 立即查看余额 / 今日用量明细

## 更新

**拉取新版**：

- 通过 `git clone` 安装的：`git pull` 后重新运行 `install.ps1`
- 通过 ZIP 安装的：重新下载解压，重新运行 `install.ps1`

更新后重启 DSH Desktop 生效。

## 卸载

删除 `C:\Users\<你>\.dsh\profiles\<profile>\node_modules\dsh-deepseek-usage`，并从该 profile 的 `cordis.patch.yml` 中删掉 `- id: dsh-deepseek-usage` 那段，重启即可。

## 目录结构

```
├── README.md                 ← 本文件
├── install.ps1               ← 一键安装脚本
├── LICENSE                   ← MIT 许可证
└── dsh-deepseek-usage/       ← 插件本体
    ├── package.json
    ├── cordis.patch.yml
    ├── lib/index.js
    ├── README.md
    └── DESIGN.md
```

## 说明

- 「今日用量」由余额差值估算（平台无公开的按日账单接口），用于提醒，精确账单以平台控制台为准
- 桌面通知在 DSH Desktop 窗口聚焦时不弹（避免打扰），此时托盘标签用 `⚠` 标记告警状态

## License

[MIT](LICENSE)
