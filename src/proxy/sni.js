/**
 * BBG · By SANDBAAD — Fragment-Aware TLS ClientHello (SNI) Parser & Classifier
 *
 * Reassembles multi-record TLS Handshake frames so clients using TLS Record
 * Fragmentation (sing-box `record_fragment` / Xray `tlshello` fragment) are
 * routed accurately by SNI without falling through or timing out.
 */
import crypto from 'node:crypto';

export function peekSni(buf) {
  if (!buf || !buf.length) return null;
  if (buf[0] !== 0x16) return null; // Not a TLS handshake record
  if (buf.length < 5) return { incomplete: true, sni: '' };
  if (buf[1] !== 0x03) return null;

  // Reassemble one or more contiguous TLS Handshake (0x16) records
  const chunks = [];
  let offset = 0;
  let totalPayload = 0;
  let recordIncomplete = false;

  while (offset + 5 <= buf.length) {
    if (buf[offset] !== 0x16 || buf[offset + 1] !== 0x03) break;
    const recLen = buf.readUInt16BE(offset + 3);
    if (offset + 5 + recLen > buf.length) {
      chunks.push(buf.subarray(offset + 5));
      totalPayload += buf.length - (offset + 5);
      recordIncomplete = true;
      break;
    }
    chunks.push(buf.subarray(offset + 5, offset + 5 + recLen));
    totalPayload += recLen;
    offset += 5 + recLen;
  }

  if (totalPayload < 4) {
    return { incomplete: true, sni: '' };
  }

  const hs = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, totalPayload);
  if (hs[0] !== 0x01) {
    return { sni: '', notClientHello: true };
  }

  const hsLen = (hs[1] << 16) | (hs[2] << 8) | hs[3];
  const fullHandshakeAvailable = hs.length >= 4 + hsLen;

  let pos = 4; // skip handshake type(1) + length(3)
  pos += 2 + 32; // client_version(2) + random(32)
  if (pos >= hs.length) return { incomplete: true, sni: '' };

  const sessionIdLen = hs[pos];
  pos += 1 + sessionIdLen;
  if (pos + 2 > hs.length) return { incomplete: true, sni: '' };

  const cipherLen = hs.readUInt16BE(pos);
  pos += 2 + cipherLen;
  if (pos + 1 > hs.length) return { incomplete: true, sni: '' };

  const compLen = hs[pos];
  pos += 1 + compLen;
  if (pos + 2 > hs.length) {
    return fullHandshakeAvailable ? { sni: '', incomplete: false } : { incomplete: true, sni: '' };
  }

  const extTotal = hs.readUInt16BE(pos);
  pos += 2;
  const extEnd = Math.min(hs.length, pos + extTotal);

  while (pos + 4 <= extEnd) {
    const type = hs.readUInt16BE(pos);
    const len = hs.readUInt16BE(pos + 2);
    pos += 4;
    if (pos + len > hs.length) {
      return { incomplete: true, sni: '' };
    }
    if (type === 0x0000) {
      // server_name extension
      let p = pos + 2; // skip server_name_list length
      while (p + 3 <= pos + len) {
        const nameType = hs[p];
        const nameLen = hs.readUInt16BE(p + 1);
        p += 3;
        if (nameType === 0 && p + nameLen <= pos + len) {
          return {
            sni: hs.subarray(p, p + nameLen).toString('latin1').toLowerCase(),
            incomplete: false,
          };
        }
        p += nameLen;
      }
      return { sni: '', incomplete: false };
    }
    pos += len;
  }

  if (!fullHandshakeAvailable || recordIncomplete) {
    return { incomplete: true, sni: '' };
  }
  return { sni: '', incomplete: false };
}

/** Fast first-packet protocol classification for the TCP multiplexer. */
export function classify(buf) {
  if (!buf || !buf.length) return 'unknown';
  if (buf[0] === 0x16 && (buf.length === 1 || buf[1] === 0x03)) return 'tls';
  if (buf[0] === 0x05) return 'socks5';
  const head = buf.subarray(0, 8).toString('latin1').toUpperCase();
  if (head.startsWith('CONNECT ')) return 'http-connect';
  if (head.startsWith('GET ') || head.startsWith('POST ') || head.startsWith('HEAD ')) return 'http';
  return 'opaque';
}

const MTPROTO_TAGS = new Set([0xeeeeeeee, 0xdddddddd, 0xefefefef, 0x50545448]);

/**
 * Detects MTProto obfuscated2 frames (both unencrypted and AES-256-CTR encrypted
 * when the 16-byte proxy secret is known).
 */
export function looksLikeMtproto(buf, secretHex = '') {
  if (!buf || buf.length < 64) return false;
  if (MTPROTO_TAGS.has(buf.readUInt32LE(56))) return true;

  const clean = String(secretHex || '').trim().toLowerCase();
  let rawSecretHex = '';
  if (/^[0-9a-f]{32}$/.test(clean)) rawSecretHex = clean;
  else if (/^(dd|ee)[0-9a-f]{32}/.test(clean)) rawSecretHex = clean.slice(2, 34);
  if (!rawSecretHex) return false;

  try {
    const secretBytes = Buffer.from(rawSecretHex, 'hex');
    const keyMaterial = Buffer.concat([buf.subarray(8, 40), secretBytes]);
    const aesKey = crypto.createHash('sha256').update(keyMaterial).digest();
    const iv = buf.subarray(40, 56);
    const decipher = crypto.createDecipheriv('aes-256-ctr', aesKey, iv);
    const decrypted = Buffer.concat([decipher.update(buf.subarray(0, 64)), decipher.final()]);
    return MTPROTO_TAGS.has(decrypted.readUInt32LE(56));
  } catch {
    return false;
  }
}
