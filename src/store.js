/**
 * BBG · By SANDBAAD — persistent atomic store
 *
 * A single JSON document (no external database) written atomically to the
 * mounted volume, keeping all panel state, subscribers, inbounds, and traffic
 * telemetry in a compact, resilient snapshot.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_FILE, DATA_DIR, ensureDirs } from './env.js';
import { DEFAULT_INBOUNDS, presetById, LEGACY_SHORT_IDS, randomShortIds } from './catalog.js';
import { legacySubToken, randomSubToken } from './auth.js';

const SCHEMA = 4;
const listeners = new Set();
let doc = null;
let saveTimer = null;
let saving = false;

export function hex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function uid(len = 10) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789';
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += alphabet[buf[i] % alphabet.length];
  return out;
}

export function b64url(buf) {
  return Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function defaults() {
  return {
    schema: SCHEMA,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    secrets: { server: hex(32) },
    admin: null,
    settings: {
      publicHost: '',
      tcpHost: '',
      tcpPort: 0,
      theme: 'dark',
      lang: 'fa',
      brand: 'BBG',
      tag: 'CORE',
      subPath: 'sub',
      publicStatus: true,
      autoRestartCores: true,
      lowMemory: true,
      // Client-side TLS-hello & record fragmentation for DPI evasion.
      fragment: true,
      telegram: {
        mtproto: {
          enabled: false,
          engine: 'mtg',
          faketlsHost: 'www.samsung.com',
          secret: '',
          listenPort: 0,
          adTag: '',
          preferIpv6: false,
        },
        socks: { enabled: false, user: `u${hex(3)}`, pass: hex(8) },
        http: { enabled: false, user: `u${hex(3)}`, pass: hex(8) },
        web: { enabled: false },
      },
      cores: {
        xray: { enabled: true },
        singbox: { enabled: true, lazy: true },
      },
    },
    users: [],
    inbounds: DEFAULT_INBOUNDS(),
    traffic: { samples: [] },
    events: [],
  };
}

function migrate(raw) {
  if (!raw || typeof raw !== 'object') return defaults();
  const base = defaults();
  const out = { ...base, ...raw };
  out.schema = SCHEMA;
  out.secrets = { ...base.secrets, ...(raw.secrets || {}) };
  out.settings = {
    ...base.settings,
    ...(raw.settings || {}),
    telegram: {
      ...base.settings.telegram,
      ...((raw.settings && raw.settings.telegram) || {}),
      mtproto: { ...base.settings.telegram.mtproto, ...(((raw.settings || {}).telegram || {}).mtproto || {}) },
      socks: { ...base.settings.telegram.socks, ...(((raw.settings || {}).telegram || {}).socks || {}) },
      http: { ...base.settings.telegram.http, ...(((raw.settings || {}).telegram || {}).http || {}) },
      web: { ...base.settings.telegram.web, ...(((raw.settings || {}).telegram || {}).web || {}) },
    },
    cores: { ...base.settings.cores, ...((raw.settings || {}).cores || {}) },
  };
  if (!out.settings.brand) out.settings.brand = 'BBG';
  if (!out.settings.tag) out.settings.tag = 'CORE';
  if (out.admin && !out.admin.ver) out.admin.ver = 1;
  // v2.0 links were HMAC(server secret, user id); keep them working by storing that value once.
  out.users = Array.isArray(raw.users)
    ? raw.users.map((u) => normalizeUser({ ...u, subToken: u.subToken || legacySubToken(out.secrets.server, u.id) }))
    : [];
  for (const t of ['socks', 'http']) {
    const p = out.settings.telegram[t];
    if (!p.pass || p.pass.length < 8) p.pass = hex(8);
  }
  if (Array.isArray(raw.inbounds) && raw.inbounds.length) {
    const valid = raw.inbounds.filter((ib) => ib && presetById(ib.presetId));
    for (const ib of valid) {
      if (ib.params && 'shortIds' in ib.params && LEGACY_SHORT_IDS.has(String(ib.params.shortIds))) ib.params.shortIds = randomShortIds();
    }
    out.inbounds = valid.length ? valid : DEFAULT_INBOUNDS();
  } else {
    out.inbounds = DEFAULT_INBOUNDS();
  }
  out.traffic = raw.traffic && Array.isArray(raw.traffic.samples) ? raw.traffic : base.traffic;
  out.events = Array.isArray(raw.events) ? raw.events.slice(-200) : [];
  return out;
}

export function normalizeUser(input) {
  const now = Date.now();
  const user = {
    id: input.id || uid(10),
    name: input.name || 'user',
    enabled: input.enabled !== false,
    createdAt: input.createdAt || now,
    expiresAt: input.expiresAt ?? null,
    quotaBytes: input.quotaBytes ?? null,
    ipLimit: Number(input.ipLimit ?? 0) || 0,
    note: input.note || '',
    lastSeen: input.lastSeen || 0,
    usage: { up: Number(input.usage?.up || 0), down: Number(input.usage?.down || 0) },
    secrets: {
      uuid: input.secrets?.uuid || crypto.randomUUID(),
      password: input.secrets?.password || b64url(crypto.randomBytes(12)),
      // Shadowsocks 2022 keys must be standard base64 with padding.
      ss128: input.secrets?.ss128 || crypto.randomBytes(16).toString('base64'),
      ss256: input.secrets?.ss256 || crypto.randomBytes(32).toString('base64'),
    },
    disabledReason: input.disabledReason || '',
    subToken: input.subToken || randomSubToken(),
  };
  return user;
}

export function load() {
  ensureDirs();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    doc = migrate(JSON.parse(raw));
  } catch {
    doc = defaults();
    writeNow();
  }
  return doc;
}

export function get() {
  return doc || load();
}

export function set(mutator) {
  const d = get();
  const result = mutator(d);
  d.updatedAt = Date.now();
  scheduleSave();
  emit();
  return result;
}

function emit() {
  for (const fn of listeners) {
    try { fn(doc); } catch { /* ignore */ }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function scheduleSave(delay = 120) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeNow();
  }, delay);
}

export function writeNow() {
  if (saving) { scheduleSave(250); return; }
  saving = true;
  try {
    ensureDirs();
    const tmp = path.join(DATA_DIR, `.bbg.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 1));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('[store] save failed:', err.message);
  } finally {
    saving = false;
  }
}

export function event(kind, message, meta = {}) {
  const d = get();
  d.events.push({ t: Date.now(), kind, message, ...meta });
  if (d.events.length > 200) d.events = d.events.slice(-200);
  scheduleSave();
  emit();
}

/* ── traffic helpers ────────────────────────────────────────────────── */

export function userTotal(user) {
  return (user.usage?.up || 0) + (user.usage?.down || 0);
}

export function isExpired(user, now = Date.now()) {
  return Boolean(user.expiresAt && user.expiresAt <= now);
}

export function isQuotaExhausted(user) {
  return Boolean(user.quotaBytes && userTotal(user) >= user.quotaBytes);
}

export function effectiveEnabled(user, now = Date.now()) {
  if (!user.enabled) return false;
  if (isExpired(user, now)) return false;
  if (isQuotaExhausted(user)) return false;
  return true;
}

export function addTrafficSample(point) {
  const d = get();
  const samples = d.traffic.samples;
  samples.push(point);
  if (samples.length > 180) d.traffic.samples = samples.slice(-180);
  scheduleSave(2000);
}

export function publicBase(settings, fallbackHost = '') {
  const host = (settings.publicHost || fallbackHost || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return host ? `https://${host}` : '';
}

export function exportBackup() {
  return JSON.stringify({ exportedAt: new Date().toISOString(), edition: 'server', doc: get() });
}

/** One-time key required by /api/setup when no admin exists (printed in the log). */
let SETUP_KEY = '';
export function setupKey() {
  if (!SETUP_KEY) SETUP_KEY = crypto.randomBytes(9).toString('base64url');
  return SETUP_KEY;
}

export function importBackup(text) {
  const parsed = JSON.parse(text);
  const incoming = parsed.doc || parsed;
  if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.users)) {
    throw new Error('invalid backup file');
  }
  // A backup without an admin would reopen first-run setup to anyone.
  if (!incoming.admin || !incoming.admin.hash || !incoming.secrets || !incoming.secrets.server) {
    throw new Error('backup has no admin account or secrets');
  }
  doc = migrate(incoming);
  writeNow();
  emit();
  return doc;
}
