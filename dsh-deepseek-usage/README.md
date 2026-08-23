# dsh-deepseek-usage

DeepSeek 开放平台用量与余额监控插件（DSH Desktop）。

- 余额低于阈值 → 桌面弹出「充值提醒」
- 当日用量超过阈值 → 桌面弹出「用量速度过快」提醒
- 系统托盘常驻显示实时余额与今日用量（随时查看）
- 所有阈值 / 轮询间隔 / 密钥引用都能在「设置」界面在线修改

## 安装（本地 profile）

把插件放入 profile 的 `node_modules`，并在 profile 的 `cordis.patch.yml` 里注入一条 insert 即可。
仓库根目录的 `install.ps1` 会自动完成这两步（默认操作 `C:\Users\<用户>\.dsh\profiles\web`）：

```powershell
pwsh -File install.ps1
```

安装后**重启 DSH Desktop**（或重新选择 profile）生效。

## 使用

1. 确认已配置密钥：设置 → 模型（Models）页里 `DEEPSEEK_API_KEY` 已填写（插件复用同一个密钥）。
2. 托盘图标 → 会多出 `DeepSeek 余额 ¥…` 一项，右键可看详情 / 立即刷新。
3. 设置 → DeepSeek Usage（`deepseek-usage` 命名空间）可改阈值（默认 5 元 / 30 元）与轮询间隔。

## 注意

- 「今日用量」由余额差值估算（平台无公开的按日账单接口），用于提醒，精确账单以平台控制台为准。
- 桌面通知在 DSH Desktop 窗口**聚焦时不会弹**（避免打扰）；此时托盘标签会用 `⚠` 标记告警状态。
