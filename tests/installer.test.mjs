// Installer tests against a mock Cloudflare API and a mock Telegram API.
// The panel the installer uploads is then loaded and exercised for real.
//   node --import ./tests/cf-shim/register.mjs --import ./tests/cf-shim/runtime.mjs tests/installer.test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { doNamespace } from './cf-shim/runtime.mjs';
import { PANEL_MODULES } from '../installer/src/panel-bundle.js';

const GOOD = 'G'.repeat(40);
const calls = [];
const uploads = {};
const tgCalls = [];
let subdomainExists = false;

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://x');
  const reply = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname.startsWith('/tg/')) {
    const method = url.pathname.split('/').pop();
    tgCalls.push({ method, body: JSON.parse(body.toString() || '{}') });
    return reply(200, { ok: true, result: { message_id: 77 } });
  }
  calls.push(`${req.method} ${url.pathname}${url.search}`);
  if (req.headers.authorization !== `Bearer ${GOOD}`) return reply(401, { success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] });
  const p = url.pathname.replace('/client/v4', '');
  if (p === '/user/tokens/verify') return reply(200, { success: true, result: { status: 'active' } });
  if (p === '/accounts') return reply(200, { success: true, result: [{ id: 'acc1', name: 'Test account' }] });
  if (p === '/accounts/acc1/workers/subdomain' && req.method === 'GET') {
    return subdomainExists ? reply(200, { success: true, result: { subdomain: 'given' } }) : reply(404, { success: false, errors: [{ code: 10007, message: 'no subdomain' }] });
  }
  if (p === '/accounts/acc1/workers/subdomain' && req.method === 'PUT') { subdomainExists = true; return reply(200, { success: true, result: { subdomain: 'given' } }); }
  let m = /^\/accounts\/acc1\/workers\/scripts\/([a-z0-9-]+)\/settings$/.exec(p);
  if (m) return uploads[m[1]] ? reply(200, { success: true, result: {} }) : reply(404, { success: false, errors: [{ code: 10007, message: 'not found' }] });
  m = /^\/accounts\/acc1\/workers\/scripts\/([a-z0-9-]+)$/.exec(p);
  if (m && req.method === 'PUT') {
    const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body }).formData();
    const meta = JSON.parse(await form.get('metadata').text());
    const modules = {};
    for (const [k, v] of form.entries()) if (k !== 'metadata') modules[k] = { type: v.type, text: await v.text() };
    uploads[m[1]] = { meta, modules };
    return reply(200, { success: true, result: { id: m[1] } });
  }
  m = /^\/accounts\/acc1\/workers\/scripts\/([a-z0-9-]+)\/subdomain$/.exec(p);
  if (m) return reply(200, { success: true, result: { enabled: true } });
  if (p === '/zones') return reply(200, { success: true, result: url.searchParams.get('name') === 'example.com' ? [{ id: 'zone1', name: 'example.com' }] : [] });
  if (p === '/accounts/acc1/workers/domains' && req.method === 'PUT') { uploads.__domain = JSON.parse(body.toString()); return reply(200, { success: true, result: {} }); }
  return reply(404, { success: false, errors: [{ code: 7003, message: `no route ${p}` }] });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${server.address().port}`;

// Panels the installer "deployed" are loaded from the uploaded modules and served in-process.
const panels = new Map();
async function bootPanel(name) {
  const up = uploads[name];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbg-panel-'));
  for (const [file, m] of Object.entries(up.modules)) fs.writeFileSync(path.join(dir, file), m.text);
  const mod = await import(pathToFileURL(path.join(dir, up.meta.main_module)).href);
  const env = {};
  for (const b of up.meta.bindings) if (b.type === 'plain_text' || b.type === 'secret_text') env[b.name] = b.text;
  const doBinding = up.meta.bindings.find((b) => b.type === 'durable_object_namespace');
  env[doBinding.name] = doNamespace(mod[doBinding.class_name], env);
  return { worker: mod.default, env };
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const req = new Request(input, init);
  const host = new URL(req.url).hostname;
  if (host.endsWith('.workers.dev') || host === 'vpn.example.com') {
    const name = host.split('.')[0] === 'vpn' ? [...panels.keys()][0] : host.split('.')[0];
    if (!panels.has(name) && uploads[name]) panels.set(name, await bootPanel(name));
    const p = panels.get(name);
    if (!p) return new Response('no such worker', { status: 404 });
    return p.worker.fetch(req, p.env, { waitUntil() {} });
  }
  return nativeFetch(req);
};

const installer = (await import('../installer/src/index.js')).default;
const env = { CF_API_BASE: `${MOCK}/client/v4`, TELEGRAM_API_BASE: `${MOCK}/tg`, TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_WEBHOOK_SECRET: 'hook-secret-123', TELEGRAM_BOT_USERNAME: 'bbg_test_bot' };
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const call = (p, init = {}) => installer.fetch(new Request(`https://installer.test${p}`, init), env, ctx);
async function ndjson(res) {
  const text = await res.text();
  return text.trim().split('\n').map((l) => JSON.parse(l));
}
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.stack.split('\n').slice(0, 4).join('\n    ')}`); process.exitCode = 1; }
}
const post = (body, headers = {}) => call('/api/deploy', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'bbg-installer', 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200)}`, ...headers }, body: JSON.stringify(body) });

console.log('Installer');

await test('web page has the prefilled token link and the bot handle', async () => {
  const r = await call('/');
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22/);
  assert.ok(html.includes("var BOT = 'bbg_test_bot'"));
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  const steps = /<script type="application\/json" id="steps-data">(.*?)<\/script>/.exec(html)[1];
  assert.equal(JSON.parse(steps).length, 7);
});

await test('deploy refuses cross-site calls and malformed tokens', async () => {
  assert.equal((await call('/api/deploy', { method: 'POST', body: '{}' })).status, 403);
  const r = await post({ token: 'short' });
  assert.equal(r.status, 400);
});

await test('a token Cloudflare rejects fails at the first step with a clear hint', async () => {
  const lines = await ndjson(await post({ token: 'B'.repeat(40) }));
  const done = lines.at(-1);
  assert.ok(done.done && done.error);
  assert.ok(['token', 'account'].includes(done.step));
  assert.match(done.hint.en, /token/i);
  assert.ok(!JSON.stringify(lines).includes('B'.repeat(40)), 'token must never be echoed');
});

let result;
await test('full install: account, subdomain, upload, route, custom domain, live check', async () => {
  const lines = await ndjson(await post({ token: GOOD, customDomain: 'vpn.example.com', proxyIp: 'proxy.example.net:443' }));
  const done = lines.at(-1);
  assert.ok(done.done && !done.error, JSON.stringify(done));
  result = done.result;
  const status = Object.fromEntries(lines.filter((l) => l.step).map((l) => [l.step, l.status]));
  assert.deepEqual(status, { token: 'ok', account: 'ok', subdomain: 'ok', upload: 'ok', route: 'ok', domain: 'ok', check: 'ok' });
  assert.match(result.panelUrl, /^https:\/\/bbg-[a-z0-9]{6}\.given\.workers\.dev\/[a-z0-9]{12}\/$/);
  assert.match(result.customPanelUrl, /^https:\/\/vpn\.example\.com\//);
  assert.ok(result.adminPassword.length >= 16);
  assert.ok(calls.includes('PUT /client/v4/accounts/acc1/workers/subdomain'), 'creates a workers.dev subdomain when missing');
  assert.equal(uploads.__domain.zone_id, 'zone1');
});

await test('upload carries the Durable Object, its migration, secrets and both modules', () => {
  const up = uploads[result.workerName];
  assert.equal(up.meta.main_module, 'panel.js');
  assert.deepEqual(up.meta.migrations, { new_tag: 'v1', new_sqlite_classes: ['PanelStore'] });
  const b = Object.fromEntries(up.meta.bindings.map((x) => [x.name, x]));
  assert.equal(b.STORE.type, 'durable_object_namespace');
  assert.equal(b.ADMIN_PASSWORD.type, 'secret_text');
  assert.equal(b.ADMIN_PASSWORD.text, result.adminPassword);
  assert.equal(b.PROXY_IP.text, 'proxy.example.net:443');
  assert.deepEqual(Object.keys(up.modules).sort(), ['assets.js', 'panel.js']);
  assert.equal(up.modules['panel.js'].type, 'application/javascript+module');
  assert.equal(up.modules['panel.js'].text, PANEL_MODULES[0].content);
});

await test('the deployed panel works with the credentials the installer returned', async () => {
  const p = panels.get(result.workerName);
  const r = await globalThis.fetch(result.panelUrl);
  assert.equal(r.status, 200);
  const login = await globalThis.fetch(`${result.panelUrl}api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'bbg' }, body: JSON.stringify({ username: result.adminUser, password: result.adminPassword }) });
  assert.equal(login.status, 200);
  const sub = await globalThis.fetch(result.subUrl);
  assert.equal(sub.status, 200);
  const links = Buffer.from(await sub.text(), 'base64').toString();
  assert.match(links, /^vless:\/\/.*@vpn\.example\.com:443/m);
  assert.ok(p.env.STORE._inst.doc.settings.proxyIp === 'proxy.example.net:443');
});

await test('an existing Worker name is never overwritten', async () => {
  const lines = await ndjson(await post({ token: GOOD, name: result.workerName }));
  const done = lines.at(-1);
  assert.equal(done.step, 'upload');
  assert.match(done.hint.en, /already exists/);
});

await test('Telegram webhook checks its secret header', async () => {
  const r = await call(`/tg/${env.TELEGRAM_WEBHOOK_SECRET}`, { method: 'POST', body: '{}', headers: { 'x-telegram-bot-api-secret-token': 'wrong' } });
  assert.equal(r.status, 403);
});

const tgUpdate = (text) => call(`/tg/${env.TELEGRAM_WEBHOOK_SECRET}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
  body: JSON.stringify({ update_id: 1, message: { message_id: 5, chat: { id: 42, type: 'private' }, text } }),
});

await test('/start answers with the token link', async () => {
  await tgUpdate('/start');
  await Promise.all(waits.splice(0));
  const msg = tgCalls.find((c) => c.method === 'sendMessage');
  assert.match(msg.body.text, /permissionGroupKeys/);
});

await test('sending a token deletes the message and installs a panel', async () => {
  tgCalls.length = 0;
  await tgUpdate(GOOD);
  await Promise.all(waits.splice(0));
  assert.ok(tgCalls.some((c) => c.method === 'deleteMessage' && c.body.message_id === 5));
  const final = tgCalls.filter((c) => c.method === 'sendMessage').at(-1);
  assert.match(final.body.text, /پنل آماده است/);
  assert.match(final.body.text, /workers\.dev/);
  assert.ok(!JSON.stringify(tgCalls).includes(GOOD), 'token must never be sent back');
});

await test('webhook registration needs the secret key', async () => {
  assert.equal((await call('/tg/setup?key=nope')).status, 403);
  const r = await call(`/tg/setup?key=${env.TELEGRAM_WEBHOOK_SECRET}`);
  assert.equal(r.status, 200);
  const hook = tgCalls.find((c) => c.method === 'setWebhook');
  assert.equal(hook.body.secret_token, env.TELEGRAM_WEBHOOK_SECRET);
});

server.close();
console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
process.exit(process.exitCode || 0);
