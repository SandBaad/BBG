// Installer web page. Placeholders (__X__) are filled by index.js.
export const PAGE_HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>BBG Installer</title>
<style>
@font-face { font-family: Vazirmatn; src: url('fonts/Vazirmatn-Regular.woff2') format('woff2'); font-weight: 400 500; font-display: swap; }
@font-face { font-family: Vazirmatn; src: url('fonts/Vazirmatn-Bold.woff2') format('woff2'); font-weight: 600 800; font-display: swap; }
:root { --bg:#0c0e11; --surface:#151920; --surface-2:#1b2029; --line:#252b35; --line-2:#313844; --ink:#e7eaee; --ink-2:#b4bbc5; --muted:#7d8592; --accent:#3fd0b4; --accent-ink:#04221c; --ok:#44c27a; --warn:#e0a83a; --bad:#f06a5f; --info:#6aa8ff; --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color-scheme: dark; }
@media (prefers-color-scheme: light) { :root { --bg:#f4f5f7; --surface:#fff; --surface-2:#f3f4f6; --line:#e2e5ea; --line-2:#d3d8df; --ink:#12161c; --ink-2:#3b434e; --muted:#69717d; --accent:#0f9c84; --accent-ink:#fff; --ok:#1f9a57; --warn:#b7791f; --bad:#d64538; --info:#2f6fd6; color-scheme: light; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14.5px/1.65 Vazirmatn, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; }
.wrap { max-width: 760px; margin: 0 auto; padding: 32px max(16px, env(safe-area-inset-right, 0px)) 64px max(16px, env(safe-area-inset-left, 0px)); display: flex; flex-direction: column; gap: 16px; }
header { display: flex; align-items: center; gap: 12px; }
.mark { width: 40px; height: 40px; border-radius: 10px; background: var(--accent); color: var(--accent-ink); display: grid; place-items: center; font: 700 13px/1 var(--mono); }
h1 { margin: 0; font-size: 21px; text-wrap: balance; }
.sub { color: var(--muted); font-size: 13px; }
.lang { margin-inline-start: auto; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.step-h { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; }
.num { width: 24px; height: 24px; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--line-2); display: grid; place-items: center; font: 600 12px/1 var(--mono); flex: none; }
p { margin: 0; color: var(--ink-2); }
.small { font-size: 12.5px; color: var(--muted); }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--line-2); background: var(--surface-2); color: var(--ink); font: inherit; font-size: 13.5px; cursor: pointer; text-decoration: none; white-space: nowrap; }
.btn:hover { border-color: var(--muted); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 700; }
.btn:disabled { opacity: .55; cursor: not-allowed; }
.btn.sm { height: 28px; padding: 0 10px; font-size: 12.5px; }
label.f { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
label.f > span { font-size: 13px; color: var(--ink-2); }
input { width: 100%; height: 38px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--line-2); background: var(--bg); color: var(--ink); font: 13px var(--mono); direction: ltr; outline: none; }
input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
details summary { cursor: pointer; color: var(--ink-2); font-size: 13.5px; }
details[open] summary { margin-bottom: 12px; }
.perm { font: 12px var(--mono); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; direction: ltr; text-align: left; color: var(--ink-2); white-space: pre-wrap; }
ol.progress { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
ol.progress li { display: flex; gap: 10px; align-items: flex-start; font-size: 13.5px; color: var(--muted); }
ol.progress li .dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--line-2); flex: none; margin-top: 2px; display: grid; place-items: center; font-size: 11px; }
ol.progress li.run { color: var(--ink); } ol.progress li.run .dot { border-color: var(--accent); border-top-color: transparent; animation: spin .8s linear infinite; }
ol.progress li.ok { color: var(--ink); } ol.progress li.ok .dot { border-color: var(--ok); background: var(--ok); color: var(--bg); }
ol.progress li.warn .dot { border-color: var(--warn); background: var(--warn); color: var(--bg); }
ol.progress li.fail { color: var(--bad); } ol.progress li.fail .dot { border-color: var(--bad); background: var(--bad); color: var(--bg); }
ol.progress li.skip { opacity: .55; }
ol.progress .note { display: block; font-size: 12px; color: var(--muted); direction: ltr; text-align: start; unicode-bidi: plaintext; }
@keyframes spin { to { transform: rotate(360deg); } }
.line { display: flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px 6px 12px; background: var(--bg); min-width: 0; }
.line code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: ltr; text-align: left; font: 12.5px var(--mono); color: var(--ink-2); }
.line b { font-size: 12px; color: var(--muted); font-weight: 500; white-space: nowrap; }
.notice { border-radius: 9px; padding: 10px 12px; font-size: 13px; border: 1px solid var(--line); }
.notice.warn { border-color: color-mix(in srgb, var(--warn) 40%, var(--line)); background: color-mix(in srgb, var(--warn) 10%, transparent); }
.notice.bad { border-color: color-mix(in srgb, var(--bad) 40%, var(--line)); background: color-mix(in srgb, var(--bad) 10%, transparent); }
.notice.ok { border-color: color-mix(in srgb, var(--ok) 40%, var(--line)); background: color-mix(in srgb, var(--ok) 10%, transparent); }
footer { text-align: center; color: var(--muted); font-size: 12px; }
footer a { color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="mark">BBG</div>
    <div><h1 data-t="title"></h1><div class="sub" data-t="tagline"></div></div>
    <button class="btn sm lang" type="button" id="lang">English</button>
  </header>

  <section class="card">
    <div class="step-h"><span class="num">1</span><span data-t="s1"></span></div>
    <p data-t="s1p"></p>
    <div class="row">
      <a class="btn primary" id="token-link" href="__TOKEN_URL__" target="_blank" rel="noopener noreferrer" data-t="mkToken"></a>
      <a class="btn" id="token-link-domain" href="__TOKEN_URL_DOMAIN__" target="_blank" rel="noopener noreferrer" data-t="mkTokenDomain"></a>
    </div>
    <details>
      <summary data-t="manual"></summary>
      <div class="perm">Account · Workers Scripts · Edit
Account · Account Settings · Read
(custom domain) Zone · Workers Routes · Edit
(custom domain) Zone · Zone · Read
(custom domain) Zone · DNS · Edit</div>
    </details>
  </section>

  <form class="card" id="form" autocomplete="off">
    <div class="step-h"><span class="num">2</span><span data-t="s2"></span></div>
    <label class="f"><span data-t="token"></span><input id="token" name="token" type="password" required spellcheck="false" placeholder="Cloudflare API token"></label>
    <p class="small" data-t="tokenNote"></p>
    <details>
      <summary data-t="advanced"></summary>
      <div class="grid">
        <label class="f"><span data-t="domain"></span><input name="customDomain" placeholder="vpn.example.com"></label>
        <label class="f"><span data-t="name"></span><input name="name" placeholder="bbg-xxxxxx"></label>
        <label class="f"><span data-t="adminUser"></span><input name="adminUser" placeholder="admin"></label>
        <label class="f"><span data-t="adminPass"></span><input name="adminPassword" type="password" placeholder="••••••••••"></label>
        <label class="f"><span>ProxyIP</span><input name="proxyIp" placeholder="host:443"></label>
        <label class="f"><span data-t="cleanIps"></span><input name="cleanIps" placeholder="104.16.1.1, 172.67.2.2"></label>
      </div>
      <p class="small" data-t="proxyNote" style="margin-top:10px"></p>
    </details>
    <div class="row"><button class="btn primary" type="submit" id="go" data-t="install"></button><span class="small" id="form-err" role="alert"></span></div>
  </form>

  <section class="card" id="progress-card" hidden aria-live="polite">
    <div class="step-h"><span class="num">3</span><span data-t="s3"></span></div>
    <ol class="progress" id="progress"></ol>
  </section>

  <section class="card" id="result" hidden></section>

  <section class="card" id="bot-card" hidden>
    <div class="step-h"><span data-t="botTitle"></span></div>
    <p data-t="botP"></p>
    <div class="row"><a class="btn" id="bot-link" dir="ltr" target="_blank" rel="noopener noreferrer"></a></div>
  </section>

  <footer>BBG · SANDBAAD · panel v__VERSION__ · <a href="https://github.com/SandBaad/BBG" target="_blank" rel="noopener" data-t="foot"></a></footer>
</div>
<script type="application/json" id="steps-data">__STEPS__</script>
<script>
(function () {
  var STEPS = JSON.parse(document.getElementById('steps-data').textContent);
  var BOT = '__BOT__';
  var T = {
    fa: {
      title: 'نصب پنل BBG روی Cloudflare', tagline: 'فقط با یک توکن؛ بقیهٔ تنظیمات خودکار انجام می‌شود.',
      s1: 'یک API Token بسازید', s1p: 'دکمه را بزنید، در صفحهٔ کلادفلر پایین صفحه «Continue to summary» و بعد «Create Token» را بزنید و توکن را کپی کنید. دسترسی‌ها از قبل انتخاب شده‌اند.',
      mkToken: 'ساخت توکن', mkTokenDomain: 'ساخت توکن (با دامنهٔ شخصی)', manual: 'اگر دسترسی‌ها خودکار انتخاب نشدند',
      s2: 'توکن را وارد کنید', token: 'API Token', tokenNote: 'توکن فقط برای همین نصب استفاده می‌شود و جایی ذخیره نمی‌شود. بعد از نصب می‌توانید آن را در کلادفلر حذف کنید.',
      advanced: 'تنظیمات اختیاری', domain: 'دامنهٔ شخصی (باید در همین حساب کلادفلر باشد)', name: 'نام Worker', adminUser: 'نام کاربری مدیر', adminPass: 'رمز مدیر (خالی = ساخت خودکار)', cleanIps: 'IPهای تمیز کلادفلر',
      proxyNote: 'ProxyIP برای باز شدن سایت‌هایی لازم است که خودشان پشت کلادفلرند. آن سرور مقصد اتصال‌ها را می‌بیند؛ فقط از منبع مورد اعتماد استفاده کنید. بعداً هم از تنظیمات پنل قابل تغییر است.',
      install: 'نصب پنل', installing: 'در حال نصب…', s3: 'مراحل نصب', done: 'پنل آماده است', panel: 'پنل مدیریت', backup: 'آدرس workers.dev', user: 'نام کاربری', pass: 'رمز', sub: 'لینک اشتراک اولین کاربر', portal: 'صفحهٔ کاربر', open: 'باز کردن پنل', copy: 'کپی', copied: 'کپی شد',
      keep: 'این اطلاعات را همین حالا جای امن ذخیره کنید؛ دوباره نمایش داده نمی‌شود.', failed: 'نصب انجام نشد', tokenBad: 'توکن را کامل وارد کنید.',
      botTitle: 'نصب با ربات تلگرام', botP: 'همین کار را می‌توانید با فرستادن توکن به ربات انجام دهید.', foot: 'کد باز در گیت‌هاب', lang: 'English',
    },
    en: {
      title: 'Install the BBG panel on Cloudflare', tagline: 'One token; everything else is set up for you.',
      s1: 'Create an API token', s1p: 'Press the button, scroll down on the Cloudflare page, choose "Continue to summary", then "Create Token", and copy it. The permissions are pre-selected.',
      mkToken: 'Create token', mkTokenDomain: 'Create token (with custom domain)', manual: 'If the permissions are not pre-selected',
      s2: 'Paste the token', token: 'API Token', tokenNote: 'The token is used for this install only and is never stored. You can delete it in Cloudflare afterwards.',
      advanced: 'Optional settings', domain: 'Custom domain (must be in this Cloudflare account)', name: 'Worker name', adminUser: 'Admin username', adminPass: 'Admin password (empty = generate)', cleanIps: 'Clean Cloudflare IPs',
      proxyNote: 'ProxyIP is needed for sites that are themselves behind Cloudflare. That server sees connection destinations; use one you trust. You can change it later in the panel.',
      install: 'Install panel', installing: 'Installing…', s3: 'Progress', done: 'Your panel is ready', panel: 'Admin panel', backup: 'workers.dev address', user: 'Username', pass: 'Password', sub: 'First subscriber link', portal: 'Subscriber page', open: 'Open panel', copy: 'Copy', copied: 'Copied',
      keep: 'Save these details somewhere safe now; they are not shown again.', failed: 'Install failed', tokenBad: 'Paste the whole token.',
      botTitle: 'Install from Telegram', botP: 'You can do the same by sending the token to the bot.', foot: 'open source on GitHub', lang: 'فارسی',
    },
  };
  var lang = 'fa';
  try { lang = localStorage.getItem('bbg-inst-lang') || 'fa'; } catch (e) {}
  var state = {}, notes = {}, result = null, error = null;
  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function L(o) { return o && typeof o === 'object' ? (o[lang] || o.en || '') : (o || ''); }
  function copy(text, btn) {
    var done = function () { var old = btn.textContent; btn.textContent = T[lang].copied; setTimeout(function () { btn.textContent = old; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
    else { fallback(text); done(); }
  }
  function fallback(text) { var a = document.createElement('textarea'); a.value = text; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (e) {} a.remove(); }
  function line(label, value) { return '<div class="line"><b>' + esc(label) + '</b><code>' + esc(value) + '</code><button class="btn sm" type="button" data-copy="' + esc(value) + '">' + esc(T[lang].copy) + '</button></div>'; }
  function renderProgress() {
    $('progress').innerHTML = STEPS.filter(function (s) { return state[s.id]; }).map(function (s) {
      var st = state[s.id], mark = { ok: '✓', warn: '!', fail: '✕', skip: '–' }[st] || '';
      return '<li class="' + st + '"><span class="dot">' + mark + '</span><span>' + esc(s[lang]) + (notes[s.id] ? '<span class="note">' + esc(L(notes[s.id])) + '</span>' : '') + '</span></li>';
    }).join('');
  }
  function renderResult() {
    var el = $('result'), t = T[lang];
    if (error) {
      el.hidden = false;
      el.innerHTML = '<div class="notice bad"><b>' + esc(t.failed) + '</b><br>' + esc(L(error.hint) || error.error) + '</div>';
      return;
    }
    if (!result) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '<div class="step-h">✓ ' + esc(t.done) + '</div>' +
      '<div class="notice ok">' + esc(t.keep) + '</div>' +
      line(t.panel, result.customPanelUrl || result.panelUrl) +
      (result.customPanelUrl ? line(t.backup, result.panelUrl) : '') +
      line(t.user, result.adminUser) + line(t.pass, result.adminPassword) +
      line(t.sub, result.subUrl) + line(t.portal, result.portalUrl) +
      (result.warnings || []).map(function (w) { return '<div class="notice warn">' + esc(L(w)) + '</div>'; }).join('') +
      '<div class="row"><a class="btn primary" target="_blank" rel="noopener noreferrer" href="' + esc(result.customPanelUrl || result.panelUrl) + '">' + esc(t.open) + '</a></div>';
  }
  function render() {
    var t = T[lang];
    document.documentElement.lang = lang; document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    [].forEach.call(document.querySelectorAll('[data-t]'), function (el) { el.textContent = t[el.getAttribute('data-t')]; });
    $('lang').textContent = t.lang;
    if (BOT && !/^__/.test(BOT)) { $('bot-card').hidden = false; $('bot-link').href = 'https://t.me/' + BOT; $('bot-link').textContent = '@' + BOT; }
    renderProgress(); renderResult();
    if ($('go').disabled) $('go').textContent = t.installing;
  }
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-copy]'); if (c) copy(c.getAttribute('data-copy'), c);
    if (e.target.id === 'lang') { lang = lang === 'fa' ? 'en' : 'fa'; try { localStorage.setItem('bbg-inst-lang', lang); } catch (x) {} render(); }
  });
  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(e.target), body = {};
    fd.forEach(function (v, k) { body[k] = String(v).trim(); });
    if (!/^[A-Za-z0-9_-]{30,}$/.test(body.token)) { $('form-err').textContent = T[lang].tokenBad; return; }
    $('form-err').textContent = '';
    state = {}; notes = {}; result = null; error = null;
    $('go').disabled = true; $('progress-card').hidden = false; render();
    fetch('api/deploy', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'bbg-installer' }, body: JSON.stringify(body) })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { error = d; render(); });
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buf += dec.decode(r.value, { stream: true });
            var parts = buf.split('\\n'); buf = parts.pop();
            parts.forEach(function (p) {
              if (!p.trim()) return;
              var m = JSON.parse(p);
              if (m.done) { if (m.error) error = m; else result = m.result; }
              else { state[m.step] = m.status; if (m.note) notes[m.step] = m.note; }
            });
            render();
            return pump();
          });
        }
        return pump();
      })
      .catch(function (err) { error = { error: String(err) }; })
      .then(function () { $('go').disabled = false; render(); $('token').value = ''; });
  });
  render();
})();
</script>
</body>
</html>`;
