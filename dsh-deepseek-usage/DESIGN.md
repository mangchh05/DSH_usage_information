# DeepSeek 用量监控插件 — 设计流程

## 1. 目标

在 DeepSeek Harness Desktop（DSH Desktop）里监控你在 **DeepSeek 开放平台** 的模型用量与余额，实现：

| 需求 | 实现 |
| --- | --- |
| 余额 < 5 元时「充值提醒」 | 轮询余额接口，低于阈值时通过桌面通知弹出 |
| 随时方便查看用量 | 系统托盘常驻显示实时余额 + 右键菜单详情 + 「立即刷新」 |
| 单日消费 > 30 元时「用量速度过快」提醒 | 本地按余额差值估算当日用量，超阈值弹出提醒 |

## 2. 数据来源

DeepSeek 开放平台提供余额查询接口（无需额外开通，复用你现有的 API Key）：

```
GET https://api.deepseek.com/user/balance
Authorization: Bearer <你的 API Key>
```

返回：

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "110.00",
      "granted_balance": "10.00",
      "topped_up_balance": "100.00"
    }
  ]
}
```

参考：[Get User Balance — DeepSeek API Docs](https://api-docs.deepseek.com/api/get-user-balance/)。

> 平台**没有**公开的「今日消费」接口，因此「当日用量」由插件在本地按**余额差值**估算（见 §4）。

## 3. 架构

```
┌───────────────────────────────────────────────────────────────┐
│  DSH Desktop（Electron 主进程，Cordis 插件体系）                  │
│                                                                │
│  dsh-deepseek-usage (host 插件, lib/index.js)                   │
│  ├─ settings 命名空间 deepseek-usage   ← Web「设置」界面在线改配置 │
│  ├─ credentials.resolve(DEEPSEEK_API_KEY)  ← 复用已存的 API Key  │
│  ├─ 轮询器 (ctx.effect + setTimeout, 默认 300s)                  │
│  │     └─ GET {baseURL}/user/balance                             │
│  ├─ 状态持久化 $DSH_HOME/dsh-deepseek-usage/state.json          │
│  │     └─ 当日基线余额 / 今日用量 / 告警去重标记                   │
│  ├─ desktopRuntime.notifyAttention()  ← 弹到桌面的提醒           │
│  └─ desktopRuntime.registerTrayItem() ← 托盘实时余额 + 详情菜单    │
└───────────────────────────────────────────────────────────────┘
```

插件是纯 **host 侧** 插件：不引入 React/client 打包，直接复用 DSH 已有的
`settings`（设置表单自动出现在 Web 设置页）、`credentials`（复用 `DEEPSEEK_API_KEY`）、
`desktopRuntime`（系统通知 + 托盘）三个服务。这样改动面最小、最稳。

### 3.1 提醒如何「弹到桌面」

`desktopRuntime.notifyAttention({ title, body })`：

- Windows：任务栏闪烁 + 系统通知弹窗；
- 点击通知会把 DSH Desktop 窗口带到前台。

注意：该 API 在**窗口已聚焦时不弹**（避免打断正在进行的对话）。为覆盖「正在使用时」的场景，
插件同时把**告警状态写进托盘标签**（如 `DeepSeek 余额 ¥4.20 ⚠ 余额不足`），做到始终可见。

### 3.2 随时查看

- **托盘常驻标签**：每次轮询后调用 `registration.refresh()` 更新，显示 `余额 + 今日用量`；
- **托盘右键子菜单**：总余额 / 赠送余额 / 充值余额 / 今日用量 / 账户可用性 / 上次更新时间，
  以及「立即刷新」和「前往 DeepSeek 开放平台充值」。

## 4. 「当日用量」估算算法（关键）

由于平台没有「今日消费」接口，插件用余额差值估算，规则如下：

1. 每天第一次成功取到余额时，把该余额记为**当日基线** `baseline`；
2. 之后每次轮询：`今日用量 = max(0, baseline − 当前余额)`；
3. 若某次余额**高于**基线（说明充值/退款了），把基线重置为当前余额——
   避免把「充值」误算成负用量，也避免误报；
4. 跨天（本地时区 `YYYY-MM-DD` 变化）自动重置基线、清空今日用量、重新武装告警。

**告警去重**：同一条件不会重复弹窗。

- 低余额：余额降到阈值以下弹一次；余额恢复到阈值之上后重新武装。
- 今日用量：当日超阈值弹一次；跨天或回落到阈值以下后重新武装。

**局限**（设计上已知并接受）：余额差值是「估算」，充值当日的消费会因基线重置而略偏少；
该估算用于「提醒」，精确账单仍以平台控制台为准。

## 5. 配置项（均可在线修改）

命名空间 `deepseek-usage`，会出现在 Web「设置」界面：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | true | 总开关 |
| `apiKeyEnv` | DEEPSEEK_API_KEY | 密钥引用（复用已存的密钥） |
| `baseURL` | https://api.deepseek.com | 平台接口根地址 |
| `pollIntervalSeconds` | 300 | 轮询间隔（秒，≥10） |
| `lowBalanceThreshold` | 5 | 余额低于该值（元）触发充值提醒 |
| `dailyUsageThreshold` | 30 | 当日用量超过该值（元）触发超速提醒 |
| `notifyLowBalance` / `notifyDailyUsage` | true | 两类提醒各自开关 |
| `platformUrl` | https://platform.deepseek.com/usage | 充值入口（托盘菜单里展示） |

## 6. 目录结构

```
dsh-deepseek-usage/
├── package.json         # DSH bundle 声明（dsh.bundle.patch）
├── cordis.patch.yml     # 向 profile 注入插件条目
├── lib/
│   └── index.js         # 全部逻辑
└── README.md
```

## 7. 可选扩展（未实现）

- 增加 client 侧 React 组件，在侧边栏/顶栏常驻一个小徽章（需引入 client bundle，改动更大）。
- 用量告警支持阶梯（如 30/50/100 元分级提醒）。
- 把精确账单接入平台网页抓取（需登录态，脆弱，不推荐）。
