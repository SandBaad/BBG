/**
 * BBG · SANDBAAD installer — deploys the panel Worker into the user's own
 * Cloudflare account with nothing but an API token.
 *
 * The token is used for these calls only. It is never stored or logged.
 */
import { PANEL_MODULES, PANEL_VERSION } from './panel-bundle.js';

const COMPAT_DATE = '2025-09-01';

export const STEPS = [
  { id: 'token', fa: 'بررسی توکن', en: 'Checking the token' },
  { id: 'account', fa: 'پیدا کردن حساب کلادفلر', en: 'Finding the Cloudflare account' },
  { id: 'subdomain', fa: 'آماده‌سازی دامنهٔ workers.dev', en: 'Preparing the workers.dev subdomain' },
  { id: 'upload', fa: 'بارگذاری پنل', en: 'Uploading the panel' },
  { id: 'route', fa: 'روشن کردن آدرس عمومی', en: 'Turning on the public address' },
  { id: 'domain', fa: 'اتصال دامنهٔ شخصی', en: 'Connecting the custom domain' },
  { id: 'check', fa: 'تست پنل', en: 'Testing the panel' },
];

const rand = (len, abc = 'abcdefghijkmnopqrstuvwxyz23456789') => {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => abc[x % abc.length]).join('');
};
const randPassword = () => rand(18, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789');
const randToken = () => {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export class DeployError extends Error {
  constructor(step, message, hint = null) {
    super(message);
    this.step = step;
    this.hint = hint;
  }
}

function explain(step, err) {
  const codes = err.codes || [];
  const msg = String(err.message || err);
  if (err.status === 401 || err.status === 403 || codes.includes(10000) || codes.includes(9109) || /auth/i.test(msg)) {
    return {
      fa: 'توکن کار نمی‌کند یا دسترسی لازم را ندارد. توکن را با دکمهٔ «ساخت توکن» بسازید.',
      en: 'The token does not work or lacks a permission. Create it with the "Create token" button.',
    };
  }
  if (step === 'domain') {
    return {
      fa: 'دامنه وصل نشد. مطمئن شوید دامنه در همین حساب کلادفلر است و توکن دسترسی Zone و Workers Routes دارد. پنل بدون دامنه هم کار می‌کند.',
      en: 'The domain was not connected. Make sure it is in this Cloudflare account and the token has Zone and Workers Routes access. The panel works without it.',
    };
  }
  return { fa: msg, en: msg };
}

export function cleanOptions(input = {}) {
  const o = {};
  o.token = String(input.token || '').trim();
  if (!/^[A-Za-z0-9_-]{30,}$/.test(o.token)) throw new DeployError('token', 'invalid token format', { fa: 'قالب توکن درست نیست؛ کل توکن را کپی کنید.', en: 'That does not look like an API token; copy the whole token.' });
  const name = String(input.name || '').trim().toLowerCase();
  if (name && !/^[a-z][a-z0-9-]{2,40}$/.test(name)) throw new DeployError('upload', 'invalid worker name', { fa: 'نام Worker: حروف کوچک انگلیسی، عدد و خط تیره (۳ تا ۴۰ حرف).', en: 'Worker name: lowercase letters, digits and dashes (3-40).' });
  o.name = name || `bbg-${rand(6)}`;
  o.adminUser = String(input.adminUser || 'admin').trim();
  if (!/^[\w.@-]{3,32}$/.test(o.adminUser)) throw new DeployError('upload', 'invalid admin username', { fa: 'نام کاربری مدیر: ۳ تا ۳۲ حرف انگلیسی یا عدد.', en: 'Admin username: 3-32 letters or digits.' });
  o.adminPassword = String(input.adminPassword || '') || randPassword();
  if (o.adminPassword.length < 10) throw new DeployError('upload', 'password too short', { fa: 'رمز مدیر حداقل ۱۰ حرف باشد (یا خالی بگذارید تا ساخته شود).', en: 'Admin password needs 10+ characters (or leave it empty).' });
  const domain = String(input.customDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (domain && !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new DeployError('domain', 'invalid domain', { fa: 'دامنه درست نیست (مثلاً vpn.example.com).', en: 'Invalid domain (e.g. vpn.example.com).' });
  o.customDomain = domain;
  const proxy = String(input.proxyIp || '').trim();
  if (proxy && !/^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/.test(proxy)) throw new DeployError('upload', 'invalid ProxyIP', { fa: 'ProxyIP درست نیست (host یا host:port).', en: 'Invalid ProxyIP (host or host:port).' });
  o.proxyIp = proxy;
  const ips = String(input.cleanIps || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 5);
  if (ips.some((x) => !/^[0-9a-fA-F:.]+$|^[a-z0-9.-]+$/i.test(x))) throw new DeployError('upload', 'invalid clean IP', { fa: 'فهرست IP تمیز درست نیست.', en: 'Invalid clean IP list.' });
  o.cleanIps = ips.join(',');
  o.accountId = String(input.accountId || '').trim();
  return o;
}

/**
 * Runs the whole install. `report(stepId, status, extra)` streams progress:
 * status is 'run' | 'ok' | 'skip' | 'warn' | 'fail'.
 */
export async function deployPanel(input, { apiBase = 'https://api.cloudflare.com/client/v4', report = () => {}, fetchImpl = fetch, checkDelayMs = 2000 } = {}) {
  const o = cleanOptions(input);
  const cf = async (method, path, body, form = false) => {
    const res = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: { authorization: `Bearer ${o.token}`, ...(body && !form ? { 'content-type': 'application/json' } : {}) },
      body: form ? body : body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!data || !data.success) {
      const err = new Error((data?.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`);
      err.status = res.status;
      err.codes = (data?.errors || []).map((e) => e.code);
      throw err;
    }
    return data.result;
  };
  let step = 'token';
  const run = async (id, fn) => {
    step = id;
    report(id, 'run');
    const out = await fn();
    report(id, 'ok', typeof out === 'object' && out && out.note ? { note: out.note } : {});
    return out;
  };

  try {
    await run('token', async () => {
      try {
        const t = await cf('GET', '/user/tokens/verify');
        if (t.status && t.status !== 'active') throw Object.assign(new Error(`token is ${t.status}`), { status: 403 });
      } catch (err) {
        // Account-owned tokens cannot use /user/tokens/verify; the next step will tell.
        if (err.status !== 401 && err.status !== 403 && !String(err.message).includes('1000')) throw err;
        if (!o.accountId) {
          const list = await cf('GET', '/accounts?per_page=50').catch(() => null);
          if (!list || !list.length) throw err;
        }
      }
      return {};
    });

    const account = await run('account', async () => {
      const list = await cf('GET', '/accounts?per_page=50');
      if (!list.length) throw Object.assign(new Error('no account visible to this token'), { status: 403 });
      const acc = (o.accountId && list.find((a) => a.id === o.accountId)) || list[0];
      return { id: acc.id, name: acc.name, note: list.length > 1 ? `${acc.name} (${list.length} accounts; using the first)` : acc.name };
    });

    const sub = await run('subdomain', async () => {
      try {
        const r = await cf('GET', `/accounts/${account.id}/workers/subdomain`);
        if (r && r.subdomain) return { name: r.subdomain, note: `${r.subdomain}.workers.dev` };
      } catch { /* none yet */ }
      const wanted = `bbg${rand(8)}`;
      const r = await cf('PUT', `/accounts/${account.id}/workers/subdomain`, { subdomain: wanted });
      return { name: r.subdomain || wanted, note: `${r.subdomain || wanted}.workers.dev` };
    });

    const paths = { admin: rand(12), sub: rand(8), token: randToken() };
    await run('upload', async () => {
      let exists = false;
      try {
        await cf('GET', `/accounts/${account.id}/workers/scripts/${o.name}/settings`);
        exists = true;
      } catch { exists = false; }
      if (exists) throw new DeployError('upload', `a Worker named ${o.name} already exists`, { fa: `یک Worker با نام ${o.name} از قبل هست. نام دیگری بدهید یا خالی بگذارید.`, en: `A Worker named ${o.name} already exists. Pick another name or leave it empty.` });
      const baseBindings = [
        { type: 'secret_text', name: 'ADMIN_PASSWORD', text: o.adminPassword },
        { type: 'plain_text', name: 'ADMIN_USER', text: o.adminUser },
        { type: 'secret_text', name: 'ADMIN_PATH', text: paths.admin },
        { type: 'secret_text', name: 'SUB_PATH', text: paths.sub },
        { type: 'secret_text', name: 'FIRST_SUB_TOKEN', text: paths.token },
        ...(o.customDomain ? [{ type: 'plain_text', name: 'PUBLIC_HOST', text: o.customDomain }] : []),
        ...(o.proxyIp ? [{ type: 'plain_text', name: 'PROXY_IP', text: o.proxyIp }] : []),
        ...(o.cleanIps ? [{ type: 'plain_text', name: 'CLEAN_IPS', text: o.cleanIps }] : []),
      ];
      const uploadWithMeta = async (metaObj) => {
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metaObj)], { type: 'application/json' }));
        for (const m of PANEL_MODULES) form.append(m.name, new Blob([m.content], { type: 'application/javascript+module' }), m.name);
        await cf('PUT', `/accounts/${account.id}/workers/scripts/${o.name}`, form, true);
      };
      try {
        await uploadWithMeta({
          main_module: 'panel.js',
          compatibility_date: COMPAT_DATE,
          bindings: [
            { type: 'durable_object_namespace', name: 'STORE', class_name: 'PanelStore' },
            ...baseBindings,
          ],
          migrations: { new_tag: 'v1', new_sqlite_classes: ['PanelStore'] },
        });
      } catch {
        await uploadWithMeta({
          main_module: 'panel.js',
          compatibility_date: COMPAT_DATE,
          bindings: baseBindings,
        });
      }
      return { note: `${o.name} · v${PANEL_VERSION}` };
    });

    const devHost = `${o.name}.${sub.name}.workers.dev`;
    await run('route', async () => {
      await cf('POST', `/accounts/${account.id}/workers/scripts/${o.name}/subdomain`, { enabled: true, previews_enabled: false });
      return { note: devHost };
    });

    let host = devHost;
    if (o.customDomain) {
      try {
        await run('domain', async () => {
          const labels = o.customDomain.split('.');
          let zone = null;
          for (let i = 0; i < labels.length - 1 && !zone; i += 1) {
            const name = labels.slice(i).join('.');
            const zones = await cf('GET', `/zones?name=${encodeURIComponent(name)}`);
            if (zones && zones.length) zone = zones[0];
          }
          if (!zone) throw new Error('zone not found in this account');
          await cf('PUT', `/accounts/${account.id}/workers/domains`, { hostname: o.customDomain, service: o.name, zone_id: zone.id, environment: 'production' });
          host = o.customDomain;
          return { note: o.customDomain };
        });
      } catch (err) {
        report('domain', 'warn', { note: explain('domain', err) });
      }
    } else {
      report('domain', 'skip');
    }

    const panelUrl = `https://${devHost}/${paths.admin}/`;
    const result = {
      workerName: o.name,
      account: account.name,
      panelUrl,
      customPanelUrl: host !== devHost ? `https://${host}/${paths.admin}/` : '',
      adminUser: o.adminUser,
      adminPassword: o.adminPassword,
      subUrl: `https://${host}/${paths.sub}/${paths.token}`,
      portalUrl: `https://${host}/${paths.sub}/${paths.token}/page`,
      version: PANEL_VERSION,
      warnings: [],
    };
    if (!o.proxyIp) result.warnings.push({ fa: 'ProxyIP خالی است؛ سایت‌هایی که پشت کلادفلر هستند باز نمی‌شوند. از تنظیمات پنل اضافه‌اش کنید.', en: 'ProxyIP is empty; sites behind Cloudflare will not open. Add one in the panel settings.' });
    if (host === devHost) result.warnings.push({ fa: 'دامنهٔ workers.dev در ایران اغلب فیلتر است؛ دامنهٔ شخصی یا IP تمیز اضافه کنید.', en: 'workers.dev is often filtered in Iran; add a custom domain or clean IPs.' });

    step = 'check';
    report('check', 'run');
    let live = false;
    for (let i = 0; i < 4 && !live; i += 1) {
      try {
        const r = await fetchImpl(`${panelUrl}api/bootstrap`, { headers: { 'x-requested-with': 'bbg' } });
        live = r.ok;
      } catch { live = false; }
      if (!live && i < 3) await new Promise((r) => setTimeout(r, checkDelayMs));
    }
    report('check', live ? 'ok' : 'warn', live ? {} : { note: { fa: 'پنل نصب شد ولی هنوز جواب نمی‌دهد؛ معمولاً تا یک دقیقه آماده می‌شود.', en: 'Installed, but not answering yet; it is usually ready within a minute.' } });
    return result;
  } catch (err) {
    const hint = err instanceof DeployError && err.hint ? err.hint : explain(step, err);
    report(step, 'fail', { note: hint });
    throw new DeployError(step, err.message, hint);
  }
}

export function tokenTemplateUrl(withDomain = false) {
  const perms = [
    { key: 'workers_scripts', type: 'edit' },
    { key: 'account_settings', type: 'read' },
    ...(withDomain ? [{ key: 'workers_routes', type: 'edit' }, { key: 'zone', type: 'read' }, { key: 'dns', type: 'edit' }] : []),
  ];
  return `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(JSON.stringify(perms))}&name=${encodeURIComponent('BBG Installer')}`;
}
