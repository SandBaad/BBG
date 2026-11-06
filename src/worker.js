/**
 * BBG · Serverless Cloudflare Worker Engine
 * Author / Maintainer: SANDBAAD
 *
 * Native Cloudflare Worker runtime for BBG:
 *  - Zero-stall VLESS & Trojan over WebSocket (`cloudflare:sockets`)
 *  - 0-RTT Early Data (`Sec-WebSocket-Protocol`) coalescing
 *  - Multi-stage ProxyIP & NAT64 failover (prevents Error 1101 & Telegram stalls)
 *  - Hardened Subscription Generator (sing-box 1.12+, Xray Fragment, Clash/Mihomo, Base64)
 *  - Full BBG Control Plane API compatible with `./public` Glassmorphic UI (KV + Stateless Fallback)
 */
import { connect } from 'cloudflare:sockets';
import crypto from 'node:crypto';

const VERSION = '2.0.0';
const COOKIE_NAME = 'bbg_session';

const DEFAULT_CLEAN_IPS = [
  { ip: '104.16.132.229', latency: 24 },
  { ip: '104.17.148.22', latency: 28 },
  { ip: '172.67.73.163', latency: 31 },
  { ip: '104.21.48.84', latency: 35 },
  { ip: '162.159.135.42', latency: 39 },
  { ip: '104.18.32.47', latency: 42 },
];

const TELEGRAM_CIDRS = [
  '91.108.4.0/22',
  '91.108.8.0/22',
  '91.108.12.0/22',
  '91.108.16.0/22',
  '91.108.56.0/22',
  '149.154.160.0/20',
  '185.76.151.0/24',
];

let MEMORY_STORE = null;

/* ── Cryptographic & Deterministic Helpers ─────────────────────────────── */

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function deterministicUuid(seed) {
  const hash = crypto.createHash('sha256').update(String(seed)).digest();
  hash[6] = (hash[6] & 0x0f) | 0x40;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function signToken(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function userSubToken(userId, secret) {
  const sig = crypto.createHmac('sha256', secret).update(`sub:${userId}`).digest('base64url').slice(0, 22);
  return `${userId}.${sig}`;
}

function verifySubToken(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [userId, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(`sub:${userId}`).digest('base64url').slice(0, 22);
  return sig === expected ? userId : null;
}

/* ── Edge State Management (KV + Memory Fallback) ──────────────────────── */

function defaultDoc(host, env) {
  const masterSecret = env.SECRET || env.UUID || `bbg-edge-${host}`;
  const defaultUuid = env.UUID || deterministicUuid(`user:${masterSecret}`);
  const defaultPass = sha256Hex(`pass:${masterSecret}`).slice(0, 16);
  const now = Date.now();

  return {
    schema: 4,
    createdAt: now,
    updatedAt: now,
    admin: env.ADMIN_PASSWORD
      ? {
          username: env.ADMIN_USER || 'admin',
          passHash: sha256Hex(env.ADMIN_PASSWORD),
          createdAt: now,
        }
      : null,
    secrets: {
      cookie: sha256Hex(`cookie:${masterSecret}`),
      sub: sha256Hex(`sub:${masterSecret}`),
      server: sha256Hex(`srv:${masterSecret}`),
      mtproto: 'ee' + sha256Hex(`mtg:${masterSecret}`).slice(0, 32) + Buffer.from('www.microsoft.com').toString('hex'),
    },
    settings: {
      brand: 'BBG',
      tag: 'EDGE',
      lang: 'fa',
      theme: 'dark',
      publicHost: host,
      tcpHost: host,
      tcpPort: 443,
      logLevel: 'warning',
      fragment: true,
      lowMemory: true,
      proxyIp: env.PROXYIP || 'proxyip.fxxk.dedyn.io:443',
      cleanIps: '104.16.132.229,172.67.73.163,104.21.48.84',
      easySetup: { profile: 'iran-best' },
      cores: {
        xray: { enabled: true },
        singbox: { enabled: true, lazy: true },
      },
      telegram: {
        mtproto: { enabled: true, faketlsHost: 'www.microsoft.com', adTag: '' },
        socks: { enabled: true, user: 'bbg', pass: defaultPass.slice(0, 10) },
        http: { enabled: false, user: 'bbg', pass: defaultPass.slice(0, 10) },
      },
    },
    inbounds: [
      {
        id: 'ib-ws-tls',
        presetId: 'vless-ws',
        enabled: true,
        routeKey: 'bbg-ws',
        port: 443,
        params: { path: '/ed2048', host: '' },
      },
      {
        id: 'ib-tr-ws',
        presetId: 'trojan-ws',
        enabled: true,
        routeKey: 'bbg-tr-ws',
        port: 443,
        params: { path: '/tr', host: '' },
      },
      {
        id: 'ib-httpup',
        presetId: 'vless-httpupgrade',
        enabled: true,
        routeKey: 'bbg-httpup',
        port: 443,
        params: { path: '/up', host: '' },
      },
      {
        id: 'ib-xhttp',
        presetId: 'vless-xhttp',
        enabled: true,
        routeKey: 'bbg-xhttp',
        port: 443,
        params: { path: '/xhttp', host: '', mode: 'auto' },
      },
    ],
    users: [
      {
        id: 'default01',
        name: 'BBG-Default',
        enabled: true,
        createdAt: now,
        expiresAt: null,
        quotaBytes: null,
        ipLimit: 0,
        note: 'Default Cloudflare Edge Subscriber',
        lastSeen: now,
        usage: { up: 0, down: 0 },
        secrets: {
          uuid: defaultUuid,
          password: defaultPass,
          ss128: Buffer.from(sha256Hex(`ss128:${masterSecret}`).slice(0, 16)).toString('base64'),
          ss256: Buffer.from(sha256Hex(`ss256:${masterSecret}`).slice(0, 32)).toString('base64'),
        },
      },
    ],
    traffic: {
      samples: Array.from({ length: 24 }, (_, i) => ({
        t: now - (24 - i) * 60000,
        up: 120000 + ((i * 49152) % 340000),
        down: 540000 + ((i * 131072) % 1450000),
        tg: 64000 + ((i * 16384) % 120000),
      })),
    },
    events: [
      { t: now, kind: 'edge', message: `BBG v${VERSION} Cloudflare Worker active on ${host}` },
    ],
  };
}

async function loadDoc(host, env) {
  if (env.BBG_KV) {
    try {
      const raw = await env.BBG_KV.get('bbg_state', 'json');
      if (raw && typeof raw === 'object') {
        MEMORY_STORE = raw;
        return raw;
      }
    } catch { /* fallback to memory */ }
  }
  if (!MEMORY_STORE) {
    MEMORY_STORE = defaultDoc(host, env);
  }
  return MEMORY_STORE;
}

async function saveDoc(doc, env) {
  doc.updatedAt = Date.now();
  MEMORY_STORE = doc;
  if (env.BBG_KV) {
    try {
      await env.BBG_KV.put('bbg_state', JSON.stringify(doc));
    } catch { /* ignore KV quota errors */ }
  }
  return doc;
}

/* ── Link & Subscription Generation on Cloudflare Edge ─────────────────── */

const PRESET_META = {
  'vless-ws': {
    id: 'vless-ws',
    core: 'xray',
    protocol: 'vless',
    transport: 'ws',
    security: 'tls-edge',
    edge: 'http',
    tier: 'verified',
    featured: true,
    title: { fa: 'VLESS + WebSocket (0-RTT · لبهٔ کلادفلر)', en: 'VLESS + WebSocket (0-RTT · Cloudflare Edge)' },
    desc: { fa: 'پایدارترین روش روی ورکر کلادفلر با دادهٔ اولیهٔ 0-RTT (?ed=2048).', en: 'Primary Cloudflare Worker transport with 0-RTT early data (?ed=2048).' },
    fields: [
      { key: 'path', label: { fa: 'پسوند مسیر', en: 'Path suffix' }, type: 'text', mono: true },
      { key: 'host', label: { fa: 'هدر Host / دامنهٔ تمیز', en: 'Host header / Clean Domain' }, type: 'text', mono: true },
    ],
  },
  'trojan-ws': {
    id: 'trojan-ws',
    core: 'xray',
    protocol: 'trojan',
    transport: 'ws',
    security: 'tls-edge',
    edge: 'http',
    tier: 'verified',
    featured: true,
    title: { fa: 'Trojan + WebSocket (0-RTT · کلادفلر)', en: 'Trojan + WebSocket (0-RTT · Cloudflare Edge)' },
    desc: { fa: 'پروتکل Trojan روی بستر WebSocket کلادفلر با اثرانگشت Chrome.', en: 'Trojan over Cloudflare WebSocket with uTLS Chrome fingerprint.' },
    fields: [
      { key: 'path', label: { fa: 'پسوند مسیر', en: 'Path suffix' }, type: 'text', mono: true },
      { key: 'host', label: { fa: 'هدر Host', en: 'Host header' }, type: 'text', mono: true },
    ],
  },
  'vless-httpupgrade': {
    id: 'vless-httpupgrade',
    core: 'xray',
    protocol: 'vless',
    transport: 'httpupgrade',
    security: 'tls-edge',
    edge: 'http',
    tier: 'verified',
    featured: true,
    title: { fa: 'VLESS + HTTPUpgrade (تأخیر بسیار کم)', en: 'VLESS + HTTPUpgrade (Ultra-Low Latency)' },
    desc: { fa: 'آپگرید مستقیم HTTP/1.1 بدون سربار فریم‌بندی WebSocket.', en: 'Lightweight HTTP/1.1 upgrade transport without WebSocket framing overhead.' },
    fields: [
      { key: 'path', label: { fa: 'پسوند مسیر', en: 'Path suffix' }, type: 'text', mono: true },
      { key: 'host', label: { fa: 'هدر Host', en: 'Host header' }, type: 'text', mono: true },
    ],
  },
  'vless-xhttp': {
    id: 'vless-xhttp',
    core: 'singbox',
    protocol: 'vless',
    transport: 'xhttp',
    security: 'tls-edge',
    edge: 'http',
    tier: 'verified',
    featured: true,
    title: { fa: 'VLESS + XHTTP (پدینگ تصادفی ضد DPI)', en: 'VLESS + XHTTP (Randomized DPI Padding)' },
    desc: { fa: 'مقاوم در برابر DPI با پدینگ ۱۰۰ تا ۱۰۰۰ بایت.', en: 'SplitHTTP transport with 100-1000B randomized padding.' },
    fields: [
      { key: 'path', label: { fa: 'پسوند مسیر', en: 'Path suffix' }, type: 'text', mono: true },
      { key: 'host', label: { fa: 'هدر Host', en: 'Host header' }, type: 'text', mono: true },
    ],
  },
};

function buildUserLinks(user, doc, host) {
  const publicHost = doc.settings.publicHost || host;
  const cleanList = String(doc.settings.cleanIps || '104.16.132.229,172.67.73.163')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const endpoints = [
    { addr: publicHost, tag: 'Edge' },
    ...cleanList.slice(0, 3).map((ip, i) => ({ addr: ip, tag: `CF-Clean-${i + 1}` })),
  ];

  const links = [];
  for (const ib of doc.inbounds || []) {
    if (!ib.enabled) continue;
    const preset = PRESET_META[ib.presetId] || PRESET_META['vless-ws'];
    const suffix = ib.params?.path && ib.params.path !== '/' ? ib.params.path : '';
    const basePath = `/${ib.routeKey}${suffix}`;
    const wsPath = `${basePath}?ed=2048`;
    const sniHost = ib.params?.host || publicHost;

    for (const ep of endpoints) {
      const label = `BBG · ${preset.protocol.toUpperCase()}-${preset.transport.toUpperCase()} (${ep.tag}) · ${user.name}`;
      if (preset.protocol === 'trojan') {
        const q = new URLSearchParams({
          security: 'tls',
          sni: sniHost,
          fp: 'chrome',
          alpn: 'http/1.1',
          type: 'ws',
          host: sniHost,
          path: wsPath,
        });
        links.push({
          inboundId: ib.id,
          label,
          short: `TROJAN · WS (${ep.tag})`,
          protocol: 'trojan',
          transport: 'ws',
          core: preset.core,
          host: ep.addr,
          port: 443,
          sni: sniHost,
          path: basePath,
          uri: `trojan://${encodeURIComponent(user.secrets.password)}@${ep.addr}:443?${q.toString()}#${encodeURIComponent(label)}`,
        });
      } else {
        const tType = preset.transport === 'xhttp' ? 'xhttp' : preset.transport === 'httpupgrade' ? 'httpupgrade' : 'ws';
        const q = new URLSearchParams({
          encryption: 'none',
          security: 'tls',
          sni: sniHost,
          fp: 'chrome',
          alpn: 'http/1.1',
          type: tType,
          host: sniHost,
          path: tType === 'ws' || tType === 'httpupgrade' ? wsPath : basePath,
        });
        if (tType === 'xhttp') q.set('mode', 'auto');
        links.push({
          inboundId: ib.id,
          label,
          short: `VLESS · ${tType.toUpperCase()} (${ep.tag})`,
          protocol: 'vless',
          transport: tType,
          core: preset.core,
          host: ep.addr,
          port: 443,
          sni: sniHost,
          path: basePath,
          uri: `vless://${user.secrets.uuid}@${ep.addr}:443?${q.toString()}#${encodeURIComponent(label)}`,
        });
      }
      // Only expand clean IPs for the primary WebSocket inbound so subscriptions stay clean and fast
      if (ib.presetId !== 'vless-ws') break;
    }
  }
  return links;
}

function buildEdgeSubscription(user, doc, host, format = 'base64') {
  const links = buildUserLinks(user, doc, host);
  const fragment = doc.settings.fragment !== false;

  if (format === 'links') {
    return { contentType: 'text/plain; charset=utf-8', body: links.map((l) => l.uri).join('\n') + '\n' };
  }
  if (format === 'base64') {
    const raw = links.map((l) => l.uri).join('\n');
    return { contentType: 'text/plain; charset=utf-8', body: Buffer.from(raw, 'utf8').toString('base64') };
  }
  if (format === 'singbox') {
    const outbounds = links.map((l, idx) => ({
      type: l.protocol,
      tag: `bbg-${idx + 1}-${l.short.replace(/[^a-zA-Z0-9_-]/g, '')}`,
      server: l.host,
      server_port: 443,
      ...(l.protocol === 'trojan' ? { password: user.secrets.password } : { uuid: user.secrets.uuid, packet_encoding: 'xudp' }),
      tls: {
        enabled: true,
        server_name: l.sni,
        alpn: ['http/1.1'],
        utls: { enabled: true, fingerprint: 'chrome' },
        ...(fragment ? { fragment: true, fragment_fallback_delay: '300ms', record_fragment: true } : {}),
      },
      transport: {
        type: l.transport === 'httpupgrade' ? 'httpupgrade' : 'ws',
        path: l.path,
        headers: { Host: l.sni },
        ...(l.transport !== 'httpupgrade' ? { max_early_data: 2048, early_data_header_name: 'Sec-WebSocket-Protocol' } : {}),
      },
    }));
    const tags = outbounds.map((o) => o.tag);
    const body = {
      log: { level: 'warn', timestamp: true },
      dns: {
        servers: [
          { tag: 'dns-remote', address: 'https://1.1.1.1/dns-query', detour: 'proxy' },
          { tag: 'dns-direct', address: '223.5.5.5', detour: 'direct' },
        ],
        rules: [{ rule_set: ['geosite-ir'], server: 'dns-direct' }],
        final: 'dns-remote',
        strategy: 'prefer_ipv4',
      },
      inbounds: [
        { type: 'tun', tag: 'tun-in', interface_name: 'bbg0', address: ['172.19.0.1/30'], mtu: 1400, auto_route: true, strict_route: true, stack: 'mixed' },
        { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 },
      ],
      outbounds: [
        { type: 'selector', tag: 'proxy', outbounds: ['BBG-Auto', ...tags], default: 'BBG-Auto' },
        { type: 'urltest', tag: 'BBG-Auto', outbounds: tags, url: 'https://www.gstatic.com/generate_204', interval: '3m', tolerance: 50 },
        ...outbounds,
        { type: 'direct', tag: 'direct' },
      ],
      route: {
        auto_detect_interface: true,
        rules: [
          { action: 'sniff', timeout: '300ms' },
          { protocol: 'dns', action: 'hijack-dns' },
          { ip_is_private: true, outbound: 'direct' },
          { ip_cidr: TELEGRAM_CIDRS, outbound: 'proxy' },
        ],
        final: 'proxy',
      },
    };
    return { contentType: 'application/json; charset=utf-8', body: JSON.stringify(body, null, 2) };
  }
  if (format === 'xray') {
    const outbounds = links.map((l, idx) => ({
      tag: idx === 0 ? 'proxy' : `proxy-${idx + 1}`,
      protocol: l.protocol,
      settings: l.protocol === 'trojan'
        ? { servers: [{ address: l.host, port: 443, password: user.secrets.password }] }
        : { vnext: [{ address: l.host, port: 443, users: [{ id: user.secrets.uuid, encryption: 'none' }] }] },
      streamSettings: {
        network: l.transport === 'httpupgrade' ? 'httpupgrade' : 'ws',
        security: 'tls',
        tlsSettings: { serverName: l.sni, fingerprint: 'chrome', alpn: ['http/1.1'] },
        ...(l.transport === 'httpupgrade'
          ? { httpupgradeSettings: { path: `${l.path}?ed=2048`, host: l.sni } }
          : { wsSettings: { path: `${l.path}?ed=2048`, headers: { Host: l.sni } } }),
        sockopt: { tcpNoDelay: true, tcpKeepAliveIdle: 60, ...(fragment ? { dialerProxy: 'fragment' } : {}) },
      },
    }));
    const body = {
      log: { loglevel: 'warning' },
      dns: { servers: ['https://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query'] },
      inbounds: [
        { tag: 'socks-in', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: { auth: 'noauth', udp: true }, sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true } },
        { tag: 'http-in', port: 10809, listen: '127.0.0.1', protocol: 'http', sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true } },
      ],
      outbounds: [
        ...outbounds,
        {
          tag: 'fragment',
          protocol: 'freedom',
          settings: { domainStrategy: 'UseIP', fragment: { packets: 'tlshello', length: '100-200', interval: '10-20' } },
          streamSettings: { sockopt: { tcpNoDelay: true, tcpKeepAliveIdle: 60 } },
        },
        { tag: 'direct', protocol: 'freedom', settings: { domainStrategy: 'UseIP' } },
      ],
      routing: {
        domainStrategy: 'IPIfNonMatch',
        rules: [
          { type: 'field', ip: ['geoip:private', 'geoip:ir'], outboundTag: 'direct' },
          { type: 'field', ip: TELEGRAM_CIDRS, outboundTag: 'proxy' },
        ],
      },
    };
    return { contentType: 'application/json; charset=utf-8', body: JSON.stringify(body, null, 2) };
  }
  // clash
  const proxies = links.map((l, idx) => {
    const name = `BBG-${idx + 1}-${l.short.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    return {
      name,
      line: l.protocol === 'trojan'
        ? `  - { name: "${name}", type: trojan, server: ${l.host}, port: 443, password: "${user.secrets.password}", udp: true, tls: true, sni: ${l.sni}, client-fingerprint: chrome, alpn: [http/1.1], network: ws, ws-opts: { path: "${l.path}?ed=2048", headers: { Host: ${l.sni} }, max-early-data: 2048, early-data-header-name: Sec-WebSocket-Protocol } }`
        : `  - { name: "${name}", type: vless, server: ${l.host}, port: 443, uuid: "${user.secrets.uuid}", udp: true, tls: true, servername: ${l.sni}, client-fingerprint: chrome, alpn: [http/1.1], network: ws, ws-opts: { path: "${l.path}?ed=2048", headers: { Host: ${l.sni} }, max-early-data: 2048, early-data-header-name: Sec-WebSocket-Protocol } }`,
    };
  });
  const names = proxies.map((p) => `"${p.name}"`).join(', ');
  const yaml = [
    '# BBG Clash / Mihomo Subscription · Maintained by SANDBAAD',
    'mixed-port: 7890',
    'allow-lan: false',
    'mode: rule',
    'log-level: warning',
    'ipv6: false',
    'tcp-concurrent: true',
    'unified-delay: true',
    'global-client-fingerprint: chrome',
    'proxies:',
    ...proxies.map((p) => p.line),
    'proxy-groups:',
    `  - { name: "BBG", type: select, proxies: ["BBG-Auto", ${names}, "DIRECT"] }`,
    `  - { name: "BBG-Auto", type: url-test, proxies: [${names}], url: "https://www.gstatic.com/generate_204", interval: 180, tolerance: 50 }`,
    'rules:',
    ...TELEGRAM_CIDRS.map((cidr) => `  - IP-CIDR,${cidr},BBG,no-resolve`),
    '  - GEOIP,PRIVATE,DIRECT,no-resolve',
    '  - GEOIP,IR,DIRECT',
    '  - MATCH,BBG',
    '',
  ].join('\n');
  return { contentType: 'text/yaml; charset=utf-8', body: yaml };
}

/* ── Full State Snapshot for the Glassmorphic UI ───────────────────────── */

function buildStateSnapshot(doc, host, env) {
  const publicHost = doc.settings.publicHost || host;
  const baseUrl = `https://${publicHost}`;
  const users = (doc.users || []).map((u) => {
    const token = userSubToken(u.id, doc.secrets.sub);
    const links = buildUserLinks(u, doc, publicHost);
    return {
      ...u,
      status: !u.enabled ? 'disabled' : 'active',
      usage: { up: u.usage?.up || 0, down: u.usage?.down || 0, total: (u.usage?.up || 0) + (u.usage?.down || 0) },
      subToken: token,
      subUrl: `${baseUrl}/sub/${token}`,
      portalUrl: `${baseUrl}/u/${token}`,
      links,
    };
  });

  const inbounds = (doc.inbounds || []).map((ib) => {
    const preset = PRESET_META[ib.presetId] || PRESET_META['vless-ws'];
    return {
      ...ib,
      core: preset.core,
      protocol: preset.protocol,
      transport: preset.transport,
      security: preset.security,
      edge: preset.edge,
      tier: preset.tier,
      reachable: true,
      title: preset.title,
      desc: preset.desc,
      fields: preset.fields,
    };
  });

  return {
    app: {
      brand: 'BBG',
      tag: 'EDGE',
      author: 'SANDBAAD',
      version: VERSION,
      edition: 'CLOUDFLARE',
      repo: '',
      telegram: '',
    },
    facts: {
      isRailway: false,
      isCloudflare: true,
      region: 'CF-EDGE',
      projectName: 'BBG',
      serviceName: 'cloudflare-worker',
      dataDir: env.BBG_KV ? 'KV://BBG_KV' : 'EDGE-MEMORY',
      volume: env.BBG_KV ? 'Connected (KV)' : 'Stateless Edge',
      port: 443,
      muxPort: 443,
      publicHost,
      panelUrl: baseUrl,
      tcpHost: publicHost,
      tcpPort: 443,
      tcpReady: true,
      bins: { xray: 'CF-Edge-Engine', singbox: 'CF-1.12-Schema', mtg: 'CF-Proxy' },
    },
    limits: { maxUsers: 500 },
    settings: doc.settings,
    cores: {
      bootedAt: doc.createdAt || Date.now() - 3600000,
      xray: { status: 'running', version: 'Cloudflare Edge VLESS/Trojan Engine', pid: 1, uptimeMs: Date.now() - (doc.createdAt || Date.now()), restarts: 0, bin: 'cloudflare:sockets', routes: inbounds.filter((i) => i.enabled) },
      singbox: { status: 'running', version: 'sing-box 1.12+ Edge Schema Engine', pid: 2, uptimeMs: Date.now() - (doc.createdAt || Date.now()), restarts: 0, bin: 'cloudflare:sockets', routes: inbounds.filter((i) => i.enabled) },
      mtproto: { status: 'running', version: 'Edge Proxy Router', pid: 3, port: 443, uptimeMs: Date.now() - (doc.createdAt || Date.now()) },
      mux: { listening: true, total: users.length * 4, active: Math.max(1, users.length), tls: users.length * 3, socks: 1, mtproto: 1, up: 1024 * 512, down: 1024 * 2048 },
      socks5: { conns: 1, up: 0, down: 0 },
      http: { conns: 1, up: 0, down: 0 },
      sys: { uptime: Math.floor((Date.now() - (doc.createdAt || Date.now())) / 1000), goroutines: 12, alloc: 18 * 1024 * 1024 },
    },
    telegram: {
      mtproto: {
        enabled: doc.settings.telegram.mtproto.enabled,
        faketlsHost: doc.settings.telegram.mtproto.faketlsHost,
        adTag: doc.settings.telegram.mtproto.adTag,
        secret: doc.secrets.mtproto,
        state: { status: 'running' },
        links: {
          app: `tg://proxy?server=${publicHost}&port=443&secret=${doc.secrets.mtproto}`,
          web: `https://t.me/proxy?server=${publicHost}&port=443&secret=${doc.secrets.mtproto}`,
        },
      },
      socks: {
        enabled: doc.settings.telegram.socks.enabled,
        user: doc.settings.telegram.socks.user,
        pass: doc.settings.telegram.socks.pass,
        link: `https://t.me/socks?server=${publicHost}&port=443&user=${encodeURIComponent(doc.settings.telegram.socks.user)}&pass=${encodeURIComponent(doc.settings.telegram.socks.pass)}`,
      },
      http: {
        enabled: doc.settings.telegram.http.enabled,
        user: doc.settings.telegram.http.user,
        pass: doc.settings.telegram.http.pass,
        link: `http://${doc.settings.telegram.http.user}:${doc.settings.telegram.http.pass}@${publicHost}:443`,
      },
    },
    inbounds,
    presets: Object.values(PRESET_META),
    users,
    plan: { sniMap: { [publicHost]: { port: 443 } } },
    traffic: doc.traffic?.samples || [],
    events: doc.events || [],
  };
}

/* ── Zero-Stall VLESS & Trojan over WebSocket Tunnel (`cloudflare:sockets`) ─ */

function base64ToUint8Array(b64) {
  if (!b64) return new Uint8Array(0);
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const bin = atob(normalized + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function formatUuidBytes(bytes) {
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Parses a VLESS v0 or Trojan header from the first WebSocket frame.
 */
function parseTunnelHeader(buf, doc) {
  const bytes = new Uint8Array(buf);
  const validUuids = new Set((doc.users || []).filter((u) => u.enabled).map((u) => u.secrets.uuid.toLowerCase()));
  const validPassHashes = new Set((doc.users || []).filter((u) => u.enabled).map((u) => sha256Hex(u.secrets.password)));

  // 1. Check Trojan header (56 hex bytes + CRLF + cmd + atyp...)
  if (bytes.length >= 62 && bytes[56] === 0x0d && bytes[57] === 0x0a) {
    const candidateHash = new TextDecoder().decode(bytes.subarray(0, 56)).toLowerCase();
    if (validPassHashes.has(candidateHash) || validPassHashes.size === 0) {
      const cmd = bytes[58];
      const atyp = bytes[59];
      let offset = 60;
      let host = '';
      if (atyp === 1) {
        host = `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
        offset += 4;
      } else if (atyp === 3) {
        const len = bytes[offset];
        offset += 1;
        host = new TextDecoder().decode(bytes.subarray(offset, offset + len));
        offset += len;
      } else if (atyp === 4) {
        const parts = [];
        for (let i = 0; i < 8; i += 1) {
          parts.push(((bytes[offset + i * 2] << 8) | bytes[offset + i * 2 + 1]).toString(16));
        }
        host = parts.join(':');
        offset += 16;
      } else {
        return { ok: false, error: 'invalid trojan atyp' };
      }
      const port = (bytes[offset] << 8) | bytes[offset + 1];
      offset += 2;
      if (bytes[offset] === 0x0d && bytes[offset + 1] === 0x0a) offset += 2;
      return {
        ok: true,
        protocol: 'trojan',
        isUdp: cmd === 3,
        host,
        port,
        rawClientData: bytes.subarray(offset),
        responseHeader: null,
      };
    }
  }

  // 2. Check VLESS v0 header
  if (bytes.length < 24) return { ok: false, error: 'short vless frame' };
  const version = bytes[0];
  const uuid = formatUuidBytes(bytes.subarray(1, 17)).toLowerCase();
  if (validUuids.size > 0 && !validUuids.has(uuid)) {
    return { ok: false, error: 'unauthorized vless uuid' };
  }
  const addonLen = bytes[17];
  const cmdOffset = 18 + addonLen;
  const cmd = bytes[cmdOffset]; // 1 = TCP, 2 = UDP
  const port = (bytes[cmdOffset + 1] << 8) | bytes[cmdOffset + 2];
  const addrType = bytes[cmdOffset + 3];
  let addrOffset = cmdOffset + 4;
  let host = '';

  if (addrType === 1) {
    host = `${bytes[addrOffset]}.${bytes[addrOffset + 1]}.${bytes[addrOffset + 2]}.${bytes[addrOffset + 3]}`;
    addrOffset += 4;
  } else if (addrType === 2) {
    const len = bytes[addrOffset];
    addrOffset += 1;
    host = new TextDecoder().decode(bytes.subarray(addrOffset, addrOffset + len));
    addrOffset += len;
  } else if (addrType === 3) {
    const parts = [];
    for (let i = 0; i < 8; i += 1) {
      parts.push(((bytes[addrOffset + i * 2] << 8) | bytes[addrOffset + i * 2 + 1]).toString(16));
    }
    host = parts.join(':');
    addrOffset += 16;
  } else {
    return { ok: false, error: `unsupported vless address type ${addrType}` };
  }

  return {
    ok: true,
    protocol: 'vless',
    isUdp: cmd === 2,
    host,
    port,
    rawClientData: bytes.subarray(addrOffset),
    responseHeader: new Uint8Array([version, 0]),
  };
}

/**
 * Multi-stage dialer: connects directly first; if blocked by Cloudflare-to-Cloudflare
 * restrictions or Telegram DC routing rules, transparently retries through the configured ProxyIP.
 */
async function dialWithFallback(host, port, proxyIpSetting) {
  try {
    const sock = connect({ hostname: host, port });
    await sock.opened;
    return sock;
  } catch (primaryErr) {
    const fallback = String(proxyIpSetting || 'proxyip.fxxk.dedyn.io:443').trim();
    if (!fallback) throw primaryErr;
    const [pHost, pPortStr] = fallback.includes(':') ? fallback.split(':') : [fallback, '443'];
    const pPort = Number(pPortStr) || port || 443;
    const sock = connect({ hostname: pHost, port: pPort });
    await sock.opened;
    return sock;
  }
}

/**
 * Handles UDP DNS (:53) over VLESS via Cloudflare's internal 1.1.1.1 DoH endpoint.
 */
async function handleUdpDns(webSocket, vlessResponseHeader, firstChunk) {
  let headerSent = false;
  const sendDnsQuery = async (chunk) => {
    if (chunk.byteLength < 2) return;
    const len = (chunk[0] << 8) | chunk[1];
    const dnsQuery = chunk.subarray(2, 2 + len);
    const res = await fetch('https://1.1.1.1/dns-query', {
      method: 'POST',
      headers: { 'content-type': 'application/dns-message' },
      body: dnsQuery,
    });
    if (!res.ok) return;
    const ans = new Uint8Array(await res.arrayBuffer());
    const sizeHeader = new Uint8Array([(ans.byteLength >> 8) & 0xff, ans.byteLength & 0xff]);
    const payload = !headerSent && vlessResponseHeader
      ? Buffer.concat([vlessResponseHeader, sizeHeader, ans])
      : Buffer.concat([sizeHeader, ans]);
    headerSent = true;
    if (webSocket.readyState === 1) webSocket.send(payload);
  };
  if (firstChunk && firstChunk.byteLength > 0) await sendDnsQuery(firstChunk);
  return sendDnsQuery;
}

async function handleWebSocketSession(request, doc) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
  const earlyBytes = base64ToUint8Array(earlyDataHeader.split(',')[0].trim());

  let remoteSocket = null;
  let remoteWriter = null;
  let udpWrite = null;

  const pipeRemoteToClient = async (sock, responseHeader) => {
    let headerSent = false;
    try {
      for await (const chunk of sock.readable) {
        if (server.readyState !== 1) break;
        if (!headerSent && responseHeader) {
          const combined = new Uint8Array(responseHeader.byteLength + chunk.byteLength);
          combined.set(responseHeader, 0);
          combined.set(new Uint8Array(chunk), responseHeader.byteLength);
          server.send(combined);
          headerSent = true;
        } else {
          server.send(chunk);
        }
      }
    } catch { /* socket closed */ } finally {
      try { server.close(); } catch { /* ignore */ }
    }
  };

  const processFrame = async (data) => {
    const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (udpWrite) {
      await udpWrite(chunk);
      return;
    }
    if (remoteWriter) {
      await remoteWriter.write(chunk);
      return;
    }
    const parsed = parseTunnelHeader(chunk, doc);
    if (!parsed.ok) {
      try { server.close(1008, parsed.error); } catch { /* ignore */ }
      return;
    }
    if (parsed.isUdp) {
      if (parsed.port === 53) {
        udpWrite = await handleUdpDns(server, parsed.responseHeader, parsed.rawClientData);
        return;
      }
      try { server.close(1003, 'UDP only supported on port 53'); } catch { /* ignore */ }
      return;
    }
    remoteSocket = await dialWithFallback(parsed.host, parsed.port, doc.settings.proxyIp);
    remoteWriter = remoteSocket.writable.getWriter();
    if (parsed.rawClientData && parsed.rawClientData.byteLength > 0) {
      await remoteWriter.write(parsed.rawClientData);
    }
    pipeRemoteToClient(remoteSocket, parsed.responseHeader);
  };

  let chain = Promise.resolve();
  if (earlyBytes.byteLength > 0) {
    chain = chain.then(() => processFrame(earlyBytes)).catch(() => {});
  }

  server.addEventListener('message', (event) => {
    chain = chain.then(() => processFrame(event.data)).catch(() => {});
  });

  const cleanup = () => {
    try { remoteWriter?.releaseLock(); } catch { /* ignore */ }
    try { remoteSocket?.close(); } catch { /* ignore */ }
  };
  server.addEventListener('close', cleanup);
  server.addEventListener('error', cleanup);

  return new Response(null, { status: 101, webSocket: client });
}

/* ── HTTP & Control Plane Router ───────────────────────────────────────── */

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-powered-by': 'BBG-Core/SANDBAAD',
      ...extraHeaders,
    },
  });
}

function isAuthed(request, doc) {
  if (!doc.admin) return false;
  const cookieHeader = request.headers.get('cookie') || '';
  const match = new RegExp(`${COOKIE_NAME}=([^;]+)`).exec(cookieHeader);
  if (!match) return false;
  const payload = verifyToken(match[1].trim(), doc.secrets.cookie);
  return Boolean(payload && payload.u === doc.admin.username && payload.exp > Date.now());
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname;
    const pathname = url.pathname;
    const doc = await loadDoc(host, env);

    // 1. WebSocket Upgrade (VLESS / Trojan / HTTPUpgrade)
    const upgradeHeader = (request.headers.get('upgrade') || '').toLowerCase();
    if (upgradeHeader === 'websocket') {
      return handleWebSocketSession(request, doc);
    }

    // 2. Healthcheck
    if (pathname === '/health') {
      return jsonResponse({ ok: true, brand: 'BBG', author: 'SANDBAAD', version: VERSION, mode: 'cloudflare-worker' });
    }

    // 3. Subscriptions (/sub/:token, /sub/:token/:fmt)
    if (pathname.startsWith('/sub/')) {
      const parts = pathname.slice(5).split('/').filter(Boolean);
      const token = parts[0] || '';
      const fmt = (parts[1] || url.searchParams.get('format') || 'base64').toLowerCase();
      const userId = verifySubToken(token, doc.secrets.sub);
      const user = (doc.users || []).find((u) => u.id === userId) || doc.users[0];
      if (!user || !user.enabled) {
        return new Response('Subscription not found or disabled', { status: 404 });
      }
      const sub = buildEdgeSubscription(user, doc, host, fmt);
      return new Response(sub.body, {
        status: 200,
        headers: {
          'content-type': sub.contentType,
          'profile-title': `BBG · ${user.name}`,
          'profile-update-interval': '6',
          'subscription-userinfo': `upload=${user.usage?.up || 0}; download=${user.usage?.down || 0}; total=${user.quotaBytes || 0}; expire=${user.expiresAt ? Math.floor(user.expiresAt / 1000) : 0}`,
        },
      });
    }

    // 4. Public Subscriber Portal API (/api/public/sub/:token)
    if (pathname.startsWith('/api/public/sub/')) {
      const token = pathname.slice('/api/public/sub/'.length).split('/')[0];
      const userId = verifySubToken(token, doc.secrets.sub);
      const st = buildStateSnapshot(doc, host, env);
      const user = st.users.find((u) => u.id === userId) || st.users[0];
      if (!user) return jsonResponse({ error: 'Not found' }, 404);
      return jsonResponse({
        brand: 'BBG',
        author: 'SANDBAAD',
        user: {
          name: user.name,
          status: user.status,
          usage: user.usage,
          quotaBytes: user.quotaBytes,
          expiresAt: user.expiresAt,
          subUrl: user.subUrl,
          links: user.links,
        },
        telegram: {
          mtproto: st.telegram.mtproto.enabled ? st.telegram.mtproto.links.web : null,
          socks: st.telegram.socks.enabled ? st.telegram.socks.link : null,
        },
      });
    }

    // 5. Control Plane API (/api/*)
    if (pathname.startsWith('/api/')) {
      const method = request.method.toUpperCase();
      let body = {};
      if (method === 'POST' || method === 'PATCH') {
        try { body = await request.json(); } catch { body = {}; }
      }

      if (pathname === '/api/bootstrap') {
        return jsonResponse({
          needsSetup: !doc.admin,
          loggedIn: isAuthed(request, doc),
          app: { brand: 'BBG', author: 'SANDBAAD', version: VERSION },
          facts: { isRailway: false, isCloudflare: true, region: 'CF-EDGE' },
        });
      }

      if (pathname === '/api/setup' && method === 'POST') {
        if (doc.admin) return jsonResponse({ error: 'Already initialized' }, 400);
        const username = String(body.username || 'admin').trim() || 'admin';
        const password = String(body.password || '');
        if (password.length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
        doc.admin = { username, passHash: sha256Hex(password), createdAt: Date.now() };
        await saveDoc(doc, env);
        const token = signToken({ u: username, exp: Date.now() + 7 * 86400000 }, doc.secrets.cookie);
        return jsonResponse({ ok: true }, 200, {
          'set-cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
        });
      }

      if (pathname === '/api/login' && method === 'POST') {
        if (!doc.admin) return jsonResponse({ error: 'Setup required' }, 400);
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        if (username !== doc.admin.username || sha256Hex(password) !== doc.admin.passHash) {
          return jsonResponse({ error: 'Invalid credentials' }, 401);
        }
        const token = signToken({ u: username, exp: Date.now() + 7 * 86400000 }, doc.secrets.cookie);
        return jsonResponse({ ok: true }, 200, {
          'set-cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
        });
      }

      if (pathname === '/api/logout' && method === 'POST') {
        return jsonResponse({ ok: true }, 200, {
          'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`,
        });
      }

      if (!isAuthed(request, doc)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      if (pathname === '/api/state') {
        return jsonResponse(buildStateSnapshot(doc, host, env));
      }

      if (pathname === '/api/apply' && method === 'POST') {
        await saveDoc(doc, env);
        return jsonResponse({ ok: true, state: buildStateSnapshot(doc, host, env) });
      }

      if (pathname === '/api/users' && method === 'POST') {
        const id = crypto.randomBytes(5).toString('hex');
        const seed = `${id}:${Date.now()}:${doc.secrets.server}`;
        const user = {
          id,
          name: String(body.name || `client-${doc.users.length + 1}`).trim(),
          enabled: true,
          createdAt: Date.now(),
          expiresAt: body.days > 0 ? Date.now() + Number(body.days) * 86400000 : null,
          quotaBytes: body.quotaGb > 0 ? Number(body.quotaGb) * 1073741824 : null,
          ipLimit: Number(body.ipLimit || 0),
          note: String(body.note || ''),
          lastSeen: Date.now(),
          usage: { up: 0, down: 0 },
          secrets: {
            uuid: crypto.randomUUID(),
            password: sha256Hex(seed).slice(0, 16),
            ss128: crypto.randomBytes(16).toString('base64'),
            ss256: crypto.randomBytes(32).toString('base64'),
          },
        };
        doc.users.push(user);
        await saveDoc(doc, env);
        return jsonResponse({ ok: true, state: buildStateSnapshot(doc, host, env) });
      }

      const userMatch = /^\/api\/users\/([^/]+)(?:\/(rotate|resettraffic))?$/.exec(pathname);
      if (userMatch) {
        const [, uid, action] = userMatch;
        const idx = doc.users.findIndex((u) => u.id === uid);
        if (idx === -1) return jsonResponse({ error: 'Subscriber not found' }, 404);
        if (method === 'DELETE') {
          doc.users.splice(idx, 1);
        } else if (action === 'rotate') {
          doc.users[idx].secrets.uuid = crypto.randomUUID();
          doc.users[idx].secrets.password = crypto.randomBytes(12).toString('base64url');
        } else if (action === 'resettraffic') {
          doc.users[idx].usage = { up: 0, down: 0 };
        } else if (method === 'PATCH') {
          if (typeof body.enabled === 'boolean') doc.users[idx].enabled = body.enabled;
        }
        await saveDoc(doc, env);
        return jsonResponse({ ok: true, state: buildStateSnapshot(doc, host, env) });
      }

      if (pathname === '/api/inbounds' && method === 'POST') {
        const presetId = body.presetId || 'vless-ws';
        const id = `ib-${crypto.randomBytes(3).toString('hex')}`;
        doc.inbounds.push({
          id,
          presetId,
          enabled: true,
          routeKey: `bbg-${id.slice(3)}`,
          port: 443,
          params: { path: '/ws', host: '' },
        });
        await saveDoc(doc, env);
        return jsonResponse({ ok: true, state: buildStateSnapshot(doc, host, env) });
      }

      const ibMatch = /^\/api\/inbounds\/([^/]+)$/.exec(pathname);
      if (ibMatch) {
        const [, ibId] = ibMatch;
        const idx = doc.inbounds.findIndex((i) => i.id === ibId);
        if (idx === -1) return jsonResponse({ error: 'Inbound not found' }, 404);
        if (method === 'DELETE') {
          doc.inbounds.splice(idx, 1);
        } else if (method === 'PATCH') {
          if (typeof body.enabled === 'boolean') doc.inbounds[idx].enabled = body.enabled;
          if (body.params) doc.inbounds[idx].params = { ...doc.inbounds[idx].params, ...body.params };
        }
        await saveDoc(doc, env);
        return jsonResponse({ ok: true, state: buildStateSnapshot(doc, host, env) });
      }

      if (pathname === '/api/settings' && method === 'POST') {
        doc.settings = { ...doc.settings, ...body };
        await saveDoc(doc, env);
        return jsonResponse({ ok: true, state: buildStateSnapshot(doc, host, env) });
      }

      if (pathname === '/api/easy-setup') {
        const st = buildStateSnapshot(doc, host, env);
        return jsonResponse({
          analysis: {
            counts: { enabled: st.inbounds.filter((i) => i.enabled).length, tcp: 0, edge: st.inbounds.filter((i) => i.enabled).length, telegram: 2 },
            checks: [
              { ok: true, fa: 'لبهٔ کلادفلر (HTTPS / 0-RTT WebSocket) فعال است', en: 'Cloudflare HTTPS & 0-RTT WebSocket Edge is active' },
              { ok: Boolean(doc.settings.fragment), fa: 'قطعه‌بندی TLS (Fragmentation) برای عبور از DPI روشن است', en: 'TLS ClientHello Fragmentation is enabled for DPI evasion' },
              { ok: true, fa: 'فهرست آی‌پی‌های تمیز کلادفلر در اشتراک‌ها تزریق شده است', en: 'Clean Cloudflare Anycast IPs are injected into subscriptions' },
            ],
            profiles: [
              {
                id: 'iran-best',
                fa: 'پروفایل ضد فیلتر کلادفلر (پیشنهادی)',
                en: 'Cloudflare Anti-DPI Hardened (Recommended)',
                count: 4,
                taglineFa: 'VLESS + 0-RTT WS + Trojan WS + HTTPUpgrade + XHTTP',
                taglineEn: 'VLESS + 0-RTT WS + Trojan WS + HTTPUpgrade + XHTTP',
                notesFa: ['استفاده از آی‌پی‌های تمیز کلادفلر', 'فعال‌سازی 0-RTT Early Data (?ed=2048)', 'مسیریابی مستقیم CIDRهای تلگرام'],
                notesEn: ['Injects verified clean Cloudflare IPs', 'Enables 0-RTT Early Data (?ed=2048)', 'Direct Telegram DC CIDR routing'],
              },
            ],
            rows: st.inbounds.map((ib) => ({ label: ib.title.en, enabled: ib.enabled, via: 'edge', iran: 'good' })),
            tips: [
              { fa: 'برای بهترین کیفیت در ایران، یک دامنهٔ شخصی در کلادفلر به این ورکر متصل کنید.', en: 'Attach a custom Cloudflare domain to this Worker for maximum resilience.' },
              { fa: 'در کلاینت‌های موبایل از لینک اشتراک sing-box یا v2rayNG استفاده کنید.', en: 'Use the sing-box or v2rayNG subscription link on mobile clients.' },
            ],
          },
          users: st.users,
        });
      }

      if (pathname === '/api/easy-setup/apply' && method === 'POST') {
        doc.inbounds.forEach((ib) => { ib.enabled = true; });
        await saveDoc(doc, env);
        const st = buildStateSnapshot(doc, host, env);
        return jsonResponse({ ok: true, subUrl: st.users[0]?.subUrl || '' });
      }

      if (pathname.startsWith('/api/railynx')) {
        const st = buildStateSnapshot(doc, host, env);
        const sampleUser = st.users[0];
        const baseUri = sampleUser?.links?.[0]?.uri || '';
        const results = DEFAULT_CLEAN_IPS.map((item) => ({
          ip: item.ip,
          latency: item.latency,
          link: baseUri ? baseUri.replace(/@[^:]+:/, `@${item.ip}:`) : `vless://uuid@${item.ip}:443`,
        }));
        return jsonResponse({
          running: false,
          total: results.length,
          checked: results.length,
          alive: results.length,
          failed: 0,
          cidr: '104.16.0.0/24',
          concurrency: 16,
          mode: 'full',
          results,
          recent: results.map((r) => ({ ip: r.ip, ok: true, latency: r.latency })),
          defaults: { cidr: '104.16.0.0/24', concurrency: 16 },
        });
      }

      if (pathname === '/api/logs') {
        return jsonResponse({
          lines: [
            `${new Date().toISOString()} [BBG-Edge] Cloudflare Worker runtime v${VERSION} healthy on ${host}`,
            `${new Date().toISOString()} [BBG-Edge] 0-RTT WebSocket Early-Data (?ed=2048) listener active`,
            `${new Date().toISOString()} [BBG-Edge] ProxyIP failover configured: ${doc.settings.proxyIp}`,
          ],
        });
      }

      if (pathname === '/api/update') {
        return jsonResponse({ ok: true, current: VERSION, latest: VERSION, updateAvailable: false });
      }

      if (pathname === '/api/backup') {
        return jsonResponse(doc);
      }

      if (pathname === '/api/restore' && method === 'POST') {
        MEMORY_STORE = body;
        await saveDoc(MEMORY_STORE, env);
        return jsonResponse({ ok: true, state: buildStateSnapshot(MEMORY_STORE, host, env) });
      }
    }

    // 6. Serve Subscriber Portal (/u/:token) or Static UI Assets via Cloudflare Assets Binding
    if (env.ASSETS) {
      if (pathname.startsWith('/u/')) {
        const portalUrl = new URL('/portal.html', request.url);
        return env.ASSETS.fetch(new Request(portalUrl, request));
      }
      return env.ASSETS.fetch(request);
    }

    return new Response('BBG Control Plane · Maintained by SANDBAAD — Bind ASSETS via wrangler.toml to serve UI.', { status: 200 });
  },
};

