// Aqua MD outside Electron: the Android app (and later a web version) runs the same deck UI, with this
// browser backend standing in for Electron's main process. It defines window.aqua before app.js runs.
//   settings      -> localStorage
//   music library -> IndexedDB (each song file is copied in, so it plays offline and survives restarts)
//   Spotify       -> PKCE login in the browser, Web API for playlists and control; on phones the music
//                    plays through the Spotify app, on computers through Spotify's Web Playback SDK
//   lyrics        -> .lrc files picked with the songs, lyrics in the song's tags, or LRCLIB
import { parseBlob, selectCover } from 'music-metadata';

/* global __AQUA_VERSION__ */
const VERSION = typeof __AQUA_VERSION__ === 'string' ? __AQUA_VERSION__ : '0';
const NATIVE = window.AquaAndroid || null;            // Java bridge in the Android app
const PLATFORM = NATIVE ? 'android' : 'web';
const MOBILE = !!NATIVE || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const DEV = (() => { try { return JSON.parse(localStorage.getItem('aqua:dev') || 'null') || {}; } catch (e) { return {}; } })();
const ACCOUNTS = String(DEV.accounts || 'https://accounts.spotify.com').replace(/\/$/, '');
const API = String(DEV.api || 'https://api.spotify.com/v1').replace(/\/$/, '');
const SDK_URL = DEV.sdk || 'https://sdk.scdn.co/spotify-player.js';
const LRCLIB = String(DEV.lyrics || 'https://lrclib.net').replace(/\/$/, '');
const REDIRECT_URI = DEV.redirect || 'https://danii45.github.io/Aqua-MD/callback/';
const DASHBOARD = 'https://developer.spotify.com/dashboard';
const ENGINE_NAME = 'Aqua MD Web';
const SCOPES = ['streaming', 'user-read-email', 'user-read-private', 'user-read-playback-state', 'user-modify-playback-state',
  'user-read-currently-playing', 'playlist-read-private', 'playlist-read-collaborative'];

const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'webm'];
const VIDEO_EXT = ['mp4', 'm4v', 'mov'];
const ALL_EXT = new Set([...AUDIO_EXT, ...VIDEO_EXT]);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const extOf = name => { const m = /\.([^./\\]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; };
const pathOf = f => f.aquaPath || f.webkitRelativePath || f.name;
const dirOf = p => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
const stemOf = p => baseOf(p).replace(/\.[^.]+$/, '');
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha1 = async data => hex(await crypto.subtle.digest('SHA-1', typeof data === 'string' ? new TextEncoder().encode(data) : data)).slice(0, 16);
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomB64 = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

/* ---------------- events to the deck ---------------- */
const listeners = {};
const on = ch => cb => { (listeners[ch] = listeners[ch] || []).push(cb); };
const emit = (ch, payload) => (listeners[ch] || []).forEach(cb => { try { cb(payload); } catch (e) { console.error(e); } });

/* ---------------- settings ---------------- */
const DEFAULTS = {
  weather: { name: 'Vaughan, Ontario', lat: 43.8361, lon: -79.4983 },
  volume: 21, shuffle: false, repeat: 'off', colors: {}, recentPlaylists: [], spotify: {}, widgets: null, lastDisc: null,
  windowMode: 'window', keepAwake: false
};
const settings = {
  data: Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), (() => { try { return JSON.parse(localStorage.getItem('aqua:settings') || '{}'); } catch (e) { return {}; } })()),
  get(k) { return this.data[k]; },
  set(k, v) { this.data[k] = v; try { localStorage.setItem('aqua:settings', JSON.stringify(this.data)); } catch (e) { console.warn('[settings] not saved', e); } }
};

/* ---------------- IndexedDB ---------------- */
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open('aqua-md', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('art')) d.createObjectStore('art');
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function store(name, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(name, mode);
    let out;
    Promise.resolve(fn(tx.objectStore(name), v => { out = v; })).catch(reject);
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}
const reqP = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/* ---------------- music library ---------------- */
const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4' };

class Library {
  constructor() { this.discs = []; this.tracks = new Map(); this.urls = new Map(); this.artUrls = new Map(); }

  async load() {
    try {
      const [discs, recs] = await Promise.all([
        store('kv', 'readonly', (s, set) => reqP(s.get('discs')).then(set)),
        store('tracks', 'readonly', (s, set) => reqP(s.getAll()).then(set))
      ]);
      for (const r of recs || []) this.tracks.set(r.id, r);
      this.discs = (discs || []).map(d => Object.assign({}, d, { tracks: d.tracks.filter(id => this.tracks.has(id)) })).filter(d => d.tracks.length);
      const arts = new Set([...this.discs.map(d => d.art), ...[...this.tracks.values()].map(t => t.art)].filter(Boolean));
      await store('art', 'readonly', s => Promise.all([...arts].map(a => reqP(s.get(a)).then(b => { if (b) this.artUrls.set(a, URL.createObjectURL(b)); }))));
    } catch (e) { console.warn('[library] could not load', e); }
  }

  url(id) {
    if (!this.urls.has(id)) { const t = this.tracks.get(id); if (!t || !t.file) return null; this.urls.set(id, URL.createObjectURL(t.file)); }
    return this.urls.get(id);
  }

  forRenderer() {
    return this.discs.map(d => ({
      id: d.id, name: d.name, kind: 'mp3', art: (d.art && this.artUrls.get(d.art)) || null,
      tracks: d.tracks.map(id => this.tracks.get(id)).filter(Boolean).map(t => ({
        id: t.id, title: t.title, artist: t.artist, album: t.album, duration: t.duration || 0, video: !!t.video, ext: (t.ext || '').toUpperCase(),
        art: (t.art && this.artUrls.get(t.art)) || null, url: this.url(t.id)
      }))
    }));
  }

  persist() { return store('kv', 'readwrite', s => { s.put(this.discs.map(d => ({ id: d.id, name: d.name, art: d.art, tracks: d.tracks })), 'discs'); }); }

  async saveArt(pic) {
    if (!pic || !pic.data || !pic.data.length) return null;
    const id = await sha1(pic.data);
    if (!this.artUrls.has(id)) {
      const blob = new Blob([pic.data], { type: pic.format && pic.format.includes('/') ? pic.format : (/png/i.test(pic.format || '') ? 'image/png' : 'image/jpeg') });
      await store('art', 'readwrite', s => { s.put(blob, id); });
      this.artUrls.set(id, URL.createObjectURL(blob));
    }
    return id;
  }

  async readTrack(file, lrc) {
    const ext = extOf(file.name), video = VIDEO_EXT.includes(ext);
    let common = {}, format = {}, parsed = false;
    try {
      const meta = await parseBlob(file, { duration: false, skipPostHeaders: true });
      common = meta.common || {}; format = meta.format || {}; parsed = true;
    } catch (e) { /* unreadable tags: still try to play it */ }
    const pic = selectCover(common.picture || []) || (common.picture || [])[0];
    let art = null; try { art = await this.saveArt(pic); } catch (e) { art = null; }
    let lyrics = null;
    if (lrc) { try { lyrics = { text: await lrc.text() }; } catch (e) { lyrics = null; } }
    if (!lyrics) {
      for (const l of common.lyrics || []) {
        if (l && typeof l === 'object' && Array.isArray(l.syncText) && l.syncText.length) {
          lyrics = { sync: l.syncText.filter(x => x && x.text != null).map(x => ({ t: (Number(x.timestamp) || 0) / 1000, text: String(x.text).trim() })) }; break;
        }
        const text = typeof l === 'string' ? l : (l && l.text);
        if (text) { lyrics = { text }; break; }
      }
    }
    const p = pathOf(file);
    return {
      id: await sha1(`${p}|${file.size}|${file.lastModified || 0}`),
      dir: dirOf(p), ext,
      title: common.title || stemOf(p),
      artist: common.artist || common.albumartist || '',
      albumArtist: common.albumartist || common.artist || '',
      album: common.album || '',
      trackNo: (common.track && common.track.no) || 0,
      discNo: (common.disk && common.disk.no) || 0,
      duration: format.duration || 0,
      video, art, lyrics,
      silent: video && parsed && !format.codec && (format.trackInfo || []).length > 0 && format.trackInfo.every(ti => ti.video || ti.type === 1),
      unsupported: /alac/i.test(format.codec || ''),
      file: file.slice(0, file.size, file.type || MIME[ext] || 'application/octet-stream')
    };
  }

  async importFiles(list, onProgress) {
    const all = list.filter(f => f && ALL_EXT.has(extOf(f.name)));
    const lrcs = new Map(list.filter(f => f && extOf(f.name) === 'lrc').map(f => [(dirOf(pathOf(f)) + '/' + stemOf(pathOf(f))).toLowerCase(), f]));
    const fresh = [];
    let silent = 0, unsupported = 0, already = 0;
    for (let i = 0; i < all.length; i++) {
      if (onProgress) onProgress({ done: i, total: all.length });
      const f = all[i];
      const t = await this.readTrack(f, lrcs.get((dirOf(pathOf(f)) + '/' + stemOf(pathOf(f))).toLowerCase()));
      if (this.tracks.has(t.id) || fresh.some(x => x.id === t.id)) { already++; continue; }
      if (t.silent) { silent++; continue; }
      if (t.unsupported) { unsupported++; continue; }
      delete t.silent; delete t.unsupported;
      fresh.push(t);
    }
    if (onProgress) onProgress({ done: all.length, total: all.length });

    // One disc per album tag, or per folder when files have no album tag (same rules as the desktop app).
    const groups = new Map();
    fresh.forEach((t, i) => {
      t._order = i;
      const key = t.album ? `album:${(t.albumArtist || '').toLowerCase()}|${t.album.toLowerCase()}` : `folder:${t.dir}`;
      if (!groups.has(key)) groups.set(key, { key, name: t.album || baseOf(t.dir) || 'My Music', tracks: [] });
      groups.get(key).tracks.push(t);
    });
    const touched = new Set(), singles = [];
    const addTo = (id, name, tracks) => {
      let d = this.discs.find(x => x.id === id);
      if (!d) { d = { id, name, art: null, tracks: [] }; this.discs.push(d); }
      d.tracks.push(...tracks.map(t => t.id));
      touched.add(d);
    };
    for (const g of groups.values()) {
      const id = await sha1(g.key);
      if (g.tracks.length >= 2 || this.discs.some(d => d.id === id)) addTo(id, g.name, g.tracks); else singles.push(...g.tracks);
    }
    if (singles.length) addTo('loose', 'My Music', singles);

    if (fresh.length) {
      await store('tracks', 'readwrite', s => { for (const t of fresh) { const rec = Object.assign({}, t); delete rec._order; s.put(rec); } });
      fresh.forEach(t => { const rec = Object.assign({}, t); delete rec._order; this.tracks.set(t.id, rec); });
    }
    for (const d of touched) {
      const order = new Map(fresh.map(t => [t.id, t._order]));
      const recs = d.tracks.map((id, i) => ({ id, t: this.tracks.get(id), o: order.has(id) ? order.get(id) : -100000 + i }));
      recs.sort((a, b) => (a.t.discNo - b.t.discNo) || (a.t.trackNo - b.t.trackNo) || (a.o - b.o));
      d.tracks = recs.map(r => r.id);
      if (!d.art) { const w = recs.find(r => r.t.art); d.art = w ? w.t.art : null; }
    }
    await this.persist();
    return { touched: [...touched].map(d => d.id), added: fresh.length, already, silent, unsupported, found: all.length };
  }

  async setDuration(id, sec) {
    const t = this.tracks.get(id);
    if (!t || !(sec > 0) || !isFinite(sec) || Math.abs((t.duration || 0) - sec) < 0.5) return false;
    t.duration = sec;
    await store('tracks', 'readwrite', s => { s.put(t); });
    return true;
  }

  async removeDisc(id) {
    const i = this.discs.findIndex(d => d.id === id);
    if (i < 0) return false;
    const gone = this.discs[i].tracks;
    this.discs.splice(i, 1);
    await store('tracks', 'readwrite', s => { gone.forEach(t => s.delete(t)); });
    gone.forEach(t => { const u = this.urls.get(t); if (u) URL.revokeObjectURL(u); this.urls.delete(t); this.tracks.delete(t); });
    const used = new Set([...this.discs.map(d => d.art), ...[...this.tracks.values()].map(t => t.art)].filter(Boolean));
    const unused = [...this.artUrls.keys()].filter(a => !used.has(a));
    if (unused.length) await store('art', 'readwrite', s => { unused.forEach(a => s.delete(a)); });
    unused.forEach(a => { URL.revokeObjectURL(this.artUrls.get(a)); this.artUrls.delete(a); });
    await this.persist();
    return true;
  }
}

/* ---------------- lyrics ---------------- */
function parseLrc(src) {
  const out = []; let offset = 0;
  for (const raw of String(src || '').split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    const stamps = []; let rest = raw, m;
    const re = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
    while ((m = re.exec(rest))) { stamps.push(Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / Math.pow(10, m[3].length) : 0)); rest = rest.slice(m[0].length); }
    if (!stamps.length) continue;
    const text = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
    for (const t of stamps) out.push({ t: Math.max(0, t - offset), text });
  }
  return out.sort((a, b) => a.t - b.t);
}
const cleanPlain = s => String(s || '').replace(/\r/g, '').trim();
const norm = s => String(s || '').toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+.*(remaster|version|edit|mix).*$/i, '').replace(/\s+/g, ' ').trim();

class Lyrics {
  constructor(library) {
    this.library = library;
    this.cache = new Map();
    try { for (const [k, v] of JSON.parse(localStorage.getItem('aqua:lyrics') || '[]')) this.cache.set(k, v); } catch (e) { /* no cache */ }
    this.inflight = new Map();
  }
  remember(key, value) {
    this.cache.delete(key); this.cache.set(key, value);
    while (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
    try { localStorage.setItem('aqua:lyrics', JSON.stringify([...this.cache])); } catch (e) { /* cache is optional */ }
    return value;
  }
  find(q) {
    const title = String(q.title || '').trim();
    if (!title) return Promise.resolve({ status: 'none' });
    const key = q.id ? `file:${q.id}` : `web:${norm(q.artist)}|${norm(title)}|${Math.round(q.duration || 0)}`;
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = this.lookup(q, title).then(r => (r.status === 'error' ? r : this.remember(key, r)))
      .catch(e => ({ status: 'error', message: String((e && e.message) || e) })).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }
  async lookup(q, title) {
    const t = q.id && this.library.tracks.get(q.id);
    if (t && t.lyrics) {
      if (t.lyrics.sync && t.lyrics.sync.length) return { status: 'synced', lines: t.lyrics.sync.slice().sort((a, b) => a.t - b.t), source: 'file' };
      const lines = parseLrc(t.lyrics.text);
      if (lines.length) return { status: 'synced', lines, source: 'file' };
      if (cleanPlain(t.lyrics.text)) return { status: 'plain', plain: cleanPlain(t.lyrics.text), source: 'file' };
    }
    return this.fromLrclib({ title, artist: q.artist, album: q.album, duration: q.duration });
  }
  async request(pq) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(LRCLIB + pq);
      if (r.status === 503 && attempt === 0) { await sleep(1200); continue; }
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Lyrics service returned ${r.status}`);
      return r.json();
    }
    throw new Error('Lyrics service is busy');
  }
  shape(rec) {
    if (!rec) return null;
    if (rec.instrumental) return { status: 'instrumental', source: 'lrclib' };
    const lines = parseLrc(rec.syncedLyrics);
    if (lines.length) return { status: 'synced', lines, source: 'lrclib' };
    if (cleanPlain(rec.plainLyrics)) return { status: 'plain', plain: cleanPlain(rec.plainLyrics), source: 'lrclib' };
    return null;
  }
  async fromLrclib({ title, artist, album, duration }) {
    const firstArtist = String(artist || '').split(/,\s*|\s+&\s+|\s+feat\.?\s+/i)[0].trim();
    if (!firstArtist) return { status: 'none' };
    const q = new URLSearchParams({ track_name: title, artist_name: firstArtist });
    if (album) q.set('album_name', album);
    if (duration > 1 && duration < 3600) q.set('duration', String(Math.round(duration)));
    const exact = this.shape(await this.request(`/api/get?${q}`));
    if (exact) return exact;
    const list = await this.request(`/api/search?${new URLSearchParams({ track_name: title, artist_name: firstArtist })}`);
    const scored = (Array.isArray(list) ? list : []).filter(x => x && (x.syncedLyrics || x.plainLyrics || x.instrumental))
      .map(x => ({ x, d: duration ? Math.abs((x.duration || 0) - duration) : 0 })).filter(s => !duration || s.d <= 6)
      .sort((a, b) => (Number(!!b.x.syncedLyrics) - Number(!!a.x.syncedLyrics)) || (a.d - b.d));
    return (scored.length && this.shape(scored[0].x)) || { status: 'none' };
  }
}

/* ---------------- Spotify: account + Web API ---------------- */
class SpotifyError extends Error { constructor(m, status, reason) { super(m); this.status = status || 0; this.reason = reason || ''; } }

class SpotifyWeb {
  constructor() {
    const saved = settings.get('spotify') || {};
    this.clientId = saved.clientId || ''; this.name = saved.name || ''; this.refreshToken = saved.refresh || '';
    this.access = null; this.refreshing = null; this.error = '';
  }
  get linked() { return !!(this.clientId && this.refreshToken); }
  get pending() {
    try { const p = JSON.parse(localStorage.getItem('aqua:login') || 'null'); return p && Date.now() - p.at < 15 * 60e3 ? p : null; } catch (e) { return null; }
  }
  set pending(p) { if (p) localStorage.setItem('aqua:login', JSON.stringify(p)); else localStorage.removeItem('aqua:login'); }
  account() {
    return { configured: !!this.clientId, clientIdHint: this.clientId ? '…' + this.clientId.slice(-4) : '', linked: this.linked, name: this.name,
      loggingIn: !!this.pending, error: this.error, redirectUri: REDIRECT_URI };
  }
  persist() { settings.set('spotify', { clientId: this.clientId, name: this.name, refresh: this.refreshToken }); }
  setClientId(id) {
    id = String(id || '').trim();
    if (!/^[0-9a-fA-F]{32}$/.test(id)) return { ok: false, error: 'A Client ID is 32 letters and numbers. Copy it from your app’s Settings page on the Spotify dashboard.' };
    if (id !== this.clientId) { this.clientId = id; this.refreshToken = ''; this.access = null; this.name = ''; }
    this.error = ''; this.persist();
    return { ok: true };
  }
  logout() { this.refreshToken = ''; this.access = null; this.name = ''; this.error = ''; this.pending = null; this.persist(); }
  forgetClientId() { this.clientId = ''; this.logout(); }

  async loginUrl() {
    if (!this.clientId) throw new SpotifyError('Add your Client ID first.');
    const verifier = randomB64(64);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    // The callback page reads the first letter to send the login back to the right place: a = Android app, w = web.
    const state = (NATIVE ? 'a' : 'w') + randomB64(16);
    this.pending = { verifier, state, at: Date.now() };
    this.error = '';
    const q = new URLSearchParams({ client_id: this.clientId, response_type: 'code', redirect_uri: REDIRECT_URI, code_challenge_method: 'S256', code_challenge: challenge, state, scope: SCOPES.join(' ') });
    return `${ACCOUNTS}/authorize?${q}`;
  }
  async handleCallback(params) {
    const p = this.pending;
    if (!p || params.get('state') !== p.state) return { ok: false, message: 'That login link expired. Press “Log in with Spotify” again.' };
    this.pending = null;
    const err = params.get('error');
    if (err) { this.error = err === 'access_denied' ? 'Login was cancelled.' : `Spotify said: ${err}`; return { ok: false, message: this.error }; }
    try {
      this.useTokens(await this.tokenRequest({ grant_type: 'authorization_code', code: params.get('code') || '', redirect_uri: REDIRECT_URI, client_id: this.clientId, code_verifier: p.verifier }));
      try { const me = await this.api('GET', '/me'); this.name = (me && (me.display_name || me.id)) || ''; } catch (e) { this.name = ''; }
      this.error = ''; this.persist();
      return { ok: true };
    } catch (e) { this.error = friendlyAuthError(e); return { ok: false, message: this.error }; }
  }
  useTokens(tok) {
    if (!tok || !tok.access_token) throw new SpotifyError('Spotify did not send a login token.');
    this.access = { token: tok.access_token, expires: Date.now() + (Number(tok.expires_in) || 3600) * 1000 };
    if (tok.refresh_token) this.refreshToken = tok.refresh_token;
  }
  async tokenRequest(form) {
    const r = await fetch(`${ACCOUNTS}/api/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { j = null; }
    if (!r.ok) throw new SpotifyError((j && (j.error_description || j.error)) || `HTTP ${r.status}`, r.status, j && j.error);
    return j;
  }
  async token() {
    if (!this.linked) throw new SpotifyError('Spotify is not connected.', 401, 'not-linked');
    if (this.access && this.access.expires - Date.now() > 60e3) return this.access.token;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try { this.useTokens(await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.refreshToken, client_id: this.clientId })); this.persist(); }
        catch (e) {
          if (e.status === 400 || e.status === 401) { this.refreshToken = ''; this.access = null; this.error = 'Spotify logged Aqua MD out. Log in again.'; this.persist(); hub.pushAccount(); }
          throw e;
        } finally { this.refreshing = null; }
      })();
    }
    await this.refreshing;
    return this.access.token;
  }
  async api(method, path, { query, body } = {}, attempt = 0) {
    const tok = await this.token();
    const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')) : '';
    const r = await fetch(`${API}${path}${qs}`, { method, headers: Object.assign({ authorization: `Bearer ${tok}` }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && attempt === 0) { this.access = null; return this.api(method, path, { query, body }, 1); }
    if (r.status === 429 && attempt < 2) { await sleep(Math.min(8, Number(r.headers.get('retry-after')) || 1) * 1000); return this.api(method, path, { query, body }, attempt + 1); }
    if (r.status === 204 || r.status === 202) return null;
    const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
    if (!r.ok) { const e = (j && j.error) || {}; throw new SpotifyError(e.message || `Spotify returned ${r.status}`, r.status, e.reason || ''); }
    return j;
  }
  async playlists() {
    const out = []; let offset = 0;
    for (let page = 0; page < 8; page++) {
      const j = await this.api('GET', '/me/playlists', { query: { limit: 50, offset } });
      const items = (j && j.items) || [];
      for (const p of items) {
        if (!p || !p.id) continue;
        const imgs = (p.images || []).slice().sort((a, b) => (a.width || 640) - (b.width || 640));
        const img = imgs.find(i => (i.width || 640) >= 200) || imgs[imgs.length - 1] || null;
        const count = p.items && typeof p.items.total === 'number' ? p.items.total : (p.tracks && typeof p.tracks.total === 'number' ? p.tracks.total : null);
        out.push({ id: p.id, uri: p.uri || `spotify:playlist:${p.id}`, name: p.name || 'Untitled playlist', owner: (p.owner && (p.owner.display_name || p.owner.id)) || '', total: count, image: img ? img.url : null });
      }
      if (!j || !j.next || !items.length) break;
      offset += items.length;
    }
    return out;
  }
  devices() { return this.api('GET', '/me/player/devices').then(j => (j && j.devices) || []); }
  playback() { return this.api('GET', '/me/player'); }
  playContext(deviceId, contextUri, offset) {
    const body = { context_uri: contextUri };
    if (Number.isInteger(offset) && offset >= 0) body.offset = { position: offset };
    return this.api('PUT', '/me/player/play', { query: { device_id: deviceId }, body });
  }
  async queue() {
    const j = await this.api('GET', '/me/player/queue');
    const pick = imgs => { const l = (imgs || []).slice().sort((a, b) => (a.width || 640) - (b.width || 640)); const i = l.find(x => (x.width || 640) >= 64) || l[l.length - 1]; return i ? i.url : null; };
    return ((j && j.queue) || []).slice(0, 8).map(t => ({ title: t.name || '', artist: (t.artists || []).map(a => a.name).join(', ') || (t.show && t.show.name) || '', art: pick((t.album && t.album.images) || t.images), duration: (t.duration_ms || 0) / 1000 }));
  }
  transfer(deviceId, play) { return this.api('PUT', '/me/player', { body: { device_ids: [deviceId], play: !!play } }); }
  shuffle(on, deviceId) { return this.api('PUT', '/me/player/shuffle', { query: { state: on ? 'true' : 'false', device_id: deviceId } }); }
  repeat(mode, deviceId) { return this.api('PUT', '/me/player/repeat', { query: { state: mode, device_id: deviceId } }); }
}
function friendlyAuthError(e) {
  const m = String((e && e.message) || '');
  if (/invalid_client/i.test(m)) return 'Spotify did not recognise that Client ID. Check it on the dashboard.';
  if (/redirect/i.test(m)) return `Add this Redirect URI to your app on the Spotify dashboard: ${REDIRECT_URI}`;
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Could not reach Spotify. Check your internet connection.';
  return `Login failed: ${m}`;
}

/* ---------------- Spotify: built-in player (computers only) ---------------- */
function pickArt(images, min) {
  const l = (images || []).slice().sort((a, b) => (a.width || 640) - (b.width || 640));
  const i = l.find(x => (x.width || 640) >= (min || 250)) || l[l.length - 1];
  return i ? i.url : null;
}
class Engine {
  constructor() { this.status = MOBILE ? 'unsupported' : 'off'; this.deviceId = null; this.error = null; this.now = null; this.player = null; this.loaded = false; }
  async start() {
    if (MOBILE || !web.linked || this.status === 'starting' || this.status === 'ready') return;
    this.set('starting');
    if (!DEV.skipWidevine) {
      try { await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }] }]); }
      catch (e) { this.set('error', { type: 'widevine', message: (e && e.message) || '' }); return; }
    }
    const make = () => {
      const p = new window.Spotify.Player({ name: ENGINE_NAME, volume: 0.5, getOAuthToken: cb => { web.token().then(cb).catch(() => {}); } });
      p.addListener('ready', ({ device_id }) => { this.deviceId = device_id; this.status = 'ready'; this.error = null; hub.pushAccount(); hub.pushNow(); });
      p.addListener('not_ready', () => { this.status = 'starting'; this.now = null; hub.pushAccount(); hub.pushNow(); });
      p.addListener('player_state_changed', s => this.onState(s));
      ['initialization_error', 'authentication_error', 'account_error', 'playback_error'].forEach(type => p.addListener(type, e => {
        if (type === 'playback_error') { emit('spotify:notice', { text: 'Spotify could not play that track' }); return; }
        if (type === 'authentication_error') web.access = null;
        this.set('error', { type, message: (e && e.message) || '' });
      }));
      p.connect().then(ok => { if (!ok) this.set('error', { type: 'initialization_error', message: 'The Spotify player did not connect.' }); });
      this.player = p;
      setInterval(() => { if (this.player) this.player.getCurrentState().then(s => this.onState(s)).catch(() => {}); }, 1000);
    };
    if (window.Spotify && window.Spotify.Player) { make(); return; }
    window.onSpotifyWebPlaybackSDKReady = make;
    if (!this.loaded) {
      this.loaded = true;
      const s = document.createElement('script'); s.src = SDK_URL;
      s.onerror = () => { this.loaded = false; this.set('error', { type: 'load', message: '' }); };
      document.head.append(s);
    }
  }
  onState(s) {
    if (!s || !s.track_window || !s.track_window.current_track) { if (this.now) { this.now = null; hub.pushNow(); } return; }
    const t = s.track_window.current_track;
    this.now = { paused: !!s.paused, position: (s.position || 0) / 1000, duration: (s.duration || 0) / 1000, shuffle: !!s.shuffle, repeat: s.repeat_mode || 0,
      title: t.name || '', artist: (t.artists || []).map(a => a.name).join(', '), album: (t.album && t.album.name) || '', art: pickArt(t.album && t.album.images),
      uri: t.uri || '', contextUri: (s.context && s.context.uri) || null, contextName: (s.context && s.context.metadata && s.context.metadata.name) || '', at: Date.now() };
    hub.pushNow();
  }
  set(status, error) { this.status = status; this.error = error || null; if (status !== 'ready') { this.now = null; if (status !== 'starting') this.deviceId = null; } hub.pushAccount(); hub.pushNow(); }
  stop() { if (this.player) { try { this.player.disconnect(); } catch (e) { /* gone */ } } this.player = null; this.deviceId = null; this.now = null; this.status = MOBILE ? 'unsupported' : 'off'; }
  async command(cmd, arg) {
    const p = this.player; if (!p) return { ok: false, error: 'engine-off' };
    try {
      if (cmd === 'resume') await p.resume(); else if (cmd === 'pause') await p.pause(); else if (cmd === 'toggle') await p.togglePlay();
      else if (cmd === 'next') await p.nextTrack(); else if (cmd === 'prev') await p.previousTrack();
      else if (cmd === 'seek') await p.seek(Math.max(0, Math.round(Number(arg) * 1000))); else if (cmd === 'volume') await p.setVolume(Math.max(0, Math.min(1, Number(arg))));
      return { ok: true };
    } catch (e) { return { ok: false, error: (e && e.message) || 'failed' }; }
  }
  activate() { if (this.player && this.player.activateElement) this.player.activateElement().catch(() => {}); }
}

/* ---------------- Spotify: whatever is playing on another device (the Spotify app) ---------------- */
const REPEAT_IN = { off: 'None', context: 'Playlist', track: 'Track' };
const REPEAT_OUT = { None: 'off', Playlist: 'context', Track: 'track' };
class Remote {
  constructor() { this.state = { available: false, status: 'Stopped' }; this.deviceId = null; this.timer = null; }
  start() { this.loop(); document.addEventListener('visibilitychange', () => { if (!document.hidden) this.poke(200); }); }
  poke(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.loop(), ms || 0); }
  async loop() {
    let delay = 10000;
    if (web.linked) {
      try {
        const p = await web.playback();
        const dev = p && p.device;
        const mine = dev && (dev.id === engine.deviceId || (dev.name === ENGINE_NAME && !MOBILE));
        if (p && dev && p.item && !mine) {
          const t = p.item;
          this.deviceId = dev.id;
          this.state = { available: true, status: p.is_playing ? 'Playing' : 'Paused', title: t.name || '',
            artist: (t.artists || []).map(a => a.name).join(', ') || (t.show && t.show.name) || '', album: (t.album && t.album.name) || '',
            art: pickArt((t.album && t.album.images) || t.images), length: (t.duration_ms || 0) / 1000, position: (p.progress_ms || 0) / 1000,
            positionAt: Date.now(), shuffle: !!p.shuffle_state, loop: REPEAT_IN[p.repeat_state] || 'None', trackId: t.uri || '', trackNumber: 0,
            volume: dev.volume_percent != null ? dev.volume_percent / 100 : undefined, canSeek: true, deviceName: dev.name || '',
            contextUri: (p.context && p.context.uri) || null };
          delay = p.is_playing ? 2500 : 5000;
        } else { this.deviceId = null; this.state = { available: false, status: 'Stopped' }; delay = 6000; }
      } catch (e) { delay = e && e.status === 429 ? 20000 : 12000; }
    } else this.state = { available: false, status: 'Stopped' };
    if (document.hidden) delay = Math.max(delay, 15000);
    hub.onRemote();
    this.timer = setTimeout(() => this.loop(), delay);
  }
  async control(cmd, arg) {
    if (!web.linked || !this.deviceId) return { ok: false, error: 'not-running' };
    const q = { device_id: this.deviceId }, s = this.state;
    try {
      switch (cmd) {
        case 'play': await web.api('PUT', '/me/player/play', { query: q }); s.status = 'Playing'; break;
        case 'pause': await web.api('PUT', '/me/player/pause', { query: q }); s.status = 'Paused'; break;
        case 'playpause': return this.control(s.status === 'Playing' ? 'pause' : 'play');
        case 'next': await web.api('POST', '/me/player/next', { query: q }); break;
        case 'prev': await web.api('POST', '/me/player/previous', { query: q }); break;
        case 'stop': await web.api('PUT', '/me/player/pause', { query: q }); await web.api('PUT', '/me/player/seek', { query: Object.assign({ position_ms: 0 }, q) }); s.status = 'Paused'; break;
        case 'seek': await web.api('PUT', '/me/player/seek', { query: Object.assign({ position_ms: Math.max(0, Math.round((Number(arg) || 0) * 1000)) }, q) }); s.position = Number(arg) || 0; s.positionAt = Date.now(); break;
        case 'shuffle': await web.api('PUT', '/me/player/shuffle', { query: Object.assign({ state: arg ? 'true' : 'false' }, q) }); s.shuffle = !!arg; break;
        case 'loop': await web.api('PUT', '/me/player/repeat', { query: Object.assign({ state: REPEAT_OUT[arg] || 'off' }, q) }); s.loop = REPEAT_OUT[arg] ? arg : 'None'; break;
        case 'volume': await web.api('PUT', '/me/player/volume', { query: Object.assign({ volume_percent: Math.round(Math.max(0, Math.min(1, Number(arg) || 0)) * 100) }, q) }); break;
        default: return { ok: false, error: 'unknown-command' };
      }
      hub.pushNow();
      this.poke(cmd === 'next' || cmd === 'prev' ? 700 : 400);
      return { ok: true };
    } catch (e) { return { ok: false, error: (e && e.message) || 'failed', status: e && e.status }; }
  }
}

/* ---------------- Spotify: what the deck sees ---------------- */
const LOOP_TO_API = { None: 'off', Playlist: 'context', Track: 'track' };
const ENGINE_REPEAT = ['None', 'Playlist', 'Track'];
const hub = {
  cachedPlaylists: null,
  via() { if (engine.status === 'ready' && engine.now) return 'aqua'; if (remote.state.available) return 'app'; return null; },
  now() {
    const via = this.via();
    const base = { available: engine.status === 'ready' || remote.state.available, via, engineReady: engine.status === 'ready', appOpen: remote.state.available };
    if (via === 'aqua') {
      const s = engine.now;
      return Object.assign(base, { status: s.paused ? 'Paused' : 'Playing', title: s.title, artist: s.artist, album: s.album, art: s.art, length: s.duration,
        position: s.position, positionAt: s.at, shuffle: s.shuffle, loop: ENGINE_REPEAT[s.repeat] || 'None', trackId: s.uri, trackNumber: 0, contextUri: s.contextUri, contextName: s.contextName });
    }
    if (via === 'app') return Object.assign({}, remote.state, base);
    return Object.assign(base, { status: 'Stopped' });
  },
  pushNow() { emit('spotify:state', this.now()); },
  accountState() {
    return Object.assign(web.account(), { engine: { status: engine.status, error: engine.error }, appOpen: remote.state.available,
      deviceName: remote.state.deviceName || '', platform: PLATFORM, mobile: MOBILE });
  },
  pushAccount() { emit('spotify:account', this.accountState()); },
  lastRemote: '',
  onRemote() {
    const sig = JSON.stringify([remote.state.available, remote.state.deviceName]);
    if (sig !== this.lastRemote) { this.lastRemote = sig; this.pushAccount(); }
    this.pushNow();
  },
  async appDevice() {
    const list = await web.devices();
    const others = list.filter(d => d.id && d.id !== engine.deviceId && !(d.name === ENGINE_NAME && !MOBILE) && !d.is_restricted);
    const prefer = MOBILE ? 'Smartphone' : 'Computer';
    return others.find(d => d.is_active) || others.find(d => d.type === prefer) || others[0] || null;
  },
  // On a phone, the Spotify app has to be running to play. Open it, then wait for it to show up as a device.
  async wakeApp(uri) {
    if (!MOBILE) return null;
    openSpotifyApp(uri);
    const until = Date.now() + 45e3;
    while (Date.now() < until) {
      await sleep(1500);
      try { const dev = await this.appDevice(); if (dev) return dev; } catch (e) { /* keep waiting */ }
    }
    return null;
  },
  async control(cmd, arg) {
    try {
      const via = this.via();
      if (cmd === 'playContext') return await this.playContext(String((arg && arg.uri) || ''), { shuffle: !!(arg && arg.shuffle), total: Number(arg && arg.total) || 0 });
      if (cmd === 'queue') return { ok: true, items: web.linked ? await web.queue() : [] };
      if (cmd === 'playlists') return { ok: true, items: await this.playlists(!!(arg && arg.refresh)) };
      engine.activate();
      if (via === 'aqua') {
        switch (cmd) {
          case 'play': return engine.command('resume');
          case 'pause': return engine.command('pause');
          case 'playpause': return engine.command('toggle');
          case 'next': return engine.command('next');
          case 'prev': return engine.command('prev');
          case 'seek': return engine.command('seek', Number(arg) || 0);
          case 'stop': await engine.command('pause'); return engine.command('seek', 0);
          case 'volume': return engine.command('volume', Math.max(0, Math.min(1, Number(arg) || 0)));
          case 'shuffle': await web.shuffle(!!arg, engine.deviceId); return { ok: true };
          case 'loop': await web.repeat(LOOP_TO_API[arg] || 'off', engine.deviceId); return { ok: true };
          default: return { ok: false, error: 'unknown-command' };
        }
      }
      if (via === 'app') return remote.control(cmd, arg);
      if (cmd === 'play' && web.linked) {
        if (engine.status === 'ready') { await web.transfer(engine.deviceId, true); return { ok: true }; }
        const dev = (await this.appDevice()) || (await this.wakeApp(''));
        if (dev) { await web.transfer(dev.id, true); remote.poke(800); return { ok: true }; }
      }
      return { ok: false, error: 'no-player' };
    } catch (e) { return { ok: false, error: e.message || 'failed', status: e.status || 0 }; }
  },
  async playContext(uri, opts = {}) {
    if (!/^spotify:(playlist|album|artist|show):[A-Za-z0-9]+$/.test(uri)) return { ok: false, error: 'bad-uri' };
    if (!web.linked) return { ok: false, error: 'not-linked' };
    engine.activate();
    let deviceId = null, via = null;
    if (engine.status === 'ready' && engine.deviceId) { deviceId = engine.deviceId; via = 'aqua'; }
    else {
      const dev = (await this.appDevice()) || (await this.wakeApp(uri));
      if (!dev) return { ok: false, error: 'no-device' };
      deviceId = dev.id; via = 'app';
    }
    const offset = opts.shuffle && opts.total > 1 ? Math.floor(Math.random() * opts.total) : null;
    try { await web.playContext(deviceId, uri, offset); }
    catch (e) { if (offset != null && e.status === 400) await web.playContext(deviceId, uri, null); else throw e; }
    try { await web.shuffle(!!opts.shuffle, deviceId); } catch (e) { /* the song still plays */ }
    if (via === 'app') remote.poke(900);
    return { ok: true, via, shuffle: !!opts.shuffle };
  },
  async playlists(refresh) {
    if (!refresh && this.cachedPlaylists) return this.cachedPlaylists;
    this.cachedPlaylists = await web.playlists();
    return this.cachedPlaylists;
  }
};

function openSpotifyApp(uri) {
  const id = /^spotify:(playlist|album|artist|show):([A-Za-z0-9]+)$/.exec(uri || '');
  if (NATIVE && NATIVE.openSpotify) { try { NATIVE.openSpotify(uri || 'spotify:'); return; } catch (e) { /* fall through */ } }
  window.open(id ? `https://open.spotify.com/${id[1]}/${id[2]}` : 'https://open.spotify.com/', '_blank', 'noopener');
}
function openExternal(url) {
  if (NATIVE && NATIVE.openExternal) { NATIVE.openExternal(url); return; }
  window.open(url, '_blank', 'noopener');
}

/* ---------------- window ---------------- */
let nativeFull = false;
function displayInfo() {
  const w = Math.round(screen.width * (devicePixelRatio || 1)), h = Math.round(screen.height * (devicePixelRatio || 1));
  const full = NATIVE ? nativeFull : !!document.fullscreenElement;
  return { count: 1, index: 0, label: `${w} × ${h}`, edge: w / h > 3.2, fullscreen: full, mode: full ? 'full' : 'window' };
}
async function setWindowMode(mode) {
  const full = mode === 'full';
  settings.set('windowMode', full ? 'full' : 'window');
  if (NATIVE && NATIVE.setFullscreen) { NATIVE.setFullscreen(full); nativeFull = full; }
  else {
    try { if (full && !document.fullscreenElement) await document.documentElement.requestFullscreen(); else if (!full && document.fullscreenElement) await document.exitFullscreen(); }
    catch (e) { /* browser said no */ }
  }
  setTimeout(() => emit('window:display', displayInfo()), 250);
  return displayInfo();
}
document.addEventListener('fullscreenchange', () => emit('window:display', displayInfo()));

/* ---------------- picking files ---------------- */
function pickFiles(folder) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    if (folder) input.webkitdirectory = true;
    else input.accept = 'audio/*,video/*,.lrc,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.wav,.webm,.mp4,.m4v,.mov';
    input.style.display = 'none';
    let done = false;
    const finish = v => { if (done) return; done = true; input.remove(); resolve(v); };
    input.addEventListener('change', () => finish(Array.from(input.files || [])));
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    input.click();
  });
}
// Folders dropped on the page: walk them (only possible while the drop event is running, so start now).
function droppedFiles(files, items) {
  const entries = Array.from(items || []).map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length || !entries.some(e => e.isDirectory)) return Promise.resolve(Array.from(files || []));
  const out = [];
  const walk = (entry, depth) => new Promise(resolve => {
    if (entry.isFile) { entry.file(f => { f.aquaPath = entry.fullPath.replace(/^\//, ''); out.push(f); resolve(); }, () => resolve()); return; }
    if (!entry.isDirectory || depth > 8) { resolve(); return; }
    const reader = entry.createReader(), kids = [];
    const more = () => reader.readEntries(list => { if (!list.length) { Promise.all(kids.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map(k => walk(k, depth + 1))).then(() => resolve()); return; } kids.push(...list); more(); }, () => resolve());
    more();
  });
  return Promise.all(entries.map(e => walk(e, 0))).then(() => out);
}

/* ---------------- start ---------------- */
const library = new Library();
const lyrics = new Lyrics(library);
const web = new SpotifyWeb();
const engine = new Engine();
const remote = new Remote();
const ready = (async () => {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* not granted */ }
  await library.load();
  // Coming back from Spotify's login page (web version: the callback page forwards here with ?code=…&state=…).
  const q = new URLSearchParams(location.search);
  if (q.get('state') && (q.get('code') || q.get('error'))) {
    history.replaceState(null, '', location.pathname);
    await web.handleCallback(q);
  }
  if (settings.get('windowMode') === 'full' && NATIVE && NATIVE.setFullscreen) { NATIVE.setFullscreen(true); nativeFull = true; }
  if (settings.get('keepAwake') && NATIVE && NATIVE.setKeepAwake) NATIVE.setKeepAwake(true);
  remote.start();
  if (web.linked) engine.start();
})();

async function finishLogin(query) {
  const r = await web.handleCallback(new URLSearchParams(query));
  hub.cachedPlaylists = null;
  hub.pushAccount();
  if (r.ok) { engine.start(); remote.poke(300); emit('spotify:notice', { text: `Connected${web.name ? ' as ' + web.name : ''}` }); }
  return r;
}

// Calls from the Android app's Java side.
window.__aquaNative = {
  authCallback: query => finishLogin(query),
  media: cmd => { const r = window.__aquaRemote; if (r && typeof r[cmd] === 'function') r[cmd](); },
  back: () => { const r = window.__aquaRemote; return !!(r && r.back && r.back()); },
  fullscreen: on => { nativeFull = !!on; emit('window:display', displayInfo()); }
};

let lastPlaying = '';
window.aqua = {
  init: async () => {
    await ready;
    return {
      version: NATIVE && NATIVE.version ? NATIVE.version() : VERSION,
      platform: PLATFORM, appImage: true,
      features: { folders: !NATIVE, drop: !MOBILE, quit: false, startup: false, screens: false, onTop: false, fullscreen: true, keepAwake: !!(NATIVE && NATIVE.setKeepAwake) },
      settings: {
        weather: settings.get('weather'), volume: settings.get('volume'), lastDisc: settings.get('lastDisc'), shuffle: !!settings.get('shuffle'),
        repeat: settings.get('repeat') || 'off', colors: settings.get('colors') || {}, recentPlaylists: settings.get('recentPlaylists') || [], widgets: settings.get('widgets'),
        startOnLogin: false, appMenu: false, onTop: false, keepAwake: !!settings.get('keepAwake')
      },
      discs: library.forRenderer(), spotify: hub.now(), account: hub.accountState(), display: displayInfo(), extensions: [...ALL_EXT]
    };
  },
  pick: async mode => {
    const files = await pickFiles(mode === 'folder');
    if (!files) return null;
    const res = await library.importFiles(files, p => emit('library:progress', p));
    return Object.assign(res, { discs: library.forRenderer() });
  },
  importFiles: (files, items) => droppedFiles(files, items).then(async list => {
    const res = await library.importFiles(list, p => emit('library:progress', p));
    return Object.assign(res, { discs: library.forRenderer() });
  }),
  removeDisc: async id => { await library.removeDisc(String(id)); return library.forRenderer(); },
  reportDuration: (id, sec) => library.setDuration(String(id), Number(sec)),
  onImportProgress: on('library:progress'),

  spotify: (cmd, arg) => hub.control(String(cmd), arg),
  onSpotify: on('spotify:state'),
  onSpotifyAccount: on('spotify:account'),
  onSpotifyNotice: on('spotify:notice'),
  spotifySetClientId: async id => { const r = web.setClientId(id); hub.pushAccount(); return r; },
  spotifyForgetClientId: async () => { engine.stop(); web.forgetClientId(); hub.cachedPlaylists = null; hub.pushAccount(); hub.pushNow(); return true; },
  spotifyLogin: async () => {
    try {
      const url = await web.loginUrl();
      hub.pushAccount();
      if (NATIVE) openExternal(url); else location.href = url;
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },
  spotifyLogout: async () => { engine.stop(); web.logout(); hub.cachedPlaylists = null; hub.pushAccount(); hub.pushNow(); return true; },
  spotifyRestart: async () => { engine.stop(); engine.start(); return true; },
  openDashboard: async () => { openExternal(DASHBOARD); return true; },
  copy: async text => {
    if (NATIVE && NATIVE.copy) { NATIVE.copy(String(text || '')); return true; }
    try { await navigator.clipboard.writeText(String(text || '')); return true; } catch (e) { return false; }
  },
  lyrics: q => {
    if (!q || typeof q !== 'object') return Promise.resolve({ status: 'none' });
    return lyrics.find({ id: q.id ? String(q.id) : '', title: String(q.title || ''), artist: String(q.artist || ''), album: String(q.album || ''), duration: Number(q.duration) || 0 });
  },
  sysStats: async () => null,

  set: async (key, value) => { if (Object.prototype.hasOwnProperty.call(DEFAULTS, key) && key !== 'spotify') settings.set(key, value); return true; },
  nextScreen: async () => displayInfo(),
  onDisplay: on('window:display'),
  toggleFullscreen: () => setWindowMode(displayInfo().fullscreen ? 'window' : 'full'),
  setWindowMode: mode => setWindowMode(String(mode)),
  quit: async () => { if (NATIVE && NATIVE.exit) NATIVE.exit(); return true; },

  // Tells the Android app what the deck is playing, for its notification and to keep playing in the background.
  nowPlaying: info => {
    if (!NATIVE || !NATIVE.nowPlaying) return;
    const s = JSON.stringify(info || {});
    if (s !== lastPlaying) { lastPlaying = s; try { NATIVE.nowPlaying(s); } catch (e) { /* app closing */ } }
  },
  setKeepAwake: on => { settings.set('keepAwake', !!on); if (NATIVE && NATIVE.setKeepAwake) NATIVE.setKeepAwake(!!on); }
};
