# Security model

## Both editions

| Area | What the panel does |
| --- | --- |
| Admin login | Salted hash (scrypt on the server, PBKDF2 + server pepper on the Worker); 8 failed tries per IP per window, then HTTP 429 |
| Sessions | HMAC-signed cookie, `HttpOnly`, `SameSite=Strict` (`Secure` on HTTPS); bound to a password version, so changing the password signs out every other session |
| CSRF | Every non-GET API call needs the `x-requested-with: bbg` header and a same-origin `Origin` |
| First run | Server: one-time setup key printed in the log, or `BBG_ADMIN_PASSWORD`. Worker: the installer sets the admin password |
| Subscription links | Random 18-byte token per user, stored; "rotate keys" issues a new one and the old link returns 404 |
| Backups | Contain keys and password hashes; restore refuses files without an admin and secrets |
| Headers | CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`; non-ASCII names are encoded (`base64:` titles, RFC 5987 file names) |
| Probing | Unknown paths answer like a stock nginx 404; `/health` reveals nothing |

## Server edition

- The SOCKS5 and HTTP CONNECT proxies on the shared TCP port **refuse every connection while they are off**, always require a password, and resolve destinations first: loopback, private, link-local, CGNAT, multicast and metadata ranges are refused (`src/proxy/guard.js`).
- Plain HTTP on the TCP port no longer reaches the panel.
- Xray routes with `IPIfNonMatch` and sing-box resolves before matching, so a subscriber cannot reach `localhost`, the Xray API or the LAN by using a domain name.
- sing-box traffic (AnyTLS, ShadowTLS, Hysteria2) is handed to a loopback Xray inbound per user, so quotas count it too.
- Config applies run one at a time and cores restart only when their config changed.
- REALITY short IDs, gRPC service names and HTTP paths are random per install; the TLS certificate is issued for the SNIs actually used.
- The login limiter trusts `X-Forwarded-For` only behind Railway or with `BBG_TRUST_PROXY=1`, and then only the last hop.

## Worker edition

- State lives in one SQLite-backed Durable Object (strongly consistent); no KV namespace.
- VLESS UUIDs and Trojan passwords (SHA-224) are checked against active users; disabled, expired and out-of-data users are refused, and a quota cut-off takes effect on the next connection.
- Admin panel, subscription and tunnel paths are random per install; everything else is a 404.
- No third-party ProxyIP is configured by default.

## Not covered

- Xray, sing-box and mtg were not run in this test environment; their generated configs follow the upstream documentation but should be checked with `npm run check` on the target machine.
- Real Cloudflare and Telegram APIs were exercised through mocks that follow the documented request formats.
