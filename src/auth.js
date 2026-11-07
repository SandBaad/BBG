/**
 * BBG Panel Authentication
 * Author / Maintainer: SANDBAAD
 *
 * Scrypt password hashing, HMAC-SHA256 signed session cookies, and brute-force rate limiting.
 */
import crypto from 'node:crypto';

const COOKIE = 'bbg_session';
const safe = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7;

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt, hash: derived.toString('hex'), algo: 'scrypt' };
}

export function verifyPassword(password, admin) {
  if (!admin || !admin.salt || !admin.hash) return false;
  const derived = crypto.scryptSync(String(password), admin.salt, 64, { N: 16384, r: 8, p: 1 });
  const a = Buffer.from(derived.toString('hex'));
  const b = Buffer.from(admin.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyToken(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!mac || !safe(mac, expect)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

const secureFlag = (req) => (req && (req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted) ? '; Secure' : '');

/** `version` changes when the password changes, which signs out every old session. */
export function issueSession(res, secret, username, version = 1, req = null) {
  const token = signToken({ u: username, v: version, iat: Date.now(), exp: Date.now() + SESSION_TTL }, secret);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL / 1000)}${secureFlag(req)}`);
  return token;
}

export function clearSession(res, req = null) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag(req)}`);
}

export function readSession(req, secret) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return verifyToken(v.join('='), secret);
  }
  return null;
}

/* ── Brute-force protection ──────────────────────────────────────────── */

const attempts = new Map();

export function throttle(key, { max = 8, windowMs = 5 * 60 * 1000 } = {}) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > windowMs) {
    attempts.set(key, { first: now, count: 1 });
    return { blocked: false, remaining: max - 1 };
  }
  entry.count += 1;
  if (attempts.size > 10000) {
    for (const [k, v] of attempts) if (now - v.first > windowMs) attempts.delete(k);
  }
  if (entry.count > max) return { blocked: true, retryInMs: windowMs - (now - entry.first) };
  return { blocked: false, remaining: max - entry.count };
}

export function clearThrottle(key) {
  attempts.delete(key);
}

/**
 * Legacy deterministic token (v2.0). Only used once, to give existing users a
 * stored token equal to their old link so nothing breaks after the upgrade.
 * New and rotated users get a random token (see store.normalizeUser).
 */
export function legacySubToken(secret, userId) {
  return crypto.createHmac('sha256', secret).update(`sub:${userId}`).digest('base64url').slice(0, 24);
}

export function randomSubToken() {
  return crypto.randomBytes(18).toString('base64url');
}
