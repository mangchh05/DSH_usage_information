import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// dsh-deepseek-usage — DeepSeek 开放平台用量与余额监控
//
// 数据源：DeepSeek 开放平台余额接口 `GET {baseURL}/user/balance`
//   Authorization: Bearer {apiKey}
// 返回形如：
//   { "is_available": true, "balance_infos": [
//       { "currency": "CNY", "total_balance": "110.00",
//         "granted_balance": "10.00", "topped_up_balance": "100.00" } ] }
//
// 能力：
//   1. 轮询余额，并把实时余额显示在系统托盘（随时查看）；
//   2. 余额 < lowBalanceThreshold 时弹出「充值提醒」；
//   3. 今日用量 > dailyUsageThreshold 时弹出「用量速度过快」提醒；
//   4. 所有阈值/间隔/密钥引用都可在线（设置界面）配置。
// ---------------------------------------------------------------------------

const name = "dsh-deepseek-usage";
const inject = [];
const NS = settingsNamespace("deepseek-usage");

const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

// 配置 schema —— 注册到 settings 后会自动出现在 Web「设置」界面。
const Config = z.object({
  enabled: z.boolean().default(true),
  apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
  baseURL: z.string().default(DEFAULT_BASE_URL),
  pollIntervalSeconds: z.number().step(1).min(10).default(300),
  lowBalanceThreshold: z.number().min(0).default(5),
  dailyUsageThreshold: z.number().min(0).default(30),
  notifyLowBalance: z.boolean().default(true),
  notifyDailyUsage: z.boolean().default(true),
  platformUrl: z.string().default("https://platform.deepseek.com/top_up")
});

// 文案（中英双语，跟随桌面 locale）。
const COPY = {
  zh: {
    trayUnknown: "DeepSeek 余额: 未知",
    trayLow: (b) => `DeepSeek 余额 ¥${b} ⚠ 余额不足`,
    trayDaily: (b, u) => `DeepSeek 余额 ¥${b} · 今日 ¥${u} ⚠`,
    trayNormal: (b, u) => `DeepSeek 余额 ¥${b} · 今日 ¥${u}`,
    detailTotal: (b) => `总余额: ¥${b}`,
    detailGranted: (b) => `赠送余额: ¥${b}`,
    detailToppedUp: (b) => `充值余额: ¥${b}`,
    detailUsage: (u) => `今日用量: ¥${u}`,
    detailAvailable: "账户可用",
    detailUnavailable: "账户不可用",
    detailLastFetch: (t) => `上次更新: ${t}`,
    detailError: (m) => `获取失败: ${m}`,
    refresh: "立即刷新",
    openPlatform: "前往 DeepSeek 开放平台充值",
    lowTitle: "DeepSeek 余额不足",
    lowBody: (b, t) => `当前余额 ¥${b}，已低于 ¥${t}，请及时充值。`,
    dailyTitle: "DeepSeek 今日用量过高",
    dailyBody: (u, t) => `今日已消费约 ¥${u}，超过 ¥${t}，请留意用量速度。`
  },
  en: {
    trayUnknown: "DeepSeek balance: unknown",
    trayLow: (b) => `DeepSeek ¥${b} ⚠ low balance`,
    trayDaily: (b, u) => `DeepSeek ¥${b} · today ¥${u} ⚠`,
    trayNormal: (b, u) => `DeepSeek ¥${b} · today ¥${u}`,
    detailTotal: (b) => `Total: ¥${b}`,
    detailGranted: (b) => `Granted: ¥${b}`,
    detailToppedUp: (b) => `Topped up: ¥${b}`,
    detailUsage: (u) => `Today's usage: ¥${u}`,
    detailAvailable: "Account available",
    detailUnavailable: "Account unavailable",
    detailLastFetch: (t) => `Last update: ${t}`,
    detailError: (m) => `Fetch failed: ${m}`,
    refresh: "Refresh now",
    openPlatform: "Open DeepSeek platform to top up",
    lowTitle: "DeepSeek balance low",
    lowBody: (b, t) => `Current balance ¥${b} is below ¥${t}. Please top up.`,
    dailyTitle: "DeepSeek daily usage high",
    dailyBody: (u, t) => `Today's usage is about ¥${u}, over ¥${t}. Please watch your usage.`
  }
};

function money(n) {
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

/** 从简单的 credentials YAML 文本中读取一个 ref 的值（兜底解析，不引入依赖）。 */
function parseCredentialRefYaml(text, ref) {
  let inRefs = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\S/.test(raw)) {
      inRefs = raw.trim() === "refs:";
      continue;
    }
    if (!inRefs) continue;
    const m = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!m || m[1] !== ref) continue;
    const value = m[2].trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/\\"/g, '"');
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
    return value;
  }
  return undefined;
}

function localDayKey(now) {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyState() {
  return {
    version: 1,
    dayKey: "",
    baselineBalance: 0,
    todayUsage: 0,
    lowBalanceAlerted: false,
    dailyUsageAlerted: false
  };
}

async function readState(file) {
  try {
    const text = await readFile(file, "utf8");
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && parsed.version === 1) {
      return { ...emptyState(), ...parsed };
    }
  } catch {
    // 不存在或损坏的状态文件直接重建。
  }
  return emptyState();
}

async function writeState(file, state) {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

/** 兼容字符串/数字两种返回形式，解析为有限数值。 */
function toMoney(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string") return Number.parseFloat(v);
  return NaN;
}

/** 请求余额并解析。 */
async function fetchBalance(baseURL, apiKey, signal) {
  const url = `${String(baseURL).replace(/\/+$/u, "")}/user/balance`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json"
    },
    ...(signal === undefined ? {} : { signal })
  });
  if (!response.ok) {
    throw new Error(`DeepSeek balance request failed (HTTP ${response.status})`);
  }
  const data = await response.json();
  const info = Array.isArray(data?.balance_infos) ? data.balance_infos[0] : undefined;
  if (!info || info.total_balance === undefined) {
    throw new Error("DeepSeek balance response is invalid");
  }
  const total = toMoney(info.total_balance);
  if (!Number.isFinite(total)) {
    throw new Error("DeepSeek balance total_balance is invalid");
  }
  return {
    isAvailable: data.is_available !== false,
    currency: typeof info.currency === "string" ? info.currency : "CNY",
    total,
    granted: Number.isFinite(toMoney(info.granted_balance)) ? toMoney(info.granted_balance) : 0,
    toppedUp: Number.isFinite(toMoney(info.topped_up_balance)) ? toMoney(info.topped_up_balance) : 0
  };
}

function apply(ctx, config) {
  let current = () => config;

  const desktop = ctx.get("desktopRuntime", false);
  const locale = desktop?.locale === "zh" ? "zh" : "en";
  const copy = COPY[locale];

  const stateFile = join(resolveDshHome(), "dsh-deepseek-usage", "state.json");

  // 内存快照，供托盘菜单/文案读取。
  const snapshot = {
    total: null,
    granted: null,
    toppedUp: null,
    isAvailable: true,
    todayUsage: 0,
    low: false,
    daily: false,
    lastError: null,
    lastFetchAt: 0
  };

  let inFlight = false;
  let disposed = false;
  let timerId = null;
  let trayRegistration = null;

  /** 用默认浏览器打开外部网址（Electron 主进程可用；其他环境优雅降级）。 */
  async function openExternalUrl(url) {
    try {
      const electron = await import("electron");
      await electron.shell.openExternal(url);
      return true;
    } catch {
      return false;
    }
  }

  /** 解析配置指定的 API key 引用（多级兜底，避免依赖单个凭据通道）。 */
  async function resolveApiKey(refName) {
    let ref;
    try {
      ref = credentialRef(refName || DEFAULT_API_KEY_ENV);
    } catch {
      return undefined;
    }
    // 1) 标准路径：凭据服务（与 llm-deepseek 一致）
    const credentials = ctx.get("credentials", false);
    if (credentials && typeof credentials.resolve === "function") {
      try {
        const hit = await credentials.resolve(ref);
        if (hit && typeof hit.value === "string" && hit.value.length > 0) return hit.value;
      } catch (error) {
        ctx.logger.warn("dsh-deepseek-usage: credentials.resolve 失败，改用直读文件：%s", error instanceof Error ? error.message : String(error));
      }
    }
    // 2) 直读 $DSH_HOME/.credentials.yaml 兜底
    try {
      const { readFile: readFileAsync } = await import("node:fs/promises");
      const text = await readFileAsync(join(resolveDshHome(), ".credentials.yaml"), "utf8");
      const value = parseCredentialRefYaml(text, ref);
      if (typeof value === "string" && value.length > 0) return value;
    } catch { /* 忽略：继续尝试环境变量 */ }
    // 3) 环境变量兜底
    const ambient = process.env[ref];
    return ambient && ambient.length > 0 ? ambient : undefined;
  }

  /** 托盘标签（每次重建菜单时调用，实现“随时查看”）。 */
  function trayLabel() {
    const b = snapshot.total;
    if (b === null) return copy.trayUnknown;
    if (snapshot.low) return copy.trayLow(money(b));
    if (snapshot.daily) return copy.trayDaily(money(b), money(snapshot.todayUsage));
    return copy.trayNormal(money(b), money(snapshot.todayUsage));
  }

  function submenuItems() {
    const items = [];
    if (snapshot.total !== null) {
      items.push({ label: () => copy.detailTotal(money(snapshot.total)), enabled: () => false, invoke: () => {} });
      items.push({ label: () => copy.detailGranted(money(snapshot.granted ?? 0)), enabled: () => false, invoke: () => {} });
      items.push({ label: () => copy.detailToppedUp(money(snapshot.toppedUp ?? 0)), enabled: () => false, invoke: () => {} });
      items.push({ label: () => copy.detailUsage(money(snapshot.todayUsage)), enabled: () => false, invoke: () => {} });
      items.push({ label: () => (snapshot.isAvailable ? copy.detailAvailable : copy.detailUnavailable), enabled: () => false, invoke: () => {} });
    } else if (snapshot.lastError) {
      items.push({ label: () => copy.detailError(snapshot.lastError), enabled: () => false, invoke: () => {} });
    }
    if (snapshot.lastFetchAt > 0) {
      items.push({
        label: () => copy.detailLastFetch(new Date(snapshot.lastFetchAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")),
        enabled: () => false,
        invoke: () => {}
      });
    }
    items.push({ type: "separator", label: () => "", invoke: () => {} });
    items.push({ label: () => copy.refresh, invoke: () => void poll() });
    items.push({
      label: () => copy.openPlatform,
      invoke: () => {
        const url = current().platformUrl ?? "https://platform.deepseek.com/top_up";
        void openExternalUrl(url);
      }
    });
    return items;
  }

  function refreshTray() {
    trayRegistration?.refresh();
  }

  /** 余额回调：更新快照、推进每日用量、触发告警。 */
  async function onBalance(balance, cfg) {
    const now = Date.now();
    const dayKey = localDayKey(now);
    const state = await readState(stateFile);

    if (state.dayKey !== dayKey) {
      state.dayKey = dayKey;
      state.baselineBalance = balance.total;
      state.todayUsage = 0;
      state.dailyUsageAlerted = false;
      state.lowBalanceAlerted = false;
    } else if (balance.total > state.baselineBalance) {
      // 余额上升视为充值/退款：重置当日基线，避免把充值误算成「负用量」。
      state.baselineBalance = balance.total;
    }

    state.todayUsage = Math.max(0, state.baselineBalance - balance.total);

    snapshot.total = balance.total;
    snapshot.granted = balance.granted;
    snapshot.toppedUp = balance.toppedUp;
    snapshot.isAvailable = balance.isAvailable;
    snapshot.todayUsage = state.todayUsage;
    snapshot.lastFetchAt = now;
    snapshot.low = balance.total < (cfg.lowBalanceThreshold ?? 5);
    snapshot.daily = state.todayUsage > (cfg.dailyUsageThreshold ?? 30);

    // 低余额告警（去重：余额恢复到阈值之上后重新武装）。
    if (snapshot.low) {
      if (!state.lowBalanceAlerted && cfg.notifyLowBalance !== false) {
        state.lowBalanceAlerted = true;
        const title = copy.lowTitle;
        const body = `${copy.lowBody(money(balance.total), money(cfg.lowBalanceThreshold ?? 5))}\n充值地址：${cfg.platformUrl ?? "https://platform.deepseek.com/top_up"}`;
        try {
          // 原生通知：点击直达充值页（Electron 主进程）。
          const electron = await import("electron");
          const notification = new electron.Notification({ title, body });
          notification.on("click", () => {
            void electron.shell.openExternal(cfg.platformUrl ?? "https://platform.deepseek.com/top_up");
          });
          notification.show();
        } catch {
          desktop?.notifyAttention({ title, body });
        }
      }
    } else {
      state.lowBalanceAlerted = false;
    }

    // 每日用量告警（去重：跨天或用量回落到阈值之下后重新武装）。
    if (snapshot.daily) {
      if (!state.dailyUsageAlerted && cfg.notifyDailyUsage !== false) {
        state.dailyUsageAlerted = true;
        desktop?.notifyAttention({
          title: copy.dailyTitle,
          body: copy.dailyBody(money(state.todayUsage), money(cfg.dailyUsageThreshold ?? 30))
        });
      }
    } else {
      state.dailyUsageAlerted = false;
    }

    await writeState(stateFile, state);
  }

  async function poll() {
    if (inFlight || disposed) return;
    inFlight = true;
    try {
      const cfg = current();
      if (cfg.enabled === false) {
        snapshot.lastError = "disabled";
        return;
      }
      const apiKey = await resolveApiKey(cfg.apiKeyEnv);
      if (!apiKey) {
        snapshot.lastError = `未配置 API key（${cfg.apiKeyEnv ?? DEFAULT_API_KEY_ENV}）`;
        ctx.logger.warn("dsh-deepseek-usage: %s", snapshot.lastError);
        return;
      }
      const balance = await fetchBalance(cfg.baseURL ?? DEFAULT_BASE_URL, apiKey);
      await onBalance(balance, cfg);
      snapshot.lastError = null;
    } catch (error) {
      snapshot.lastError = error instanceof Error ? error.message : String(error);
      ctx.logger.warn("dsh-deepseek-usage: 余额轮询失败: %s", snapshot.lastError);
    } finally {
      inFlight = false;
      refreshTray();
    }
  }

  function rearm() {
    if (disposed) return;
    if (timerId !== null) clearTimeout(timerId);
    const seconds = Math.max(10, Number(current().pollIntervalSeconds ?? 300) || 300);
    timerId = setTimeout(() => {
      timerId = null;
      void poll().finally(rearm);
    }, seconds * 1000);
  }

  // 托盘注册（desktopRuntime 缺失时优雅降级）。
  if (desktop) {
    ctx.effect(() => {
      trayRegistration = desktop.registerTrayItem({
        group: "status",
        order: 30,
        label: () => trayLabel(),
        invoke: () => void poll(),
        submenu: () => submenuItems()
      });
      return () => {
        trayRegistration?.dispose();
        trayRegistration = null;
      };
    }, "dsh-deepseek-usage: tray item");
  }

  // 轮询器：首次立即拉取，之后按 interval 自调度。
  ctx.effect(() => {
    void poll().finally(rearm);
    return () => {
      disposed = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, "dsh-deepseek-usage: balance poller");

  // 设置注册放在最后，保证 onChange → rearm 触发时上面的所有状态都已就绪。
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source;
    },
    onChange: () => {
      rearm();
    }
  });

  // ── 应用内便捷命令 /deepseek-usage（host 侧即可，无需重建客户端） ───────────
  ctx.inject(["commands"], (cctx) => {
    cctx.effect(() => cctx.commands.register({
      name: "deepseek-usage",
      description: "查看 DeepSeek 开放平台余额与今日用量",
      handler: () => {
        const cfg = current();
        if (snapshot.total === null) {
          return snapshot.lastError
            ? { kind: "error", text: `获取 DeepSeek 用量失败：${snapshot.lastError}` }
            : { kind: "success", text: "正在获取 DeepSeek 用量，请稍后重试 /deepseek-usage" };
        }
        const lines = [
          "**DeepSeek 用量**",
          `- 总余额：¥${money(snapshot.total)}`,
          `- 赠送 / 充值：¥${money(snapshot.granted ?? 0)} / ¥${money(snapshot.toppedUp ?? 0)}`,
          `- 今日用量（估算）：¥${money(snapshot.todayUsage)}`,
          `- 账户可用：${snapshot.isAvailable ? "是" : "否"}`,
          ...(snapshot.lastFetchAt > 0 ? [`- 更新于：${new Date(snapshot.lastFetchAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}`] : [])
        ];
        if (snapshot.low) lines.push("", `⚠️ **余额不足**：当前余额低于 ¥${money(cfg.lowBalanceThreshold ?? 5)}，请及时充值`);
        if (snapshot.daily) lines.push("", `⚠️ **今日用量过高**：已超过 ¥${money(cfg.dailyUsageThreshold ?? 30)}，请注意用量速度`);
        return { kind: "success", text: lines.join("\n") };
      }
    }), "dsh-deepseek-usage: /deepseek-usage command");
  });

  // ── 给应用内常驻卡片（client 插件）提供实时数据 ─────────────────────────────
  // webServer.register 为 host 侧 HTTP 服务；客户端 fetch 本路径即可拿到最新快照。
  const webServer = ctx.get("webServer", false);
  if (webServer && typeof webServer.register === "function") {
    try {
      const disposeRoute = webServer.register({
        kind: "exact",
        path: "/__dsh_deepseek_usage",
        handler: async (_req, res) => {
          const body = JSON.stringify({
            total: snapshot.total,
            granted: snapshot.granted,
            toppedUp: snapshot.toppedUp,
            todayUsage: snapshot.todayUsage,
            low: snapshot.low,
            daily: snapshot.daily,
            isAvailable: snapshot.isAvailable,
            updatedAt: snapshot.lastFetchAt,
            error: snapshot.lastError
          });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(body);
        }
      });
      ctx.effect(() => () => disposeRoute(), "dsh-deepseek-usage: route dispose");
    } catch (error) {
      ctx.logger.warn("dsh-deepseek-usage: 注册实时数据路由失败（不影响托盘/命令）：%s", error instanceof Error ? error.message : String(error));
    }
  }
}

export { Config, apply, inject, name };
