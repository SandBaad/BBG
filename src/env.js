/**
 * BBG — Runtime Environment & Configuration
 * Author / Maintainer: SANDBAAD
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const APP = {
  brand: 'BBG',
  tag: 'CORE',
  author: 'SANDBAAD',
  version: '2.1.0',
  edition: 'ENTERPRISE',
  repo: process.env.BBG_REPO || '',
  telegram: process.env.BBG_TELEGRAM_CONTACT || '',
};

function pickDataDir() {
  const explicit = process.env.DATA_DIR || process.env.BBG_DATA_DIR;
  if (explicit) return path.resolve(explicit);
  const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (volume) return path.resolve(volume);
  for (const candidate of ['/data', path.join(ROOT, 'data')]) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch { /* try next */ }
  }
  return path.join(ROOT, 'data');
}

export const DATA_DIR = pickDataDir();
export const DATA_FILE = path.join(DATA_DIR, 'bbg.json');
export const LOG_DIR = path.join(DATA_DIR, 'logs');
export const STATE_DIR = path.join(DATA_DIR, 'state');
export const BIN_DIR = process.env.BBG_BIN_DIR || path.join(ROOT, 'bin');

/** Public panel port (injected by edge/container runtime). */
export const PORT = Number(process.env.PORT || 8080);
/** Internal port used by the TCP multiplexer. */
export const MUX_PORT = Number(process.env.BBG_TCP_PORT || 8443);

/**
  * Candidate ports the HTTP control plane listens on (excluding the TCP mux port).
  */
export const PANEL_PORTS = (() => {
  const out = new Set();
  const explicit = Number(process.env.BBG_PANEL_PORT || 0) || 0;
  if (explicit > 0) out.add(explicit);
  if (PORT > 0) out.add(PORT);
  out.add(8080);
  out.add(3000);
  return [...out].filter((p) => Number.isInteger(p) && p > 0 && p !== MUX_PORT);
})();

export const PORT_CONFLICT = PORT === MUX_PORT;

/** Edge & container environment discovery. */
export const RAILWAY = {
  publicDomain: (process.env.BBG_PUBLIC_DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN || '').trim(),
  privateDomain: (process.env.RAILWAY_PRIVATE_DOMAIN || '').trim(),
  tcpDomain: (process.env.BBG_TCP_PROXY_DOMAIN || process.env.RAILWAY_TCP_PROXY_DOMAIN || '').trim(),
  tcpPort: Number(process.env.BBG_TCP_PROXY_PORT || process.env.RAILWAY_TCP_PROXY_PORT || 0) || 0,
  tcpAppPort: Number(process.env.RAILWAY_TCP_APPLICATION_PORT || 0) || 0,
  region: (process.env.CF_RAY || process.env.RAILWAY_REPLICA_REGION || '').trim(),
  serviceName: (process.env.BBG_SERVICE_NAME || process.env.RAILWAY_SERVICE_NAME || 'bbg-edge').trim(),
  projectName: (process.env.BBG_PROJECT_NAME || process.env.RAILWAY_PROJECT_NAME || 'BBG').trim(),
  volumePath: (process.env.RAILWAY_VOLUME_MOUNT_PATH || '').trim(),
};

/** Core binary locations. */
export const BIN = {
  xray: process.env.BBG_XRAY_BIN || path.join(BIN_DIR, 'xray'),
  singbox: process.env.BBG_SINGBOX_BIN || path.join(BIN_DIR, 'sing-box'),
  mtg: process.env.BBG_MTG_BIN || path.join(BIN_DIR, 'mtg'),
};

export const LIMITS = {
  maxUsers: Number(process.env.BBG_MAX_USERS || 500),
  logLines: Number(process.env.BBG_LOG_LINES || 400),
  statsIntervalMs: Number(process.env.BBG_STATS_INTERVAL_MS || 15000),
  maxBodyBytes: 256 * 1024,
};

export const IS_RAILWAY = Boolean(RAILWAY.publicDomain || RAILWAY.tcpDomain || process.env.RAILWAY_ENVIRONMENT_ID);

/**
 * Trust X-Forwarded-For only behind a known reverse proxy (Railway, or when
 * BBG_TRUST_PROXY=1). The proxy appends the real client address last.
 */
export const TRUST_PROXY = process.env.BBG_TRUST_PROXY === '1' || (Boolean(process.env.RAILWAY_ENVIRONMENT_ID) && process.env.BBG_TRUST_PROXY !== '0');

/** Optional first-boot admin (otherwise /setup needs the key printed in the log). */
export const BOOT_ADMIN = {
  user: (process.env.BBG_ADMIN_USER || 'admin').trim(),
  pass: process.env.BBG_ADMIN_PASSWORD || '',
};
export const NODE_ENV = process.env.NODE_ENV || 'production';

export function ensureDirs() {
  for (const dir of [DATA_DIR, LOG_DIR, STATE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
