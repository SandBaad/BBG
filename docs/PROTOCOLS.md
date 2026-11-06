# BBG · Hardened Protocol Catalog

**Maintainer:** SANDBAAD

All protocol presets are defined in [`src/catalog.js`](../src/catalog.js). Weak, unencrypted, and easily fingerprinted legacy presets have been removed.

## Active Presets Matrix

| ID | Title | Core | Transport | Security | Edge |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `vless-reality` | VLESS + REALITY (Vision) | `xray` | `tcp` | `reality` | `tcp` |
| `vless-xhttp` | VLESS + XHTTP (SplitHTTP Padding) | `xray` | `xhttp` | `tls-edge` | `http` |
| `vless-ws` | VLESS + WebSocket (0-RTT `ed=2048`) | `xray` | `ws` | `tls-edge` | `http` |
| `vless-httpupgrade` | VLESS + HTTPUpgrade | `xray` | `httpupgrade` | `tls-edge` | `http` |
| `vless-grpc` | VLESS + gRPC | `xray` | `grpc` | `tls-edge` | `http` |
| `trojan-ws` | Trojan + WebSocket (0-RTT) | `xray` | `ws` | `tls-edge` | `http` |
| `trojan-tcp-tls` | Trojan + TLS | `xray` | `tcp` | `tls-self` | `tcp` |
| `ss-2022` | Shadowsocks 2022 (`2022-blake3-aes-128-gcm`) | `xray` | `tcp` | `none` | `tcp` |
| `sb-vless-reality` | VLESS + REALITY (sing-box) | `singbox` | `tcp` | `reality` | `tcp` |
| `sb-vless-ws` | VLESS + WebSocket (sing-box 0-RTT) | `singbox` | `ws` | `tls-edge` | `http` |
| `anytls` | AnyTLS (Dynamic Padding Scheme) | `singbox` | `tcp` | `tls-self` | `tcp` |
| `shadowtls` | ShadowTLS v3 + SS-2022 | `singbox` | `tcp` | `tls-self` | `tcp` |
| `hysteria2` | Hysteria2 (QUIC) | `singbox` | `quic` | `tls-self` | `udp` |
