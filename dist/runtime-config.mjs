// Public deployment settings contain an API address only. Credentials stay on the server.
export const LIVE_REFRESH_MS = 60000;
const PUBLIC_ENDPOINTS = new Set(['/api/news', '/api/intelligence', '/api/maritime', '/api/oil', '/api/market-context', '/api/expectations', '/api/weather', '/api/vessels', '/api/config', '/api/diagnostics', '/api/acled', '/api/acled/events']);
const localHost = hostname => hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
const publicHostname = hostname => {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|test|invalid|example)$/.test(host) || /(?:^|\.)home\.arpa$/.test(host)) return false;
  return host.split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label));
};

export function normalizeApiBase(value = '') {
  if (typeof value !== 'string') throw new TypeError('The live-data address must be a public HTTPS URL.');
  if (!value.trim()) return '';
  let url;
  try { url = new URL(value.trim()); } catch { throw new TypeError('The live-data address must be a public HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !publicHostname(url.hostname)) {
    throw new TypeError('The live-data address must use a public HTTPS hostname, without credentials, a query or a fragment.');
  }
  url.hostname = url.hostname.replace(/\.$/, '');
  return url.href.replace(/\/+$/, '') + '/';
}

export function createRuntime({ apiBase = '', hosted = false, pageUrl = 'http://localhost/', moduleUrl = pageUrl, fetchImpl = globalThis.fetch } = {}) {
  const page = new URL(pageUrl), siteRoot = new URL('./', moduleUrl);
  const isHosted = hosted || !localHost(page.hostname);
  let base = '', configurationError = null;
  try { base = normalizeApiBase(apiBase); } catch (error) { configurationError = error.message; }
  if (isHosted && !base && !configurationError) configurationError = 'Live data is not configured for this public site.';
  const configurationNotice = configurationError ? 'Live data is not configured. No request to the source service was sent, so provider availability has not been checked.' : '';
  const privateConnectionsAllowed = !isHosted && !base;
  function siteUrl(path = '') {
    if (typeof path !== 'string' || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) throw new TypeError('Expected a Passage page path.');
    const url = new URL(path.replace(/^\//, ''), siteRoot);
    if (url.origin !== siteRoot.origin || !url.pathname.startsWith(siteRoot.pathname)) throw new TypeError('Passage page path leaves the site.');
    return url.href;
  }
  function apiUrl(path) {
    if (configurationError) throw new Error(configurationError);
    if (typeof path !== 'string' || !/^\/api\/[a-z\d/-]+(?:\?[^#]*)?$/i.test(path)) throw new TypeError('Expected a Passage API path.');
    const target = new URL(path, page.origin);
    if (target.pathname.includes('//') || target.pathname.endsWith('/')) throw new TypeError('Invalid Passage API path.');
    if (!privateConnectionsAllowed && !PUBLIC_ENDPOINTS.has(target.pathname)) throw new TypeError('This endpoint is only available in local Passage.');
    return base ? new URL(path.slice(1), base).href : target.href;
  }
  async function apiFetch(path, options = {}) {
    const url = apiUrl(path);
    if (!privateConnectionsAllowed && (String(options.method || 'GET').toUpperCase() !== 'GET' || options.body != null)) throw new TypeError('Public Passage supports read-only source requests.');
    const headers = new Headers(options.headers);
    if (!privateConnectionsAllowed && (headers.has('authorization') || headers.has('cookie') || headers.has('x-api-key'))) throw new TypeError('Private credentials cannot be sent from public Passage.');
    return fetchImpl(url, { ...options, credentials: privateConnectionsAllowed ? 'same-origin' : 'omit', headers, redirect: privateConnectionsAllowed ? 'follow' : 'error' });
  }
  return Object.freeze({ hosted: isHosted, apiBase: base, configurationError, configurationNotice, privateConnectionsAllowed, siteRoot: siteRoot.href, siteUrl, apiUrl, apiFetch });
}

const meta = name => globalThis.document?.querySelector(`meta[name="${name}"]`)?.content || '';
export const runtime = createRuntime({ apiBase: meta('passage-api-base'), hosted: meta('passage-hosted') === 'true', pageUrl: globalThis.location?.href || 'http://localhost/', moduleUrl: import.meta.url });
export const apiFetch = runtime.apiFetch;
export const siteUrl = runtime.siteUrl;

export function mountRuntimeNotice(doc = globalThis.document, config = runtime) {
  if (!doc) return;
  if (!config.privateConnectionsAllowed) doc.querySelectorAll('[data-local-only]').forEach(element => { element.hidden = true; });
  if (!config.hosted && !config.configurationError) return;
  let notice = doc.getElementById('runtime-notice');
  if (!notice) { notice = doc.createElement('aside'); notice.id = 'runtime-notice'; notice.className = 'runtime-notice'; notice.setAttribute('aria-label', 'Public site connection'); doc.querySelector('header')?.after(notice); }
  notice.dataset.state = config.configurationError ? 'unconfigured' : 'public';
  if (!config.configurationError && doc.body?.classList.contains('passage-workspace')) doc.querySelector('.page-footer')?.after(notice);
  notice.textContent = config.configurationError
    ? `${config.configurationError} Live reports, EIA observations, forecasts and vessel positions are unavailable. Dated reference context and your saved sources are not live updates. The separate oil chart connects directly to its named provider.`
    : 'Public source watch · this view checks while the page is open. Source dates and coverage limits still apply. Private account connections stay in local Passage.';
}
if (globalThis.document) mountRuntimeNotice();
