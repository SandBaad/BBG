/**
 * BBG · By SANDBAAD — Xray-core configuration generator
 *
 * Dynamically builds hardened Xray server configurations with:
 * - `routeOnly: true` sniffing (prevents FakeTLS/Telegram IP hijacking)
 * - TCP NoDelay, FastOpen, and aggressive keep-alive tuning
 * - XHTTP randomized padding and tuned gRPC/WS stream parameters
 */
import { effectiveEnabled } from '../store.js';
import { ssServerKey, legacySsPassword } from './shared.js';
import { describeInbound, edgePath, edgeServiceName } from '../catalog.js';

export const XRAY_API_PORT = 10085;
/** Loopback VLESS inbound that sing-box forwards each user's traffic into, so Xray's per-user stats cover sing-box protocols too. */
export const ACCOUNTING_PORT = 10087;

const PRIVATE_NETS = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
  '192.0.0.0/24', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4', '::/128', '::1/128', 'fc00::/7', 'fe80::/10',
];

/** REALITY shortIds must be even-length lowercase hex (max 16 chars). */
export function normalizeShortIds(raw) {
  const list = String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[0-9a-f]{2,16}$/.test(s) && s.length % 2 === 0);
  return list.length ? list : ['a1b2c3d4'];
}

function clientEmail(user) {
  return `u-${user.id}`;
}

function streamSettings(ib, ctx) {
  const params = ib.params || {};
  const sec = ib.security;
  const stream = {
    network: ib.transport === 'tcp' ? 'tcp' : ib.transport,
    sockopt: {
      tcpFastOpen: true,
      tcpNoDelay: true,
      tcpKeepAliveInterval: 15,
    },
  };

  const rawPath = ib.edge === 'http' ? edgePath(ib) : params.path || '/';
  const httpPath = rawPath.split('?')[0];

  if (ib.transport === 'ws') {
    stream.wsSettings = {
      path: httpPath,
      headers: params.host ? { Host: params.host } : {},
      heartbeatPeriod: 15,
    };
  } else if (ib.transport === 'httpupgrade') {
    stream.httpupgradeSettings = { path: httpPath, host: params.host || '' };
  } else if (ib.transport === 'xhttp') {
    stream.xhttpSettings = {
      path: httpPath,
      host: params.host || '',
      mode: params.mode || 'auto',
      extra: {
        xPaddingBytes: '100-1000',
        noGRPCHeader: false,
      },
    };
  } else if (ib.transport === 'grpc') {
    stream.grpcSettings = {
      serviceName: ib.edge === 'http' ? edgeServiceName(ib) : params.serviceName || ib.routeKey,
      multiMode: true,
      idle_timeout: 60,
      health_check_timeout: 20,
    };
  }

  if (sec === 'reality') {
    const dest = params.dest || 'www.microsoft.com:443';
    const serverName = params.sni || dest.split(':')[0];
    stream.security = 'reality';
    stream.realitySettings = {
      show: false,
      dest,
      xver: 0,
      serverNames: [serverName],
      privateKey: ctx.reality.privateKey,
      shortIds: normalizeShortIds(params.shortIds),
      ...(params.fingerprint ? { fingerprint: params.fingerprint } : {}),
    };
  } else if (sec === 'tls-self') {
    stream.security = 'tls';
    stream.tlsSettings = {
      serverName: params.sni || 'www.apple.com',
      minVersion: '1.2',
      alpn: params.alpn ? String(params.alpn).split(',') : ['h2', 'http/1.1'],
      certificates:
        ctx.certs.certificateFile && ctx.certs.keyFile
          ? [{ certificateFile: ctx.certs.certificateFile, keyFile: ctx.certs.keyFile }]
          : undefined,
    };
  } else {
    stream.security = 'none';
  }
  return stream;
}

function buildSettings(ib, users, ctx) {
  const params = ib.params || {};
  const active = users.filter((u) => effectiveEnabled(u));

  if (ib.protocol === 'vless') {
    return {
      clients: active.map((u) => ({
        id: u.secrets.uuid,
        email: clientEmail(u),
        flow: ib.security === 'reality' && params.flow !== '' ? params.flow || 'xtls-rprx-vision' : '',
      })),
      decryption: 'none',
      fallbacks: [],
    };
  }
  if (ib.protocol === 'vmess') {
    return {
      clients: active.map((u) => ({
        id: u.secrets.uuid,
        email: clientEmail(u),
        alterId: 0,
        security: 'auto',
        level: 0,
      })),
    };
  }
  if (ib.protocol === 'trojan') {
    return {
      clients: active.map((u) => ({
        password: u.secrets.password,
        email: clientEmail(u),
        level: 0,
      })),
      fallbacks: [],
    };
  }
  if (ib.protocol === 'shadowsocks') {
    const method = params.method || '2022-blake3-aes-128-gcm';
    const multiuser = method.startsWith('2022-');
    if (multiuser) {
      return {
        method,
        password: ssServerKey(ctx.serverSecret, ib.id, method),
        clients: active.map((u) => ({
          password: method.endsWith('aes-256-gcm') ? u.secrets.ss256 : u.secrets.ss128,
          email: clientEmail(u),
        })),
        network: 'tcp,udp',
      };
    }
    return {
      method,
      password: params.password || legacySsPassword(ctx.serverSecret, ib.id),
      network: 'tcp,udp',
    };
  }
  return null;
}

function inboundObject(ib, users, ctx) {
  const settings = buildSettings(ib, users, ctx);
  if (!settings) return null;
  const inbound = {
    tag: `ib-${ib.id}`,
    listen: '127.0.0.1',
    port: ib.port,
    protocol: ib.protocol,
    settings,
    streamSettings: streamSettings(ib, ctx),
    // CRITICAL: routeOnly: true ensures sniffed FakeTLS/SNI never overwrites
    // direct IP connections (such as Telegram MTProto DC IPs 149.154.160.0/20).
    sniffing: {
      enabled: true,
      destOverride: ['http', 'tls', 'quic'],
      routeOnly: true,
    },
  };
  if (ib.protocol === 'shadowsocks' && (ib.params.method || '').startsWith('2022-')) {
    inbound.settings.network = 'tcp,udp';
  }
  return inbound;
}

export function buildXrayConfig({ doc, reality, certs, sharedSsPassword, serverSecret, logLevel = 'warning', accounting = false }) {
  const inbounds = [];
  const routes = [];
  const users = doc.users || [];

  for (const raw of doc.inbounds || []) {
    const ib = describeInbound(raw);
    if (!ib || !ib.enabled) continue;
    if (ib.core !== 'xray') continue;
    if (ib.udp) continue;
    const obj = inboundObject(ib, users, { reality, certs, sharedSsPassword, serverSecret });
    if (!obj) continue;
    inbounds.push(obj);
    routes.push({
      routeKey: ib.routeKey,
      id: ib.id,
      edge: ib.edge,
      port: ib.port,
      transport: ib.transport,
      tag: obj.tag,
      serviceName: ib.params.serviceName || '',
      kind: ib.protocol,
    });
  }

  if (accounting) {
    inbounds.push({
      tag: 'acct-in',
      listen: '127.0.0.1',
      port: ACCOUNTING_PORT,
      protocol: 'vless',
      settings: {
        clients: users.filter((u) => effectiveEnabled(u)).map((u) => ({ id: u.secrets.uuid, email: clientEmail(u) })),
        decryption: 'none',
      },
      streamSettings: { network: 'tcp', security: 'none' },
    });
  }

  const config = {
    log: { loglevel: logLevel, access: 'none', error: '' },
    api: {
      tag: 'api',
      services: ['HandlerService', 'LoggerService', 'StatsService'],
    },
    stats: {},
    policy: {
      levels: {
        0: {
          statsUserUplink: true,
          statsUserDownlink: true,
          handshake: 4,
          connIdle: 600,
          uplinkOnly: 4,
          downlinkOnly: 8,
          bufferSize: 512,
        },
      },
      system: {
        statsInboundUplink: true,
        statsInboundDownlink: true,
        statsOutboundUplink: true,
        statsOutboundDownlink: true,
      },
    },
    inbounds: [
      {
        tag: 'api-in',
        listen: '127.0.0.1',
        port: XRAY_API_PORT,
        protocol: 'dokodemo-door',
        settings: { address: '127.0.0.1' },
      },
      ...inbounds,
    ],
    outbounds: [
      {
        tag: 'direct',
        protocol: 'freedom',
        settings: { domainStrategy: 'UseIPv4v6' },
        streamSettings: {
          sockopt: {
            domainStrategy: 'UseIPv4v6',
            tcpFastOpen: true,
            tcpNoDelay: true,
            tcpKeepAliveInterval: 15,
            tcpKeepAliveIdle: 60,
          },
        },
      },
      { tag: 'block', protocol: 'blackhole', settings: {} },
    ],
    routing: {
      // IPIfNonMatch resolves domains that no domain rule matched, so a client
      // asking for "localhost" or a name pointing at 10.x is still blocked.
      domainStrategy: 'IPIfNonMatch',
      rules: [
        { type: 'field', inboundTag: ['api-in'], outboundTag: 'api' },
        { type: 'field', domain: ['full:localhost', 'domain:localhost', 'domain:local', 'domain:internal'], outboundTag: 'block' },
        { type: 'field', ip: PRIVATE_NETS, outboundTag: 'block' },
      ],
    },
  };

  return { config, routes };
}
