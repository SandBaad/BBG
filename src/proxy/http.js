/**
 * BBG · By SANDBAAD — HTTP / HTTPS (CONNECT) Forward Proxy
 *
 * Multiplexed onto the shared TCP port with TCP_NODELAY and coalesced header
 * writes for responsive browser and Telegram Desktop sessions.
 */
import net from 'node:net';
import tls from 'node:tls';
import { timingSafeEqual } from 'node:crypto';
import { resolveSafe, validPort } from './guard.js';

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export class HttpProxyServer {
  constructor({ getUser }) {
    this.getUser = getUser;
    this.stats = { conns: 0, active: 0, up: 0, down: 0, denied: 0 };
  }

  state() {
    return { ...this.stats };
  }

  authorized(header) {
    const auth = this.getUser();
    if (!auth || !auth.user || !auth.pass) return false;
    if (!header || !header.startsWith('Basic ')) return false;
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx < 0) return false;
      return same(decoded.slice(0, idx), auth.user) && same(decoded.slice(idx + 1), auth.pass);
    } catch {
      return false;
    }
  }

  handle(socket, firstChunk) {
    const auth = this.getUser();
    if (!auth || !auth.user || !auth.pass) {
      this.stats.denied += 1;
      socket.destroy();
      return;
    }
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15000);
    let buffer = firstChunk && firstChunk.length ? firstChunk : Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 16384 && buffer.indexOf('\r\n\r\n') === -1) {
        socket.destroy();
        return;
      }
      const end = buffer.indexOf('\r\n\r\n');
      if (end === -1) return;
      socket.off('data', onData);
      const head = buffer.subarray(0, end).toString('latin1');
      const rest = buffer.subarray(end + 4);
      this.dispatch(socket, head, rest);
    };
    socket.on('data', onData);
    socket.on('error', () => {});
    if (buffer.length) onData(Buffer.alloc(0));
  }

  async dispatch(socket, head, rest) {
    const lines = head.split('\r\n');
    const [method, target] = lines[0].split(' ');
    const headers = {};
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
    }
    if (!this.authorized(headers['proxy-authorization'])) {
      this.stats.denied += 1;
      socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="proxy"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
      );
      return;
    }

    if (method === 'CONNECT') {
      const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(String(target || ''));
      const host = m ? m[1] : '';
      const port = m ? Number(m[2]) : 0;
      let ip;
      try {
        if (!host || !validPort(port)) throw new Error('bad target');
        ip = await resolveSafe(host);
      } catch {
        this.stats.denied += 1;
        socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        return;
      }
      let counted = false;
      const upstream = net.connect({ host: ip, port, noDelay: true, keepAlive: true, keepAliveInitialDelay: 15000 }, () => {
        counted = true;
        upstream.setNoDelay(true);
        upstream.setKeepAlive(true, 15000);
        this.stats.conns += 1;
        this.stats.active += 1;
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (rest.length) upstream.write(rest);
        socket.pipe(upstream);
        upstream.pipe(socket);
        socket.on('data', (d) => {
          this.stats.up += d.length;
        });
        upstream.on('data', (d) => {
          this.stats.down += d.length;
        });
      });
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (counted) this.stats.active = Math.max(0, this.stats.active - 1);
        socket.destroy();
        upstream.destroy();
      };
      upstream.on('error', () => {
        try {
          socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
        } catch {
          /* ignore */
        }
        cleanup();
      });
      socket.on('error', cleanup);
      socket.on('close', cleanup);
      upstream.on('close', cleanup);
      return;
    }
    socket.end('HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  }
}

/** TLS reachability probe used by the diagnostics engine. */
export function checkTls(host, port = 443, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, timeout }, () => {
      resolve({ ok: true, protocol: socket.getProtocol() });
      socket.destroy();
    });
    socket.on('error', (err) => resolve({ ok: false, error: err.message }));
    socket.on('timeout', () => {
      resolve({ ok: false, error: 'timeout' });
      socket.destroy();
    });
  });
}
