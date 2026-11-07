# BBG · SANDBAAD

پنل مدیریت VPN با دو نسخه:

| نسخه | کجا اجرا می‌شود | پروتکل‌ها | نصب |
| --- | --- | --- | --- |
| **Worker** | حساب Cloudflare خود کاربر (رایگان) | VLESS و Trojan روی WebSocket + TLS کلادفلر | فقط با یک API Token، از صفحهٔ وب یا ربات تلگرام |
| **سرور** | VPS یا Railway (Docker) | REALITY، Shadowsocks‑2022، AnyTLS، ShadowTLS، Hysteria2، WS/XHTTP/gRPC + پروکسی تلگرام | Docker یا `npm start` |

هر دو نسخه یک رابط کاربری مشترک دارند (فارسی/انگلیسی، تیره/روشن، موبایل).

---

## نصب با یک توکن (نسخهٔ Worker)

نصب‌کننده یک Worker است که هم صفحهٔ وب دارد و هم ربات تلگرام. کاربر توکن کلادفلرش را می‌دهد و نصب‌کننده خودش این کارها را می‌کند:

1. بررسی توکن و پیدا کردن حساب
2. ساختن زیردامنهٔ `workers.dev` اگر حساب هنوز ندارد
3. بارگذاری پنل با Durable Object (ذخیره‌سازی دائمی) و کلیدهای تصادفی
4. روشن کردن آدرس عمومی و، اگر داده شده، وصل کردن دامنهٔ شخصی
5. تست پنل و برگرداندن آدرس پنل، نام کاربری، رمز و لینک اشتراک اولین کاربر

توکن فقط در همان درخواست استفاده می‌شود؛ ذخیره یا لاگ نمی‌شود و پیام حاوی توکن در تلگرام بلافاصله پاک می‌شود.

### راه‌اندازی نصب‌کننده روی حساب خودت (یک بار)

1. این مخزن را در گیت‌هاب خودت push کن.
2. در **Settings → Secrets and variables → Actions** این‌ها را اضافه کن:
   - `CLOUDFLARE_API_TOKEN` (قالب «Edit Cloudflare Workers»)
   - `CLOUDFLARE_ACCOUNT_ID`
   - اختیاری برای ربات: `TELEGRAM_BOT_TOKEN` (از ‎@BotFather) و `TELEGRAM_WEBHOOK_SECRET` (یک رشتهٔ تصادفی بلند)
3. Workflow به نام **Deploy installer** خودکار اجرا می‌شود (یا از تب Actions دستی اجرایش کن). اول تست‌ها اجرا می‌شوند، بعد نصب‌کننده روی `https://bbg-installer.<subdomain>.workers.dev` بالا می‌آید و ربات وصل می‌شود.
4. اگر ربات داری، نام کاربری‌اش را در `installer/wrangler.toml` در `TELEGRAM_BOT_USERNAME` بنویس تا روی صفحهٔ وب هم نشان داده شود.

### دسترسی‌هایی که توکن کاربر لازم دارد

| دسترسی | برای |
| --- | --- |
| Account · Workers Scripts · Edit | بارگذاری پنل و روشن کردن workers.dev |
| Account · Account Settings · Read | پیدا کردن شناسهٔ حساب |
| Zone · Workers Routes · Edit + Zone · Read + DNS · Edit | فقط برای دامنهٔ شخصی |

دکمهٔ «ساخت توکن» در صفحهٔ نصب این دسترسی‌ها را از قبل انتخاب می‌کند.

### محدودیت‌های نسخهٔ Worker

- فقط VLESS و Trojan روی WebSocket. REALITY، Shadowsocks و Hysteria به سرور واقعی نیاز دارند.
- Workers نمی‌توانند به IPهای خود کلادفلر وصل شوند؛ برای باز شدن سایت‌های پشت کلادفلر یک **ProxyIP** لازم است (از تنظیمات پنل). آن سرور مقصد اتصال‌ها را می‌بیند.
- `workers.dev` در ایران اغلب فیلتر است؛ دامنهٔ شخصی یا IP تمیز اضافه کنید.
- پلن رایگان: ۱۰۰٬۰۰۰ درخواست در روز برای Worker و Durable Object.

---

## نسخهٔ سرور

```bash
npm run check                         # بررسی باینری‌ها و کانفیگ‌ها
node scripts/install-binaries.mjs     # Xray، sing-box و mtg
DATA_DIR=./data PORT=8080 BBG_TCP_PORT=8443 BBG_ADMIN_PASSWORD='a-long-password' npm start
```

یا با Docker / Railway (`Dockerfile` و `scripts/deploy/railway.sh`).

- اگر `BBG_ADMIN_PASSWORD` ندهید، صفحهٔ راه‌اندازی یک **کلید یک‌بارمصرف** می‌خواهد که در لاگ سرور چاپ می‌شود.
- پورت `8080`: پنل و مسیرهای CDN (WS/XHTTP/gRPC) پشت HTTPS.
- پورت `8443`: مالتی‌پلکسر TCP (REALITY، AnyTLS، Shadowsocks، پروکسی‌های تلگرام).
- پشت پروکسی معکوس غیر از Railway، `BBG_TRUST_PROXY=1` بگذارید تا محدودیت ورود IP واقعی را ببیند.

---

## توسعه

```bash
node scripts/build-worker.mjs   # UI را داخل Worker و بستهٔ نصب‌کننده می‌گذارد
npm test                        # تست‌های Worker و نصب‌کننده (بدون اینترنت)
node --import ./tests/cf-shim/register.mjs --import ./tests/cf-shim/runtime.mjs tests/serve-worker.mjs
                                # اجرای محلی نسخهٔ Worker روی http://localhost:8787/panel-demo/
```

- `src/` نسخهٔ سرور · `worker/panel.js` نسخهٔ Worker · `installer/` نصب‌کننده · `public/` رابط کاربری مشترک
- `docs/SECURITY.md` مدل امنیتی و آنچه بررسی شده است

Copyright © 2026 **SANDBAAD**.
