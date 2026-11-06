/**
 * BBG · By SANDBAAD — Control Plane & Multiplexer Entry Point
 */
import { ensureDirs, PORT, PANEL_PORTS, PORT_CONFLICT, MUX_PORT, DATA_DIR, BIN, APP, IS_RAILWAY, RAILWAY } from './env.js';
import { load, get } from './store.js';
import { Runtime } from './runtime.js';
import { createPanelServer } from './http/server.js';

ensureDirs();
load();

const runtime = new Runtime();
const api = { httpRoutes: () => runtime.httpRoutes() };
const servers = [];
const boundPanelPorts = [];

function banner() {
  const doc = get();
  const facts = runtime.facts();
  const lines = [
    '',
    `  ███ ${APP.brand} · ${APP.tag} — By ${APP.author}`,
    `  version ${APP.version} · ${new Date().toISOString()}`,
    `  panel port        : ${boundPanelPorts.join(', ') || PORT}`,
    `  tcp mux port      : ${MUX_PORT}`,
    `  data directory    : ${DATA_DIR}`,
    `  public host       : ${facts.publicHost || '(not detected yet)'}`,
    `  tcp proxy         : ${facts.tcpHost ? `${facts.tcpHost}:${facts.tcpPort}` : '(not enabled)'}`,
    `  environment       : ${IS_RAILWAY ? `${RAILWAY.projectName || '-'} / ${RAILWAY.serviceName || '-'}` : 'standalone'}`,
    `  xray binary       : ${BIN.xray}`,
    `  sing-box binary   : ${BIN.singbox}`,
    `  mtg binary        : ${BIN.mtg}`,
    `  setup required    : ${doc.admin ? 'no' : 'yes → open /setup'}`,
    '',
    '  Routing checklist',
    `    public domain  → target port ${boundPanelPorts.includes(8080) ? '8080' : boundPanelPorts[0] || PORT}`,
    `    TCP proxy      → target port ${MUX_PORT}`,
    '',
  ];
  console.log(lines.join('\n'));

  if (PORT_CONFLICT) {
    console.log(
      [
        '  ┌─ PORT CONFLICT ────────────────────────────────────────────────',
        `  │ PORT=${PORT} and BBG_TCP_PORT=${MUX_PORT} are the same port.`,
        `  │ The TCP multiplexer keeps :${MUX_PORT} so the panel is served on:`,
        `  │     ${boundPanelPorts.join(', ') || '(none)'}`,
        '  │ Recommended:',
        `  │   1. set PORT=8080 (panel) and keep the TCP proxy on ${MUX_PORT}`,
        '  │   2. point your public domain target at the panel port above',
        '  └────────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
  }
}

let booted = false;
function onListening(port) {
  if (booted) return;
  booted = true;
  runtime.usePanelPort(port);
  banner();
  runtime.boot().catch((err) => console.error('[boot]', err));
}

if (!PANEL_PORTS.length) {
  console.error('[panel] no usable panel port (PORT / BBG_PANEL_PORT collided with BBG_TCP_PORT)');
}

for (const port of PANEL_PORTS) {
  const srv = createPanelServer({ runtime, api });
  srv.on('error', (err) => console.error(`[panel] :${port} — ${err.message}`));
  srv.listen(port, '0.0.0.0', () => {
    boundPanelPorts.push(port);
    console.log(`[panel] listening on :${port}`);
    onListening(port);
  });
  servers.push(srv);
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[bbg] ${signal} received, shutting down…`);
  for (const srv of servers) {
    try {
      srv.close();
    } catch {
      /* ignore */
    }
  }
  try {
    await runtime.shutdown();
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));
