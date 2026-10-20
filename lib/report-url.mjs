// Canonical public article URLs for the reporting archive: no credentials,
// no private hosts, no secret-bearing parameters and no tracking parameters.
function publicUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 4096) return null;
    if ([...url.searchParams.keys()].some(k => /^(api_?key|access_token|token|password|secret)$/i.test(k))) return null;
    return url.href;
  } catch { return null; }
}

export function canonicalReportUrl(value) {
  const safe = publicUrl(value); if (!safe) return null;
  const url = new URL(safe);
  if (!url.hostname.includes('.') || /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) return null;
  if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname) || [...url.searchParams.keys()].some(k => /^(api[_-]?key|access[_-]?token|token|password|secret|authorization|signature|key)$/i.test(k))) return null;
  url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid|mc_cid|mc_eid|lctg|user_email|traffic_source)$/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
