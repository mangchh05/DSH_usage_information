window.__ModuleLoader__.load({
  id: "dsh-deepseek-usage-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // ── 与 @linxin666/dsh-ssh 完全一致的侧边栏 DOM 注入机制 ──────────────────
    const ENTRY_SELECTOR = "[data-dsh-usage-entry]";
    const USAGE_URL = "https://platform.deepseek.com/usage";
    const ICON = "<svg viewBox=\"0 0 16 16\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"8\" cy=\"8\" r=\"6\"/><path d=\"M5.75 9.75c0 .69.56 1.25 1.25 1.25h1.5a1.25 1.25 0 000-2.5h-1a1.25 1.25 0 010-2.5H9c.69 0 1.25.56 1.25 1.25\"/><path d=\"M8 5v6\"/></svg>";

    /** 找到侧边栏外壳根节点（找不到则稍后重试）。 */
    function sidebarRoot() {
      const column = document.querySelector("[data-pane=\"sidebar\"], [class*=\"sidebarCol\"]");
      if (column === null) return void 0;
      return column.querySelector("[class*=\"logoRow\"]")?.parentElement ?? column.firstElementChild;
    }

    /** 新会话按钮（在 logoRow 内，或旧版 shell 的直接子按钮）。 */
    function newSessionButton(root) {
      const nested = root.querySelector("button[class*=\"newSession\"]");
      if (nested !== null) return nested;
      for (const child of root.children) if (child.tagName === "BUTTON") return child;
      return void 0;
    }

    /** 构建侧边栏条目按钮。 */
    function buildEntry() {
      const entry = document.createElement("button");
      entry.type = "button";
      entry.setAttribute("data-dsh-usage-entry", "");
      entry.setAttribute("data-dsh-plugin", "deepseek-usage");
      entry.setAttribute("data-dsh-part", "sidebar-entry");
      entry.setAttribute("aria-label", "DSH用量信息");
      entry.style.cssText = "display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;background:transparent;color:var(--dsw-alias-label-primary,#1f2328);font-size:14px;line-height:20px;cursor:pointer;text-align:left;box-sizing:border-box;";
      entry.innerHTML =
        "<span style=\"width:18px;height:18px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary,#6b7280);\">" + ICON + "</span>" +
        "<span style=\"flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\">DSH用量信息</span>" +
        "<span data-usage-balance style=\"flex:none;font-size:11.5px;opacity:.85;font-variant-numeric:tabular-nums;\"></span>" +
        "<span data-usage-dot style=\"flex:none;width:8px;height:8px;border-radius:50%;background:transparent;\"></span>";
      entry.addEventListener("click", openUsagePage);
      return entry;
    }

    /** 点击条目：直接打开 DeepSeek 开放平台用量界面。 */
    function openUsagePage() {
      try { window.open(USAGE_URL, "_blank"); } catch (_e) {}
    }

    /** 把条目插到「新会话」之后（工作区之前），并用 MutationObserver 自愈。 */
    function mountEntry() {
      if (document.querySelector(ENTRY_SELECTOR) !== null) return () => {};
      const entry = buildEntry();
      let root;
      let placed = false;
      const place = () => {
        if (root !== void 0 && !root.isConnected) { root = void 0; placed = false; }
        root ??= sidebarRoot();
        if (root === void 0) return;
        const button = newSessionButton(root);
        if (button === void 0) return;
        if (entry.parentElement !== root) {
          const row = button.closest("[class*=\"logoRow\"]");
          const base = row !== null && row.parentElement === root ? row : button;
          root.insertBefore(entry, base.nextElementSibling);
        }
        placed = true;
      };
      const waitObserver = new MutationObserver(place);
      waitObserver.observe(document.body, { childList: true, subtree: true });
      const rootObserver = new MutationObserver(() => {
        if (root === void 0 || !root.isConnected) { placed = false; place(); return; }
        if (!root.contains(entry)) place();
      });
      place();
      if (placed && root !== void 0) rootObserver.observe(root, { childList: true, subtree: true });
      return () => {
        waitObserver.disconnect();
        rootObserver.disconnect();
        entry.remove();
      };
    }

    /** 拉取宿主实时数据并更新条目（余额 + 今日用量 + 低余额红灯）。 */
    async function refresh() {
      try {
        const r = await fetch("/__dsh_deepseek_usage", { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        const total = d.total != null ? Number(d.total) : null;
        const usage = d.todayUsage != null ? Number(d.todayUsage) : null;
        const low = !!d.low;
        const entry = document.querySelector(ENTRY_SELECTOR);
        const balanceEl = entry?.querySelector("[data-usage-balance]");
        const dotEl = entry?.querySelector("[data-usage-dot]");
        if (balanceEl) {
          balanceEl.textContent = total == null ? "" : "¥" + total.toFixed(2) + (usage != null ? " · " + usage.toFixed(2) : "");
          balanceEl.style.color = low ? "var(--dsw-alias-state-error-primary,#e5484d)" : "";
          balanceEl.title = low ? "余额不足，点击前往充值" : "";
        }
        if (dotEl) {
          dotEl.style.background = low ? "#e5484d" : "transparent";
          dotEl.style.boxShadow = low ? "0 0 5px rgba(229,72,77,.8)" : "none";
        }
      } catch (_e) {
        // 数据源不可用时保持上次快照。
      }
    }

    function apply(ctx) {
      if (typeof document === "undefined") return;
      const disposeMount = mountEntry();
      void refresh();
      const timer = window.setInterval(refresh, 60000);
      ctx.effect(() => () => {
        window.clearInterval(timer);
        disposeMount();
      });
    }

    const inject = [];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
