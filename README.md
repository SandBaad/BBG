<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-light.svg">
    <img src="assets/logo.svg" alt="BBG · SANDBAAD" width="440">
  </picture>
</p>

<p align="center"><b>English</b> · <a href="README.fa.md">فارسی</a></p>

<p align="center">A VPN panel you own. Run it free on Cloudflare in one click, or on your own server with Xray and sing-box.</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/SandBaad/BBG"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>
</p>

---

## Which version?

| | Cloudflare | Your own server |
| --- | --- | --- |
| **Runs on** | Your free Cloudflare account | Any Linux server, Docker or Railway |
| **Protocols** | VLESS and Trojan over WebSocket + TLS | REALITY, Shadowsocks 2022, AnyTLS, ShadowTLS, Hysteria2, WS / XHTTP / gRPC, Telegram proxy |
| **Cost** | Free (100,000 requests a day) | The price of your server |
| **Setup** | One click | A few commands |

Both use the same panel: Persian and English, dark and light, works on phones. Every subscriber gets one link for v2rayNG, v2rayN, Hiddify, sing-box, Clash or Karing, and a personal page with a QR code and their remaining data.

## Deploy on Cloudflare

1. Click **Deploy to Cloudflare** above and sign in. A free account is enough.
2. Connect GitHub or GitLab when asked. Cloudflare copies this project into your account and deploys from that copy.
3. Fill in the two secrets:
   - `ADMIN_PASSWORD`: your panel password, 10 characters or more.
   - `ADMIN_PATH`: the end of your panel address, for example `my-panel-7k2`. Use letters, digits, `-` and `_`.
4. Deploy and wait about a minute.
5. Open `https://bbg-panel.<your-subdomain>.workers.dev/<ADMIN_PATH>/` and sign in as `admin`.

You can see the Worker's address on its page in the Cloudflare dashboard. The address alone, without `/<ADMIN_PATH>/`, shows a "404 Not Found" page on purpose.

The first subscriber is already there: open **Subscribers**, copy the link and add it to your VPN app.

> [!TIP]
> **In Iran** `workers.dev` is usually blocked. Connect a domain of your own to the Worker (**Settings → Domains & Routes → Add → Custom domain**), then enter it in the panel under **Settings → Custom domain**. A few clean Cloudflare IPs in the same place help too.

**Forgot the password, or want a new address?** In the Cloudflare dashboard open the Worker, go to **Settings → Variables and Secrets** and change `ADMIN_PASSWORD` or `ADMIN_PATH`. The panel picks up the change within a minute.

## Let others install with only a token

The `installer/` folder is a small web page, with an optional Telegram bot. Anyone can paste a Cloudflare API token there and get a ready panel: its address, password and first subscription link. They don't need a GitHub account, and the token is used once and never stored.

To put the installer on your Cloudflare account, do one of these:

- **One click:** [Deploy the installer](https://deploy.workers.cloudflare.com/?url=https://github.com/SandBaad/BBG/tree/main/installer).
- **Kept up to date by GitHub Actions:** in this repository open **Settings → Secrets and variables → Actions** and add `CLOUDFLARE_API_TOKEN` (made with the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`. Then run **Actions → Deploy installer**. The installer is redeployed on every push, and the run page shows its address.

The installer lives at `https://bbg-installer.<your-subdomain>.workers.dev`.

<details>
<summary><b>Telegram bot (optional)</b></summary>

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Add two secrets: `TELEGRAM_BOT_TOKEN` (the bot token) and `TELEGRAM_WEBHOOK_SECRET` (any long random string of letters and digits).
   - With GitHub Actions: add them next to the Cloudflare secrets. The next run connects the bot.
   - Otherwise: add them to the `bbg-installer` Worker in the Cloudflare dashboard, then open `https://bbg-installer.<your-subdomain>.workers.dev/tg/setup?key=<TELEGRAM_WEBHOOK_SECRET>` once.
3. To show the bot on the web page, set `TELEGRAM_BOT_USERNAME` in `installer/wrangler.toml`.

</details>

## Run on your own server

**Docker**

```bash
git clone https://github.com/SandBaad/BBG.git && cd BBG
docker build -t bbg .
docker run -d --name bbg --restart unless-stopped \
  -p 8080:8080 -p 8443:8443 -v bbg-data:/data \
  -e BBG_ADMIN_PASSWORD='a-long-password' \
  -e BBG_PUBLIC_DOMAIN='panel.example.com' \
  bbg
```

- Port `8080` is the panel and the CDN paths. Put it behind HTTPS (Caddy, Nginx or Cloudflare) at `BBG_PUBLIC_DOMAIN`.
- Port `8443` carries REALITY, AnyTLS, Shadowsocks and the Telegram proxy, and must be reachable directly.
- Sign in as `admin` with `BBG_ADMIN_PASSWORD`. Without it, the first visit asks for a one-time key printed in the log (`docker logs bbg`).

**Without Docker** (Node.js 20 or newer)

```bash
node scripts/install-binaries.mjs      # downloads Xray, sing-box and mtg
BBG_ADMIN_PASSWORD='a-long-password' DATA_DIR=./data npm start
```

**Railway:** New project → Deploy from GitHub repo → this repository. Add a volume at `/data`, the variable `BBG_ADMIN_PASSWORD`, a public domain for port `8080` and a TCP proxy for port `8443`. All variables: [docs/RAILWAY.md](docs/RAILWAY.md).

## Security

- Passwords are stored as salted hashes; logins are rate-limited and sessions are signed cookies.
- Each subscriber's link is a long random token that you can rotate at any time.
- On Cloudflare there is no open first-run page, so nobody can claim your panel before you. Unknown addresses show a plain nginx 404 page.
- The Telegram bot deletes the message containing the token right away.

Full list: [docs/SECURITY.md](docs/SECURITY.md).

## Development

```bash
npm test                         # Worker and installer tests, no internet needed
node scripts/build-worker.mjs    # run after editing public/ to rebuild the Worker bundles
```

`src/` server · `worker/` Cloudflare · `installer/` token installer · `public/` shared panel UI · `docs/` notes

<p align="center"><sub>© 2026 SANDBAAD</sub></p>
