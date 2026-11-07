/**
 * BBG · By SANDBAAD — Hardened Multi-Format Subscription Engine
 *
 * Delivers DPI-hardened, low-latency configurations across:
 * - Raw URI list & Base64 (v2rayNG, Streisand, V2Box, NekoBox)
 * - Standardized Xray JSON (with TLS ClientHello Fragmentation, TCP NoDelay,
 *   remote DoH over tunnel, and direct Telegram Data Center CIDR routing)
 * - Modern sing-box 1.10+/1.12+ JSON (with TLS Record Fragmentation, 0-RTT WS
 *   early-data, URLTest auto-failover, and non-blocking 300ms sniffing)
 * - Clash / Mihomo YAML (with tcp-concurrent, unified-delay, 0-RTT WS & TG CIDRs)
 */
import { buildUserLinks } from './links.js';
import { certPin } from './config/certs.js';
import { userTotal } from './store.js';

export const TELEGRAM_CIDRS = [
  '91.108.4.0/22',
  '91.108.8.0/22',
  '91.108.12.0/22',
  '91.108.16.0/22',
  '91.108.20.0/22',
  '91.108.56.0/22',
  '95.161.64.0/20',
  '149.154.160.0/20',
  '185.76.151.0/24',
  '2001:b28:f23d::/48',
  '2001:b28:f23f::/48',
  '2001:67c:4e8::/48',
];

export const PRIVATE_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
];

const SUB_HEADERS = {
  'profile-title': 'BBG · SANDBAAD',
  'profile-update-interval': '6',
};

export function headerSet(brand = 'BBG') {
  return { ...SUB_HEADERS, 'profile-title': `${brand} · SANDBAAD` };
}

/** Days left before the account expires (null when it never expires). */
export function daysLeft(user) {
  if (!user.expiresAt) return null;
  return Math.max(0, Math.ceil((user.expiresAt - Date.now()) / 86_400_000));
}

/** Human summary used by subscriptions, headers and the portal. */
export function usageSummary(user) {
  const used = userTotal(user);
  const total = user.quotaBytes || 0;
  const remaining = total ? Math.max(0, total - used) : null;
  const gb = (bytes) => (bytes / 1024 ** 3).toFixed(2);
  return {
    usedGb: gb(used),
    totalGb: total ? gb(total) : null,
    remainingGb: remaining === null ? null : gb(remaining),
    days: daysLeft(user),
    expires: user.expiresAt ? new Date(user.expiresAt).toISOString().slice(0, 10) : null,
  };
}

export function infoLine(doc, user) {
  const brand = doc?.settings?.brand || 'BBG';
  const u = usageSummary(user);
  const quota = u.totalGb ? `${u.usedGb}GB / ${u.totalGb}GB` : `${u.usedGb}GB / unlimited`;
  const left = u.remainingGb ? `${u.remainingGb} GB` : 'unlimited';
  const days = u.days === null ? 'unlimited' : `${u.days} day(s) left`;
  const exp = u.expires || 'never';
  return [
    `# ${brand} · SANDBAAD · ${user.name}`,
    `# traffic ${quota} · remaining ${left}`,
    `# valid until ${exp} · ${days}`,
  ].join('\n');
}

export function plainText(doc, user) {
  const links = buildUserLinks(doc, user);
  return [infoLine(doc, user), ...links.map((l) => l.uri)].join('\n');
}

export function base64Sub(doc, user) {
  return Buffer.from(plainText(doc, user), 'utf8').toString('base64');
}

/* ── Xray Hardened Client Config ─────────────────────────────────────── */

function xrayOutbound(link, opts = {}) {
  const c = link.conn;
  const useFragment = opts.fragment !== false && (c.security === 'tls-edge' || c.security === 'tls-self');
  const stream = {
    network: c.transport === 'tcp' ? 'tcp' : c.transport,
    sockopt: {
      tcpFastOpen: true,
      tcpNoDelay: true,
      tcpKeepAliveIdle: 60,
      tcpKeepAliveInterval: 15,
      ...(useFragment ? { dialerProxy: 'fragment' } : {}),
    },
  };

  if (c.security === 'reality') {
    stream.security = 'reality';
    stream.realitySettings = {
      serverName: c.sni,
      fingerprint: c.fingerprint || 'chrome',
      publicKey: c.publicKey,
      shortId: c.shortId,
      spiderX: '/',
    };
  } else if (c.security === 'tls-edge' || c.security === 'tls-self') {
    stream.security = 'tls';
    stream.tlsSettings = {
      serverName: c.sni,
      fingerprint: c.fingerprint || 'chrome',
      alpn: c.security === 'tls-edge' ? String(c.alpn || 'http/1.1').split(',') : ['h2', 'http/1.1'],
    };
    if (c.security === 'tls-self') {
      const pin = certPin();
      if (pin) stream.tlsSettings.pinnedPeerCertSha256 = pin;
      else stream.tlsSettings.allowInsecure = true;
    }
  } else {
    stream.security = 'none';
  }

  if (c.transport === 'ws') {
    stream.wsSettings = {
      path: c.path,
      headers: { Host: c.hostHeader },
      heartbeatPeriod: 15,
    };
  } else if (c.transport === 'httpupgrade') {
    stream.httpupgradeSettings = { path: c.rawPath || c.path, host: c.hostHeader };
  } else if (c.transport === 'xhttp') {
    stream.xhttpSettings = {
      path: c.rawPath || c.path,
      host: c.hostHeader,
      mode: c.extra?.mode || 'auto',
      extra: {
        xPaddingBytes: '100-1000',
        noGRPCHeader: false,
      },
    };
  } else if (c.transport === 'grpc') {
    stream.grpcSettings = {
      serviceName: c.serviceName,
      multiMode: true,
      idle_timeout: 60,
      health_check_timeout: 20,
    };
  }

  const tag = link.label;
  if (c.protocol === 'vless') {
    return {
      tag,
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: c.host,
            port: Number(c.port),
            users: [{ id: link.uuid, encryption: 'none', flow: c.flow && c.security === 'reality' ? c.flow : '' }],
          },
        ],
      },
      streamSettings: stream,
    };
  }
  if (c.protocol === 'trojan') {
    return {
      tag,
      protocol: 'trojan',
      settings: { servers: [{ address: c.host, port: Number(c.port), password: link.password }] },
      streamSettings: stream,
    };
  }
  if (c.protocol === 'shadowsocks') {
    return {
      tag,
      protocol: 'shadowsocks',
      settings: {
        servers: [{ address: c.host, port: Number(c.port), method: c.extra.method, password: c.ssPassword, uot: true }],
      },
      streamSettings: {
        sockopt: { tcpFastOpen: true, tcpNoDelay: true, tcpKeepAliveInterval: 15 },
      },
    };
  }
  if (c.protocol === 'vmess') {
    stream.network = c.transport;
    return {
      tag,
      protocol: 'vmess',
      settings: {
        vnext: [
          {
            address: c.host,
            port: Number(c.port),
            users: [{ id: link.uuid, alterId: 0, security: 'auto' }],
          },
        ],
      },
      streamSettings: stream,
    };
  }
  return null;
}

export function xrayJson(doc, user) {
  const links = buildUserLinks(doc, user).filter((l) =>
    ['vless', 'vmess', 'trojan', 'shadowsocks'].includes(l.protocol),
  );
  const useFragment = doc.settings?.fragment !== false;
  const outbounds = [];

  for (const link of links) {
    const ob = xrayOutbound(
      { ...link, uuid: user.secrets.uuid, password: user.secrets.password },
      { fragment: useFragment },
    );
    if (ob) outbounds.push(ob);
  }

  const primaryTag = outbounds[0]?.tag || 'direct';

  if (useFragment) {
    outbounds.push({
      tag: 'fragment',
      protocol: 'freedom',
      settings: {
        domainStrategy: 'UseIP',
        fragment: {
          packets: 'tlshello',
          length: '100-200',
          interval: '10-20',
        },
      },
      streamSettings: {
        sockopt: {
          tcpNoDelay: true,
          tcpFastOpen: true,
          tcpKeepAliveIdle: 100,
        },
      },
    });
  }

  outbounds.push({
    tag: 'direct',
    protocol: 'freedom',
    settings: { domainStrategy: 'UseIP' },
    streamSettings: { sockopt: { tcpNoDelay: true } },
  });
  outbounds.push({ tag: 'block', protocol: 'blackhole', settings: {} });

  const brand = doc.settings?.brand || 'BBG';
  return {
    remarks: `${brand} · SANDBAAD · ${user.name}`,
    log: { loglevel: 'warning' },
    dns: {
      // Remote DoH routed over the proxy tunnel (NOT +local, which blackholes on censored ISPs)
      servers: [
        'https://1.1.1.1/dns-query',
        'https://8.8.8.8/dns-query',
        { address: '1.1.1.1', port: 53, domains: ['domain:ir'] },
        'localhost',
      ],
      queryStrategy: 'UseIPv4',
    },
    inbounds: [
      {
        tag: 'socks',
        port: 10808,
        listen: '127.0.0.1',
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true },
      },
      {
        tag: 'http',
        port: 10809,
        listen: '127.0.0.1',
        protocol: 'http',
        settings: {},
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true },
      },
    ],
    outbounds,
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        { type: 'field', ip: PRIVATE_CIDRS, outboundTag: 'direct' },
        { type: 'field', domain: ['domain:ir'], outboundTag: 'direct' },
        // Route Telegram Data Center CIDRs immediately through proxy without DNS stalls
        { type: 'field', ip: TELEGRAM_CIDRS, outboundTag: primaryTag },
        { type: 'field', network: 'tcp,udp', outboundTag: primaryTag },
      ],
    },
  };
}

/* ── sing-box 1.10+ / 1.12+ Hardened Client Config ───────────────────── */

function singboxOutbound(link, user, opts = {}) {
  const c = link.conn;
  const tlsFrag = () =>
    opts.fragment === false
      ? {}
      : {
          fragment: true,
          record_fragment: true,
        };
  const tls = (insecure = false) => {
    if (c.security === 'reality') {
      return {
        enabled: true,
        server_name: c.sni,
        utls: { enabled: true, fingerprint: c.fingerprint || 'chrome' },
        reality: { enabled: true, public_key: c.publicKey, short_id: c.shortId },
      };
    }
    return {
      enabled: true,
      server_name: c.sni,
      insecure: insecure || c.security === 'tls-self',
      utls: { enabled: true, fingerprint: c.fingerprint || 'chrome' },
      ...(c.security === 'tls-edge' ? { alpn: String(c.alpn || 'http/1.1').split(',') } : {}),
      ...tlsFrag(),
    };
  };
  const base = {
    tag: link.label,
    server: c.host,
    server_port: Number(c.port),
    tcp_fast_open: true,
  };
  const transport = () => {
    if (c.transport === 'ws') {
      return {
        type: 'ws',
        path: c.rawPath || c.path.split('?')[0],
        headers: { Host: c.hostHeader },
        max_early_data: 2048,
        early_data_header_name: 'Sec-WebSocket-Protocol',
      };
    }
    if (c.transport === 'httpupgrade') {
      return { type: 'httpupgrade', path: c.rawPath || c.path, host: c.hostHeader };
    }
    if (c.transport === 'grpc') {
      return {
        type: 'grpc',
        service_name: c.serviceName,
        idle_timeout: '60s',
        ping_timeout: '15s',
      };
    }
    return undefined;
  };
  switch (c.protocol) {
    case 'vless': {
      const ob = {
        type: 'vless',
        ...base,
        uuid: user.secrets.uuid,
        ...(c.security === 'reality' && c.flow ? { flow: c.flow } : {}),
        packet_encoding: 'xudp',
        tls: c.security === 'none' ? undefined : tls(),
      };
      const t = transport();
      if (t) ob.transport = t;
      return ob;
    }
    case 'vmess': {
      const ob = {
        type: 'vmess',
        ...base,
        uuid: user.secrets.uuid,
        security: 'auto',
        packet_encoding: 'xudp',
        tls: c.security === 'none' ? undefined : tls(),
      };
      const t = transport();
      if (t) ob.transport = t;
      return ob;
    }
    case 'trojan': {
      const ob = { type: 'trojan', ...base, password: user.secrets.password, tls: tls() };
      const t = transport();
      if (t) ob.transport = t;
      return ob;
    }
    case 'shadowsocks':
      return {
        type: 'shadowsocks',
        ...base,
        method: c.extra.method,
        password: c.ssPassword,
        udp_over_tcp: { enabled: true, version: 2 },
      };
    case 'anytls':
      return { type: 'anytls', ...base, password: user.secrets.password, tls: tls(true) };
    case 'hysteria2':
      return {
        type: 'hysteria2',
        ...base,
        password: user.secrets.password,
        tls: { enabled: true, server_name: c.sni, insecure: true, alpn: ['h3'] },
        ...(c.extra.obfs ? { obfs: { type: 'salamander', password: c.extra.obfs } } : {}),
      };
    default:
      return null;
  }
}

export function singboxJson(doc, user) {
  const links = buildUserLinks(doc, user).filter((l) => l.transport !== 'xhttp');
  const nodeOutbounds = links
    .map((l) => singboxOutbound(l, user, doc.settings || {}))
    .filter(Boolean);
  const tags = nodeOutbounds.map((o) => o.tag);
  const groupOutbounds = [];

  if (tags.length > 0) {
    groupOutbounds.push({
      type: 'selector',
      tag: 'BBG · Select',
      outbounds: ['BBG · Auto', ...tags, 'direct'],
      default: 'BBG · Auto',
    });
    groupOutbounds.push({
      type: 'urltest',
      tag: 'BBG · Auto',
      outbounds: tags,
      url: 'https://www.gstatic.com/generate_204',
      interval: '3m',
      tolerance: 50,
    });
  }

  const finalTag = tags.length > 0 ? 'BBG · Select' : 'direct';

  return {
    log: { level: 'warn', timestamp: true },
    dns: {
      servers: [
        {
          type: 'https',
          tag: 'cloudflare',
          server: '1.1.1.1',
          ...(tags.length > 0 ? { detour: finalTag } : {}),
        },
        {
          type: 'https',
          tag: 'google',
          server: '8.8.8.8',
          ...(tags.length > 0 ? { detour: finalTag } : {}),
        },
        { type: 'local', tag: 'local' },
      ],
      rules: [{ domain_suffix: ['.ir'], server: 'local' }],
      final: 'cloudflare',
    },
    inbounds: [
      { type: 'tun', tag: 'tun-in', address: ['172.19.0.1/30'], auto_route: true, strict_route: true, stack: 'mixed' },
      { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 },
    ],
    outbounds: [
      ...groupOutbounds,
      ...nodeOutbounds,
      { type: 'direct', tag: 'direct', tcp_fast_open: true },
      { type: 'block', tag: 'block' },
    ],
    route: {
      rules: [
        { action: 'sniff', timeout: '300ms' },
        { protocol: 'dns', action: 'hijack-dns' },
        { ip_is_private: true, outbound: 'direct' },
        { domain_suffix: ['.ir'], outbound: 'direct' },
        { ip_cidr: TELEGRAM_CIDRS, outbound: finalTag },
        { clash_mode: 'direct', outbound: 'direct' },
        { clash_mode: 'global', outbound: finalTag },
      ],
      final: finalTag,
      auto_detect_interface: true,
      default_domain_resolver: 'local',
    },
    experimental: { cache_file: { enabled: true, path: 'cache.db' } },
  };
}

/* ── Clash / Mihomo Hardened YAML ────────────────────────────────────── */

function yamlStr(value) {
  const s = String(value ?? '');
  if (/^[A-Za-z0-9_.:\/+-]+$/.test(s)) return s;
  return JSON.stringify(s);
}

export function clashYaml(doc, user) {
  const links = buildUserLinks(doc, user).filter((l) => l.transport !== 'xhttp');
  const lines = [];
  const names = [];
  lines.push(
    'port: 7890',
    'socks-port: 7891',
    'allow-lan: false',
    'mode: rule',
    'log-level: warning',
    'unified-delay: true',
    'tcp-concurrent: true',
    'keep-alive-interval: 15',
    '',
  );
  lines.push('proxies:');
  for (const link of links) {
    const c = link.conn;
    const name = link.label;
    const common = [
      `name: ${yamlStr(name)}`,
      `type: ${c.protocol === 'shadowsocks' ? 'ss' : c.protocol}`,
      `server: ${yamlStr(c.host)}`,
      `port: ${c.port}`,
      'tfo: true',
    ];
    let ok = true;
    if (c.protocol === 'vless') {
      common.push(`uuid: ${yamlStr(user.secrets.uuid)}`);
      if (c.flow) common.push(`flow: ${yamlStr(c.flow)}`);
      common.push('udp: true', 'packet-encoding: xudp');
    } else if (c.protocol === 'vmess') {
      common.push(`uuid: ${yamlStr(user.secrets.uuid)}`, 'alterId: 0', 'cipher: auto', 'udp: true');
    } else if (c.protocol === 'trojan') {
      common.push(`password: ${yamlStr(user.secrets.password)}`, 'udp: true');
    } else if (c.protocol === 'shadowsocks') {
      common.push(
        `cipher: ${yamlStr(c.extra.method)}`,
        `password: ${yamlStr(c.ssPassword)}`,
        'udp: true',
        'udp-over-tcp: true',
      );
    } else if (c.protocol === 'anytls') {
      common.push(`password: ${yamlStr(user.secrets.password)}`, 'udp: true');
    } else if (c.protocol === 'hysteria2') {
      common.push(`password: ${yamlStr(user.secrets.password)}`);
    } else {
      ok = false;
    }
    if (!ok) continue;
    if (c.security === 'reality') {
      common.push(
        'tls: true',
        'servername: ' + yamlStr(c.sni),
        'client-fingerprint: ' + yamlStr(c.fingerprint || 'chrome'),
        'reality-opts:',
        '  public-key: ' + yamlStr(c.publicKey),
        '  short-id: ' + yamlStr(c.shortId),
      );
    } else if (c.security !== 'none') {
      common.push(
        'tls: true',
        'servername: ' + yamlStr(c.sni),
        'client-fingerprint: ' + yamlStr(c.fingerprint || 'chrome'),
        'skip-cert-verify: true',
      );
      if (c.security === 'tls-edge') {
        common.push('alpn:', ...String(c.alpn || 'http/1.1').split(',').map((a) => `  - ${a.trim()}`));
      }
    }
    if (c.transport === 'ws') {
      common.push(
        'network: ws',
        'ws-opts:',
        `  path: ${yamlStr(c.rawPath || c.path.split('?')[0])}`,
        '  max-early-data: 2048',
        '  early-data-header-name: Sec-WebSocket-Protocol',
        '  headers:',
        `    Host: ${yamlStr(c.hostHeader)}`,
      );
    } else if (c.transport === 'grpc') {
      common.push('network: grpc', 'grpc-opts:', `  grpc-service-name: ${yamlStr(c.serviceName)}`);
    }
    lines.push('  - ' + common.join('\n    '));
    names.push(name);
  }
  if (!names.length) lines.push('  []');
  lines.push('');
  lines.push('proxy-groups:');
  lines.push('  - name: "BBG"');
  lines.push('    type: select');
  lines.push('    proxies:');
  if (names.length) {
    lines.push('      - "BBG-AUTO"');
    for (const n of names) lines.push(`      - ${yamlStr(n)}`);
  }
  lines.push('      - DIRECT');
  if (names.length) {
    lines.push('  - name: "BBG-AUTO"');
    lines.push('    type: url-test');
    lines.push('    url: https://www.gstatic.com/generate_204');
    lines.push('    interval: 180');
    lines.push('    tolerance: 50');
    lines.push('    proxies:');
    for (const n of names) lines.push(`      - ${yamlStr(n)}`);
  }
  lines.push('');
  lines.push('rules:');
  lines.push('  - GEOIP,PRIVATE,DIRECT,no-resolve');
  lines.push('  - DOMAIN-SUFFIX,ir,DIRECT');
  for (const cidr of TELEGRAM_CIDRS) {
    const ruleType = cidr.includes(':') ? 'IP-CIDR6' : 'IP-CIDR';
    lines.push(`  - ${ruleType},${cidr},BBG,no-resolve`);
  }
  lines.push('  - MATCH,BBG');
  return lines.join('\n') + '\n';
}

export function buildSub(doc, user, format) {
  switch (format) {
    case 'links':
      return { body: plainText(doc, user), type: 'text/plain; charset=utf-8' };
    case 'xray':
      return { body: JSON.stringify(xrayJson(doc, user), null, 2), type: 'application/json; charset=utf-8' };
    case 'singbox':
      return { body: JSON.stringify(singboxJson(doc, user), null, 2), type: 'application/json; charset=utf-8' };
    case 'clash':
      return { body: clashYaml(doc, user), type: 'text/yaml; charset=utf-8' };
    case 'base64':
    default:
      return { body: base64Sub(doc, user), type: 'text/plain; charset=utf-8' };
  }
}
