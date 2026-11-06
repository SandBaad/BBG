/**
 * BBG · By SANDBAAD — Anti-DPI & Network Profile Advisor
 *
 * Inspects deployment topology (edge domains, TCP proxy ports, running cores,
 * and active inbounds) and applies hardened profiles engineered to defeat
 * SNI inspection, active probing, and packet-length classifiers.
 */

import { presetById } from './catalog.js';

/** Destinations verified to answer TLS 1.3 + HTTP/2 cleanly without DPI resets. */
export const IRAN_SNI_CHOICES = [
  { value: 'www.microsoft.com', fa: 'مایکروسافت (پیشنهادی)', en: 'Microsoft (recommended)' },
  { value: 'www.apple.com', fa: 'اپل', en: 'Apple' },
  { value: 'aws.amazon.com', fa: 'آمازون AWS', en: 'AWS' },
  { value: 'dash.cloudflare.com', fa: 'کلادفلر', en: 'Cloudflare dash' },
  { value: 'www.speedtest.net', fa: 'اسپیدتست', en: 'Speedtest' },
  { value: 'www.swift.com', fa: 'سوئیفت', en: 'Swift' },
];

/** Domains used for MTProto FakeTLS — distinct from REALITY SNI to prevent mux collisions. */
export const IRAN_FAKETLS_CHOICES = [
  { value: 'www.samsung.com', fa: 'سامسونگ (پیشنهادی)', en: 'Samsung (recommended)' },
  { value: 'www.icloud.com', fa: 'آیکلاود', en: 'iCloud' },
  { value: 'www.apple.com', fa: 'اپل', en: 'Apple' },
  { value: 'www.microsoft.com', fa: 'مایکروسافت', en: 'Microsoft' },
];

export const PROFILES = [
  {
    id: 'iran',
    fa: 'ضد-فیلتر حداکثری · چندلایه',
    en: 'HARDENED · MULTI-CORE DPI EVASION',
    taglineFa: 'ترکیب REALITY Vision، AnyTLS با پدینگ هوشمند و SS-2022 روی یک پورت مالتی‌پلکس',
    taglineEn: 'Combines REALITY Vision, AnyTLS adaptive padding & SS-2022 over a single multiplexed TCP port',
    enables: ['vless-reality', 'ss-2022', 'anytls'],
    disables: [
      'vless-ws', 'vless-xhttp', 'vless-grpc', 'vless-httpupgrade',
      'trojan-ws', 'trojan-tcp-tls', 'shadowtls', 'sb-vless-ws', 'sb-vless-reality', 'hysteria2',
    ],
    telegram: { mtproto: true, socks: true, http: true, faketlsHost: 'www.samsung.com' },
    overrides: {
      'vless-reality': { dest: 'www.microsoft.com:443', sni: 'www.microsoft.com', flow: 'xtls-rprx-vision' },
      anytls: { sni: 'www.apple.com' },
      'ss-2022': { method: '2022-blake3-aes-128-gcm' },
    },
    notesFa: [
      'REALITY (Vision)، Shadowsocks-2022 و AnyTLS هم‌زمان روی پورت TCP مالتی‌پلکس می‌شوند.',
      'فرگمنت TLS ClientHello و مسیریابی مستقیم رنج‌های IP تلگرام برای حذف کامل تأخیر ۲۰ ثانیه‌ای فعال می‌شود.',
      'پروکسی اختصاصی تلگرام (MTProto FakeTLS + SOCKS5) روی همان پورت فعال می‌گردد.',
    ],
    notesEn: [
      'REALITY (Vision), Shadowsocks-2022, and AnyTLS are multiplexed concurrently over the single TCP port.',
      'TLS ClientHello fragmentation and direct Telegram IP CIDR routing eliminate handshake & messaging stalls.',
      'Dedicated Telegram proxies (MTProto FakeTLS + SOCKS5) ride the same port seamlessly.',
    ],
  },
  {
    id: 'balanced',
    fa: 'سبک و فوق‌سریع · فقط REALITY',
    en: 'ULTRA-LIGHT · REALITY VISION ONLY',
    taglineFa: 'کمترین مصرف رم و CPU؛ فقط قوی‌ترین پروتکل Xray با فرگمنت TLS',
    taglineEn: 'Minimum memory & CPU footprint; runs only Xray REALITY Vision with TLS fragmentation',
    enables: ['vless-reality'],
    disables: [
      'vless-ws', 'vless-xhttp', 'vless-grpc', 'vless-httpupgrade',
      'trojan-ws', 'trojan-tcp-tls', 'shadowtls', 'anytls', 'ss-2022',
      'sb-vless-ws', 'sb-vless-reality', 'hysteria2',
    ],
    telegram: { mtproto: true, socks: true, http: true, faketlsHost: 'www.samsung.com' },
    overrides: {
      'vless-reality': { dest: 'www.microsoft.com:443', sni: 'www.microsoft.com', flow: 'xtls-rprx-vision' },
    },
    notesFa: [
      'مناسب سرورهای با منابع محدود (۵۱۲ مگابایت رم)؛ فقط هستهٔ Xray اجرا می‌شود.',
      'هستهٔ sing-box در حالت آماده‌باش می‌ماند تا مصرف حافظه به حداقل برسد.',
    ],
    notesEn: [
      'Ideal for 512 MB containers; runs only Xray-core with zero idle overhead.',
      'sing-box remains hibernated until needed.',
    ],
  },
  {
    id: 'lab',
    fa: 'کامل · CDN + TCP (دامنهٔ اختصاصی)',
    en: 'FULL STACK · CDN EDGE + TCP MUX',
    taglineFa: 'فعال‌سازی ترنسپورت‌های XHTTP، WebSocket 0-RTT و پروتکل‌های TCP برای دامنه‌های کلادفلر/اختصاصی',
    taglineEn: 'Enables XHTTP SplitHTTP, 0-RTT WebSocket, and TCP mux protocols for custom CDN domains',
    enables: [
      'vless-reality', 'ss-2022', 'anytls', 'vless-xhttp', 'vless-ws',
      'vless-httpupgrade', 'trojan-ws', 'trojan-tcp-tls', 'shadowtls', 'sb-vless-ws',
    ],
    disables: ['hysteria2', 'vless-grpc'],
    telegram: { mtproto: true, socks: true, http: true, faketlsHost: 'www.samsung.com' },
    overrides: {
      'vless-reality': { dest: 'www.microsoft.com:443', sni: 'www.microsoft.com', flow: 'xtls-rprx-vision' },
      anytls: { sni: 'www.apple.com' },
      'trojan-tcp-tls': { sni: 'aws.amazon.com' },
      shadowtls: { sni: 'dash.cloudflare.com' },
    },
    notesFa: [
      'ترنسپورت‌های دامنه‌محور (XHTTP با پدینگ تصادفی و WS با Early-Data 2048) برای عبور از کلادفلر و CDN فعال می‌شوند.',
      'هر پروتکل TLS روی پورت TCP یک SNI مجزا می‌گیرد تا مالتی‌پلکسر بدون تداخل مسیریابی کند.',
    ],
    notesEn: [
      'Activates domain-fronted CDN transports (XHTTP with randomized padding & 2048B 0-RTT WebSocket).',
      'Assigns non-overlapping SNIs to each TCP TLS inbound for zero-collision multiplexing.',
    ],
  },
];

export const PROFILE_MAP = new Map(PROFILES.map((p) => [p.id, p]));

export const IRAN_TIPS = [
  {
    fa: 'برای ترنسپورت‌های WS و XHTTP، دامنهٔ اختصاصی پشت کلادفلر یا IP تمیز تنظیم کن تا هندشیک 0-RTT با کمترین پینگ انجام شود.',
    en: 'Pair WS and XHTTP transports with a clean Cloudflare IP/domain to leverage 0-RTT early data with minimal RTT.',
  },
  {
    fa: 'هرگز از دامنه‌های گوگل برای SNI استفاده نکن؛ www.microsoft.com و www.apple.com پایدارترین هندشیک TLS 1.3 را دارند.',
    en: 'Avoid Google-owned SNIs; www.microsoft.com and www.apple.com maintain the highest TLS 1.3 survival rate.',
  },
  {
    fa: 'قابلیت TLS Fragment در پنل BBG به صورت خودکار در خروجی‌های JSON فعال است و ClientHello را به قطعات ۱۰۰ تا ۲۰۰ بایتی تقسیم می‌کند.',
    en: 'BBG automatically injects TLS ClientHello fragmentation (100–200B chunks, 10–20ms interval) into exported client configs.',
  },
  {
    fa: 'در کلاینت‌های موبایل روی شبکهٔ 4G/5G، مقدار MTU را روی 1400 قرار بده تا بسته‌های بزرگ TLS دچار دراپ نشوند.',
    en: 'On mobile 4G/5G networks, use MTU 1400 to prevent oversized TLS records from dropping mid-handshake.',
  },
  {
    fa: 'مسیریابی مستقیم IPهای دیتاسنتر تلگرام و `routeOnly: true` در BBG مشکل تأخیر ۲۰ ثانیه‌ای پیام‌رسان‌ها را به طور کامل برطرف کرده است.',
    en: 'BBG sets `routeOnly: true` on sniffing and routes Telegram DC CIDRs directly, completely eliminating the 20s messaging delay.',
  },
];

const EDGE_PRESETS = new Set([
  'vless-ws', 'vless-httpupgrade', 'vless-xhttp', 'vless-grpc',
  'trojan-ws', 'sb-vless-ws',
]);

const UDP_PRESETS = new Set(['hysteria2']);
const GRPC_PRESETS = new Set(['vless-grpc']);

function presetOf(inbound) {
  return inbound.presetId || inbound.preset || '';
}

function reachabilityOf(preset) {
  if (UDP_PRESETS.has(preset)) {
    return { via: 'udp', iran: 'off', fa: 'نیازمند پورت UDP عمومی روی سرور', en: 'Requires public UDP port on host' };
  }
  if (GRPC_PRESETS.has(preset)) {
    return {
      via: 'edge',
      iran: 'risky',
      fa: 'نیازمند پشتیبانی کامل HTTP/2 در لبهٔ دامنه یا CDN',
      en: 'Requires end-to-end HTTP/2 support on the CDN/edge domain',
    };
  }
  if (EDGE_PRESETS.has(preset)) {
    return { via: 'edge', iran: 'risky', fa: 'عبور از پورت HTTPS لبه / CDN (با 0-RTT و پدینگ)', en: 'Rides HTTPS edge / CDN (with 0-RTT & padding)' };
  }
  return { via: 'tcp', iran: 'good', fa: 'عبور مستقیم از پورت TCP مالتی‌پلکس؛ پایدارترین مسیر', en: 'Direct multiplexed TCP port; highest resilience' };
}

export function analyse({ doc, facts, cores }) {
  const inbounds = doc.inbounds || [];
  const enabled = inbounds.filter((i) => i.enabled);
  const rows = inbounds.map((ib) => {
    const preset = presetOf(ib);
    const reach = reachabilityOf(preset);
    return {
      id: ib.id,
      preset,
      label: ib.label,
      enabled: Boolean(ib.enabled),
      core: ib.core,
      port: ib.port,
      via: reach.via,
      iran: reach.iran,
      noteFa: reach.fa,
      noteEn: reach.en,
    };
  });

  const hasTcp = Boolean(facts.tcpHost && facts.tcpPort);
  const hasPublic = Boolean(facts.publicHost);
  const tg = (doc.settings && doc.settings.telegram) || {};
  const mtprotoOn = Boolean(tg.mtproto && tg.mtproto.enabled);

  const checks = [
    {
      id: 'tcp',
      ok: hasTcp,
      fa: hasTcp ? `پورت TCP مالتی‌پلکس فعال است (${facts.tcpHost}:${facts.tcpPort})` : 'پروکسی TCP را در تنظیمات شبکه فعال کنید (پورت 8443)',
      en: hasTcp ? `Multiplexed TCP port active (${facts.tcpHost}:${facts.tcpPort})` : 'Enable TCP proxy forwarding to port 8443',
    },
    {
      id: 'public',
      ok: hasPublic,
      fa: hasPublic ? `دامنهٔ لبهٔ HTTPS: ${facts.publicHost}` : 'دامنهٔ HTTPS تنظیم نشده (برای WS/XHTTP لازم است)',
      en: hasPublic ? `HTTPS edge domain: ${facts.publicHost}` : 'No public HTTPS domain configured (needed for WS/XHTTP)',
    },
    {
      id: 'reality',
      ok: enabled.some((i) => presetOf(i) === 'vless-reality' || presetOf(i) === 'sb-vless-reality'),
      fa: 'پروتکل ضد-فیلتر REALITY (Vision) فعال است',
      en: 'REALITY (Vision) anti-DPI inbound is active',
    },
    {
      id: 'opaque',
      ok: enabled.some((i) => presetOf(i) === 'ss-2022'),
      fa: 'Shadowsocks-2022 (BLAKE3) به عنوان مسیر سریع دوم فعال است',
      en: 'Shadowsocks-2022 (BLAKE3) fast-path is active',
    },
    {
      id: 'mtproto',
      ok: mtprotoOn && (cores.mtproto === 'running'),
      fa: mtprotoOn ? 'پروکسی MTProto FakeTLS تلگرام فعال است' : 'پروکسی MTProto تلگرام غیرفعال است',
      en: mtprotoOn ? 'Telegram MTProto FakeTLS proxy is active' : 'Telegram MTProto proxy is disabled',
    },
    {
      id: 'google-sni',
      ok: !enabled.some((i) => /google|gstatic|youtube/i.test(String((i.params && i.params.sni) || (i.params && i.params.dest) || ''))),
      fa: 'هیچ SNI حساسی (گوگل/یوتیوب) در اینباندها استفاده نشده است',
      en: 'Zero high-risk Google/YouTube SNIs in active inbounds',
    },
  ];

  const conflicts = (facts.plan && facts.plan.opaqueConflicts) || [];
  for (const c of conflicts) {
    const row = rows.find((r) => r.id === c.dropped);
    if (row) {
      row.iran = 'off';
      row.noteFa = 'روی پورت مشترک، فقط یک اینباند بدون TLS قابل مسیریابی است';
      row.noteEn = 'Only one non-TLS inbound per shared TCP port can be routed';
    }
  }
  if (conflicts.length) {
    checks.push({
      id: 'opaque-dupe',
      ok: false,
      fa: `${conflicts.length} اینباند بدون TLS اضافی وجود دارد؛ فقط اولین مورد مسیریابی می‌شود`,
      en: `${conflicts.length} duplicate non-TLS inbound(s) detected on shared port`,
    });
  }

  const players = rows.filter((r) => r.enabled);
  return {
    at: Date.now(),
    facts: { publicHost: facts.publicHost || null, tcpHost: facts.tcpHost || null, tcpPort: facts.tcpPort || 0 },
    cores,
    counts: {
      enabled: players.length,
      total: rows.length,
      tcp: players.filter((r) => r.via === 'tcp').length,
      edge: players.filter((r) => r.via === 'edge').length,
      telegram: [tg.mtproto?.enabled, tg.socks?.enabled, tg.http?.enabled].filter(Boolean).length,
    },
    checks,
    rows,
    tips: IRAN_TIPS,
    sniChoices: IRAN_SNI_CHOICES,
    faketlsChoices: IRAN_FAKETLS_CHOICES,
    profiles: PROFILES.map((p) => ({
      id: p.id, fa: p.fa, en: p.en, taglineFa: p.taglineFa, taglineEn: p.taglineEn,
      count: p.enables.length, notesFa: p.notesFa, notesEn: p.notesEn,
    })),
  };
}

export function applyProfile(doc, profileId) {
  const profile = PROFILE_MAP.get(profileId);
  if (!profile) throw new Error(`unknown profile: ${profileId}`);

  const want = new Set(profile.enables);
  const kill = new Set(profile.disables);
  const changed = [];

  const have = new Set((doc.inbounds || []).map(presetOf));
  for (const presetId of profile.enables) {
    if (have.has(presetId)) continue;
    const preset = presetById(presetId);
    if (!preset) continue;
    const used = new Set((doc.inbounds || []).map((ib) => ib.port));
    const base = preset.core === 'singbox' ? 12000 : 11000;
    let port = base + 1;
    while (used.has(port)) port += 1;
    const id = `ib${Math.random().toString(36).slice(2, 8)}`;
    doc.inbounds.push({
      id,
      presetId: preset.id,
      label: preset.title.en,
      enabled: true,
      routeKey: `bbg-${id}`,
      port,
      params: { ...preset.defaults, ...(profile.overrides[presetId] || {}) },
    });
    have.add(presetId);
    changed.push({ preset: presetId, label: preset.title.en, enabled: true, created: true });
  }

  for (const ib of doc.inbounds || []) {
    const preset = presetOf(ib);
    let next = ib.enabled;
    if (want.has(preset)) next = true;
    else if (kill.has(preset)) next = false;
    if (next !== ib.enabled) {
      changed.push({ preset, label: ib.label, enabled: next });
      ib.enabled = next;
    }
    if (next && profile.overrides[preset]) {
      ib.params = { ...(ib.params || {}), ...profile.overrides[preset] };
    }
  }

  const tg = doc.settings.telegram || (doc.settings.telegram = {});
  const before = {
    mtproto: Boolean(tg.mtproto && tg.mtproto.enabled),
    socks: Boolean(tg.socks && tg.socks.enabled),
    http: Boolean(tg.http && tg.http.enabled),
  };
  tg.mtproto = tg.mtproto || { engine: 'mtg', faketlsHost: 'www.samsung.com', secret: '', listenPort: 0 };
  tg.socks = tg.socks || { user: 'bbg', pass: '' };
  tg.http = tg.http || { user: 'bbg', pass: '' };
  tg.mtproto.enabled = Boolean(profile.telegram.mtproto);
  tg.socks.enabled = Boolean(profile.telegram.socks);
  tg.http.enabled = Boolean(profile.telegram.http);
  if (tg.mtproto.enabled) {
    if (profile.telegram.faketlsHost) tg.mtproto.faketlsHost = profile.telegram.faketlsHost;
    if (!tg.mtproto.faketlsHost) tg.mtproto.faketlsHost = 'www.samsung.com';
  }

  doc.settings.easySetup = { profile: profile.id, appliedAt: Date.now() };

  return {
    profile: profile.id,
    changed,
    telegram: { before, after: profile.telegram },
    enabledPresets: (doc.inbounds || []).filter((i) => i.enabled).map(presetOf),
  };
}
