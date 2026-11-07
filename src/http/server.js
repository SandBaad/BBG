/**
 * BBG · By SANDBAAD — High-Performance Edge HTTP & WebSocket Reverse Proxy
 *
 *   /            → BBG Admin Dashboard V2
 *   /api/*       → JSON Control Plane API
 *   /sub/:token  → Hardened Multi-Format Subscription Engine
 *   /u/:token    → Subscriber Self-Service Portal
 *   /bbg-xxxx/*  → Pooled reverse-proxy into Xray / sing-box inbounds
 *                  (0-RTT WebSocket, HTTPUpgrade, XHTTP SplitHTTP, gRPC)
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { ROOT } from '../env.js';
import { handleApi } from './api.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const STATIC_CACHE = new Map();

/** Persistent loopback agent for XHTTP / SplitHTTP subrequests to eliminate TCP setup overhead. */
const UPSTREAM_AGENT = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 256,
  maxFreeSockets: 64,
});

function staticEntry(file) {
  const stat = fs.statSync(file);
  const hit = STATIC_CACHE.get(file);
  if (hit && hit.mtime === stat.mtimeMs) return hit;
  const raw = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const compressible = /^(text\/|application\/(json|javascript|xml))/.test(MIME[ext] || '');
  const entry = {
    mtime: stat.mtimeMs,
    raw,
    gzip: compressible && raw.length > 1024 ? zlib.gzipSync(raw, { level: 6 }) : null,
    type: MIME[ext] || 'application/octet-stream',
    ext,
  };
  STATIC_CACHE.set(file, entry);
  return entry;
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  if (rel === 'portal.html' || rel === 'sprite.svg') return false;
  if (rel.includes('..')) {
    res.writeHead(400).end('bad request');
    return true;
  }
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const entry = staticEntry(file);
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = acceptsGzip && entry.gzip ? entry.gzip : entry.raw;
  const headers = {
    'Content-Type': entry.type,
    'Content-Length': body.length,
    'Cache-Control': ['.html', '.js', '.mjs', '.css', '.svg', '.json', '.webmanifest'].includes(entry.ext)
      ? 'no-cache'
      : 'public, max-age=604800',
    ETag: `"${entry.mtime.toString(36)}-${entry.raw.length.toString(36)}"`,
    Vary: 'Accept-Encoding',
  };
  if (entry.ext === '.html') {
    headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    headers['X-Frame-Options'] = 'DENY';
  }
  if (entry.gzip && acceptsGzip) headers['Content-Encoding'] = 'gzip';
  if (req.headers['if-none-match'] === headers.ETag) {
    res.writeHead(304, { ETag: headers.ETag, 'Cache-Control': headers['Cache-Control'] });
    res.end();
    return true;
  }
  res.writeHead(200, headers);
  res.end(body);
  return true;
}

export function createPanelServer({ runtime, api }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/sub/') || url.pathname.startsWith('/u/')) {
      handleApi({ req, res, url, runtime, api }).catch((err) => {
        const known = err && /^(body too large|invalid json)$/.test(err.message);
        if (!known) console.error('[api]', err);
        if (res.writableEnded || res.destroyed) return;
        if (!res.headersSent) res.writeHead(known ? 400 : 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: known ? err.message : 'internal error' }));
      });
      return;
    }

    // Reverse proxy into the cores (path-routed XHTTP / HTTP inbounds).
    for (const route of api.httpRoutes()) {
      if (url.pathname === route.prefix || url.pathname.startsWith(`${route.prefix}/`)) {
        proxyHttp(req, res, route.port);
        return;
      }
    }

    if (serveStatic(req, res, url.pathname)) return;
    if (serveStatic(req, res, '/index.html')) return;
    res.writeHead(404).end('not found');
  });

  server.on('connection', (socket) => {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15000);
  });

  server.on('upgrade', (req, socket, head) => {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15000);
    const url = new URL(req.url, 'http://localhost');
    for (const route of api.httpRoutes()) {
      if (url.pathname === route.prefix || url.pathname.startsWith(`${route.prefix}/`)) {
        proxyUpgrade(req, socket, head, route.port);
        return;
      }
    }
    socket.destroy();
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  return server;
}

function proxyHttp(req, res, port) {
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  delete headers['accept-encoding'];
  const proxyReq = http.request(
    {
      host: '127.0.0.1',
      port,
      method: req.method,
      path: req.url,
      headers,
      agent: UPSTREAM_AGENT,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.setNoDelay(true);
  proxyReq.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('bad gateway');
  });
  req.pipe(proxyReq);
}

function proxyUpgrade(req, socket, head, port) {
  const upstream = net.connect(
    { host: '127.0.0.1', port, noDelay: true, keepAlive: true, keepAliveInitialDelay: 15000 },
    () => {
      upstream.setNoDelay(true);
      upstream.setKeepAlive(true, 15000);
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      const headerBuf = Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'latin1');
      // Coalesce upgrade headers + 0-RTT early data payload into a single TCP write
      if (head && head.length) {
        upstream.write(Buffer.concat([headerBuf, head]));
      } else {
        upstream.write(headerBuf);
      }
      socket.pipe(upstream);
      upstream.pipe(socket);
    },
  );
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
}
