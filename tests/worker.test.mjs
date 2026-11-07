// End-to-end tests for the Cloudflare Worker edition, run under Node with runtime shims:
//   node --import ./tests/cf-shim/register.mjs tests/worker.test.mjs
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import { doNamespace } from './cf-shim/runtime.mjs';

const mod = await import('../worker/panel.js');
const worker = mod.default;
const env = { ADMIN_USER: 'admin', ADMIN_PASSWORD: 'Test-Password-123' };
env.STORE = doNamespace(mod.PanelStore, env);
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };
const HOST = 'https://panel.test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.stack.split('\n').slice(0, 3).join('\n    ')}`); process.exitCode = 1; }
}
const call = (path, init = {}) => worker.fetch(new Request(HOST + path, init), env, ctx);
let cookie = '';
const apiCall = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await call(`${ADMIN}${path}`, {
    method,
    headers: { cookie, 'x-requested-with': 'bbg', 'cf-connecting-ip': '198.51.100.7', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, res };
};

// First request initialises the Durable Object; read the random paths it chose.
await call('/');
const DOC = () => env.STORE._inst.doc;
const ADMIN = DOC().settings.adminPath;

console.log('Worker edition');

await test('SHA-224 matches Node crypto', () => {
  for (const s of ['', 'abc', 'x'.repeat(200), 'رمز-فارسی', crypto.randomBytes(30).toString('hex')]) {
    assert.equal(mod.sha224Hex(s), crypto.createHash('sha224').update(s).digest('hex'));
  }
});

await test('unknown paths look like a plain nginx 404', async () => {
  for (const p of ['/', '/sub/abc', '/admin', '/api/state', '/health']) {
    const r = await call(p);
    assert.equal(r.status, 404);
    assert.match(await r.text(), /nginx/);
  }
  const ws = await call('/random', { headers: { upgrade: 'websocket' } });
  assert.equal(ws.status, 404);
});

await test('admin path is random and serves the UI with its base path', async () => {
  assert.match(ADMIN, /^\/[a-z0-9]{12}$/);
  const r = await call(`${ADMIN}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes(`<meta name="panel-base" content="${ADMIN}">`));
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await call(`${ADMIN}/app.js`)).status, 200);
  assert.equal((await call(`${ADMIN}/fonts/Vazirmatn-Regular.woff2`)).headers.get('content-type'), 'font/woff2');
});

await test('API refuses requests without the CSRF header or from another origin', async () => {
  const a = await call(`${ADMIN}/api/login`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  assert.equal(a.status, 403);
  const b = await call(`${ADMIN}/api/login`, { method: 'POST', body: '{}', headers: { 'x-requested-with': 'bbg', origin: 'https://evil.example' } });
  assert.equal(b.status, 403);
});

await test('setup is closed because ADMIN_PASSWORD created the admin', async () => {
  const r = await apiCall('/api/setup', { method: 'POST', body: { username: 'x', password: 'whatever-123' } });
  assert.equal(r.status, 409);
});

await test('wrong password is rejected and the limiter kicks in after 8 tries', async () => {
  const codes = [];
  for (let i = 0; i < 10; i += 1) codes.push((await apiCall('/api/login', { method: 'POST', body: { username: 'admin', password: 'nope' }, headers: { 'cf-connecting-ip': '203.0.113.9' } })).status);
  assert.deepEqual(codes.slice(0, 8), Array(8).fill(401));
  assert.deepEqual(codes.slice(8), [429, 429]);
});

await test('login sets a Secure, HttpOnly, SameSite=Strict __Host- cookie', async () => {
  const r = await apiCall('/api/login', { method: 'POST', body: { username: 'admin', password: 'Test-Password-123' } });
  assert.equal(r.status, 200);
  const set = r.res.headers.get('set-cookie');
  assert.match(set, /^__Host-bbg=/);
  assert.match(set, /Secure/);
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  assert.equal((await apiCall('/api/state')).status, 200);
});

let user;
await test('create subscriber; state carries real links and no fake numbers', async () => {
  const r = await apiCall('/api/users', { method: 'POST', body: { name: 'مهسا', quotaGb: 10, days: 30 } });
  assert.equal(r.status, 200);
  user = r.data.state.users.find((u) => u.name === 'مهسا');
  assert.equal(user.links.length, 2);
  assert.ok(user.links.every((l) => l.uri.includes('panel.test') && l.uri.includes('ed%3D2048')));
  assert.equal(r.data.state.edition, 'worker');
  assert.deepEqual(r.data.state.traffic, []);
  assert.ok(r.data.state.warnings.some((w) => /ProxyIP/.test(w.en)));
});

await test('subscription formats are valid and use the stored random token', async () => {
  const base = new URL(user.subUrl).pathname;
  const b64 = await (await call(base)).text();
  const lines = Buffer.from(b64, 'base64').toString('utf8').trim().split('\n');
  assert.ok(lines[0].startsWith('vless://') && lines[1].startsWith('trojan://'));
  const head = (await call(base)).headers;
  assert.match(head.get('profile-title'), /^base64:/);
  assert.match(head.get('subscription-userinfo'), /total=10737418240/);
  const sb = JSON.parse(await (await call(`${base}/singbox`)).text());
  assert.equal(sb.dns.servers[0].type, 'https');
  assert.ok(!JSON.stringify(sb).includes('rule_set'));
  const xr = JSON.parse(await (await call(`${base}/xray`)).text());
  assert.equal(xr.outbounds[0].streamSettings.network, 'ws');
  const clash = await (await call(`${base}/clash`)).text();
  assert.match(clash, /type: vless/);
  assert.equal((await call(`/${DOC().settings.subPath}/not-a-real-token`)).status, 404);
});

await test('portal page and info do not leak the admin path', async () => {
  const page = await (await call(new URL(user.portalUrl).pathname)).text();
  assert.ok(!page.includes(ADMIN));
  assert.ok(page.includes('qrcode'));
  const info = await (await call(new URL(user.portalUrl).pathname.replace(/page$/, 'info'))).json();
  assert.equal(info.name, 'مهسا');
  assert.equal(info.links.length, 2);
});

// A local TCP echo server stands in for the internet.
const echo = net.createServer((s) => s.on('data', (d) => s.write(d)));
await new Promise((r) => echo.listen(0, '127.0.0.1', r));
const echoPort = echo.address().port;

function vlessHeader(uuid, port, payload) {
  const id = Buffer.from(uuid.replace(/-/g, ''), 'hex');
  return Buffer.concat([Buffer.from([0]), id, Buffer.from([0, 1, port >> 8, port & 255, 1, 127, 0, 0, 1]), payload]);
}
function trojanHeader(password, port, payload) {
  const h = crypto.createHash('sha224').update(password).digest('hex');
  return Buffer.concat([Buffer.from(h), Buffer.from([13, 10, 1, 1, 127, 0, 0, 1, port >> 8, port & 255, 13, 10]), payload]);
}
async function tunnel(path, firstChunk, { early = false } = {}) {
  const headers = { upgrade: 'websocket' };
  if (early) headers['sec-websocket-protocol'] = firstChunk.toString('base64url');
  const res = await call(path, { headers });
  if (res.status !== 101) return { status: res.status, got: Buffer.alloc(0), closed: true };
  const ws = res.webSocket;
  const got = [];
  let closed = false;
  ws.addEventListener('message', (e) => got.push(Buffer.from(e.data)));
  ws.addEventListener('close', () => { closed = true; });
  ws.accept();
  if (!early) ws.send(firstChunk);
  await sleep(150);
  return { status: 101, ws, got: Buffer.concat(got), get closed() { return closed; } };
}

await test('VLESS tunnel relays data for a valid user and prepends the response header', async () => {
  const doc = DOC();
  const u = doc.users.find((x) => x.name === 'مهسا');
  const t = await tunnel(doc.settings.vlessPath, vlessHeader(u.uuid, echoPort, Buffer.from('hello-vless')));
  assert.equal(t.status, 101);
  assert.deepEqual([...t.got.subarray(0, 2)], [0, 0]);
  assert.equal(t.got.subarray(2).toString(), 'hello-vless');
  t.ws.close();
  await sleep(50);
  await Promise.all(pending.splice(0));
});

await test('usage from closed tunnels is stored and shown', async () => {
  const st = (await apiCall('/api/state')).data;
  const u = st.users.find((x) => x.name === 'مهسا');
  assert.ok(u.usage.up >= 11 && u.usage.down >= 11, JSON.stringify(u.usage));
  assert.ok(u.lastSeen > 0);
  assert.equal(st.traffic.length, 1);
});

await test('VLESS with 0-RTT early data in Sec-WebSocket-Protocol works', async () => {
  const u = DOC().users.find((x) => x.name === 'مهسا');
  const t = await tunnel(DOC().settings.vlessPath, vlessHeader(u.uuid, echoPort, Buffer.from('early!')), { early: true });
  assert.equal(t.got.subarray(2).toString(), 'early!');
  t.ws.close();
});

await test('unknown VLESS UUID is dropped', async () => {
  const t = await tunnel(DOC().settings.vlessPath, vlessHeader(crypto.randomUUID(), echoPort, Buffer.from('x')));
  assert.equal(t.got.length, 0);
  assert.ok(t.closed);
});

await test('Trojan checks the password hash (wrong one is dropped)', async () => {
  const u = DOC().users.find((x) => x.name === 'مهسا');
  const ok = await tunnel(DOC().settings.trojanPath, trojanHeader(u.password, echoPort, Buffer.from('hi-trojan')));
  assert.equal(ok.got.toString(), 'hi-trojan');
  ok.ws.close();
  const bad = await tunnel(DOC().settings.trojanPath, trojanHeader('guess', echoPort, Buffer.from('x')));
  assert.equal(bad.got.length, 0);
  assert.ok(bad.closed);
});

await test('disabled users are refused right away', async () => {
  const u = DOC().users.find((x) => x.name === 'مهسا');
  await apiCall(`/api/users/${u.id}`, { method: 'PATCH', body: { enabled: false } });
  const t = await tunnel(DOC().settings.vlessPath, vlessHeader(u.uuid, echoPort, Buffer.from('x')));
  assert.equal(t.got.length, 0);
  await apiCall(`/api/users/${u.id}`, { method: 'PATCH', body: { enabled: true } });
});

await test('quota is enforced: an exhausted user can no longer connect', async () => {
  const r = await apiCall('/api/users', { method: 'POST', body: { name: 'tiny', quotaGb: 0.00000002 } });
  const id = r.data.user.id;
  const u = DOC().users.find((x) => x.id === id);
  const t = await tunnel(DOC().settings.vlessPath, vlessHeader(u.uuid, echoPort, Buffer.alloc(64, 1)));
  assert.equal(t.got.length, 66);
  t.ws.close();
  await sleep(50);
  await Promise.all(pending.splice(0));
  const st = (await apiCall('/api/state')).data;
  assert.equal(st.users.find((x) => x.id === id).status, 'quota');
  const again = await tunnel(DOC().settings.vlessPath, vlessHeader(u.uuid, echoPort, Buffer.from('x')));
  assert.equal(again.got.length, 0);
});

await test('rotate changes keys and the subscription link (old link 404s)', async () => {
  const before = (await apiCall('/api/state')).data.users.find((x) => x.name === 'مهسا');
  const after = (await apiCall(`/api/users/${before.id}/rotate`, { method: 'POST', body: {} })).data.state.users.find((x) => x.name === 'مهسا');
  assert.notEqual(before.subUrl, after.subUrl);
  assert.equal((await call(new URL(before.subUrl).pathname)).status, 404);
  assert.equal((await call(new URL(after.subUrl).pathname)).status, 200);
});

await test('settings are validated', async () => {
  assert.equal((await apiCall('/api/settings', { method: 'POST', body: { publicHost: 'not a domain' } })).status, 400);
  assert.equal((await apiCall('/api/settings', { method: 'POST', body: { proxyIp: 'bad host:99999x' } })).status, 400);
  const ok = await apiCall('/api/settings', { method: 'POST', body: { publicHost: 'vpn.example.com', cleanIps: '104.16.1.1, 172.67.2.2', proxyIp: 'proxy.example.com:443' } });
  assert.equal(ok.status, 200);
  const u = ok.data.state.users.find((x) => x.name === 'مهسا');
  assert.equal(u.links.length, 6);
  assert.ok(u.subUrl.startsWith('https://vpn.example.com/'));
});

await test('restore refuses files without admin/secrets', async () => {
  const r = await apiCall('/api/restore', { method: 'POST', body: { doc: { users: [], settings: {} } } });
  assert.equal(r.status, 400);
});

await test('password change signs out old sessions', async () => {
  const old = cookie;
  const r = await apiCall('/api/admin/password', { method: 'POST', body: { current: 'Test-Password-123', password: 'Another-Password-456' } });
  assert.equal(r.status, 200);
  const fresh = cookie;
  cookie = old;
  assert.equal((await apiCall('/api/state')).status, 401);
  cookie = fresh;
  assert.equal((await apiCall('/api/state')).status, 200);
});

echo.close();
console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
process.exit(process.exitCode || 0);
