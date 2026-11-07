/**
 * BBG · By SANDBAAD — Control Plane API & Subscription Router
 *
 * Exposes authenticated state/action endpoints (`/api/*`) and unauthenticated
 * multi-format subscription & subscriber portal endpoints (`/sub/:token`, `/u/:token`).
 */
import net from 'node:net';
import zlib from 'node:zlib';
import { analyse, applyProfile } from '../iran.js';
import { stripAnsi } from '../text.js';
import { checkUpdate, applyUpdate } from '../update.js';
import { scanner, DEFAULTS as RAILYNX_DEFAULTS, parseVlessLink } from '../railynx.js';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { APP, RAILWAY, IS_RAILWAY, DATA_DIR, PORT, MUX_PORT, BIN, NODE_ENV, LIMITS, TRUST_PROXY } from '../env.js';
import {
  get as getDoc,
  set as setDoc,
  normalizeUser,
  load,
  exportBackup,
  importBackup,
  userTotal,
  isExpired,
  isQuotaExhausted,
  event,
  setupKey,
} from '../store.js';
import { PRESETS, describeInbound, presetById, FIELD_MAP, freshParams, newRouteKey } from '../catalog.js';
import { buildUserLinks } from '../links.js';
import { buildSub, plainText } from '../subs.js';
import {
  hashPassword,
  verifyPassword,
  issueSession,
  clearSession,
  readSession,
  throttle,
  clearThrottle,
  randomSubToken,
} from '../auth.js';
import { generateSecret, telegramLinks, MTPROTO_PORT } from '../proxy/mtproto.js';

const FORMATS = new Set(['base64', 'links', 'xray', 'singbox', 'clash']);

/* ── helpers ─────────────────────────────────────────────────────────── */

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const base = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  };
  const acceptsGzip = /\bgzip\b/.test(res.req?.headers?.['accept-encoding'] || '');
  if (acceptsGzip && payload.length > 2048 && !base['Content-Encoding']) {
    const packed = zlib.gzipSync(payload, { level: 5 });
    res.writeHead(status, {
      ...base,
      'Content-Encoding': 'gzip',
      'Content-Length': packed.length,
      Vary: 'Accept-Encoding',
    });
    res.end(packed);
    return;
  }
  res.writeHead(status, { ...base, 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req, limit = LIMITS.maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  // Behind a trusted proxy the real address is the LAST hop it appended;
  // earlier entries are whatever the client chose to send.
  if (TRUST_PROXY) {
    const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i;
const isHost = (v) => HOST_RE.test(v) || IP_RE.test(v);

/** Header values must be latin1; anything else goes base64 (supported by v2rayNG/Hiddify). */
function headerText(text) {
  const v = String(text || '');
  return /^[\x20-\x7e]*$/.test(v) ? v : `base64:${Buffer.from(v, 'utf8').toString('base64')}`;
}
function attachmentName(name) {
  const ascii = String(name).replace(/[^\w.-]+/g, '_').slice(0, 60) || 'subscription';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function gbToBytes(gb) {
  const n = Number(gb);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1024 ** 3);
}

function bytesToGb(bytes) {
  return bytes ? Number((bytes / 1024 ** 3).toFixed(2)) : 0;
}

function userStatus(user) {
  if (!user.enabled) return 'disabled';
  if (isExpired(user)) return 'expired';
  if (isQuotaExhausted(user)) return 'quota';
  return 'active';
}

/* ── state assembly ──────────────────────────────────────────────────── */

export function buildState(runtime, req) {
  const doc = runtime.withRuntime(getDoc());
  const facts = runtime.facts();
  const snapshot = runtime.snapshot();
  const panelHost = facts.publicHost || (req?.headers?.host || '');
  const subBase = panelHost ? `https://${panelHost}` : '';
  const tcpReady = Boolean(facts.tcpHost && facts.tcpPort);

  const inbounds = (doc.inbounds || [])
    .map((raw) => {
      const ib = describeInbound(raw);
      if (!ib) return null;
      const reachable = ib.udp ? false : ib.edge === 'tcp' ? tcpReady : Boolean(facts.publicHost);
      return {
        id: ib.id,
        presetId: ib.presetId,
        label: ib.label,
        enabled: ib.enabled,
        core: ib.core,
        protocol: ib.protocol,
        transport: ib.transport,
        security: ib.security,
        edge: ib.edge,
        udp: Boolean(ib.udp),
        featured: Boolean(ib.featured),
        port: ib.port,
        routeKey: ib.routeKey,
        params: ib.params,
        title: ib.title,
        desc: ib.desc,
        note: ib.note || null,
        presetDesc: presetById(ib.presetId)?.desc || null,
        fields: (presetById(ib.presetId)?.fields || []).map((key) => FIELD_MAP[key]).filter(Boolean),
        reachable,
        reason: ib.udp
          ? { fa: 'نیازمند پورت UDP عمومی روی هاست', en: 'Requires public UDP port on host' }
          : ib.edge === 'tcp' && !tcpReady
            ? { fa: 'پروکسی TCP را فعال کنید', en: 'Enable TCP proxy forwarding' }
            : ib.edge === 'http' && !facts.publicHost
              ? { fa: 'دامنهٔ عمومی HTTPS تنظیم نشده', en: 'Public HTTPS domain not configured' }
              : null,
      };
    })
    .filter(Boolean);

  const users = (doc.users || []).map((user) => {
    const links = buildUserLinks(doc, user);
    return {
      id: user.id,
      name: user.name,
      enabled: user.enabled,
      status: userStatus(user),
      disabledReason: user.disabledReason || '',
      note: user.note,
      ipLimit: user.ipLimit,
      createdAt: user.createdAt,
      expiresAt: user.expiresAt,
      quotaBytes: user.quotaBytes,
      quotaGb: bytesToGb(user.quotaBytes),
      usage: { up: user.usage.up, down: user.usage.down, total: userTotal(user) },
      usageGb: bytesToGb(userTotal(user)),
      lastSeen: user.lastSeen,
      links,
      subToken: user.subToken,
      subUrl: subBase ? `${subBase}/sub/${user.subToken}` : '',
      portalUrl: subBase ? `${subBase}/u/${user.subToken}` : '',
    };
  });

  const warnings = [];
  const enabledCores = new Set(inbounds.filter((i) => i.enabled).map((i) => i.core));
  for (const [id, name] of [['xray', 'Xray'], ['singbox', 'sing-box']]) {
    const st = snapshot[id]?.status;
    if (!enabledCores.has(id) || st === 'running' || st === 'starting') continue;
    warnings.push({
      level: 'bad',
      fa: st === 'missing' ? `هستهٔ ${name} نصب نیست؛ پروتکل‌های آن کار نمی‌کنند.` : `هستهٔ ${name} اجرا نمی‌شود (${st}). بخش «هسته‌ها و لاگ» را ببینید.`,
      en: st === 'missing' ? `${name} is not installed; its protocols do not work.` : `${name} is not running (${st}). See Cores & logs.`,
    });
  }
  if (!tcpReady) warnings.push({ level: 'warn', fa: 'پورت TCP عمومی تنظیم نشده؛ REALITY، AnyTLS و Shadowsocks بدون آن قابل اتصال نیستند.', en: 'No public TCP port is set; REALITY, AnyTLS and Shadowsocks cannot be reached without it.' });
  if (!facts.publicHost) warnings.push({ level: 'warn', fa: 'دامنهٔ عمومی HTTPS تنظیم نشده؛ لینک اشتراک ساخته نمی‌شود.', en: 'No public HTTPS domain is set; subscription links cannot be built.' });
  if (!(doc.users || []).length) warnings.push({ level: 'info', fa: 'هنوز مشترکی ساخته نشده است.', en: 'No subscribers yet.' });

  const tg = doc.settings.telegram;
  const mtLinks =
    tg.mtproto.secret && tcpReady
      ? telegramLinks({ host: facts.tcpHost, port: facts.tcpPort, secret: tg.mtproto.secret })
      : { app: '', web: '' };
  const socksLink = tcpReady
    ? `https://t.me/socks?server=${facts.tcpHost}&port=${facts.tcpPort}&user=${encodeURIComponent(tg.socks.user)}&pass=${encodeURIComponent(tg.socks.pass)}`
    : '';
  const httpLink = tcpReady
    ? `http://${encodeURIComponent(tg.http.user)}:${encodeURIComponent(tg.http.pass)}@${facts.tcpHost}:${facts.tcpPort}`
    : '';

  return {
    edition: 'server',
    features: { telegram: true, cores: true, scanner: true, easy: true, raw: true, update: true, logs: true, probe: true, ping: true },
    warnings,
    trafficUnit: 'sample',
    app: {
      brand: doc.settings.brand || APP.brand,
      tag: doc.settings.tag || APP.tag,
      author: APP.author,
      version: APP.version,
      repo: APP.repo,
      telegram: APP.telegram,
      now: Date.now(),
      env: NODE_ENV,
    },
    facts: {
      publicHost: facts.publicHost,
      tcpHost: facts.tcpHost,
      tcpPort: facts.tcpPort,
      muxPort: MUX_PORT,
      panelUrl: facts.publicHost ? `https://${facts.publicHost}` : '',
      subBase: subBase ? `${subBase}/sub` : '',
      isRailway: IS_RAILWAY,
      region: RAILWAY.region,
      serviceName: RAILWAY.serviceName,
      projectName: RAILWAY.projectName,
      volume: RAILWAY.volumePath || DATA_DIR,
      dataDir: DATA_DIR,
      tcpReady,
      port: PORT,
      bins: {
        xray: BIN.xray,
        singbox: BIN.singbox,
        mtg: BIN.mtg,
      },
    },
    settings: {
      ...doc.settings,
      telegram: {
        mtproto: { ...tg.mtproto, secretHost: tg.mtproto.secret ? '' : '' },
        socks: tg.socks,
        http: tg.http,
        web: tg.web,
      },
    },
    inbounds,
    presets: PRESETS.map((p) => ({
      id: p.id,
      core: p.core,
      protocol: p.protocol,
      transport: p.transport,
      security: p.security,
      edge: p.edge,
      udp: Boolean(p.udp),
      featured: Boolean(p.featured),
      note: p.note || null,
      title: p.title,
      desc: p.desc,
      defaults: p.defaults,
      fields: (p.fields || []).map((key) => FIELD_MAP[key]).filter(Boolean),
    })),
    users,
    cores: {
      xray: snapshot.xray,
      singbox: snapshot.singbox,
      mtproto: snapshot.mtproto,
      mux: snapshot.mux,
      socks5: snapshot.socks5,
      http: snapshot.http,
      sys: snapshot.sys,
      bootedAt: snapshot.bootedAt,
    },
    telegram: {
      mtproto: {
        ...tg.mtproto,
        port: facts.tcpPort || MTPROTO_PORT,
        links: mtLinks,
        state: snapshot.mtproto,
        conflict: (snapshot.plan.conflicts || []).includes(String(tg.mtproto.faketlsHost || '').toLowerCase()),
      },
      socks: { ...tg.socks, port: facts.tcpPort, link: socksLink },
      http: { ...tg.http, port: facts.tcpPort, link: httpLink },
      web: { ...tg.web },
    },
    plan: snapshot.plan,
    traffic: doc.traffic.samples.slice(-96),
    events: doc.events.slice(-40).reverse(),
    limits: { maxUsers: LIMITS.maxUsers, statsIntervalMs: LIMITS.statsIntervalMs },
    setup: { needsSetup: !doc.admin },
  };
}

export function buildBootstrap(runtime, req) {
  const doc = getDoc();
  const facts = runtime.facts();
  const raw = doc.admin ? readSession(req, doc.secrets.server) : null;
  const session = raw && raw.u === doc.admin.username && (raw.v || 1) === (doc.admin.ver || 1) ? raw : null;
  return {
    app: {
      brand: doc.settings.brand || APP.brand,
      tag: doc.settings.tag || APP.tag,
      author: APP.author,
      version: APP.version,
      repo: APP.repo,
      telegram: APP.telegram,
      env: NODE_ENV,
      now: Date.now(),
    },
    edition: 'server',
    needsSetup: !doc.admin,
    setupKeyRequired: !doc.admin,
    loggedIn: Boolean(session),
    username: session?.u || '',
    facts: {
      publicHost: facts.publicHost,
      tcpHost: facts.tcpHost,
      tcpPort: facts.tcpPort,
      isRailway: IS_RAILWAY,
      region: RAILWAY.region,
      panelUrl: facts.publicHost ? `https://${facts.publicHost}` : '',
      tcpReady: Boolean(facts.tcpHost && facts.tcpPort),
      dataDir: DATA_DIR,
    },
    settings: { theme: doc.settings.theme, lang: doc.settings.lang },
  };
}

/* ── main router ─────────────────────────────────────────────────────── */

export async function handleApi(ctx) {
  const { req, res, url, runtime } = ctx;
  const doc = getDoc();
  const path = url.pathname;

  /* subscriptions & public portal (no session required) */
  if (path.startsWith('/sub/') || path.startsWith('/u/')) {
    return handleSubscription({ req, res, url, runtime });
  }

  const route = `${req.method} ${path}`;

  // Cross-site requests cannot set custom headers without a CORS preflight we never grant.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.headers['x-requested-with'] !== 'bbg') return send(res, 403, { error: 'missing header' });
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch { host = ''; }
      if (host !== req.headers.host && host !== req.headers['x-forwarded-host']) return send(res, 403, { error: 'bad origin' });
    }
  }

  if (route === 'GET /api/bootstrap') {
    return send(res, 200, buildBootstrap(runtime, req));
  }

  if (route === 'POST /api/setup') {
    if (doc.admin) return send(res, 409, { error: 'already configured' });
    const ip = clientIp(req);
    const gate = throttle(`setup:${ip}`);
    if (gate.blocked) return send(res, 429, { error: 'too many attempts', retryInMs: gate.retryInMs });
    const body = await readBody(req);
    if (!safeEq(String(body.setupKey || ''), setupKey())) return send(res, 403, { error: 'wrong setup key (it is printed in the server log)' });
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!/^[\w.@-]{3,32}$/.test(username)) return send(res, 400, { error: 'username: 3-32 letters, digits, . _ - @' });
    if (password.length < 10) return send(res, 400, { error: 'password must be at least 10 characters' });
    const record = hashPassword(password);
    setDoc((d) => {
      d.admin = { username, salt: record.salt, hash: record.hash, algo: record.algo, ver: 1, updatedAt: Date.now() };
    });
    issueSession(res, doc.secrets.server, username, 1, req);
    event('auth', `admin account created (${username})`);
    return send(res, 200, { ok: true, ...buildBootstrap(runtime, req) });
  }

  if (route === 'POST /api/login') {
    const ip = clientIp(req);
    const gate = throttle(`login:${ip}`);
    if (gate.blocked) return send(res, 429, { error: 'too many attempts', retryInMs: gate.retryInMs });
    const body = await readBody(req);
    if (!doc.admin) return send(res, 409, { error: 'setup required' });
    const okUser = safeEq(String(body.username || ''), doc.admin.username);
    const okPass = verifyPassword(String(body.password || ''), doc.admin);
    if (!okUser || !okPass) return send(res, 401, { error: 'invalid credentials' });
    clearThrottle(`login:${ip}`);
    issueSession(res, doc.secrets.server, doc.admin.username, doc.admin.ver || 1, req);
    return send(res, 200, { ok: true });
  }

  if (route === 'POST /api/logout') {
    clearSession(res, req);
    return send(res, 200, { ok: true });
  }

  /* everything below needs a session */
  const raw = doc.admin ? readSession(req, doc.secrets.server) : null;
  const session = raw && raw.u === doc.admin.username && (raw.v || 1) === (doc.admin.ver || 1) ? raw : null;
  if (!session) return send(res, 401, { error: 'unauthorized' });

  if (route === 'GET /api/state') {
    return send(res, 200, buildState(runtime, req));
  }

  if (route === 'POST /api/settings') {
    const body = await readBody(req);
    const clean = {};
    const bad = (m) => send(res, 400, { error: m });
    if (body.publicHost !== undefined) {
      const v = String(body.publicHost).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
      if (v && !isHost(v)) return bad('invalid public domain');
      clean.publicHost = v;
    }
    if (body.tcpHost !== undefined) {
      const v = String(body.tcpHost).trim().toLowerCase();
      if (v && !isHost(v)) return bad('invalid TCP host');
      clean.tcpHost = v;
    }
    if (body.tcpPort !== undefined) {
      const v = Number(body.tcpPort) || 0;
      if (!Number.isInteger(v) || v < 0 || v > 65535) return bad('invalid TCP port');
      clean.tcpPort = v;
    }
    if (body.theme !== undefined) clean.theme = body.theme === 'light' ? 'light' : 'dark';
    if (body.lang !== undefined) clean.lang = body.lang === 'en' ? 'en' : 'fa';
    for (const k of ['brand', 'tag']) {
      if (body[k] !== undefined) {
        const v = String(body[k]).trim().slice(0, 24);
        if (!v) return bad(`${k} cannot be empty`);
        clean[k] = v;
      }
    }
    for (const k of ['autoRestartCores', 'lowMemory', 'publicStatus', 'fragment']) if (body[k] !== undefined) clean[k] = Boolean(body[k]);
    if (body.logLevel !== undefined) {
      if (!['debug', 'info', 'warning', 'error', 'none'].includes(body.logLevel)) return bad('invalid log level');
      clean.logLevel = body.logLevel;
    }
    const coreOnly = Object.keys(clean).every((k) => ['theme', 'lang'].includes(k)) && !body.cores;
    setDoc((d) => {
      Object.assign(d.settings, clean);
      if (body.cores && typeof body.cores === 'object') {
        if (body.cores.xray) d.settings.cores.xray = { ...d.settings.cores.xray, ...body.cores.xray };
        if (body.cores.singbox) d.settings.cores.singbox = { ...d.settings.cores.singbox, ...body.cores.singbox };
      }
    });
    if (!coreOnly) await runtime.apply({ reason: 'settings' });
    return send(res, 200, { ok: true, state: buildState(runtime, req) });
  }

  if (route === 'POST /api/admin/password') {
    const body = await readBody(req);
    const password = String(body.password || '');
    if (password.length < 10) return send(res, 400, { error: 'password must be at least 10 characters' });
    if (!verifyPassword(String(body.current || ''), doc.admin)) {
      return send(res, 403, { error: 'wrong current password' });
    }
    const record = hashPassword(password);
    setDoc((d) => {
      d.admin.salt = record.salt;
      d.admin.hash = record.hash;
      d.admin.ver = (d.admin.ver || 1) + 1;
      d.admin.updatedAt = Date.now();
    });
    event('auth', 'admin password changed; other sessions signed out');
    issueSession(res, doc.secrets.server, doc.admin.username, doc.admin.ver, req);
    return send(res, 200, { ok: true });
  }

  /* ── users ─────────────────────────────────────────────────────────── */
  if (route === 'POST /api/users') {
    if (doc.users.length >= LIMITS.maxUsers) return send(res, 400, { error: 'user limit reached' });
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 64) || `user-${doc.users.length + 1}`;
    const days = Number(body.days || 0);
    const user = normalizeUser({
      name,
      quotaBytes: gbToBytes(body.quotaGb),
      expiresAt: days > 0 ? Date.now() + days * 86400000 : null,
      ipLimit: Number(body.ipLimit || 0),
      note: String(body.note || '').slice(0, 200),
    });
    setDoc((d) => d.users.push(user));
    event('user', `user created (${name})`);
    await runtime.apply({ reason: 'user-add' });
    return send(res, 200, { ok: true, user: { id: user.id }, state: buildState(runtime, req) });
  }

  const userMatch = /^\/api\/users\/([a-z0-9]+)(?:\/([a-z-]+))?$/.exec(path);
  if (userMatch) {
    const userId = userMatch[1];
    const action = userMatch[2];
    const user = doc.users.find((u) => u.id === userId);
    if (!user) return send(res, 404, { error: 'user not found' });

    if (req.method === 'PATCH' || (req.method === 'POST' && !action)) {
      const body = await readBody(req);
      setDoc(() => {
        if (body.name !== undefined) user.name = String(body.name).trim().slice(0, 64) || user.name;
        if (body.enabled !== undefined) user.enabled = Boolean(body.enabled);
        if (body.quotaGb !== undefined) user.quotaBytes = gbToBytes(body.quotaGb);
        if (body.days !== undefined) {
          const days = Number(body.days);
          user.expiresAt = days > 0 ? Date.now() + days * 86400000 : null;
        }
        if (body.expiresAt !== undefined) user.expiresAt = Number(body.expiresAt) > 0 ? Number(body.expiresAt) : null;
        if (body.ipLimit !== undefined) user.ipLimit = Math.max(0, Number(body.ipLimit) || 0);
        if (body.note !== undefined) user.note = String(body.note).slice(0, 200);
        if (user.enabled) user.disabledReason = '';
      });
      await runtime.apply({ reason: 'user-update' });
      return send(res, 200, { ok: true, state: buildState(runtime, req) });
    }

    if (req.method === 'DELETE' && !action) {
      setDoc((d) => {
        d.users = d.users.filter((u) => u.id !== userId);
      });
      event('user', `user removed (${user.name})`);
      await runtime.apply({ reason: 'user-remove' });
      return send(res, 200, { ok: true, state: buildState(runtime, req) });
    }

    if (action === 'rotate') {
      setDoc(() => {
        user.secrets = normalizeUser({ id: user.id, name: user.name }).secrets;
        user.subToken = randomSubToken();
      });
      event('user', `credentials and subscription link rotated (${user.name})`);
      await runtime.apply({ reason: 'user-rotate' });
      return send(res, 200, { ok: true, state: buildState(runtime, req) });
    }

    if (action === 'resettraffic' || action === 'reset') {
      setDoc(() => {
        user.usage = { up: 0, down: 0 };
        if (user.disabledReason === 'quota') user.disabledReason = '';
      });
      await runtime.apply({ reason: 'user-reset' });
      return send(res, 200, { ok: true, state: buildState(runtime, req) });
    }
  }

  /* ── inbounds ──────────────────────────────────────────────────────── */
  if (route === 'POST /api/inbounds') {
    const body = await readBody(req);
    const preset = presetById(String(body.presetId || ''));
    if (!preset) return send(res, 400, { error: 'unknown preset' });
    const used = new Set((doc.inbounds || []).map((ib) => ib.port));
    const base = preset.core === 'singbox' ? 12000 : 11000;
    let port = base + 1;
    while (used.has(port)) port += 1;
    const id = `ib${crypto.randomBytes(4).toString('hex').slice(0, 6)}`;
    setDoc((d) => {
      d.inbounds.push({
        id,
        presetId: preset.id,
        label: preset.title.en,
        enabled: true,
        routeKey: newRouteKey(),
        port,
        params: freshParams(preset),
      });
    });
    await runtime.apply({ reason: 'inbound-add' });
    return send(res, 200, { ok: true, state: buildState(runtime, req) });
  }

  const inboundMatch = /^\/api\/inbounds\/([a-z0-9]+)$/.exec(path);
  if (inboundMatch) {
    const inbound = (doc.inbounds || []).find((ib) => ib.id === inboundMatch[1]);
    if (!inbound) return send(res, 404, { error: 'inbound not found' });
    if (req.method === 'DELETE') {
      setDoc((d) => {
        d.inbounds = d.inbounds.filter((ib) => ib.id !== inbound.id);
      });
      await runtime.apply({ reason: 'inbound-remove' });
      return send(res, 200, { ok: true, state: buildState(runtime, req) });
    }
    if (req.method === 'PATCH' || req.method === 'POST') {
      const body = await readBody(req);
      const preset = presetById(inbound.presetId);
      const allowedKeys = new Set(preset?.fields || []);
      const params = {};
      if (body.params && typeof body.params === 'object') {
        for (const [k, v] of Object.entries(body.params)) {
          if (!allowedKeys.has(k)) continue;
          const f = FIELD_MAP[k];
          const val = String(v ?? '').trim().slice(0, 200);
          if (f?.type === 'select' && !f.options.includes(val)) return send(res, 400, { error: `invalid value for ${k}` });
          if (f?.type === 'number' && val !== '' && !(Number(val) >= 0)) return send(res, 400, { error: `invalid number for ${k}` });
          if (/[\s"'<>\\]/.test(val) && k !== 'obfs') return send(res, 400, { error: `invalid characters in ${k}` });
          params[k] = f?.type === 'number' ? Number(val || 0) : val;
        }
      }
      if (params.shortIds !== undefined && !params.shortIds) delete params.shortIds;
      setDoc(() => {
        if (body.enabled !== undefined) inbound.enabled = Boolean(body.enabled);
        if (body.label !== undefined) inbound.label = String(body.label).slice(0, 60);
        inbound.params = { ...inbound.params, ...params };
      });
      await runtime.apply({ reason: 'inbound-update' });
      return send(res, 200, { ok: true, state: buildState(runtime, req) });
    }
  }

  /* ── telegram ──────────────────────────────────────────────────────── */
  if (route === 'POST /api/telegram') {
    const body = await readBody(req);
    const tgNow = doc.settings.telegram;
    const patch = { mtproto: {}, socks: {}, http: {} };
    if (body.mtproto && typeof body.mtproto === 'object') {
      const m = body.mtproto;
      if (m.enabled !== undefined) patch.mtproto.enabled = Boolean(m.enabled);
      if (m.faketlsHost !== undefined) {
        const h = String(m.faketlsHost).trim().toLowerCase();
        if (!HOST_RE.test(h)) return send(res, 400, { error: 'invalid FakeTLS domain' });
        patch.mtproto.faketlsHost = h;
      }
      if (m.adTag !== undefined) {
        const t = String(m.adTag).trim();
        if (t && !/^[0-9a-f]{32}$/i.test(t)) return send(res, 400, { error: 'ad tag must be 32 hex characters' });
        patch.mtproto.adTag = t;
      }
      if (m.preferIpv6 !== undefined) patch.mtproto.preferIpv6 = Boolean(m.preferIpv6);
    }
    for (const kind of ['socks', 'http']) {
      const p = body[kind];
      if (!p || typeof p !== 'object') continue;
      if (p.user !== undefined) {
        const u = String(p.user).trim();
        if (!/^[\w.-]{1,32}$/.test(u)) return send(res, 400, { error: `${kind}: username 1-32 letters/digits` });
        patch[kind].user = u;
      }
      if (p.pass !== undefined) {
        const pw = String(p.pass);
        if (pw.length < 8 || pw.length > 64 || /[\s:@]/.test(pw)) return send(res, 400, { error: `${kind}: password 8-64 characters, no spaces, : or @` });
        patch[kind].pass = pw;
      }
      if (p.enabled !== undefined) patch[kind].enabled = Boolean(p.enabled);
      const pass = patch[kind].pass ?? tgNow[kind].pass;
      if ((patch[kind].enabled ?? tgNow[kind].enabled) && (!pass || pass.length < 8)) return send(res, 400, { error: `${kind}: set a password of 8+ characters first` });
    }
    setDoc((d) => {
      const tg = d.settings.telegram;
      const hostChanged = patch.mtproto.faketlsHost && patch.mtproto.faketlsHost !== tg.mtproto.faketlsHost;
      tg.mtproto = { ...tg.mtproto, ...patch.mtproto };
      if (!tg.mtproto.secret || hostChanged) tg.mtproto.secret = generateSecret(tg.mtproto.faketlsHost || 'www.samsung.com');
      tg.socks = { ...tg.socks, ...patch.socks };
      tg.http = { ...tg.http, ...patch.http };
    });
    await runtime.apply({ reason: 'telegram' });
    return send(res, 200, { ok: true, state: buildState(runtime, req) });
  }

  if (route === 'POST /api/telegram/secret') {
    setDoc((d) => {
      d.settings.telegram.mtproto.secret = generateSecret(d.settings.telegram.mtproto.faketlsHost);
    });
    await runtime.apply({ reason: 'telegram-secret' });
    return send(res, 200, { ok: true, state: buildState(runtime, req) });
  }

  /* ── cores / diagnostics ───────────────────────────────────────────── */
  if (route === 'GET /api/easy-setup') {
    const state = buildState(runtime, req);
    return send(res, 200, {
      analysis: analyse({
        doc: getDoc(),
        facts: runtime.facts(),
        cores: {
          xray: state.cores.xray && state.cores.xray.status,
          singbox: state.cores.singbox && state.cores.singbox.status,
          mtproto: state.cores.mtproto && state.cores.mtproto.status,
        },
      }),
      users: state.users.map((u) => ({
        id: u.id,
        name: u.name,
        status: u.status,
        links: u.links.length,
        subUrl: u.subUrl,
        portalUrl: u.portalUrl,
      })),
    });
  }

  if (route === 'POST /api/easy-setup/apply') {
    const body = await readBody(req);
    const profileId = String(body.profile || 'iran');
    let summary = null;
    setDoc((d) => {
      summary = applyProfile(d, profileId);
      d.updatedAt = Date.now();
    });
    await runtime.apply({ reason: `easy-setup:${profileId}` });
    const state = buildState(runtime, req);
    const firstUser = state.users[0];
    const packet = {
      ok: true,
      summary,
      analysis: analyse({
        doc: getDoc(),
        facts: runtime.facts(),
        cores: {
          xray: state.cores.xray && state.cores.xray.status,
          singbox: state.cores.singbox && state.cores.singbox.status,
          mtproto: state.cores.mtproto && state.cores.mtproto.status,
        },
      }),
      subUrl: firstUser ? firstUser.subUrl : '',
      base64Url: firstUser ? firstUser.subUrl : '',
      portalUrl: firstUser ? firstUser.portalUrl : '',
      links: firstUser ? firstUser.links : [],
    };
    return send(res, 200, packet);
  }

  if (route === 'POST /api/apply') {
    await runtime.apply({ reason: 'manual' });
    return send(res, 200, { ok: true, state: buildState(runtime, req) });
  }

  const coreMatch = /^\/api\/cores\/(xray|singbox|mtproto)\/restart$/.exec(path);
  if (coreMatch) {
    const which = coreMatch[1];
    if (which === 'mtproto') {
      const tg = doc.settings.telegram.mtproto;
      await runtime.mtproto.stop();
      if (tg.enabled) {
        await runtime.mtproto.start({ secret: tg.secret, faketlsHost: tg.faketlsHost, preferIpv4: !tg.preferIpv6 });
      }
    } else {
      await runtime.apply({ reason: `restart-${which}` });
    }
    return send(res, 200, { ok: true, state: buildState(runtime, req) });
  }

  /* ── EdgeScan / Clean-IP Scanner ───────────────────────────────────── */
  if (route === 'GET /api/railynx' || route === 'GET /api/edgescan') {
    return send(res, 200, { ...scanner.snapshot(), defaults: RAILYNX_DEFAULTS });
  }

  if (route === 'POST /api/railynx/scan' || route === 'POST /api/edgescan/scan') {
    const body = await readBody(req);
    const link = String(body.link || '').trim();
    try {
      parseVlessLink(link);
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
    if (scanner.snapshot().running) return send(res, 409, { error: 'a scan is already running' });
    const cidr = String(body.cidr || RAILYNX_DEFAULTS.cidr).trim();
    const concurrency = Number(body.concurrency || RAILYNX_DEFAULTS.concurrency);
    event('edgescan', `scan started on ${cidr}`);
    scanner.start({ link, cidr, concurrency }).catch((err) => {
      event('edgescan-error', err.message);
    });
    await new Promise((r) => setTimeout(r, 120));
    return send(res, 200, { ok: true, ...scanner.snapshot() });
  }

  if (route === 'POST /api/railynx/cancel' || route === 'POST /api/edgescan/cancel') {
    const result = scanner.cancel();
    if (result.ok) event('edgescan', 'scan cancelled');
    return send(res, result.ok ? 200 : 400, { ...result, ...scanner.snapshot() });
  }

  if (route === 'GET /api/raw') {
    return send(res, 200, runtime.rawConfigs());
  }

  if (route === 'POST /api/raw') {
    const body = await readBody(req);
    const core = String(body.core || '');
    if (core !== 'xray' && core !== 'singbox') return send(res, 400, { error: 'unknown core' });
    const text = typeof body.config === 'string' ? body.config.trim() : '';
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return send(res, 400, { error: 'config must be a JSON object' });
        }
      } catch (err) {
        return send(res, 400, { error: `invalid JSON: ${err.message}` });
      }
    }
    setDoc((d) => {
      d.settings.rawOverride = { xray: '', singbox: '', ...(d.settings.rawOverride || {}) };
      d.settings.rawOverride[core] = text;
    });
    event('raw-config', `${core} raw config ${text ? 'saved' : 'cleared'}`);
    await runtime.apply({ reason: `raw:${core}` });
    return send(res, 200, { ok: true, raw: runtime.rawConfigs(), state: buildState(runtime, req) });
  }

  if (route === 'GET /api/logs') {
    const source = url.searchParams.get('source') || 'xray';
    const snapshot = runtime.snapshot();
    const map = {
      xray: snapshot.xray.lines,
      singbox: snapshot.singbox.lines,
      mtproto: snapshot.mtproto.lines,
    };
    return send(res, 200, { source, lines: (map[source] || []).map((l) => stripAnsi(l)) });
  }

  if (route === 'GET /api/backup') {
    return send(res, 200, exportBackup(), {
      'Content-Disposition': attachmentName(`bbg-backup-${new Date().toISOString().slice(0, 10)}.json`),
      'Content-Type': 'application/json; charset=utf-8',
    });
  }

  if (route === 'POST /api/restore') {
    const body = await readBody(req, 16 * 1024 * 1024);
    try {
      importBackup(JSON.stringify(body));
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
    load();
    await runtime.apply({ reason: 'restore' });
    return send(res, 200, { ok: true, relogin: true });
  }

  if (route === 'GET /api/update') {
    const info = await checkUpdate({ force: url.searchParams.get('force') === '1' });
    return send(res, 200, info);
  }

  if (route === 'POST /api/update') {
    const logs = [];
    try {
      const report = await applyUpdate({ restart: false, onLog: (line) => logs.push(line) });
      setTimeout(() => process.exit(0), 700);
      return send(res, 200, { ...report, logs });
    } catch (err) {
      return send(res, 500, { ok: false, error: String(err && err.message ? err.message : err), logs });
    }
  }

  if (route === 'POST /api/links/ping') {
    const body = await readBody(req);
    const doc = runtime.withRuntime(getDoc());
    const user = (doc.users || []).find((u) => u.id === body.userId) || (doc.users || [])[0];
    if (!user) return send(res, 400, { error: 'no user' });
    const links = buildUserLinks(doc, user);
    const cache = new Map();
    const results = await Promise.all(
      links.map(async (l) => {
        const key = `${l.conn.host}:${l.conn.port}`;
        if (!cache.has(key)) cache.set(key, probeTcp(l.conn.host, Number(l.conn.port)));
        const r = await cache.get(key);
        return { label: l.label, ok: r.ok, ms: r.ms, host: l.conn.host, port: Number(l.conn.port), error: r.error || '' };
      }),
    );
    return send(res, 200, { results, at: Date.now() });
  }

  if (route === 'POST /api/tools/probe') {
    const body = await readBody(req);
    const host = String(body.host || '').trim();
    const port = Number(body.port || 443);
    if (!host || host.length > 253 || !/^[A-Za-z0-9.:[\]-]+$/.test(host)) return send(res, 400, { error: 'valid host required' });
    if (!Number.isInteger(port) || port < 1 || port > 65535) return send(res, 400, { error: 'port must be 1-65535' });
    const result = await probeTcp(host.replace(/^\[|\]$/g, ''), port);
    return send(res, 200, result);
  }

  return send(res, 404, { error: 'not found', route });
}

function probeTcp(host, port) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    socket.setNoDelay(true);
    const done = (ok, error) => {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve({ ok, error: error || '', ms: Date.now() - started, host, port });
    };
    socket.setTimeout(5000, () => done(false, 'timeout'));
    socket.once('error', (err) => done(false, err.message));
    socket.connect(port, host, () => done(true));
  });
}

/* ── subscriptions ───────────────────────────────────────────────────── */

let PORTAL_HTML = null;
function portalHtml() {
  if (!PORTAL_HTML) {
    const page = readFileSync(new URL('../../public/portal.html', import.meta.url), 'utf8');
    const qr = readFileSync(new URL('../../public/js/qrcode.js', import.meta.url), 'utf8');
    PORTAL_HTML = page.replace('<script data-inline="qrcode"></script>', () => `<script>${qr}</script>`);
  }
  return PORTAL_HTML;
}

function handleSubscription({ req, res, url, runtime }) {
  const parts = url.pathname.split('/').filter(Boolean);
  const kind = parts[0];
  const token = parts[1] || '';
  const format = (parts[2] || url.searchParams.get('format') || 'base64').toLowerCase();
  const doc = runtime.withRuntime(getDoc());
  const user = token.length >= 16 ? (doc.users || []).find((u) => u.subToken && safeEq(u.subToken, token)) : null;
  if (!user) {
    res.writeHead(404, { 'Content-Type': 'text/html', Server: 'nginx' });
    res.end('<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>nginx</center></body></html>');
    return;
  }

  if (kind === 'u') {
    const status = userStatus(user);
    const host = runtime.facts().publicHost || req.headers.host || '';
    const info = {
      name: user.name,
      status,
      usage: { up: user.usage.up, down: user.usage.down, total: userTotal(user) },
      quotaBytes: user.quotaBytes,
      expiresAt: user.expiresAt,
      subUrl: host ? `https://${host}/sub/${user.subToken}` : `/sub/${user.subToken}`,
      links: status === 'active'
        ? buildUserLinks(doc, user).map((l) => ({ label: l.label, short: l.short, uri: l.uri, protocol: l.protocol, transport: l.transport }))
        : [],
    };
    if (url.searchParams.get('json') === '1') return send(res, 200, info);
    const page = portalHtml().replace('<meta name="portal-data" content="">', `<meta name="portal-data" content="/u/${user.subToken}?json=1">`);
    return send(res, 200, page, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      'X-Frame-Options': 'DENY',
    });
  }

  if (!FORMATS.has(format)) return send(res, 400, { error: 'unknown format' });
  const sub = buildSub(doc, user, format);
  const headers = {
    'Content-Type': sub.type,
    'Cache-Control': 'no-store',
    'Subscription-Userinfo': buildUserInfoHeader(user),
    'Profile-Update-Interval': '6',
    'Profile-Title': headerText(`${doc.settings.brand || APP.brand} · ${user.name}`),
  };
  if (url.searchParams.get('download') === '1') {
    headers['Content-Disposition'] = attachmentName(`${user.name}.${format === 'clash' ? 'yaml' : format === 'links' || format === 'base64' ? 'txt' : 'json'}`);
  }
  return send(res, 200, sub.body, headers);
}

function buildUserInfoHeader(user) {
  const total = user.quotaBytes || 0;
  const expire = user.expiresAt ? Math.floor(user.expiresAt / 1000) : 0;
  return `upload=${user.usage?.up || 0}; download=${user.usage?.down || 0}; total=${total}; expire=${expire}`;
}

export { plainText };
