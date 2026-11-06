/**
 * BBG · By SANDBAAD — Hardened Protocol Catalogue
 *
 * Pruned & consolidated anti-censorship protocol presets designed for high
 * DPI resistance, zero-RTT early data, TLS fragmentation, and low-latency
 * multiplexing across TCP and CDN/HTTP edges.
 *
 *   edge: 'http' → reaches clients through the public HTTPS port (edge
 *                  terminates TLS, routed by path / ALPN inside BBG)
 *   edge: 'tcp'  → reaches clients through the single TCP proxy port.
 *                  BBG multiplexes TLS-SNI / SOCKS5 / HTTP / MTProto on
 *                  that single port (see src/proxy/mux.js).
 *   tier: 'verified' → confirmed end-to-end over TCP proxy; enabled by default.
 *   tier: 'lab'  → for custom CDN domains / experiments.
 *   udp: true    → requires public UDP ingress.
 */
import { uid } from './store.js';

export const CORES = {
  xray: {
    id: 'xray',
    name: 'Xray-core',
    bin: 'xray',
    note: {
      fa: 'هستهٔ اصلی؛ پوشش کامل REALITY (Vision)، XHTTP با پدینگ تصادفی و WebSocket 0-RTT',
      en: 'Primary core: full REALITY (Vision), XHTTP randomized padding & 0-RTT WebSocket',
    },
  },
  singbox: {
    id: 'singbox',
    name: 'sing-box',
    bin: 'sing-box',
    note: {
      fa: 'هستهٔ مدرن؛ AnyTLS با طرح پدینگ ضد-DPI، ShadowTLS v3 و Hysteria2',
      en: 'Modern core: AnyTLS anti-DPI padding scheme, ShadowTLS v3 & Hysteria2',
    },
  },
};

const F = {
  path: { key: 'path', type: 'text', mono: true, label: { fa: 'مسیر (Path)', en: 'Path' } },
  host: { key: 'host', type: 'text', mono: true, label: { fa: 'Host هدر / دامنهٔ تمیز', en: 'Host header / Clean domain' } },
  sni: { key: 'sni', type: 'text', mono: true, label: { fa: 'SNI / نام سرور', en: 'SNI / Server Name' } },
  serviceName: { key: 'serviceName', type: 'text', mono: true, label: { fa: 'نام سرویس gRPC', en: 'gRPC service name' } },
  dest: { key: 'dest', type: 'text', mono: true, label: { fa: 'مقصد REALITY', en: 'REALITY destination' } },
  shortIds: { key: 'shortIds', type: 'text', mono: true, label: { fa: 'ShortIds (با کاما)', en: 'ShortIds (comma)' } },
  flow: { key: 'flow', type: 'select', options: ['xtls-rprx-vision', ''], label: { fa: 'Flow', en: 'Flow' } },
  method: {
    key: 'method',
    type: 'select',
    options: ['2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm'],
    label: { fa: 'متد رمزنگاری (SS-2022)', en: 'AEAD-2022 Cipher' },
  },
  version: { key: 'version', type: 'select', options: ['3'], label: { fa: 'نسخهٔ ShadowTLS', en: 'ShadowTLS version' } },
  upMbps: { key: 'upMbps', type: 'number', label: { fa: 'پهنای‌باند آپ (Mbps)', en: 'Upstream Mbps' } },
  downMbps: { key: 'downMbps', type: 'number', label: { fa: 'پهنای‌باند دان (Mbps)', en: 'Downstream Mbps' } },
  obfs: { key: 'obfs', type: 'text', mono: true, label: { fa: 'رمز پوشش (Salamander)', en: 'Salamander Obfs password' } },
};

/** @type {Array<object>} */
export const PRESETS = [
  /* ── Xray · TCP Proxy Edge (Verified Low-Latency & Anti-DPI) ────────── */
  {
    id: 'vless-reality',
    tier: 'verified',
    core: 'xray',
    protocol: 'vless',
    transport: 'tcp',
    security: 'reality',
    edge: 'tcp',
    udp: false,
    featured: true,
    title: { fa: 'VLESS + REALITY (Vision)', en: 'VLESS + REALITY (Vision)' },
    desc: {
      fa: 'قوی‌ترین پروتکل ضد-فیلتر: هندشیک واقعی TLS 1.3 با گواهی سایت مقصد، uTLS Chrome و حذف کامل اثرانگشت TLS.',
      en: 'Hardened anti-DPI flagship: authentic TLS 1.3 handshake with XTLS-Vision flow and zero certificate fingerprint.',
    },
    defaults: { dest: 'www.microsoft.com:443', shortIds: 'a1b2c3d4,9f8e7d6c5b4a', flow: 'xtls-rprx-vision' },
    fields: ['dest', 'shortIds'],
  },
  {
    id: 'ss-2022',
    tier: 'verified',
    core: 'xray',
    protocol: 'shadowsocks',
    transport: 'tcp',
    security: 'none',
    edge: 'tcp',
    udp: false,
    featured: true,
    title: { fa: 'Shadowsocks 2022 (BLAKE3)', en: 'Shadowsocks 2022 (BLAKE3)' },
    desc: {
      fa: 'استاندارد SIP022 با کلید BLAKE3 اختصاصی هر کاربر، محافظت در برابر Replay و کمترین تأخیر برای پیام‌رسان‌ها.',
      en: 'SIP022 BLAKE3 per-user key derivation with strict replay protection and minimal handshake latency.',
    },
    defaults: { method: '2022-blake3-aes-128-gcm' },
    fields: ['method'],
  },
  {
    id: 'trojan-tcp-tls',
    tier: 'lab',
    core: 'xray',
    protocol: 'trojan',
    transport: 'tcp',
    security: 'tls-self',
    edge: 'tcp',
    udp: false,
    title: { fa: 'Trojan + TLS 1.3 (Pinned)', en: 'Trojan + TLS 1.3 (Pinned)' },
    desc: {
      fa: 'تروجان مستقیم روی پورت TCP با گواهی پین‌شده و فرگمنت ClientHello.',
      en: 'Direct TCP Trojan with certificate pinning and TLS ClientHello fragmentation.',
    },
    defaults: { sni: 'aws.amazon.com' },
    fields: ['sni'],
  },

  /* ── sing-box · TCP Proxy Edge (Verified Low-Latency & Anti-DPI) ────── */
  {
    id: 'anytls',
    tier: 'verified',
    core: 'singbox',
    protocol: 'anytls',
    transport: 'tcp',
    security: 'tls-self',
    edge: 'tcp',
    udp: false,
    featured: true,
    title: { fa: 'AnyTLS (Padding Scheme)', en: 'AnyTLS (Padding Scheme)' },
    desc: {
      fa: 'پروتکل نسل جدید sing-box با پدینگ تطبیقی بسته‌ها برای خنثی‌سازی تشخیص طول بسته در DPI.',
      en: 'Next-gen sing-box transport with adaptive packet-length padding to defeat statistical DPI classifiers.',
    },
    defaults: { sni: 'www.apple.com' },
    fields: ['sni'],
  },
  {
    id: 'shadowtls',
    tier: 'lab',
    core: 'singbox',
    protocol: 'shadowtls',
    transport: 'tcp',
    security: 'tls-self',
    edge: 'tcp',
    udp: false,
    title: { fa: 'ShadowTLS v3 + SS-2022', en: 'ShadowTLS v3 + SS-2022' },
    desc: {
      fa: 'پوشش هندشیک TLS v3 واقعی روی Shadowsocks 2022 برای عبور از فایروال‌های حساس به SNI.',
      en: 'Strict ShadowTLS v3 handshake wrapper paired with Shadowsocks 2022 BLAKE3.',
    },
    defaults: { version: '3', method: '2022-blake3-aes-128-gcm', sni: 'dash.cloudflare.com' },
    fields: ['method', 'sni'],
  },
  {
    id: 'sb-vless-reality',
    tier: 'lab',
    core: 'singbox',
    protocol: 'vless',
    transport: 'tcp',
    security: 'reality',
    edge: 'tcp',
    udp: false,
    title: { fa: 'VLESS + REALITY (sing-box)', en: 'VLESS + REALITY (sing-box)' },
    desc: {
      fa: 'پیاده‌سازی REALITY روی هستهٔ sing-box 1.10+ با پشتیبانی از TLS Record Fragmentation.',
      en: 'REALITY served by sing-box 1.10+ with native TLS record fragmentation support.',
    },
    defaults: { dest: 'www.microsoft.com:443', shortIds: 'a1b2c3d4', flow: 'xtls-rprx-vision' },
    fields: ['dest', 'shortIds'],
  },

  /* ── Xray & sing-box · HTTP / CDN Edge (0-RTT Early Data & Padding) ─── */
  {
    id: 'vless-xhttp',
    tier: 'lab',
    core: 'xray',
    protocol: 'vless',
    transport: 'xhttp',
    security: 'tls-edge',
    edge: 'http',
    udp: false,
    featured: true,
    title: { fa: 'VLESS + XHTTP (SplitHTTP)', en: 'VLESS + XHTTP (SplitHTTP)' },
    desc: {
      fa: 'ترنسپورت ضد-فیلتر XHTTP با پدینگ تصادفی هدر (100-1000 بایت)؛ ایده‌آل برای عبور از CDN و کلادفلر.',
      en: 'Hardened XHTTP (SplitHTTP) with randomized 100–1000B padding; engineered for Cloudflare & CDN edges.',
    },
    defaults: { path: '/', host: '' },
    fields: ['path', 'host'],
  },
  {
    id: 'vless-ws',
    tier: 'lab',
    core: 'xray',
    protocol: 'vless',
    transport: 'ws',
    security: 'tls-edge',
    edge: 'http',
    udp: false,
    featured: true,
    title: { fa: 'VLESS + WebSocket (0-RTT)', en: 'VLESS + WebSocket (0-RTT)' },
    desc: {
      fa: 'وب‌سوکت بهینه‌شده با Early-Data 2048 و ALPN صریح http/1.1 برای حذف یک دور کامل تأخیر هندشیک.',
      en: 'WebSocket tuned with 2048B 0-RTT early data and strict http/1.1 ALPN to eliminate handshake stalls.',
    },
    defaults: { path: '/', host: '' },
    fields: ['path', 'host'],
  },
  {
    id: 'vless-httpupgrade',
    tier: 'lab',
    core: 'xray',
    protocol: 'vless',
    transport: 'httpupgrade',
    security: 'tls-edge',
    edge: 'http',
    udp: false,
    title: { fa: 'VLESS + HTTPUpgrade', en: 'VLESS + HTTPUpgrade' },
    desc: {
      fa: 'ارتقای مستقیم HTTP/1.1 بدون سربار فریم‌بندی WebSocket؛ سریع و سبک روی لبهٔ CDN.',
      en: 'Zero-framing HTTP/1.1 upgrade transport with lower CPU and framing overhead than WebSocket.',
    },
    defaults: { path: '/', host: '' },
    fields: ['path', 'host'],
  },
  {
    id: 'vless-grpc',
    tier: 'lab',
    core: 'xray',
    protocol: 'vless',
    transport: 'grpc',
    security: 'tls-edge',
    edge: 'http',
    udp: false,
    note: { fa: 'نیازمند پشتیبانی HTTP/2 در دامنه یا CDN', en: 'Requires HTTP/2 support on the edge / CDN' },
    title: { fa: 'VLESS + gRPC (H2 Stream)', en: 'VLESS + gRPC (H2 Stream)' },
    desc: {
      fa: 'مالتی‌پلکسینگ استریم‌های HTTP/2 با پنجرهٔ اتصال بهینه برای پایداری در لینک‌های پرتلفات.',
      en: 'Multiplexed HTTP/2 gRPC streams with tuned keepalive windows for lossy networks.',
    },
    defaults: { serviceName: 'bbg-rpc' },
    fields: ['serviceName'],
  },
  {
    id: 'trojan-ws',
    tier: 'lab',
    core: 'xray',
    protocol: 'trojan',
    transport: 'ws',
    security: 'tls-edge',
    edge: 'http',
    udp: false,
    title: { fa: 'Trojan + WebSocket (0-RTT)', en: 'Trojan + WebSocket (0-RTT)' },
    desc: {
      fa: 'تروجان روی WebSocket با Early-Data 2048 برای سازگاری حداکثری با کلاینت‌ها.',
      en: 'Trojan over 0-RTT WebSocket with per-subscriber credentials and CDN compatibility.',
    },
    defaults: { path: '/', host: '' },
    fields: ['path', 'host'],
  },
  {
    id: 'sb-vless-ws',
    tier: 'lab',
    core: 'singbox',
    protocol: 'vless',
    transport: 'ws',
    security: 'tls-edge',
    edge: 'http',
    udp: false,
    title: { fa: 'VLESS + WS 0-RTT (sing-box)', en: 'VLESS + WS 0-RTT (sing-box)' },
    desc: {
      fa: 'تونل WebSocket با Early-Data روی هستهٔ sing-box برای تنوع مسیر.',
      en: '0-RTT WebSocket tunnel served by sing-box with Sec-WebSocket-Protocol early data.',
    },
    defaults: { path: '/', host: '' },
    fields: ['path', 'host'],
  },

  /* ── QUIC / UDP Edge (For Dedicated VPS / Custom UDP Hosts) ─────────── */
  {
    id: 'hysteria2',
    tier: 'lab',
    core: 'singbox',
    protocol: 'hysteria2',
    transport: 'quic',
    security: 'tls-self',
    edge: 'udp',
    udp: true,
    title: { fa: 'Hysteria2 (QUIC Brutal)', en: 'Hysteria2 (QUIC Brutal)' },
    desc: {
      fa: 'شتاب‌دهندهٔ QUIC با کنترل ازدحام Brutal و پوشش Salamander؛ نیازمند پورت UDP عمومی.',
      en: 'QUIC transport with Brutal congestion control and Salamander obfuscation; requires public UDP.',
    },
    defaults: { obfs: '', upMbps: 100, downMbps: 100 },
    fields: ['obfs', 'upMbps', 'downMbps'],
  },
];

export const PRESET_MAP = new Map(PRESETS.map((p) => [p.id, p]));
export const FIELD_MAP = F;

export function presetById(id) {
  return PRESET_MAP.get(id) || null;
}

function makeInbound(preset, overrides = {}) {
  const id = overrides.id || uid(6);
  return {
    id,
    presetId: preset.id,
    label: overrides.label || preset.title.en,
    enabled: overrides.enabled !== false,
    routeKey: `bbg-${id}`,
    port: overrides.port || 0,
    params: { ...preset.defaults, ...(overrides.params || {}) },
  };
}

/** Default hardened inbounds seeded on a fresh install. */
export function DEFAULT_INBOUNDS() {
  const list = [
    makeInbound(presetById('vless-reality'), { label: 'VLESS · REALITY', enabled: true, port: 11010 }),
    makeInbound(presetById('ss-2022'), { label: 'Shadowsocks 2022', enabled: true, port: 11011 }),
    makeInbound(presetById('anytls'), { label: 'AnyTLS · Padding', enabled: true, port: 11012 }),
    makeInbound(presetById('vless-xhttp'), { label: 'VLESS · XHTTP', enabled: false, port: 11003 }),
    makeInbound(presetById('vless-ws'), { label: 'VLESS · WS 0-RTT', enabled: false, port: 11001 }),
    makeInbound(presetById('vless-httpupgrade'), { label: 'VLESS · HTTPUpgrade', enabled: false, port: 11002 }),
    makeInbound(presetById('vless-grpc'), { label: 'VLESS · gRPC', enabled: false, port: 11004 }),
    makeInbound(presetById('trojan-ws'), { label: 'Trojan · WS 0-RTT', enabled: false, port: 11005 }),
    makeInbound(presetById('trojan-tcp-tls'), { label: 'Trojan · TLS 1.3', enabled: false, port: 11006 }),
    makeInbound(presetById('shadowtls'), { label: 'ShadowTLS v3', enabled: false, port: 11013 }),
    makeInbound(presetById('sb-vless-ws'), { label: 'VLESS · WS (sing-box)', enabled: false, port: 12001 }),
    makeInbound(presetById('hysteria2'), { label: 'Hysteria2 (UDP)', enabled: false, port: 11020 }),
  ];
  return list;
}

/** Resolve a stored inbound into a full descriptor with preset data merged. */
export function describeInbound(inbound) {
  const preset = presetById(inbound.presetId);
  if (!preset) return null;
  return {
    ...preset,
    ...inbound,
    params: { ...preset.defaults, ...(inbound.params || {}) },
    reachable: !preset.udp,
    tier: preset.tier || 'lab',
    reason: preset.udp
      ? { fa: 'نیازمند پورت UDP عمومی روی هاست', en: 'Requires public UDP ingress on host' }
      : null,
  };
}

/**
 * The full HTTP path an edge-routed inbound answers on.
 */
export function edgePath(inbound) {
  const raw = (inbound.params && inbound.params.path) || '/';
  const cleanRaw = raw.split('?')[0];
  const suffix = cleanRaw === '/' ? '' : cleanRaw.startsWith('/') ? cleanRaw : `/${cleanRaw}`;
  return `/${inbound.routeKey}${suffix}`;
}

/** gRPC service name including the routing prefix. */
export function edgeServiceName(inbound) {
  const extra = ((inbound.params && inbound.params.serviceName) || '').replace(/^\/+/, '');
  return extra ? `${inbound.routeKey}/${extra}` : inbound.routeKey;
}

export function enabledInbounds(doc) {
  return (doc.inbounds || [])
    .map(describeInbound)
    .filter((ib) => ib && ib.enabled && ib.reachable);
}

export function inboundByRouteKey(doc, routeKey) {
  const inbound = (doc.inbounds || []).find((ib) => ib.routeKey === routeKey);
  return inbound ? describeInbound(inbound) : null;
}
