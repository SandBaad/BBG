/**
 * BBG · By SANDBAAD — Intelligent Single-Port TCP Multiplexer
 *
 * Routes multiple concurrent protocols over a single public TCP port with
 * fragment-aware SNI inspection, TCP_NODELAY, and zero-copy socket piping:
 *
 *   TLS ClientHello  → SNI-based routing (REALITY / AnyTLS / ShadowTLS / FakeTLS MTProto)
 *   SOCKS5 greeting  → Built-in SOCKS5 server        (t.me/socks)
 *   CONNECT / GET    → HTTP forward proxy            (http://user:pass@host:port)
 *   Opaque frames    → MTProto obfuscated2 or Shadowsocks-2022
 */
import net from 'node:net';
import { peekSni, classify, looksLikeMtproto } from './sni.js';

export class Mux {
  constructor({ socks5, httpProxy, resolvePlan, panelPort }) {
    this.socks5 = socks5;
    this.httpProxy = httpProxy;
    this.resolvePlan = resolvePlan; // () => plan
    this.panelPort = panelPort;
    this.server = null;
    this.stats = {
      total: 0,
      tls: 0,
      socks: 0,
      http: 0,
      mtproto: 0,
      xray: 0,
      singbox: 0,
      up: 0,
      down: 0,
      active: 0,
    };
  }

  listen(port, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      const server = net.createServer({ noDelay: true, keepAlive: true, keepAliveInitialDelay: 15000 }, (socket) =>
        this.onConnection(socket),
      );
      server.on('error', reject);
      server.listen(port, host, () => {
        this.server = server;
        this.port = port;
        resolve(server.address());
      });
    });
  }

  close() {
    if (this.server) this.server.close();
  }

  state() {
    return {
      listening: Boolean(this.server && this.server.listening),
      ...this.stats,
      socks5: this.socks5.state(),
      http: { ...this.httpProxy.state(), ...this.stats.httpState },
    };
  }

  onConnection(socket) {
    this.stats.total += 1;
    this.stats.active += 1;
    socket.on('close', () => {
      this.stats.active = Math.max(0, this.stats.active - 1);
    });
    socket.on('error', () => {});
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15000);

    const plan = this.resolvePlan();
    const onFirst = (chunk) => {
      socket.off('data', onFirst);
      socket.pause();
      try {
        this.routeFirst(socket, chunk, plan);
      } catch (err) {
        console.error('[mux] routing failed:', err.message);
        socket.destroy();
      }
    };
    socket.on('data', onFirst);
    setTimeout(() => {
      if (socket.readable && socket.bytesRead === 0) socket.destroy();
    }, 15000).unref?.();
  }

  routeFirst(socket, chunk, plan) {
    const kind = classify(chunk);
    if (kind === 'socks5') {
      this.stats.socks += 1;
      socket.resume();
      this.socks5.handle(socket, chunk);
      return;
    }
    if (kind === 'http-connect') {
      this.stats.http += 1;
      socket.resume();
      this.httpProxy.handle(socket, chunk);
      return;
    }
    if (kind === 'http') {
      this.stats.http += 1;
      socket.resume();
      this.toPanel(socket, chunk);
      return;
    }
    if (kind === 'tls') {
      this.stats.tls += 1;
      this.routeTls(socket, chunk, plan);
      return;
    }
    if (plan.mtprotoPort && looksLikeMtproto(chunk, plan.mtprotoSecret)) {
      this.stats.mtproto += 1;
      this.pipeTo(socket, chunk, plan.mtprotoPort, 'mtproto');
      return;
    }
    if (plan.opaquePort) {
      if (plan.opaqueCore === 'singbox') this.stats.singbox += 1;
      else this.stats.xray += 1;
      this.pipeTo(socket, chunk, plan.opaquePort, 'core');
      return;
    }
    if (plan.mtprotoPort) {
      this.stats.mtproto += 1;
      this.pipeTo(socket, chunk, plan.mtprotoPort, 'mtproto');
      return;
    }
    this.stats.dropped = (this.stats.dropped || 0) + 1;
    socket.destroy();
  }

  routeTls(socket, firstChunk, plan) {
    let buffer = firstChunk;
    const decide = () => {
      const info = peekSni(buffer);
      if (info && info.incomplete && buffer.length < 16384) return false;
      const sni = (info && info.sni) || '';
      let target = plan.sniMap[sni] || null;
      if (!target && plan.mtprotoFakeTls && sni === plan.mtprotoFakeTls) {
        target = { port: plan.mtprotoPort, kind: 'mtproto' };
      }
      if (!target && plan.defaultTls) target = plan.defaultTls;
      if (!target && plan.mtprotoPort) target = { port: plan.mtprotoPort, kind: 'mtproto' };
      if (!target) {
        socket.destroy();
        return true;
      }
      if (target.kind === 'mtproto') this.stats.mtproto += 1;
      else if (target.core === 'singbox') this.stats.singbox += 1;
      else this.stats.xray += 1;
      this.pipeTo(socket, buffer, target.port, target.kind);
      buffer = null;
      return true;
    };
    if (decide()) return;
    const onMore = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (decide()) socket.off('data', onMore);
    };
    socket.on('data', onMore);
    socket.resume();
    setTimeout(() => {
      socket.off('data', onMore);
      if (buffer) {
        // Flush on timeout using best-effort fallback
        const fallback = plan.defaultTls || (plan.mtprotoPort ? { port: plan.mtprotoPort, kind: 'mtproto' } : null);
        if (fallback) {
          this.pipeTo(socket, buffer, fallback.port, fallback.kind);
          buffer = null;
        } else {
          socket.destroy();
        }
      }
    }, 4000).unref?.();
  }

  toPanel(socket, chunk) {
    if (!this.panelPort || this.panelPort === this.port) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    const upstream = net.connect({ host: '127.0.0.1', port: this.panelPort, noDelay: true }, () => {
      upstream.setNoDelay(true);
      upstream.write(chunk);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    const cleanup = () => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on('error', cleanup);
    socket.on('error', cleanup);
    socket.on('close', cleanup);
    upstream.on('close', cleanup);
    socket.resume();
  }

  pipeTo(socket, chunk, port, kind) {
    if (!port) {
      socket.destroy();
      return;
    }
    socket.pause();
    const upstream = net.connect({ host: '127.0.0.1', port, noDelay: true, keepAlive: true, keepAliveInitialDelay: 15000 }, () => {
      upstream.setNoDelay(true);
      upstream.setKeepAlive(true, 15000);
      if (chunk && chunk.length) upstream.write(chunk);
      socket.pipe(upstream);
      upstream.pipe(socket);
      socket.resume();
      socket.on('data', (d) => {
        this.stats.up += d.length;
      });
      upstream.on('data', (d) => {
        this.stats.down += d.length;
      });
    });
    const cleanup = () => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on('error', () => {
      if (kind === 'mtproto') this.stats.mtproto = Math.max(0, this.stats.mtproto - 1);
      cleanup();
    });
    socket.on('error', cleanup);
    socket.on('close', cleanup);
    upstream.on('close', cleanup);
  }
}

/** Build the routing plan from the current document. */
export function buildPlan(doc, { mtprotoPort, mtprotoEnabled, mtprotoFakeTls, mtprotoSecret }) {
  const { describeInbound } = doc.__catalog || {};
  const inbounds = (doc.inbounds || []).map((ib) => (describeInbound ? describeInbound(ib) : ib)).filter(Boolean);
  const sniMap = {};
  const sniConflicts = [];
  let defaultTls = null;
  for (const ib of inbounds) {
    if (!ib.enabled || ib.edge !== 'tcp' || ib.udp) continue;
    const port = ib.port;
    const entry = { port, kind: ib.core || 'xray', core: ib.core, inboundId: ib.id, protocol: ib.protocol };
    const claim = (sni) => {
      if (!sni) return;
      const taken = sniMap[sni];
      if (taken && taken.inboundId !== entry.inboundId) {
        sniConflicts.push({ sni, kept: taken.inboundId, dropped: entry.inboundId, droppedLabel: ib.label });
        return;
      }
      sniMap[sni] = entry;
    };
    if (ib.security === 'reality') {
      const sni = String(ib.params.sni || String(ib.params.dest || '').split(':')[0] || '').toLowerCase();
      claim(sni);
      defaultTls = defaultTls || entry;
    } else if (ib.security === 'tls-self') {
      const sni = String(ib.params.sni || '').toLowerCase();
      claim(sni);
      defaultTls = defaultTls || entry;
    }
  }

  let opaquePort = 0;
  let opaqueCore = '';
  let opaqueInboundId = '';
  const opaqueConflicts = [];
  for (const ib of inbounds) {
    if (!ib.enabled || ib.edge !== 'tcp' || ib.udp) continue;
    if (ib.security === 'tls-self' || ib.security === 'reality') continue;
    if (ib.protocol !== 'shadowsocks') continue;
    if (opaquePort) {
      opaqueConflicts.push({ kept: opaqueInboundId, dropped: ib.id, droppedLabel: ib.label });
      continue;
    }
    opaquePort = ib.port;
    opaqueCore = ib.core || 'xray';
    opaqueInboundId = ib.id;
  }

  const conflicts = [];
  const fakeTlsLower = (mtprotoFakeTls || '').toLowerCase();
  if (mtprotoEnabled && fakeTlsLower && sniMap[fakeTlsLower]) {
    conflicts.push(fakeTlsLower);
  }
  return {
    sniMap,
    conflicts,
    defaultTls,
    sniConflicts,
    opaqueConflicts,
    opaquePort,
    opaqueCore,
    opaqueInboundId,
    mtprotoPort: mtprotoEnabled ? mtprotoPort : 0,
    mtprotoFakeTls: fakeTlsLower,
    mtprotoSecret: mtprotoSecret || '',
  };
}
