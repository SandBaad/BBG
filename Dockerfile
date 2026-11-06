# ============================================================================
# BBG · Multi-Core Anti-Censorship & Subscription Control Plane
# Author / Maintainer: SANDBAAD
# Single-container runtime: BBG Panel + Xray-core + sing-box + mtg (MTProto)
# ============================================================================
FROM node:22-bookworm-slim

ARG XRAY_VERSION=26.10.31
ARG SINGBOX_VERSION=1.14.4
ARG MTG_VERSION=2.3.0
ARG TARGETARCH=amd64
ARG GH_MIRROR=

ENV NODE_ENV=production \
    DATA_DIR=/data \
    BBG_BIN_DIR=/app/bin \
    BBG_TCP_PORT=8443 \
    PORT=8080

RUN set -eux; \
    for attempt in 1 2 3; do \
      if apt-get update && apt-get install -y --no-install-recommends \
           ca-certificates curl unzip tar openssl tzdata; then break; fi; \
      echo "apt attempt ${attempt} failed, retrying…"; sleep $((attempt * 5)); \
    done; \
    rm -rf /var/lib/apt/lists/*

# ── Cores (Xray-core, sing-box, mtg) ────────────────────────────────────────
RUN set -eux; \
    mkdir -p /app/bin; \
    case "${TARGETARCH}" in \
      amd64) XRAY_ZIP="Xray-linux-64.zip"; SB_ARCH="amd64"; MTG_ARCH="amd64" ;; \
      arm64) XRAY_ZIP="Xray-linux-arm64-v8a.zip"; SB_ARCH="arm64"; MTG_ARCH="arm64" ;; \
      *) echo "unsupported arch ${TARGETARCH}"; exit 1 ;; \
    esac; \
    dl() { \
      url="$1"; out="$2"; \
      tries=""; \
      if [ -n "${GH_MIRROR}" ]; then tries="${GH_MIRROR} "; fi; \
      for mirror in ${tries} ""; do \
        for attempt in 1 2 3 4 5; do \
          rm -f "$out"; \
          if curl -fSL --retry 3 --retry-delay 2 --retry-all-errors \
                   --connect-timeout 20 --max-time 600 \
                   -o "$out" "${mirror}${url}"; then \
            if [ -s "$out" ]; then echo "downloaded ${url} (attempt ${attempt})"; return 0; fi; \
          fi; \
          echo "attempt ${attempt} failed for ${url}, retrying…"; sleep $((attempt * 3)); \
        done; \
      done; \
      echo "FATAL: could not download ${url}"; return 1; \
    }; \
    dl "https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VERSION}/${XRAY_ZIP}" /tmp/xray.zip; \
    unzip -q /tmp/xray.zip -d /app/bin; \
    rm -f /tmp/xray.zip; \
    dl "https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/sing-box-${SINGBOX_VERSION}-linux-${SB_ARCH}.tar.gz" /tmp/sb.tar.gz; \
    tar -xzf /tmp/sb.tar.gz -C /tmp; \
    mv "/tmp/sing-box-${SINGBOX_VERSION}-linux-${SB_ARCH}/sing-box" /app/bin/sing-box; \
    rm -rf /tmp/sb.tar.gz "/tmp/sing-box-${SINGBOX_VERSION}-linux-${SB_ARCH}"; \
    chmod +x /app/bin/xray /app/bin/sing-box; \
    test -s /app/bin/xray; \
    test -s /app/bin/sing-box; \
    /app/bin/xray version; \
    /app/bin/sing-box version; \
    if dl "https://github.com/9seconds/mtg/releases/download/v${MTG_VERSION}/mtg-${MTG_VERSION}-linux-${MTG_ARCH}.tar.gz" /tmp/mtg.tar.gz; then \
      tar -xzf /tmp/mtg.tar.gz -C /tmp; \
      mv "/tmp/mtg-${MTG_VERSION}-linux-${MTG_ARCH}/mtg" /app/bin/mtg; \
      chmod +x /app/bin/mtg; \
      /app/bin/mtg --version; \
    else \
      echo "!! WARNING: mtg could not be downloaded — MTProto will show as unavailable."; \
    fi; \
    rm -rf /tmp/mtg.tar.gz /tmp/mtg-*.tar.gz /tmp/mtg-${MTG_VERSION}-linux-${MTG_ARCH} /tmp/xray.zip

# ── Application ─────────────────────────────────────────────────────────────
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /data

EXPOSE 8080
EXPOSE 8443

HEALTHCHECK --interval=45s --timeout=8s --start-period=40s --retries=4 \
  CMD node -e "const ps=[process.env.BBG_PANEL_PORT,process.env.PORT,8080,3000].filter(Boolean).map(Number);(async()=>{for(const p of ps){try{const r=await fetch('http://127.0.0.1:'+p+'/health');if(r.ok)process.exit(0)}catch{}}process.exit(1)})()"

CMD ["node", "src/index.js"]
