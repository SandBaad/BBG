# BBG · Multi-Core Anti-Censorship & Subscription Control Plane

**Project:** `BBG`  
**Author / Maintainer:** `SANDBAAD`  
**Version:** `2.0.0`

BBG is a high-performance, hardened multi-core VPN configuration and subscription management control plane orchestrating **Xray-core**, **sing-box 1.12+**, and **MTProto (FakeTLS v2)** over a unified single-port TCP multiplexer and HTTP/WebSocket edge router.

---

## Key Capabilities

1. **Dual-Core Hardened Configuration Engine (`Xray-core` + `sing-box 1.12+`):**
   - **Pruned & Hardened Catalog:** Legacy, unencrypted, and easily fingerprinted protocols are removed. Only DPI-resilient transports are provisioned:
     - `VLESS + REALITY (XTLS-RPRX-Vision)` with uTLS Chrome fingerprinting
     - `VLESS + XHTTP (SplitHTTP)` with randomized padding (`xPaddingBytes: 100-1000`)
     - `VLESS + WebSocket` with 0-RTT Early Data (`?ed=2048` / `Sec-WebSocket-Protocol` coalescing)
     - `VLESS + HTTPUpgrade` & `VLESS + gRPC`
     - `Trojan + WebSocket / TLS`
     - `Shadowsocks 2022 (2022-blake3-aes-128-gcm / 2022-blake3-aes-256-gcm)` with per-user EIH keys
     - `AnyTLS` (`sing-box 1.12+`) with configurable multi-step packet padding schemes
     - `ShadowTLS v3` & `Hysteria2` (QUIC + salamander obfuscation)
2. **Active DPI & Censorship Evasion:**
   - **TLS ClientHello Fragmentation:** Outbound `fragment` dialer in Xray (`packets: "tlshello"`, `length: "100-200"`, `interval: "10-20"`) and native `tls.fragment` + `tls.record_fragment` in `sing-box`.
   - **Multi-Record TLS SNI Parser:** The single-port TCP multiplexer (`src/proxy/sni.js`) reassembles fragmented TLS Handshake records (`0x16`) before extracting SNI and decrypts MTProto `obfuscated2` headers via AES-256-CTR.
3. **Zero-Stall Latency & Telegram Remediation:**
   - **Route-Only Sniffing (`routeOnly: true`):** Prevents destination override from hijacking Telegram direct IP connections onto poisoned domains.
   - **Tunnel-Routed DoH & Direct Telegram CIDRs:** Eliminates 20-second DNS timeouts (`https+local://` stalls) by routing DoH through the proxy tunnel and binding Telegram's AS62041 / AS62014 CIDR blocks directly to the proxy outbound.
   - **TCP_NODELAY & Connection Pooling:** Disables Nagle's algorithm (`setNoDelay(true)`) across all multiplexer and reverse-proxy sockets, coalesces 0-RTT WebSocket upgrade frames, and pools local HTTP subrequests (`keepAlive: true`).
4. **Modern Glassmorphic UI & Bento Analytics Studio:**
   - Frosted glass surfaces (`backdrop-filter: blur(22px)`), ambient glowing orbs, categorized sidebar navigation, floating Glassy Navigation Tabs V5 dock, cubic-bezier traffic area studio, circular health donut gauge, and live 24-bar multiplexer histogram.

---

## Quick Start

```bash
npm install
node scripts/install-binaries.mjs
DATA_DIR=./data PORT=8080 BBG_TCP_PORT=8443 npm start
```

Run pre-flight verification:

```bash
npm run check
```

---

## Documentation

- [Architecture & Multiplexer Pipeline](docs/ARCHITECTURE.md)
- [Hardened Protocol Catalog](docs/PROTOCOLS.md)
- [Deployment Guide](docs/RAILWAY.md)
- [Telegram Proxy Multiplexing](docs/TELEGRAM.md)

---

Copyright © 2026 **SANDBAAD**. All rights reserved.
