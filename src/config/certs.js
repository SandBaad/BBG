/**
 * BBG — TLS Certificates & REALITY X25519 Key Management
 * Author / Maintainer: SANDBAAD
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { STATE_DIR } from '../env.js';

const CERT_DIR = path.join(STATE_DIR, 'certs');

/**
 * Self-signed certificate for TLS inbounds (AnyTLS, Trojan, ShadowTLS, Hysteria2).
 * Its names follow the SNIs those inbounds use, so a probe that connects with
 * the expected SNI sees a matching name instead of a panel-specific one.
 * Clients pin it by SHA-256 (see certPin), so the issuer does not matter to them.
 */
export function ensureCerts(snis = []) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const certPath = path.join(CERT_DIR, 'tls-cert.pem');
  const keyPath = path.join(CERT_DIR, 'tls-key.pem');
  const namesPath = path.join(CERT_DIR, 'names.json');
  const names = [...new Set(snis.map((x) => String(x || '').toLowerCase()).filter((x) => /^[a-z0-9.-]+$/.test(x)))].sort();
  if (!names.length) names.push('www.apple.com');
  let current = [];
  try { current = JSON.parse(fs.readFileSync(namesPath, 'utf8')); } catch { current = []; }
  const fresh = !fs.existsSync(certPath) || !fs.existsSync(keyPath) || JSON.stringify(current) !== JSON.stringify(names);
  if (fresh) {
    try {
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'ec',
        '-pkeyopt', 'ec_paramgen_curve:prime256v1',
        '-nodes', '-days', '825',
        '-subj', `/CN=${names[0]}`,
        '-addext', `subjectAltName=${names.map((n) => `DNS:${n}`).join(',')}`,
        '-keyout', keyPath, '-out', certPath,
      ], { stdio: 'pipe' });
      fs.chmodSync(keyPath, 0o600);
      fs.writeFileSync(namesPath, JSON.stringify(names));
    } catch (err) {
      console.error('[certs] openssl failed:', err.message);
    }
  }
  return {
    certificateFile: fs.existsSync(certPath) ? certPath : null,
    keyFile: fs.existsSync(keyPath) ? keyPath : null,
    names,
  };
}

/**
 * SHA-256 fingerprint of the generated certificate (hex), used for peer cert pinning
 * in Xray 25.x+/26.x (`pinnedPeerCertSha256`).
 */
export function certPin() {
  try {
    const certPath = path.join(CERT_DIR, 'tls-cert.pem');
    if (!fs.existsSync(certPath)) return '';
    const pem = fs.readFileSync(certPath, 'utf8');
    const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    if (!b64) return '';
    const der = Buffer.from(b64, 'base64');
    return crypto.createHash('sha256').update(der).digest('hex');
  } catch {
    return '';
  }
}

/** X25519 keypair in base64url form for REALITY. */
export function generateRealityKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    privateKey: privateKey.export({ format: 'jwk' }).d,
    publicKey: publicKey.export({ format: 'jwk' }).x,
    shortIds: [crypto.randomBytes(4).toString('hex'), crypto.randomBytes(8).toString('hex')],
  };
}

/** Persistent REALITY key material. */
export function ensureReality() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, 'reality.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed.privateKey && parsed.publicKey) return parsed;
  } catch { /* generate fresh below */ }
  const keys = generateRealityKeys();
  fs.writeFileSync(file, JSON.stringify(keys, null, 2));
  return keys;
}
