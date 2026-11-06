# BBG · Deployment Guide

**Maintainer:** SANDBAAD

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8080` | HTTP panel & edge reverse-proxy port |
| `BBG_TCP_PORT` | `8443` | Internal port for the single-port TCP SNI multiplexer |
| `DATA_DIR` | `/data` | Persistent storage directory (`bbg.json`, `state/`, `logs/`) |
| `BBG_MAX_USERS` | `500` | Maximum subscriber count |
| `BBG_STATS_INTERVAL_MS` | `20000` | Traffic accounting interval in milliseconds |

## Persistent Storage Layout

When mounted at `/data`:
- `bbg.json` — Atomic JSON store (subscribers, inbounds, keys, settings)
- `state/xray.json` & `state/sing-box.json` — Validated core configurations
- `state/reality.json` & `state/certs/*` — X25519 REALITY keypair and self-signed TLS certificates
- `logs/*.log` — Ring-buffered core logs
