/**
 * BBG · By SANDBAAD — Hardened Share-Link & Connection Descriptor Builder
 *
 * Normalizes every enabled inbound + subscriber into a unified connection
 * descriptor with 0-RTT WebSocket early data (?ed=2048), XHTTP randomized
 * padding, strict ALPN negotiation, and uTLS browser fingerprinting.
 */
import { describeInbound, edgePath, edgeServiceName } from './catalog.js';
import { ssServerKey, legacySsPassword } from './config/shared.js';
import { certPin } from './config/certs.js';
import { effectiveEnabled } from './store.js';

export function hostFor(inbound, rt) {
  if (inbound.edge === 'http') {
    return { host: rt.publicHost, port: 443, tls: true };
  }
  if (inbound.udp) {
    // UDP protocols listen on the host directly (no mux in front of them).
    return { host: rt.tcpHost || rt.publicHost, port: inbound.port, tls: true };
  }
  return { host: rt.tcpHost, port: rt.tcpPort, tls: inbound.security !== 'none' };
}

function userSsKey(user, method) {
  return method.endsWith('aes-256-gcm') ? user.secrets.ss256 : user.secrets.ss128;
}

export function ssClientPassword(doc, inbound, user, method) {
  if (!String(method).startsWith('2022-')) {
    return inbound.params.password || legacySsPassword(doc.secrets.server, inbound.id);
  }
  const server = ssServerKey(doc.secrets.server, inbound.id, method);
  return `${server}:${userSsKey(user, method)}`;
}

/** Normalise an inbound + user into everything a client needs. */
export function connectionFor(doc, inbound, user) {
  const params = inbound.params || {};
  const rt = doc.__runtime || {};
  const target = hostFor(inbound, rt);
  const rawPath = inbound.edge === 'http' ? edgePath(inbound) : params.path || '/';
  const cleanPath = rawPath.split('?')[0];
  const wsPathWithEarlyData = inbound.transport === 'ws'
    ? `${cleanPath}${cleanPath.includes('?') ? '&' : '?'}ed=2048`
    : cleanPath;

  const base = {
    inboundId: inbound.id,
    presetId: inbound.presetId,
    protocol: inbound.protocol,
    transport: inbound.transport,
    security: inbound.security,
    host: target.host,
    port: target.port,
    edge: inbound.edge,
    rawPath: cleanPath,
    path: wsPathWithEarlyData,
    hostHeader: params.host || target.host,
    sni: params.sni || (inbound.security === 'reality' ? String(params.dest || '').split(':')[0] : target.host),
    serviceName: inbound.edge === 'http' ? edgeServiceName(inbound) : params.serviceName || '',
    flow: params.flow || '',
    // Strict ALPN management: prevents HTTP/2 downgrade stalls on WebSocket/HTTPUpgrade
    alpn:
      inbound.protocol === 'hysteria2'
        ? 'h3'
        : inbound.transport === 'grpc'
          ? 'h2'
          : ['ws', 'httpupgrade'].includes(inbound.transport)
            ? 'http/1.1'
            : 'h2,http/1.1',
    fingerprint: params.fingerprint || 'chrome',
    extra: params,
  };
  if (inbound.security === 'reality') {
    base.publicKey = (rt.reality && rt.reality.publicKey) || params.publicKey || '';
    base.shortId = String(params.shortIds || '').split(',')[0].trim();
  }
  return base;
}

function q(pairs) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(pairs)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

export function vmessLink(conn, user, label) {
  const obj = {
    v: '2',
    ps: label,
    add: conn.host,
    port: String(conn.port),
    id: user.secrets.uuid,
    aid: '0',
    scy: 'auto',
    net: conn.transport === 'tcp' ? 'tcp' : conn.transport,
    type: 'none',
    host: conn.transport === 'ws' ? conn.hostHeader : '',
    path: conn.transport === 'grpc' ? conn.serviceName : conn.path,
    tls: conn.security === 'none' ? '' : 'tls',
    sni: conn.sni,
    alpn: conn.security === 'none' ? '' : conn.alpn,
    fp: conn.security === 'none' ? '' : conn.fingerprint,
  };
  return `vmess://${Buffer.from(JSON.stringify(obj), 'utf8').toString('base64')}`;
}

export function toUri(doc, conn, user, label) {
  const enc = encodeURIComponent(label);
  const pin = conn.security === 'tls-self' ? certPin() : '';
  switch (conn.protocol) {
    case 'vless': {
      const params = {
        type: conn.transport,
        security:
          conn.security === 'none'
            ? 'none'
            : conn.security === 'tls-edge' || conn.security === 'tls-self'
              ? 'tls'
              : 'reality',
        encryption: 'none',
        sni: conn.sni,
        fp: conn.fingerprint,
        alpn: conn.security === 'tls-edge' ? conn.alpn : '',
        pbk: conn.publicKey || '',
        sid: conn.shortId || '',
        spx: conn.security === 'reality' ? conn.spiderX || '/' : undefined,
        flow: conn.flow || '',
        path: conn.transport === 'grpc' ? undefined : conn.path,
        host: conn.hostHeader,
        mode: conn.transport === 'xhttp' ? conn.extra.mode || 'auto' : undefined,
        extra:
          conn.transport === 'xhttp'
            ? JSON.stringify({ xPaddingBytes: '100-1000' })
            : undefined,
        serviceName: conn.transport === 'grpc' ? conn.serviceName : undefined,
        pcs: pin || undefined,
        allowInsecure: conn.security === 'tls-self' ? '1' : undefined,
      };
      return `vless://${user.secrets.uuid}@${conn.host}:${conn.port}?${q(params)}#${enc}`;
    }
    case 'vmess':
      return vmessLink(conn, user, label);
    case 'trojan': {
      const params = {
        type: conn.transport,
        security: conn.security === 'none' ? 'none' : 'tls',
        sni: conn.sni,
        fp: conn.fingerprint,
        alpn: conn.security === 'tls-edge' ? conn.alpn : '',
        path: conn.transport === 'grpc' ? undefined : conn.path,
        host: conn.hostHeader,
        serviceName: conn.transport === 'grpc' ? conn.serviceName : undefined,
        pcs: pin || undefined,
        allowInsecure: conn.security === 'tls-self' ? '1' : undefined,
      };
      return `trojan://${encodeURIComponent(user.secrets.password)}@${conn.host}:${conn.port}?${q(params)}#${enc}`;
    }
    case 'shadowsocks': {
      const method = conn.extra.method || '2022-blake3-aes-128-gcm';
      const creds = Buffer.from(`${method}:${conn.ssPassword || user.secrets.password}`, 'utf8').toString('base64url');
      return `ss://${creds}@${conn.host}:${conn.port}#${enc}`;
    }
    case 'anytls': {
      const params = {
        security: 'tls',
        sni: conn.sni,
        insecure: '1',
        fp: conn.fingerprint,
      };
      return `anytls://${encodeURIComponent(user.secrets.password)}@${conn.host}:${conn.port}?${q(params)}#${enc}`;
    }
    case 'hysteria2': {
      const params = {
        sni: conn.sni,
        insecure: '1',
        alpn: 'h3',
        obfs: conn.extra.obfs ? 'salamander' : '',
        'obfs-password': conn.extra.obfs || '',
      };
      return `hysteria2://${encodeURIComponent(user.secrets.password)}@${conn.host}:${conn.port}?${q(params)}#${enc}`;
    }
    case 'shadowtls': {
      return '';
    }
    default:
      return '';
  }
}

/** Short, human label used in the panel lists ("VLESS·WS·TLS"). */
export function shortFor(inbound) {
  const tr = inbound.transport && inbound.transport !== 'tcp' ? `·${inbound.transport.toUpperCase()}` : '';
  const sec = inbound.security === 'reality' ? '·REALITY' : inbound.security === 'tls-self' ? '·TLS' : '';
  return `${inbound.protocol.toUpperCase()}${tr}${sec}`;
}

export function labelFor(doc, inbound) {
  const brand = doc.settings?.brand || 'BBG';
  const tag = doc.settings?.tag || 'CORE';
  const core = inbound.core === 'xray' ? 'XRAY' : 'SING';
  const proto = `${inbound.protocol.toUpperCase()}`;
  const tr = inbound.transport && inbound.transport !== 'tcp' ? `·${inbound.transport.toUpperCase()}` : '';
  const sec = inbound.security === 'reality' ? '·REALITY' : '';
  return `${brand} ${tag} · ${core}·${proto}${tr}${sec}`.replace(/\s+/g, ' ').trim();
}

/** All links for one user, one per enabled inbound. */
export function buildUserLinks(doc, user) {
  if (!effectiveEnabled(user)) return [];
  const out = [];
  for (const raw of doc.inbounds || []) {
    const inbound = describeInbound(raw);
    if (!inbound || !inbound.enabled) continue;
    const conn = connectionFor(doc, inbound, user);
    if (!conn.host || !conn.port) continue;
    if (inbound.protocol === 'shadowsocks') {
      conn.ssPassword = ssClientPassword(doc, inbound, user, conn.extra.method || '2022-blake3-aes-128-gcm');
    }
    const label = labelFor(doc, inbound, user);
    const uri = toUri(doc, conn, user, label);
    if (!uri) continue;
    out.push({
      id: inbound.id,
      short: shortFor(inbound),
      presetId: inbound.presetId,
      core: inbound.core,
      protocol: inbound.protocol,
      transport: inbound.transport,
      security: inbound.security,
      title: inbound.title,
      label,
      uri,
      conn,
    });
  }
  return out;
}
