# BBG · Architecture & Multiplexer Pipeline

**Maintainer:** SANDBAAD

## Overview

```
                 ┌──────────────────────────── HTTPS Edge (TLS) ───────────────────────────┐
client ── https ─┤ :443                                                                    │
                 └───────────────┬─────────────────────────────────────────────────────────┘
                                 ▼
                        ┌────────────────────┐
                        │   BBG Panel :8080  │
                        │ src/http/server.js │
                        └───┬─────┬─────┬────┘
             /api /sub /u   │     │     │  /bbg-<routeKey>
                            │     │     └────────► reverse proxy (0-RTT WS / XHTTP) ──► Xray / sing-box
                            │     └──► JSON API / Subscription Engine
                            └──► Glassmorphic UI (public/)

client ── tcp ──┐
                ▼
   Public TCP Port
                ▼
   ┌──────────────────────────┐
   │ BBG Multiplexer :8443    │  src/proxy/mux.js
   │  classify(first bytes)   │  src/proxy/sni.js (multi-record TLS parser)
   └───┬───────┬───────┬──────┴────────┐
       │TLS    │0x05   │HTTP           │other
       ▼       ▼       ▼               ▼
   SNI map   SOCKS5   HTTP/CONNECT   MTProto (mtg)
   REALITY   server   proxy          FakeTLS / obfuscated2
   AnyTLS
   ShadowTLS
```

## Key Engineering Highlights

- **Memoized Routing Table:** `runtime.httpRoutes()` and `runtime.plan()` are cached in memory and invalidated only when state mutations occur, eliminating per-request CPU overhead.
- **Connection Pooling (`UPSTREAM_AGENT`):** HTTP/XHTTP edge subrequests reuse persistent loopback sockets (`keepAlive: true`), preventing ephemeral port exhaustion.
- **Multi-Record TLS ClientHello Reassembly:** `peekSni()` in `src/proxy/sni.js` reassembles fragmented TLS Handshake records (`0x16`) before extracting the SNI hostname, ensuring clients using TLS record fragmentation route cleanly.
- **Zero-Delay Socket Tuning:** Both client and upstream sockets disable Nagle's algorithm (`setNoDelay(true)`) and enable TCP keep-alive (`setKeepAlive(true, 15000)`).
