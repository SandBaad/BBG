// Serves the Worker edition on http://localhost:8787 through the runtime shims (manual/browser testing).
//   node --import ./tests/cf-shim/register.mjs --import ./tests/cf-shim/runtime.mjs tests/serve-worker.mjs
import http from 'node:http';
import { doNamespace } from './cf-shim/runtime.mjs';

const mod = await import('../worker/panel.js');
const env = { ADMIN_USER: 'admin', ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Demo-Pass-2026', ADMIN_PATH: process.env.ADMIN_PATH || 'panel-demo', SUB_PATH: 'sub-demo' };
env.STORE = doNamespace(mod.PanelStore, env);
const port = Number(process.env.PORT || 8787);
http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { ...req.headers, 'cf-connecting-ip': req.socket.remoteAddress };
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
  const out = await mod.default.fetch(request, env, { waitUntil() {} });
  const h = {};
  out.headers.forEach((v, k) => { h[k] = v; });
  res.writeHead(out.status, h);
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(port, () => console.log(`worker edition on http://localhost:${port}/${env.ADMIN_PATH}/`));
