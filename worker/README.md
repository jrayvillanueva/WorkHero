# Work Hero — SEO Audit Worker

A tiny Cloudflare Worker that powers the free SEO/AI audit tool. It fetches a
target site's HTML + `robots.txt` + sitemap + `llms.txt` (so the browser can
analyze on-page SEO), and proxies SEMrush keyword metrics without exposing the
API key.

## Why a Worker?
Browsers can't fetch another site's HTML directly (CORS), and a static page
can't safely hold a SEMrush key. The Worker solves both. Free tier is 100,000
requests/day — far more than enough.

## Deploy (CLI — ~5 min)
```bash
npm install -g wrangler
cd worker
wrangler login          # opens your browser to authorize
wrangler deploy         # prints your Worker URL, e.g. https://wh-audit.<you>.workers.dev
```
Then, to enable the SEMrush route (optional, see note below):
```bash
wrangler secret put SEMRUSH_TOKEN   # paste your semrtkn-pat-... token when prompted
```

## Deploy (Dashboard — no CLI)
1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Worker**.
2. Replace the starter code with the contents of [`src/index.js`](src/index.js) → **Deploy**.
3. Worker → **Settings** → **Variables** → **Add** an encrypted variable named
   `SEMRUSH_TOKEN` with your token (optional).
4. Copy the Worker URL from the top of the page.

## Wire it into the tool
In `proposals/seo-audit/index.html`, set:
```js
WORKER_URL: 'https://wh-audit.<you>.workers.dev',
```
And add your Pages domain to `ALLOWED_ORIGINS` at the top of `src/index.js` if it
isn't already there (`https://jrayvillanueva.github.io` is preset).

## Routes
| Route | Purpose |
|-------|---------|
| `GET /audit?url=<site>` | HTML + robots/sitemap/llms.txt for on-page analysis |
| `GET /semrush?keyword=<kw>&country=<iso2>` | SEMrush v4 keyword metrics (20 units each) |

## ⚠️ SEMrush status
Per project notes, the current v4 Personal Access Token returns **403 Forbidden**
on the metrics endpoint — the token needs the keyword/analytics scope (or the
plan's API add-on) enabled on SEMrush's side first. Until that's resolved, the
tool shows the keyword teaser as a **locked preview** and does not spend units.
Each live lookup costs **20 units** against the 50k/month budget, so live calls
should be cached and rate-limited before going public.
