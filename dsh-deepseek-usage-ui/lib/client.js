window.__ModuleLoader__.load({
  id: "@dsh/dsh-deepseek-usage-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let react_jsx_runtime = require("react/jsx-runtime");

    // ── 字典 ────────────────────────────────────────────────────────────────
    const NS = "dshUsageInfo";
    const zh = {
      title: "DSH用量信息",
      balance: "余额",
      today: "今日用量",
      low: "余额不足",
      recharge: "前往充值",
      unknown: "—"
    };
    const en = {
      title: "DSH usage",
      balance: "Balance",
      today: "Today",
      low: "Low balance",
      recharge: "Top up",
      unknown: "—"
    };

    /** 侧边栏常驻用量卡片：轮询 host 的实时快照接口，低余额时亮红灯。 */
    function UsageInfoCard(props) {
      try {
        const t = props.t || ((k) => zh[k] || k);
        const [data, setData] = react.useState(null);
        react.useEffect(() => {
          let alive = true;
          const load = async () => {
            try {
              const r = await fetch("/__dsh_deepseek_usage", { cache: "no-store" });
              if (r.ok) {
                const d = await r.json();
                if (alive) setData(d);
              }
            } catch (_e) {
              // 数据源不可用时保持上次快照。
            }
          };
          load();
          const id = window.setInterval(load, 60000);
          return () => {
            alive = false;
            window.clearInterval(id);
          };
        }, []);
        const total = data && data.total != null ? Number(data.total) : null;
        const usage = data && data.todayUsage != null ? Number(data.todayUsage) : null;
        const low = !!data?.low;
        const style = {
          padding: "8px 12px",
          fontSize: "12px",
          lineHeight: "1.5",
          color: "var(--dsw-alias-label-primary, inherit)"
        };
        const titleStyle = { fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" };
        const dotStyle = {
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: low ? "#e5484d" : "transparent",
          boxShadow: low ? "0 0 5px rgba(229,72,77,.75)" : "none"
        };
        const row = { display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "3px", opacity: low ? 1 : 0.85 };
        const rechargeLink = { color: "var(--dsw-alias-state-error-primary, #e5484d)", cursor: "pointer", textDecoration: "underline" };
        const openTopup = () => {
          try { window.open("https://platform.deepseek.com/top_up", "_blank"); } catch (_e) {}
        };
        return react_jsx_runtime.jsx("div", {
          style: style,
          children: [
            react_jsx_runtime.jsx("div", {
              style: titleStyle,
              children: [
                react_jsx_runtime.jsx("span", { style: dotStyle }),
                react_jsx_runtime.jsx("span", { children: t("title") })
              ]
            }),
            react_jsx_runtime.jsx("div", {
              style: row,
              children: [
                react_jsx_runtime.jsx("span", { children: t("balance") }),
                react_jsx_runtime.jsx("b", { children: total == null ? t("unknown") : "¥" + total.toFixed(2) })
              ]
            }),
            usage != null
              ? react_jsx_runtime.jsx("div", {
                  style: row,
                  children: [
                    react_jsx_runtime.jsx("span", { children: t("today") }),
                    react_jsx_runtime.jsx("b", { children: "¥" + usage.toFixed(2) })
                  ]
                })
              : null,
            low
              ? react_jsx_runtime.jsx("div", {
                  style: { marginTop: "4px", color: "var(--dsw-alias-state-error-primary, #e5484d)" },
                  children: [
                    react_jsx_runtime.jsx("span", { children: t("low") + " " }),
                    react_jsx_runtime.jsx("a", { style: rechargeLink, onClick: openTopup, children: t("recharge") })
                  ]
                })
              : null
          ]
        });
      } catch (_e) {
        return null;
      }
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-deepseek-usage-ui: dictionary");
      ctx.effect(() => ctx.slots.inject("web-ui.plugin.item", () => {
        return ctx.slots.register({
          name: "web-ui.plugin.item",
          id: "dsh-usage",
          order: 50,
          label: () => "DSH用量信息",
          locale: NS
        }, UsageInfoCard);
      }), "dsh-deepseek-usage-ui: sidebar usage card");
    }

    const inject = ["slots", "locale"];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
