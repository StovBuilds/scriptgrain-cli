export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Minimal api-v1 client. Errors come back as { error: { code, message } };
 * anything else becomes an ApiError with code "http_<status>".
 */
export function createClient({ baseUrl, token, fetch: f = globalThis.fetch }) {
  const base = baseUrl.replace(/\/+$/, '');
  async function request(method, path, body) {
    const headers = { accept: 'application/json', 'user-agent': 'scriptgrain-cli/0.1.0' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try {
      res = await f(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new ApiError(0, 'network_error', `Could not reach ${base}: ${e.message}`);
    }
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!res.ok) {
      const err = data && data.error ? data.error : {};
      throw new ApiError(res.status, err.code || `http_${res.status}`, err.message || `Request failed (${res.status})`, {
        retryAfter: res.headers && res.headers.get ? res.headers.get('retry-after') : null,
        requestId: res.headers && res.headers.get ? res.headers.get('x-request-id') : null,
        body: data,
      });
    }
    return data;
  }
  return {
    request,
    mintGuest: () => request('POST', '/v1/guest'),
    guestStatus: () => request('GET', '/v1/guest'),
    createProfile: (b) => request('POST', '/v1/profiles', b),
    listProfiles: () => request('GET', '/v1/profiles'),
    getProfile: (id) => request('GET', `/v1/profiles/${encodeURIComponent(id)}`),
    voiceMatch: (b) => request('POST', '/v1/voice-match', b),
    compareVoice: (b) => request('POST', '/v1/compare-voice', b),
  };
}
