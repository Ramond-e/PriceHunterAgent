import { useState, useRef, useEffect, useCallback } from "react";

// Use vite proxy (/api → localhost:5000) in dev; nginx proxy in Docker
const API_BASE = "/api/agent";
const NOVNC_URL = "http://localhost:6080/vnc.html?autoconnect=true&resize=scale";

// ── Icons ─────────────────────────────────────────────────────────────────────
const Icon = ({ d, size = 16, stroke = "currentColor", fill = "none", sw = 1.75 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);
const icons = {
  search:   ["M21 21l-4.35-4.35", "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"],
  arrow:    ["M5 12h14", "m12 5 7 7-7 7"],
  refresh:  ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"],
  brain:    ["M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z", "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z", "M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4", "M17.599 6.5a3 3 0 0 0 .399-1.375", "M6.003 5.125A3 3 0 0 0 6.401 6.5"],
  zap:      "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
  box:      ["M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z", "m3.3 7 8.7 5 8.7-5", "M12 22V12"],
  check:    "M20 6 9 17l-5-5",
  alert:    ["M12 9v4", "M12 17h.01", "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"],
  tag:      ["M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z", "M7.5 7.5v.01"],
  external: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  key:      ["M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"],
  settings: ["M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z", "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"],
  monitor:  ["M20 3H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z", "M8 21h8m-4-4v4"],
  login:    ["M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4", "M10 17l5-5-5-5", "M15 12H3"],
  eye:      ["M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  eyeOff:   ["M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24", "M1 1l22 22"],
  chevron:  "M6 9l6 6 6-6",
};

const Spinner = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
    style={{ animation: "spin 0.75s linear infinite", display: "inline-block" }}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

// ── Step config ───────────────────────────────────────────────────────────────
const STEP_CONFIG = {
  thinking:      { label: "AI 思考中",   color: "#2563eb", bg: "#eff4ff", border: "#bfdbfe", iconKey: "brain"  },
  tool_call:     { label: "调用工具",    color: "#d97706", bg: "#fffbeb", border: "#fde68a", iconKey: "zap"    },
  tool_result:   { label: "工具结果",    color: "#0891b2", bg: "#ecfeff", border: "#a5f3fc", iconKey: "box"    },
  answer:        { label: "比价报告",    color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", iconKey: "check"  },
  error:         { label: "出错了",      color: "#dc2626", bg: "#fef2f2", border: "#fecaca", iconKey: "alert"  },
  login_required:{ label: "需要登录",   color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe", iconKey: "login"  },
};

const PLATFORM_COLORS = {
  京东: "#e1251b", 淘宝: "#ff6600", 拼多多: "#e02e24",
};

const EXAMPLES = [
  "iPhone 16 Pro 256GB",
  "华为 Mate 70 Pro",
  "索尼 WH-1000XM5 耳机",
  "戴森 V15 吸尘器",
  "小米 15 Ultra",
  "AirPods Pro 2",
];

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [apiKey, setApiKey]           = useState(() => localStorage.getItem("deepseek_api_key") || "");
  const [showSettings, setShowSettings] = useState(false);
  const [product, setProduct]         = useState("");
  const [steps, setSteps]             = useState([]);
  const [report, setReport]           = useState(null);
  const [running, setRunning]         = useState(false);
  const [done, setDone]               = useState(false);
  const [loginPending, setLoginPending] = useState(null);  // {platform, taskId}
  const [showBrowser, setShowBrowser] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  // Show settings on first visit if no key
  useEffect(() => {
    if (!localStorage.getItem("deepseek_api_key")) setShowSettings(true);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  const saveApiKey = (key) => {
    const trimmed = key.trim();
    setApiKey(trimmed);
    localStorage.setItem("deepseek_api_key", trimmed);
    setShowSettings(false);
  };

  const handleSearch = useCallback(async (override) => {
    const query = (override ?? product).trim();
    if (!query || running) return;
    if (!apiKey) { setShowSettings(true); return; }
    if (override) setProduct(override);

    setSteps([]); setReport(null); setDone(false);
    setRunning(true); setLoginPending(null); setShowBrowser(true);

    try {
      const res = await fetch(`${API_BASE}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product: query, apiKey }),
      });

      if (!res.ok) throw new Error(`服务器错误: ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { value, done: sd } = await reader.read();
        if (sd) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { setDone(true); break; }
          try {
            const step = JSON.parse(payload);
            setSteps(prev => [...prev, step]);
            if (step.type === "answer" && step.data) setReport(step.data);
            if (step.type === "login_required" && step.data) {
              setLoginPending(step.data);
              setShowBrowser(true);
            }
          } catch {}
        }
      }
    } catch (err) {
      setSteps(prev => [...prev, { type: "error", message: `连接失败: ${err.message}` }]);
    } finally {
      setRunning(false); setDone(true);
    }
  }, [product, running, apiKey]);

  const handleLoginComplete = async () => {
    if (!loginPending) return;
    try {
      await fetch(`${API_BASE}/resume/${loginPending.taskId}`, { method: "POST" });
    } catch {}
    setLoginPending(null);
  };

  const handleReset = () => {
    setSteps([]); setReport(null); setDone(false); setProduct("");
    setLoginPending(null); setShowBrowser(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const hasContent = steps.length > 0 || report;

  return (
    <div style={s.root}>

      {/* ── Settings Modal ── */}
      {showSettings && (
        <ApiKeyModal
          initialKey={apiKey}
          onSave={saveApiKey}
          onClose={() => apiKey && setShowSettings(false)}
        />
      )}

      {/* ── Header ── */}
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.brand}>
            <div style={s.logoMark}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                <line x1="3" x2="21" y1="6" y2="6"/>
                <path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
            </div>
            <div>
              <div style={s.brandName}>AI 比价助手</div>
              <div style={s.brandSub}>京东 · 淘宝 · 拼多多 全网比价</div>
            </div>
          </div>

          <nav style={s.nav}>
            <span style={s.navPill}>
              <span style={s.liveDot} />
              DeepSeek AI
            </span>
            <button style={s.settingsBtn} onClick={() => setShowSettings(true)} title="API Key 设置">
              <Icon d={icons.settings} size={14} stroke="currentColor" sw={2} />
              API Key
            </button>
          </nav>
        </div>
      </header>

      <main style={s.main}>

        {/* ── Hero (empty state) ── */}
        {!hasContent && (
          <section style={s.hero}>
            <div style={s.heroLabel}>
              <span style={s.heroDot} />
              AI 全网智能比价系统
            </div>
            <h1 style={s.heroTitle}>
              一键比价，<span style={s.heroGradient}>找到最低价</span>
            </h1>
            <p style={s.heroSub}>
              AI 自动控制真实浏览器，同时访问京东、淘宝、拼多多三大平台，
              逐一点开前5个商品详情页提取价格、评价、优惠券，最终给出最优购买建议。
            </p>

            {/* Platform badges */}
            <div style={s.platformRow}>
              {[
                { name: "京东", color: "#e1251b", bg: "#fff0f0", border: "#fca5a5" },
                { name: "淘宝", color: "#ff6600", bg: "#fff7ed", border: "#fdba74" },
                { name: "拼多多", color: "#c0392b", bg: "#fff0f0", border: "#fca5a5" },
              ].map(p => (
                <span key={p.name} style={{ ...s.platformBadge, color: p.color, background: p.bg, borderColor: p.border }}>
                  {p.name}
                </span>
              ))}
              <span style={s.platformSep}>同步比价</span>
            </div>

            {/* Feature highlights */}
            <div style={s.featureRow}>
              {[
                { icon: "🔍", text: "真实浏览器操作" },
                { icon: "📊", text: "深度提取商品信息" },
                { icon: "🎫", text: "自动查找优惠券" },
                { icon: "🖥️", text: "实时可视化展示" },
              ].map(f => (
                <div key={f.text} style={s.featureItem}>
                  <span>{f.icon}</span>
                  <span style={s.featureText}>{f.text}</span>
                </div>
              ))}
            </div>

            {/* Tech stack */}
            <div style={s.techRow}>
              {["DeepSeek AI", "Browser-Use", ".NET 8", "React", "noVNC"].map(t => (
                <span key={t} style={s.techPill}>{t}</span>
              ))}
            </div>
          </section>
        )}

        {/* ── Search Bar ── */}
        <div style={hasContent ? s.searchBarCompact : s.searchBarHero}>
          <div style={s.searchBox}>
            <span style={s.searchIconWrap}>
              <Icon d={icons.search} size={16} sw={2} />
            </span>
            <input
              ref={inputRef}
              style={s.searchInput}
              value={product}
              onChange={e => setProduct(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="输入商品名称，例如：iPhone 16 Pro 256GB"
              disabled={running}
              autoFocus
            />
            <button
              style={running ? { ...s.searchBtn, ...s.searchBtnBusy } : s.searchBtn}
              onClick={() => handleSearch()}
              disabled={running}
            >
              {running
                ? <><Spinner /> 搜索中…</>
                : <><Icon d={icons.arrow} size={14} stroke="#fff" sw={2} /> 开始比价</>
              }
            </button>
          </div>

          {!hasContent && (
            <div style={s.chipRow}>
              <span style={s.chipLabel}>热门：</span>
              {EXAMPLES.map(ex => (
                <button key={ex} style={s.chip} onClick={() => handleSearch(ex)}>{ex}</button>
              ))}
            </div>
          )}
        </div>

        {/* ── Results ── */}
        {hasContent && (
          <div style={s.resultsGrid}>

            {/* Browser panel toggle */}
            <div style={s.browserToggleBar}>
              <button
                style={s.browserToggleBtn}
                onClick={() => setShowBrowser(v => !v)}
              >
                <Icon d={icons.monitor} size={14} stroke="currentColor" sw={2} />
                {showBrowser ? "隐藏浏览器窗口" : "显示浏览器窗口（实时查看 AI 操作）"}
              </button>
              {running && <span style={s.liveTag}><span style={s.liveDotGreen} /> 运行中</span>}
            </div>

            {/* noVNC browser panel */}
            {(showBrowser || loginPending) && (
              <div style={s.browserPanel} className="animate-up">
                <div style={s.browserPanelHeader}>
                  <Icon d={icons.monitor} size={13} stroke="#2563eb" sw={2} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#2563eb" }}>浏览器实时操作</span>
                  <span style={s.browserPanelNote}>
                    {loginPending
                      ? `请在上方窗口完成 ${loginPending.platform} 登录（扫码或账号密码）`
                      : "AI 正在自动操作浏览器…"}
                  </span>
                </div>
                <iframe
                  src={NOVNC_URL}
                  style={s.browserIframe}
                  title="Browser Automation View"
                  allow="clipboard-read; clipboard-write"
                />
                {loginPending && (
                  <LoginBanner
                    platform={loginPending.platform}
                    onComplete={handleLoginComplete}
                  />
                )}
              </div>
            )}

            {/* Agent activity log */}
            <div style={s.card}>
              <div style={s.cardHeader}>
                <span style={s.cardTitle}>Agent 运行日志</span>
                {running && <span style={s.liveTag}><span style={s.liveDotGreen} /> 实时</span>}
              </div>
              <div style={s.timeline}>
                {steps.map((step, i) => (
                  <StepRow key={i} step={step} index={i} total={steps.length} />
                ))}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Price report */}
            {report && <ReportCard report={report} onReset={handleReset} done={done} />}

          </div>
        )}

        {/* ── How it works ── */}
        {!hasContent && (
          <section style={s.howSection}>
            <div style={s.howSectionHeader}>
              <div style={s.howTitle}>工作原理</div>
              <div style={s.howSub}>四步完成全网比价，全程 AI 自动操作</div>
            </div>
            <div style={s.howGrid}>
              {[
                { icon: "🌐", n: "01", label: "多平台搜索",  color: "#2563eb",
                  desc: "AI 控制真实 Chromium 浏览器，同时在京东、淘宝、拼多多发起搜索，无需人工干预。" },
                { icon: "🖱️", n: "02", label: "逐品深度查看", color: "#7c3aed",
                  desc: "依次点开每个平台前 5 个商品详情页，滚动浏览评价区、优惠券区，提取完整信息后关闭标签。" },
                { icon: "🎫", n: "03", label: "优惠券识别",   color: "#d97706",
                  desc: "在每个商品页自动识别满减券、领券减、店铺券等优惠活动，并记录实际到手价。" },
                { icon: "💡", n: "04", label: "智能推荐",    color: "#16a34a",
                  desc: "DeepSeek 大模型综合价格、销量、评价、优惠情况，给出最优平台和最佳购买建议。" },
              ].map(({ icon, n, label, color, desc }) => (
                <div key={n} style={s.howCard}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{ ...s.howNum, background: color + "15", borderColor: color + "30", color }}>
                      {icon}
                    </div>
                    <span style={{ ...s.howStep, color }}>{n}</span>
                  </div>
                  <div style={s.howCardLabel}>{label}</div>
                  <div style={s.howCardDesc}>{desc}</div>
                </div>
              ))}
            </div>
          </section>
        )}

      </main>

      <footer style={s.footer}>
        <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>AI 比价购物系统</span>
        <span style={s.footerDot}>·</span>
        <span>DeepSeek · Browser-Use · .NET 8 · React</span>
        <span style={s.footerDot}>·</span>
        <span>© 2026 <strong style={{ color: "var(--accent)", fontWeight: 600 }}>Raymondeng</strong></span>
      </footer>
    </div>
  );
}

// ── API Key Modal ─────────────────────────────────────────────────────────────
function ApiKeyModal({ initialKey, onSave, onClose }) {
  const [val, setVal]       = useState(initialKey || "");
  const [show, setShow]     = useState(false);
  const [err, setErr]       = useState("");

  const handleSave = () => {
    if (!val.trim()) { setErr("请输入 API Key"); return; }
    if (!val.trim().startsWith("sk-")) { setErr("DeepSeek API Key 通常以 sk- 开头"); return; }
    onSave(val.trim());
  };

  return (
    <div style={s.modalOverlay}>
      <div style={s.modal} className="animate-up">
        <div style={s.modalHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon d={icons.key} size={18} stroke="#2563eb" sw={2} />
            <span style={s.modalTitle}>DeepSeek API Key 配置</span>
          </div>
          {onClose && (
            <button style={s.modalClose} onClick={onClose}>×</button>
          )}
        </div>

        <p style={s.modalDesc}>
          请输入您的 DeepSeek API Key。Key 保存在本地浏览器中，不会上传到服务器。
        </p>

        <div style={s.inputGroup}>
          <input
            style={{ ...s.modalInput, letterSpacing: show ? "normal" : "0.12em" }}
            type={show ? "text" : "password"}
            value={val}
            onChange={e => { setVal(e.target.value); setErr(""); }}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
            autoFocus
          />
          <button style={s.eyeBtn} onClick={() => setShow(v => !v)}>
            <Icon d={show ? icons.eyeOff : icons.eye} size={15} stroke="#64748b" sw={2} />
          </button>
        </div>

        {err && <div style={s.modalErr}>{err}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <a
            href="https://platform.deepseek.com/api_keys"
            target="_blank"
            rel="noreferrer"
            style={s.linkBtn}
          >
            获取 API Key →
          </a>
          <button style={s.primaryBtn} onClick={handleSave}>
            保存并开始使用
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Login banner ───────────────────────────────────────────────────────────────
function LoginBanner({ platform, onComplete }) {
  const platformColor = PLATFORM_COLORS[platform] || "#2563eb";
  return (
    <div style={s.loginBanner}>
      <span style={s.loginBannerIcon} aria-hidden>🔐</span>
      <div style={s.loginBannerBody}>
        <div style={s.loginBannerTitle}>
          需要登录 <span style={{ color: platformColor }}>{platform}</span>
        </div>
        <div style={s.loginBannerDesc}>
          请在<strong>上方窗口</strong>扫码或输入账号登录，完成后点击右侧按钮继续。
        </div>
      </div>
      <button
        type="button"
        style={{ ...s.loginBannerBtn, background: platformColor }}
        onClick={onComplete}
      >
        ✓ 已完成登录，继续
      </button>
    </div>
  );
}

// ── Step Row ──────────────────────────────────────────────────────────────────
function StepRow({ step, index, total }) {
  const cfg        = STEP_CONFIG[step.type] || STEP_CONFIG.thinking;
  const last       = index === total - 1;
  const isThinking = step.type === "thinking";
  const [expanded, setExpanded] = useState(false);

  // For thinking steps: preview = first 80 chars of first line
  const preview = isThinking
    ? (step.message || "").split("\n").find(l => l.trim()) || ""
    : "";
  const previewText = preview.length > 80 ? preview.slice(0, 80) + "…" : preview;

  return (
    <div className="animate-up" style={{ ...s.stepRow, animationDelay: `${Math.min(index * 0.03, 0.25)}s` }}>
      <div style={s.rail}>
        <div style={{ ...s.railDot, background: cfg.color }} />
        {!last && <div style={s.railLine} />}
      </div>
      <div style={{ ...s.stepBody, background: cfg.bg, borderColor: cfg.border }}>

        {/* Badge row — for thinking steps, entire row is clickable */}
        <div
          style={{
            ...s.stepBadge,
            color: cfg.color,
            ...(isThinking ? { cursor: "pointer", userSelect: "none", display: "flex", justifyContent: "space-between", alignItems: "center" } : {}),
          }}
          onClick={isThinking ? () => setExpanded(v => !v) : undefined}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Icon d={icons[cfg.iconKey]} size={12} stroke={cfg.color} sw={2} />
            {cfg.label}
          </span>
          {isThinking && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: cfg.color, opacity: 0.75 }}>
              {expanded ? "收起" : "展开"}
              <span style={{ display: "inline-flex", transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                <Icon d={icons.chevron} size={12} stroke={cfg.color} sw={2} />
              </span>
            </span>
          )}
        </div>

        {/* Content */}
        {isThinking ? (
          expanded ? (
            <div style={{ ...s.thinkingContent }}>
              {step.message}
            </div>
          ) : (
            <div
              style={{ ...s.stepText, color: "#6b7280", fontStyle: "italic", cursor: "pointer" }}
              onClick={() => setExpanded(true)}
            >
              {previewText || "点击查看 AI 思考过程…"}
            </div>
          )
        ) : (
          <div style={step.type === "answer" ? s.stepTextAnswer : s.stepText}>
            {step.type === "answer"
              ? <MarkdownBlock text={step.message} />
              : step.message}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Report Card ───────────────────────────────────────────────────────────────
function ReportCard({ report, onReset, done }) {
  const recMap = {
    BUY_NOW: { label: "立即购买",  color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
    WAIT:    { label: "建议等待",  color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
    COMPARE: { label: "继续对比",  color: "#2563eb", bg: "#eff4ff", border: "#bfdbfe" },
  };
  const rec = recMap[report.recommendation] || recMap.COMPARE;

  return (
    <div style={s.reportCard} className="animate-up">
      <div style={s.reportHead}>
        <div style={s.cardTitle}>比价报告</div>
        <span style={{ ...s.recBadge, color: rec.color, background: rec.bg, borderColor: rec.border }}>
          {rec.label}
        </span>
      </div>

      <div style={s.reportProduct}>{report.product}</div>

      {report.couponFound && (
        <div style={s.couponBox}>
          <Icon d={icons.tag} size={13} stroke="#d97706" sw={2} />
          <span>发现优惠：</span>
          <code style={s.couponCode}>{report.couponFound}</code>
        </div>
      )}

      <div style={s.reportBody}>
        <MarkdownBlock text={report.recommendationReason} />
      </div>

      {report.listings?.length > 0 && (
        <div style={s.listingsSection}>
          <div style={s.listingsTitle}>各平台价格</div>
          <div style={s.listingsGrid}>
            {report.listings.slice(0, 6).map((l, i) => (
              <a
                key={i}
                href={l.url || "#"}
                target="_blank" rel="noreferrer"
                style={{ ...s.listing, ...(l.isBestPrice ? s.listingBest : {}) }}
              >
                {l.isBestPrice && <div style={s.bestLabel}>最低价</div>}
                <div style={s.listingStore}>{l.store}</div>
                <div style={{ ...s.listingPrice, ...(l.isBestPrice ? { color: "#16a34a" } : {}) }}>
                  {l.price}
                </div>
                {l.notes && <div style={s.listingNote}>{l.notes}</div>}
                {l.url && (
                  <div style={s.listingViewLink}>
                    查看详情 <Icon d={icons.external} size={11} stroke="#2563eb" sw={2} />
                  </div>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      <div style={s.reportFoot}>
        <span>搜索时间 {new Date(report.searchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        {done && (
          <button style={s.resetBtn} onClick={onReset}>
            <Icon d={icons.refresh} size={13} stroke="currentColor" sw={2} />
            重新搜索
          </button>
        )}
      </div>
    </div>
  );
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
function MarkdownBlock({ text }) {
  const inline = (str) => {
    const parts = str.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\)]+\)|`[^`]+`)/g);
    return parts.map((p, j) => {
      const lm = p.match(/^\[([^\]]+)\]\((https?:\/\/[^\)]+)\)$/);
      if (lm) return (
        <a key={j} href={lm[2]} target="_blank" rel="noreferrer" style={s.mdLink}>
          {lm[1]} <Icon d={icons.external} size={10} stroke="#2563eb" sw={2} />
        </a>
      );
      const bm = p.match(/^\*\*([^*]+)\*\*$/);
      if (bm) return <strong key={j} style={{ color: "var(--text)", fontWeight: 600 }}>{bm[1]}</strong>;
      const cm = p.match(/^`([^`]+)`$/);
      if (cm) return <code key={j} style={s.mdCode}>{cm[1]}</code>;
      return <span key={j}>{p}</span>;
    });
  };

  return (
    <div>
      {(text || "").split("\n").map((line, i) => {
        if (line.startsWith("### ")) return <p key={i} style={s.mdH3}>{inline(line.slice(4))}</p>;
        if (line.startsWith("## "))  return <p key={i} style={s.mdH2}>{inline(line.slice(3))}</p>;
        if (line.startsWith("# "))   return <p key={i} style={s.mdH1}>{inline(line.slice(2))}</p>;
        if (line.startsWith("---"))  return <hr key={i} style={s.mdHr} />;
        if (line.match(/^\s{2,}[-*] /)) return <div key={i} style={s.mdSub}>{inline(line.replace(/^\s+[-*] /, ""))}</div>;
        if (line.match(/^[-*] /) || line.match(/^\d+\. /)) return (
          <div key={i} style={s.mdItem}>
            <span style={s.mdBullet}>•</span>
            <span>{inline(line.replace(/^[-*] /, "").replace(/^\d+\. /, ""))}</span>
          </div>
        );
        if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
        return <div key={i} style={s.mdLine}>{inline(line)}</div>;
      })}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  root: { minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" },

  // Header
  header: { background: "var(--surface)", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 50 },
  headerInner: { maxWidth: 1080, margin: "0 auto", padding: "0 32px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between" },
  brand: { display: "flex", alignItems: "center", gap: 11 },
  logoMark: { width: 34, height: 34, borderRadius: 8, background: "#eff4ff", border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "center" },
  brandName: { fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" },
  brandSub:  { fontSize: 11, color: "var(--text-dim)", marginTop: 1 },
  nav: { display: "flex", alignItems: "center", gap: 10 },
  navPill: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, color: "var(--text-muted)", background: "var(--bg2)", border: "1px solid var(--border)", padding: "4px 10px", borderRadius: 99 },
  liveDot: { width: 6, height: 6, borderRadius: "50%", background: "#16a34a", boxShadow: "0 0 0 2px #dcfce7" },
  settingsBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: "var(--radius-sm)", background: "var(--text)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" },

  // Main
  main: { flex: 1, maxWidth: 1080, width: "100%", margin: "0 auto", padding: "0 32px 80px" },

  // Hero
  hero: { padding: "56px 0 44px", maxWidth: 680 },
  heroLabel: { display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 600, color: "var(--accent)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 20, background: "var(--accent-light)", border: "1px solid #bfdbfe", padding: "5px 12px", borderRadius: 99 },
  heroDot: { width: 6, height: 6, borderRadius: "50%", background: "#16a34a", boxShadow: "0 0 0 2px #dcfce7", flexShrink: 0 },
  heroTitle: { fontSize: 42, fontWeight: 800, lineHeight: 1.18, letterSpacing: "-0.04em", color: "var(--text)", marginBottom: 18 },
  heroGradient: { background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" },
  heroSub: { fontSize: 15, color: "var(--text-muted)", lineHeight: 1.75, maxWidth: 580, marginBottom: 28 },
  platformRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 22 },
  platformBadge: { fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 99, border: "1px solid" },
  platformSep: { fontSize: 12, color: "var(--text-dim)", fontStyle: "italic" },
  featureRow: { display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 },
  featureItem: { display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 500, color: "var(--text-muted)", background: "var(--surface)", border: "1px solid var(--border)", padding: "6px 14px", borderRadius: 99 },
  featureText: { color: "var(--text-muted)" },
  techRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  techPill: { fontSize: 11, fontWeight: 500, padding: "4px 10px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 99, color: "var(--text-dim)" },

  // Search
  searchBarHero:    { marginBottom: 48 },
  searchBarCompact: { marginBottom: 20, paddingTop: 24 },
  searchBox: { display: "flex", alignItems: "center", background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow)", padding: "5px 5px 5px 16px", gap: 8 },
  searchIconWrap: { color: "var(--text-dim)", display: "flex", flexShrink: 0 },
  searchInput: { flex: 1, border: "none", background: "transparent", fontSize: 14, color: "var(--text)", outline: "none", padding: "9px 4px", minWidth: 0 },
  searchBtn: { display: "flex", alignItems: "center", gap: 7, flexShrink: 0, padding: "9px 18px", borderRadius: "var(--radius)", background: "var(--accent)", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  searchBtnBusy: { background: "#93a8e8", cursor: "not-allowed" },
  chipRow: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 14 },
  chipLabel: { fontSize: 12, color: "var(--text-dim)", fontWeight: 500 },
  chip: { fontSize: 12, fontWeight: 500, padding: "5px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 99, color: "var(--text-muted)", cursor: "pointer" },

  // Results
  resultsGrid: { display: "flex", flexDirection: "column", gap: 16 },

  // Browser panel
  browserToggleBar: { display: "flex", alignItems: "center", gap: 12 },
  browserToggleBtn: { display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: "var(--radius-sm)", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12, fontWeight: 500, cursor: "pointer" },
  browserPanel: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" },
  browserPanelHeader: { display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "#eff4ff" },
  browserPanelNote: { marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" },
  browserIframe: { width: "100%", height: 520, border: "none", display: "block" },
  loginBanner: {
    display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
    padding: "12px 16px", borderTop: "1px solid var(--border)",
    background: "linear-gradient(180deg, #fffbeb 0%, #fff7ed 100%)",
  },
  loginBannerIcon: { fontSize: 28, flexShrink: 0 },
  loginBannerBody: { flex: 1, minWidth: 200 },
  loginBannerTitle: { fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 },
  loginBannerDesc: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 },
  loginBannerBtn: {
    flexShrink: 0, padding: "10px 18px", border: "none", borderRadius: "var(--radius)",
    color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  },

  // Card
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" },
  cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--border)" },
  cardTitle: { fontSize: 12, fontWeight: 700, color: "var(--text)", letterSpacing: "0.01em" },
  liveTag: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#16a34a" },
  liveDotGreen: { width: 6, height: 6, borderRadius: "50%", background: "#16a34a", animation: "pulse 1.2s ease infinite" },

  // Timeline
  timeline: { padding: "8px 0 4px" },
  stepRow: { display: "flex", gap: 0, padding: "0 20px 0 16px" },
  rail: { display: "flex", flexDirection: "column", alignItems: "center", width: 24, flexShrink: 0, paddingTop: 14 },
  railDot: { width: 9, height: 9, borderRadius: "50%", flexShrink: 0, border: "2px solid var(--surface)" },
  railLine: { width: 1, flex: 1, background: "var(--border)", minHeight: 8, marginTop: 3 },
  stepBody: { flex: 1, marginLeft: 10, marginBottom: 6, border: "1px solid", borderRadius: "var(--radius-sm)", padding: "9px 13px", marginTop: 8 },
  stepBadge: { display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 5 },
  stepText: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "'SF Mono','Fira Code','Consolas',monospace" },
  stepTextAnswer: { fontSize: 13, lineHeight: 1.7, color: "var(--text-muted)" },
  thinkingContent: { fontSize: 12, color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 2, padding: "8px 10px", background: "rgba(37,99,235,0.04)", borderRadius: 6, borderLeft: "3px solid #93c5fd" },

  // Report
  reportCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" },
  reportHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px 12px", borderBottom: "1px solid var(--border)", gap: 12 },
  reportProduct: { fontSize: 18, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em", padding: "14px 20px 0" },
  recBadge: { fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", padding: "4px 12px", borderRadius: 99, border: "1px solid", whiteSpace: "nowrap" },
  couponBox: { display: "flex", alignItems: "center", gap: 7, margin: "14px 20px 0", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "var(--radius-sm)", padding: "8px 12px", fontSize: 12, color: "var(--text-muted)", fontWeight: 500 },
  couponCode: { fontFamily: "'SF Mono','Fira Code',monospace", fontWeight: 700, color: "#d97706", fontSize: 12, background: "#fef9c3", padding: "1px 6px", borderRadius: 4, border: "1px solid #fde68a" },
  reportBody: { padding: "16px 20px" },
  reportFoot: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-dim)" },
  resetBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: "var(--radius-sm)", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12, fontWeight: 500, cursor: "pointer" },

  // Listings
  listingsSection: { padding: "0 20px 20px" },
  listingsTitle: { fontSize: 11, fontWeight: 700, color: "var(--text-dim)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 },
  listingsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 },
  listing: { display: "block", padding: "12px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", textDecoration: "none", color: "inherit" },
  listingBest: { borderColor: "#bbf7d0", background: "#f0fdf4", boxShadow: "0 0 0 1px #bbf7d0" },
  bestLabel: { fontSize: 10, fontWeight: 700, color: "#16a34a", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5 },
  listingStore: { fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 3 },
  listingPrice: { fontSize: 17, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" },
  listingNote:  { fontSize: 11, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.4 },
  listingViewLink: { display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--accent)", marginTop: 8, fontWeight: 500 },

  // How it works
  howSection: { paddingBottom: 64 },
  howSectionHeader: { marginBottom: 24 },
  howTitle: { fontSize: 18, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em", marginBottom: 6 },
  howSub: { fontSize: 13, color: "var(--text-muted)" },
  howStep: { fontSize: 10, fontWeight: 800, letterSpacing: "0.1em" },
  howGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 },
  howCard: { padding: "20px 20px 22px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", transition: "box-shadow 0.15s" },
  howNum: { width: 38, height: 38, borderRadius: 10, border: "1px solid", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 },
  howCardLabel: { fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 8 },
  howCardDesc:  { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 },

  // Modal
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 },
  modal: { background: "var(--surface)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" },
  modalHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  modalTitle: { fontSize: 16, fontWeight: 700, color: "var(--text)" },
  modalClose: { background: "none", border: "none", fontSize: 20, color: "var(--text-dim)", cursor: "pointer", padding: "0 4px" },
  modalDesc: { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 16 },
  inputGroup: { position: "relative" },
  modalInput: { width: "100%", padding: "11px 44px 11px 14px", border: "1.5px solid var(--border2)", borderRadius: "var(--radius)", fontSize: 13, color: "var(--text)", background: "var(--bg)", outline: "none", boxSizing: "border-box", fontFamily: "monospace" },
  eyeBtn: { position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4 },
  modalErr: { fontSize: 12, color: "#dc2626", marginTop: 8 },
  primaryBtn: { display: "flex", alignItems: "center", gap: 6, padding: "10px 20px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius)", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  linkBtn: { display: "flex", alignItems: "center", padding: "10px 16px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13, fontWeight: 500, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" },

  // Login modal
  loginSteps: { textAlign: "left", display: "flex", flexDirection: "column", gap: 10, marginTop: 4 },
  loginStep: { display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)" },
  loginStepNum: { width: 22, height: 22, borderRadius: "50%", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },

  // Footer
  footer: { borderTop: "1px solid var(--border)", background: "var(--surface)", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12, color: "var(--text-dim)" },
  footerDot: { color: "var(--border2)" },

  // Markdown
  mdH1: { fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "16px 0 6px", letterSpacing: "-0.02em" },
  mdH2: { fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "14px 0 5px", letterSpacing: "-0.01em" },
  mdH3: { fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "12px 0 4px" },
  mdHr: { border: "none", borderTop: "1px solid var(--border)", margin: "10px 0" },
  mdItem: { display: "flex", gap: 7, padding: "2px 0", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65 },
  mdBullet: { color: "var(--accent)", flexShrink: 0, fontWeight: 700, fontSize: 12, marginTop: 1 },
  mdSub: { paddingLeft: 24, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 },
  mdLine: { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 1 },
  mdLink: { color: "var(--accent)", fontWeight: 500, textDecoration: "underline", textDecorationColor: "#bfdbfe", display: "inline-flex", alignItems: "center", gap: 3 },
  mdCode: { background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px", fontSize: "0.85em", fontFamily: "'SF Mono','Fira Code','Consolas',monospace", color: "#d97706" },
};
