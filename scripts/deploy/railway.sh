#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  BBG · Multi-Core Anti-Censorship & Subscription Control Plane
#  Author / Maintainer: SANDBAAD
#  Automated Deployment Script
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="${BBG_REPO:-https://github.com/SANDBAAD/BBG}"
PROJECT_NAME="${BBG_PROJECT:-bbg-panel}"
WORKDIR="${BBG_DIR:-$PWD/bbg-panel}"
PANEL_PORT="${BBG_PANEL_PORT:-8080}"
TCP_PORT="${BBG_TCP_PORT:-8443}"

c_dim() { printf '\033[2m%s\033[0m\n' "$*"; }
c_ok()  { printf '\033[1m✔ %s\033[0m\n' "$*"; }
c_warn(){ printf '\033[1m! %s\033[0m\n' "$*"; }
c_err() { printf '\033[1m✗ %s\033[0m\n' "$*" >&2; }
step()  { printf '\n\033[1m── %s\033[0m\n' "$*"; }

need() { command -v "$1" >/dev/null 2>&1; }

step "Checking prerequisites"
need git  || { c_err "git is not installed."; exit 1; }
need node || { c_err "Node.js >= 20 is required."; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then c_err "Node.js $NODE_MAJOR detected; >= 20 required."; exit 1; fi
c_ok "git and Node.js $(node -v) ready"

if ! need railway; then
  c_warn "Installing Railway CLI (npm i -g @railway/cli)…"
  npm install -g @railway/cli >/dev/null 2>&1 || {
    c_err "Could not install Railway CLI. Run manually: npm i -g @railway/cli"
    exit 1
  }
fi
c_ok "Railway CLI: $(railway --version 2>/dev/null || echo installed)"

step "Railway Authentication"
if [ -z "${RAILWAY_TOKEN:-}" ]; then
  if [ -t 0 ]; then
    printf '\n  Paste RAILWAY_TOKEN (hidden): '
    read -rs RAILWAY_TOKEN
    printf '\n'
  else
    c_err "RAILWAY_TOKEN is not set."
    exit 1
  fi
fi
[ -n "${RAILWAY_TOKEN:-}" ] || { c_err "Empty token."; exit 1; }
export RAILWAY_TOKEN

if railway whoami >/dev/null 2>&1; then
  c_ok "Authenticated with Railway"
else
  c_err "Invalid RAILWAY_TOKEN."
  exit 1
fi

step "Fetching BBG repository"
if [ -d "$WORKDIR/.git" ]; then
  git -C "$WORKDIR" fetch --depth 1 origin
  git -C "$WORKDIR" reset --hard origin/HEAD >/dev/null
else
  git clone --depth 1 "$REPO_URL" "$WORKDIR"
fi
[ -f "$WORKDIR/Dockerfile" ] || { c_err "Dockerfile not found in $WORKDIR"; exit 1; }
c_ok "BBG v$(node -p "require('$WORKDIR/package.json').version") ready"

step "Linking / creating Railway project"
cd "$WORKDIR"

if [ -n "${RAILWAY_PROJECT_ID:-}" ]; then
  railway link --project "$RAILWAY_PROJECT_ID" >/dev/null 2>&1 || true
elif [ ! -f .railway/config.json ]; then
  railway init --name "$PROJECT_NAME" >/dev/null 2>&1 || true
fi

step "Setting environment variables"
railway variables \
  --set "PORT=$PANEL_PORT" \
  --set "BBG_TCP_PORT=$TCP_PORT" \
  --set "BBG_PANEL_PORT=$PANEL_PORT" \
  --set "NODE_ENV=production" >/dev/null 2>&1 \
  && c_ok "PORT=$PANEL_PORT · BBG_TCP_PORT=$TCP_PORT" \
  || c_warn "Variables could not be set automatically."

step "Deploying BBG container"
railway up --detach
c_ok "Deployment triggered"

DOMAIN="$(railway domain 2>/dev/null | tail -n 1 | tr -d '[:space:]')" || true
if [ -n "${DOMAIN:-}" ]; then
  case "$DOMAIN" in
    http*) PANEL_URL="$DOMAIN" ;;
    *)     PANEL_URL="https://$DOMAIN" ;;
  esac
  c_ok "Panel URL: $PANEL_URL"
fi

cat <<TXT

BBG Control Plane · Maintained by SANDBAAD
  1) Ensure HTTPS domain targets port $PANEL_PORT
  2) Configure TCP Proxy targeting port $TCP_PORT
  3) Mount persistent volume at /data
TXT
