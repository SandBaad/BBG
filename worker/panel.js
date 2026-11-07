/**
 * BBG · SANDBAAD — Cloudflare Worker edition
 *
 * One Worker + one SQLite-backed Durable Object (PanelStore):
 *   /<adminPath>/          admin panel (UI + JSON API)
 *   /<subPath>/<token>     subscription (base64 | links | xray | singbox | clash)
 *   /<subPath>/<token>/page   subscriber portal
 *   WebSocket on <vlessPath> / <trojanPath>   VLESS / Trojan tunnels (TLS by Cloudflare)
 *   anything else          a plain 404, so the host looks like an ordinary site
 *
 * Every secret (session key, paths, user credentials) is random per install.
 */
import { connect } from 'cloudflare:sockets';
import { DurableObject } from 'cloudflare:workers';
import ASSETS from './assets.js';

const VERSION = '2.1.0';
const BRAND = { brand: 'BBG', tag: 'EDGE', author: 'SANDBAAD' };
const MAX_USERS = 300;
const ACTIVE_TTL_MS = 15_000;
const FLUSH_MS = 120_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

/* ── bytes & randomness ─────────────────────────────────────────────── */

const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
function randBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromB64(text) {
  const s = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
const randToken = (n = 16) => b64url(randBytes(n));
function randId(len = 10) {
  const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
  const b = randBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += abc[b[i] % abc.length];
  return out;
}
function safeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/* ── SHA-224 (Trojan password hash; WebCrypto has no SHA-224) ───────── */

const SHA_K = (() => {
  const k = new Uint32Array(64);
  let n = 2;
  let i = 0;
  const prime = (v) => { for (let d = 2; d * d <= v; d += 1) if (v % d === 0) return false; return true; };
  while (i < 64) {
    if (prime(n)) k[i++] = Math.floor((Math.cbrt(n) % 1) * 2 ** 32) >>> 0;
    n += 1;
  }
  return k;
})();
const SHA224_IV = [0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4];

export function sha224Hex(text) {
  const bytes = enc.encode(String(text));
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 4, (len * 8) >>> 0);
  dv.setUint32(total - 8, Math.floor((len * 8) / 2 ** 32));
  const H = Uint32Array.from(SHA224_IV);
  const W = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i += 1) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const a = W[i - 15];
      const b = W[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + SHA_K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H.subarray(0, 7), (w) => w.toString(16).padStart(8, '0')).join('');
}

/* ── HMAC & password hashing ────────────────────────────────────────── */

const keyCache = new Map();
async function hmacKey(secret) {
  if (!keyCache.has(secret)) {
    keyCache.set(secret, crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  }
  return keyCache.get(secret);
}
async function hmac(secret, data) {
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data))));
}
// 10k iterations keeps a login under the free plan's CPU budget; the server
// secret is mixed in as a pepper, so a stolen hash alone cannot be brute-forced.
const PBKDF2_ITER = 10_000;
async function hashPassword(password, pepper, salt = randToken(16), iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`${password}\u0000${pepper}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: iter }, key, 256);
  return { salt, iter, hash: b64url(new Uint8Array(bits)) };
}
async function checkPassword(password, admin, pepper) {
  if (!admin || !admin.hash) return false;
  const got = await hashPassword(password, pepper, admin.salt, admin.iter || PBKDF2_ITER);
  return safeEqual(got.hash, admin.hash);
}

/* ── document model ─────────────────────────────────────────────────── */

const INBOUND_META = {
  'vless-ws': {
    protocol: 'vless', transport: 'ws',
    title: { fa: 'VLESS + WebSocket (TLS کلادفلر)', en: 'VLESS + WebSocket (Cloudflare TLS)' },
    desc: { fa: 'پایدارترین مسیر روی Worker با دادهٔ اولیه (0-RTT).', en: 'Most stable Worker transport, with 0-RTT early data.' },
  },
  'trojan-ws': {
    protocol: 'trojan', transport: 'ws',
    title: { fa: 'Trojan + WebSocket (TLS کلادفلر)', en: 'Trojan + WebSocket (Cloudflare TLS)' },
    desc: { fa: 'مسیر دوم با رمز اختصاصی هر کاربر؛ برای کلاینت‌هایی که VLESS ندارند.', en: 'Second route with a per-user password, for clients without VLESS.' },
  },
};

function newUser({ name, days = 0, quotaGb = 0, note = '' }) {
  const d = Number(days) || 0;
  const q = Number(quotaGb) || 0;
  return {
    id: randId(10),
    name: String(name || '').trim().slice(0, 64) || 'user',
    enabled: true,
    createdAt: Date.now(),
    expiresAt: d > 0 ? Date.now() + d * 864e5 : null,
    quotaBytes: q > 0 ? Math.round(q * 1024 ** 3) : null,
    note: String(note || '').slice(0, 200),
    uuid: crypto.randomUUID(),
    password: randToken(18),
    subToken: randToken(18),
  };
}

async function freshDoc(env) {
  const secret = randToken(32);
  const doc = {
    rev: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    secrets: { server: secret },
    admin: null,
    settings: {
      theme: 'dark',
      lang: 'fa',
      publicHost: String(env.PUBLIC_HOST || '').trim(),
      cleanIps: String(env.CLEAN_IPS || '').trim(),
      proxyIp: String(env.PROXY_IP || '').trim(),
      fragment: true,
      adminPath: `/${cleanPath(env.ADMIN_PATH, 'panel')}`,
      subPath: cleanPath(env.SUB_PATH, randId(8)),
      vlessPath: `/${randId(14)}`,
      trojanPath: `/${randId(14)}`,
    },
    inbounds: [
      { id: 'vless-ws', enabled: true },
      { id: 'trojan-ws', enabled: true },
    ],
    users: [{
      ...newUser({ name: String(env.FIRST_USER || 'user-1') }),
      ...(/^[A-Za-z0-9_-]{16,}$/.test(String(env.FIRST_SUB_TOKEN || '')) ? { subToken: String(env.FIRST_SUB_TOKEN) } : {}),
    }],
    events: [{ t: Date.now(), kind: 'install', message: `panel installed (v${VERSION})` }],
  };
  if (envPasswordOk(env)) {
    const h = await hashPassword(String(env.ADMIN_PASSWORD), secret);
    doc.admin = { username: envAdminUser(env), ...h, ver: 1, envFp: await envFingerprint(env, secret) };
  }
  return doc;
}

/** Path segment from a variable: letters, digits, - and _ only; reserved names fall back. */
function cleanPath(value, fallback) {
  const s = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) && !['fonts', 'assets'].includes(s.toLowerCase()) ? s : fallback;
}
const envPasswordOk = (env) => String(env.ADMIN_PASSWORD || '').length >= 10;
const envAdminPath = (env) => { const p = cleanPath(env.ADMIN_PATH, ''); return p ? `/${p}` : ''; };
const envFingerprint = (env, secret) => hmac(secret, `admin-env:${env.ADMIN_PASSWORD}`);
const envAdminUser = (env) => (String(env.ADMIN_USER || '').trim().length >= 3 ? String(env.ADMIN_USER).trim().slice(0, 64) : 'admin');

function userStatus(u, usage, now = Date.now()) {
  if (!u.enabled) return 'disabled';
  if (u.expiresAt && u.expiresAt <= now) return 'expired';
  const used = usage ? usage.up + usage.down : 0;
  if (u.quotaBytes && used >= u.quotaBytes) return 'quota';
  return 'active';
}

/* ── Durable Object: the single source of truth ─────────────────────── */

export class PanelStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.doc = null;
    this.attempts = new Map();
  }

  async load() {
    if (this.doc) return;
    let doc = await this.ctx.storage.get('doc');
    if (!doc) {
      doc = await freshDoc(this.env);
      await this.ctx.storage.put('doc', doc);
    }
    this.doc = doc;
    this.usage = (await this.ctx.storage.get('usage')) || {};
    this.traffic = (await this.ctx.storage.get('traffic')) || [];
  }

  async snapshot() {
    await this.load();
    return { doc: this.doc, usage: this.usage, traffic: this.traffic };
  }

  /** Optimistic write: refused when someone saved in between. */
  async save(doc, rev) {
    await this.load();
    if (rev !== this.doc.rev) return { ok: false, conflict: true };
    doc.rev = this.doc.rev + 1;
    doc.updatedAt = Date.now();
    doc.events = (doc.events || []).slice(-60);
    const ids = new Set(doc.users.map((u) => u.id));
    for (const id of Object.keys(this.usage)) if (!ids.has(id)) delete this.usage[id];
    this.doc = doc;
    await this.ctx.storage.put({ doc, usage: this.usage });
    return { ok: true, rev: doc.rev };
  }

  async resetUsage(id) {
    await this.load();
    delete this.usage[id];
    await this.ctx.storage.put('usage', this.usage);
    return true;
  }

  async replaceAll(doc, usage) {
    await this.load();
    doc.rev = this.doc.rev + 1;
    this.doc = doc;
    this.usage = usage || {};
    await this.ctx.storage.put({ doc, usage: this.usage });
    return { ok: true };
  }

  /** What the tunnel needs: who may connect, and where. */
  async active() {
    await this.load();
    const now = Date.now();
    const users = [];
    for (const u of this.doc.users) {
      if (userStatus(u, this.usage[u.id], now) !== 'active') continue;
      users.push({ id: u.id, uuid: u.uuid.replace(/-/g, '').toLowerCase(), th: sha224Hex(u.password) });
    }
    const s = this.doc.settings;
    const on = new Set(this.doc.inbounds.filter((i) => i.enabled).map((i) => i.id));
    return {
      rev: this.doc.rev,
      users,
      paths: { admin: s.adminPath, sub: s.subPath, vless: on.has('vless-ws') ? s.vlessPath : '', trojan: on.has('trojan-ws') ? s.trojanPath : '' },
      proxyIp: s.proxyIp,
    };
  }

  /** Add traffic; answers which of these users are no longer allowed. */
  async addUsage(entries) {
    await this.load();
    const now = Date.now();
    const hour = Math.floor(now / 3_600_000) * 3_600_000;
    let bucket = this.traffic[this.traffic.length - 1];
    if (!bucket || bucket.t !== hour) {
      bucket = { t: hour, up: 0, down: 0 };
      this.traffic.push(bucket);
      if (this.traffic.length > 168) this.traffic = this.traffic.slice(-168);
    }
    const blocked = [];
    for (const { id, up = 0, down = 0 } of entries || []) {
      const u = this.doc.users.find((x) => x.id === id);
      if (!u) { blocked.push(id); continue; }
      const rec = this.usage[id] || (this.usage[id] = { up: 0, down: 0, lastSeen: 0 });
      rec.up += Math.max(0, Number(up) || 0);
      rec.down += Math.max(0, Number(down) || 0);
      rec.lastSeen = now;
      bucket.up += Math.max(0, Number(up) || 0);
      bucket.down += Math.max(0, Number(down) || 0);
      if (userStatus(u, rec, now) !== 'active') blocked.push(id);
    }
    await this.ctx.storage.put({ usage: this.usage, traffic: this.traffic });
    return { blocked };
  }

  /** Sliding-window limiter for logins (per client IP). */
  async hit(key, max = 8, windowMs = 600_000) {
    const now = Date.now();
    const list = (this.attempts.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now);
    this.attempts.set(key, list);
    if (this.attempts.size > 5000) this.attempts.clear();
    return { blocked: list.length > max, retryInMs: list.length > max ? windowMs - (now - list[0]) : 0 };
  }

  async clearHits(key) {
    this.attempts.delete(key);
    return true;
  }
}

/* ── per-isolate cache of the tunnel allow-list ─────────────────────── */

let ACTIVE = { at: 0, data: null, vless: null, trojan: null };
const storeOf = (env) => env.STORE.get(env.STORE.idFromName('main'));

async function activeSet(env, force = false) {
  if (!force && ACTIVE.data && Date.now() - ACTIVE.at < ACTIVE_TTL_MS) return ACTIVE;
  let data = await storeOf(env).active();
  const want = envAdminPath(env);
  if (want && data.paths.admin !== want) {
    // ADMIN_PATH changed in the Cloudflare dashboard: the variable wins.
    await mutate(env, (d) => { d.settings.adminPath = want; event(d, 'settings', 'admin path updated from ADMIN_PATH'); return null; });
    data = await storeOf(env).active();
  }
  ACTIVE = {
    at: Date.now(),
    data,
    vless: new Map(data.users.map((u) => [u.uuid, u.id])),
    trojan: new Map(data.users.map((u) => [u.th, u.id])),
  };
  return ACTIVE;
}

/* ── tunnels ────────────────────────────────────────────────────────── */

function parseVless(bytes, allow) {
  if (bytes.length < 24) return { error: 'short' };
  const id = toHex(bytes.subarray(1, 17));
  const userId = allow.get(id);
  if (!userId) return { error: 'auth' };
  let p = 18 + bytes[17];
  const cmd = bytes[p];
  const port = (bytes[p + 1] << 8) | bytes[p + 2];
  const type = bytes[p + 3];
  p += 4;
  let host = '';
  if (type === 1) { host = Array.from(bytes.subarray(p, p + 4)).join('.'); p += 4; }
  else if (type === 2) { const n = bytes[p]; host = dec.decode(bytes.subarray(p + 1, p + 1 + n)); p += 1 + n; }
  else if (type === 3) {
    const parts = [];
    for (let i = 0; i < 8; i += 1) parts.push(((bytes[p + i * 2] << 8) | bytes[p + i * 2 + 1]).toString(16));
    host = `[${parts.join(':')}]`;
    p += 16;
  } else return { error: 'addr' };
  if (cmd !== 1 && !(cmd === 2 && port === 53)) return { error: 'cmd' };
  return { userId, udp: cmd === 2, host, port, rest: bytes.subarray(p), reply: new Uint8Array([bytes[0], 0]) };
}

function parseTrojan(bytes, allow) {
  if (bytes.length < 60 || bytes[56] !== 0x0d || bytes[57] !== 0x0a) return { error: 'short' };
  const userId = allow.get(dec.decode(bytes.subarray(0, 56)).toLowerCase());
  if (!userId) return { error: 'auth' };
  const cmd = bytes[58];
  if (cmd !== 1) return { error: 'cmd' };
  const type = bytes[59];
  let p = 60;
  let host = '';
  if (type === 1) { host = Array.from(bytes.subarray(p, p + 4)).join('.'); p += 4; }
  else if (type === 3) { const n = bytes[p]; host = dec.decode(bytes.subarray(p + 1, p + 1 + n)); p += 1 + n; }
  else if (type === 4) {
    const parts = [];
    for (let i = 0; i < 8; i += 1) parts.push(((bytes[p + i * 2] << 8) | bytes[p + i * 2 + 1]).toString(16));
    host = `[${parts.join(':')}]`;
    p += 16;
  } else return { error: 'addr' };
  const port = (bytes[p] << 8) | bytes[p + 1];
  p += 2;
  if (bytes[p] === 0x0d && bytes[p + 1] === 0x0a) p += 2;
  return { userId, udp: false, host, port, rest: bytes.subarray(p), reply: null };
}

function splitHostPort(text, fallbackPort) {
  const v = String(text || '').trim();
  if (!v) return null;
  const m = /^(?:\[([0-9a-fA-F:]+)\]|([a-zA-Z0-9.-]+))(?::(\d{1,5}))?$/.exec(v);
  if (!m) return null;
  const port = Number(m[3] || fallbackPort);
  if (!(port > 0 && port < 65536)) return null;
  return { host: m[1] || m[2], port };
}

async function openSocket(host, port) {
  const sock = connect({ hostname: host.replace(/^\[|\]$/g, ''), port });
  await sock.opened;
  return sock;
}

function tunnel(request, env, ctx, kind, cache) {
  const pair = new WebSocketPair();
  const [client, ws] = Object.values(pair);
  ws.accept();

  let userId = '';
  let remote = null;
  let writer = null;
  let first = null;
  let up = 0;
  let down = 0;
  let reported = { up: 0, down: 0 };
  let retried = false;
  let closed = false;
  let flushTimer = null;
  let udpSend = null;

  const report = async (final) => {
    const du = up - reported.up;
    const dd = down - reported.down;
    if (!userId || (du + dd === 0 && !final)) return;
    reported = { up, down };
    if (du + dd === 0) return;
    try {
      const res = await storeOf(env).addUsage([{ id: userId, up: du, down: dd }]);
      if (res.blocked.includes(userId)) {
        ACTIVE.at = 0; // refresh this isolate's allow-list now, not in 15 s
        if (!final) close(1008);
      }
    } catch { /* accounting is best effort */ }
  };
  const close = (code = 1000) => {
    if (closed) return;
    closed = true;
    clearInterval(flushTimer);
    try { ws.close(code); } catch { /* ignore */ }
    try { remote?.close(); } catch { /* ignore */ }
    const p = report(true);
    try { ctx.waitUntil(p); } catch { /* ignore */ }
  };

  const pump = async (sock, reply) => {
    let got = 0;
    let headerSent = !reply;
    try {
      const reader = sock.readable.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || !value.byteLength) continue;
        got += value.byteLength;
        down += value.byteLength;
        if (!headerSent) {
          const out = new Uint8Array(reply.length + value.byteLength);
          out.set(reply);
          out.set(value, reply.length);
          ws.send(out);
          headerSent = true;
        } else ws.send(value);
      }
    } catch { /* remote closed */ }
    return { got, headerSent };
  };

  const dial = async (target) => {
    const proxy = splitHostPort(cache.data.proxyIp, 443);
    try {
      return await openSocket(target.host, target.port);
    } catch (err) {
      if (!proxy) throw err;
      retried = true;
      return openSocket(proxy.host, proxy.port);
    }
  };

  const start = async (chunk) => {
    const head = kind === 'vless' ? parseVless(chunk, cache.vless) : parseTrojan(chunk, cache.trojan);
    if (head.error) {
      close(1008);
      return;
    }
    userId = head.userId;
    first = head;
    up += head.rest.byteLength;
    if (head.udp) {
      udpSend = dnsRelay(ws, head.reply, (n) => { down += n; });
      if (head.rest.byteLength) await udpSend(head.rest);
      return;
    }
    remote = await dial(head);
    writer = remote.writable.getWriter();
    if (head.rest.byteLength) await writer.write(head.rest);
    flushTimer = setInterval(() => { report(false); }, FLUSH_MS);
    pump(remote, head.reply).then(async ({ got, headerSent }) => {
      const proxy = splitHostPort(cache.data.proxyIp, 443);
      // Cloudflare-hosted destinations refuse Workers; retry once through ProxyIP.
      if (got === 0 && !retried && proxy && !closed) {
        retried = true;
        try {
          try { writer.releaseLock(); remote.close(); } catch { /* ignore */ }
          remote = await openSocket(proxy.host, proxy.port);
          writer = remote.writable.getWriter();
          if (first.rest.byteLength) await writer.write(first.rest);
          await pump(remote, headerSent ? null : first.reply);
        } catch { /* fall through */ }
      }
      close();
    });
  };

  let chain = Promise.resolve();
  const onChunk = (data) => {
    chain = chain.then(async () => {
      if (closed) return;
      const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
      if (!first) return start(chunk);
      up += chunk.byteLength;
      if (udpSend) return udpSend(chunk);
      if (writer) await writer.write(chunk);
    }).catch(() => close(1011));
  };

  const early = request.headers.get('sec-websocket-protocol');
  if (early) {
    try {
      const bytes = fromB64(early.split(',')[0].trim());
      if (bytes.byteLength) onChunk(bytes);
    } catch { /* not early data */ }
  }
  ws.addEventListener('message', (ev) => onChunk(typeof ev.data === 'string' ? enc.encode(ev.data) : ev.data));
  ws.addEventListener('close', () => close());
  ws.addEventListener('error', () => close());

  const headers = early ? { 'Sec-WebSocket-Protocol': early.split(',')[0].trim() } : {};
  return new Response(null, { status: 101, webSocket: client, headers });
}

/** VLESS UDP is limited to DNS; each packet is length-prefixed. */
function dnsRelay(ws, reply, count) {
  let headerSent = false;
  let buf = new Uint8Array(0);
  return async (chunk) => {
    const merged = new Uint8Array(buf.length + chunk.length);
    merged.set(buf);
    merged.set(chunk, buf.length);
    buf = merged;
    while (buf.length >= 2) {
      const len = (buf[0] << 8) | buf[1];
      if (buf.length < 2 + len) break;
      const query = buf.slice(2, 2 + len);
      buf = buf.slice(2 + len);
      const res = await fetch('https://1.1.1.1/dns-query', { method: 'POST', headers: { 'content-type': 'application/dns-message' }, body: query });
      if (!res.ok) continue;
      const ans = new Uint8Array(await res.arrayBuffer());
      const pre = headerSent || !reply ? new Uint8Array(0) : reply;
      const out = new Uint8Array(pre.length + 2 + ans.length);
      out.set(pre);
      out[pre.length] = ans.length >> 8;
      out[pre.length + 1] = ans.length & 0xff;
      out.set(ans, pre.length + 2);
      headerSent = true;
      count(out.length);
      ws.send(out);
    }
  };
}

/* ── links & subscriptions ──────────────────────────────────────────── */

function endpoints(doc, host) {
  const main = doc.settings.publicHost || host;
  const ips = String(doc.settings.cleanIps || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
  return { host: main, list: [{ addr: main, tag: '' }, ...ips.map((ip, i) => ({ addr: ip, tag: `IP${i + 1}` }))] };
}

function linksFor(doc, user, host) {
  const { host: sni, list } = endpoints(doc, host);
  const out = [];
  for (const ib of doc.inbounds) {
    if (!ib.enabled) continue;
    const meta = INBOUND_META[ib.id];
    if (!meta) continue;
    const path = ib.id === 'vless-ws' ? doc.settings.vlessPath : doc.settings.trojanPath;
    for (const ep of list) {
      const label = `BBG-${meta.protocol.toUpperCase()}${ep.tag ? `-${ep.tag}` : ''}`;
      const q = new URLSearchParams({
        ...(meta.protocol === 'vless' ? { encryption: 'none' } : {}),
        security: 'tls', sni, fp: 'chrome', alpn: 'http/1.1', type: 'ws', host: sni, path: `${path}?ed=2048`,
      });
      const cred = meta.protocol === 'vless' ? user.uuid : encodeURIComponent(user.password);
      out.push({
        id: `${ib.id}${ep.tag ? `-${ep.tag}` : ''}`,
        inboundId: ib.id,
        label,
        short: `${meta.protocol.toUpperCase()} · WS${ep.tag ? ` · ${ep.tag}` : ''}`,
        protocol: meta.protocol,
        transport: 'ws',
        security: 'tls',
        core: 'worker',
        conn: { host: ep.addr, port: 443, sni, path },
        uri: `${meta.protocol}://${cred}@${ep.addr.includes(':') ? `[${ep.addr}]` : ep.addr}:443?${q}#${encodeURIComponent(label)}`,
      });
    }
  }
  return out;
}

function subHeaders(doc, user, usage) {
  const used = usage ? usage.up + usage.down : 0;
  return {
    'subscription-userinfo': `upload=${usage?.up || 0}; download=${usage?.down || 0}; total=${user.quotaBytes || 0}; expire=${user.expiresAt ? Math.floor(user.expiresAt / 1000) : 0}`,
    'profile-update-interval': '6',
    'profile-title': `base64:${b64(enc.encode(`BBG · ${user.name}`))}`,
    'cache-control': 'no-store',
    'x-used-bytes': String(used),
  };
}

function xrayJson(doc, user, links) {
  const frag = doc.settings.fragment !== false;
  const outs = links.map((l, i) => ({
    tag: i === 0 ? 'proxy' : `proxy-${i + 1}`,
    protocol: l.protocol,
    settings: l.protocol === 'trojan'
      ? { servers: [{ address: l.conn.host, port: 443, password: user.password }] }
      : { vnext: [{ address: l.conn.host, port: 443, users: [{ id: user.uuid, encryption: 'none' }] }] },
    streamSettings: {
      network: 'ws',
      security: 'tls',
      tlsSettings: { serverName: l.conn.sni, fingerprint: 'chrome', alpn: ['http/1.1'] },
      wsSettings: { path: `${l.conn.path}?ed=2048`, host: l.conn.sni },
      sockopt: { tcpNoDelay: true, ...(frag ? { dialerProxy: 'fragment' } : {}) },
    },
  }));
  return {
    remarks: `BBG · ${user.name}`,
    log: { loglevel: 'warning' },
    dns: { servers: ['https://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query'], queryStrategy: 'UseIPv4' },
    inbounds: [
      { tag: 'socks', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: { udp: true }, sniffing: { enabled: true, destOverride: ['http', 'tls'], routeOnly: true } },
      { tag: 'http', port: 10809, listen: '127.0.0.1', protocol: 'http', sniffing: { enabled: true, destOverride: ['http', 'tls'], routeOnly: true } },
    ],
    outbounds: [
      ...outs,
      ...(frag ? [{ tag: 'fragment', protocol: 'freedom', settings: { fragment: { packets: 'tlshello', length: '100-200', interval: '10-20' } }, streamSettings: { sockopt: { tcpNoDelay: true } } }] : []),
      { tag: 'direct', protocol: 'freedom' },
      { tag: 'block', protocol: 'blackhole' },
    ],
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' },
        { type: 'field', domain: ['domain:ir'], outboundTag: 'direct' },
        { type: 'field', network: 'tcp,udp', outboundTag: 'proxy' },
      ],
    },
  };
}

function singboxJson(doc, user, links) {
  const frag = doc.settings.fragment !== false;
  const nodes = links.map((l, i) => ({
    type: l.protocol,
    tag: `${l.label}${links.filter((x) => x.label === l.label).length > 1 ? `-${i + 1}` : ''}`,
    server: l.conn.host,
    server_port: 443,
    ...(l.protocol === 'trojan' ? { password: user.password } : { uuid: user.uuid }),
    tls: {
      enabled: true,
      server_name: l.conn.sni,
      alpn: ['http/1.1'],
      utls: { enabled: true, fingerprint: 'chrome' },
      ...(frag ? { fragment: true } : {}),
    },
    transport: { type: 'ws', path: l.conn.path, headers: { Host: l.conn.sni }, max_early_data: 2048, early_data_header_name: 'Sec-WebSocket-Protocol' },
  }));
  const tags = nodes.map((n) => n.tag);
  return {
    log: { level: 'warn' },
    dns: {
      servers: [
        { type: 'https', tag: 'remote', server: '1.1.1.1', detour: 'proxy' },
        { type: 'local', tag: 'local' },
      ],
      rules: [{ domain_suffix: ['.ir'], server: 'local' }],
      final: 'remote',
      strategy: 'prefer_ipv4',
    },
    inbounds: [
      { type: 'tun', tag: 'tun-in', address: ['172.19.0.1/30'], auto_route: true, strict_route: true, stack: 'mixed' },
      { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 },
    ],
    outbounds: [
      { type: 'selector', tag: 'proxy', outbounds: ['auto', ...tags], default: 'auto' },
      { type: 'urltest', tag: 'auto', outbounds: tags, url: 'https://www.gstatic.com/generate_204', interval: '3m', tolerance: 50 },
      ...nodes,
      { type: 'direct', tag: 'direct' },
    ],
    route: {
      rules: [
        { action: 'sniff' },
        { protocol: 'dns', action: 'hijack-dns' },
        { ip_is_private: true, outbound: 'direct' },
        { domain_suffix: ['.ir'], outbound: 'direct' },
      ],
      final: 'proxy',
      auto_detect_interface: true,
      default_domain_resolver: 'local',
    },
  };
}

function clashYaml(doc, user, links) {
  const q = (s) => JSON.stringify(String(s));
  const names = links.map((l, i) => `${l.label}${links.filter((x) => x.label === l.label).length > 1 ? `-${i + 1}` : ''}`);
  const lines = ['mixed-port: 7890', 'allow-lan: false', 'mode: rule', 'log-level: warning', 'ipv6: false', 'unified-delay: true', 'tcp-concurrent: true', 'global-client-fingerprint: chrome', 'proxies:'];
  links.forEach((l, i) => {
    const cred = l.protocol === 'trojan' ? `password: ${q(user.password)}` : `uuid: ${q(user.uuid)}`;
    const sni = l.protocol === 'trojan' ? 'sni' : 'servername';
    lines.push(`  - { name: ${q(names[i])}, type: ${l.protocol}, server: ${q(l.conn.host)}, port: 443, ${cred}, udp: true, tls: true, ${sni}: ${q(l.conn.sni)}, alpn: [http/1.1], client-fingerprint: chrome, network: ws, ws-opts: { path: ${q(l.conn.path)}, headers: { Host: ${q(l.conn.sni)} }, max-early-data: 2048, early-data-header-name: Sec-WebSocket-Protocol } }`);
  });
  if (!links.length) lines.push('  []');
  lines.push('proxy-groups:');
  lines.push(`  - { name: "BBG", type: select, proxies: [${['"AUTO"', ...names.map(q), '"DIRECT"'].join(', ')}] }`);
  lines.push(`  - { name: "AUTO", type: url-test, proxies: [${names.map(q).join(', ') || '"DIRECT"'}], url: "https://www.gstatic.com/generate_204", interval: 180, tolerance: 50 }`);
  lines.push('rules:', '  - GEOIP,PRIVATE,DIRECT,no-resolve', '  - DOMAIN-SUFFIX,ir,DIRECT', '  - MATCH,BBG', '');
  return lines.join('\n');
}

function subscription(doc, user, usage, host, format) {
  const links = linksFor(doc, user, host);
  const head = subHeaders(doc, user, usage);
  switch (format) {
    case 'links': return new Response(links.map((l) => l.uri).join('\n') + '\n', { headers: { ...head, 'content-type': 'text/plain; charset=utf-8' } });
    case 'xray': return new Response(JSON.stringify(xrayJson(doc, user, links), null, 2), { headers: { ...head, 'content-type': 'application/json; charset=utf-8' } });
    case 'singbox': return new Response(JSON.stringify(singboxJson(doc, user, links), null, 2), { headers: { ...head, 'content-type': 'application/json; charset=utf-8' } });
    case 'clash': return new Response(clashYaml(doc, user, links), { headers: { ...head, 'content-type': 'text/yaml; charset=utf-8' } });
    default: return new Response(b64(enc.encode(links.map((l) => l.uri).join('\n'))), { headers: { ...head, 'content-type': 'text/plain; charset=utf-8' } });
  }
}

/* ── state for the admin UI ─────────────────────────────────────────── */

function buildState(snap, host) {
  const { doc, usage, traffic } = snap;
  const s = doc.settings;
  const origin = `https://${s.publicHost || host}`;
  const users = doc.users.map((u) => {
    const use = usage[u.id] || { up: 0, down: 0, lastSeen: 0 };
    const status = userStatus(u, use);
    return {
      id: u.id,
      name: u.name,
      enabled: u.enabled,
      status,
      note: u.note,
      ipLimit: 0,
      createdAt: u.createdAt,
      expiresAt: u.expiresAt,
      quotaBytes: u.quotaBytes,
      usage: { up: use.up, down: use.down, total: use.up + use.down },
      lastSeen: use.lastSeen,
      links: status === 'active' ? linksFor(doc, u, host).map(({ conn, ...l }) => l) : [],
      subToken: u.subToken,
      subUrl: `${origin}/${s.subPath}/${u.subToken}`,
      portalUrl: `${origin}/${s.subPath}/${u.subToken}/page`,
    };
  });
  const warnings = [];
  if (!s.proxyIp) warnings.push({ level: 'warn', fa: 'ProxyIP خالی است؛ سایت‌هایی که پشت کلادفلر هستند از این پنل باز نمی‌شوند.', en: 'ProxyIP is empty; sites behind Cloudflare will not open through this panel.' });
  if (!s.publicHost && /\.workers\.dev$/i.test(host)) warnings.push({ level: 'info', fa: 'دامنهٔ workers.dev در ایران اغلب فیلتر است؛ یک دامنهٔ شخصی یا IP تمیز اضافه کنید.', en: 'workers.dev is often filtered in Iran; add a custom domain or clean IPs.' });
  if (!doc.users.length) warnings.push({ level: 'info', fa: 'هنوز مشترکی ساخته نشده است.', en: 'No subscribers yet.' });
  return {
    app: { ...BRAND, version: VERSION, now: Date.now() },
    edition: 'worker',
    features: { telegram: false, cores: false, scanner: false, easy: false, raw: false, update: false, logs: false, probe: false, ping: false },
    facts: { publicHost: s.publicHost || host, panelUrl: `${origin}${s.adminPath}/`, host, isCloudflare: true, subBase: `${origin}/${s.subPath}` },
    settings: { theme: s.theme, lang: s.lang, publicHost: s.publicHost, cleanIps: s.cleanIps, proxyIp: s.proxyIp, fragment: s.fragment !== false },
    inbounds: doc.inbounds.map((ib) => {
      const meta = INBOUND_META[ib.id];
      return {
        id: ib.id, presetId: ib.id, label: meta.title.en, enabled: ib.enabled, core: 'worker', protocol: meta.protocol,
        transport: 'ws', security: 'tls-edge', edge: 'http', udp: false, port: 443,
        params: { path: ib.id === 'vless-ws' ? s.vlessPath : s.trojanPath }, title: meta.title, desc: meta.desc, fields: [], reachable: true, reason: null,
      };
    }),
    presets: [],
    users,
    traffic: traffic.slice(-48),
    trafficUnit: 'hour',
    events: doc.events.slice(-40).reverse(),
    limits: { maxUsers: MAX_USERS },
    warnings,
  };
}

/* ── HTTP plumbing ──────────────────────────────────────────────────── */

const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC_HEADERS, ...headers } });

const NOT_FOUND_HTML = '<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';
const notFound = () => new Response(NOT_FOUND_HTML, { status: 404, headers: { 'content-type': 'text/html', server: 'nginx' } });

function serveAsset(rel, base, extra = {}) {
  const key = rel === '' || rel === '/' ? '/index.html' : rel;
  const a = ASSETS[key];
  if (!a) return null;
  let body = a.text !== undefined ? a.text : fromB64(a.b64);
  if (key === '/index.html' || key === '/portal.html') {
    body = body.replace('<meta name="panel-base" content="">', `<meta name="panel-base" content="${base}">`);
    for (const [k, v] of Object.entries(extra)) body = body.replace(`<meta name="${k}" content="">`, `<meta name="${k}" content="${v}">`);
  }
  const html = key.endsWith('.html');
  // The portal is a single self-contained file, so it needs inline script.
  const scriptSrc = key === '/portal.html' ? "'unsafe-inline'" : "'self'";
  return new Response(body, {
    headers: {
      'content-type': a.type,
      'cache-control': html ? 'no-store' : 'public, max-age=86400',
      ...SEC_HEADERS,
      ...(html ? { 'content-security-policy': `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` } : {}),
    },
  });
}

const COOKIE = '__Host-bbg';
async function readSession(request, doc) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(request.headers.get('cookie') || '');
  if (!m || !doc.admin) return null;
  const [body, mac] = m[1].split('.');
  if (!body || !mac) return null;
  if (!safeEqual(mac, await hmac(doc.secrets.server, `s:${body}`))) return null;
  try {
    const p = JSON.parse(dec.decode(fromB64(body)));
    if (p.exp < Date.now() || p.u !== doc.admin.username || p.v !== doc.admin.ver) return null;
    return p;
  } catch {
    return null;
  }
}
async function sessionCookie(doc) {
  const body = b64url(enc.encode(JSON.stringify({ u: doc.admin.username, v: doc.admin.ver, exp: Date.now() + 7 * 864e5 })));
  const mac = await hmac(doc.secrets.server, `s:${body}`);
  return `${COOKIE}=${body}.${mac}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800`;
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > 512 * 1024) throw new Error('body too large');
  return text ? JSON.parse(text) : {};
}

/** Read-modify-write with retry on concurrent saves. */
async function mutate(env, fn) {
  const store = storeOf(env);
  for (let i = 0; i < 4; i += 1) {
    const snap = await store.snapshot();
    const doc = structuredClone(snap.doc);
    const result = await fn(doc, snap);
    if (result && result.error) return result;
    const saved = await store.save(doc, snap.doc.rev);
    if (saved.ok) {
      ACTIVE.at = 0;
      return { ok: true, result };
    }
  }
  return { error: 'busy, try again', status: 409 };
}

const event = (doc, kind, message) => doc.events.push({ t: Date.now(), kind, message });

async function api(request, env, url, rel, host) {
  const store = storeOf(env);
  let snap = await store.snapshot();
  if (envPasswordOk(env)) {
    // ADMIN_PASSWORD added or changed in the Cloudflare dashboard: create the admin, or reset its
    // password (the "forgot password" path). A password changed inside the panel is left alone.
    const fp = await envFingerprint(env, snap.doc.secrets.server);
    if (snap.doc.admin?.envFp !== fp) {
      await mutate(env, async (d) => {
        const cur = d.admin;
        if (cur && cur.envFp === fp) return null;
        if (cur && !cur.envFp) { cur.envFp = fp; return null; }
        d.admin = { username: envAdminUser(env), ...(await hashPassword(String(env.ADMIN_PASSWORD), d.secrets.server)), ver: (cur?.ver || 0) + 1, envFp: fp };
        event(d, 'auth', cur ? 'admin password reset from ADMIN_PASSWORD' : 'admin account created from ADMIN_PASSWORD');
        return null;
      });
      snap = await store.snapshot();
    }
  }
  const { doc } = snap;
  const method = request.method.toUpperCase();
  const route = `${method} ${rel}`;

  if (method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'bad origin' }, 403);
    if (request.headers.get('x-requested-with') !== 'bbg') return json({ error: 'missing header' }, 403);
  }

  const session = await readSession(request, doc);

  if (route === 'GET /api/bootstrap') {
    return json({ app: { ...BRAND, version: VERSION }, edition: 'worker', needsSetup: false, setupBlocked: !doc.admin, loggedIn: Boolean(session), username: session?.u || '', settings: { theme: doc.settings.theme, lang: doc.settings.lang } });
  }
  if (route === 'POST /api/setup') {
    if (doc.admin) return json({ error: 'already configured' }, 409);
    // No open first-run setup on the Worker: whoever found the address first could claim the panel.
    return json({ error: 'set the ADMIN_PASSWORD secret (10+ characters) in Cloudflare, then reload' }, 403);
  }
  if (route === 'POST /api/login') {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const gate = await store.hit(`login:${ip}`);
    if (gate.blocked) return json({ error: 'too many attempts', retryInMs: gate.retryInMs }, 429);
    const body = await readJson(request);
    if (!doc.admin) return json({ error: 'setup required' }, 409);
    const okUser = safeEqual(String(body.username || ''), doc.admin.username);
    const okPass = await checkPassword(String(body.password || ''), doc.admin, doc.secrets.server);
    if (!okUser || !okPass) return json({ error: 'invalid credentials' }, 401);
    await store.clearHits(`login:${ip}`);
    return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(doc) });
  }
  if (route === 'POST /api/logout') {
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0` });
  }
  if (!session) return json({ error: 'unauthorized' }, 401);

  const respond = async () => json({ ok: true, state: buildState(await store.snapshot(), host) });

  if (route === 'GET /api/state') return json(buildState(snap, host));
  if (route === 'POST /api/apply') return respond();

  if (route === 'POST /api/settings') {
    const body = await readJson(request);
    const r = await mutate(env, (d) => {
      const s = d.settings;
      if (body.theme === 'dark' || body.theme === 'light') s.theme = body.theme;
      if (body.lang === 'fa' || body.lang === 'en') s.lang = body.lang;
      if (body.publicHost !== undefined) {
        const h = String(body.publicHost).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
        if (h && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return { error: 'invalid domain' };
        s.publicHost = h;
      }
      if (body.cleanIps !== undefined) {
        const list = String(body.cleanIps).split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
        if (list.some((x) => !/^[0-9a-fA-F:.\-a-z]+$/.test(x))) return { error: 'invalid clean IP list' };
        s.cleanIps = list.slice(0, 5).join(',');
      }
      if (body.proxyIp !== undefined) {
        const v = String(body.proxyIp).trim();
        if (v && !splitHostPort(v, 443)) return { error: 'invalid ProxyIP' };
        s.proxyIp = v;
      }
      if (body.fragment !== undefined) s.fragment = Boolean(body.fragment);
    });
    if (r.error) return json({ error: r.error }, r.status || 400);
    return respond();
  }

  if (route === 'POST /api/admin/password') {
    const body = await readJson(request);
    const next = String(body.password || '');
    if (next.length < 10) return json({ error: 'password must be at least 10 characters' }, 400);
    if (!(await checkPassword(String(body.current || ''), doc.admin, doc.secrets.server))) return json({ error: 'wrong current password' }, 403);
    const r = await mutate(env, async (d) => {
      d.admin = { username: d.admin.username, ...(await hashPassword(next, d.secrets.server)), ver: (d.admin.ver || 1) + 1, envFp: d.admin.envFp };
      event(d, 'auth', 'admin password changed');
    });
    if (r.error) return json({ error: r.error }, r.status || 400);
    const fresh = (await store.snapshot()).doc;
    return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(fresh) });
  }

  if (route === 'POST /api/users') {
    const body = await readJson(request);
    let id = '';
    const r = await mutate(env, (d) => {
      if (d.users.length >= MAX_USERS) return { error: 'user limit reached' };
      const u = newUser({ name: body.name || `user-${d.users.length + 1}`, days: body.days, quotaGb: body.quotaGb, note: body.note });
      id = u.id;
      d.users.push(u);
      event(d, 'user', `user created (${u.name})`);
    });
    if (r.error) return json({ error: r.error }, r.status || 400);
    return json({ ok: true, user: { id }, state: buildState(await store.snapshot(), host) });
  }

  const um = /^\/api\/users\/([a-z0-9]+)(?:\/([a-z]+))?$/.exec(rel);
  if (um) {
    const [, uid, action] = um;
    if (!doc.users.some((u) => u.id === uid)) return json({ error: 'user not found' }, 404);
    if (action === 'resettraffic' || action === 'reset') {
      await store.resetUsage(uid);
      ACTIVE.at = 0;
      return respond();
    }
    const body = method === 'DELETE' ? {} : await readJson(request);
    const r = await mutate(env, (d) => {
      const idx = d.users.findIndex((u) => u.id === uid);
      if (idx < 0) return { error: 'user not found', status: 404 };
      const u = d.users[idx];
      if (method === 'DELETE') {
        d.users.splice(idx, 1);
        event(d, 'user', `user removed (${u.name})`);
        return null;
      }
      if (action === 'rotate') {
        u.uuid = crypto.randomUUID();
        u.password = randToken(18);
        u.subToken = randToken(18);
        event(d, 'user', `credentials and link rotated (${u.name})`);
        return null;
      }
      if (body.name !== undefined) u.name = String(body.name).trim().slice(0, 64) || u.name;
      if (body.enabled !== undefined) u.enabled = Boolean(body.enabled);
      if (body.quotaGb !== undefined) u.quotaBytes = Number(body.quotaGb) > 0 ? Math.round(Number(body.quotaGb) * 1024 ** 3) : null;
      if (body.days !== undefined) u.expiresAt = Number(body.days) > 0 ? Date.now() + Number(body.days) * 864e5 : null;
      if (body.note !== undefined) u.note = String(body.note).slice(0, 200);
      return null;
    });
    if (r.error) return json({ error: r.error }, r.status || 400);
    return respond();
  }

  const im = /^\/api\/inbounds\/([a-z-]+)$/.exec(rel);
  if (im) {
    const body = await readJson(request);
    const r = await mutate(env, (d) => {
      const ib = d.inbounds.find((x) => x.id === im[1]);
      if (!ib) return { error: 'inbound not found', status: 404 };
      if (body.enabled !== undefined) ib.enabled = Boolean(body.enabled);
      if (!d.inbounds.some((x) => x.enabled)) return { error: 'keep at least one protocol on' };
      return null;
    });
    if (r.error) return json({ error: r.error }, r.status || 400);
    return respond();
  }

  if (route === 'GET /api/backup') {
    return json({ exportedAt: new Date().toISOString(), edition: 'worker', version: VERSION, doc: snap.doc, usage: snap.usage }, 200, {
      'content-disposition': `attachment; filename="bbg-worker-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    });
  }
  if (route === 'POST /api/restore') {
    const body = await readJson(request);
    const incoming = body.doc || body;
    const ok = incoming && Array.isArray(incoming.users) && incoming.settings && incoming.secrets?.server && incoming.admin?.hash
      && incoming.users.every((u) => u && u.id && u.uuid && u.password && u.subToken);
    if (!ok) return json({ error: 'not a backup of this panel (needs admin, secrets and users)' }, 400);
    incoming.inbounds = Array.isArray(incoming.inbounds) && incoming.inbounds.length ? incoming.inbounds : doc.inbounds;
    incoming.events = Array.isArray(incoming.events) ? incoming.events : [];
    await store.replaceAll(incoming, body.usage || {});
    ACTIVE.at = 0;
    return json({ ok: true, relogin: true, panelUrl: `${url.origin}${envAdminPath(env) || incoming.settings.adminPath}/` });
  }

  return json({ error: 'not found' }, 404);
}

/* ── entry ──────────────────────────────────────────────────────────── */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname;
    let cache;
    try {
      cache = await activeSet(env);
    } catch (err) {
      return new Response('storage unavailable', { status: 503 });
    }
    const { paths } = cache.data;
    const path = url.pathname;

    if ((request.headers.get('upgrade') || '').toLowerCase() === 'websocket') {
      if (paths.vless && path === paths.vless) return tunnel(request, env, ctx, 'vless', cache);
      if (paths.trojan && path === paths.trojan) return tunnel(request, env, ctx, 'trojan', cache);
      return notFound();
    }

    if (path === paths.admin) return Response.redirect(`${url.origin}${paths.admin}/`, 302);
    if (path.startsWith(`${paths.admin}/`)) {
      const rel = path.slice(paths.admin.length);
      if (rel.startsWith('/api/')) {
        try {
          return await api(request, env, url, rel, host);
        } catch (err) {
          return json({ error: err && err.message === 'body too large' ? 'body too large' : 'bad request' }, 400);
        }
      }
      if (rel === '/portal.html') return notFound();
      return serveAsset(rel === '/' ? '/index.html' : rel, paths.admin) || notFound();
    }

    if (path.startsWith(`/${paths.sub}/`)) {
      const [token, view] = path.slice(paths.sub.length + 2).split('/');
      const snap = await storeOf(env).snapshot();
      const user = snap.doc.users.find((u) => safeEqual(u.subToken, token || ''));
      if (!user) return notFound();
      const usage = snap.usage[user.id] || { up: 0, down: 0 };
      if (view === 'page') return serveAsset('/portal.html', '', { 'portal-data': `/${paths.sub}/${token}/info` }) || notFound();
      if (view === 'info') {
        const st = userStatus(user, usage);
        const links = st === 'active' ? linksFor(snap.doc, user, host) : [];
        return json({
          name: user.name, status: st, usage: { up: usage.up, down: usage.down, total: usage.up + usage.down }, quotaBytes: user.quotaBytes, expiresAt: user.expiresAt,
          subUrl: `${url.origin}/${paths.sub}/${token}`,
          links: links.map((l) => ({ label: l.label, short: l.short, uri: l.uri, protocol: l.protocol, transport: l.transport })),
        });
      }
      const format = String(view || url.searchParams.get('format') || 'base64').toLowerCase();
      if (!['base64', 'links', 'xray', 'singbox', 'clash'].includes(format)) return notFound();
      return subscription(snap.doc, user, usage, host, format);
    }

    if (path.startsWith('/fonts/') || path.startsWith('/assets/')) {
      return serveAsset(path, paths.admin) || notFound();
    }
    return notFound();
  },
};
