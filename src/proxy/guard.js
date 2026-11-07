/**
 * BBG · SANDBAAD — destination guard for the built-in SOCKS5 / HTTP proxies.
 *
 * Resolves the destination first and refuses loopback, private, link-local,
 * CGNAT, multicast and cloud-metadata addresses, so proxy users can never reach
 * the panel, the Xray API or anything else on the host's internal network.
 */
import net from 'node:net';
import dns from 'node:dns/promises';

const V4_BLOCK = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function v4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0) >>> 0;
}

export function isBlockedIp(ip) {
  let addr = String(ip || '').toLowerCase();
  if (addr.startsWith('::ffff:') && net.isIPv4(addr.slice(7))) addr = addr.slice(7);
  if (net.isIPv4(addr)) {
    const n = v4ToInt(addr);
    return V4_BLOCK.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (n & mask) === (v4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(addr)) {
    return addr === '::' || addr === '::1' || /^f[cd]/.test(addr) || /^fe[89ab]/.test(addr) || addr.startsWith('ff') || addr.startsWith('64:ff9b:');
  }
  return true;
}

/** Resolve `host` and return a safe IP to dial, or throw. */
export async function resolveSafe(host) {
  const name = String(host || '').replace(/^\[|\]$/g, '');
  if (!name || name.length > 253) throw new Error('bad host');
  if (/^localhost\.?$/i.test(name) || /\.localhost\.?$/i.test(name)) throw new Error('blocked destination');
  if (net.isIP(name)) {
    if (isBlockedIp(name)) throw new Error('blocked destination');
    return name;
  }
  const answers = await dns.lookup(name, { all: true, verbatim: true });
  if (!answers.length) throw new Error('no address');
  if (answers.some((a) => isBlockedIp(a.address))) throw new Error('blocked destination');
  return answers[0].address;
}

export function validPort(port) {
  const p = Number(port);
  return Number.isInteger(p) && p > 0 && p < 65536;
}
