/**
 * BBG · SANDBAAD — admin panel UI (server + Cloudflare Worker editions).
 * Plain ES module, no build step. Every number shown comes from the API.
 */

const BASE = (document.querySelector('meta[name="panel-base"]')?.content || '').replace(/\/+$/, '');
const S = {
  boot: null,
  state: null,
  page: 'overview',
  lang: 'fa',
  theme: 'dark',
  busy: false,
  filter: '',
  status: 'all',
  deliveryUser: '',
  linksUser: '',
  linksFormat: 'base64',
  logSource: 'xray',
  easy: null,
  scan: null,
  update: null,
  timers: {},
};
const FEATURES_ALL = { telegram: true, cores: true, scanner: true, easy: true, raw: true, update: true, logs: true, probe: true, ping: true };

/* ── helpers ────────────────────────────────────────────────────────── */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const L = (fa, en) => (S.lang === 'en' ? en : fa);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Numbers with Latin units ("42 GB", "3h 17m", "120 ms") keep their order inside Persian text. */
const nb = (text) => `<span class="ltr num">${esc(text)}</span>`;
const icon = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const feat = (k) => ({ ...FEATURES_ALL, ...(S.state?.features || {}) })[k] !== false;
const isWorker = () => S.state?.edition === 'worker' || S.boot?.edition === 'worker';
const GB = 1024 ** 3;

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i += 1; }
  return `${x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2)} ${u[i]}`;
}
function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(S.lang === 'en' ? 'en-GB' : 'fa-IR-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' });
}
function relTime(ms) {
  if (!ms) return L('هرگز', 'never');
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return L('همین حالا', 'just now');
  if (s < 3600) return L(`${Math.floor(s / 60)} دقیقه پیش`, `${Math.floor(s / 60)} min ago`);
  if (s < 86400) return L(`${Math.floor(s / 3600)} ساعت پیش`, `${Math.floor(s / 3600)} h ago`);
  return L(`${Math.floor(s / 86400)} روز پیش`, `${Math.floor(s / 86400)} d ago`);
}
function fmtUptime(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
function daysLeft(ms) {
  if (!ms) return null;
  return Math.ceil((ms - Date.now()) / 864e5);
}

function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3400);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'x-requested-with': 'bbg', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function copyText(text) {
  const done = () => toast(L('کپی شد', 'Copied'));
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch { toast(L('کپی نشد؛ متن را دستی انتخاب کنید', 'Copy failed; select the text manually'), 'warn'); }
  ta.remove();
}

function qrSvg(text) {
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  } catch {
    return `<span class="small muted">${L('متن برای QR طولانی است', 'Too long for a QR code')}</span>`;
  }
}

function copyLine(value, { qr = false, label = '' } = {}) {
  return `<div class="copy-line">${label ? `<span class="small muted nowrap">${esc(label)}</span>` : ''}<code title="${esc(value)}">${esc(value)}</code>
    ${qr ? `<button class="btn ghost sm icon" type="button" data-act="qr" data-arg="${esc(value)}" aria-label="QR">${icon('qr', 'ic ic-sm')}</button>` : ''}
    <button class="btn ghost sm icon" type="button" data-act="copy" data-arg="${esc(value)}" aria-label="${L('کپی', 'Copy')}">${icon('copy', 'ic ic-sm')}</button></div>`;
}

function pill(kind, text) {
  return `<span class="pill ${kind}">${esc(text)}</span>`;
}
function userPill(u) {
  return {
    active: pill('ok', L('فعال', 'Active')),
    disabled: pill('mute', L('غیرفعال', 'Disabled')),
    expired: pill('bad', L('منقضی', 'Expired')),
    quota: pill('warn', L('حجم تمام', 'Out of data')),
  }[u.status] || pill('mute', u.status);
}
function corePill(status) {
  const map = {
    running: ['ok', L('در حال اجرا', 'Running')],
    starting: ['info', L('در حال شروع', 'Starting')],
    stopped: ['mute', L('متوقف', 'Stopped')],
    missing: ['bad', L('نصب نیست', 'Not installed')],
    invalid: ['bad', L('کانفیگ نامعتبر', 'Invalid config')],
    crashed: ['bad', L('از کار افتاده', 'Crashed')],
    error: ['bad', L('خطا', 'Error')],
  };
  const [k, t] = map[status] || ['mute', status || '—'];
  return pill(k, t);
}
function sw(act, checked, arg = '', label = '') {
  return `<label class="switch" title="${esc(label)}"><input type="checkbox" data-act="${act}" data-arg="${esc(arg)}" ${checked ? 'checked' : ''} aria-label="${esc(label)}"><span class="knob"></span></label>`;
}

/* ── theme & language ───────────────────────────────────────────────── */

function applyLang(lang) {
  S.lang = lang === 'en' ? 'en' : 'fa';
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.lang === 'fa' ? 'rtl' : 'ltr';
  try { localStorage.setItem('bbg-lang', S.lang); } catch { /* ignore */ }
}
function applyTheme(theme) {
  S.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = S.theme;
  try { localStorage.setItem('bbg-theme', S.theme); } catch { /* ignore */ }
}

/* ── navigation ─────────────────────────────────────────────────────── */

const PAGES = [
  { id: 'overview', group: 'main', icon: 'gauge', fa: 'نمای کلی', en: 'Overview' },
  { id: 'users', group: 'main', icon: 'users', fa: 'مشترکین', en: 'Subscribers', count: (st) => st.users.length },
  { id: 'protocols', group: 'main', icon: 'layers', fa: 'پروتکل‌ها', en: 'Protocols', count: (st) => st.inbounds.filter((i) => i.enabled).length },
  { id: 'delivery', group: 'main', icon: 'send', fa: 'اشتراک و کلاینت‌ها', en: 'Subscriptions' },
  { id: 'easy', group: 'tools', feature: 'easy', icon: 'bolt', fa: 'تنظیم سریع', en: 'Quick setup' },
  { id: 'telegram', group: 'tools', feature: 'telegram', icon: 'telegram', fa: 'پروکسی تلگرام', en: 'Telegram proxy' },
  { id: 'scanner', group: 'tools', feature: 'scanner', icon: 'radar', fa: 'اسکنر IP تمیز', en: 'Clean-IP scanner' },
  { id: 'cores', group: 'tools', feature: 'cores', icon: 'cpu', fa: 'هسته‌ها و لاگ', en: 'Cores & logs' },
  { id: 'settings', group: 'system', icon: 'sliders', fa: 'تنظیمات', en: 'Settings' },
];
const GROUPS = { main: ['مدیریت', 'Manage'], tools: ['ابزارها', 'Tools'], system: ['سیستم', 'System'] };
const visiblePages = () => PAGES.filter((p) => !p.feature || feat(p.feature));

function navItem(p) {
  const n = p.count && S.state ? p.count(S.state) : null;
  return `<button class="nav-item" type="button" data-act="page" data-arg="${p.id}" ${S.page === p.id ? 'aria-current="page"' : ''}>
    ${icon(p.icon)}<span>${L(p.fa, p.en)}</span>${n !== null ? `<span class="count">${n}</span>` : ''}</button>`;
}

function renderChrome() {
  const pages = visiblePages();
  let html = '';
  for (const g of Object.keys(GROUPS)) {
    const items = pages.filter((p) => p.group === g);
    if (!items.length) continue;
    html += `<div class="nav-group">${L(...GROUPS[g])}</div>${items.map(navItem).join('')}`;
  }
  $('#nav').innerHTML = html;
  const strip = $('#tabstrip');
  const keep = strip.scrollLeft;
  strip.innerHTML = pages.map(navItem).join('');
  strip.scrollLeft = keep;
  const cur = strip.querySelector('[aria-current="page"]');
  if (cur && strip.clientWidth) {
    // Keep the active tab visible on phones (works for RTL and LTR scroll origins).
    const s = strip.getBoundingClientRect();
    const c = cur.getBoundingClientRect();
    if (c.left < s.left + 8) strip.scrollLeft -= s.left + 24 - c.left;
    else if (c.right > s.right - 8) strip.scrollLeft += c.right - s.right + 24;
  }
  const page = PAGES.find((p) => p.id === S.page) || PAGES[0];
  $('#page-title').textContent = L(page.fa, page.en);
  $('#crumb').textContent = isWorker() ? L('نسخهٔ Cloudflare Worker', 'Cloudflare Worker edition') : L('نسخهٔ سرور', 'Server edition');
  $('#brand-sub').textContent = `BY SANDBAAD · ${isWorker() ? 'EDGE' : 'CORE'}`;
  const st = S.state;
  $('#rail-foot').innerHTML = st
    ? `<span>${L('نسخه', 'Version')} <span class="mono">${esc(st.app.version)}</span></span><span class="ltr mono small">${esc(st.facts.publicHost || '')}</span>`
    : '';
  $('#top-actions').innerHTML = `
    ${!isWorker() ? `<button class="btn primary sm" type="button" data-act="apply">${icon('refresh', 'ic ic-sm')}<span class="hide-sm">${L('اعمال تنظیمات', 'Apply config')}</span></button>` : ''}
    <button class="btn ghost sm icon" type="button" data-act="theme" aria-label="${L('تغییر پوسته', 'Toggle theme')}">${icon(S.theme === 'dark' ? 'sun' : 'moon', 'ic ic-sm')}</button>
    <button class="btn ghost sm" type="button" data-act="lang">${S.lang === 'fa' ? 'EN' : 'FA'}</button>
    <button class="btn ghost sm icon" type="button" data-act="logout" aria-label="${L('خروج', 'Sign out')}">${icon('power', 'ic ic-sm')}</button>`;
}

function go(page) {
  if (!visiblePages().some((p) => p.id === page)) page = 'overview';
  S.page = page;
  try { history.replaceState(null, '', `#${page}`); } catch { /* ignore */ }
  stopTimers();
  render();
  window.scrollTo({ top: 0 });
  if (page === 'easy') loadEasy();
  if (page === 'cores') S.timers.logs = setInterval(refreshLogs, 4000);
  if (page === 'scanner') loadScan();
  if (page === 'settings' && feat('update') && !S.update) checkUpdate(false);
}
function stopTimers() {
  clearInterval(S.timers.logs);
  clearInterval(S.timers.scan);
}

function render() {
  if (!S.state) return;
  renderChrome();
  const fn = {
    overview: renderOverview, users: renderUsers, protocols: renderProtocols, delivery: renderDelivery,
    easy: renderEasy, telegram: renderTelegram, scanner: renderScanner, cores: renderCores, settings: renderSettings,
  }[S.page] || renderOverview;
  S.dirty = false;
  $('#content').innerHTML = fn();
  if (S.page === 'cores') refreshLogs();
}

/* ── overview ───────────────────────────────────────────────────────── */

function trafficSeries(st) {
  const raw = st.traffic || [];
  if (st.trafficUnit === 'hour') {
    const hour = 3_600_000;
    const now = Math.floor(Date.now() / hour) * hour;
    const map = new Map(raw.map((b) => [b.t, b]));
    const pts = [];
    for (let i = 23; i >= 0; i -= 1) {
      const t = now - i * hour;
      const b = map.get(t) || { up: 0, down: 0 };
      pts.push({ t, up: b.up, down: b.down });
    }
    return { pts, unit: 'bytes', hint: L('حجم هر ساعت در ۲۴ ساعت اخیر', 'Data per hour, last 24 hours') };
  }
  const pts = [];
  for (let i = 1; i < raw.length; i += 1) {
    const a = raw[i - 1];
    const b = raw[i];
    const dt = Math.max(1, (b.t - a.t) / 1000);
    const du = b.up >= a.up ? b.up - a.up : b.up;
    const dd = b.down >= a.down ? b.down - a.down : b.down;
    pts.push({ t: b.t, up: du / dt, down: dd / dt });
  }
  return { pts: pts.slice(-60), unit: 'rate', hint: L('سرعت آپلود و دانلود مشترکین', 'Subscriber upload and download speed') };
}

function chartSvg(pts, unit) {
  if (!pts.length || pts.every((p) => !p.up && !p.down)) {
    return `<div class="empty">${L('هنوز ترافیکی ثبت نشده است.', 'No traffic recorded yet.')}</div>`;
  }
  const W = 640;
  const H = 220;
  const padB = 22;
  const padT = 10;
  const max = Math.max(1, ...pts.map((p) => Math.max(p.up, p.down)));
  const fmtV = (v) => (unit === 'rate' ? `${fmtBytes(v)}/s` : fmtBytes(v));
  const padL = 14 + 6.6 * Math.max(...[0, 0.5, 1].map((f) => fmtV(max * f).length));
  const x = (i) => padL + (i * (W - padL - 8)) / Math.max(1, pts.length - 1);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const path = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(' ');
  const area = `${path('down')} L${x(pts.length - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`;
  const ticks = [0, 0.5, 1].map((f) => `<line class="grid-line" x1="${padL}" x2="${W - 8}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="axis" x="${padL - 6}" y="${y(max * f) + 3.5}" text-anchor="end">${esc(fmtV(max * f))}</text>`).join('');
  const tl = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const xl = [0, Math.floor((pts.length - 1) / 2), pts.length - 1].map((i) => `<text class="axis" x="${x(i)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}">${tl(pts[i].t)}</text>`).join('');
  return `<svg class="chart ltr" viewBox="0 0 ${W} ${H}" role="img" aria-label="${L('نمودار ترافیک', 'Traffic chart')}">${ticks}${xl}<path class="area" d="${area}"/><path class="line down" d="${path('down')}"/><path class="line" d="${path('up')}"/></svg>
    <div class="legend"><span><i style="background:var(--info)"></i>${L('دانلود', 'Download')}</span><span><i style="background:var(--accent)"></i>${L('آپلود', 'Upload')}</span></div>`;
}

function notices(st) {
  const list = [...(st.warnings || [])];
  return list.map((w) => `<div class="notice ${w.level === 'bad' ? 'bad' : w.level === 'warn' ? 'warn' : 'info'}">${icon(w.level === 'info' ? 'info' : 'alert')}<div>${esc(L(w.fa, w.en))}</div></div>`).join('');
}

function renderOverview() {
  const st = S.state;
  const users = st.users;
  const active = users.filter((u) => u.status === 'active').length;
  const up = users.reduce((s, u) => s + u.usage.up, 0);
  const down = users.reduce((s, u) => s + u.usage.down, 0);
  const on = st.inbounds.filter((i) => i.enabled);
  let health;
  if (isWorker()) {
    health = { value: 'Cloudflare', sub: L('اجرا روی لبهٔ کلادفلر', 'Runs on the Cloudflare edge') };
  } else {
    const needed = ['xray', 'singbox'].filter((c) => on.some((i) => i.core === c));
    const running = needed.filter((c) => st.cores[c]?.status === 'running');
    health = { value: `${running.length} / ${needed.length}`, sub: L('هستهٔ لازم در حال اجرا', 'required cores running'), bad: running.length < needed.length };
  }
  const series = trafficSeries(st);
  const top = [...users].sort((a, b) => b.usage.total - a.usage.total).slice(0, 5);
  const endpoints = [
    [L('آدرس پنل', 'Panel URL'), st.facts.panelUrl],
    [L('پایهٔ لینک اشتراک', 'Subscription base'), st.facts.subBase],
    ...(!isWorker() ? [[L('پورت TCP عمومی', 'Public TCP port'), st.facts.tcpReady ? `${st.facts.tcpHost}:${st.facts.tcpPort}` : '']] : []),
  ].filter(([, v]) => v);
  return `
    ${notices(st)}
    <div class="grid g4">
      <div class="kpi"><span class="kpi-label">${icon('users', 'ic ic-sm')}${L('مشترکین فعال', 'Active subscribers')}</span><span class="kpi-value"><span class="ltr">${active} <span class="muted" style="font-size:15px">/ ${users.length}</span></span></span><span class="kpi-sub">${L(`سقف ${st.limits.maxUsers} کاربر`, `limit ${st.limits.maxUsers}`)}</span></div>
      <div class="kpi"><span class="kpi-label">${icon('traffic', 'ic ic-sm')}${L('مصرف کل مشترکین', 'Total subscriber usage')}</span><span class="kpi-value"><span class="ltr">${fmtBytes(up + down)}</span></span><span class="kpi-sub ltr">↑ ${fmtBytes(up)} · ↓ ${fmtBytes(down)}</span></div>
      <div class="kpi"><span class="kpi-label">${icon('layers', 'ic ic-sm')}${L('پروتکل‌های روشن', 'Protocols on')}</span><span class="kpi-value">${on.length}</span><span class="kpi-sub">${L(`از ${st.inbounds.length} پروتکل`, `of ${st.inbounds.length}`)}</span></div>
      <div class="kpi"><span class="kpi-label">${icon('server', 'ic ic-sm')}${L('وضعیت سرویس', 'Service status')}</span><span class="kpi-value" ${health.bad ? 'style="color:var(--bad)"' : ''}><span class="ltr">${esc(health.value)}</span></span><span class="kpi-sub">${esc(health.sub)}</span></div>
    </div>
    <div class="split">
      <section class="card">
        <div class="card-head"><h2>${L('ترافیک', 'Traffic')}</h2><span class="hint">${esc(series.hint)}</span></div>
        ${chartSvg(series.pts, series.unit)}
      </section>
      <section class="card">
        <div class="card-head"><h2>${L('بیشترین مصرف', 'Top usage')}</h2><div class="tools"><button class="btn ghost sm" type="button" data-act="page" data-arg="users">${L('همهٔ مشترکین', 'All subscribers')}</button></div></div>
        ${top.length ? `<div class="list">${top.map((u) => usageRow(u)).join('')}</div>` : `<div class="empty">${L('هنوز مشترکی ندارید.', 'No subscribers yet.')}</div>`}
      </section>
    </div>
    <div class="grid g2">
      <section class="card">
        <div class="card-head"><h2>${L('آدرس‌ها', 'Endpoints')}</h2></div>
        <div class="stack">${endpoints.map(([k, v]) => `<div class="field"><span>${esc(k)}</span>${copyLine(v)}</div>`).join('') || `<div class="empty">${L('دامنه هنوز تنظیم نشده است.', 'No domain configured yet.')}</div>`}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>${L('رویدادهای اخیر', 'Recent events')}</h2></div>
        ${(st.events || []).length ? `<div class="list">${st.events.slice(0, 7).map((e) => `<div class="list-row"><span class="tag">${esc(e.kind)}</span><span class="grow small ltr" style="text-align:start">${esc(e.message)}</span><span class="small muted nowrap">${relTime(e.t)}</span></div>`).join('')}</div>` : `<div class="empty">${L('رویدادی ثبت نشده است.', 'No events yet.')}</div>`}
      </section>
    </div>`;
}

function usageRow(u) {
  const pct = u.quotaBytes ? Math.min(100, (u.usage.total / u.quotaBytes) * 100) : 0;
  const cls = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : '';
  return `<div class="list-row"><div class="grow"><div class="row" style="gap:8px"><span class="title">${esc(u.name)}</span>${userPill(u)}</div>
    <div class="row small muted" style="gap:8px;margin-top:4px">${u.quotaBytes ? `<div class="meter ${cls} grow"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}<span class="num ltr">${fmtBytes(u.usage.total)}${u.quotaBytes ? ` / ${fmtBytes(u.quotaBytes)}` : ''}</span></div></div></div>`;
}

/* ── subscribers ────────────────────────────────────────────────────── */

function renderUsers() {
  const st = S.state;
  const q = S.filter.trim().toLowerCase();
  const list = st.users.filter((u) => {
    if (S.status === 'active' && u.status !== 'active') return false;
    if (S.status === 'inactive' && u.status === 'active') return false;
    return !q || u.name.toLowerCase().includes(q) || (u.note || '').toLowerCase().includes(q);
  });
  const seg = (v, fa, en) => `<button type="button" data-act="status-filter" data-arg="${v}" aria-pressed="${S.status === v}">${L(fa, en)}</button>`;
  return `
    <div class="row">
      <input class="input" style="max-width:280px" id="user-search" type="search" placeholder="${L('جستجو در نام یا یادداشت', 'Search name or note')}" value="${esc(S.filter)}" aria-label="${L('جستجو', 'Search')}">
      <div class="seg">${seg('all', 'همه', 'All')}${seg('active', 'فعال', 'Active')}${seg('inactive', 'غیرفعال', 'Inactive')}</div>
      <span class="grow"></span>
      <button class="btn primary" type="button" data-act="user-new">${icon('plus', 'ic ic-sm')}${L('مشترک جدید', 'New subscriber')}</button>
    </div>
    ${list.length ? `<div class="table-wrap"><table class="tbl stackable">
      <thead><tr><th>${L('نام', 'Name')}</th><th>${L('وضعیت', 'Status')}</th><th>${L('مصرف', 'Usage')}</th><th>${L('انقضا', 'Expires')}</th><th>${L('آخرین اتصال', 'Last seen')}</th><th><span class="hide-sm">${L('عملیات', 'Actions')}</span></th></tr></thead>
      <tbody>${list.map(userRow).join('')}</tbody></table></div>`
      : `<div class="card empty">${st.users.length ? L('مشترکی با این فیلتر پیدا نشد.', 'No subscriber matches this filter.') : L('اولین مشترک را بسازید تا لینک اتصال بگیرد.', 'Create the first subscriber to get a connection link.')}</div>`}`;
}

function userRow(u) {
  const pct = u.quotaBytes ? Math.min(100, (u.usage.total / u.quotaBytes) * 100) : 0;
  const cls = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : '';
  const dl = daysLeft(u.expiresAt);
  const b = (act, ic, label, extra = '') => `<button class="btn ghost sm icon ${extra}" type="button" data-act="${act}" data-arg="${u.id}" title="${esc(label)}" aria-label="${esc(label)}">${icon(ic, 'ic ic-sm')}</button>`;
  return `<tr>
    <td><div class="title">${esc(u.name)}</div>${u.note ? `<div class="small muted">${esc(u.note)}</div>` : ''}</td>
    <td>${userPill(u)}</td>
    <td style="min-width:170px" data-label="${esc(L('مصرف', 'Usage'))}"><div class="small"><span class="ltr num">${fmtBytes(u.usage.total)} ${u.quotaBytes ? `/ ${fmtBytes(u.quotaBytes)}` : `<span class="muted">/ ∞</span>`}</span></div>${u.quotaBytes ? `<div class="meter ${cls}" style="margin-top:5px"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}</td>
    <td class="small" data-label="${esc(L('انقضا', 'Expires'))}">${u.expiresAt ? `${fmtDate(u.expiresAt)}<div class="muted">${dl > 0 ? L(`${dl} روز مانده`, `${dl} days left`) : L('منقضی شده', 'expired')}</div>` : `<span class="muted">${L('بدون انقضا', 'Never')}</span>`}</td>
    <td class="small muted" data-label="${esc(L('آخرین اتصال', 'Last seen'))}">${relTime(u.lastSeen)}</td>
    <td><div class="actions">
      ${b('user-links', 'qr', L('لینک‌ها و QR', 'Links & QR'))}
      ${b('user-edit', 'edit', L('ویرایش', 'Edit'))}
      ${b('user-toggle', u.enabled ? 'ban' : 'check', u.enabled ? L('غیرفعال کردن', 'Disable') : L('فعال کردن', 'Enable'))}
      ${b('user-reset', 'refresh', L('صفر کردن مصرف', 'Reset usage'))}
      ${b('user-rotate', 'key', L('تعویض کلید و لینک', 'Rotate keys & link'))}
      ${b('user-delete', 'trash', L('حذف', 'Delete'))}
    </div></td></tr>`;
}

function userForm(u) {
  const left = u?.expiresAt ? daysLeft(u.expiresAt) : null;
  const days = left !== null && left > 0 ? left : '';
  const quota = u?.quotaBytes ? String(+(u.quotaBytes / GB).toFixed(3)) : '';
  return `<form class="stack" id="user-form" data-id="${u ? esc(u.id) : ''}">
    <div class="form-grid">
      <label class="field"><span>${L('نام', 'Name')}</span><input class="input" name="name" maxlength="64" required value="${esc(u?.name || '')}" placeholder="${L('مثلاً گوشی علی', 'e.g. Ali phone')}"></label>
      <label class="field"><span>${L('حجم (گیگابایت)', 'Data limit (GB)')}</span><input class="input ltr" name="quotaGb" type="number" min="0" step="any" value="${quota}" data-orig="${quota}" placeholder="0 = ∞"></label>
      <label class="field"><span>${u ? L('اعتبار از امروز (روز)', 'Valid from today (days)') : L('اعتبار (روز)', 'Valid for (days)')}</span><input class="input ltr" name="days" type="number" min="0" step="1" value="${days}" data-orig="${days}" placeholder="0 = ∞"><small>${!u ? L('خالی یا ۰ یعنی بدون انقضا.', 'Empty or 0 means it never expires.') : left !== null && left <= 0 ? L('منقضی شده است؛ برای تمدید تعداد روز را بنویسید.', 'Expired; enter a number of days to renew.') : L('اگر تغییرش ندهید، تاریخ فعلی می‌ماند.', 'Unchanged keeps the current date.')}</small></label>
    </div>
    <label class="field"><span>${L('یادداشت', 'Note')}</span><input class="input" name="note" maxlength="200" value="${esc(u?.note || '')}"></label>
    <div class="form-actions"><button class="btn" type="button" data-act="modal-close">${L('انصراف', 'Cancel')}</button><button class="btn primary" type="submit">${u ? L('ذخیره', 'Save') : L('ساخت مشترک', 'Create subscriber')}</button></div>
  </form>`;
}

const FORMATS = [
  ['base64', 'v2rayNG · Hiddify · Streisand', ''],
  ['singbox', 'sing-box · Hiddify', '/singbox'],
  ['xray', 'v2rayN · Xray JSON', '/xray'],
  ['clash', 'Clash Verge · Mihomo', '/clash'],
  ['links', L('متن ساده', 'Plain text'), '/links'],
];
const subUrlFor = (u, fmt) => `${u.subUrl}${(FORMATS.find((f) => f[0] === fmt) || FORMATS[0])[2]}`;

function linksBody(u) {
  const fmt = S.linksFormat;
  const url = subUrlFor(u, fmt);
  return `
    <div class="row" style="align-items:flex-start;gap:18px">
      <div class="qr" aria-label="QR">${qrSvg(url)}</div>
      <div class="stack grow">
        <div class="seg" role="group">${FORMATS.map(([f]) => `<button type="button" data-act="links-format" data-arg="${f}" aria-pressed="${fmt === f}">${f}</button>`).join('')}</div>
        <div class="small muted">${esc((FORMATS.find((f) => f[0] === fmt) || FORMATS[0])[1])}</div>
        ${copyLine(url)}
        ${u.portalUrl ? `<div class="field"><span>${L('صفحهٔ مشترک (برای ارسال به کاربر)', 'Subscriber page (send this to the user)')}</span>${copyLine(u.portalUrl)}</div>` : ''}
      </div>
    </div>
    <hr class="sep">
    <div class="section-title">${L('لینک‌های تکی', 'Single links')}</div>
    ${u.links.length ? `<div class="stack">${u.links.map((l) => copyLine(l.uri, { qr: true, label: l.short || l.label })).join('')}</div>`
      : `<div class="notice warn">${icon('alert')}<div>${L('این مشترک فعال نیست یا هیچ پروتکلی روشن نیست، پس لینکی ندارد.', 'This subscriber is inactive or no protocol is on, so there are no links.')}</div></div>`}`;
}

/* ── protocols ──────────────────────────────────────────────────────── */

function renderProtocols() {
  const st = S.state;
  const plan = st.plan || {};
  const conflicts = [
    ...(plan.sniConflicts || []).map((c) => L(`SNI «${c.sni}» دو بار استفاده شده؛ «${c.droppedLabel}» مسیریابی نمی‌شود.`, `SNI "${c.sni}" is used twice; "${c.droppedLabel}" is not routed.`)),
    ...(plan.opaqueConflicts || []).map((c) => L(`فقط یک Shadowsocks روی پورت مشترک کار می‌کند؛ «${c.droppedLabel}» مسیریابی نمی‌شود.`, `Only one Shadowsocks fits the shared port; "${c.droppedLabel}" is not routed.`)),
  ];
  const rows = st.inbounds.map((ib) => {
    const reach = ib.reachable ? pill('ok', L('در دسترس', 'Reachable')) : pill('warn', ib.reason ? L(ib.reason.fa, ib.reason.en) : L('در دسترس نیست', 'Unreachable'));
    return `<tr>
      <td style="width:52px">${sw('inbound-toggle', ib.enabled, ib.id, L('روشن/خاموش', 'On/off'))}</td>
      <td><div class="title">${esc(L(ib.title?.fa || ib.label, ib.title?.en || ib.label))}</div><div class="small muted">${esc(L(ib.desc?.fa || '', ib.desc?.en || ''))}</div></td>
      <td><div class="row" style="gap:5px"><span class="tag">${esc(ib.core === 'singbox' ? 'sing-box' : ib.core)}</span><span class="tag">${esc(ib.transport)}</span><span class="tag">${esc(ib.security)}</span></div></td>
      <td>${ib.enabled ? reach : pill('mute', L('خاموش', 'Off'))}</td>
      <td class="small" data-label="${esc(L('مسیر/پورت', 'Path/port'))}"><span class="mono ltr">${isWorker() ? esc(ib.params?.path || '') : esc(ib.edge === 'http' ? `/${ib.routeKey}` : ib.udp ? `udp :${ib.port}` : `:${ib.port}`)}</span></td>
      <td><div class="actions">${!isWorker() ? `
        <button class="btn ghost sm icon" type="button" data-act="inbound-edit" data-arg="${ib.id}" aria-label="${L('ویرایش', 'Edit')}" title="${L('ویرایش', 'Edit')}">${icon('edit', 'ic ic-sm')}</button>
        <button class="btn ghost sm icon" type="button" data-act="inbound-delete" data-arg="${ib.id}" aria-label="${L('حذف', 'Delete')}" title="${L('حذف', 'Delete')}">${icon('trash', 'ic ic-sm')}</button>` : ''}</div></td>
    </tr>`;
  }).join('');
  return `
    ${isWorker() ? `<div class="notice info">${icon('info')}<div>${L('نسخهٔ Worker فقط VLESS و Trojan روی WebSocket را پشتیبانی می‌کند. برای REALITY، AnyTLS و Shadowsocks به نسخهٔ سرور (VPS) نیاز دارید.', 'The Worker edition supports VLESS and Trojan over WebSocket only. REALITY, AnyTLS and Shadowsocks need the server (VPS) edition.')}</div></div>` : ''}
    ${conflicts.map((c) => `<div class="notice warn">${icon('alert')}<div>${esc(c)}</div></div>`).join('')}
    <div class="row"><span class="muted small grow">${L('تغییرها بلافاصله روی کانفیگ هسته‌ها اعمال می‌شوند.', 'Changes are applied to the cores right away.')}</span>
      ${!isWorker() ? `<button class="btn primary" type="button" data-act="inbound-new">${icon('plus', 'ic ic-sm')}${L('افزودن پروتکل', 'Add protocol')}</button>` : ''}</div>
    <div class="table-wrap"><table class="tbl stackable"><thead><tr><th></th><th>${L('پروتکل', 'Protocol')}</th><th>${L('مشخصات', 'Details')}</th><th>${L('دسترسی', 'Reach')}</th><th>${L('مسیر/پورت', 'Path/port')}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function inboundForm(ib) {
  const fields = ib.fields || [];
  return `<form class="stack" id="inbound-form" data-id="${esc(ib.id)}">
    <label class="field"><span>${L('نام نمایشی', 'Label')}</span><input class="input" name="label" maxlength="60" value="${esc(ib.label)}"></label>
    <div class="form-grid">${fields.map((f) => {
      const v = ib.params?.[f.key] ?? '';
      const lab = L(f.label.fa, f.label.en);
      if (f.type === 'select') return `<label class="field"><span>${esc(lab)}</span><select class="input" name="p:${f.key}">${f.options.map((o) => `<option value="${esc(o)}" ${String(v) === o ? 'selected' : ''}>${esc(o || '—')}</option>`).join('')}</select></label>`;
      return `<label class="field"><span>${esc(lab)}</span><input class="input ${f.mono ? 'mono ltr' : ''}" name="p:${f.key}" type="${f.type === 'number' ? 'number' : 'text'}" value="${esc(v)}"></label>`;
    }).join('')}</div>
    <div class="form-actions"><button class="btn" type="button" data-act="modal-close">${L('انصراف', 'Cancel')}</button><button class="btn primary" type="submit">${L('ذخیره و اعمال', 'Save & apply')}</button></div>
  </form>`;
}

/* ── delivery ───────────────────────────────────────────────────────── */

const CLIENTS = [
  { name: 'v2rayNG', file: 'v2rayng.png', url: 'https://github.com/2dust/v2rayNG/releases', os: 'Android' },
  { name: 'Hiddify', file: 'hiddify.svg', url: 'https://github.com/hiddify/hiddify-app/releases', os: 'Android · iOS · Desktop' },
  { name: 'sing-box', file: 'sing-box.svg', url: 'https://github.com/SagerNet/sing-box/releases', os: 'iOS · Android · Desktop' },
  { name: 'Clash Verge', file: 'clash-verge.svg', url: 'https://github.com/clash-verge-rev/clash-verge-rev/releases', os: 'Windows · macOS · Linux' },
  { name: 'Karing', file: 'karing.png', url: 'https://github.com/KaringX/karing/releases', os: 'iOS · Android · Desktop' },
  { name: 'v2rayN', file: 'v2rayn.png', url: 'https://github.com/2dust/v2rayN/releases', os: 'Windows · macOS · Linux' },
];

function renderDelivery() {
  const st = S.state;
  const users = st.users;
  if (!S.deliveryUser || !users.some((u) => u.id === S.deliveryUser)) S.deliveryUser = (users.find((u) => u.status === 'active') || users[0])?.id || '';
  const u = users.find((x) => x.id === S.deliveryUser);
  return `
    <section class="card">
      <div class="card-head"><h2>${L('لینک‌های اشتراک', 'Subscription links')}</h2><span class="hint">${L('هر کلاینت فرمت خودش را می‌خواهد؛ لینک اشتراک خودکار به‌روز می‌شود.', 'Each client wants its own format; subscriptions update automatically.')}</span>
        <div class="tools">${users.length ? `<select class="input" style="height:30px;width:auto" id="delivery-user" aria-label="${L('مشترک', 'Subscriber')}">${users.map((x) => `<option value="${esc(x.id)}" ${x.id === S.deliveryUser ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}</div></div>
      ${u ? `<div class="table-wrap"><table class="tbl stackable"><thead><tr><th>${L('فرمت', 'Format')}</th><th>${L('مناسب برای', 'Works with')}</th><th>${L('لینک', 'Link')}</th></tr></thead><tbody>
        ${FORMATS.map(([f, apps]) => `<tr><td class="mono">${f}</td><td class="small">${esc(apps)}</td><td style="min-width:240px">${copyLine(subUrlFor(u, f), { qr: true })}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="field" style="margin-top:14px"><span>${L('صفحهٔ مشترک', 'Subscriber page')}</span>${copyLine(u.portalUrl)}<small>${L('این صفحه مصرف، تاریخ انقضا و لینک‌ها را به خود کاربر نشان می‌دهد.', 'Shows the user their usage, expiry and links.')}</small></div>`
        : `<div class="empty">${L('ابتدا یک مشترک بسازید.', 'Create a subscriber first.')}</div>`}
    </section>
    <section class="card">
      <div class="card-head"><h2>${L('کلاینت‌های پیشنهادی', 'Recommended clients')}</h2></div>
      <div class="client-grid">${CLIENTS.map((c) => `<a class="client" href="${c.url}" target="_blank" rel="noopener noreferrer"><img src="${esc(assetUrl(c.file))}" alt="" loading="lazy"><span>${esc(c.name)}<small>${esc(c.os)}</small></span></a>`).join('')}</div>
    </section>`;
}
function assetUrl(file) {
  return (window.__ASSETS && window.__ASSETS[file]) || `assets/${file}`;
}

/* ── quick setup (server edition) ───────────────────────────────────── */

async function loadEasy() {
  try {
    S.easy = await api('/api/easy-setup');
    if (S.page === 'easy') render();
  } catch (err) { toast(err.message, 'warn'); }
}
function renderEasy() {
  const a = S.easy?.analysis;
  if (!a) return `<div class="card empty"><span class="spinner"></span>${L('در حال بررسی…', 'Checking…')}</div>`;
  return `
    <section class="card"><div class="card-head"><h2>${L('بررسی وضعیت', 'Health checks')}</h2><div class="tools"><button class="btn ghost sm" type="button" data-act="easy-refresh">${icon('refresh', 'ic ic-sm')}${L('بررسی دوباره', 'Re-check')}</button></div></div>
      <div class="list">${a.checks.map((c) => `<div class="list-row">${c.ok ? pill('ok', L('درست', 'OK')) : pill('warn', L('نیاز به کار', 'Needs work'))}<span class="grow">${esc(L(c.fa, c.en))}</span></div>`).join('')}</div></section>
    <div class="section-title">${L('پروفایل‌های آماده', 'Ready-made profiles')}</div>
    <div class="grid g3">${a.profiles.map((p) => `<section class="card stack">
      <div><div class="title" style="font-weight:700">${esc(L(p.fa, p.en))}</div><div class="small muted">${esc(L(p.taglineFa, p.taglineEn))}</div></div>
      <ul class="small" style="margin:0;padding-inline-start:18px;color:var(--ink-2)">${(S.lang === 'en' ? p.notesEn : p.notesFa).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      <div class="row" style="margin-top:auto"><span class="small muted grow">${L(`${p.count} پروتکل`, `${p.count} protocols`)}</span><button class="btn primary sm" type="button" data-act="easy-apply" data-arg="${esc(p.id)}">${L('اعمال', 'Apply')}</button></div>
    </section>`).join('')}</div>
    <section class="card"><div class="card-head"><h2>${L('نکته‌ها', 'Tips')}</h2></div><ul class="small" style="margin:0;padding-inline-start:18px;display:flex;flex-direction:column;gap:6px">${a.tips.map((t) => `<li>${esc(L(t.fa, t.en))}</li>`).join('')}</ul></section>`;
}

/* ── telegram (server edition) ──────────────────────────────────────── */

function renderTelegram() {
  const tg = S.state.telegram;
  const ready = S.state.facts.tcpReady;
  const mt = tg.mtproto;
  return `
    ${!ready ? `<div class="notice warn">${icon('alert')}<div>${L('پورت TCP عمومی تنظیم نشده؛ لینک‌های تلگرام بعد از تنظیم آن در «تنظیمات» ساخته می‌شوند.', 'No public TCP port yet; Telegram links appear after you set it in Settings.')}</div></div>` : ''}
    <div class="notice info">${icon('info')}<div>${L('هر سه پروکسی روی همان پورت TCP پنل کار می‌کنند. وقتی خاموش باشند، پورت این نوع اتصال را رد می‌کند.', 'All three proxies share the panel TCP port. When off, the port refuses that kind of connection.')}</div></div>
    <section class="card">
      <div class="card-head"><h2>MTProto (FakeTLS)</h2>${corePill(mt.state?.status)}${mt.conflict ? pill('warn', L('تداخل SNI با REALITY', 'SNI clash with REALITY')) : ''}<div class="tools">${sw('tg-toggle', mt.enabled, 'mtproto', 'MTProto')}</div></div>
      <form class="stack" id="tg-mtproto">
        <div class="form-grid">
          <label class="field"><span>${L('دامنهٔ FakeTLS', 'FakeTLS domain')}</span><input class="input mono ltr" name="faketlsHost" value="${esc(mt.faketlsHost || '')}"><small>${L('باید با SNI پروتکل‌های REALITY فرق داشته باشد.', 'Must differ from your REALITY SNI.')}</small></label>
          <label class="field"><span>${L('تگ تبلیغاتی (اختیاری)', 'Ad tag (optional)')}</span><input class="input mono ltr" name="adTag" value="${esc(mt.adTag || '')}"></label>
        </div>
        <div class="form-actions"><button class="btn" type="button" data-act="tg-secret">${icon('key', 'ic ic-sm')}${L('سکرت جدید', 'New secret')}</button><button class="btn primary" type="submit">${L('ذخیره', 'Save')}</button></div>
      </form>
      ${mt.links?.web ? `<div class="stack" style="margin-top:12px">${copyLine(mt.links.web, { qr: true, label: 't.me' })}${copyLine(mt.links.app, { label: 'tg://' })}</div>` : ''}
    </section>
    <div class="grid g2">
      ${proxyCard('socks', 'SOCKS5', tg.socks)}
      ${proxyCard('http', 'HTTP CONNECT', tg.http)}
    </div>`;
}
function proxyCard(kind, title, p) {
  return `<section class="card">
    <div class="card-head"><h2>${title}</h2><span class="small muted ltr">conns ${S.state.cores[kind === 'socks' ? 'socks5' : 'http']?.conns || 0}</span><div class="tools">${sw('tg-toggle', p.enabled, kind, title)}</div></div>
    <form class="stack" id="tg-${kind}">
      <div class="form-grid">
        <label class="field"><span>${L('نام کاربری', 'Username')}</span><input class="input mono ltr" name="user" value="${esc(p.user || '')}" required></label>
        <label class="field"><span>${L('رمز', 'Password')}</span><input class="input mono ltr" name="pass" value="${esc(p.pass || '')}" minlength="8" required></label>
      </div>
      <div class="form-actions"><button class="btn primary" type="submit">${L('ذخیره', 'Save')}</button></div>
    </form>
    ${p.link ? `<div style="margin-top:12px">${copyLine(p.link, { qr: kind === 'socks' })}</div>` : ''}
  </section>`;
}

/* ── scanner (server edition) ───────────────────────────────────────── */

async function loadScan() {
  try {
    S.scan = await api('/api/railynx');
    if (S.page === 'scanner') render();
    if (S.scan.running) startScanPoll();
  } catch (err) { toast(err.message, 'warn'); }
}
function startScanPoll() {
  clearInterval(S.timers.scan);
  S.timers.scan = setInterval(async () => {
    try {
      S.scan = await api('/api/railynx');
      if (S.page === 'scanner') render();
      if (!S.scan.running) clearInterval(S.timers.scan);
    } catch { clearInterval(S.timers.scan); }
  }, 1500);
}
function renderScanner() {
  const sc = S.scan;
  const vless = S.state.users.flatMap((u) => u.links.filter((l) => l.protocol === 'vless' && l.transport !== 'tcp').map((l) => ({ uri: l.uri, label: `${u.name} · ${l.short || l.label}` })));
  const pct = sc && sc.total ? Math.round((sc.checked / sc.total) * 100) : 0;
  return `
    <div class="notice info">${icon('info')}<div>${L('این ابزار از خود سرور، IPهای یک رنج کلادفلر را با لینک VLESS شما تست می‌کند و آن‌هایی که سه بار پشت سر هم بدون خطا جواب بدهند را رتبه‌بندی می‌کند. نتیجه از دید سرور است، نه از دید اینترنت ایران.', 'Tests a Cloudflare range from the server with your VLESS link and ranks IPs that answer three times in a row. Results reflect the server\'s network, not Iran\'s.')}</div></div>
    <section class="card">
      <form class="stack" id="scan-form">
        <label class="field"><span>${L('لینک VLESS (WebSocket/CDN)', 'VLESS link (WebSocket/CDN)')}</span>
          ${vless.length ? `<select class="input" name="pick"><option value="">${L('— انتخاب از لینک‌های پنل —', '— pick from panel links —')}</option>${vless.map((v) => `<option value="${esc(v.uri)}">${esc(v.label)}</option>`).join('')}</select>` : ''}
          <input class="input mono ltr" name="link" placeholder="vless://…" value="${esc(S.scanLink || '')}"></label>
        <div class="form-grid">
          <label class="field"><span>${L('رنج IP', 'IP range')}</span><input class="input mono ltr" name="cidr" value="${esc(sc?.cidr || sc?.defaults?.cidr || '104.18.0.0/24')}"></label>
          <label class="field"><span>${L('تعداد هم‌زمان', 'Workers')}</span><input class="input ltr" name="concurrency" type="number" min="1" max="32" value="${esc(sc?.concurrency || 16)}"></label>
        </div>
        <div class="form-actions">${sc?.running ? `<button class="btn danger" type="button" data-act="scan-cancel">${L('توقف', 'Stop')}</button>` : `<button class="btn primary" type="submit">${icon('radar', 'ic ic-sm')}${L('شروع اسکن', 'Start scan')}</button>`}</div>
      </form>
    </section>
    ${sc && sc.total ? `<section class="card">
      <div class="card-head"><h2>${L('نتیجه', 'Results')}</h2><span class="hint num">${sc.checked}/${sc.total} · ${L('سالم', 'alive')} ${sc.alive} · ${L('ناموفق', 'failed')} ${sc.failed}</span></div>
      <div class="meter" style="margin-bottom:14px"><i style="width:${pct}%"></i></div>
      ${sc.results?.length ? `<div class="table-wrap"><table class="tbl stackable"><thead><tr><th>IP</th><th>${L('تأخیر', 'Latency')}</th><th>${L('نوسان', 'Jitter')}</th><th>${L('امتیاز', 'Score')}</th><th></th></tr></thead><tbody>
        ${sc.results.slice(0, 50).map((r) => `<tr><td class="mono ltr">${esc(r.ip)}</td><td>${nb(`${r.latency} ms`)}</td><td>${nb(`${r.jitter} ms`)}</td><td class="num">${r.score}</td><td><div class="actions"><button class="btn ghost sm" type="button" data-act="copy" data-arg="${esc(r.link)}">${icon('copy', 'ic ic-sm')}${L('کپی لینک', 'Copy link')}</button></div></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">${sc.running ? L('هنوز IP سالمی پیدا نشده…', 'No healthy IP yet…') : L('IP سالمی پیدا نشد.', 'No healthy IP found.')}</div>`}
    </section>` : ''}`;
}

/* ── cores & logs (server edition) ──────────────────────────────────── */

function coreCard(id, title, c) {
  return `<section class="card core-card">
    <div class="card-head" style="margin:0"><h3>${title}</h3>${corePill(c?.status)}</div>
    <dl class="kv">
      ${c?.version ? `<dt>${L('نسخه', 'Version')}</dt><dd><span class="mono small ltr">${esc(c.version)}</span></dd>` : ''}
      ${c?.uptimeMs !== undefined ? `<dt>${L('زمان اجرا', 'Uptime')}</dt><dd>${nb(fmtUptime(c.uptimeMs))}</dd>` : ''}
      ${c?.restarts !== undefined ? `<dt>${L('ری‌استارت', 'Restarts')}</dt><dd>${nb(c.restarts)}</dd>` : ''}
      ${c?.active !== undefined ? `<dt>${L('اتصال فعال', 'Active connections')}</dt><dd>${nb(c.active)}</dd><dt>${L('کل اتصال‌ها', 'Total connections')}</dt><dd>${nb(c.total)}</dd>` : ''}
    </dl>
    ${c?.lastError ? `<div class="notice bad">${icon('alert')}<div class="small" dir="ltr" style="text-align:left">${esc(c.lastError)}</div></div>` : ''}
    ${id !== 'mux' ? `<div class="core-foot"><button class="btn sm" type="button" data-act="core-restart" data-arg="${id}">${icon('refresh', 'ic ic-sm')}${L('ری‌استارت', 'Restart')}</button></div>` : ''}
  </section>`;
}
function renderCores() {
  const c = S.state.cores;
  const seg = (v, label) => `<button type="button" data-act="log-source" data-arg="${v}" aria-pressed="${S.logSource === v}">${label}</button>`;
  return `
    <div class="grid g4">${coreCard('xray', 'Xray-core', c.xray)}${coreCard('singbox', 'sing-box', c.singbox)}${coreCard('mtproto', 'MTProto (mtg)', c.mtproto)}${coreCard('mux', L('مالتی‌پلکسر TCP', 'TCP multiplexer'), { status: c.mux?.listening ? 'running' : 'stopped', active: c.mux?.active || 0, total: c.mux?.total || 0 })}</div>
    <section class="card">
      <div class="card-head"><h2>${L('لاگ‌ها', 'Logs')}</h2><div class="seg">${seg('xray', 'Xray')}${seg('singbox', 'sing-box')}${seg('mtproto', 'MTProto')}</div>
        <div class="tools">${feat('raw') ? `<button class="btn ghost sm" type="button" data-act="raw-open" data-arg="xray">Xray JSON</button><button class="btn ghost sm" type="button" data-act="raw-open" data-arg="singbox">sing-box JSON</button>` : ''}</div></div>
      <div class="console" id="console">${L('در حال بارگذاری…', 'Loading…')}</div>
    </section>`;
}
async function refreshLogs() {
  if (S.page !== 'cores' || !feat('logs')) return;
  try {
    const r = await api(`/api/logs?source=${S.logSource}`);
    const el = $('#console');
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
    if (r.lines.length) el.textContent = r.lines.join('\n');
    else el.innerHTML = `<div class="empty">${L('هنوز لاگی ثبت نشده است.', 'No log lines yet.')}</div>`;
    if (atBottom) el.scrollTop = el.scrollHeight;
  } catch { /* ignore */ }
}

/* ── settings ───────────────────────────────────────────────────────── */

function renderSettings() {
  const st = S.state;
  const s = st.settings;
  const general = isWorker()
    ? `<label class="field"><span>${L('دامنهٔ شخصی (اختیاری)', 'Custom domain (optional)')}</span><input class="input mono ltr" name="publicHost" value="${esc(s.publicHost || '')}" placeholder="vpn.example.com"><small>${L('اگر دامنه‌ات را در کلادفلر به این Worker وصل کرده‌ای، اینجا بنویس تا لینک‌ها با آن ساخته شوند.', 'If you routed your own domain to this Worker, set it so links use it.')}</small></label>
       <label class="field"><span>${L('IPهای تمیز کلادفلر', 'Clean Cloudflare IPs')}</span><input class="input mono ltr" name="cleanIps" value="${esc(s.cleanIps || '')}" placeholder="104.16.1.1, 172.67.2.2"><small>${L('برای هر IP یک لینک جدا ساخته می‌شود (حداکثر ۵).', 'Each IP gets its own link (up to 5).')}</small></label>
       <label class="field"><span>ProxyIP</span><input class="input mono ltr" name="proxyIp" value="${esc(s.proxyIp || '')}" placeholder="proxyip.example.com:443"><small>${L('برای باز شدن سایت‌هایی که خودشان پشت کلادفلر هستند لازم است. این سرور مقصد اتصال‌ها را می‌بیند؛ فقط از منبع مورد اعتماد استفاده کن.', 'Needed for sites that are themselves behind Cloudflare. That server sees connection destinations; use one you trust.')}</small></label>`
    : `<div class="form-grid">
        <label class="field"><span>${L('دامنهٔ عمومی HTTPS', 'Public HTTPS domain')}</span><input class="input mono ltr" name="publicHost" value="${esc(s.publicHost || '')}" placeholder="${esc(st.facts.publicHost || 'panel.example.com')}"></label>
        <label class="field"><span>${L('هاست TCP عمومی', 'Public TCP host')}</span><input class="input mono ltr" name="tcpHost" value="${esc(s.tcpHost || '')}" placeholder="${esc(st.facts.tcpHost || '')}"></label>
        <label class="field"><span>${L('پورت TCP عمومی', 'Public TCP port')}</span><input class="input ltr" name="tcpPort" type="number" min="0" max="65535" value="${esc(s.tcpPort || '')}" placeholder="${esc(st.facts.tcpPort || '')}"></label>
      </div><small class="muted">${L('خالی بگذارید تا مقدار خودکار محیط استفاده شود.', 'Leave empty to use the value detected from the environment.')}</small>`;
  return `
    <section class="card">
      <div class="card-head"><h2>${L('اتصال', 'Connection')}</h2></div>
      <form class="stack" id="settings-form">
        ${general}
        <label class="check-row">${sw('noop', s.fragment !== false, '', 'fragment').replace('data-act="noop"', 'name="fragment"')}<span>${L('فرگمنت TLS در خروجی‌های JSON (کمک به عبور از DPI)', 'TLS fragment in JSON subscriptions (helps against DPI)')}</span></label>
        <div class="form-actions"><button class="btn primary" type="submit">${L('ذخیره', 'Save')}</button></div>
      </form>
    </section>
    <div class="grid g2">
      <section class="card">
        <div class="card-head"><h2>${L('رمز مدیر', 'Admin password')}</h2></div>
        <form class="stack" id="password-form">
          <label class="field"><span>${L('رمز فعلی', 'Current password')}</span><input class="input ltr" name="current" type="password" autocomplete="current-password" required></label>
          <label class="field"><span>${L('رمز جدید (حداقل ۱۰ حرف)', 'New password (10+ characters)')}</span><input class="input ltr" name="password" type="password" autocomplete="new-password" minlength="10" required></label>
          <label class="field"><span>${L('تکرار رمز جدید', 'Repeat new password')}</span><input class="input ltr" name="password2" type="password" autocomplete="new-password" required></label>
          <div class="form-actions"><button class="btn primary" type="submit">${L('تغییر رمز', 'Change password')}</button></div>
        </form>
      </section>
      <section class="card stack">
        <div class="card-head" style="margin:0"><h2>${L('پشتیبان', 'Backup')}</h2></div>
        <p class="small muted" style="margin:0">${L('فایل پشتیبان شامل کلیدها و رمزهاست؛ آن را جای امن نگه دارید.', 'The backup contains keys and passwords; keep it somewhere safe.')}</p>
        <div class="row"><button class="btn" type="button" data-act="backup">${icon('download', 'ic ic-sm')}${L('دانلود پشتیبان', 'Download backup')}</button>
          <label class="btn">${icon('upload', 'ic ic-sm')}${L('بازیابی از فایل', 'Restore from file')}<input type="file" id="restore-file" accept="application/json,.json" hidden></label></div>
        <hr class="sep">
        <div class="card-head" style="margin:0"><h2>${L('ظاهر', 'Appearance')}</h2></div>
        <div class="row"><div class="seg"><button type="button" data-act="theme-set" data-arg="dark" aria-pressed="${S.theme === 'dark'}">${L('تیره', 'Dark')}</button><button type="button" data-act="theme-set" data-arg="light" aria-pressed="${S.theme === 'light'}">${L('روشن', 'Light')}</button></div>
          <div class="seg"><button type="button" data-act="lang-set" data-arg="fa" aria-pressed="${S.lang === 'fa'}">فارسی</button><button type="button" data-act="lang-set" data-arg="en" aria-pressed="${S.lang === 'en'}">English</button></div></div>
      </section>
    </div>
    ${feat('update') ? `<section class="card" id="update-card">${updateBody()}</section>` : ''}
    <section class="card"><div class="card-head"><h2>${L('درباره', 'About')}</h2></div>
      <dl class="kv"><dt>${L('نسخه', 'Version')}</dt><dd class="mono">${esc(st.app.version)}</dd><dt>${L('نسخهٔ اجرا', 'Edition')}</dt><dd>${isWorker() ? 'Cloudflare Worker' : L('سرور (Xray + sing-box)', 'Server (Xray + sing-box)')}</dd>
      ${!isWorker() && st.facts.dataDir ? `<dt>${L('پوشهٔ داده', 'Data folder')}</dt><dd class="mono small ltr" style="text-align:start">${esc(st.facts.dataDir)}</dd>` : ''}</dl></section>`;
}
function updateBody() {
  const u = S.update;
  return `<div class="card-head"><h2>${L('به‌روزرسانی', 'Updates')}</h2><div class="tools"><button class="btn ghost sm" type="button" data-act="update-check">${icon('refresh', 'ic ic-sm')}${L('بررسی', 'Check')}</button></div></div>
    ${!u ? `<div class="small muted">${L('هنوز بررسی نشده است.', 'Not checked yet.')}</div>`
      : !u.repo ? `<div class="small muted">${L('مخزن به‌روزرسانی تنظیم نشده (متغیر BBG_UPDATE_REPO).', 'No update repository configured (BBG_UPDATE_REPO).')}</div>`
      : u.updateAvailable ? `<div class="row"><span class="grow">${L(`نسخهٔ ${esc(u.latest)} آماده است.`, `Version ${esc(u.latest)} is available.`)}</span><button class="btn primary sm" type="button" data-act="update-apply">${L('نصب و ری‌استارت', 'Install & restart')}</button></div>${u.notes ? `<pre class="console" style="height:auto;max-height:200px">${esc(u.notes)}</pre>` : ''}`
      : `<div class="small">${L(`آخرین نسخه نصب است (${esc(u.current)}).`, `You are on the latest version (${esc(u.current)}).`)}</div>`}
    ${u?.error ? `<div class="small" style="color:var(--bad)">${esc(u.error)}</div>` : ''}`;
}
async function checkUpdate(force) {
  try {
    S.update = await api(`/api/update${force ? '?force=1' : ''}`);
    const card = $('#update-card');
    if (card) card.innerHTML = updateBody();
  } catch (err) { if (force) toast(err.message, 'warn'); }
}

/* ── modal ──────────────────────────────────────────────────────────── */

function openModal(title, body, { wide = false } = {}) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = body;
  $('#modal-card').classList.toggle('wide', wide);
  $('#modal').hidden = false;
  setTimeout(() => ($('#modal-body input:not([type=hidden]), #modal-body button') || $('#modal-card')).focus?.(), 30);
}
function closeModal() {
  $('#modal').hidden = true;
  $('#modal-body').innerHTML = '';
  S.linksUser = '';
}
function confirmBox(text, act, arg, danger = true) {
  openModal(L('تأیید', 'Confirm'), `<p style="margin:0">${esc(text)}</p><div class="form-actions"><button class="btn" type="button" data-act="modal-close">${L('انصراف', 'Cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" type="button" data-act="${act}" data-arg="${esc(arg)}">${L('بله، انجام بده', 'Yes, do it')}</button></div>`);
}

/* ── actions ────────────────────────────────────────────────────────── */

async function withState(fn, okMsg) {
  if (S.busy) return;
  S.busy = true;
  document.body.style.cursor = 'progress';
  try {
    const res = await fn();
    if (res && res.state) S.state = res.state;
    if (okMsg) toast(okMsg);
    render();
    return res;
  } catch (err) {
    toast(err.message, 'warn');
    if (err.status === 401) showAuth();
    else render();
    return null;
  } finally {
    S.busy = false;
    document.body.style.cursor = '';
  }
}
const userById = (id) => S.state.users.find((u) => u.id === id);

async function onAction(act, arg, el) {
  switch (act) {
    case 'page': return go(arg);
    case 'modal-close': return closeModal();
    case 'copy': return copyText(arg);
    case 'qr': return openModal('QR', `<div style="display:grid;place-items:center;gap:12px"><div class="qr" style="width:260px;height:260px">${qrSvg(arg)}</div>${copyLine(arg)}</div>`);
    case 'theme': applyTheme(S.theme === 'dark' ? 'light' : 'dark'); render(); return api('/api/settings', { method: 'POST', body: { theme: S.theme } }).catch(() => {});
    case 'theme-set': applyTheme(arg); render(); return api('/api/settings', { method: 'POST', body: { theme: S.theme } }).catch(() => {});
    case 'lang': applyLang(S.lang === 'fa' ? 'en' : 'fa'); render(); return api('/api/settings', { method: 'POST', body: { lang: S.lang } }).catch(() => {});
    case 'lang-set': applyLang(arg); render(); return api('/api/settings', { method: 'POST', body: { lang: S.lang } }).catch(() => {});
    case 'logout': await api('/api/logout', { method: 'POST', body: {} }).catch(() => {}); S.state = null; return showAuth();
    case 'apply': return withState(() => api('/api/apply', { method: 'POST', body: {} }), L('کانفیگ‌ها اعمال شد', 'Config applied'));
    case 'status-filter': S.status = arg; return render();

    case 'user-new': return openModal(L('مشترک جدید', 'New subscriber'), userForm(null));
    case 'user-edit': return openModal(L('ویرایش مشترک', 'Edit subscriber'), userForm(userById(arg)));
    case 'user-links': S.linksUser = arg; S.linksFormat = 'base64'; return openModal(`${L('لینک‌های', 'Links ·')} ${userById(arg)?.name || ''}`, linksBody(userById(arg)), { wide: true });
    case 'links-format': S.linksFormat = arg; $('#modal-body').innerHTML = linksBody(userById(S.linksUser)); return null;
    case 'user-toggle': { const u = userById(arg); return withState(() => api(`/api/users/${arg}`, { method: 'PATCH', body: { enabled: !u.enabled } }), u.enabled ? L('غیرفعال شد', 'Disabled') : L('فعال شد', 'Enabled')); }
    case 'user-reset': return confirmBox(L(`مصرف «${userById(arg).name}» صفر شود؟`, `Reset usage of "${userById(arg).name}"?`), 'user-reset-yes', arg, false);
    case 'user-reset-yes': closeModal(); return withState(() => api(`/api/users/${arg}/resettraffic`, { method: 'POST', body: {} }), L('مصرف صفر شد', 'Usage reset'));
    case 'user-rotate': return confirmBox(L(`کلیدها و لینک اشتراک «${userById(arg).name}» عوض شود؟ لینک‌های قبلی دیگر کار نمی‌کنند.`, `Rotate keys and link for "${userById(arg).name}"? Old links stop working.`), 'user-rotate-yes', arg);
    case 'user-rotate-yes': closeModal(); return withState(() => api(`/api/users/${arg}/rotate`, { method: 'POST', body: {} }), L('کلیدها عوض شد', 'Keys rotated'));
    case 'user-delete': return confirmBox(L(`«${userById(arg).name}» حذف شود؟ این کار برگشت ندارد.`, `Delete "${userById(arg).name}"? This cannot be undone.`), 'user-delete-yes', arg);
    case 'user-delete-yes': closeModal(); return withState(() => api(`/api/users/${arg}`, { method: 'DELETE' }), L('حذف شد', 'Deleted'));

    case 'inbound-toggle': return withState(() => api(`/api/inbounds/${arg}`, { method: 'PATCH', body: { enabled: el.checked } }), el.checked ? L('روشن شد', 'Turned on') : L('خاموش شد', 'Turned off'));
    case 'inbound-edit': { const ib = S.state.inbounds.find((i) => i.id === arg); return openModal(L(ib.title?.fa || ib.label, ib.title?.en || ib.label), inboundForm(ib)); }
    case 'inbound-delete': return confirmBox(L('این پروتکل حذف شود؟', 'Delete this protocol?'), 'inbound-delete-yes', arg);
    case 'inbound-delete-yes': closeModal(); return withState(() => api(`/api/inbounds/${arg}`, { method: 'DELETE' }), L('حذف شد', 'Deleted'));
    case 'inbound-new': return openModal(L('افزودن پروتکل', 'Add protocol'), `<div class="list">${(S.state.presets || []).map((p) => `<div class="list-row"><div class="grow"><div class="title">${esc(L(p.title.fa, p.title.en))}</div><div class="small muted">${esc(L(p.desc.fa, p.desc.en))}</div></div><button class="btn sm" type="button" data-act="inbound-add" data-arg="${esc(p.id)}">${icon('plus', 'ic ic-sm')}${L('افزودن', 'Add')}</button></div>`).join('')}</div>`, { wide: true });
    case 'inbound-add': closeModal(); return withState(() => api('/api/inbounds', { method: 'POST', body: { presetId: arg } }), L('اضافه شد', 'Added'));

    case 'easy-refresh': S.easy = null; render(); return loadEasy();
    case 'easy-apply': return confirmBox(L('این پروفایل پروتکل‌ها و پروکسی‌های تلگرام را تغییر می‌دهد. ادامه می‌دهید؟', 'This profile changes protocols and Telegram proxies. Continue?'), 'easy-apply-yes', arg, false);
    case 'easy-apply-yes': closeModal(); await withState(() => api('/api/easy-setup/apply', { method: 'POST', body: { profile: arg } }), L('پروفایل اعمال شد', 'Profile applied')); await refreshState(); return loadEasy();

    case 'tg-toggle': return withState(() => api('/api/telegram', { method: 'POST', body: { [arg]: { enabled: el.checked } } }), el.checked ? L('روشن شد', 'Turned on') : L('خاموش شد', 'Turned off'));
    case 'tg-secret': return withState(() => api('/api/telegram/secret', { method: 'POST', body: {} }), L('سکرت جدید ساخته شد', 'New secret created'));
    case 'core-restart': return withState(() => api(`/api/cores/${arg}/restart`, { method: 'POST', body: {} }), L('ری‌استارت شد', 'Restarted'));
    case 'log-source': S.logSource = arg; render(); return refreshLogs();
    case 'raw-open': return openRaw(arg);
    case 'raw-save': return saveRaw(arg, false);
    case 'raw-reset': return saveRaw(arg, true);
    case 'scan-cancel': S.scan = await api('/api/railynx/cancel', { method: 'POST', body: {} }).catch((e) => { toast(e.message, 'warn'); return S.scan; }); return render();

    case 'backup': return downloadBackup();
    case 'update-check': return checkUpdate(true);
    case 'update-apply': return confirmBox(L('پنل به‌روزرسانی و ری‌استارت شود؟', 'Update and restart the panel?'), 'update-apply-yes', '', false);
    case 'update-apply-yes': closeModal(); return withState(async () => { const r = await api('/api/update', { method: 'POST', body: {} }); toast(L('به‌روزرسانی نصب شد؛ پنل ری‌استارت می‌شود…', 'Update installed; restarting…')); setTimeout(() => location.reload(), 5000); return r; });
    default: return null;
  }
}

async function openRaw(core) {
  try {
    const raw = await api('/api/raw');
    const notes = raw.notes?.[core];
    openModal(`${core === 'xray' ? 'Xray' : 'sing-box'} JSON`, `
      <div class="notice info">${icon('info')}<div>${L('کانفیگ دستی جای کانفیگ ساخته‌شده را می‌گیرد. اگر هسته آن را رد کند، پنل خودکار به کانفیگ ساخته‌شده برمی‌گردد.', 'A manual config replaces the generated one. If the core rejects it, the panel falls back to the generated config.')}</div></div>
      ${notes ? `<div class="notice warn">${icon('alert')}<div class="small ltr" style="text-align:start">${esc(notes)}</div></div>` : ''}
      <textarea class="input" id="raw-text" rows="18" spellcheck="false">${esc(raw.override?.[core] ? raw.active[core] : raw.generated[core])}</textarea>
      <div class="form-actions"><button class="btn danger" type="button" data-act="raw-reset" data-arg="${core}">${L('برگشت به کانفیگ ساخته‌شده', 'Use generated config')}</button><button class="btn primary" type="button" data-act="raw-save" data-arg="${core}">${L('ذخیره و اعمال', 'Save & apply')}</button></div>`, { wide: true });
  } catch (err) { toast(err.message, 'warn'); }
}
async function saveRaw(core, reset) {
  const text = reset ? '' : $('#raw-text')?.value || '';
  const r = await withState(() => api('/api/raw', { method: 'POST', body: { core, config: text } }), reset ? L('کانفیگ ساخته‌شده فعال شد', 'Generated config in use') : L('ذخیره شد', 'Saved'));
  if (r) closeModal();
}

async function downloadBackup() {
  try {
    const res = await fetch(`${BASE}/api/backup`, { credentials: 'same-origin', headers: { 'x-requested-with': 'bbg' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bbg-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (err) { toast(err.message, 'warn'); }
}

/* ── forms ──────────────────────────────────────────────────────────── */

async function onSubmit(form) {
  const fd = new FormData(form);
  const v = (k) => String(fd.get(k) ?? '').trim();
  switch (form.id) {
    case 'user-form': {
      const id = form.dataset.id;
      const changed = (k) => !id || v(k) !== (form.elements[k].dataset.orig ?? '');
      const body = { name: v('name'), note: v('note') };
      if (changed('quotaGb')) body.quotaGb = Number(v('quotaGb') || 0);
      if (changed('days')) body.days = Number(v('days') || 0);
      if (!body.name) return toast(L('نام را وارد کنید', 'Enter a name'), 'warn');
      const r = await withState(() => api(id ? `/api/users/${id}` : '/api/users', { method: id ? 'PATCH' : 'POST', body }), id ? L('ذخیره شد', 'Saved') : L('مشترک ساخته شد', 'Subscriber created'));
      if (r) {
        closeModal();
        if (!id && r.user?.id) onAction('user-links', r.user.id);
      }
      return null;
    }
    case 'inbound-form': {
      const params = {};
      for (const [k, val] of fd.entries()) if (k.startsWith('p:')) params[k.slice(2)] = String(val).trim();
      const r = await withState(() => api(`/api/inbounds/${form.dataset.id}`, { method: 'PATCH', body: { label: v('label'), params } }), L('ذخیره و اعمال شد', 'Saved and applied'));
      if (r) closeModal();
      return null;
    }
    case 'settings-form': {
      const body = { fragment: form.querySelector('[name=fragment]').checked };
      for (const k of ['publicHost', 'tcpHost', 'tcpPort', 'cleanIps', 'proxyIp']) if (fd.has(k)) body[k] = k === 'tcpPort' ? Number(v(k) || 0) : v(k);
      return withState(() => api('/api/settings', { method: 'POST', body }), L('ذخیره شد', 'Saved'));
    }
    case 'password-form': {
      if (v('password') !== v('password2')) return toast(L('تکرار رمز یکسان نیست', 'Passwords do not match'), 'warn');
      if (v('password').length < 10) return toast(L('رمز باید حداقل ۱۰ حرف باشد', 'Use at least 10 characters'), 'warn');
      const r = await withState(() => api('/api/admin/password', { method: 'POST', body: { current: fd.get('current'), password: fd.get('password') } }), L('رمز عوض شد', 'Password changed'));
      if (r) form.reset();
      return null;
    }
    case 'tg-mtproto': return withState(() => api('/api/telegram', { method: 'POST', body: { mtproto: { faketlsHost: v('faketlsHost'), adTag: v('adTag') } } }), L('ذخیره شد', 'Saved'));
    case 'tg-socks':
    case 'tg-http': {
      const kind = form.id.slice(3);
      if (v('pass').length < 8) return toast(L('رمز باید حداقل ۸ حرف باشد', 'Use at least 8 characters'), 'warn');
      return withState(() => api('/api/telegram', { method: 'POST', body: { [kind]: { user: v('user'), pass: v('pass') } } }), L('ذخیره شد', 'Saved'));
    }
    case 'scan-form': {
      const link = v('link') || v('pick');
      if (!link) return toast(L('یک لینک VLESS انتخاب یا وارد کنید', 'Pick or paste a VLESS link'), 'warn');
      S.scanLink = link;
      try {
        S.scan = await api('/api/railynx/scan', { method: 'POST', body: { link, cidr: v('cidr'), concurrency: Number(v('concurrency') || 16) } });
        render();
        startScanPoll();
      } catch (err) { toast(err.message, 'warn'); }
      return null;
    }
    default: return null;
  }
}

/* ── auth & boot ────────────────────────────────────────────────────── */

function showAuth() {
  $('#boot').hidden = true;
  $('#app').hidden = true;
  $('#auth').hidden = false;
  stopTimers();
  const setup = Boolean(S.boot?.needsSetup);
  $('#auth-title').textContent = setup ? L('ساخت حساب مدیر', 'Create the admin account') : L('ورود به پنل', 'Sign in');
  $('#auth-hint').textContent = setup ? L('این اولین ورود است؛ نام کاربری و رمز مدیر را انتخاب کنید.', 'First run: choose the admin username and password.') : '';
  $('#l-user').textContent = L('نام کاربری', 'Username');
  $('#l-pass').textContent = L('رمز عبور', 'Password');
  $('#l-pass2').textContent = L('تکرار رمز عبور', 'Repeat password');
  $('#auth-pass2-wrap').hidden = !setup;
  $('#auth-key-wrap').hidden = !(setup && S.boot?.setupKeyRequired);
  $('#l-key').textContent = L('کلید راه‌اندازی (در لاگ سرور چاپ شده)', 'Setup key (printed in the server log)');
  $('#auth-pass').autocomplete = setup ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = setup ? L('ساخت حساب و ورود', 'Create & sign in') : L('ورود', 'Sign in');
  $('#auth-lang').textContent = S.lang === 'fa' ? 'EN' : 'FA';
  $('#auth-error').hidden = true;
  setTimeout(() => $('#auth-user').focus(), 30);
}

async function submitAuth(ev) {
  ev.preventDefault();
  const err = $('#auth-error');
  const username = $('#auth-user').value.trim();
  const password = $('#auth-pass').value;
  const setup = Boolean(S.boot?.needsSetup);
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  if (setup && password !== $('#auth-pass2').value) return fail(L('تکرار رمز یکسان نیست.', 'Passwords do not match.'));
  if (setup && password.length < 10) return fail(L('رمز باید حداقل ۱۰ حرف باشد.', 'Use at least 10 characters.'));
  $('#auth-submit').disabled = true;
  try {
    await api(setup ? '/api/setup' : '/api/login', { method: 'POST', body: { username, password, setupKey: $('#auth-key').value.trim() } });
    S.boot = await api('/api/bootstrap');
    $('#auth-pass').value = '';
    await enterApp();
  } catch (e) {
    fail(e.status === 429 ? L('تلاش‌های زیاد؛ چند دقیقه بعد دوباره امتحان کنید.', 'Too many attempts; try again in a few minutes.')
      : e.status === 401 ? L('نام کاربری یا رمز اشتباه است.', 'Wrong username or password.') : e.message);
  } finally {
    $('#auth-submit').disabled = false;
  }
}

async function refreshState() {
  S.state = await api('/api/state');
  return S.state;
}

async function enterApp() {
  await refreshState();
  if (S.state.settings?.theme) applyTheme(S.state.settings.theme);
  if (S.state.settings?.lang) applyLang(S.state.settings.lang);
  $('#boot').hidden = true;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  const fromHash = (location.hash || '').slice(1);
  go(PAGES.some((p) => p.id === fromHash) ? fromHash : 'overview');
}

function bindEvents() {
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    ev.preventDefault();
    onAction(el.dataset.act, el.dataset.arg, el);
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.matches('input[type=checkbox][data-act]')) return onAction(el.dataset.act, el.dataset.arg, el);
    if (el.id === 'delivery-user') { S.deliveryUser = el.value; return render(); }
    if (el.id === 'restore-file') {
      const file = el.files?.[0];
      if (!file) return null;
      file.text().then((text) => {
        let body;
        try { body = JSON.parse(text); } catch { return toast(L('فایل JSON معتبر نیست', 'Not a valid JSON file'), 'warn'); }
        return withState(async () => {
          const r = await api('/api/restore', { method: 'POST', body });
          toast(L('بازیابی شد؛ دوباره وارد شوید', 'Restored; please sign in again'));
          setTimeout(() => { location.href = r.panelUrl || location.href; location.reload(); }, 1200);
          return r;
        });
      });
    }
    if (el.name === 'pick' && el.form?.id === 'scan-form') el.form.link.value = el.value;
    return null;
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.closest('#content form')) S.dirty = true;
    if (ev.target.id === 'user-search') {
      S.filter = ev.target.value;
      const pos = ev.target.selectionStart;
      render();
      const box = $('#user-search');
      box.focus();
      try { box.setSelectionRange(pos, pos); } catch { /* ignore */ }
    }
  });
  document.addEventListener('submit', (ev) => {
    if (ev.target.id === 'auth-form') return submitAuth(ev);
    ev.preventDefault();
    return onSubmit(ev.target);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !$('#modal').hidden) closeModal();
  });
  $('#modal').addEventListener('click', (ev) => { if (ev.target.id === 'modal') closeModal(); });
  $('#auth-lang').addEventListener('click', () => { applyLang(S.lang === 'fa' ? 'en' : 'fa'); showAuth(); });
  setInterval(async () => {
    if (document.hidden || S.busy || !S.state || !$('#modal').hidden) return;
    if (!['overview', 'cores', 'telegram'].includes(S.page)) return;
    const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#content form');
    try {
      await refreshState();
      if (!S.dirty && !typing) render();
    } catch (err) { if (err.status === 401) showAuth(); }
  }, 15000);
}

async function boot() {
  let lang = 'fa';
  let theme = 'dark';
  try { lang = localStorage.getItem('bbg-lang') || lang; theme = localStorage.getItem('bbg-theme') || theme; } catch { /* ignore */ }
  applyLang(lang);
  applyTheme(theme);
  $('#boot-text').textContent = L('در حال اتصال به پنل…', 'Connecting to the panel…');
  bindEvents();
  try {
    S.boot = await api('/api/bootstrap');
  } catch (err) {
    $('#boot-text').textContent = `${L('پنل در دسترس نیست', 'Panel unreachable')}: ${err.message}`;
    return;
  }
  if (S.boot.settings?.lang) applyLang(S.boot.settings.lang);
  if (S.boot.settings?.theme) applyTheme(S.boot.settings.theme);
  if (!S.boot.loggedIn) return showAuth();
  try { await enterApp(); } catch { showAuth(); }
}

boot();
