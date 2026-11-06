/**
 * BBG — Shared Cryptographic Key Derivation
 * Author / Maintainer: SANDBAAD
 */
import crypto from 'node:crypto';

/**
 * Deterministic Shadowsocks-2022 server PSK for an inbound.
 */
export function ssServerKey(serverSecret, inboundId, method = '2022-blake3-aes-128-gcm') {
  const len = String(method).endsWith('aes-256-gcm') || String(method).includes('chacha20') ? 32 : 16;
  const mac = crypto.createHmac('sha256', String(serverSecret || 'bbg-core')).update(`ss:${inboundId}:${len}`).digest();
  return mac.subarray(0, len).toString('base64');
}

/** Deterministic shared password for AEAD Shadowsocks inbounds. */
export function legacySsPassword(serverSecret, inboundId) {
  return crypto
    .createHmac('sha256', String(serverSecret || 'bbg-core'))
    .update(`ss-aead:${inboundId}`)
    .digest('base64')
    .slice(0, 28);
}
