# BBG · Telegram Proxy Multiplexing

**Maintainer:** SANDBAAD

All Telegram proxy transports share the single public TCP port via the BBG Multiplexer (`src/proxy/mux.js`).

## Supported Transports

1. **MTProto with FakeTLS v2 (`mtg`):**
   - Uses `ee` secret prefix with TLS 1.3 SNI masquerading (`www.microsoft.com`, `www.cloudflare.com`, etc.).
   - Also supports AES-256-CTR `obfuscated2` header verification in `src/proxy/sni.js`.
2. **SOCKS5 Proxy (`src/proxy/socks5.js`):**
   - RFC 1928 / RFC 1929 compliant with `TCP_NODELAY` and 15-second keep-alive.
3. **HTTP CONNECT Proxy (`src/proxy/http.js`):**
   - Supports authenticated `CONNECT` tunneling and standard HTTP forwarding.
