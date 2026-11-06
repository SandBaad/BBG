/**
 * BBG · By SANDBAAD — In-Panel Release Manager
 *
 * Checks and applies release updates over the runtime source tree while
 * preserving the persistent data volume (`DATA_DIR`).
 */
import https from 'node:https';
import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, rmSync, mkdirSync, cpSync, readdirSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import { DATA_DIR, ROOT, APP } from './env.js';

const run = promisify(execFile);
const REPO = process.env.BBG_UPDATE_REPO || '';
const UA = `BBG-Core/${APP.version} (Maintainer: ${APP.author})`;

const CODE_PATHS = [
  'src',
  'public',
  'docs',
  'assets',
  'scripts',
  'installer',
  'README.md',
  'Dockerfile',
  'railway.json',
  'package.json',
  'LICENSE',
];

let cache = { at: 0, value: null };
const CACHE_MS = 5 * 60 * 1000;

function get(url, { redirect = 0, header = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'user-agent': UA, accept: 'application/vnd.github+json', ...header } },
      (res) => {
        const { statusCode = 0, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location && redirect < 4) {
          res.resume();
          resolve(get(headers.location, { redirect: redirect + 1, header }));
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${statusCode} from ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      },
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

function parseVersion(text) {
  const m = String(text || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? { raw: m[0], parts: [Number(m[1]), Number(m[2]), Number(m[3])] } : null;
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa.parts[i] !== pb.parts[i]) return pa.parts[i] > pb.parts[i] ? 1 : -1;
  }
  return 0;
}

function trimNotes(body) {
  return String(body || '')
    .replace(/\r/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>]/g, '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, 24)
    .join('\n')
    .slice(0, 1600);
}

export async function checkUpdate({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.value && now - cache.at < CACHE_MS) return cache.value;

  if (!REPO) {
    const local = {
      ok: true,
      current: APP.version,
      latest: APP.version,
      tag: `v${APP.version}`,
      name: `BBG v${APP.version} · SANDBAAD`,
      publishedAt: new Date(now).toISOString(),
      notes: 'BBG Core Engine by SANDBAAD is up to date.',
      tarball: '',
      htmlUrl: '',
      updateAvailable: false,
      repo: '',
      checkedAt: now,
      error: '',
    };
    cache = { at: now, value: local };
    return local;
  }

  const apiUrl = `https://api.github.com/repos/${REPO}/releases/latest`;
  const tarballFallback = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/main`;

  let value;
  try {
    const raw = await get(apiUrl);
    const rel = JSON.parse(raw);
    const latest = parseVersion(rel.tag_name || rel.name || '') || null;
    value = {
      ok: true,
      current: APP.version,
      latest: latest ? latest.raw : '',
      tag: rel.tag_name || '',
      name: rel.name || rel.tag_name || '',
      publishedAt: rel.published_at || '',
      notes: trimNotes(rel.body),
      tarball: rel.tarball_url || tarballFallback,
      htmlUrl: rel.html_url || '',
      updateAvailable: latest ? compareVersions(latest.raw, APP.version) > 0 : false,
      repo: REPO,
      checkedAt: now,
      error: '',
    };
  } catch (err) {
    value = {
      ok: false,
      current: APP.version,
      latest: '',
      tag: '',
      name: '',
      publishedAt: '',
      notes: '',
      tarball: tarballFallback,
      htmlUrl: '',
      updateAvailable: false,
      repo: REPO,
      checkedAt: now,
      error: String(err && err.message ? err.message : err),
    };
  }
  cache = { at: now, value };
  return value;
}

function download(url, file) {
  return new Promise((resolve, reject) => {
    const go = (target, hops = 0) => {
      https
        .get(target, { headers: { 'user-agent': UA } }, (res) => {
          const { statusCode = 0, headers } = res;
          if (statusCode >= 300 && statusCode < 400 && headers.location && hops < 4) {
            res.resume();
            go(headers.location, hops + 1);
            return;
          }
          if (statusCode !== 200) {
            res.resume();
            reject(new Error(`download failed: HTTP ${statusCode}`));
            return;
          }
          const out = createWriteStream(file);
          res.pipe(out);
          out.on('finish', () => out.close(() => resolve(file)));
          out.on('error', reject);
        })
        .on('error', reject);
    };
    go(url);
  });
}

export async function applyUpdate({ restart = true, onLog = () => {} } = {}) {
  const info = await checkUpdate({ force: true });
  if (!info.ok || !info.tarball) throw new Error(info.error || 'no remote update tarball configured');

  const stage = path.join(DATA_DIR, '.update');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  const tar = path.join(stage, 'release.tar.gz');
  onLog(`downloading ${info.tarball}`);
  await download(info.tarball, tar);

  onLog('extracting');
  await run('tar', ['-xzf', tar, '-C', stage], { timeout: 60000 });
  const root = readdirSync(stage).find((n) => {
    try {
      return readdirSync(path.join(stage, n)).includes('package.json');
    } catch {
      return false;
    }
  });
  if (!root) throw new Error('release archive has no package.json');
  const source = path.join(stage, root);

  let version = APP.version;
  try {
    version = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')).version || version;
  } catch {
    /* keep current */
  }

  const copied = [];
  for (const rel of CODE_PATHS) {
    const from = path.join(source, rel);
    if (!existsSync(from)) continue;
    const to = path.join(ROOT, rel);
    onLog(`installing ${rel}`);
    cpSync(from, to, { recursive: true, force: true });
    copied.push(rel);
  }

  rmSync(stage, { recursive: true, force: true });
  return {
    ok: true,
    version,
    from: info.current,
    paths: copied,
    restarts: Boolean(restart),
    at: Date.now(),
  };
}
