/**
 * BBG · By SANDBAAD — sing-box configuration generator (server side)
 *
 * Powers AnyTLS (adaptive padding), ShadowTLS v3, Hysteria2, and sing-box
 * VLESS/WS 0-RTT inbounds with non-blocking sniffing and TCP Fast Open.
 */
import { effectiveEnabled } from '../store.js';
import { describeInbound, edgePath, edgeServiceName } from '../catalog.js';
import { ssServerKey, legacySsPassword } from './shared.js';
import { ACCOUNTING_PORT } from './xray.js';

export const SB_CLASH_PORT = 9091;
export const SB_V2RAY_API_PORT = 10086;

const DEFAULT_ANYTLS_PADDING = [
  'stop=8',
  '0=30-30',
  '1=100-400',
  '2=400-500,c,500-1000,c,500-1000,c,500-1000,c,500-1000',
  '3=9-9,500-1000',
  '4=500-1000',
  '5=500-1000',
  '6=500-1000',
  '7=500-1000',
];

function tlsBlock(ib, ctx) {
  const params = ib.params || {};
  if (ib.security === 'reality') {
    const dest = params.dest || 'www.microsoft.com:443';
    return {
      enabled: true,
      server_name: params.sni || dest.split(':')[0],
      reality: {
        enabled: true,
        handshake: { server: dest.split(':')[0], server_port: Number(dest.split(':')[1] || 443) },
        private_key: ctx.reality.privateKey,
        short_id:
          String(params.shortIds || 'a1b2c3d4')
            .split(',')
            .map((x) => x.trim())
            .filter((x) => /^[0-9a-f]{2,16}$/.test(x))[0] || 'a1b2c3d4',
      },
    };
  }
  if (ib.security === 'tls-self' || ib.transport === 'quic') {
    return {
      enabled: true,
      server_name: params.sni || 'www.apple.com',
      min_version: '1.2',
      alpn: ib.protocol === 'hysteria2' ? ['h3'] : ['h2', 'http/1.1'],
      certificate_path: ctx.certs.certificateFile || undefined,
      key_path: ctx.certs.keyFile || undefined,
    };
  }
  return undefined;
}

function transportBlock(ib) {
  const params = ib.params || {};
  const rawPath = ib.edge === 'http' ? edgePath(ib) : params.path || '/';
  const httpPath = rawPath.split('?')[0];

  if (ib.transport === 'ws') {
    return {
      type: 'ws',
      path: httpPath,
      ...(params.host ? { headers: { Host: params.host } } : {}),
    };
  }
  if (ib.transport === 'httpupgrade') {
    return { type: 'httpupgrade', path: httpPath, ...(params.host ? { host: params.host } : {}) };
  }
  if (ib.transport === 'grpc') {
    return {
      type: 'grpc',
      service_name: ib.edge === 'http' ? edgeServiceName(ib) : params.serviceName || ib.routeKey,
      idle_timeout: '60s',
      ping_timeout: '15s',
    };
  }
  return undefined;
}

function usersFor(ib, users, ctx) {
  const active = users.filter((u) => effectiveEnabled(u));
  const params = ib.params || {};
  if (ib.protocol === 'vless' || ib.protocol === 'vmess') {
    return active.map((u) => ({ name: `u-${u.id}`, uuid: u.secrets.uuid }));
  }
  if (ib.protocol === 'trojan' || ib.protocol === 'anytls') {
    return active.map((u) => ({ name: `u-${u.id}`, password: u.secrets.password }));
  }
  if (ib.protocol === 'hysteria2') {
    return active.map((u) => ({ name: `u-${u.id}`, password: u.secrets.password }));
  }
  if (ib.protocol === 'shadowsocks') {
    const method = params.method || '2022-blake3-aes-128-gcm';
    if (method.startsWith('2022-')) {
      return active.map((u) => ({
        name: `u-${u.id}`,
        password: method.endsWith('aes-256-gcm') ? u.secrets.ss256 : u.secrets.ss128,
      }));
    }
    return [{ name: 'shared', password: params.password || legacySsPassword(ctx.serverSecret, ib.id) }];
  }
  if (ib.protocol === 'shadowtls') {
    const method = params.method || '2022-blake3-aes-128-gcm';
    return active.map((u) => ({
      name: `u-${u.id}`,
      password: method.endsWith('aes-256-gcm') ? u.secrets.ss256 : u.secrets.ss128,
    }));
  }
  return [];
}

export function buildSingboxConfig({ doc, reality, certs, sharedSsPassword, serverSecret, logLevel = 'warn', accounting = false }) {
  const ctx = { reality, certs, sharedSsPassword, serverSecret };
  const inbounds = [];
  const routes = [];
  const users = doc.users || [];
  const tags = [];

  for (const raw of doc.inbounds || []) {
    const ib = describeInbound(raw);
    if (!ib || !ib.enabled) continue;
    if (ib.core !== 'singbox') continue;
    const params = ib.params || {};
    const usersBlock = usersFor(ib, users, ctx);
    const base = {
      type: ib.protocol,
      tag: `ib-${ib.id}`,
      // UDP protocols (Hysteria2) need a public port; TCP ones sit behind the mux.
      listen: ib.udp ? '::' : '127.0.0.1',
      listen_port: ib.port,
      ...(ib.udp ? {} : { tcp_fast_open: true }),
    };
    let inbound = null;

    if (ib.protocol === 'vless' || ib.protocol === 'vmess' || ib.protocol === 'trojan') {
      inbound = { ...base, users: usersBlock };
      const transport = transportBlock(ib);
      if (transport) inbound.transport = transport;
      const tls = tlsBlock(ib, ctx);
      if (tls) inbound.tls = tls;
    } else if (ib.protocol === 'anytls') {
      inbound = {
        ...base,
        users: usersBlock,
        padding_scheme: DEFAULT_ANYTLS_PADDING,
        tls: tlsBlock(ib, ctx),
      };
    } else if (ib.protocol === 'shadowsocks') {
      inbound = {
        ...base,
        method: params.method || '2022-blake3-aes-128-gcm',
        ...(String(params.method || '').startsWith('2022-')
          ? { password: ssServerKey(ctx.serverSecret, ib.id, params.method) }
          : {}),
        users: usersBlock,
      };
    } else if (ib.protocol === 'shadowtls') {
      const method = params.method || '2022-blake3-aes-128-gcm';
      const detag = `ss-${ib.id}`;
      inbound = {
        ...base,
        version: 3,
        strict_mode: true,
        users: usersBlock,
        handshake: {
          server: params.sni || params.handshakeHost || 'dash.cloudflare.com',
          server_port: Number(params.handshakePort || 443),
        },
        detour: detag,
      };
      inbounds.push({
        type: 'shadowsocks',
        tag: detag,
        method,
        password: ssServerKey(ctx.serverSecret, ib.id, method),
        users: usersBlock.map((u) => ({ name: u.name, password: u.password })),
      });
      tags.push(detag);
    } else if (ib.protocol === 'hysteria2') {
      inbound = {
        ...base,
        users: usersBlock,
        ...(Number(params.upMbps) ? { up_mbps: Number(params.upMbps) } : {}),
        ...(Number(params.downMbps) ? { down_mbps: Number(params.downMbps) } : {}),
        ...(params.obfs ? { obfs: { type: 'salamander', password: params.obfs } } : {}),
        tls: tlsBlock(ib, ctx),
      };
    }

    if (!inbound) continue;
    inbounds.push(inbound);
    tags.push(inbound.tag);
    routes.push({
      routeKey: ib.routeKey,
      id: ib.id,
      edge: ib.edge,
      port: ib.port,
      transport: ib.transport,
      tag: inbound.tag,
      serviceName: '',
      kind: ib.protocol,
    });
  }

  // Per-user hand-off to Xray's loopback accounting inbound (see ACCOUNTING_PORT).
  const active = accounting && routes.length ? users.filter((u) => effectiveEnabled(u)) : [];
  const bridge = active.map((u) => ({
    type: 'vless',
    tag: `acct-${u.id}`,
    server: '127.0.0.1',
    server_port: ACCOUNTING_PORT,
    uuid: u.secrets.uuid,
    packet_encoding: 'xudp',
  }));

  const config = {
    log: { level: logLevel, timestamp: true },
    inbounds,
    outbounds: [{ type: 'direct', tag: 'direct', tcp_fast_open: true }, ...bridge],
    route: {
      rules: [
        { action: 'sniff', timeout: '100ms' },
        { domain_suffix: ['localhost', 'local', 'internal'], action: 'reject' },
        { ip_is_private: true, action: 'reject' },
        ...active.map((u) => ({ auth_user: [`u-${u.id}`], outbound: `acct-${u.id}` })),
      ],
      final: 'direct',
    },
  };

  return { config, routes };
}
