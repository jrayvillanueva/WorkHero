/**
 * Work Hero — SEO Audit data Worker
 * Routes:
 *   GET /audit?url=<site>            -> fetches page HTML + robots.txt + sitemap + llms.txt
 *   GET /semrush?keyword=<kw>&country=<iso2>  -> SEMrush v4 keyword metrics (needs SEMRUSH_TOKEN secret)
 *
 * Deploy: see worker/README.md
 */

// Origins allowed to call this Worker. Add your custom domain if you set one up.
const ALLOWED_ORIGINS = [
  'https://jrayvillanueva.github.io',
  'http://localhost:8765',
];
const UA = 'Mozilla/5.0 (compatible; WorkHeroAudit/1.0; +https://useworkhero.com)';
const MAX_HTML = 1_500_000; // ~1.5MB cap

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Vary': 'Origin',
  };
}
function json(obj, origin, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });
}

// Basic SSRF guard: refuse localhost / private / link-local hosts.
function isBlockedHost(host) {
  if (!host) return true;
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '127.0.0.1' || h.startsWith('127.')) return true;
  if (h.startsWith('10.') || h.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.startsWith('169.254.')) return true; // link-local / cloud metadata
  if (h.endsWith('.internal') || h.endsWith('.local')) return true;
  return false;
}

function safeFetch(url, opts = {}) {
  return fetch(url, {
    redirect: 'follow',
    ...opts,
    headers: { 'User-Agent': UA, 'Accept': '*/*', ...(opts.headers || {}) },
  });
}

async function getText(url) {
  try {
    const r = await safeFetch(url);
    const content = r.ok ? (await r.text()).slice(0, MAX_HTML) : '';
    return { exists: r.ok, status: r.status, content };
  } catch (e) {
    return { exists: false, status: 0, content: '' };
  }
}

async function handleAudit(reqUrl, origin) {
  let target = reqUrl.searchParams.get('url') || '';
  if (!target) return json({ ok: false, error: 'missing url' }, origin, 400);
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target;

  let u;
  try { u = new URL(target); } catch (e) { return json({ ok: false, error: 'invalid url' }, origin, 400); }
  if (!/^https?:$/.test(u.protocol) || isBlockedHost(u.hostname)) {
    return json({ ok: false, error: 'URL not allowed' }, origin, 400);
  }

  let res;
  try { res = await safeFetch(u.href); }
  catch (e) { return json({ ok: false, error: 'fetch failed: ' + e.message, stage: 'fetch' }, origin); }

  const finalUrl = res.url || u.href;
  let html = '';
  try { html = (await res.text()).slice(0, MAX_HTML); } catch (e) {}
  const H = res.headers;
  const base = new URL(finalUrl).origin;

  const robots = await getText(base + '/robots.txt');
  const sitemaps = robots.exists
    ? [...robots.content.matchAll(/sitemap:\s*(\S+)/ig)].map(m => m[1])
    : [];
  const smUrl = sitemaps[0] || (base + '/sitemap.xml');
  const sm = await getText(smUrl);
  const llms = await getText(base + '/llms.txt');

  return json({
    ok: true,
    input: target,
    finalUrl,
    status: res.status,
    redirected: finalUrl.replace(/\/$/, '') !== u.href.replace(/\/$/, ''),
    headers: {
      'content-type': H.get('content-type'),
      'x-robots-tag': H.get('x-robots-tag'),
      'strict-transport-security': H.get('strict-transport-security'),
      'content-security-policy': H.get('content-security-policy') ? 'present' : null,
    },
    html,
    htmlTruncated: html.length >= MAX_HTML,
    robots: { exists: robots.exists, status: robots.status, sitemaps },
    sitemap: { exists: sm.exists, status: sm.status, url: smUrl },
    llms: { exists: llms.exists, status: llms.status },
  }, origin);
}

// SEMrush v4 Personal Access Token — auth header is "Apikey <token>" (NOT Bearer).
// 20 units per keyword. NOTE: token must have keyword/analytics scope or this 403s.
async function handleSemrush(reqUrl, origin, env) {
  const kw = reqUrl.searchParams.get('keyword') || '';
  const country = (reqUrl.searchParams.get('country') || 'us').toLowerCase();
  if (!kw) return json({ ok: false, error: 'missing keyword' }, origin, 400);
  if (!env || !env.SEMRUSH_TOKEN) return json({ ok: false, error: 'SEMRUSH_TOKEN not configured' }, origin, 501);
  try {
    const r = await fetch(
      'https://api.semrush.com/apis/v4/keywords/v1/metrics?keyword=' +
        encodeURIComponent(kw) + '&country=' + encodeURIComponent(country),
      { headers: { 'Authorization': 'Apikey ' + env.SEMRUSH_TOKEN } }
    );
    const body = await r.text();
    if (!r.ok) return json({ ok: false, error: 'SEMrush ' + r.status, detail: body.slice(0, 300) }, origin);
    let data; try { data = JSON.parse(body); } catch (e) { data = { raw: body }; }
    return json({ ok: true, keyword: kw, country, data }, origin);
  } catch (e) {
    return json({ ok: false, error: e.message }, origin);
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(request.url);
    if (url.pathname === '/audit') return handleAudit(url, origin);
    if (url.pathname === '/semrush') return handleSemrush(url, origin, env);
    return json({ ok: true, service: 'workhero-audit', routes: ['/audit?url=', '/semrush?keyword='] }, origin);
  },
};
