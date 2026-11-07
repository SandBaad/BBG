/**
 * BBG · SANDBAAD — one-token installer (Cloudflare Worker).
 *
 *   GET  /                 web installer (paste a Cloudflare API token, get a panel)
 *   POST /api/deploy       streams install progress as NDJSON
 *   POST /tg/<secret>      Telegram bot webhook (optional)
 *   GET  /tg/setup?key=…   registers the webhook with Telegram
 *
 * Secrets (wrangler secret put): TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (both optional).
 * Vars: TELEGRAM_BOT_USERNAME (shown on the page), CF_API_BASE / TELEGRAM_API_BASE (tests only).
 */
import { deployPanel, STEPS, tokenTemplateUrl, cleanOptions, DeployError } from './deploy.js';
import { PANEL_VERSION } from './panel-bundle.js';
import { PAGE_HTML } from './page.js';
import { FONTS } from './fonts.js';

const LIMIT = { perHour: 6 };
const hits = new Map();
function limited(key) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < 3_600_000);
  if (list.length >= LIMIT.perHour) return true;
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return false;
}
const SEC = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC } });
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── web ────────────────────────────────────────────────────────────── */

function page(env) {
  const html = PAGE_HTML
    .replace('__TOKEN_URL__', esc(tokenTemplateUrl(false)))
    .replace('__TOKEN_URL_DOMAIN__', esc(tokenTemplateUrl(true)))
    .replace('__BOT__', esc(env.TELEGRAM_BOT_USERNAME || ''))
    .replace('__VERSION__', esc(PANEL_VERSION))
    .replace('__STEPS__', JSON.stringify(STEPS).replace(/</g, '\\u003c'));
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      ...SEC,
    },
  });
}

async function webDeploy(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (request.headers.get('x-requested-with') !== 'bbg-installer' || (origin && origin !== url.origin)) return json({ error: 'forbidden' }, 403);
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  if (limited(`ip:${ip}`)) return json({ error: 'too many installs from this address; try again in an hour' }, 429);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  try { cleanOptions(body); } catch (err) { return json({ error: err.message, hint: err.hint }, 400); }

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const enc = new TextEncoder();
  const send = (obj) => writer.write(enc.encode(`${JSON.stringify(obj)}\n`)).catch(() => {});
  (async () => {
    try {
      const result = await deployPanel(body, { apiBase: env.CF_API_BASE || undefined, report: (step, status, extra) => send({ step, status, ...extra }) });
      await send({ done: true, result });
    } catch (err) {
      await send({ done: true, error: err.message, step: err.step, hint: err.hint || null });
    } finally {
      writer.close().catch(() => {});
    }
  })();
  return new Response(stream.readable, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', ...SEC } });
}

/* ── telegram ───────────────────────────────────────────────────────── */

function tg(env) {
  const base = `${env.TELEGRAM_API_BASE || 'https://api.telegram.org'}/bot${env.TELEGRAM_BOT_TOKEN}`;
  return async (method, payload) => {
    const r = await fetch(`${base}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return r.json().catch(() => ({}));
  };
}

const BOT_HELP = (url, urlDomain) => [
  '<b>نصب پنل BBG روی Cloudflare</b>',
  '',
  '۱. با این لینک یک API Token بسازید (دسترسی‌ها خودشان انتخاب شده‌اند):',
  url,
  '',
  '۲. توکن را همین‌جا بفرستید. پیامتان بلافاصله پاک می‌شود و توکن جایی ذخیره نمی‌شود.',
  '',
  'دامنهٔ شخصی دارید؟ توکن را از این لینک بسازید و بعد از توکن، با یک فاصله، دامنه را بنویسید:',
  urlDomain,
  '<code>TOKEN vpn.example.com</code>',
  '',
  'بعد از نصب می‌توانید توکن را در کلادفلر حذف کنید؛ پنل به آن نیازی ندارد.',
].join('\n');

function stepsText(state) {
  const icon = { run: '⏳', ok: '✅', skip: '➖', warn: '⚠️', fail: '❌' };
  return STEPS.filter((s) => state[s.id]).map((s) => `${icon[state[s.id]] || '•'} ${s.fa}`).join('\n');
}

async function botInstall(env, chatId, token, domain) {
  const call = tg(env);
  const progress = {};
  const head = '<b>در حال نصب پنل…</b>\n\n';
  const sent = await call('sendMessage', { chat_id: chatId, text: `${head}⏳ شروع`, parse_mode: 'HTML' });
  const msgId = sent?.result?.message_id;
  let last = 0;
  const update = async (force = false) => {
    if (!msgId || (!force && Date.now() - last < 1200)) return;
    last = Date.now();
    await call('editMessageText', { chat_id: chatId, message_id: msgId, text: head + stepsText(progress), parse_mode: 'HTML' });
  };
  try {
    const r = await deployPanel({ token, customDomain: domain }, { apiBase: env.CF_API_BASE || undefined, report: (step, status) => { progress[step] = status; update(); } });
    await update(true);
    const lines = [
      '<b>پنل آماده است ✅</b>',
      '',
      `پنل مدیریت:\n${esc(r.customPanelUrl || r.panelUrl)}`,
      ...(r.customPanelUrl ? [`(آدرس پشتیبان: ${esc(r.panelUrl)})`] : []),
      `نام کاربری: <code>${esc(r.adminUser)}</code>`,
      `رمز: <code>${esc(r.adminPassword)}</code>`,
      '',
      `لینک اشتراک اولین کاربر:\n<code>${esc(r.subUrl)}</code>`,
      '',
      ...r.warnings.map((w) => `⚠️ ${esc(w.fa)}`),
      '',
      'این پیام را جای امن نگه دارید و رمز را از تنظیمات پنل عوض کنید.',
    ];
    await call('sendMessage', { chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (err) {
    await update(true);
    const hint = err.hint ? err.hint.fa : err.message;
    await call('sendMessage', { chat_id: chatId, text: `❌ نصب انجام نشد.\n${esc(hint)}`, parse_mode: 'HTML' });
  }
}

async function telegramWebhook(request, env, ctx) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return new Response('not configured', { status: 404 });
  if (request.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
  let update;
  try { update = await request.json(); } catch { return new Response('ok'); }
  const msg = update.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private' || typeof msg.text !== 'string') return new Response('ok');
  const call = tg(env);
  const text = msg.text.trim();
  const [first, second] = text.split(/\s+/);
  if (/^[A-Za-z0-9_-]{30,}$/.test(first)) {
    // Remove the token from the chat right away.
    ctx.waitUntil(call('deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id }));
    if (limited(`tg:${msg.chat.id}`)) {
      ctx.waitUntil(call('sendMessage', { chat_id: msg.chat.id, text: 'تعداد نصب‌ها زیاد است؛ یک ساعت دیگر امتحان کنید.' }));
      return new Response('ok');
    }
    try {
      cleanOptions({ token: first, customDomain: second || '' });
    } catch (err) {
      ctx.waitUntil(call('sendMessage', { chat_id: msg.chat.id, text: `❌ ${err.hint ? err.hint.fa : err.message}` }));
      return new Response('ok');
    }
    ctx.waitUntil(botInstall(env, msg.chat.id, first, second || ''));
    return new Response('ok');
  }
  ctx.waitUntil(call('sendMessage', { chat_id: msg.chat.id, text: BOT_HELP(esc(tokenTemplateUrl(false)), esc(tokenTemplateUrl(true))), parse_mode: 'HTML', disable_web_page_preview: true }));
  return new Response('ok');
}

async function registerWebhook(request, env) {
  const url = new URL(request.url);
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return json({ error: 'TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are not set' }, 400);
  if (url.searchParams.get('key') !== env.TELEGRAM_WEBHOOK_SECRET) return json({ error: 'forbidden' }, 403);
  const call = tg(env);
  const hook = `${url.origin}/tg/${env.TELEGRAM_WEBHOOK_SECRET}`;
  const r = await call('setWebhook', { url: hook, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'], drop_pending_updates: true });
  await call('setMyCommands', { commands: [{ command: 'start', description: 'راهنمای نصب پنل' }] });
  return json({ ok: Boolean(r.ok), telegram: r.description || '' });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return page(env);
    if (request.method === 'GET' && FONTS[url.pathname]) {
      const bin = Uint8Array.from(atob(FONTS[url.pathname]), (c) => c.charCodeAt(0));
      return new Response(bin, { headers: { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=604800', ...SEC } });
    }
    if (request.method === 'POST' && url.pathname === '/api/deploy') return webDeploy(request, env);
    if (request.method === 'GET' && url.pathname === '/tg/setup') return registerWebhook(request, env);
    if (request.method === 'POST' && env.TELEGRAM_WEBHOOK_SECRET && url.pathname === `/tg/${env.TELEGRAM_WEBHOOK_SECRET}`) return telegramWebhook(request, env, ctx);
    return new Response('Not found', { status: 404 });
  },
};

export { DeployError };
