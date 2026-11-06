/**
 * BBG · Multi-Core Anti-Censorship & Subscription Control Plane
 * Author / Maintainer: SANDBAAD
 * Modern Glassmorphic UI, Bento Analytics Studio & V5 Capsule Navigation.
 */

const S = {
  state: null,
  boot: null,
  tab: 'dashboard',
  dashFilter: 'all',
  searchQuery: '',
  editing: null,      // inbound id being edited
  logSource: 'xray',
  logTimer: null,
  refreshTimer: null,
  update: null,       // last /api/update answer
  updateBusy: false,
  updateTimer: null,
  busy: false,
};

/* ── Tiny Helpers ──────────────────────────────────────────────────────── */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const t = (fa, en) => `<span class="fa">${fa}</span><span class="en">${en}</span>`;
const tt = (fa, en) => (document.documentElement.lang === 'en' ? en : fa);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = 'ic') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtUptime(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function relTime(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60000) return `${Math.max(1, Math.floor(diff / 1000))}s`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

function toast(message, kind = 'ok') {
  const el = $('#toast');
  if (!el) return;
  el.hidden = false;
  el.textContent = String(message).replace(/<[^>]+>/g, '');
  el.className = `toast ${kind}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return data;
}

function copyText(text) {
  navigator.clipboard?.writeText(text).then(
    () => toast(tt('کپی شد', 'Copied to clipboard'), 'ok'),
    () => toast(tt('خطا در کپی', 'Copy failed'), 'warn'),
  );
}

function qrInto(el, text) {
  if (!el || !text) return;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 2, margin: 4, scalable: true });
  } catch {
    el.textContent = 'QR error';
  }
}

/* ── Theme & Language ──────────────────────────────────────────────────── */

const LANG_KEY = 'bbg-lang';
const THEME_KEY = 'bbg-theme';

function applyLang(lang) {
  document.documentElement.dataset.lang = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  $('#btn-lang') && ($('#btn-lang').textContent = lang === 'fa' ? 'EN' : 'فا');
  $('#auth-lang') && ($('#auth-lang').textContent = lang === 'fa' ? 'EN' : 'فا');
  const searchInput = $('#global-search');
  if (searchInput) {
    searchInput.placeholder = lang === 'fa'
      ? 'جستجوی کاربران، پروتکل‌ها، مسیرها یا تنظیمات...'
      : 'Search subscribers, protocols, routes, or settings...';
  }
  localStorage.setItem(LANG_KEY, lang);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $$('.t-pick').forEach((b) => b.classList.toggle('active', b.dataset.th === theme));
  localStorage.setItem(THEME_KEY, theme);
}

/* ── Status Bar & Dual Navigation (Sidebar + V5 Capsule) ───────────────── */

function coreBadge(status) {
  const map = {
    running: ['ok', t('در حال اجرا', 'RUNNING')],
    starting: ['ok', t('راه‌اندازی', 'STARTING')],
    stopped: ['bad', t('خاموش', 'STOPPED')],
    crashed: ['bad', t('کرش', 'CRASHED')],
    invalid: ['bad', t('کانفیگ نامعتبر', 'INVALID')],
    missing: ['bad', t('باینری نیست', 'NO BINARY')],
    error: ['bad', t('خطا', 'ERROR')],
  };
  const [cls, label] = map[status] || ['bad', esc(status)];
  return `<span class="badge ${cls}">${label}</span>`;
}

function renderStatusBar() {
  const st = S.state;
  if (!st) return;
  const cells = [
    ['XRAY-CORE', st.cores.xray.status, st.cores.xray.status === 'running'],
    ['SING-BOX', st.cores.singbox.status, st.cores.singbox.status === 'running'],
    ['MTPROTO', st.cores.mtproto.status, st.cores.mtproto.status === 'running'],
    [t('پروکسی TCP', 'TCP MUX'), st.facts.tcpReady ? `${st.facts.tcpHost}:${st.facts.tcpPort}` : 'OFF', st.facts.tcpReady],
    [t('دامنهٔ لبه', 'EDGE HOST'), st.facts.publicHost || 'OFF', Boolean(st.facts.publicHost)],
  ];
  const valueHtml = (raw) => {
    const m = /^([^:\s]+)(:\d+)$/.exec(String(raw || ''));
    if (m) return `${esc(m[1])}<span class="nw">${esc(m[2])}</span>`;
    return esc(String(raw || '—'));
  };
  const ledgerEl = $('#ledger-items');
  if (ledgerEl) {
    ledgerEl.innerHTML = cells.map(([label, value, ok]) => `
      <div class="s-cell ${ok ? 'on' : 'off'}${String(value || '').length > 18 ? ' wide' : ''}">
        <span class="s-dot"></span>
        <span class="s-label">${label}</span>
        <span class="s-value" dir="ltr" title="${esc(String(value || ''))}">${valueHtml(value)}</span>
      </div>`).join('');
  }
  $('#top-region') && ($('#top-region').textContent = `BBG · ${(st.facts.region || 'EDGE').toUpperCase()}`);
  $('#edition') && ($('#edition').textContent = `BBG V${st.app.version} · SANDBAAD`);
  $('#mode-pill') && ($('#mode-pill').textContent = `BBG · V${st.app.version}`);

  // Update sidebar subscriber capacity bar
  const maxU = st.limits?.maxUsers || 50;
  const curU = (st.users || []).length;
  const capPct = Math.min(100, Math.round((curU / Math.max(1, maxU)) * 100));
  $('#side-cap-label') && ($('#side-cap-label').textContent = `${curU}/${maxU}`);
  $('#side-cap-bar') && ($('#side-cap-bar').style.width = `${Math.max(6, capPct)}%`);

  const ticks = [
    'BBG CONTROL PLANE · BY SANDBAAD',
    'XRAY 25 + SING-BOX 1.12 DUAL CORE',
    'REALITY · XHTTP PADDING · 0-RTT WS · ANYTLS',
    'TLS RECORD FRAGMENTATION & UTLS CHROME',
    'SINGLE-PORT TCP SNI MULTIPLEXER',
    'TUNNEL-ROUTED DOH & ZERO-STALL TELEGRAM',
  ];
  const tickerEl = $('#ticker-track');
  if (tickerEl) {
    tickerEl.innerHTML = [...ticks, ...ticks].map((x) => `<span>${x}</span>`).join('');
  }
}

const TABS = [
  { id: 'dashboard', group: 'mgmt', icon: 'gauge', fa: 'نمای کلی', en: 'Overview' },
  { id: 'easy', group: 'mgmt', icon: 'bolt', fa: 'تنظیم هوشمند', en: 'Quick Tune' },
  { id: 'railynx', group: 'mgmt', icon: 'radar', fa: 'اسکنر آی‌پی', en: 'EdgeScan' },
  { id: 'inbounds', group: 'net', icon: 'layers', fa: 'پروتکل‌ها', en: 'Protocols' },
  { id: 'cores', group: 'net', icon: 'cpu', fa: 'هسته‌ها', en: 'Cores & Logs' },
  { id: 'telegram', group: 'net', icon: 'telegram', fa: 'تلگرام', en: 'Telegram Mux' },
  { id: 'users', group: 'subs', icon: 'users', fa: 'مشترکین', en: 'Subscribers' },
  { id: 'delivery', group: 'subs', icon: 'send', fa: 'لینک و اشتراک', en: 'Subscriptions' },
  { id: 'settings', group: 'sys', icon: 'sliders', fa: 'تنظیمات', en: 'Settings' },
];

const SIDEBAR_GROUPS = [
  { id: 'mgmt', fa: 'مدیریت', en: 'MANAGEMENT' },
  { id: 'net', fa: 'شبکه و هسته‌ها', en: 'NETWORK & CORES' },
  { id: 'subs', fa: 'مشترکین', en: 'SUBSCRIBERS' },
  { id: 'sys', fa: 'سیستم', en: 'SYSTEM' },
];

function renderNav() {
  const st = S.state;
  if (!st) return;
  const counts = {
    inbounds: st.inbounds.filter((i) => i.enabled).length,
    users: st.users.length,
    telegram: [st.telegram.mtproto.enabled, st.telegram.socks.enabled, st.telegram.http.enabled].filter(Boolean).length,
  };

  // 1. Categorized Left Sidebar (Screenshot 1 & 2)
  const sideEl = $('#sidebar-nav');
  if (sideEl) {
    sideEl.innerHTML = SIDEBAR_GROUPS.map((grp) => {
      const items = TABS.filter((tab) => tab.group === grp.id);
      return `
        <div class="side-group-label">${t(grp.fa, grp.en)}</div>
        ${items.map((tab) => `
          <button class="side-btn ${S.tab === tab.id ? 'active' : ''}" data-act="tab" data-arg="${tab.id}" type="button">
            ${icon(tab.icon, 'ic')}
            <span>${t(tab.fa, tab.en)}</span>
            ${counts[tab.id] !== undefined ? `<span class="tnum">${counts[tab.id]}</span>` : ''}
          </button>
        `).join('')}
      `;
    }).join('');
  }

  // 2. Glassy Navigation Tabs V5 Floating Capsule (Screenshot 3)
  const navEl = $('#nav');
  if (navEl) {
    navEl.innerHTML = TABS.map((tab) => `
      <button class="tab-btn ${S.tab === tab.id ? 'active' : ''}" data-act="tab" data-arg="${tab.id}" type="button">
        <span class="tab-lbl">${icon(tab.icon, 'ic')}${t(tab.fa, tab.en)}</span>
        ${counts[tab.id] !== undefined ? `<span class="tnum">${counts[tab.id]}</span>` : ''}
      </button>`).join('');
  }
}

function switchTab(id) {
  S.tab = id;
  S.editing = null;
  $$('.tab-pane').forEach((pane) => { pane.hidden = pane.dataset.pane !== id; });
  renderNav();
  renderPane(id);
  if (id === 'easy') { loadEasy().then(() => { if (S.tab === 'easy') renderEasy(); }).catch(() => {}); }
  if (id === 'railynx') { railynxPoll(); }
  if (id !== 'railynx') stopRailynxPolling();
  if (id === 'cores') startLogPolling(); else stopLogPolling();
  if (id === 'dashboard' || id === 'cores') refreshLogs();
}

/* ── Bento Dashboard & Cubic-Bezier Traffic Studio (Screenshot 1 & 2) ──── */

function smoothCubicPath(points, width = 600, height = 160, padY = 16) {
  if (!points.length) {
    const mid = height / 2;
    return {
      line: `M 0 ${mid} L ${width} ${mid}`,
      area: `M 0 ${mid} L ${width} ${mid} L ${width} ${height} L 0 ${height} Z`,
    };
  }
  const vals = points.map((p) => (p.up || 0) + (p.down || 0) + (p.tg || 0));
  const max = Math.max(1024, ...vals);
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = vals.map((v, i) => ({
    x: i * step,
    y: height - padY - (v / max) * (height - padY * 2),
  }));
  if (coords.length === 1) {
    coords.push({ x: width, y: coords[0].y });
  }
  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[i];
    const p1 = coords[i + 1];
    const cx = ((p0.x + p1.x) / 2).toFixed(1);
    d += ` C ${cx} ${p0.y.toFixed(1)}, ${cx} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  const area = `${d} L ${width} ${height} L 0 ${height} Z`;
  return { line: d, area };
}

function miniSparkSvg(color = '#2dd4bf', seed = 1) {
  const pts = [18, 12, 20, 9, 15, 6, 11, 4].map((y, i) => `${i * 9.5},${Math.max(3, (y + ((seed * (i + 2)) % 7)) % 26)}`);
  return `<svg class="studio-mini-spark" viewBox="0 0 68 28" fill="none">
    <polyline points="${pts.join(' ')}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function renderDashboard() {
  const st = S.state;
  const activeUsers = st.users.filter((u) => u.status === 'active').length;
  const totalUp = st.users.reduce((sum, u) => sum + u.usage.up, 0);
  const totalDown = st.users.reduce((sum, u) => sum + u.usage.down, 0);
  const mux = st.cores.mux;
  const tgTraffic = (mux.up || 0) + (mux.down || 0);
  const totalBandwidth = totalUp + totalDown + tgTraffic;
  const uptime = Date.now() - st.cores.bootedAt;

  const enabledInbounds = st.inbounds.filter((i) => i.enabled);
  const xrayCount = enabledInbounds.filter((i) => i.core === 'xray').length;
  const sbCount = enabledInbounds.filter((i) => i.core === 'singbox').length;
  const tgCount = [st.telegram.mtproto.enabled, st.telegram.socks.enabled, st.telegram.http.enabled].filter(Boolean).length;

  // Build smooth cubic-bezier chart
  const samples = (st.traffic || []).slice(-36);
  const chart = smoothCubicPath(samples, 620, 170, 18);

  // Donut health & capacity calculation
  const coresUp = [st.cores.xray.status === 'running', st.cores.singbox.status === 'running'].filter(Boolean).length;
  const healthPct = Math.min(100, Math.round(((enabledInbounds.length > 0 ? 60 : 20) + (coresUp * 20))));
  const r = 38;
  const circum = 2 * Math.PI * r;
  const dashOffset = circum - (healthPct / 100) * circum;

  // 24-bar live histogram for Live Mux Store card
  const barSeeds = Array.from({ length: 24 }, (_, idx) => {
    const sample = samples[samples.length - 24 + idx];
    if (sample) {
      const v = (sample.up || 0) + (sample.down || 0) + (sample.tg || 0);
      return Math.max(12, Math.min(100, Math.round(Math.log10(v + 10) * 18)));
    }
    return 16 + ((idx * 17 + (mux.total || 3) * 11) % 68);
  });

  // Filtered inbounds preview based on Pill Tabs
  const filteredInbounds = enabledInbounds.filter((ib) => {
    if (S.dashFilter === 'xray') return ib.core === 'xray';
    if (S.dashFilter === 'singbox') return ib.core === 'singbox';
    return true;
  });

  $('#pane-dashboard').innerHTML = `
    ${updateBannerHtml()}

    <!-- Pill Filter Bar (Screenshot 1) -->
    <div class="pill-tabs">
      <button class="pill-tab ${S.dashFilter === 'all' ? 'active' : ''}" data-act="dash-filter" data-arg="all" type="button">
        ${t('همهٔ مسیرها', 'All Transports')} <span class="count">${enabledInbounds.length + tgCount}</span>
      </button>
      <button class="pill-tab ${S.dashFilter === 'xray' ? 'active' : ''}" data-act="dash-filter" data-arg="xray" type="button">
        Xray-core <span class="count">${xrayCount}</span>
      </button>
      <button class="pill-tab ${S.dashFilter === 'singbox' ? 'active' : ''}" data-act="dash-filter" data-arg="singbox" type="button">
        sing-box 1.12 <span class="count">${sbCount}</span>
      </button>
      <button class="pill-tab" data-act="tab" data-arg="inbounds" type="button" style="margin-inline-start:auto">
        ${icon('plus', 'ic ic-sm')}${t('مدیریت پروتکل‌ها', 'Manage Protocols')}
      </button>
    </div>

    <!-- Bento Dashboard Studio (Screenshot 2) -->
    <div class="bento-grid">
      <div class="bento-studio">
        <div class="studio-kpis">
          <div class="studio-kpi">
            <div class="studio-kpi-info">
              <p class="studio-kpi-lbl">${t('ترافیک کل شبکه', 'Total Edge Traffic')}</p>
              <div class="studio-kpi-val">${fmtBytes(totalBandwidth)}</div>
              <span class="studio-kpi-delta">↑ ${fmtBytes(totalUp)} · ↓ ${fmtBytes(totalDown)}</span>
            </div>
            ${miniSparkSvg('#2dd4bf', 1)}
          </div>
          <div class="studio-kpi">
            <div class="studio-kpi-info">
              <p class="studio-kpi-lbl">${t('مشترکین فعال', 'Active Subscribers')}</p>
              <div class="studio-kpi-val">${activeUsers} / ${st.users.length}</div>
              <span class="studio-kpi-delta">● ${t('آمادهٔ اتصال', '0-RTT Ready')}</span>
            </div>
            ${miniSparkSvg('#38bdf8', 3)}
          </div>
          <div class="studio-kpi">
            <div class="studio-kpi-info">
              <p class="studio-kpi-lbl">${t('پروتکل‌های مقاوم فعال', 'Hardened Inbounds')}</p>
              <div class="studio-kpi-val">${enabledInbounds.length}</div>
              <span class="studio-kpi-delta">+${tgCount} ${t('پروکسی تلگرام', 'TG Mux')}</span>
            </div>
            ${miniSparkSvg('#10b981', 5)}
          </div>
        </div>

        <div class="studio-head">
          <div>
            <div class="studio-title">${icon('chart', 'ic')}${t('استودیو ترافیک و توان عبوری', 'BBG Telemetry & Traffic Studio')}</div>
            <div class="studio-sub">${t(
              `آپ‌تایم: ${fmtUptime(uptime)} · نمونه برداری زنده از هسته‌های Xray و مالتی‌پلکسر TCP`,
              `Uptime: ${fmtUptime(uptime)} · Live telemetry across Xray-core, sing-box & single-port TCP multiplexer`,
            )}</div>
          </div>
          <div class="studio-pills">
            <span class="studio-pill active">LIVE</span>
            <span class="studio-pill">${samples.length} PTS</span>
            <span class="studio-pill">${(st.facts.region || 'EDGE').toUpperCase()}</span>
          </div>
        </div>

        <div class="studio-chart-wrap">
          <svg class="studio-svg" viewBox="0 0 620 170" preserveAspectRatio="none">
            <defs>
              <linearGradient id="bbgAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.38"/>
                <stop offset="65%" stop-color="#2dd4bf" stop-opacity="0.10"/>
                <stop offset="100%" stop-color="#0f172a" stop-opacity="0.0"/>
              </linearGradient>
              <linearGradient id="bbgLineGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="#2dd4bf"/>
                <stop offset="50%" stop-color="#38bdf8"/>
                <stop offset="100%" stop-color="#818cf8"/>
              </linearGradient>
            </defs>
            <line x1="0" y1="35" x2="620" y2="35" stroke="rgba(148,163,184,0.10)" stroke-dasharray="4 4"/>
            <line x1="0" y1="85" x2="620" y2="85" stroke="rgba(148,163,184,0.10)" stroke-dasharray="4 4"/>
            <line x1="0" y1="135" x2="620" y2="135" stroke="rgba(148,163,184,0.10)" stroke-dasharray="4 4"/>
            <path d="${chart.area}" fill="url(#bbgAreaGrad)"/>
            <path d="${chart.line}" fill="none" stroke="url(#bbgLineGrad)" stroke-width="2.6" stroke-linecap="round"/>
          </svg>
        </div>
      </div>

      <div class="bento-side">
        <!-- Circular Donut Goal / Health Card -->
        <div class="bento-goal-card">
          <div class="spread">
            <p class="kicker" style="margin:0">${icon('shield')}${t('سلامت و ظرفیت سیستم', 'SYSTEM HEALTH & QUOTA')}</p>
            <span class="chip ok">TLS FRAGMENT ON</span>
          </div>
          <div class="donut-row">
            <div class="donut-wrap">
              <svg class="donut-svg" viewBox="0 0 96 96">
                <circle cx="48" cy="48" r="${r}" stroke="rgba(148,163,184,0.14)" stroke-width="8" fill="none"/>
                <circle cx="48" cy="48" r="${r}" stroke="url(#bbgLineGrad)" stroke-width="8" fill="none"
                  stroke-linecap="round" stroke-dasharray="${circum.toFixed(1)}" stroke-dashoffset="${dashOffset.toFixed(1)}"/>
              </svg>
              <div class="donut-center">
                <span class="donut-pct">${healthPct}%</span>
                <span class="donut-lbl">HEALTH</span>
              </div>
            </div>
            <div class="donut-facts">
              <div class="donut-fact"><span>${t('هستهٔ Xray', 'Xray-core')}</span><b>${st.cores.xray.status.toUpperCase()}</b></div>
              <div class="donut-fact"><span>${t('هستهٔ sing-box', 'sing-box')}</span><b>${st.cores.singbox.status.toUpperCase()}</b></div>
              <div class="donut-fact"><span>${t('ترافیک تلگرام', 'TG Egress')}</span><b>${fmtBytes(tgTraffic)}</b></div>
            </div>
          </div>
        </div>

        <!-- Live Mux Store Card -->
        <div class="bento-live-card">
          <div class="live-head">
            <span class="live-indicator"><span class="live-dot"></span>${t('مالتی‌پلکسر زنده', 'Live Multiplexer')}</span>
            <span class="mono muted" style="font-size:11px">:${st.facts.muxPort}</span>
          </div>
          <div class="live-big">
            <strong>${mux.active || 0}</strong>
            <span>${t(`اتصال هم‌زمان (${mux.total || 0} کل نشست‌ها)`, `active streams (${mux.total || 0} total sessions)`)}</span>
          </div>
          <div class="live-bars">
            ${barSeeds.map((h) => `<span class="live-bar" style="height:${h}%"></span>`).join('')}
          </div>
          <div class="live-meta">
            <span>TLS/REALITY: <b class="mono">${mux.tls || 0}</b></span>
            <span>MTProto: <b class="mono">${mux.mtproto || 0}</b></span>
            <span>SOCKS/HTTP: <b class="mono">${(mux.socks || 0) + ((st.cores.http && st.cores.http.conns) || 0)}</b></span>
          </div>
        </div>
      </div>
    </div>

    <!-- Active Hardened Transports Strip (Screenshot 1 Cards) -->
    <div class="card" style="margin-bottom:18px">
      <div class="spread" style="margin-bottom:10px">
        <p class="kicker" style="margin:0">${icon('layers')}${t('مسیرهای فعال ضد فیلتر', 'ACTIVE HARDENED TRANSPORTS')}</p>
        <span class="mono muted" style="font-size:11px">${filteredInbounds.length} ACTIVE</span>
      </div>
      <div class="proto-grid">
        ${filteredInbounds.map((ib) => `
          <div class="proto-card">
            <div class="proto-head">
              <div class="proto-name">${icon(inboundIcon(ib), 'ic')}${t(esc(ib.title.fa), esc(ib.title.en))}</div>
              <span class="chip ${ib.core === 'xray' ? 'xray' : 'singbox'}">${ib.core}</span>
            </div>
            <div class="chips">
              <span class="chip">${esc(ib.protocol)}</span>
              <span class="chip">${esc(ib.transport)}</span>
              <span class="chip ok">${ib.edge === 'http' ? '0-RTT / EDGE' : 'DIRECT TCP'}</span>
            </div>
            <div class="proto-meta">
              <span>${ib.edge === 'http' ? 'Endpoint' : 'SNI / Dest'}: <b>${esc(ib.edge === 'http' ? '/' + ib.routeKey : (ib.params.sni || ib.params.dest || '127.0.0.1:' + ib.port))}</b></span>
            </div>
          </div>
        `).join('') || `<p class="muted">${t('هیچ پروتکلی در این دسته فعال نیست.', 'No active transports in this category.')}</p>`}
      </div>
    </div>

    <div class="cols">
      <div class="card">
        <p class="kicker">${icon('cpu')}${t('وضعیت هسته‌ها و سرویس‌ها', 'CORE & ENGINE STATUS')}</p>
        ${coreRow('Xray-core', st.cores.xray)}
        ${coreRow('sing-box', st.cores.singbox)}
        ${coreRow('mtg (MTProto)', st.cores.mtproto)}
        <div class="dashed"></div>
        <p class="kicker">${icon('globe')}${t('آدرس‌های ورودی لبه', 'EDGE ENTRY ENDPOINTS')}</p>
        ${endpointRow('HTTPS', st.facts.panelUrl || '—', st.facts.panelUrl)}
        ${endpointRow('TCP MUX', st.facts.tcpReady ? `${st.facts.tcpHost}:${st.facts.tcpPort}` : `127.0.0.1:${st.facts.muxPort}`, st.facts.tcpReady ? `${st.facts.tcpHost}:${st.facts.tcpPort}` : '')}
        <div class="actions">
          <button class="btn sm-btn primary" data-act="apply" type="button">${icon('refresh', 'ic ic-sm')}${t('بازسازی و اعمال کانفیگ', 'REBUILD & APPLY')}</button>
          <button class="btn sm-btn ghost" data-act="tab" data-arg="cores" type="button">${icon('terminal', 'ic ic-sm')}${t('گزارش زنده', 'LIVE LOGS')}</button>
        </div>
      </div>

      <div class="card">
        <p class="kicker">${icon('pulse')}${t('رویدادهای اخیر سیستم', 'RECENT SYSTEM EVENTS')}</p>
        <div class="node-list" style="max-height:290px">
          ${st.events.length ? st.events.map((ev) => `
            <div class="node-row">
              <span class="node-title"><span class="badge">${esc(ev.kind)}</span>${esc(ev.message)}</span>
              <span class="mono" style="font-size:10.5px;opacity:.7">${relTime(ev.t)}</span>
            </div>`).join('') : `<p class="hint">${t('رویدادی ثبت نشده است.', 'No events recorded yet.')}</p>`}
        </div>
      </div>
    </div>`;
}

function endpointRow(key, value, copyValue) {
  return `
    <div class="endpoint">
      <span class="ep-key">${key}</span>
      <span class="ep-val">${esc(value)}</span>
      ${copyValue ? `<button class="mini" data-act="copy" data-arg="${esc(copyValue)}" type="button" title="copy">${icon('copy', 'ic ic-sm')}</button>` : ''}
    </div>`;
}

function coreRow(name, core) {
  return `
    <div class="node-row" style="margin-top:6px">
      <span class="node-title"><b>${name}</b> ${coreBadge(core.status)}</span>
      <span class="mono" style="font-size:10.5px;opacity:.75">${core.status === 'running' ? fmtUptime(core.uptimeMs) : (core.lastError ? esc(core.lastError).slice(0, 42) : '—')}</span>
    </div>`;
}

/* ── Easy Setup (Quick Tune) ───────────────────────────────────────────── */

const EASY_CACHE = { data: null, at: 0 };

async function loadEasy(force = false) {
  if (!force && EASY_CACHE.data && Date.now() - EASY_CACHE.at < 15000) return EASY_CACHE.data;
  const data = await api('/api/easy-setup');
  EASY_CACHE.data = data;
  EASY_CACHE.at = Date.now();
  return data;
}

function easyBadge(kind) {
  const map = {
    good: { fa: 'مقاوم در برابر DPI', en: 'DPI HARDENED', cls: 'ok' },
    risky: { fa: 'حساس', en: 'SENSITIVE', cls: 'warn' },
    off: { fa: 'خاموش', en: 'OFF', cls: 'off' },
    edge: { fa: 'دامنهٔ HTTPS', en: 'HTTPS EDGE', cls: 'ok' },
    tcp: { fa: 'پورت TCP', en: 'TCP MUX', cls: 'ok' },
  };
  const item = map[kind] || map.risky;
  return `<span class="pill ${item.cls}">${t(item.fa, item.en)}</span>`;
}

function renderEasy() {
  const pane = $('#pane-easy');
  const data = EASY_CACHE.data;
  if (!data) {
    pane.innerHTML = `<div class="card"><p class="kicker">${icon('bolt')}${t('تحلیل هوشمند شبکه', 'NETWORK & DPI ANALYSIS')}</p>
      <p class="muted">${t('در حال تحلیل…', 'Analysing environment…')}</p></div>`;
    loadEasy(true).then(() => { if (S.tab === 'easy') renderEasy(); }).catch((err) => toast(err.message, 'warn'));
    return;
  }
  const a = data.analysis;
  const st = S.state;
  const users = Array.isArray(data.users) ? data.users : (st.users || []).map((u) => ({
    id: u.id, name: u.name, status: u.status, links: (u.links || []).length,
    subUrl: u.subUrl, portalUrl: u.portalUrl,
  }));
  const okCount = a.checks.filter((c) => c.ok).length;
  const verdict = okCount === a.checks.length
    ? t('تمام بررسی‌های شبکه و ضد فیلتر برقرار است.', 'All network & anti-censorship checks passed.')
    : t(`${a.checks.length - okCount} مورد قابل بهبود است.`, `${a.checks.length - okCount} item(s) can be tuned.`);

  pane.innerHTML = `
  <div class="cols">
    <div class="card easy-hero">
      <p class="kicker">${icon('bolt')}${t('تنظیم هوشمند ضد سانسور (BBG)', 'BBG ANTI-CENSORSHIP QUICK TUNE')}</p>
      <p class="lede">${t(
        'این بخش شرایط شبکه را بررسی می‌کند، پروتکل‌های مقاوم در برابر DPI (شامل REALITY، XHTTP با Padding تصادفی، 0-RTT WebSocket و AnyTLS) را فعال می‌سازد و همه را در یک اشتراک یکپارچه قرار می‌دهد.',
        'Analyses your deployment topology, activates DPI-resistant protocols (VLESS REALITY, XHTTP with randomized padding, 0-RTT WebSocket, and AnyTLS), and bundles them into a unified subscription.',
      )}</p>
      <div class="easy-stats">
        <div class="stat"><span class="tnum">${a.counts.enabled}</span><span>${t('پروتکل فعال', 'ENABLED')}</span></div>
        <div class="stat"><span class="tnum">${a.counts.tcp}</span><span>${t('روی پورت TCP', 'OVER TCP')}</span></div>
        <div class="stat"><span class="tnum">${a.counts.edge}</span><span>${t('از لبهٔ HTTPS', 'VIA HTTPS')}</span></div>
        <div class="stat"><span class="tnum">${a.counts.telegram}</span><span>${t('پروکسی تلگرام', 'TELEGRAM')}</span></div>
      </div>
      <p class="hint">${verdict}</p>
      <div class="profiles">
        ${a.profiles.map((p) => `
          <div class="profile ${(st.settings.easySetup || {}).profile === p.id ? 'current' : ''}">
            <div class="profile-head">
              <strong>${t(p.fa, p.en)}</strong>
              <span class="pill ok">${p.count} ${t('پروتکل', 'METHODS')}</span>
            </div>
            <p class="muted">${t(p.taglineFa, p.taglineEn)}</p>
            <ul class="ticks">
              ${(p.notesFa || []).map((n, i) => `<li>${t(esc(n), esc((p.notesEn || [])[i] || ''))}</li>`).join('')}
            </ul>
            <button class="btn sm-btn primary" data-act="easy-apply" data-arg="${p.id}" type="button">
              ${icon('check', 'ic ic-sm')}${t('اعمال پروفایل', 'APPLY PROFILE')}
            </button>
          </div>`).join('')}
      </div>
    </div>

    <div class="card">
      <p class="kicker">${icon('gauge')}${t('بررسی‌های زیرساخت', 'INFRASTRUCTURE CHECKS')}</p>
      <div class="stack-sm">
        ${a.checks.map((c) => `<div class="check ${c.ok ? 'ok' : 'warn'}">
          <span class="dot"></span><span>${t(esc(c.fa), esc(c.en))}</span></div>`).join('')}
      </div>
      <div class="dashed"></div>
      <table class="tbl">
        <thead><tr>
          <th>${t('پروتکل', 'PROTOCOL')}</th><th>${t('مسیر', 'ROUTE')}</th><th>${t('مقاومت DPI', 'RESILIENCE')}</th>
        </tr></thead>
        <tbody>
          ${a.rows.filter((r) => r.enabled).map((r) => `<tr>
            <td>${esc(r.label)}</td>
            <td>${easyBadge(r.via)}</td>
            <td>${easyBadge(r.iran)}</td>
          </tr>`).join('') || `<tr><td colspan="3" class="muted">${t('هیچ روشی فعال نیست', 'Nothing enabled')}</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>

  <div class="cols">
    <div class="card">
      <p class="kicker">${icon('send')}${t('لینک اشتراک کاربران', 'SUBSCRIBER UNIFIED LINKS')}</p>
      ${users.length ? users.map((u) => `
        <div class="row-line">
          <div>
            <strong>${esc(u.name)}</strong>
            <p class="muted tnum">${u.links} ${t('پروتکل فعال در یک اشتراک', 'active transports in one URL')}</p>
          </div>
          <div class="actions" style="margin-top:0">
            <button class="btn sm-btn primary" data-act="copy" data-arg="${esc(u.subUrl)}" type="button">${icon('copy', 'ic ic-sm')}${t('کپی اشتراک', 'COPY SUB')}</button>
            <button class="btn sm-btn ghost" data-act="open" data-arg="${esc(u.portalUrl)}" type="button">${icon('globe', 'ic ic-sm')}${t('پورتال', 'PORTAL')}</button>
          </div>
        </div>
        <code class="uri">${esc(u.subUrl)}</code>`).join('')
        : `<p class="muted">${t('ابتدا یک مشترک بسازید.', 'Create a subscriber first.')}</p>`}
      <div class="actions">
        <button class="btn sm-btn ghost" data-act="easy-refresh" type="button">${icon('refresh', 'ic ic-sm')}${t('تحلیل دوباره', 'RE-ANALYSE')}</button>
        <button class="btn sm-btn ghost" data-act="tab" data-arg="delivery" type="button">${icon('qr', 'ic ic-sm')}${t('همهٔ فرمت‌ها', 'ALL FORMATS')}</button>
      </div>
    </div>

    <div class="card">
      <p class="kicker">${icon('shield')}${t('توصیه‌های فنی ضد فیلتر', 'DPI CIRCUMVENTION NOTES')}</p>
      <ol class="tips">
        ${a.tips.map((tip) => `<li>${t(esc(tip.fa), esc(tip.en))}</li>`).join('')}
      </ol>
    </div>
  </div>`;
}

/* ── BBG EdgeScan · Clean IP Scanner ───────────────────────────────────── */

const RAILYNX = { data: null, timer: null, link: '' };

async function railynxPoll() {
  try {
    RAILYNX.data = await api('/api/railynx');
    renderRailynx();
    if (!RAILYNX.data.running) stopRailynxPolling();
  } catch {
    stopRailynxPolling();
  }
}

function startRailynxPolling() {
  if (RAILYNX.timer) return;
  RAILYNX.timer = setInterval(railynxPoll, 1200);
}

function stopRailynxPolling() {
  if (RAILYNX.timer) clearInterval(RAILYNX.timer);
  RAILYNX.timer = null;
}

function railynxVlessChoices() {
  const out = [];
  for (const user of (S.state.users || [])) {
    for (const link of (user.links || [])) {
      if (link.protocol === 'vless' && (link.transport === 'ws' || link.transport === 'httpupgrade' || link.transport === 'xhttp')) {
        out.push({ label: `${user.name} · ${link.label.split('·').slice(-1)[0].trim()}`, uri: link.uri });
      }
    }
  }
  return out;
}

function renderRailynx() {
  const pane = $('#pane-railynx');
  if (!pane) return;
  const d = RAILYNX.data || { running: false, total: 0, checked: 0, alive: 0, failed: 0, results: [], recent: [], cidr: '', concurrency: 16 };
  const choices = railynxVlessChoices();
  const pct = d.total ? Math.round((d.checked / d.total) * 100) : 0;
  const elapsed = d.startedAt ? Math.max(0, ((d.finishedAt || Date.now()) - d.startedAt) / 1000) : 0;
  const defaults = d.defaults || { cidr: '104.16.0.0/24', concurrency: 16 };

  pane.innerHTML = `
  <div class="cols">
    <div class="card">
      <p class="kicker">${icon('radar')}${t('BBG EdgeScan · اسکنر آی‌پی تمیز لبه', 'BBG EDGESCAN · CLEAN EDGE IP SCANNER')}</p>
      <p class="lede">${t(
        'یک لینک VLESS دریافت می‌کند، رنج CIDR انتخابی را با ۳ پروب متوالی بررسی کرده و آی‌پی‌های تمیز را بر اساس کمترین تأخیر (Latency) و کمترین Jitter مرتب می‌سازد.',
        'Takes a VLESS link, sweeps a target CIDR block with 3 consecutive probes per host, and ranks clean edge IPs by lowest RTT latency and jitter.',
      )}</p>

      <label class="fld-label">${t('انتخاب لینک VLESS', 'SELECT VLESS LINK')}</label>
      ${choices.length ? `<select id="rl-pick" class="rl-select">
          <option value="">${t('— انتخاب از لینک‌های مشترکین —', '— Pick from subscriber links —')}</option>
          ${choices.map((c) => `<option value="${esc(c.uri)}">${esc(c.label)}</option>`).join('')}
        </select>` : ''}
      <textarea id="rl-link" class="raw-box rl-link" spellcheck="false" dir="ltr" placeholder="vless://uuid@host:443?security=tls&type=ws&host=...&path=/...">${esc(RAILYNX.link)}</textarea>

      <div class="field-grid" style="margin-top:10px">
        <div>
          <label class="fld-label">${t('رنج اسکن (CIDR)', 'SCAN RANGE (CIDR)')}</label>
          <input type="text" id="rl-cidr" dir="ltr" value="${esc(d.cidr || defaults.cidr)}" placeholder="${esc(defaults.cidr)}">
        </div>
        <div>
          <label class="fld-label">${t('ورکر هم‌زمان', 'CONCURRENT WORKERS')}</label>
          <input type="number" id="rl-workers" min="1" max="32" value="${esc(d.concurrency || defaults.concurrency)}">
        </div>
      </div>
      ${d.mode ? `<p class="muted" style="margin-top:8px">${t('حالت پروب:', 'Probe Mode:')} <b class="mono">${esc(d.mode === 'full' ? 'FULL · TLS + WS + VLESS + 204' : 'LOW-LATENCY TLS HANDSHAKE')}</b></p>` : ''}

      <div class="actions">
        <button class="btn primary" data-act="rl-start" type="button" ${d.running ? 'disabled' : ''}>
          ${icon('radar', 'ic ic-sm')}${t('شروع اسکن', 'START SCAN')}</button>
        <button class="btn ghost" data-act="rl-cancel" type="button" ${d.running ? '' : 'disabled'}>
          ${icon('ban', 'ic ic-sm')}${t('توقف اسکن', 'STOP SCAN')}</button>
      </div>

      ${d.running ? `<div class="rl-progress">
        <div class="rl-bar"><span style="width:${pct}%"></span></div>
        <p class="muted tnum" style="margin-top:6px">${d.checked} / ${d.total} (${pct}%) · ${t('سالم', 'clean')}: ${d.alive} · ${elapsed.toFixed(0)}s</p>
      </div>` : d.checked ? `<p class="muted tnum" style="margin-top:8px">${t('آخرین اسکن', 'LAST SCAN')}: ${d.checked} IPs · ${d.alive} ${t('سالم', 'clean')} · ${d.cidr}</p>` : ''}
    </div>

    <div class="card">
      <p class="kicker">${icon('check')}${t('آی‌پی‌های تمیز یافت‌شده', 'VERIFIED CLEAN EDGE IPS')}</p>
      ${d.results.length ? `
        <table class="tbl">
          <thead><tr>
            <th>${t('تأخیر', 'LATENCY')}</th><th>IP</th><th></th>
          </tr></thead>
          <tbody>
            ${d.results.map((r) => `<tr>
              <td class="mono tnum">${r.latency} ms</td>
              <td class="mono" dir="ltr">${esc(r.ip)}</td>
              <td><button class="mini" data-act="copy" data-arg="${esc(r.link)}" type="button" title="copy">${icon('copy', 'ic ic-sm')}</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="actions">
          <button class="btn sm-btn primary" data-act="copy" data-arg="${esc(d.results[0].link)}" type="button">
            ${icon('copy', 'ic ic-sm')}${t('کپی کم‌تأخیرترین لینک', 'COPY FASTEST LINK')}</button>
          <button class="btn sm-btn ghost" data-act="copy" data-arg="${esc(d.results.map((r) => r.link).join('\n'))}" type="button">
            ${icon('file', 'ic ic-sm')}${t('کپی همه', 'COPY ALL')}</button>
        </div>`
        : `<p class="muted">${t('هنوز آی‌پی تمیزی ثبت نشده است. اسکن را آغاز کنید.', 'No clean addresses recorded yet. Start a scan to populate results.')}</p>`}
      <div class="dashed"></div>
      <p class="kicker">${icon('trace-dash')}${t('آخرین پروب‌ها', 'RECENT PROBES')}</p>
      <div class="rl-recent">
        ${(d.recent || []).slice(0, 12).map((r) => `<span class="chip ${r.ok ? 'ok' : ''}" dir="ltr">${esc(r.ip)}${r.ok ? ` · ${r.latency}ms` : ` · ${esc(r.reason || 'fail')}`}</span>`).join('')
          || `<span class="muted">—</span>`}
      </div>
    </div>
  </div>`;
}

/* ── Inbounds (Hardened Protocols) ─────────────────────────────────────── */

function inboundIcon(ib) {
  if (ib.protocol === 'shadowsocks') return 'shield';
  if (ib.protocol === 'anytls' || ib.protocol === 'shadowtls') return 'lock';
  if (ib.protocol === 'hysteria2') return 'bolt';
  return 'link';
}

function renderInbounds() {
  const st = S.state;
  const q = S.searchQuery.trim().toLowerCase();
  const list = st.inbounds.filter((ib) => {
    if (!q) return true;
    return (
      ib.protocol.toLowerCase().includes(q) ||
      ib.transport.toLowerCase().includes(q) ||
      (ib.title.en || '').toLowerCase().includes(q) ||
      (ib.title.fa || '').includes(q) ||
      (ib.routeKey || '').toLowerCase().includes(q)
    );
  });

  const cards = list.map((ib) => {
    const editing = S.editing === ib.id;
    const badgeCore = ib.core === 'xray' ? 'xray' : 'singbox';
    const reach = !ib.reachable
      ? `<span class="chip warn">${t('نیازمند UDP/TCP', 'NEEDS PORT')}</span>`
      : `<span class="chip ok">${t('تأییدشده', 'HARDENED')}</span>`;
    return `
      <div class="proto-card ${ib.enabled ? '' : 'is-off'}">
        <div class="proto-head">
          <div class="proto-name">${icon(inboundIcon(ib), 'ic')}${t(esc(ib.title.fa), esc(ib.title.en))}</div>
          <label class="tgl">
            <input type="checkbox" data-act="toggle-inbound" data-arg="${ib.id}" ${ib.enabled ? 'checked' : ''}>
            <span class="track"></span>
          </label>
        </div>
        <div class="chips">
          <span class="chip ${badgeCore}">${ib.core}</span>
          <span class="chip">${esc(ib.protocol)}</span>
          <span class="chip">${esc(ib.transport)}</span>
          <span class="chip">${ib.edge === 'http' ? 'HTTPS' : 'TCP'}</span>
          ${ib.security !== 'none' ? `<span class="chip">${esc(ib.security)}</span>` : ''}
          ${reach}
        </div>
        <div class="proto-meta">
          <span>${ib.edge === 'http' ? 'path' : 'listen'} : <b>${esc(ib.edge === 'http' ? '/\u200e' + ib.routeKey : '127.0.0.1:' + ib.port)}</b></span>
          ${ib.params.sni ? `<span>sni : <b>${esc(ib.params.sni)}</b></span>` : ''}
          ${ib.params.dest ? `<span>reality dest : <b>${esc(ib.params.dest)}</b></span>` : ''}
          ${ib.params.method ? `<span>cipher : <b>${esc(ib.params.method)}</b></span>` : ''}
        </div>
        ${ib.reason ? `<div class="note-inline">${t(esc(ib.reason.fa), esc(ib.reason.en))}</div>` : ''}
        ${editing ? renderInboundEditor(ib) : ''}
        <div class="proto-acts">
          <button class="btn sm-btn ghost" data-act="edit-inbound" data-arg="${ib.id}" type="button">${icon('edit', 'ic ic-sm')}${t('تنظیمات', 'EDIT')}</button>
          ${ib.edge === 'http' && ib.enabled ? `<button class="btn sm-btn ghost" data-act="copy" data-arg="${esc(`${st.facts.panelUrl}/${ib.routeKey}`)}" type="button">${icon('copy', 'ic ic-sm')}${t('مسیر', 'PATH')}</button>` : ''}
          <button class="btn sm-btn danger" data-act="del-inbound" data-arg="${ib.id}" type="button">${icon('trash', 'ic ic-sm')}</button>
        </div>
      </div>`;
  }).join('');

  const groups = [
    { core: 'xray', title: t('هستهٔ Xray (استاندارد ضد فیلتر)', 'XRAY-CORE HARDENED PRESETS') },
    { core: 'singbox', title: t('هستهٔ sing-box 1.12+', 'SING-BOX 1.12+ HARDENED PRESETS') },
  ];

  const directory = groups.map((group) => `
    <div class="preset-group">
      <h3>${icon(group.core === 'xray' ? 'xray' : 'singbox', 'ic ic-sm')}${group.title}</h3>
      <div class="preset-list">
        ${st.presets.filter((p) => p.core === group.core).map((p) => {
          const installed = st.inbounds.filter((i) => i.presetId === p.id).length;
          return `
            <div class="preset-row">
              <div class="pr-main">
                <div class="pr-title">
                  ${t(esc(p.title.fa), esc(p.title.en))}
                  <span class="chip">${esc(p.transport)}</span>
                  <span class="chip">${p.edge === 'http' ? 'HTTPS' : 'TCP'}</span>
                  ${p.udp ? `<span class="chip warn">UDP</span>` : ''}
                  ${p.featured ? `<span class="chip ok">${t('پیشنهادی', 'RECOMMENDED')}</span>` : ''}
                </div>
                <div class="pr-desc">${t(esc(p.desc.fa), esc(p.desc.en))}</div>
                ${p.note ? `<div class="note-inline">${t(esc(p.note.fa), esc(p.note.en))}</div>` : ''}
              </div>
              <button class="btn sm-btn ${installed ? 'ghost' : 'primary'}" data-act="add-inbound" data-arg="${p.id}" type="button">
                ${icon('plus', 'ic ic-sm')}${installed ? t('افزودن مجدد', 'ADD INSTANCE') : t('افزودن', 'ADD')}
                ${installed ? `<span class="chip">${installed}</span>` : ''}
              </button>
            </div>`;
        }).join('')}
      </div>
    </div>`).join('');

  $('#pane-inbounds').innerHTML = `
    <div class="spread">
      <p class="kicker" style="margin:0">${icon('layers')}${t('پروتکل‌های نصب‌شده', 'INSTALLED HARDENED INBOUNDS')}</p>
      <span class="mono" style="font-size:11px;opacity:.75">${st.inbounds.length} TOTAL · ${st.inbounds.filter((i) => i.enabled).length} ACTIVE</span>
    </div>
    <div class="proto-grid">${cards || `<p class="muted">${t('موردی یافت نشد.', 'No matching inbounds.')}</p>`}</div>

    <div class="cols" style="margin-top:18px">
      <div class="card card-subtle">
        <p class="kicker">${icon('plus')}${t('کاتالوگ پروتکل‌های مقاوم BBG', 'BBG HARDENED PROTOCOL CATALOG')}</p>
        <p class="hint" style="margin-top:0">
          ${t('تمامی پروتکل‌های ناامن و قدیمی حذف شده‌اند. هر ردیف با تنظیمات ضد DPI، اثرانگشت uTLS Chrome و قطعه‌بندی TLS پیکربندی شده است.', 'Obsolete and easily fingerprinted protocols have been pruned. Every preset below is hardened with uTLS Chrome fingerprinting, 0-RTT early data, or randomized padding.')}
        </p>
        ${directory}
      </div>
      <div class="card">
        <p class="kicker">${icon('plug')}${t('جدول مسیریابی لبه و مالتی‌پلکسر', 'EDGE & SNI MULTIPLEXER ROUTING TABLE')}</p>
        <table class="tbl">
          <thead><tr><th>${t('لایه', 'LAYER')}</th><th>${t('ورودی', 'ENTRY')}</th><th>${t('مقصد داخلی', 'TARGET')}</th></tr></thead>
          <tbody>
            <tr><td>HTTPS Edge</td><td class="mono">:443</td><td class="mono">${esc(st.facts.publicHost || '—')}</td></tr>
            ${st.inbounds.filter((i) => i.edge === 'http' && i.enabled).map((ib) => `
              <tr><td>${esc(ib.transport.toUpperCase())}</td><td class="mono">/${esc(ib.routeKey)}</td><td class="mono">127.0.0.1:${ib.port}</td></tr>`).join('')}
            <tr><td>TCP Mux</td><td class="mono">:${st.facts.tcpPort || st.facts.muxPort}</td><td class="mono">SNI Router :${st.facts.muxPort}</td></tr>
            ${Object.entries(st.plan.sniMap || {}).map(([sni, target]) => `
              <tr><td>TLS SNI</td><td class="mono">${esc(sni)}</td><td class="mono">127.0.0.1:${target.port}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderInboundEditor(ib) {
  const fields = ib.fields || [];
  if (!fields.length) {
    return `<p class="hint">${t('این پروتکل پارامتر قابل تنظیمی ندارد.', 'This protocol has no tunable parameters.')}</p>`;
  }
  return `
    <div class="stack-sm" style="border-top:1px solid var(--line);padding-top:10px;margin-top:4px">
      ${fields.map((field) => {
        const value = ib.params[field.key] ?? '';
        const label = `<label class="fld-label">${t(esc(field.label.fa), esc(field.label.en))}</label>`;
        if (field.type === 'select') {
          return `<div>${label}<select data-param="${field.key}" data-id="${ib.id}">
            ${field.options.map((opt) => `<option value="${esc(opt)}" ${String(value) === String(opt) ? 'selected' : ''}>${esc(opt || '—')}</option>`).join('')}
          </select></div>`;
        }
        const type = field.type === 'number' ? 'number' : 'text';
        return `<div>${label}<input type="${type}" class="${field.mono ? '' : 'fa-inp'}" data-param="${field.key}" data-id="${ib.id}" value="${esc(value)}"></div>`;
      }).join('')}
      <div class="row">
        <button class="btn sm-btn primary" data-act="save-inbound" data-arg="${ib.id}" type="button">${icon('save', 'ic ic-sm')}${t('ذخیره', 'SAVE')}</button>
        <button class="btn sm-btn ghost" data-act="edit-inbound" data-arg="${ib.id}" type="button">${t('بستن', 'CLOSE')}</button>
      </div>
    </div>`;
}

/* ── Subscribers (Users) ───────────────────────────────────────────────── */

function userStatusBadge(user) {
  const map = {
    active: ['ok', t('فعال', 'ACTIVE')],
    disabled: ['bad', t('غیرفعال', 'DISABLED')],
    expired: ['bad', t('منقضی', 'EXPIRED')],
    quota: ['bad', t('اتمام حجم', 'QUOTA')],
  };
  const [cls, label] = map[user.status] || ['bad', esc(user.status)];
  return `<span class="badge ${cls}">${label}</span>`;
}

function renderUsers() {
  const st = S.state;
  const q = S.searchQuery.trim().toLowerCase();
  const filtered = st.users.filter((u) => {
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q) || (u.note || '').toLowerCase().includes(q);
  });

  const cards = filtered.map((user) => {
    const quota = user.quotaBytes || 0;
    const percent = quota ? Math.min(100, Math.round((user.usage.total / quota) * 100)) : 0;
    return `
      <div class="user-card">
        <div class="user-head">
          <span class="user-name">${icon('users', 'ic')}${esc(user.name)} ${userStatusBadge(user)}</span>
          <span class="mono" style="font-size:11px;opacity:.75">${esc(user.id)} · ${user.links.length} ${t('لینک', 'LINKS')}</span>
        </div>
        <div class="user-meta">
          <div><span>${t('مصرف', 'USAGE')}</span><b>${fmtBytes(user.usage.total)}</b></div>
          <div><span>${t('سهمیه', 'QUOTA')}</span><b>${quota ? fmtBytes(quota) : '∞'}</b></div>
          <div><span>${t('انقضا', 'EXPIRES')}</span><b>${fmtDate(user.expiresAt)}</b></div>
          <div><span>${t('آخرین فعالیت', 'LAST SEEN')}</span><b>${user.lastSeen ? relTime(user.lastSeen) : '—'}</b></div>
        </div>
        ${quota ? `<div class="meter ${percent > 85 ? 'warn' : ''}"><i style="width:${percent}%"></i></div>` : ''}
        <div class="actions" style="margin-top:4px">
          <button class="btn sm-btn primary" data-act="show-links" data-arg="${user.id}" type="button">${icon('link', 'ic ic-sm')}${t('لینک‌ها و QR', 'LINKS & QR')}</button>
          <button class="btn sm-btn ghost" data-act="toggle-user" data-arg="${user.id}" data-value="${user.enabled ? '0' : '1'}" type="button">
            ${icon(user.enabled ? 'ban' : 'check', 'ic ic-sm')}${user.enabled ? t('غیرفعال', 'DISABLE') : t('فعال', 'ENABLE')}
          </button>
          <button class="btn sm-btn ghost" data-act="reset-user" data-arg="${user.id}" type="button">${icon('refresh', 'ic ic-sm')}${t('صفر کردن مصرف', 'RESET USAGE')}</button>
          <button class="btn sm-btn ghost" data-act="rotate-user" data-arg="${user.id}" type="button">${icon('key', 'ic ic-sm')}${t('تعویض کلید', 'ROTATE KEYS')}</button>
          <button class="btn sm-btn danger" data-act="del-user" data-arg="${user.id}" type="button">${icon('trash', 'ic ic-sm')}</button>
        </div>
      </div>`;
  }).join('');

  $('#pane-users').innerHTML = `
    <div class="stack">
      <div class="card">
        <p class="kicker">${icon('plus')}${t('ایجاد مشترک جدید', 'CREATE NEW SUBSCRIBER')}</p>
        <div class="field-grid">
          <div><label class="fld-label">${t('نام مشترک', 'NAME')}</label><input type="text" class="fa-inp" id="nu-name" placeholder="client-01"></div>
          <div><label class="fld-label">${t('سهمیه حجم (GB)', 'QUOTA (GB)')}</label><input type="number" id="nu-quota" min="0" step="1" placeholder="0 = ∞"></div>
          <div><label class="fld-label">${t('اعتبار (روز)', 'VALIDITY (DAYS)')}</label><input type="number" id="nu-days" min="0" step="1" placeholder="0 = ∞"></div>
          <div><label class="fld-label">${t('محدودیت IP', 'IP LIMIT')}</label><input type="number" id="nu-ip" min="0" step="1" placeholder="0 = ∞"></div>
          <div class="field-full"><label class="fld-label">${t('یادداشت', 'NOTE')}</label><input type="text" class="fa-inp" id="nu-note"></div>
        </div>
        <div class="actions">
          <button class="btn primary" data-act="create-user" type="button">${icon('plus', 'ic ic-sm')}${t('ساخت مشترک', 'CREATE SUBSCRIBER')}</button>
        </div>
        <p class="hint">${t('هر مشترک به‌طور خودکار با کلیدهای اختصاصی (UUID، رمز Trojan/AnyTLS و کلیدهای 2022-blake3) روی تمام پروتکل‌های فعال تعریف می‌شود.', 'Each subscriber is automatically provisioned with dedicated credentials (UUID, Trojan/AnyTLS password, and 2022-blake3 key) across all active inbounds.')}</p>
      </div>
    </div>
    <div class="user-list">${cards || `<p class="hint">${t('مشترکی یافت نشد.', 'No subscribers found.')}</p>`}</div>`;
}

const LINK_ORDER = ['vless:reality', 'vless:xhttp', 'vless:ws', 'vless:httpupgrade', 'trojan:ws', 'vless:grpc', 'trojan:tcp', 'anytls', 'shadowtls', 'shadowsocks', 'hysteria2'];
function linkRank(link) {
  const key = `${link.protocol}:${link.transport}`;
  const exact = LINK_ORDER.indexOf(key);
  if (exact >= 0) return exact;
  const loose = LINK_ORDER.findIndex((k) => !k.includes(':') && link.protocol === k);
  return loose >= 0 ? loose + 100 : 900;
}
function sortedLinks(user) {
  return [...(user.links || [])].sort((a, b) => linkRank(a) - linkRank(b));
}

const LINK_PING = new Map();

function pingChip(link) {
  const r = LINK_PING.get(link.label);
  if (!r) return '';
  if (!r.ok) return `<span class="ping bad" dir="ltr" title="${esc(r.error || 'fail')}">${t('قطع', 'fail')}</span>`;
  return `<span class="ping ok" dir="ltr">${r.ms} ms</span>`;
}

function showUserLinks(userId) {
  const st = S.state;
  const user = st.users.find((u) => u.id === userId);
  if (!user) return;
  const body = `
    ${user.subUrl ? `
      <div class="endpoint">
        <span class="ep-key">SUB URL</span>
        <span class="ep-val">${esc(user.subUrl)}</span>
        <button class="mini" data-act="copy" data-arg="${esc(user.subUrl)}" type="button">${icon('copy', 'ic ic-sm')}</button>
      </div>` : ''}
    <div class="grid-2" style="margin-top:12px">
      <div class="qr-center">
        <div class="qrbox qr"><div id="modal-qr"></div></div>
        <p class="mono" style="font-size:10.5px;margin-top:6px">${esc(user.name)} · ${user.links.length} LINKS</p>
      </div>
      <div class="stack-sm">
        <p class="hint" style="margin:0">${t('خروجی‌های استاندارد اشتراک:', 'Hardened Subscription Schemas:')}</p>
        ${['links', 'base64', 'xray', 'singbox', 'clash'].map((fmt) => `
          <a class="btn sm-btn ghost" href="${esc(user.subUrl)}/${fmt}" target="_blank" rel="noopener" download>
            ${icon('download', 'ic ic-sm')}<span class="mono">${fmt.toUpperCase()}</span>
          </a>`).join('')}
        ${user.portalUrl ? `<a class="btn sm-btn primary" href="${esc(user.portalUrl)}" target="_blank" rel="noopener">${icon('external', 'ic ic-sm')}${t('پورتال مشترک', 'SUBSCRIBER PORTAL')}</a>` : ''}
      </div>
    </div>
    <div class="dashed"></div>
    <div class="spread" style="align-items:center;margin-bottom:6px">
      <p class="kicker" style="margin:0">${icon('link')}${t('لینک‌های مستقیم هر پروتکل', 'DIRECT PROTOCOL LINKS')}</p>
      <div class="row">
        <button class="mini" data-act="ping-links" data-arg="${esc(user.id)}" type="button">${icon('radar', 'ic ic-sm')} ${t('تست پینگ', 'PING')}</button>
        <button class="mini" data-act="copy" data-arg="${esc(sortedLinks(user).map((l) => l.uri).join('\n'))}" type="button" title="copy all">${icon('file', 'ic ic-sm')}</button>
      </div>
    </div>
    <div class="user-links" style="max-height:280px;overflow:auto">
      ${sortedLinks(user).map((link) => `
        <div class="link-row">
          <span class="lk-name">${esc(link.short || `${link.protocol.toUpperCase()} · ${link.transport}`)}</span>
          <span class="lk-uri" dir="ltr">${esc(link.uri)}</span>
          ${pingChip(link)}
          <button class="mini" data-act="copy" data-arg="${esc(link.uri)}" type="button" title="copy">${icon('copy', 'ic ic-sm')}</button>
          <button class="mini" data-act="qr" data-arg="${esc(link.uri)}" type="button" title="qr">${icon('qr', 'ic ic-sm')}</button>
        </div>`).join('')}
    </div>`;
  openModal(`${esc(user.name)} — ${user.links.length} ${t('پروتکل', 'TRANSPORTS')}`, body, true);
  qrInto($('#modal-qr'), user.subUrl || (user.links[0] && user.links[0].uri) || '');
}

/* ── Delivery (Subscriptions) ──────────────────────────────────────────── */

const CLIENTS = [
  { name: 'v2rayNG', file: 'v2rayng.png', url: 'https://github.com/2dust/v2rayNG/releases', os: 'Android' },
  { name: 'Hiddify', file: 'hiddify.svg', url: 'https://github.com/hiddify/hiddify-app/releases', os: 'Android · iOS · Desktop' },
  { name: 'sing-box', file: 'sing-box.svg', url: 'https://github.com/SagerNet/sing-box/releases', os: 'iOS · Android · Desktop' },
  { name: 'Clash Verge', file: 'clash-verge.svg', url: 'https://github.com/clash-verge-rev/clash-verge-rev/releases', os: 'Windows · macOS · Linux' },
  { name: 'Karing', file: 'karing.png', url: 'https://github.com/KaringX/karing/releases', os: 'iOS · Android · Desktop' },
  { name: 'v2rayN', file: 'v2rayn.png', url: 'https://github.com/2dust/v2rayN/releases', os: 'Windows · macOS' },
];

function renderDelivery() {
  const st = S.state;
  const rows = st.users.map((user) => `
    <tr>
      <td><b>${esc(user.name)}</b><br><span class="mono muted" style="font-size:10px">${esc(user.id)}</span></td>
      <td class="mono" style="font-size:10.5px;max-width:250px;overflow-wrap:anywhere">${esc(user.subUrl || '—')}</td>
      <td class="mono">${user.links.length}</td>
      <td>
        <div class="row">
          <button class="mini" data-act="copy" data-arg="${esc(user.subUrl)}" type="button">${icon('copy', 'ic ic-sm')}</button>
          <button class="mini" data-act="qr" data-arg="${esc(user.subUrl)}" type="button">${icon('qr', 'ic ic-sm')}</button>
          <button class="mini" data-act="show-links" data-arg="${user.id}" type="button">${icon('link', 'ic ic-sm')}</button>
        </div>
      </td>
      <td>
        <div class="pill-group">
          ${['links', 'xray', 'singbox', 'clash'].map((fmt) => `<a class="pill" href="${esc(user.subUrl)}/${fmt}" target="_blank" rel="noopener">${fmt}</a>`).join('')}
        </div>
      </td>
    </tr>`).join('');

  $('#pane-delivery').innerHTML = `
    <div class="cols">
      <div class="card">
        <p class="kicker">${icon('send')}${t('موتور تولید اشتراک BBG', 'BBG SUBSCRIPTION ENGINE')}</p>
        <p class="labor">${t(
          'هر مشترک یک توکن امضاشده با HMAC-SHA256 دارد که ۵ خروجی استاندارد و مقاوم‌شده (شامل sing-box 1.12+ با قطعه‌بندی رکورد TLS، Xray با dialerProxy fragment و Mihomo/Clash با انتخابگر خودکار کمترین پینگ) تولید می‌کند.',
          'Each subscriber receives an HMAC-SHA256 signed subscription endpoint serving 5 hardened schemas (including sing-box 1.12+ with TLS record fragmentation, Xray with dialerProxy TLS fragmentation, and Clash/Mihomo with url-test auto-failover).',
        )}</p>
        <table class="tbl">
          <thead><tr><th>${t('فرمت', 'SCHEMA')}</th><th>${t('ویژگی‌ها', 'HARDENING')}</th><th>PATH</th></tr></thead>
          <tbody>
            <tr><td class="mono">singbox</td><td>${t('sing-box 1.12+ · TLS Fragment · Tunnel DoH', 'sing-box 1.12+ · TLS Fragment · Tunnel DoH')}</td><td class="mono">/sub/:token/singbox</td></tr>
            <tr><td class="mono">xray</td><td>${t('Xray JSON · Fragment Dialer · Telegram Direct CIDR', 'Xray JSON · Fragment Dialer · Telegram CIDR')}</td><td class="mono">/sub/:token/xray</td></tr>
            <tr><td class="mono">clash</td><td>${t('Mihomo YAML · Auto URL-Test · uTLS Chrome', 'Mihomo YAML · Auto URL-Test · uTLS Chrome')}</td><td class="mono">/sub/:token/clash</td></tr>
            <tr><td class="mono">base64</td><td>${t('سازگار با v2rayNG / v2rayN / Streisand', 'v2rayNG / v2rayN / Streisand compatible')}</td><td class="mono">/sub/:token</td></tr>
            <tr><td class="mono">links</td><td>${t('لیست متنی URI با پارامترهای 0-RTT', 'Plain URI list with 0-RTT early data')}</td><td class="mono">/sub/:token/links</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card card-subtle">
        <p class="kicker">${icon('download')}${t('کلاینت‌های پیشنهادی', 'RECOMMENDED CLIENTS')}</p>
        <div class="client-os-grid">
          ${CLIENTS.map((c) => `
            <a class="client-link" href="${c.url}" target="_blank" rel="noopener">
              <img class="client-logo" src="/assets/${c.file}" alt="${c.name}">
              <span>${c.name}<br><small class="muted" style="font-size:10px">${c.os}</small></span>
              ${icon('external', 'ic ic-sm')}
            </a>`).join('')}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <p class="kicker">${icon('users')}${t('جدول اشتراک مشترکین', 'SUBSCRIBER ENDPOINTS')}</p>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr>
            <th>${t('مشترک', 'SUBSCRIBER')}</th><th>${t('آدرس اشتراک', 'SUBSCRIPTION URL')}</th>
            <th>${t('پروتکل‌ها', 'LINKS')}</th><th>QR</th><th>${t('فرمت‌ها', 'SCHEMAS')}</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="muted">${t('مشترکی وجود ندارد', 'No subscribers')}</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
}

/* ── Telegram Multiplexer ──────────────────────────────────────────────── */

function renderTelegram() {
  const st = S.state;
  const tg = st.telegram;
  const mux = st.cores.mux;
  const ready = st.facts.tcpReady;

  const qrBlock = (text) => text
    ? `<div class="qr-center qr-inline"><div class="qrbox qr"><div data-qr="${esc(text)}"></div></div></div>`
    : `<p class="note-inline">${t('ابتدا پورت TCP عمومی را در متغیرهای سرویس تنظیم کنید.', 'Configure the public TCP port first.')}</p>`;

  $('#pane-telegram').innerHTML = `
    <div class="card">
      <p class="kicker">${icon('plug')}${t('مالتی‌پلکسر هوشمند تک‌پورت (SNI + Handshake Router)', 'SINGLE-PORT PROTOCOL MULTIPLEXER')}</p>
      <p class="labor">${t(
        'مالتی‌پلکسر BBG با بازسازی چندرکوردی TLS ClientHello و رمزگشایی هدر Obfuscated2، ترافیک REALITY، TLS، MTProto FakeTLS، SOCKS5 و HTTP CONNECT را بدون تأخیر Nagle روی یک پورت واحد تفکیک می‌کند.',
        'The BBG single-port multiplexer reassembles multi-record TLS ClientHello frames and inspects Obfuscated2 headers to route REALITY, TLS, MTProto FakeTLS, SOCKS5, and HTTP CONNECT on a single TCP port with TCP_NODELAY enabled.',
      )}</p>
      <div class="kpi-grid">
        ${[
          ['TLS / REALITY', mux.tls, 'shield'],
          ['SOCKS5', mux.socks, 'plug'],
          ['HTTP CONNECT', (st.cores.http && st.cores.http.conns) || 0, 'http'],
          ['MTPROTO', mux.mtproto, 'telegram'],
        ].map(([label, value, ic]) => `
          <div class="kpi"><p class="lbl">${icon(ic, 'ic ic-sm')}${label}</p><span class="val">${value || 0}</span>
          <span class="sub">sessions</span></div>`).join('')}
      </div>
      <div class="endpoint" style="margin-top:12px">
        <span class="ep-key">${t('پورت ورودی', 'MUX PORT')}</span>
        <span class="ep-val">${ready ? esc(`${st.facts.tcpHost}:${st.facts.tcpPort}`) : `127.0.0.1:${st.facts.muxPort}`}</span>
        ${ready ? `<button class="mini" data-act="copy" data-arg="${esc(`${st.facts.tcpHost}:${st.facts.tcpPort}`)}" type="button">${icon('copy', 'ic ic-sm')}</button>` : ''}
      </div>
    </div>

    <div class="cols" style="margin-top:16px">
      <div class="card">
        <p class="kicker">${icon('telegram')}${t('پروکسی MTProto با FakeTLS v2', 'MTPROTO PROXY (FAKETLS V2)')}</p>
        <div class="spread">
          <label class="tgl">
            <input type="checkbox" data-act="toggle-mtproto" ${tg.mtproto.enabled ? 'checked' : ''}>
            <span class="track"></span>
            <span>${t('فعال', 'ENABLED')}</span>
          </label>
          ${coreBadge(tg.mtproto.state.status)}
        </div>
        <div class="field-grid" style="margin-top:10px">
          <div>
            <label class="fld-label">${t('دامنهٔ FakeTLS', 'FAKETLS SNI DOMAIN')}</label>
            <input type="text" id="tg-faketls" value="${esc(tg.mtproto.faketlsHost)}" placeholder="www.microsoft.com">
          </div>
          <div>
            <label class="fld-label">${t('تگ تبلیغاتی (اختیاری)', 'AD TAG (OPTIONAL)')}</label>
            <input type="text" id="tg-adtag" value="${esc(tg.mtproto.adTag || '')}" placeholder="—">
          </div>
        </div>
        <div class="actions">
          <button class="btn sm-btn primary" data-act="save-mtproto" type="button">${icon('save', 'ic ic-sm')}${t('ذخیره و اجرا', 'SAVE & RUN')}</button>
          <button class="btn sm-btn ghost" data-act="regen-secret" type="button">${icon('refresh', 'ic ic-sm')}${t('تولید سکرت جدید', 'ROTATE SECRET')}</button>
          <button class="btn sm-btn ghost" data-act="restart-core" data-arg="mtproto" type="button">${icon('power', 'ic ic-sm')}${t('ری‌استارت', 'RESTART')}</button>
        </div>
        ${tg.mtproto.conflict ? `<div class="note-inline">${t('دامنهٔ FakeTLS با SNI یکی از اینباندهای REALITY/TLS تداخل دارد. یکی از دو دامنه را تغییر دهید.', 'This FakeTLS domain collides with an active REALITY/TLS inbound SNI. Change one of the domains.')}</div>` : ''}
        <div class="dashed"></div>
        <label class="fld-label">EE-SECRET</label>
        <div class="code-line">${esc(tg.mtproto.secret || '—')}</div>
        ${tg.mtproto.links && tg.mtproto.links.app ? `
          <div class="link-stack">
            <div class="endpoint"><span class="ep-key">TG URI</span><span class="ep-val">${esc(tg.mtproto.links.app)}</span>
              <button class="mini" data-act="copy" data-arg="${esc(tg.mtproto.links.app)}" type="button">${icon('copy', 'ic ic-sm')}</button></div>
            <div class="endpoint"><span class="ep-key">HTTPS</span><span class="ep-val">${esc(tg.mtproto.links.web)}</span>
              <button class="mini" data-act="copy" data-arg="${esc(tg.mtproto.links.web)}" type="button">${icon('copy', 'ic ic-sm')}</button></div>
          </div>
          <div class="proxy-qr-row">
            ${qrBlock(tg.mtproto.links.web)}
            <p class="hint">${t('با اسکن کد QR یا کلیک روی لینک، پروکسی مستقیماً در تلگرام فعال می‌شود.', 'Scan the QR code or open the link to activate the proxy inside Telegram.')}</p>
          </div>` : ''}
      </div>

      <div class="card">
        <p class="kicker">${icon('plug')}${t('پروکسی SOCKS5 و HTTP', 'SOCKS5 & HTTP CONNECT PROXIES')}</p>
        <div class="spread">
          <label class="tgl">
            <input type="checkbox" data-act="toggle-socks" ${tg.socks.enabled ? 'checked' : ''}>
            <span class="track"></span><span>SOCKS5</span>
          </label>
          <span class="mono" style="font-size:11px">${st.cores.socks5.conns} conns · ↑${fmtBytes(st.cores.socks5.up)} ↓${fmtBytes(st.cores.socks5.down)}</span>
        </div>
        <div class="field-grid" style="margin-top:10px">
          <div><label class="fld-label">${t('نام کاربری SOCKS5', 'SOCKS5 USER')}</label><input type="text" id="tg-socks-user" value="${esc(tg.socks.user)}"></div>
          <div><label class="fld-label">${t('گذرواژه SOCKS5', 'SOCKS5 PASS')}</label><input type="text" id="tg-socks-pass" value="${esc(tg.socks.pass)}"></div>
        </div>
        <div class="actions">
          <button class="btn sm-btn primary" data-act="save-socks" type="button">${icon('save', 'ic ic-sm')}${t('ذخیره SOCKS5', 'SAVE SOCKS5')}</button>
        </div>
        ${tg.socks.link ? `
          <div class="endpoint"><span class="ep-key">SOCKS5</span><span class="ep-val">${esc(tg.socks.link)}</span>
            <button class="mini" data-act="copy" data-arg="${esc(tg.socks.link)}" type="button">${icon('copy', 'ic ic-sm')}</button></div>` : ''}

        <div class="dashed"></div>
        <div class="spread">
          <label class="tgl">
            <input type="checkbox" data-act="toggle-http" ${tg.http.enabled ? 'checked' : ''}>
            <span class="track"></span><span>HTTP CONNECT</span>
          </label>
          <span class="mono" style="font-size:11px">${st.cores.http.conns} conns · ↑${fmtBytes(st.cores.http.up)} ↓${fmtBytes(st.cores.http.down)}</span>
        </div>
        <div class="field-grid" style="margin-top:10px">
          <div><label class="fld-label">${t('نام کاربری HTTP', 'HTTP USER')}</label><input type="text" id="tg-http-user" value="${esc(tg.http.user)}"></div>
          <div><label class="fld-label">${t('گذرواژه HTTP', 'HTTP PASS')}</label><input type="text" id="tg-http-pass" value="${esc(tg.http.pass)}"></div>
        </div>
        <div class="actions">
          <button class="btn sm-btn primary" data-act="save-http" type="button">${icon('save', 'ic ic-sm')}${t('ذخیره HTTP', 'SAVE HTTP')}</button>
        </div>
        ${tg.http.link ? `
          <div class="endpoint"><span class="ep-key">HTTP</span><span class="ep-val">${esc(tg.http.link)}</span>
            <button class="mini" data-act="copy" data-arg="${esc(tg.http.link)}" type="button">${icon('copy', 'ic ic-sm')}</button></div>` : ''}
      </div>
    </div>`;
  $$('[data-qr]').forEach((el) => qrInto(el, el.dataset.qr));
}

/* ── Cores & Logs ──────────────────────────────────────────────────────── */

function coreCard(title, core, extra = '') {
  return `
    <div class="card">
      <p class="kicker">${icon('cpu')}${title}</p>
      <div class="spread">
        ${coreBadge(core.status)}
        <span class="mono" style="font-size:10.5px">${esc(core.version || 'not found')}</span>
      </div>
      <table class="tbl" style="margin-top:8px">
        <tbody>
          <tr><th>PID</th><td class="mono">${core.pid || '—'}</td></tr>
          <tr><th>${t('آپ‌تایم', 'UPTIME')}</th><td class="mono">${core.uptimeMs ? fmtUptime(core.uptimeMs) : '—'}</td></tr>
          <tr><th>${t('ری‌استارت‌ها', 'RESTARTS')}</th><td class="mono">${core.restarts || 0}</td></tr>
          <tr><th>${t('مسیر باینری', 'BINARY')}</th><td class="mono" style="overflow-wrap:anywhere">${esc(core.bin || '—')}</td></tr>
          ${extra}
        </tbody>
      </table>
      ${core.lastError ? `<div class="note-inline">${esc(core.lastError)}</div>` : ''}
      <div class="actions">
        <button class="btn sm-btn" data-act="restart-core" data-arg="${core.id || ''}" type="button">${icon('power', 'ic ic-sm')}${t('ری‌استارت', 'RESTART')}</button>
      </div>
    </div>`;
}

function renderCores() {
  const st = S.state;
  const x = st.cores.xray;
  const sb = st.cores.singbox;
  const mt = st.cores.mtproto;
  const mux = st.cores.mux;

  $('#pane-cores').innerHTML = `
    <div class="grid-3">
      ${coreCard('XRAY-CORE', { ...x, id: 'xray' }, `<tr><th>${t('اینباند', 'INBOUNDS')}</th><td class="mono">${(x.routes || []).length}</td></tr>`)}
      ${coreCard('SING-BOX', { ...sb, id: 'singbox' }, `<tr><th>${t('اینباند', 'INBOUNDS')}</th><td class="mono">${(sb.routes || []).length}</td></tr>`)}
      ${coreCard('MTG · MTPROTO', { ...mt, id: 'mtproto' }, `<tr><th>PORT</th><td class="mono">127.0.0.1:${mt.port}</td></tr>`)}
    </div>

    <div class="cols" style="margin-top:16px">
      <div class="card">
        <div class="spread">
          <p class="kicker" style="margin:0">${icon('terminal')}${t('کنسول لاگ زنده', 'LIVE ENGINE LOGS')}</p>
          <div class="pill-group">
            ${['xray', 'singbox', 'mtproto'].map((source) => `
              <button class="pill ${S.logSource === source ? 'active' : ''}" data-act="log-source" data-arg="${source}" type="button">${source}</button>`).join('')}
          </div>
        </div>
        <div class="console" id="log-console" style="margin-top:10px">…</div>
        <div class="actions">
          <button class="btn sm-btn ghost" data-act="refresh-logs" type="button">${icon('refresh', 'ic ic-sm')}${t('تازه‌سازی', 'REFRESH')}</button>
          <a class="btn sm-btn ghost" href="/api/logs?source=${S.logSource}" target="_blank" rel="noopener">${icon('external', 'ic ic-sm')}${t('خام', 'RAW')}</a>
        </div>
      </div>

      <div class="card card-subtle">
        <p class="kicker">${icon('pulse')}${t('سنجه‌های ران‌تایم', 'RUNTIME TELEMETRY')}</p>
        <table class="tbl">
          <tbody>
            <tr><th>${t('آپ‌تایم پنل', 'PANEL UPTIME')}</th><td class="mono">${fmtUptime(Date.now() - st.cores.bootedAt)}</td></tr>
            <tr><th>${t('آپ‌تایم Xray', 'XRAY UPTIME')}</th><td class="mono">${st.cores.sys.uptime ? `${st.cores.sys.uptime}s` : '—'}</td></tr>
            <tr><th>Goroutines</th><td class="mono">${st.cores.sys.goroutines || '—'}</td></tr>
            <tr><th>Heap</th><td class="mono">${st.cores.sys.alloc ? fmtBytes(st.cores.sys.alloc) : '—'}</td></tr>
            <tr><th>${t('نشست‌های مالتی‌پلکسر', 'MUX SESSIONS')}</th><td class="mono">${mux.total}</td></tr>
            <tr><th>${t('اتصالات فعال', 'ACTIVE STREAMS')}</th><td class="mono">${mux.active}</td></tr>
            <tr><th>${t('ترافیک مالتی‌پلکسر', 'MUX TRAFFIC')}</th><td class="mono">↑${fmtBytes(mux.up)} ↓${fmtBytes(mux.down)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <p class="kicker">${icon('file')}${t('کانفیگ‌های هسته و ویرایشگر JSON', 'CORE SCHEMAS & RAW JSON EDITOR')}</p>
      <p class="hint" style="margin-top:0">${t(
        'در هر تغییر، کانفیگ‌های Xray و sing-box از نو ساخته شده و پیش از بارگذاری با باینری هسته اعتبارسنجی می‌شوند.',
        'Every state change rebuilds both core schemas and validates them against the core binary before hot-reloading.',
      )}</p>
      <div class="row">
        <span class="chip">state/xray.json</span>
        <span class="chip">state/sing-box.json</span>
        <button class="btn sm-btn ghost" data-act="raw-open" data-arg="xray" type="button">${icon('edit', 'ic ic-sm')}Xray ${t('ویرایش JSON', 'RAW JSON')}</button>
        <button class="btn sm-btn ghost" data-act="raw-open" data-arg="singbox" type="button">${icon('edit', 'ic ic-sm')}sing-box ${t('ویرایش JSON', 'RAW JSON')}</button>
        <button class="btn sm-btn primary" data-act="apply" type="button">${icon('refresh', 'ic ic-sm')}${t('بازسازی و اعمال', 'REBUILD & APPLY')}</button>
      </div>
    </div>`;
  refreshLogs();
}

async function refreshLogs() {
  const consoleEl = $('#log-console');
  if (!consoleEl) return;
  try {
    const data = await api(`/api/logs?source=${S.logSource}`);
    const strip = (v) => String(v).replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
    const lines = (data.lines || []).slice(-150).map(strip);
    consoleEl.innerHTML = lines.length
      ? lines.map((line) => `<span class="ln ${/error|fail|cannot|denied/i.test(line) ? 'err' : /warn/i.test(line) ? 'warn' : ''}">${esc(line)}</span>`).join('')
      : '<span class="ln">—</span>';
    consoleEl.scrollTop = consoleEl.scrollHeight;
  } catch {
    consoleEl.textContent = 'log unavailable';
  }
}

function startLogPolling() {
  stopLogPolling();
  S.logTimer = setInterval(() => { if (S.tab === 'cores') refreshLogs(); }, 4000);
}

function stopLogPolling() {
  if (S.logTimer) clearInterval(S.logTimer);
  S.logTimer = null;
}

/* ── Settings ──────────────────────────────────────────────────────────── */

function renderUpdateBody() {
  const u = S.update;
  const cur = (S.state && S.state.app && S.state.app.version) || '2.0.0';
  if (!u) {
    return `
      <div class="row">
        <span class="chip ok">v${esc(cur)}</span>
        <span class="muted">${t('وضعیت نسخه بررسی نشده است.', 'Release status not checked yet.')}</span>
      </div>
      <div class="actions">
        <button class="btn sm-btn" data-act="check-update" type="button">${icon('refresh', 'ic ic-sm')}${t('بررسی به‌روزرسانی', 'CHECK FOR UPDATE')}</button>
      </div>`;
  }
  if (!u.ok) {
    return `
      <div class="row">
        <span class="chip">v${esc(cur)}</span>
        <span class="chip warn">${t('مخزن در دسترس نیست', 'Repository unreachable')}</span>
      </div>
      <div class="actions">
        <button class="btn sm-btn" data-act="check-update" type="button">${icon('refresh', 'ic ic-sm')}${t('تلاش مجدد', 'RETRY')}</button>
      </div>`;
  }
  return `
    <div class="row">
      <span class="chip">v${esc(cur)}</span>
      <span>→</span>
      <span class="chip ${u.updateAvailable ? 'ok' : ''}">${u.latest ? `v${esc(u.latest)}` : `v${esc(cur)}`}</span>
    </div>
    <div class="actions">
      <button class="btn sm-btn" data-act="check-update" type="button">${icon('refresh', 'ic ic-sm')}${t('بررسی مجدد', 'CHECK AGAIN')}</button>
      ${u.updateAvailable ? `<button class="btn sm-btn primary" data-act="apply-update" type="button">${icon('download', 'ic ic-sm')}${t('نصب و ری‌استارت', 'INSTALL & RESTART')}</button>` : ''}
    </div>`;
}

function updateBannerHtml() {
  const u = S.update;
  const cur = (S.state && S.state.app && S.state.app.version) || '2.0.0';
  if (!u || !u.ok || !u.updateAvailable) {
    return '';
  }
  return `
    <div class="upd-banner new" id="update-banner">
      <span class="upd-badge new"><span class="upd-dot"></span>${t('نسخهٔ جدید BBG', 'NEW BBG RELEASE')}</span>
      <span class="upd-text">
        ${t('نسخهٔ', 'Version')} <b class="mono">v${esc(u.latest)}</b>
        ${t('در دسترس است — نسخهٔ فعلی:', 'is available — current:')} <b class="mono">v${esc(cur)}</b>
      </span>
      <div class="upd-actions">
        <button class="btn sm-btn primary" data-act="apply-update" type="button">${icon('download', 'ic ic-sm')}${t('به‌روزرسانی آنی', 'UPDATE NOW')}</button>
      </div>
    </div>`;
}

function checkUpdateQuiet() {
  if (S.updateBusy) return;
  S.updateBusy = true;
  api('/api/update')
    .then((u) => { S.update = u; })
    .catch(() => {})
    .finally(() => {
      S.updateBusy = false;
      refreshUpdateCard();
    });
}

function refreshUpdateCard() {
  const card = $('#card-update');
  if (card) card.innerHTML = `<p class="kicker">${icon('download')}${t('به‌روزرسانی سیستم BBG', 'BBG SYSTEM UPDATE')}</p>${renderUpdateBody()}`;
}

function renderSettings() {
  const st = S.state;
  $('#pane-settings').innerHTML = `
    <div class="cols">
      <div class="card">
        <p class="kicker">${icon('globe')}${t('میزبان‌ها و پورت‌های لبه', 'EDGE HOSTS & PORTS')}</p>
        <div class="field-grid">
          <div><label class="fld-label">${t('دامنهٔ عمومی (HTTPS)', 'PUBLIC HOST (HTTPS)')}</label>
            <input type="text" id="s-public" value="${esc(st.settings.publicHost)}" placeholder="${esc(st.facts.publicHost || 'edge.example.com')}"></div>
          <div><label class="fld-label">${t('میزبان پروکسی TCP', 'TCP PROXY HOST')}</label>
            <input type="text" id="s-tcphost" value="${esc(st.settings.tcpHost)}" placeholder="${esc(st.facts.tcpHost || 'tcp.example.com')}"></div>
          <div><label class="fld-label">${t('پورت پروکسی TCP', 'TCP PROXY PORT')}</label>
            <input type="number" id="s-tcpport" value="${esc(st.settings.tcpPort || '')}" placeholder="${st.facts.tcpPort || ''}"></div>
          <div><label class="fld-label">${t('سطح لاگ هسته', 'CORE LOG LEVEL')}</label>
            <select id="s-loglevel">
              ${['warning', 'info', 'debug', 'error', 'none'].map((lvl) => `<option value="${lvl}" ${st.settings.logLevel === lvl ? 'selected' : ''}>${lvl}</option>`).join('')}
            </select></div>
        </div>
        <p class="hint">${t('مقادیر خالی به‌طور خودکار از متغیرهای محیطی خوانده می‌شوند.', 'Empty fields automatically inherit from environment variables.')}</p>
        <div class="actions">
          <button class="btn primary" data-act="save-settings" type="button">${icon('save', 'ic ic-sm')}${t('ذخیره تنظیمات', 'SAVE SETTINGS')}</button>
        </div>
      </div>

      <div class="card">
        <p class="kicker">${icon('shield')}${t('مقاوم‌سازی TLS و عبور از DPI', 'TLS FRAGMENTATION & DPI EVASION')}</p>
        <label class="chk"><input type="checkbox" id="s-fragment" ${st.settings.fragment !== false ? 'checked' : ''}>
          ${t('فعال‌سازی TLS Fragmentation در کانفیگ‌های Xray و sing-box', 'Enable TLS ClientHello & Record Fragmentation in generated configs')}</label>
        <p class="hint">${t(
          'با فعال بودن این گزینه، بسته‌های TLS ClientHello به قطعات ۱۰۰ تا ۲۰۰ بایتی با تأخیر ۱۰ تا ۲۰ میلی‌ثانیه تقسیم می‌شوند تا سیستم‌های بازرسی عمیق بسته (DPI) قادر به تشخیص SNI نباشند.',
          'Splits outbound TLS ClientHello records into 100-200 byte fragments with a 10-20ms interval to defeat SNI-based Deep Packet Inspection.',
        )}</p>
        <div class="actions">
          <button class="btn sm-btn primary" data-act="save-fragment" type="button">${icon('save', 'ic ic-sm')}${t('ذخیره', 'SAVE')}</button>
        </div>
      </div>
    </div>

    <div class="cols">
      <div class="card" id="card-update">
        <p class="kicker">${icon('download')}${t('به‌روزرسانی سیستم BBG', 'BBG SYSTEM UPDATE')}</p>
        ${renderUpdateBody()}
      </div>

      <div class="card">
        <p class="kicker">${icon('download')}${t('پشتیبان‌گیری و بازیابی', 'BACKUP & RESTORE')}</p>
        <p class="labor">${t('تمامی مشترکین، کلیدها و تنظیمات در یک فایل JSON ذخیره می‌شوند.', 'All subscribers, keys, and inbound configurations are stored in a portable JSON snapshot.')}</p>
        <div class="actions">
          <a class="btn sm-btn primary" href="/api/backup" download>${icon('download', 'ic ic-sm')}${t('دانلود نسخهٔ پشتیبان', 'DOWNLOAD BACKUP')}</a>
          <label class="btn sm-btn ghost" style="cursor:pointer">
            ${icon('upload', 'ic ic-sm')}${t('بازیابی', 'RESTORE')}
            <input type="file" id="restore-file" accept="application/json" hidden>
          </label>
        </div>
        <div class="dashed"></div>
        <p class="kicker">${icon('search')}${t('تست اتصال TCP', 'TCP CONNECTIVITY PROBE')}</p>
        <div class="field-grid">
          <div><label class="fld-label">${t('میزبان', 'HOST')}</label><input type="text" id="s-probe-host" placeholder="${esc(st.facts.tcpHost || '1.1.1.1')}"></div>
          <div><label class="fld-label">PORT</label><input type="number" id="s-probe-port" value="${st.facts.tcpPort || 443}"></div>
        </div>
        <div class="actions">
          <button class="btn sm-btn ghost" data-act="probe" type="button">${icon('radar', 'ic ic-sm')}${t('تست پورت', 'RUN PROBE')}</button>
        </div>
        <div id="probe-result"></div>
      </div>
    </div>

    <div class="cols">
      <div class="card">
        <p class="kicker">${icon('cpu')}${t('مدیریت هسته‌ها و رمز عبور مدیر', 'CORE EXECUTION & OPERATOR SECURITY')}</p>
        <div class="stack-sm">
          <label class="chk"><input type="checkbox" id="s-core-xray" ${st.settings.cores.xray.enabled ? 'checked' : ''}>
            ${t('اجرای هستهٔ Xray-core', 'Enable Xray-core engine')}</label>
          <label class="chk"><input type="checkbox" id="s-core-singbox" ${st.settings.cores.singbox.enabled ? 'checked' : ''}>
            ${t('اجرای هستهٔ sing-box', 'Enable sing-box engine')}</label>
          <label class="chk"><input type="checkbox" id="s-core-lazy" ${st.settings.cores.singbox.lazy ? 'checked' : ''}>
            ${t('اجرای هوشمند sing-box (فقط در صورت وجود اینباند فعال)', 'Lazy-start sing-box only when sing-box inbounds are enabled')}</label>
          <label class="chk"><input type="checkbox" id="s-lowmem" ${st.settings.lowMemory ? 'checked' : ''}>
            ${t('بهینه‌سازی مصرف حافظه (Low-Memory Mode)', 'Low-memory edge optimization mode')}</label>
        </div>
        <div class="actions">
          <button class="btn sm-btn primary" data-act="save-cores" type="button">${icon('save', 'ic ic-sm')}${t('ذخیره هسته‌ها', 'SAVE CORES')}</button>
        </div>
        <div class="dashed"></div>
        <p class="kicker">${icon('lock')}${t('تغییر گذرواژهٔ مدیر', 'CHANGE OPERATOR PASSWORD')}</p>
        <div class="field-grid">
          <div><label class="fld-label">${t('گذرواژهٔ فعلی', 'CURRENT PASSWORD')}</label><input type="password" id="s-pass-cur"></div>
          <div><label class="fld-label">${t('گذرواژهٔ جدید', 'NEW PASSWORD')}</label><input type="password" id="s-pass-new"></div>
        </div>
        <div class="actions">
          <button class="btn sm-btn" data-act="change-pass" type="button">${icon('key', 'ic ic-sm')}${t('به‌روزرسانی رمز', 'UPDATE PASSWORD')}</button>
        </div>
      </div>

      <div class="card card-subtle">
        <p class="kicker">${icon('shield')}${t('مشخصات سیستم BBG', 'BBG DEPLOYMENT SPECIFICATIONS')}</p>
        <div class="facts-grid">
          <div class="fact"><span>BRAND</span><b class="mono">BBG</b></div>
          <div class="fact"><span>MAINTAINER</span><b class="mono">SANDBAAD</b></div>
          <div class="fact"><span>VERSION</span><b class="mono">v${esc(st.app.version)}</b></div>
          <div class="fact"><span>REGION</span><b class="mono">${esc(st.facts.region || 'auto')}</b></div>
          <div class="fact"><span>DATA DIR</span><b class="mono">${esc(st.facts.dataDir)}</b></div>
          <div class="fact"><span>HTTP PORT</span><b class="mono">${st.facts.port}</b></div>
          <div class="fact"><span>MUX PORT</span><b class="mono">${st.facts.muxPort}</b></div>
          <div class="fact"><span>XRAY BIN</span><b class="mono">${esc(st.facts.bins.xray)}</b></div>
          <div class="fact"><span>SING-BOX BIN</span><b class="mono">${esc(st.facts.bins.singbox)}</b></div>
          <div class="fact"><span>MTG BIN</span><b class="mono">${esc(st.facts.bins.mtg)}</b></div>
        </div>
      </div>
    </div>`;
}

/* ── Modal ─────────────────────────────────────────────────────────────── */

function openModal(title, body, asHtml = false) {
  if (asHtml) $('#modal-title').innerHTML = title;
  else $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = body;
  $('#modal').hidden = false;
}

function closeModal() {
  $('#modal').hidden = true;
  $('#modal-body').innerHTML = '';
}

/* ── Actions ───────────────────────────────────────────────────────────── */

function busy(on) {
  S.busy = on;
  document.body.style.cursor = on ? 'progress' : '';
}

async function withState(fn) {
  if (S.busy) return;
  busy(true);
  try {
    const res = await fn();
    if (res && res.state) {
      S.state = res.state;
      renderAll();
    }
  } catch (err) {
    if (err.status === 401) return showAuth();
    toast(err.message, 'warn');
  } finally {
    busy(false);
  }
}

function paramValues(id) {
  const out = {};
  $$(`[data-param][data-id="${id}"]`).forEach((el) => {
    out[el.dataset.param] = el.value;
  });
  return out;
}

async function onAction(act, arg, el) {
  switch (act) {
    case 'tab':
      return switchTab(arg);
    case 'dash-filter':
      S.dashFilter = arg || 'all';
      return renderDashboard();
    case 'copy':
      return copyText(arg);
    case 'ping-links': {
      LINK_PING.clear();
      showUserLinks(arg);
      const r = await api('/api/links/ping', { method: 'POST', body: { userId: arg } });
      for (const x of r.results || []) LINK_PING.set(x.label, { ok: x.ok, ms: x.ms, error: x.error });
      showUserLinks(arg);
      const ok = (r.results || []).filter((x) => x.ok).length;
      toast(`${ok}/${(r.results || []).length} ${tt('پروتکل پاسخ داد', 'transports responded')}`);
      return;
    }
    case 'qr':
      openModal('QR Code', `<div class="qr-center"><div class="qrbox qr"><div id="modal-qr"></div></div><p class="code-line" style="margin-top:10px;max-height:80px;overflow:auto">${esc(arg)}</p></div>`);
      qrInto($('#modal-qr'), arg);
      return;
    case 'apply':
      return withState(async () => {
        const res = await api('/api/apply', { method: 'POST' });
        toast(tt('کانفیگ‌ها بازسازی و اعمال شدند', 'Configs rebuilt and applied'));
        return res;
      });
    case 'add-inbound':
      return withState(() => api('/api/inbounds', { method: 'POST', body: { presetId: arg } }));
    case 'toggle-inbound':
      return withState(() => api(`/api/inbounds/${arg}`, { method: 'PATCH', body: { enabled: el.checked } }));
    case 'edit-inbound':
      S.editing = S.editing === arg ? null : arg;
      return renderInbounds();
    case 'save-inbound': {
      const params = paramValues(arg);
      return withState(() => api(`/api/inbounds/${arg}`, { method: 'PATCH', body: { params } }));
    }
    case 'del-inbound':
      if (!confirm(tt('این پروتکل حذف شود؟', 'Delete this inbound?'))) return;
      return withState(() => api(`/api/inbounds/${arg}`, { method: 'DELETE' }));
    case 'create-user': {
      const body = {
        name: $('#nu-name')?.value || '',
        quotaGb: Number($('#nu-quota')?.value || 0),
        days: Number($('#nu-days')?.value || 0),
        ipLimit: Number($('#nu-ip')?.value || 0),
        note: $('#nu-note')?.value || '',
      };
      return withState(async () => {
        const res = await api('/api/users', { method: 'POST', body });
        toast(tt('مشترک ساخته شد', 'Subscriber created'));
        return res;
      });
    }
    case 'toggle-user':
      return withState(() => api(`/api/users/${arg}`, { method: 'PATCH', body: { enabled: el.dataset.value === '1' } }));
    case 'reset-user':
      return withState(() => api(`/api/users/${arg}/resettraffic`, { method: 'POST' }));
    case 'rotate-user':
      if (!confirm(tt('کلیدهای مشترک تعویض شوند؟ لینک‌های قبلی باطل می‌شوند.', 'Rotate subscriber keys? Previous links will be invalidated.'))) return;
      return withState(() => api(`/api/users/${arg}/rotate`, { method: 'POST' }));
    case 'del-user':
      if (!confirm(tt('این مشترک حذف شود؟', 'Delete this subscriber?'))) return;
      return withState(() => api(`/api/users/${arg}`, { method: 'DELETE' }));
    case 'show-links':
      return showUserLinks(arg);
    case 'toggle-mtproto':
      return withState(() => api('/api/telegram', { method: 'POST', body: { mtproto: { enabled: el.checked } } }));
    case 'save-mtproto':
      return withState(() => api('/api/telegram', {
        method: 'POST',
        body: { mtproto: { enabled: true, faketlsHost: $('#tg-faketls')?.value || 'www.microsoft.com', adTag: $('#tg-adtag')?.value || '' } },
      }));
    case 'regen-secret':
      if (!confirm(tt('سکرت جدید ساخته شود؟ لینک قبلی از کار می‌افتد.', 'Generate a new secret? Current MTProto links will stop working.'))) return;
      return withState(() => api('/api/telegram/secret', { method: 'POST' }));
    case 'toggle-socks':
      return withState(() => api('/api/telegram', { method: 'POST', body: { socks: { enabled: el.checked } } }));
    case 'save-socks':
      return withState(() => api('/api/telegram', {
        method: 'POST',
        body: { socks: { enabled: true, user: $('#tg-socks-user')?.value || 'bbg', pass: $('#tg-socks-pass')?.value || '' } },
      }));
    case 'toggle-http':
      return withState(() => api('/api/telegram', { method: 'POST', body: { http: { enabled: el.checked } } }));
    case 'save-http':
      return withState(() => api('/api/telegram', {
        method: 'POST',
        body: { http: { enabled: true, user: $('#tg-http-user')?.value || 'bbg', pass: $('#tg-http-pass')?.value || '' } },
      }));
    case 'rl-start': {
      const link = ($('#rl-link')?.value || RAILYNX.link || '').trim();
      if (!link) return toast(tt('ابتدا یک لینک VLESS وارد کنید.', 'Paste a VLESS link first.'), 'warn');
      RAILYNX.link = link;
      busy(true);
      try {
        RAILYNX.data = await api('/api/railynx/scan', {
          method: 'POST',
          body: { link, cidr: $('#rl-cidr')?.value || '', concurrency: Number($('#rl-workers')?.value || 16) },
        });
        startRailynxPolling();
        renderRailynx();
        toast(tt('اسکن آغاز شد.', 'EdgeScan started.'));
      } catch (err) {
        toast(err.message, 'warn');
      } finally {
        busy(false);
      }
      return;
    }
    case 'rl-cancel':
      busy(true);
      try {
        RAILYNX.data = await api('/api/railynx/cancel', { method: 'POST' });
        renderRailynx();
        toast(tt('اسکن متوقف شد.', 'Scan stopped.'));
      } catch (err) {
        toast(err.message, 'warn');
      } finally {
        busy(false);
      }
      return;
    case 'modal-close':
      closeModal();
      return;
    case 'raw-open': {
      const core = arg;
      busy(true);
      try {
        const raw = await api('/api/raw');
        const text = raw.active[core] || raw.generated[core] || '';
        const flagged = raw.override[core] ? t('کانفیگ دستی فعال است', 'Manual override active') : t('کانفیگ خودکار BBG', 'BBG Auto-Generated Schema');
        openModal(`${icon('edit', 'ic ic-sm')} ${core} · ${t('ویرایشگر JSON', 'RAW JSON CONFIG')}`, `
          <p class="hint" style="margin-top:0">${flagged}${raw.notes && raw.notes[core] ? ` — ${esc(raw.notes[core])}` : ''}</p>
          <textarea id="raw-box" class="raw-box" spellcheck="false" dir="ltr">${esc(text)}</textarea>
          <div class="actions">
            <button class="btn sm-btn primary" data-act="raw-save" data-arg="${core}" type="button">${icon('save', 'ic ic-sm')}${t('ذخیره و اعمال', 'SAVE & APPLY')}</button>
            <button class="btn sm-btn ghost" data-act="raw-reset" data-arg="${core}" type="button">${icon('refresh', 'ic ic-sm')}${t('بازگشت به خودکار', 'RESET TO AUTO')}</button>
            <button class="btn sm-btn ghost" data-act="modal-close" type="button">${t('بستن', 'CLOSE')}</button>
          </div>`, true);
      } catch (err) {
        toast(err.message, 'warn');
      } finally {
        busy(false);
      }
      return;
    }
    case 'raw-save': {
      const text = $('#raw-box')?.value || '';
      busy(true);
      try {
        const res = await api('/api/raw', { method: 'POST', body: { core: arg, config: text } });
        S.state = res.state;
        renderAll();
        closeModal();
        toast(tt('کانفیگ ذخیره و اعمال شد.', 'Config saved and applied.'));
      } catch (err) {
        toast(err.message, 'warn');
      } finally {
        busy(false);
      }
      return;
    }
    case 'raw-reset': {
      busy(true);
      try {
        const res = await api('/api/raw', { method: 'POST', body: { core: arg, config: '' } });
        S.state = res.state;
        renderAll();
        closeModal();
        toast(tt('به کانفیگ خودکار بازگشت.', 'Restored auto-generated config.'));
      } catch (err) {
        toast(err.message, 'warn');
      } finally {
        busy(false);
      }
      return;
    }
    case 'easy-refresh':
      EASY_CACHE.data = null;
      await loadEasy(true);
      renderEasy();
      return;
    case 'open':
      window.open(arg, '_blank', 'noopener');
      return;
    case 'easy-apply': {
      busy(true);
      try {
        const res = await api('/api/easy-setup/apply', { method: 'POST', body: { profile: arg } });
        S.state = await api('/api/state');
        EASY_CACHE.data = await api('/api/easy-setup');
        EASY_CACHE.at = Date.now();
        renderAll();
        S.tab = 'easy';
        switchTab('easy');
        toast(tt('پروفایل اعمال شد و لینک اشتراک کپی گردید.', 'Profile applied — subscription URL copied.'));
        if (res.subUrl) copyText(res.subUrl);
      } catch (err) {
        toast(err.message, 'warn');
      } finally {
        busy(false);
      }
      return;
    }
    case 'restart-core':
      return withState(async () => {
        const res = await api(`/api/cores/${arg}/restart`, { method: 'POST' });
        toast(`${arg} restarted`);
        return res;
      });
    case 'log-source':
      S.logSource = arg;
      renderCores();
      return;
    case 'refresh-logs':
      return refreshLogs();
    case 'save-settings':
      return withState(() => api('/api/settings', {
        method: 'POST',
        body: {
          publicHost: $('#s-public')?.value || '',
          tcpHost: $('#s-tcphost')?.value || '',
          tcpPort: Number($('#s-tcpport')?.value || 0),
          logLevel: $('#s-loglevel')?.value || 'warning',
        },
      }));
    case 'check-update': {
      S.updateBusy = true;
      try {
        S.update = await api('/api/update?force=1');
      } catch (err) {
        S.update = { ok: false, error: err.message };
      } finally {
        S.updateBusy = false;
      }
      refreshUpdateCard();
      toast(S.update && S.update.updateAvailable
        ? tt('نسخهٔ جدیدی در دسترس است', 'A newer release is available')
        : tt('سیستم BBG به‌روز است', 'BBG is up to date'));
      return;
    }
    case 'apply-update': {
      if (!window.confirm(tt('فایل‌ها به‌روزرسانی شده و سرویس ری‌استارت می‌شود. ادامه می‌دهید؟', 'System files will be updated and the service will restart. Continue?'))) return;
      toast(tt('در حال دانلود و نصب…', 'Downloading and installing…'));
      try {
        const r = await api('/api/update', { method: 'POST' });
        toast(`${tt('نصب شد', 'Installed')} · v${r.version}`);
        setTimeout(() => window.location.reload(), 4000);
      } catch (err) {
        toast(err.message, 'warn');
      }
      return;
    }
    case 'save-fragment':
      return withState(() => api('/api/settings', {
        method: 'POST',
        body: { fragment: $('#s-fragment')?.checked ?? true },
      }));
    case 'save-cores':
      return withState(() => api('/api/settings', {
        method: 'POST',
        body: {
          lowMemory: $('#s-lowmem')?.checked ?? true,
          cores: {
            xray: { enabled: $('#s-core-xray')?.checked ?? true },
            singbox: { enabled: $('#s-core-singbox')?.checked ?? true, lazy: $('#s-core-lazy')?.checked ?? true },
          },
        },
      }));
    case 'change-pass':
      return withState(async () => {
        await api('/api/admin/password', {
          method: 'POST',
          body: { current: $('#s-pass-cur')?.value || '', password: $('#s-pass-new')?.value || '' },
        });
        toast(tt('گذرواژه تغییر یافت', 'Password updated'));
        return null;
      });
    case 'probe': {
      const host = $('#s-probe-host')?.value || '';
      const port = Number($('#s-probe-port')?.value || 443);
      const res = await api('/api/tools/probe', { method: 'POST', body: { host, port } });
      const box = $('#probe-result');
      if (box) {
        box.innerHTML = `<div class="${res.ok ? 'ok-msg' : 'err'}" style="margin-top:10px">
          ${res.ok ? `OPEN · ${res.ms}ms` : `FAILED · ${esc(res.error)}`} — ${esc(host)}:${port}
        </div>`;
      }
      return;
    }
    default:
      return undefined;
  }
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'toggle-inbound' || act === 'toggle-mtproto' || act === 'toggle-socks' || act === 'toggle-http') return;
  ev.preventDefault();
  onAction(act, el.dataset.arg, el);
});

document.addEventListener('change', (ev) => {
  if (ev.target.id === 'rl-pick') {
    const box = $('#rl-link');
    if (box && ev.target.value) {
      box.value = ev.target.value;
      RAILYNX.link = ev.target.value;
    }
    return;
  }
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  if (['toggle-inbound', 'toggle-mtproto', 'toggle-socks', 'toggle-http'].includes(el.dataset.act)) {
    onAction(el.dataset.act, el.dataset.arg, el);
  }
});

/* ── Auth Flow ─────────────────────────────────────────────────────────── */

function showAuth() {
  $('#boot').hidden = true;
  $('#app').hidden = true;
  $('#auth').hidden = false;
  const needsSetup = S.boot.needsSetup;
  $('#auth-pass2-wrap').hidden = !needsSetup;
  $('#auth-kicker').textContent = needsSetup ? 'راه‌اندازی اولیه BBG' : 'ورود اپراتور BBG';
  $('#auth-kicker-en').textContent = needsSetup ? 'INITIALIZE BBG OPERATOR' : 'BBG OPERATOR SIGN-IN';
  $('#auth-title').innerHTML = needsSetup
    ? t('نام کاربری و گذرواژهٔ مدیر را تعیین کنید', 'Configure BBG Operator Credentials')
    : t('به پنل مدیریت BBG خوش آمدید', 'Welcome back to BBG Control Plane');
  $('#auth-submit-fa').textContent = needsSetup ? 'راه‌اندازی پنل' : 'ورود به پنل';
  $('#auth-submit-en').textContent = needsSetup ? 'INITIALIZE PANEL' : 'SIGN IN';
  $('#auth-env').textContent = 'BBG · v' + (S.boot.app.version || '2.0.0');
}

async function submitAuth(ev) {
  ev.preventDefault();
  const errBox = $('#auth-err');
  errBox.hidden = true;
  const username = $('#auth-user').value.trim();
  const password = $('#auth-pass').value;
  const needsSetup = S.boot.needsSetup;
  try {
    if (needsSetup) {
      if (password !== $('#auth-pass2').value) throw new Error('passwords do not match');
      if (password.length < 8) throw new Error('password must be at least 8 characters');
      await api('/api/setup', { method: 'POST', body: { username, password } });
    } else {
      await api('/api/login', { method: 'POST', body: { username, password } });
    }
    await loadState();
  } catch (err) {
    errBox.hidden = false;
    errBox.textContent = err.message;
  }
}

/* ── Boot & Refresh ────────────────────────────────────────────────────── */

const PANE_RENDERERS = {
  dashboard: () => renderDashboard(),
  easy: () => renderEasy(),
  railynx: () => renderRailynx(),
  inbounds: () => renderInbounds(),
  users: () => renderUsers(),
  delivery: () => renderDelivery(),
  telegram: () => renderTelegram(),
  cores: () => renderCores(),
  settings: () => renderSettings(),
};

function renderPane(id = S.tab) {
  const run = PANE_RENDERERS[id];
  if (run) run();
}

function renderAll() {
  $('#boot').hidden = true;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  if (!S.updateTimer) {
    checkUpdateQuiet();
    S.updateTimer = setInterval(checkUpdateQuiet, 30 * 60 * 1000);
  }
  renderStatusBar();
  renderNav();
  $$('.tab-pane').forEach((pane) => { pane.hidden = pane.dataset.pane !== S.tab; });
  renderPane(S.tab);
}

async function loadState() {
  S.state = await api('/api/state');
  applyTheme(S.state.settings.theme || 'dark');
  applyLang(S.state.settings.lang || 'fa');
  renderAll();
  if (S.tab === 'cores') startLogPolling();
}

async function boot() {
  document.title = 'BBG · Control Plane — SANDBAAD';
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
  applyLang(localStorage.getItem(LANG_KEY) || 'fa');

  $('#btn-lang')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.lang === 'fa' ? 'en' : 'fa';
    applyLang(next);
    if (S.state) { S.state.settings.lang = next; }
    renderAll();
  });
  $('#auth-lang')?.addEventListener('click', () => {
    applyLang(document.documentElement.dataset.lang === 'fa' ? 'en' : 'fa');
    if (S.boot) showAuth();
  });
  $$('.t-pick').forEach((btn) => btn.addEventListener('click', () => applyTheme(btn.dataset.th)));
  $('#auth-form')?.addEventListener('submit', submitAuth);
  $('#modal-close')?.addEventListener('click', closeModal);
  $('#modal')?.addEventListener('click', (ev) => { if (ev.target.id === 'modal') closeModal(); });
  $('#btn-apply')?.addEventListener('click', () => onAction('apply'));
  $('#btn-reload')?.addEventListener('click', () => loadState().catch((err) => toast(err.message, 'warn')));
  $('#btn-logout')?.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  });

  // Global top search bar
  $('#global-search')?.addEventListener('input', (ev) => {
    S.searchQuery = ev.target.value || '';
    if (S.tab === 'users') renderUsers();
    else if (S.tab === 'inbounds') renderInbounds();
    else if (S.searchQuery.trim()) {
      const q = S.searchQuery.trim().toLowerCase();
      const matchUser = (S.state?.users || []).some((u) => u.name.toLowerCase().includes(q));
      if (matchUser) switchTab('users');
      else switchTab('inbounds');
    }
  });

  document.addEventListener('change', (ev) => {
    if (ev.target.id !== 'restore-file') return;
    const file = ev.target.files?.[0];
    if (!file) return;
    file.text().then((text) => withState(async () => {
      const res = await api('/api/restore', { method: 'POST', body: JSON.parse(text) });
      toast(tt('نسخهٔ پشتیبان بازیابی شد', 'Backup restored'));
      return res;
    })).catch((err) => toast(err.message, 'warn'));
  });

  try {
    S.boot = await api('/api/bootstrap');
  } catch (err) {
    $('#boot').innerHTML = `<div class="card"><div class="err">${esc(err.message)}</div></div>`;
    return;
  }

  if (!S.boot.loggedIn) {
    showAuth();
    return;
  }
  try {
    await loadState();
  } catch {
    showAuth();
  }

  S.refreshTimer = setInterval(async () => {
    if (document.hidden || S.busy || !S.state) return;
    if (['telegram', 'cores', 'dashboard'].includes(S.tab)) {
      try {
        S.state = await api('/api/state');
        renderStatusBar();
        if (S.tab === 'dashboard') renderDashboard();
        if (S.tab === 'telegram') renderTelegram();
      } catch { /* ignore */ }
    }
  }, 15000);
}

boot();
