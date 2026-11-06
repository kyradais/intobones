/* js/api/client.js — fetch wrapper for the 9router API: proxy/direct mode, auth header, human-readable error mapping.
 * State: reads S.conn (baseUrl, apiKey, mode)
 * Gotchas: in proxy mode requests go to /proxy/<path> with X-Target-Base so CORS never applies. The base URL may
 *          already include /v1; paths are passed without a leading slash. Only 429 and 5xx errors are retryable.
 *
 * @auto-deps-begin
 * Defines: ApiError, apiFetch, blobToDataUrl, buildRequest, describeError, errorMessageFromBody,
 *   fetchRemoteImage, joinUrl, mapHttpError, normalizeBase
 * Uses: S
 * @auto-deps-end
 */
class ApiError extends Error {
  constructor(kind, message, extra) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.retryable = false;
    Object.assign(this, extra || {});
  }
}

function normalizeBase(raw) {
  let base = String(raw || '').trim();
  if (!base) return '';
  if (!/^https?:\/\//i.test(base)) base = 'http://' + base;
  return base.replace(/\/+$/, '');
}

function joinUrl(base, path) {
  return normalizeBase(base) + '/' + String(path).replace(/^\/+/, '');
}

function buildRequest(path) {
  const base = normalizeBase(S.conn.baseUrl);
  const headers = { 'Content-Type': 'application/json' };
  if (S.conn.apiKey) headers.Authorization = 'Bearer ' + S.conn.apiKey;
  if (S.conn.mode === 'direct') return { url: joinUrl(base, path), headers };
  headers['X-Target-Base'] = base;
  return { url: '/proxy/' + String(path).replace(/^\/+/, ''), headers };
}

function errorMessageFromBody(text) {
  try {
    const data = JSON.parse(text);
    if (data && data.error) return typeof data.error === 'string' ? data.error : data.error.message || '';
    if (data && data.message) return String(data.message);
  } catch (err) { /* not JSON */ }
  return String(text || '').slice(0, 200);
}

function mapHttpError(status, text, retryAfter, proxyError) {
  const detail = errorMessageFromBody(text);
  const suffix = detail ? ' — ' + detail : '';
  if (proxyError) return new ApiError('network', 'Proxy could not reach the API' + suffix, { status });
  if (status === 401 || status === 403) return new ApiError('auth', 'Authentication failed (' + status + '). Check the API key' + suffix, { status });
  if (status === 404) return new ApiError('notfound', 'Endpoint or model not found (404)' + suffix, { status });
  if (status === 429) {
    const secs = Number(retryAfter);
    return new ApiError('ratelimit', 'Rate limit reached (429)' + suffix, {
      status, retryable: true, retryAfterMs: secs > 0 ? secs * 1000 : 0
    });
  }
  if (status >= 500) return new ApiError('server', 'Server error (' + status + ')' + suffix, { status, retryable: true });
  return new ApiError('http', 'Request failed (' + status + ')' + suffix, { status });
}

async function apiFetch(path, opts) {
  const o = opts || {};
  const req = buildRequest(path);
  let res;
  try {
    res = await fetch(req.url, {
      method: o.method || 'GET',
      headers: req.headers,
      body: o.body ? JSON.stringify(o.body) : undefined,
      signal: o.signal
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    const hint = S.conn.mode === 'direct'
      ? 'Network or CORS error. Switch to Proxy mode, or check the Base URL.'
      : 'Network error. Is the Intobones server running and the Base URL correct?';
    throw new ApiError('network', hint);
  }
  const text = await res.text();
  if (!res.ok) throw mapHttpError(res.status, text, res.headers.get('retry-after'), res.headers.get('x-proxy-error'));
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ApiError('badjson', 'The server returned invalid JSON: ' + text.slice(0, 120));
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fetchRemoteImage(url) {
  let res;
  try {
    if (S.conn.mode === 'direct') {
      res = await fetch(url);
    } else {
      const u = new URL(url);
      res = await fetch('/proxy' + u.pathname + u.search, { headers: { 'X-Target-Base': u.origin } });
    }
  } catch (err) {
    throw new ApiError('network', 'Could not download the generated image from ' + url);
  }
  if (!res.ok) throw new ApiError('http', 'Could not download the generated image (' + res.status + ')');
  return blobToDataUrl(await res.blob());
}

function describeError(err) {
  if (!err) return 'Unknown error';
  if (err.name === 'AbortError') return 'Cancelled';
  return err.message || String(err);
}
