'use strict';
// Spotify account link (PKCE login, no client secret) and the Web API calls Aqua MD needs.
const crypto = require('crypto');
const { shapePage, shapeTrack, shapeSearch } = require('./spotify-items');

const PORT = 43821;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const ACCOUNTS = (process.env.AQUA_SPOTIFY_ACCOUNTS || 'https://accounts.spotify.com').replace(/\/$/, '');
const API = (process.env.AQUA_SPOTIFY_API || 'https://api.spotify.com/v1').replace(/\/$/, '');
const SCOPES = [
  'streaming', 'user-read-email', 'user-read-private',
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
  'playlist-read-private', 'playlist-read-collaborative'
];

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

class SpotifyError extends Error {
  constructor(message, status, reason) { super(message); this.status = status || 0; this.reason = reason || ''; }
}

class SpotifyWeb {
  /**
   * @param {object} o
   * @param {import('./settings').Settings} o.settings
   * @param {{ encrypt(s: string): string, decrypt(s: string): string, encrypted: boolean }} o.vault
   * @param {(account: object) => void} o.onChange
   */
  constructor({ settings, vault, onChange }) {
    this.settings = settings;
    this.vault = vault;
    this.onChange = onChange || (() => {});
    const saved = settings.get('spotify') || {};
    this.clientId = saved.clientId || '';
    this.name = saved.name || '';
    this.refreshToken = '';
    if (saved.refresh) { try { this.refreshToken = vault.decrypt(saved.refresh); } catch (e) { this.refreshToken = ''; } }
    this.access = null;           // { token, expires }
    this.pending = null;          // login in progress: { verifier, state, resolve, reject, timer }
    this.refreshing = null;
    this.error = '';
  }

  get linked() { return !!(this.clientId && this.refreshToken); }

  account() {
    return {
      configured: !!this.clientId,
      clientIdHint: this.clientId ? '…' + this.clientId.slice(-4) : '',
      linked: this.linked,
      name: this.name,
      loggingIn: !!this.pending,
      error: this.error,
      redirectUri: REDIRECT_URI
    };
  }

  persist() {
    this.settings.set('spotify', {
      clientId: this.clientId,
      name: this.name,
      refresh: this.refreshToken ? this.vault.encrypt(this.refreshToken) : ''
    });
  }

  changed() { try { this.onChange(this.account()); } catch (e) { /* window gone */ } }

  setClientId(id) {
    id = String(id || '').trim();
    if (!/^[0-9a-fA-F]{32}$/.test(id)) return { ok: false, error: 'A Client ID is 32 letters and numbers. Copy it from your app’s Settings page on the Spotify dashboard.' };
    if (id !== this.clientId) { this.clientId = id; this.refreshToken = ''; this.access = null; this.name = ''; }
    this.error = '';
    this.persist();
    this.changed();
    return { ok: true };
  }

  logout() {
    this.refreshToken = ''; this.access = null; this.name = ''; this.error = '';
    this.cancelLogin();
    this.persist();
    this.changed();
  }

  forgetClientId() { this.clientId = ''; this.logout(); }

  /* ---------- login ---------- */
  loginUrl() {
    if (!this.clientId) throw new SpotifyError('Add your Client ID first.');
    this.cancelLogin();
    const verifier = b64url(crypto.randomBytes(64));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const q = new URLSearchParams({
      client_id: this.clientId, response_type: 'code', redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256', code_challenge: challenge, state, scope: SCOPES.join(' ')
    });
    this.pending = { verifier, state };
    this.pending.timer = setTimeout(() => { this.pending = null; this.changed(); }, 10 * 60e3);
    this.error = '';
    this.changed();
    return `${ACCOUNTS}/authorize?${q}`;
  }

  cancelLogin() {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending = null; }
  }

  /** Handles the browser coming back to http://127.0.0.1:43821/callback. Returns a short message for that tab. */
  async handleCallback(query) {
    const p = this.pending;
    if (!p || query.get('state') !== p.state) {
      return { ok: false, message: 'This login link has expired. Go back to Aqua MD and press “Log in with Spotify” again.' };
    }
    this.cancelLogin();
    const err = query.get('error');
    if (err) {
      this.error = err === 'access_denied' ? 'Login was cancelled in the browser.' : `Spotify said: ${err}`;
      this.changed();
      return { ok: false, message: this.error };
    }
    try {
      const tok = await this.tokenRequest({
        grant_type: 'authorization_code', code: query.get('code') || '', redirect_uri: REDIRECT_URI,
        client_id: this.clientId, code_verifier: p.verifier
      });
      this.useTokens(tok);
      try { const me = await this.api('GET', '/me'); this.name = (me && (me.display_name || me.id)) || ''; } catch (e) { this.name = ''; }
      this.error = '';
      this.persist();
      this.changed();
      return { ok: true, message: `Aqua MD is connected${this.name ? ' as ' + this.name : ''}. You can close this tab.` };
    } catch (e) {
      this.error = friendlyAuthError(e);
      this.changed();
      return { ok: false, message: this.error };
    }
  }

  useTokens(tok) {
    if (!tok || !tok.access_token) throw new SpotifyError('Spotify did not send a login token.');
    this.access = { token: tok.access_token, expires: Date.now() + (Number(tok.expires_in) || 3600) * 1000 };
    if (tok.refresh_token) this.refreshToken = tok.refresh_token;
  }

  async tokenRequest(form) {
    const r = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString()
    });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch (e) { j = null; }
    if (!r.ok) throw new SpotifyError((j && (j.error_description || j.error)) || `HTTP ${r.status}`, r.status, j && j.error);
    return j;
  }

  /** A valid access token, refreshing it when it is about to expire. */
  async token() {
    if (!this.linked) throw new SpotifyError('Spotify is not connected.', 401, 'not-linked');
    if (this.access && this.access.expires - Date.now() > 60e3) return this.access.token;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const tok = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.refreshToken, client_id: this.clientId });
          this.useTokens(tok);
          this.persist();
        } catch (e) {
          if (e.status === 400 || e.status === 401) {
            // Refresh token revoked or app deleted: the user has to log in again.
            this.refreshToken = ''; this.access = null;
            this.error = 'Spotify logged Aqua MD out. Log in again.';
            this.persist(); this.changed();
          }
          throw e;
        } finally { this.refreshing = null; }
      })();
    }
    await this.refreshing;
    return this.access.token;
  }

  /* ---------- Web API ---------- */
  async api(method, path, { query, body } = {}, attempt = 0) {
    const tok = await this.token();
    const url = `${API}${path}${query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')) : ''}`;
    const r = await fetch(url, {
      method,
      headers: Object.assign({ authorization: `Bearer ${tok}` }, body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 401 && attempt === 0) { this.access = null; return this.api(method, path, { query, body }, 1); }
    if (r.status === 429 && attempt < 2) {
      const wait = Math.min(8, Number(r.headers.get('retry-after')) || 1);
      await sleep(wait * 1000);
      return this.api(method, path, { query, body }, attempt + 1);
    }
    if (r.status === 204 || r.status === 202) return null;
    const text = await r.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
    if (!r.ok) {
      const e = (j && j.error) || {};
      throw new SpotifyError(e.message || `Spotify returned ${r.status}`, r.status, e.reason || '');
    }
    return j;
  }

  async playlists() {
    const out = [];
    let offset = 0;
    for (let page = 0; page < 8; page++) {
      const j = await this.api('GET', '/me/playlists', { query: { limit: 50, offset } });
      const items = (j && j.items) || [];
      for (const p of items) {
        if (!p || !p.id) continue;
        const imgs = (p.images || []).slice().sort((a, b) => (a.width || 640) - (b.width || 640));
        const img = imgs.find(i => (i.width || 640) >= 200) || imgs[imgs.length - 1] || null;
        const count = p.items && typeof p.items.total === 'number' ? p.items.total
          : (p.tracks && typeof p.tracks.total === 'number' ? p.tracks.total : null);
        out.push({
          id: p.id, uri: p.uri || `spotify:playlist:${p.id}`, name: p.name || 'Untitled playlist',
          owner: (p.owner && (p.owner.display_name || p.owner.id)) || '', total: count, image: img ? img.url : null
        });
      }
      if (!j || !j.next || !items.length) break;
      offset += items.length;
    }
    return out;
  }

  devices() { return this.api('GET', '/me/player/devices').then(j => (j && j.devices) || []); }
  playback() { return this.api('GET', '/me/player'); }
  /** offset: a position number, or { uri } / { position } to start on a particular song. */
  playContext(deviceId, contextUri, offset) {
    const body = { context_uri: contextUri };
    if (offset && typeof offset === 'object') body.offset = offset;
    else if (Number.isInteger(offset) && offset >= 0) body.offset = { position: offset };
    return this.play(deviceId, body);
  }
  play(deviceId, body) { return this.api('PUT', '/me/player/play', { query: { device_id: deviceId }, body }); }
  /** Up to 50 songs of a playlist, from `offset`. Spotify only lists playlists this account made or collaborates on (403 otherwise). */
  async playlistItems(id, offset) {
    const j = await this.api('GET', `/playlists/${encodeURIComponent(id)}/items`, { query: { market: 'from_token', limit: 50, offset: offset || 0, additional_types: 'track,episode' } });
    return shapePage(j, offset || 0);
  }
  /** Whether one song can play in this account's country: { playable, why }, or null when it isn't a song. */
  async trackInfo(uri) {
    const m = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri || '');
    if (!m) return null;
    return shapeTrack(await this.api('GET', `/tracks/${m[1]}`, { query: { market: 'from_token' } }));
  }
  /** Songs, albums and playlists matching `q` (Spotify gives at most 10 of each per request). */
  async search(q) {
    const j = await this.api('GET', '/search', { query: { q, type: 'track,album,playlist', limit: 10, market: 'from_token' } });
    return shapeSearch(j);
  }
  async queue() {
    const j = await this.api('GET', '/me/player/queue');
    return ((j && j.queue) || []).slice(0, 20).map(shapeTrack);
  }
  transfer(deviceId, play) { return this.api('PUT', '/me/player', { body: { device_ids: [deviceId], play: !!play } }); }
  shuffle(on, deviceId) { return this.api('PUT', '/me/player/shuffle', { query: { state: on ? 'true' : 'false', device_id: deviceId } }); }
  repeat(mode, deviceId) { return this.api('PUT', '/me/player/repeat', { query: { state: mode, device_id: deviceId } }); }
}

function friendlyAuthError(e) {
  const m = String((e && e.message) || '');
  if (/invalid_client|INVALID_CLIENT/i.test(m)) return 'Spotify did not recognise that Client ID. Check it on the dashboard.';
  if (/redirect/i.test(m)) return `The Redirect URI on the dashboard must be exactly ${REDIRECT_URI}`;
  if (/fetch failed|ENOTFOUND|ECONN/i.test(m)) return 'Could not reach Spotify. Check your internet connection.';
  return `Login failed: ${m}`;
}

module.exports = { SpotifyWeb, SpotifyError, PORT, REDIRECT_URI, SCOPES };
