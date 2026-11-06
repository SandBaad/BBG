/**
 * BBG · By SANDBAAD — EdgeScan Clean-IP & Low-Jitter Edge Scanner
 *
 * Walks an IPv4 CIDR block against a VLESS endpoint and keeps only clean edge
 * nodes that complete 3 consecutive round-trips with zero packet loss.
 * Ranks candidates by composite score (mean RTT + 0.5 × jitter) to prevent
 * packet-loss stalls on real-time messaging and VoIP streams.
 */
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

export const CLEAN_CIDR_PRESETS = [
  { cidr: '104.18.0.0/24', label: 'Cloudflare Edge · 104.18.0.0/24' },
  { cidr: '172.64.0.0/24', label: 'Cloudflare Anycast · 172.64.0.0/24' },
  { cidr: '162.159.128.0/24', label: 'Cloudflare Core · 162.159.128.0/24' },
  { cidr: '69.46.46.0/24', label: 'Edge Direct · 69.46.46.0/24' },
];

export const DEFAULTS = {
  cidr: '104.18.0.0/24',
  concurrency: 16,
  rounds: 3,
  gapMs: 50,
  connectTimeoutMs: 2200,
  probeTimeoutMs: 5000,
  maxHosts: 1024,
  presets: CLEAN_CIDR_PRESETS,
};

const VLESS_DEST_HOST = 'www.gstatic.com';
const VLESS_DEST_PORT = 80;
const PROBE_REQUEST = `GET /generate_204 HTTP/1.1\r\nHost: ${VLESS_DEST_HOST}\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n`;

/* ── link parsing ─────────────────────────────────────────────────────── */

export function parseVlessLink(raw) {
  const text = String(raw || '').trim();
  if (!/^vless:\/\//i.test(text)) throw new Error('only vless:// links can be scanned');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('the link is not a valid URL');
  }
  const uuid = decodeURIComponent(url.username || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new Error('the link has no valid UUID');
  }
  const q = url.searchParams;
  const type = (q.get('type') || 'ws').toLowerCase();
  const security = (q.get('security') || 'tls').toLowerCase();
  const domain = (q.get('host') || q.get('sni') || url.hostname || '').toLowerCase();
  if (!domain) throw new Error('the link has no host/SNI');
  return {
    mode: type === 'ws' ? 'full' : 'ping',
    raw: text,
    uuid,
    address: url.hostname,
    port: Number(url.port || 443) || 443,
    domain,
    sni: (q.get('sni') || domain).toLowerCase(),
    host: (q.get('host') || domain).toLowerCase(),
    path: q.get('path') || '/',
    security,
    type,
    name: decodeURIComponent((url.hash || '').replace(/^#/, '')) || 'BBG · EdgeScan',
  };
}

export function buildCleanLink(parsed, ip) {
  const swapped = parsed.raw.replace(/@(\[[^\]]+\]|[^@/?#]+?):(\d+)/, `@${ip}:${parsed.port}`);
  if (swapped !== parsed.raw) return swapped;
  const params = new URLSearchParams({
    encryption: 'none',
    security: parsed.security || 'tls',
    sni: parsed.sni,
    fp: 'chrome',
    alpn: 'http/1.1',
    type: parsed.type,
    host: parsed.host,
    path: parsed.path,
  });
  return `vless://${parsed.uuid}@${ip}:${parsed.port}?${params.toString()}#${encodeURIComponent(parsed.name)}`;
}

/* ── ip helpers ───────────────────────────────────────────────────────── */

export function expandCidr(cidr, cap = DEFAULTS.maxHosts) {
  const text = String(cidr || '').trim();
  const single = /^(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (single) return [single[1]];
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(text);
  if (!m) throw new Error('range must look like 104.18.0.0/24 or a single IP');
  const base = m[1].split('.').map(Number);
  const bits = Number(m[2]);
  if (bits < 8 || bits > 32) throw new Error('prefix must be between /8 and /32');
  if (base.some((n) => n < 0 || n > 255)) throw new Error('invalid IPv4 address');
  const total = 2 ** (32 - bits);
  const usable = bits >= 31 ? total : total - 2;
  if (usable > cap) throw new Error(`range too large (${usable} addresses, max ${cap})`);
  const startInt = ((base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3]) >>> 0;
  const first = bits >= 31 ? 0 : 1;
  const out = [];
  for (let i = first; i < usable + first; i += 1) {
    const n = (startInt + i) >>> 0;
    out.push([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  return out;
}

/* ── websocket helpers ────────────────────────────────────────────────── */

function frameBinary(payload) {
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x82;
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x82;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x82;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i += 1) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function vlessHeader(uuid, host, port) {
  const id = Buffer.from(uuid.replace(/-/g, ''), 'hex');
  const hostBytes = Buffer.from(host, 'utf8');
  const head = Buffer.alloc(1 + 16 + 1 + 1 + 2 + 1 + 1 + hostBytes.length);
  let o = 0;
  head[o++] = 0;
  id.copy(head, o);
  o += 16;
  head[o++] = 0;
  head[o++] = 1;
  head.writeUInt16BE(port, o);
  o += 2;
  head[o++] = 2;
  head[o++] = hostBytes.length;
  hostBytes.copy(head, o);
  return head;
}

function wsUpgradeRequest(parsed) {
  const key = crypto.randomBytes(16).toString('base64');
  const cleanPath = (parsed.path || '/').split('?')[0];
  const path = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
  return [
    `GET ${path} HTTP/1.1`,
    `Host: ${parsed.host}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    'User-Agent: Mozilla/5.0',
    '',
    '',
  ].join('\r\n');
}

function probeTls({ parsed, ip }) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    let done = false;
    let raw = null;
    let sock = null;
    const finish = (ok, extra = {}) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        sock?.destroy();
      } catch {
        /* ignore */
      }
      try {
        raw?.destroy();
      } catch {
        /* ignore */
      }
      resolve({ ok, ip, latency: Math.round(Number(process.hrtime.bigint() - started) / 1e6), ...extra });
    };
    const timer = setTimeout(() => finish(false, { reason: 'timeout' }), DEFAULTS.connectTimeoutMs + 1800);
    raw = net.connect({ host: ip, port: parsed.port, noDelay: true });
    raw.setNoDelay(true);
    raw.on('error', (err) => finish(false, { reason: err.code || 'tcp' }));
    raw.on('connect', () => {
      sock = tls.connect({
        socket: raw,
        servername: parsed.sni,
        ALPNProtocols: parsed.type === 'grpc' ? ['h2'] : ['http/1.1'],
        rejectUnauthorized: false,
      });
      sock.on('error', (err) => finish(false, { reason: err.code || 'tls' }));
      sock.on('secureConnect', () => finish(true));
    });
  });
}

function probe({ parsed, ip }) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    let tlsSocket = null;
    let raw = null;
    let connectTimer = null;
    let done = false;
    let buffered = Buffer.alloc(0);
    let upgraded = false;

    const finish = (ok, extra = {}) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (connectTimer) clearTimeout(connectTimer);
      try {
        tlsSocket?.destroy();
      } catch {
        /* ignore */
      }
      try {
        raw?.destroy();
      } catch {
        /* ignore */
      }
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ ok, ip, latency: Math.round(ms), ...extra });
    };

    const timer = setTimeout(() => finish(false, { reason: 'timeout' }), DEFAULTS.probeTimeoutMs);

    raw = net.connect({ host: ip, port: parsed.port, noDelay: true });
    raw.setNoDelay(true);
    raw.on('error', (err) => finish(false, { reason: err.code || 'tcp' }));
    connectTimer = setTimeout(() => finish(false, { reason: 'connect-timeout' }), DEFAULTS.connectTimeoutMs);
    raw.on('connect', () => {
      clearTimeout(connectTimer);
      tlsSocket = tls.connect({
        socket: raw,
        servername: parsed.sni,
        ALPNProtocols: ['http/1.1'],
        rejectUnauthorized: false,
      });
      tlsSocket.on('error', (err) => finish(false, { reason: err.code || 'tls' }));
      tlsSocket.on('close', () => {
        if (!done) finish(false, { reason: 'closed' });
      });
      tlsSocket.on('secureConnect', () => {
        tlsSocket.write(wsUpgradeRequest(parsed));
      });
      tlsSocket.on('data', (chunk) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (!upgraded) {
          const end = buffered.indexOf('\r\n\r\n');
          if (end === -1) {
            if (buffered.length > 8192) finish(false, { reason: 'bad-upgrade' });
            return;
          }
          const head = buffered.subarray(0, end).toString('latin1');
          const status = Number((/^HTTP\/1\.[01] (\d{3})/.exec(head) || [])[1] || 0);
          if (status !== 101) {
            finish(false, { reason: `upgrade-${status || 'invalid'}` });
            return;
          }
          upgraded = true;
          buffered = buffered.subarray(end + 4);
          const payload = Buffer.concat([
            vlessHeader(parsed.uuid, VLESS_DEST_HOST, VLESS_DEST_PORT),
            Buffer.from(PROBE_REQUEST, 'latin1'),
          ]);
          tlsSocket.write(frameBinary(payload));
        }
        const text = buffered.toString('latin1');
        if (text.includes('HTTP/1.1 204') || text.includes('204 No Content')) {
          finish(true);
        }
      });
    });
  });
}

async function probeThrice(parsed, ip, rounds, gapMs, isCancelled, probeFn = probe) {
  const latencies = [];
  for (let i = 0; i < rounds; i += 1) {
    if (isCancelled()) return { ok: false, ip, reason: 'cancelled' };
    const res = await probeFn({ parsed, ip });
    if (!res.ok) return res;
    latencies.push(res.latency);
    if (i < rounds - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  const mean = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const jitter = Math.max(...latencies) - Math.min(...latencies);
  const score = Math.round(mean + jitter * 0.5);
  return { ok: true, ip, latency: mean, jitter, score, samples: latencies };
}

/* ── scanner ──────────────────────────────────────────────────────────── */

export class RailynxScanner {
  constructor() {
    this.state = this.blank();
  }

  blank() {
    return {
      running: false,
      cancelled: false,
      startedAt: 0,
      finishedAt: 0,
      cidr: '',
      total: 0,
      checked: 0,
      alive: 0,
      failed: 0,
      concurrency: DEFAULTS.concurrency,
      parsed: null,
      results: [],
      recent: [],
      lastError: '',
      token: 0,
    };
  }

  snapshot() {
    return {
      running: this.state.running,
      cancelled: this.state.cancelled,
      startedAt: this.state.startedAt,
      finishedAt: this.state.finishedAt,
      cidr: this.state.cidr,
      total: this.state.total,
      checked: this.state.checked,
      alive: this.state.alive,
      failed: this.state.failed,
      concurrency: this.state.concurrency,
      lastError: this.state.lastError,
      link: this.state.parsed ? this.state.parsed.address : '',
      mode: this.state.parsed ? this.state.parsed.mode : '',
      results: this.state.results.slice(0, 200),
      recent: this.state.recent.slice(0, 24),
    };
  }

  cancel() {
    if (!this.state.running) return { ok: false, error: 'no scan is running' };
    this.state.cancelled = true;
    this.state.running = false;
    this.state.finishedAt = Date.now();
    this.state.token += 1;
    return { ok: true };
  }

  async start({ link, cidr = DEFAULTS.cidr, concurrency = DEFAULTS.concurrency }) {
    if (this.state.running) throw new Error('a scan is already running');
    const parsed = parseVlessLink(link);
    const hosts = expandCidr(cidr);
    const workers = Math.max(1, Math.min(32, Number(concurrency) || DEFAULTS.concurrency));
    const token = this.state.token + 1;
    this.state = {
      ...this.blank(),
      running: true,
      startedAt: Date.now(),
      cidr: String(cidr),
      total: hosts.length,
      concurrency: workers,
      parsed,
      token,
    };

    const st = this.state;
    const isCancelled = () => st.cancelled || this.state !== st;
    const queue = hosts.slice();
    const results = [];
    let index = 0;

    const worker = async () => {
      while (!isCancelled()) {
        const at = index;
        index += 1;
        if (at >= queue.length) return;
        const ip = queue[at];
        const res =
          parsed.mode === 'full'
            ? await probeThrice(parsed, ip, DEFAULTS.rounds, DEFAULTS.gapMs, isCancelled)
            : await probeThrice(parsed, ip, DEFAULTS.rounds, DEFAULTS.gapMs, isCancelled, probeTls);
        if (isCancelled()) return;
        this.state.checked += 1;
        this.state.recent.unshift({
          ip,
          ok: res.ok,
          latency: res.latency || 0,
          jitter: res.jitter || 0,
          reason: res.reason || '',
          at: Date.now(),
        });
        if (this.state.recent.length > 40) this.state.recent.length = 40;
        if (res.ok) {
          this.state.alive += 1;
          results.push({ ip, latency: res.latency, jitter: res.jitter, score: res.score, samples: res.samples });
          results.sort((a, b) => a.score - b.score || a.latency - b.latency);
          this.state.results = results.map((r) => ({
            ...r,
            link: buildCleanLink(parsed, r.ip),
          }));
        } else {
          this.state.failed += 1;
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: workers }, worker));
    } catch (err) {
      if (this.state === st) st.lastError = err.message;
    } finally {
      if (this.state === st) {
        st.running = false;
        st.finishedAt = Date.now();
      }
    }
    return this.snapshot();
  }
}

export const scanner = new RailynxScanner();
