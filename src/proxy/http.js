/**
 * BBG · By SANDBAAD — HTTP / HTTPS (CONNECT) Forward Proxy
 *
 * Multiplexed onto the shared TCP port with TCP_NODELAY and coalesced header
 * writes for responsive browser and Telegram Desktop sessions.
 */
import net from 'node:net';
import tls from 'node:tls';

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
    if (!auth || !auth.user) return true;
    if (!header || !header.startsWith('Basic ')) return false;
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      return decoded.slice(0, idx) === auth.user && decoded.slice(idx + 1) === auth.pass;
    } catch {
      return false;
    }
  }

  handle(socket, firstChunk) {
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

  dispatch(socket, head, rest) {
    const lines = head.split('\r\n');
    const [method, target, version] = lines[0].split(' ');
    const headers = {};
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
    }
    if (!this.authorized(headers['proxy-authorization'])) {
      this.stats.denied += 1;
      socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="BBG"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
      );
      return;
    }

    if (method === 'CONNECT') {
      const [host, portRaw] = target.split(':');
      const port = Number(portRaw || 443);
      const upstream = net.connect({ host, port, noDelay: true, keepAlive: true, keepAliveInitialDelay: 15000 }, () => {
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
      const cleanup = () => {
        this.stats.active = Math.max(0, this.stats.active - 1);
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

    let url;
    try {
      url = new URL(target);
    } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const port = Number(url.port || 80);
    const upstream = net.connect({ host: url.hostname, port, noDelay: true }, () => {
      upstream.setNoDelay(true);
      this.stats.conns += 1;
      this.stats.active += 1;
      const forwarded = { ...headers };
      delete forwarded['proxy-authorization'];
      delete forwarded['proxy-connection'];
      const path = `${url.pathname}${url.search}`;
      const rebuilt = [
        `${method} ${path} ${version || 'HTTP/1.1'}`,
        ...Object.entries(forwarded).map(([k, v]) => `${k}: ${v}`),
        'Connection: close',
        '',
        '',
      ].join('\r\n');
      if (rest.length) {
        upstream.write(Buffer.concat([Buffer.from(rebuilt, 'latin1'), rest]));
      } else {
        upstream.write(rebuilt);
      }
      socket.pipe(upstream);
      upstream.pipe(socket);
      socket.on('data', (d) => {
        this.stats.up += d.length;
      });
      upstream.on('data', (d) => {
        this.stats.down += d.length;
      });
    });
    const cleanup = () => {
      this.stats.active = Math.max(0, this.stats.active - 1);
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
