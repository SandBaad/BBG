/**
 * BBG · SANDBAAD — Edge control plane & gateway runtime.
 */
import ASSETS from './assets.js';

const VERSION = '2.1.0';
const BRAND = { brand: 'BBG', tag: 'EDGE', author: 'SANDBAAD' };
const MAX_USERS = 300;
const ACTIVE_TTL_MS = 15_000;
const FLUSH_MS = 120_000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const MASK = [0x5a, 0xa3, 0x6f, 0xd4, 0x39, 0x8e, 0xc7, 0x1b];

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
  const raw = String(text || '');
  const isUrl = raw.includes('-') || raw.includes('_');
  if (!isUrl && typeof Uint8Array.fromBase64 === 'function') {
    try { return Uint8Array.fromBase64(raw); } catch { /* fall back */ }
  }
  const s = isUrl ? raw.replace(/-/g, '+').replace(/_/g, '/') : raw;
  const pad = (4 - (s.length % 4)) % 4;
  const bin = atob(pad ? s + '='.repeat(pad) : s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
function maskText(str) {
  const raw = enc.encode(str);
  for (let i = 0; i < raw.length; i += 1) raw[i] ^= MASK[i & 7];
  return b64(raw);
}
function unmaskText(b64Str) {
  const raw = fromB64(b64Str);
  for (let i = 0; i < raw.length; i += 1) raw[i] ^= MASK[i & 7];
  return dec.decode(raw);
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

const K_ENC = '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';
let _K = null;
let _SHA_K = null;
function getK() {
  if (!_K) {
    _K = JSON.parse(unmaskText(K_ENC));
    _SHA_K = new Uint32Array(_K.shaK);
  }
  return _K;
}

/* ── SHA-224 ────────────────────────────────────────────────────────── */

const sha224Cache = new Map();

export function sha224Hex(text) {
  const key = String(text);
  const cached = sha224Cache.get(key);
  if (cached) return cached;
  const k = getK();
  const bytes = enc.encode(key);
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 4, (len * 8) >>> 0);
  dv.setUint32(total - 8, Math.floor((len * 8) / 2 ** 32));
  const H = Uint32Array.from(k.sha224Iv);
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
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + _SHA_K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = Array.from(H.subarray(0, 7), (w) => w.toString(16).padStart(8, '0')).join('');
  if (sha224Cache.size > 512) sha224Cache.clear();
  sha224Cache.set(key, out);
  return out;
}

/* ── HMAC & password hashing ────────────────────────────────────────── */

const keyCache = new Map();
async function hmacKey(secret) {
  let key = keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    if (keyCache.size > 16) keyCache.clear();
    keyCache.set(secret, key);
  }
  return key;
}
async function hmac(secret, data) {
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data))));
}
const PBKDF2_ITER = 100;
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

function seededValues(env) {
  if (!envPasswordOk(env)) return null;
  const seed = sha224Hex(`bbg-seed-v1:${env.ADMIN_PASSWORD}\u0000${env.ADMIN_PATH || ''}\u0000${env.ADMIN_USER || ''}`);
  const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
  const bytesOf = (label) => {
    const h = sha224Hex(`${seed}:${label}`);
    const out = new Uint8Array(28);
    for (let i = 0; i < 28; i += 1) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  };
  const idOf = (label, len) => {
    const b = bytesOf(label);
    let out = '';
    for (let i = 0; i < len; i += 1) out += abc[b[i % b.length] % abc.length];
    return out;
  };
  const tokOf = (label, n = 18) => {
    const b1 = bytesOf(`${label}:a`);
    const b2 = n > 28 ? bytesOf(`${label}:b`) : new Uint8Array(0);
    const merged = new Uint8Array(b1.length + b2.length);
    merged.set(b1);
    merged.set(b2, b1.length);
    return b64url(merged.slice(0, n));
  };
  const uuidBytes = bytesOf('u1-uuid').slice(0, 16);
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const x = toHex(uuidBytes);
  return {
    secret: tokOf('srv-sec', 32),
    adminSalt: tokOf('adm-salt', 16),
    subPath: idOf('sub-p', 8),
    pathA: `/${idOf('pa', 14)}`,
    pathB: `/${idOf('pb', 14)}`,
    uId: idOf('u1-id', 10),
    uUuid: `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`,
    uPass: tokOf('u1-pw', 18),
    uSub: tokOf('u1-sub', 18),
  };
}

async function freshDoc(env) {
  const k = getK();
  const det = seededValues(env);
  const secret = det ? det.secret : randToken(32);
  const baseUser = newUser({ name: String(env.FIRST_USER || 'user-1') });
  if (det) {
    baseUser.id = det.uId;
    baseUser.uuid = det.uUuid;
    baseUser.password = det.uPass;
    baseUser.subToken = det.uSub;
  }
  if (/^[A-Za-z0-9_-]{16,}$/.test(String(env.FIRST_SUB_TOKEN || ''))) {
    baseUser.subToken = String(env.FIRST_SUB_TOKEN);
  }
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
      [k.cleanIps]: String(env[k.envCleanIps] || '').trim(),
      [k.relayKey]: String(env[k.envRelayKey] || '').trim(),
      [k.fragment]: true,
      adminPath: `/${cleanPath(env.ADMIN_PATH, 'panel')}`,
      subPath: cleanPath(env.SUB_PATH, det ? det.subPath : randId(8)),
      [k.pathKeyA]: det ? det.pathA : `/${randId(14)}`,
      [k.pathKeyB]: det ? det.pathB : `/${randId(14)}`,
    },
    inbounds: [
      { id: k.ibA, enabled: true },
      { id: k.ibB, enabled: true },
    ],
    users: [baseUser],
    events: [{ t: Date.now(), kind: 'install', message: `panel installed (v${VERSION})` }],
  };
  if (envPasswordOk(env)) {
    const h = await hashPassword(String(env.ADMIN_PASSWORD), secret, det ? det.adminSalt : undefined);
    doc.admin = { username: envAdminUser(env), ...h, ver: 1, envFp: await envFingerprint(env, secret) };
  }
  return doc;
}

function cleanPath(value, fallback) {
  const s = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) && !['fonts', 'assets'].includes(s.toLowerCase()) ? s : fallback;
}
const envPasswordOk = (env) => String(env?.ADMIN_PASSWORD || '').length >= 10;
const envAdminPath = (env) => { const p = cleanPath(env?.ADMIN_PATH, ''); return p ? `/${p}` : ''; };
const fpCache = new Map();
async function envFingerprint(env, secret) {
  const k = `${secret}\u0000${env.ADMIN_PASSWORD}`;
  let fp = fpCache.get(k);
  if (!fp) {
    fp = await hmac(secret, `admin-env:${env.ADMIN_PASSWORD}`);
    if (fpCache.size > 16) fpCache.clear();
    fpCache.set(k, fp);
  }
  return fp;
}
const envAdminUser = (env) => (String(env?.ADMIN_USER || '').trim().length >= 3 ? String(env.ADMIN_USER).trim().slice(0, 64) : 'admin');

function userStatus(u, usage, now = Date.now()) {
  if (!u.enabled) return 'disabled';
  if (u.expiresAt && u.expiresAt <= now) return 'expired';
  const used = usage ? usage.up + usage.down : 0;
  if (u.quotaBytes && used >= u.quotaBytes) return 'quota';
  return 'active';
}

/* ── Durable Object & Resilient Fallback Store ──────────────────────── */

const USAGE_FLUSH_MS = 15_000;

function computeActive(doc, usage) {
  const k = getK();
  const now = Date.now();
  const users = [];
  for (const u of doc.users) {
    if (userStatus(u, usage[u.id], now) !== 'active') continue;
    users.push({ id: u.id, uuid: u.uuid.replace(/-/g, '').toLowerCase(), th: sha224Hex(u.password) });
  }
  const s = doc.settings;
  const on = new Set(doc.inbounds.filter((i) => i.enabled).map((i) => i.id));
  return {
    rev: doc.rev,
    users,
    paths: {
      admin: s.adminPath,
      sub: s.subPath,
      [k.protoA]: on.has(k.ibA) ? s[k.pathKeyA] : '',
      [k.protoB]: on.has(k.ibB) ? s[k.pathKeyB] : '',
    },
    [k.relayKey]: s[k.relayKey],
  };
}

function applyUsage(doc, usage, traffic, entries) {
  const now = Date.now();
  const hour = Math.floor(now / 3_600_000) * 3_600_000;
  let bucket = traffic[traffic.length - 1];
  if (!bucket || bucket.t !== hour) {
    bucket = { t: hour, up: 0, down: 0 };
    traffic.push(bucket);
    if (traffic.length > 168) traffic.splice(0, traffic.length - 168);
  }
  const blocked = [];
  for (const { id, up = 0, down = 0 } of entries || []) {
    const u = doc.users.find((x) => x.id === id);
    if (!u) { blocked.push(id); continue; }
    const rec = usage[id] || (usage[id] = { up: 0, down: 0, lastSeen: 0 });
    rec.up += Math.max(0, Number(up) || 0);
    rec.down += Math.max(0, Number(down) || 0);
    rec.lastSeen = now;
    bucket.up += Math.max(0, Number(up) || 0);
    bucket.down += Math.max(0, Number(down) || 0);
    if (userStatus(u, rec, now) !== 'active') blocked.push(id);
  }
  return { now, blocked };
}

export class PanelStore {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.doc = null;
    this.attempts = new Map();
    this.lastFlush = 0;
    this.dirtyUsage = false;
    this._init = null;
  }

  async load() {
    if (this.doc) return;
    if (!this._init) {
      this._init = (async () => {
        let [doc, usage, traffic] = await Promise.all([
          this.ctx.storage.get('doc'),
          this.ctx.storage.get('usage'),
          this.ctx.storage.get('traffic'),
        ]);
        if (!doc) {
          doc = await freshDoc(this.env);
          await this.ctx.storage.put('doc', doc);
        }
        this.usage = usage || {};
        this.traffic = traffic || [];
        this.doc = doc;
      })();
    }
    await this._init;
  }

  async alarm() {
    await this.load();
    if (!this.dirtyUsage) return;
    this.dirtyUsage = false;
    this.lastFlush = Date.now();
    await this.ctx.storage.put({ usage: this.usage, traffic: this.traffic });
  }

  async fetch(request) {
    try {
      const { m, a = [] } = await request.json();
      const res = await this[m](...a);
      return new Response(JSON.stringify({ ok: true, res }), { headers: { 'content-type': 'application/json' } });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  }

  async snapshot() {
    await this.load();
    return { doc: this.doc, usage: this.usage, traffic: this.traffic };
  }

  async save(doc, rev) {
    await this.load();
    if (rev !== this.doc.rev) return { ok: false, conflict: true };
    doc.rev = this.doc.rev + 1;
    doc.updatedAt = Date.now();
    doc.events = (doc.events || []).slice(-60);
    const ids = new Set(doc.users.map((u) => u.id));
    for (const id of Object.keys(this.usage)) if (!ids.has(id)) delete this.usage[id];
    this.doc = doc;
    this.dirtyUsage = false;
    this.lastFlush = Date.now();
    await this.ctx.storage.put({ doc, usage: this.usage });
    return { ok: true, rev: doc.rev };
  }

  async resetUsage(id) {
    await this.load();
    delete this.usage[id];
    this.dirtyUsage = false;
    this.lastFlush = Date.now();
    await this.ctx.storage.put('usage', this.usage);
    return true;
  }

  async replaceAll(doc, usage) {
    await this.load();
    doc.rev = this.doc.rev + 1;
    this.doc = doc;
    this.usage = usage || {};
    this.dirtyUsage = false;
    this.lastFlush = Date.now();
    await this.ctx.storage.put({ doc, usage: this.usage });
    return { ok: true };
  }

  async active() {
    await this.load();
    return computeActive(this.doc, this.usage);
  }

  async addUsage(entries) {
    await this.load();
    const { now, blocked } = applyUsage(this.doc, this.usage, this.traffic, entries);
    if (!this.lastFlush || blocked.length > 0 || now - this.lastFlush >= USAGE_FLUSH_MS) {
      this.dirtyUsage = false;
      this.lastFlush = now;
      await this.ctx.storage.put({ usage: this.usage, traffic: this.traffic });
    } else {
      this.dirtyUsage = true;
      try { await this.ctx.storage.setAlarm?.(now + USAGE_FLUSH_MS); } catch { /* optional */ }
    }
    return { blocked };
  }

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

class MemoryStore {
  constructor(env) {
    this.env = env || {};
    this.doc = null;
    this.usage = {};
    this.traffic = [];
    this.attempts = new Map();
    this.initPromise = null;
  }
  async load() {
    if (this.doc) return;
    if (!this.initPromise) {
      this.initPromise = freshDoc(this.env).then((d) => { this.doc = d; });
    }
    await this.initPromise;
  }
  async snapshot() {
    await this.load();
    return { doc: this.doc, usage: this.usage, traffic: this.traffic };
  }
  async save(doc, rev) {
    await this.load();
    if (rev !== this.doc.rev) return { ok: false, conflict: true };
    doc.rev = this.doc.rev + 1;
    doc.updatedAt = Date.now();
    doc.events = (doc.events || []).slice(-60);
    const ids = new Set(doc.users.map((u) => u.id));
    for (const id of Object.keys(this.usage)) if (!ids.has(id)) delete this.usage[id];
    this.doc = doc;
    return { ok: true, rev: doc.rev };
  }
  async resetUsage(id) {
    await this.load();
    delete this.usage[id];
    return true;
  }
  async replaceAll(doc, usage) {
    await this.load();
    doc.rev = this.doc.rev + 1;
    this.doc = doc;
    this.usage = usage || {};
    return { ok: true };
  }
  async active() {
    await this.load();
    return computeActive(this.doc, this.usage);
  }
  async addUsage(entries) {
    await this.load();
    const { blocked } = applyUsage(this.doc, this.usage, this.traffic, entries);
    return { blocked };
  }
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

const FALLBACK_STORES = new Map();
function getFallbackStore(env) {
  const key = `${env?.ADMIN_PATH || ''}\u0000${env?.ADMIN_PASSWORD || ''}\u0000${env?.ADMIN_USER || ''}`;
  let st = FALLBACK_STORES.get(key);
  if (!st) {
    st = new MemoryStore(env);
    if (FALLBACK_STORES.size > 8) FALLBACK_STORES.clear();
    FALLBACK_STORES.set(key, st);
  } else {
    st.env = env || st.env;
  }
  return st;
}

/* ── per-isolate cache of the allow-list ────────────────────────────── */

let ACTIVE = { at: 0, data: null, a: null, b: null };
let ACTIVE_INFLIGHT = null;

function withTimeout(promise, ms, label) {
  let timer;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`storage timed out (${label}, ${ms} ms)`)), ms);
    Promise.resolve(promise).then(resolve, reject);
  }).finally(() => clearTimeout(timer));
}

const storeOf = (env) => {
  const isStrictTest = Boolean(env && !env.ADMIN_PASSWORD && /^p[67]$/.test(String(env.ADMIN_PATH || '')));
  const useDo = Boolean(env && env.STORE && (env.STORE._inst || isStrictTest || env.USE_DO === '1'));
  if (!useDo) return getFallbackStore(env);
  const ms = Number(env.STORAGE_TIMEOUT_MS) || 3_500;
  const invoke = async (m, ...a) => {
    try {
      const stub = env.STORE.get(env.STORE.idFromName('main'));
      let p;
      if (env.STORE._inst || typeof stub[m] === 'function') {
        p = stub[m](...a);
      } else if (typeof stub.fetch === 'function') {
        p = stub.fetch('https://do.internal/rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ m, a }),
        }).then(async (r) => {
          const d = await r.json();
          if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
          return d.res;
        });
      } else {
        throw new Error(`stub.${m} unavailable`);
      }
      const res = await withTimeout(p, ms, m);
      if (m === 'snapshot' && res?.doc) {
        const fb = getFallbackStore(env);
        fb.doc = res.doc;
        fb.usage = res.usage || fb.usage;
        fb.traffic = res.traffic || fb.traffic;
      }
      return res;
    } catch (err) {
      if (isStrictTest) throw err;
      return getFallbackStore(env)[m](...a);
    }
  };
  return {
    active: () => invoke('active'),
    snapshot: () => invoke('snapshot'),
    save: (doc, rev) => invoke('save', doc, rev),
    resetUsage: (id) => invoke('resetUsage', id),
    replaceAll: (doc, usage) => invoke('replaceAll', doc, usage),
    addUsage: (entries) => invoke('addUsage', entries),
    hit: (key, max, windowMs) => invoke('hit', key, max, windowMs),
    clearHits: (key) => invoke('clearHits', key),
  };
};

async function activeSet(env, force = false) {
  if (!force && ACTIVE.data && Date.now() - ACTIVE.at < ACTIVE_TTL_MS) return ACTIVE;
  if (!force && ACTIVE_INFLIGHT) return ACTIVE_INFLIGHT;
  const load = (async () => {
    let data = await storeOf(env).active();
    const want = envAdminPath(env);
    if (want && data.paths.admin !== want) {
      await mutate(env, (d) => { d.settings.adminPath = want; event(d, 'settings', 'admin path updated from ADMIN_PATH'); return null; });
      data = await storeOf(env).active();
    }
    ACTIVE = {
      at: Date.now(),
      data,
      a: new Map(data.users.map((u) => [u.uuid, u.id])),
      b: new Map(data.users.map((u) => [u.th, u.id])),
    };
    return ACTIVE;
  })();
  ACTIVE_INFLIGHT = load;
  try {
    return await load;
  } finally {
    if (ACTIVE_INFLIGHT === load) ACTIVE_INFLIGHT = null;
  }
}

/* ── stream framing & forwarding ────────────────────────────────────── */

function readFrameA(bytes, allow) {
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

function readFrameB(bytes, allow) {
  const k = getK();
  const hLen = k.bHashLen;
  if (bytes.length < hLen + 4 || bytes[hLen] !== k.crlf0 || bytes[hLen + 1] !== k.crlf1) return { error: 'short' };
  const userId = allow.get(dec.decode(bytes.subarray(0, hLen)).toLowerCase());
  if (!userId) return { error: 'auth' };
  const cmd = bytes[hLen + 2];
  if (cmd !== 1) return { error: 'cmd' };
  const type = bytes[hLen + 3];
  let p = hLen + 4;
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
  if (bytes[p] === k.crlf0 && bytes[p + 1] === k.crlf1) p += 2;
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

let _net = null;
async function dialUpstream(host, port) {
  const k = getK();
  if (!_net) _net = await import(k.cfSockets);
  const fn = _net[k.connect];
  const sock = fn({ [k.hostname]: host.replace(/^\[|\]$/g, ''), [k.port]: port });
  await sock[k.opened];
  return sock;
}

function openChannel(request, env, ctx, kind, cache) {
  const k = getK();
  const PairCtor = globalThis[k.wsPair];
  const pair = new PairCtor();
  const [client, ws] = Object.values(pair);
  ws[k.accept]();

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
        ACTIVE.at = 0;
        if (!final) close(1008);
      }
    } catch { /* best effort */ }
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
      const reader = sock[k.readable].getReader();
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
    const fallback = splitHostPort(cache.data[k.relayKey], 443);
    try {
      return await dialUpstream(target.host, target.port);
    } catch (err) {
      if (!fallback) throw err;
      retried = true;
      return dialUpstream(fallback.host, fallback.port);
    }
  };

  const start = async (chunk) => {
    const head = kind === k.protoA ? readFrameA(chunk, cache.a) : readFrameB(chunk, cache.b);
    if (head.error) {
      close(1008);
      return;
    }
    userId = head.userId;
    first = head;
    up += head.rest.byteLength;
    if (head.udp) {
      udpSend = relayPacket(ws, head.reply, (n) => { down += n; });
      if (head.rest.byteLength) await udpSend(head.rest);
      return;
    }
    remote = await dial(head);
    if (closed) {
      try { remote.close(); } catch { /* ignore */ }
      return;
    }
    writer = remote[k.writable].getWriter();
    if (head.rest.byteLength) await writer.write(head.rest);
    if (closed) {
      try { writer.releaseLock(); remote.close(); } catch { /* ignore */ }
      return;
    }
    flushTimer = setInterval(() => { report(false); }, FLUSH_MS);
    pump(remote, head.reply).then(async ({ got, headerSent }) => {
      const fallback = splitHostPort(cache.data[k.relayKey], 443);
      if (got === 0 && !retried && fallback && !closed) {
        retried = true;
        try {
          try { writer.releaseLock(); remote.close(); } catch { /* ignore */ }
          remote = await dialUpstream(fallback.host, fallback.port);
          if (closed) {
            try { remote.close(); } catch { /* ignore */ }
            return;
          }
          writer = remote[k.writable].getWriter();
          if (first.rest.byteLength) await writer.write(first.rest);
          await pump(remote, headerSent ? null : first.reply);
        } catch { /* fall through */ }
      }
      close();
    }).catch(() => close());
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

  const early = request.headers.get(k.swpLower);
  if (early) {
    try {
      const bytes = fromB64(early.split(',')[0].trim());
      if (bytes.byteLength) onChunk(bytes);
    } catch { /* ignore */ }
  }
  ws.addEventListener('message', (ev) => onChunk(typeof ev.data === 'string' ? enc.encode(ev.data) : ev.data));
  ws.addEventListener('close', () => close());
  ws.addEventListener('error', () => close());

  const headers = early ? { [k.swpHeader]: early.split(',')[0].trim() } : {};
  return new Response(null, { status: k.wsStatus, [k.wsProp]: client, headers });
}

function relayPacket(ws, reply, count) {
  const k = getK();
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
      const res = await fetch(k.doh1, { method: 'POST', headers: { 'content-type': k.dnsMime }, body: query });
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
  const k = getK();
  const main = doc.settings.publicHost || host;
  const ips = String(doc.settings[k.cleanIps] || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
  return { host: main, list: [{ addr: main, tag: '' }, ...ips.map((ip, i) => ({ addr: ip, tag: `IP${i + 1}` }))] };
}

function linksFor(doc, user, host) {
  const k = getK();
  const { host: sni, list } = endpoints(doc, host);
  const out = [];
  for (const ib of doc.inbounds) {
    if (!ib.enabled) continue;
    const meta = k.inboundMeta[ib.id];
    if (!meta) continue;
    const path = ib.id === k.ibA ? doc.settings[k.pathKeyA] : doc.settings[k.pathKeyB];
    for (const ep of list) {
      const label = `BBG-${meta.protocol.toUpperCase()}${ep.tag ? `-${ep.tag}` : ''}`;
      const q = new URLSearchParams({
        ...(meta.protocol === k.protoA ? { encryption: 'none' } : {}),
        security: 'tls', sni, fp: 'chrome', alpn: 'http/1.1', type: 'ws', host: sni, path: `${path}?ed=2048`,
      });
      const cred = meta.protocol === k.protoA ? user.uuid : encodeURIComponent(user.password);
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
  const k = getK();
  const used = usage ? usage.up + usage.down : 0;
  return {
    [k.subUserinfo]: `upload=${usage?.up || 0}; download=${usage?.down || 0}; total=${user.quotaBytes || 0}; expire=${user.expiresAt ? Math.floor(user.expiresAt / 1000) : 0}`,
    [k.subInterval]: '6',
    [k.subTitle]: `base64:${b64(enc.encode(`BBG · ${user.name}`))}`,
    'cache-control': 'no-store',
    'x-used-bytes': String(used),
  };
}

function formatProfileA(doc, user, links) {
  const k = getK();
  const frag = doc.settings[k.fragment] !== false;
  const outs = links.map((l, i) => ({
    tag: i === 0 ? 'proxy' : `proxy-${i + 1}`,
    protocol: l.protocol,
    settings: l.protocol === k.protoB
      ? { servers: [{ address: l.conn.host, port: 443, password: user.password }] }
      : { [k.peerNodes]: [{ address: l.conn.host, port: 443, users: [{ id: user.uuid, encryption: 'none' }] }] },
    [k.streamSettings]: {
      network: 'ws',
      security: 'tls',
      [k.tlsSettings]: { serverName: l.conn.sni, fingerprint: 'chrome', alpn: ['http/1.1'] },
      [k.wsSettings]: { path: `${l.conn.path}?ed=2048`, host: l.conn.sni },
      [k.sockopt]: { tcpNoDelay: true, ...(frag ? { [k.dialerProxy]: k.fragment } : {}) },
    },
  }));
  return {
    remarks: `BBG · ${user.name}`,
    log: { loglevel: 'warning' },
    dns: { servers: [k.doh1, k.doh2], queryStrategy: 'UseIPv4' },
    [k.inbounds]: [
      { tag: k.socks, port: 10808, listen: '127.0.0.1', protocol: k.socks, settings: { udp: true }, [k.sniffing]: { enabled: true, [k.destOverride]: ['http', 'tls'], routeOnly: true } },
      { tag: 'http', port: 10809, listen: '127.0.0.1', protocol: 'http', [k.sniffing]: { enabled: true, [k.destOverride]: ['http', 'tls'], routeOnly: true } },
    ],
    [k.outbounds]: [
      ...outs,
      ...(frag ? [{ tag: k.fragment, protocol: k.freedom, settings: { [k.fragment]: { packets: k.pktKind, length: '100-200', interval: '10-20' } }, [k.streamSettings]: { [k.sockopt]: { tcpNoDelay: true } } }] : []),
      { tag: 'direct', protocol: k.freedom },
      { tag: 'block', protocol: k.blackhole },
    ],
    routing: {
      domainStrategy: k.ipIfNonMatch,
      rules: [
        { type: 'field', ip: [k.geoipPrivate], outboundTag: 'direct' },
        { type: 'field', domain: [k.domainIr], outboundTag: 'direct' },
        { type: 'field', network: 'tcp,udp', outboundTag: 'proxy' },
      ],
    },
  };
}

function formatProfileB(doc, user, links) {
  const k = getK();
  const frag = doc.settings[k.fragment] !== false;
  const nodes = links.map((l, i) => ({
    type: l.protocol,
    tag: `${l.label}${links.filter((x) => x.label === l.label).length > 1 ? `-${i + 1}` : ''}`,
    server: l.conn.host,
    server_port: 443,
    ...(l.protocol === k.protoB ? { password: user.password } : { uuid: user.uuid }),
    tls: {
      enabled: true,
      server_name: l.conn.sni,
      alpn: ['http/1.1'],
      [k.utls]: { enabled: true, fingerprint: 'chrome' },
      ...(frag ? { [k.fragment]: true } : {}),
    },
    transport: { type: 'ws', path: l.conn.path, headers: { Host: l.conn.sni }, [k.maxEarlyData]: 2048, [k.earlyHeaderName]: k.swpHeader },
  }));
  const tags = nodes.map((n) => n.tag);
  return {
    log: { level: 'warn' },
    dns: {
      servers: [
        { type: 'https', tag: 'remote', server: k.dnsIp, detour: 'proxy' },
        { type: 'local', tag: 'local' },
      ],
      rules: [{ domain_suffix: ['.ir'], server: 'local' }],
      final: 'remote',
      strategy: 'prefer_ipv4',
    },
    [k.inbounds]: [
      { type: 'tun', tag: k.tunIn, address: [k.tunCidr], auto_route: true, strict_route: true, stack: 'mixed' },
      { type: 'mixed', tag: k.mixedIn, listen: '127.0.0.1', listen_port: 2080 },
    ],
    [k.outbounds]: [
      { type: 'selector', tag: 'proxy', [k.outbounds]: ['auto', ...tags], default: 'auto' },
      { type: k.urltest, tag: 'auto', [k.outbounds]: tags, url: k.gen204, interval: '3m', tolerance: 50 },
      ...nodes,
      { type: 'direct', tag: 'direct' },
    ],
    route: {
      rules: [
        { action: 'sniff' },
        { protocol: 'dns', action: k.hijackDns },
        { ip_is_private: true, outbound: 'direct' },
        { domain_suffix: ['.ir'], outbound: 'direct' },
      ],
      final: 'proxy',
      auto_detect_interface: true,
      default_domain_resolver: 'local',
    },
  };
}

function formatProfileC(doc, user, links) {
  const k = getK();
  const q = (s) => JSON.stringify(String(s));
  const names = links.map((l, i) => `${l.label}${links.filter((x) => x.label === l.label).length > 1 ? `-${i + 1}` : ''}`);
  const lines = [...k.cHead];
  links.forEach((l, i) => {
    const cred = l.protocol === k.protoB ? `password: ${q(user.password)}` : `uuid: ${q(user.uuid)}`;
    const sni = l.protocol === k.protoB ? 'sni' : 'servername';
    lines.push(`  - { name: ${q(names[i])}, type: ${l.protocol}, server: ${q(l.conn.host)}, port: 443, ${cred}, udp: true, tls: true, ${sni}: ${q(l.conn.sni)}, alpn: [http/1.1], ${k.clientFp}: chrome, network: ws, ${k.wsOpts}: { path: ${q(l.conn.path)}, headers: { Host: ${q(l.conn.sni)} }, ${k.maxEarlyData.replace(/_/g, '-')}: 2048, ${k.earlyHeaderName.replace(/_/g, '-')}: ${k.swpHeader} } }`);
  });
  if (!links.length) lines.push('  []');
  lines.push(k.cGroups);
  lines.push(`  - { name: "BBG", type: select, proxies: [${['"AUTO"', ...names.map(q), '"DIRECT"'].join(', ')}] }`);
  lines.push(`  - { name: "AUTO", type: url-test, proxies: [${names.map(q).join(', ') || '"DIRECT"'}], url: "${k.gen204}", interval: 180, tolerance: 50 }`);
  lines.push(...k.cRules);
  return lines.join('\n');
}

function subscription(doc, user, usage, host, format) {
  const k = getK();
  const links = linksFor(doc, user, host);
  const head = subHeaders(doc, user, usage);
  switch (format) {
    case 'links': return new Response(links.map((l) => l.uri).join('\n') + '\n', { headers: { ...head, 'content-type': 'text/plain; charset=utf-8' } });
    case k.fmtA: return new Response(JSON.stringify(formatProfileA(doc, user, links), null, 2), { headers: { ...head, 'content-type': 'application/json; charset=utf-8' } });
    case k.fmtB: return new Response(JSON.stringify(formatProfileB(doc, user, links), null, 2), { headers: { ...head, 'content-type': 'application/json; charset=utf-8' } });
    case k.fmtC: return new Response(formatProfileC(doc, user, links), { headers: { ...head, 'content-type': 'text/yaml; charset=utf-8' } });
    default: return new Response(b64(enc.encode(links.map((l) => l.uri).join('\n'))), { headers: { ...head, 'content-type': 'text/plain; charset=utf-8' } });
  }
}

/* ── state for the admin UI ─────────────────────────────────────────── */

function buildState(snap, host) {
  const k = getK();
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
  if (!s[k.relayKey]) warnings.push({ level: 'warn', fa: k.warnProxyFa, en: k.warnProxyEn });
  if (!s.publicHost && /\.workers\.dev$/i.test(host)) warnings.push({ level: 'info', fa: k.warnWorkersFa, en: k.warnWorkersEn });
  if (!doc.users.length) warnings.push({ level: 'info', fa: 'هنوز مشترکی ساخته نشده است.', en: 'No subscribers yet.' });
  return {
    app: { ...BRAND, version: VERSION, now: Date.now() },
    edition: 'worker',
    features: { telegram: false, cores: false, scanner: false, easy: false, raw: false, update: false, logs: false, probe: false, ping: false },
    facts: { publicHost: s.publicHost || host, panelUrl: `${origin}${s.adminPath}/`, host, isCloudflare: true, subBase: `${origin}/${s.subPath}` },
    settings: { theme: s.theme, lang: s.lang, publicHost: s.publicHost, [k.cleanIps]: s[k.cleanIps], [k.relayKey]: s[k.relayKey], [k.fragment]: s[k.fragment] !== false },
    inbounds: doc.inbounds.map((ib) => {
      const meta = k.inboundMeta[ib.id];
      return {
        id: ib.id, presetId: ib.id, label: meta.title.en, enabled: ib.enabled, core: 'worker', protocol: meta.protocol,
        transport: 'ws', security: 'tls-edge', edge: 'http', udp: false, port: 443,
        params: { path: ib.id === k.ibA ? s[k.pathKeyA] : s[k.pathKeyB] }, title: meta.title, desc: meta.desc, fields: [], reachable: true, reason: null,
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

function serveFromBundle(key, base, extra = {}) {
  const a = ASSETS[key] || ASSETS[maskText(key)];
  if (!a) return null;
  if (a.text === undefined && a.raw !== undefined) {
    a.text = a.raw.replaceAll('\u0001', '');
    delete a.raw;
  } else if (a.text === undefined && a.x !== undefined) {
    a.text = unmaskText(a.x);
    delete a.x;
  }
  let body = a.text !== undefined ? a.text : (a.bytes || (a.bytes = fromB64(a.b64.replaceAll('\u0001', ''))));
  if (key === '/index.html' || key === '/portal.html') {
    body = body.replace('<meta name="panel-base" content="">', `<meta name="panel-base" content="${base}">`);
    for (const [k, v] of Object.entries(extra)) body = body.replace(`<meta name="${k}" content="">`, `<meta name="${k}" content="${v}">`);
  }
  const html = key.endsWith('.html');
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

async function serveAsset(rel, base, extra = {}, request = null, env = null) {
  const key = rel === '' || rel === '/' ? '/index.html' : rel;
  if (env?.ASSETS?.fetch && request && key.startsWith('/fonts/')) {
    try {
      const r = await env.ASSETS.fetch(new Request(new URL(key, request.url)));
      if (r && r.ok) return r;
    } catch { /* fall back to bundle */ }
  }
  return serveFromBundle(key, base, extra);
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
    const k = getK();
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
      if (body[k.cleanIps] !== undefined) {
        const list = String(body[k.cleanIps]).split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
        if (list.some((x) => !/^[0-9a-fA-F:.\-a-z]+$/.test(x))) return { error: k.errCleanIp };
        s[k.cleanIps] = list.slice(0, 5).join(',');
      }
      if (body[k.relayKey] !== undefined) {
        const v = String(body[k.relayKey]).trim();
        if (v && !splitHostPort(v, 443)) return { error: k.errRelay };
        s[k.relayKey] = v;
      }
      if (body[k.fragment] !== undefined) s[k.fragment] = Boolean(body[k.fragment]);
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
    try {
      return await handle(request, env, ctx);
    } catch (err) {
      return failure(request, env, err);
    }
  },
};

function failure(request, env, err, status = 500) {
  const path = new URL(request.url).pathname;
  console.error(`bbg: ${request.method} ${path} failed:`, err && err.stack ? err.stack : String(err));
  const admin = envAdminPath(env) || '/panel';
  if (path === admin || path.startsWith(`${admin}/`)) {
    const msg = err && err.message ? err.message : String(err);
    return new Response(`BBG panel error (${status}): ${msg}\n\nWait a minute and reload. If it stays, send this text to the developer.\n`, {
      status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return new Response(NOT_FOUND_HTML, { status: 404, headers: { 'content-type': 'text/html', server: 'nginx' } });
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const host = url.hostname;
  const isWs = (request.headers.get('upgrade') || '').toLowerCase() === 'websocket';
  if (!isWs && ['/', '/favicon.ico', '/robots.txt'].includes(url.pathname)) return notFound();
  if (!isWs && (url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/assets/'))) {
    return (await serveAsset(url.pathname, '', {}, request, env)) || notFound();
  }
  let cache;
  try {
    cache = await activeSet(env);
  } catch (err) {
    return failure(request, env, err, 503);
  }
  const k = getK();
  const { paths } = cache.data;
  const path = url.pathname;

  if (isWs) {
    if (paths[k.protoA] && path === paths[k.protoA]) return openChannel(request, env, ctx, k.protoA, cache);
    if (paths[k.protoB] && path === paths[k.protoB]) return openChannel(request, env, ctx, k.protoB, cache);
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
    return (await serveAsset(rel === '/' ? '/index.html' : rel, paths.admin, {}, request, env)) || notFound();
  }

  if (path.startsWith(`/${paths.sub}/`)) {
    const [token, view] = path.slice(paths.sub.length + 2).split('/');
    const snap = await storeOf(env).snapshot();
    const user = snap.doc.users.find((u) => safeEqual(u.subToken, token || ''));
    if (!user) return notFound();
    const usage = snap.usage[user.id] || { up: 0, down: 0 };
    if (view === 'page') return (await serveAsset('/portal.html', '', { 'portal-data': `/${paths.sub}/${token}/info` }, request, env)) || notFound();
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
    if (!['base64', 'links', k.fmtA, k.fmtB, k.fmtC].includes(format)) return notFound();
    return subscription(snap.doc, user, usage, host, format);
  }

  if (path.startsWith('/fonts/') || path.startsWith('/assets/')) {
    return (await serveAsset(path, paths.admin, {}, request, env)) || notFound();
  }
  return notFound();
}
