'use strict';
// Ties Spotify together for the deck: the built-in player (Spotify's Web Playback SDK running in a hidden
// window), the Spotify desktop app (over MPRIS), and the Web API for playlists, shuffle and loop.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { BrowserWindow, session, ipcMain } = require('electron');
const { PORT } = require('./spotify-web');

const ENGINE_DIR = path.join(__dirname, '..', 'renderer', 'engine');
const LOOP_TO_API = { None: 'off', Playlist: 'context', Track: 'track' };
const ENGINE_REPEAT = ['None', 'Playlist', 'Track'];

const CALLBACK_PAGE = (ok, msg) => `<!doctype html><meta charset="utf-8"><title>Aqua MD</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070c17;color:#e4efff;font:20px/1.45 system-ui,sans-serif}
main{max-width:34em;padding:40px;border-radius:28px;background:rgba(72,150,255,.14);border:1.5px solid rgba(150,205,255,.45)}
h1{margin:0 0 10px;font-size:26px;color:${ok ? '#8eeaff' : '#ffb8a6'}}p{margin:0}</style>
<main><h1>${ok ? 'Connected' : 'Not connected'}</h1><p>${msg.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p></main>`;

class SpotifyHub {
  constructor({ web, mpris, emit, getWindow }) {
    this.web = web;
    this.mpris = mpris;
    this.emit = emit;                // (channel, payload) => send to the deck window
    this.getWindow = getWindow;
    this.engine = { status: 'off', deviceId: null, error: null };
    this.engineNow = null;           // last state from the built-in player, null when it is not the active device
    this.mprisNow = { available: false };
    this.win = null;
    this.widevine = null;            // promise
    this.server = null;
    this.serverError = '';
    this.seq = 0;
    this.waiters = new Map();
    this.cachedPlaylists = null;
  }

  /* ---------- loopback server: login callback + engine page ---------- */
  startServer() {
    return new Promise(resolve => {
      const srv = http.createServer((req, res) => this.route(req, res));
      srv.on('error', e => {
        this.serverError = e.code === 'EADDRINUSE' ? `Port ${PORT} is busy. Close other copies of Aqua MD and restart it.` : e.message;
        console.warn('[spotify] server:', this.serverError);
        resolve(false);
      });
      srv.listen(PORT, '127.0.0.1', () => { this.server = srv; resolve(true); });
    });
  }

  route(req, res) {
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    if (u.pathname === '/callback') {
      this.web.handleCallback(u.searchParams).then(r => {
        send(200, 'text/html; charset=utf-8', CALLBACK_PAGE(r.ok, r.message));
        if (r.ok) { this.cachedPlaylists = null; this.startEngine(); if (this.mpris.poke) this.mpris.poke(500); }
        this.pushAccount();
      });
      return;
    }
    const files = { '/engine': ['engine.html', 'text/html; charset=utf-8'], '/engine.js': ['engine.js', 'text/javascript; charset=utf-8'] };
    const f = files[u.pathname];
    if (f) {
      try { return send(200, f[1], fs.readFileSync(path.join(ENGINE_DIR, f[0]))); } catch (e) { /* fall through */ }
    }
    send(404, 'text/plain', 'Not found');
  }

  /* ---------- built-in player ---------- */
  waitWidevine() {
    if (this.widevine) return this.widevine;
    let components = null;
    try { components = require('electron').components; } catch (e) { components = null; }
    if (process.env.AQUA_SKIP_WIDEVINE === '1') this.widevine = Promise.resolve(true);
    else if (!components || typeof components.whenReady !== 'function') this.widevine = Promise.resolve(false);
    else {
      this.widevine = Promise.race([
        components.whenReady().then(() => true),
        new Promise(r => setTimeout(() => r('timeout'), 90e3))
      ]).catch(() => false);
    }
    return this.widevine;
  }

  setEngine(status, error) {
    this.engine = { status, deviceId: status === 'ready' ? this.engine.deviceId : null, error: error || null };
    if (status !== 'ready') this.engineNow = null;
    this.pushAccount();
    this.pushNow();
  }

  async startEngine() {
    if (!this.web.linked || !this.server) { if (!this.server && this.web.linked) this.setEngine('error', { type: 'server', message: this.serverError }); return; }
    if (this.win && !this.win.isDestroyed()) { this.command('reconnect'); return; }
    this.setEngine('starting');
    const wv = await this.waitWidevine();
    if (wv !== true) {
      this.widevine = null; // try again next time
      this.setEngine('error', { type: 'widevine', message: wv === 'timeout' ? 'timeout' : 'missing' });
      return;
    }
    const ses = session.fromPartition('persist:spotify-engine');
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'mediaKeySystem'));
    this.win = new BrowserWindow({
      show: false, width: 400, height: 300, skipTaskbar: true, title: 'Aqua MD Spotify engine',
      webPreferences: {
        preload: path.join(__dirname, '..', 'engine-preload.js'),
        session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true,
        autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false, spellcheck: false
      }
    });
    this.win.webContents.on('render-process-gone', () => { this.win = null; this.setEngine('error', { type: 'crash', message: 'The built-in player stopped. Restart Aqua MD.' }); });
    this.win.on('closed', () => { this.win = null; });
    this.win.loadURL(`http://127.0.0.1:${PORT}/engine`).catch(e => this.setEngine('error', { type: 'load', message: e.message }));
  }

  stopEngine() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.engine = { status: 'off', deviceId: null, error: null };
    this.engineNow = null;
  }

  isEngineSender(e) { return this.win && !this.win.isDestroyed() && e.sender === this.win.webContents; }

  wireEngineIpc() {
    ipcMain.handle('engine:config', e => {
      if (!this.isEngineSender(e)) return null;
      return {
        name: 'Aqua MD',
        sdkUrl: process.env.AQUA_SPOTIFY_SDK || 'https://sdk.scdn.co/spotify-player.js',
        checkWidevine: process.env.AQUA_SKIP_WIDEVINE !== '1'
      };
    });
    ipcMain.handle('engine:token', async e => {
      if (!this.isEngineSender(e)) return null;
      try { return await this.web.token(); } catch (err) { return null; }
    });
    ipcMain.on('engine:event', (e, type, payload) => {
      if (!this.isEngineSender(e)) return;
      this.onEngineEvent(String(type), payload || {});
    });
  }

  onEngineEvent(type, p) {
    switch (type) {
      case 'ready':
        this.engine = { status: 'ready', deviceId: String(p.deviceId || ''), error: null };
        this.pushAccount(); this.pushNow();
        break;
      case 'not_ready':
        this.engine = { status: 'starting', deviceId: null, error: null };
        this.engineNow = null;
        this.pushAccount(); this.pushNow();
        break;
      case 'state':
        this.engineNow = p.state || null;
        this.pushNow();
        break;
      case 'error': {
        const t = String(p.type || 'error');
        if (t === 'playback_error') { this.emit('spotify:notice', { text: 'Spotify could not play that track' }); break; }
        if (t === 'authentication_error') { this.web.access = null; }
        this.setEngine('error', { type: t, message: String(p.message || '') });
        break;
      }
      case 'ack': {
        const w = this.waiters.get(p.id);
        if (w) { this.waiters.delete(p.id); w(p); }
        break;
      }
      default: break;
    }
  }

  command(cmd, arg) {
    if (!this.win || this.win.isDestroyed()) return Promise.resolve({ ok: false, error: 'engine-off' });
    const id = ++this.seq;
    return new Promise(resolve => {
      const t = setTimeout(() => { this.waiters.delete(id); resolve({ ok: false, error: 'timeout' }); }, 8000);
      this.waiters.set(id, r => { clearTimeout(t); resolve(r); });
      this.win.webContents.send('engine:cmd', { id, cmd, arg });
    });
  }

  /* ---------- state sent to the deck ---------- */
  via() {
    if (this.engine.status === 'ready' && this.engineNow) return 'aqua';
    if (this.mprisNow.available) return 'app';
    return null;
  }

  now() {
    const via = this.via();
    const base = { available: this.engine.status === 'ready' || !!this.mprisNow.available, via, engineReady: this.engine.status === 'ready', appOpen: !!this.mprisNow.available };
    if (via === 'aqua') {
      const s = this.engineNow;
      return Object.assign(base, {
        status: s.paused ? 'Paused' : 'Playing', title: s.title, artist: s.artist, album: s.album, art: s.art,
        length: s.duration, position: s.position, positionAt: s.at || Date.now(),
        shuffle: !!s.shuffle, loop: ENGINE_REPEAT[s.repeat] || 'None', trackId: s.uri, trackNumber: 0,
        contextUri: s.contextUri || null, contextName: s.contextName || ''
      });
    }
    if (via === 'app') return Object.assign({}, this.mprisNow, base, { contextUri: null });
    return Object.assign(base, { status: 'Stopped' });
  }

  pushNow() { this.emit('spotify:state', this.now()); }

  accountState() {
    return Object.assign(this.web.account(), {
      engine: { status: this.engine.status, error: this.engine.error },
      appOpen: !!this.mprisNow.available
    });
  }

  pushAccount() { this.emit('spotify:account', this.accountState()); }

  onMpris(state) {
    this.mprisNow = state || { available: false };
    this.pushNow();
    this.pushAccount();
  }

  /* ---------- commands from the deck ---------- */
  async appDevice() {
    const list = await this.web.devices();
    // Skip Aqua MD's own built-in player, including a stale entry left over from an earlier run.
    const others = list.filter(d => d.id && d.id !== this.engine.deviceId && d.name !== 'Aqua MD' && !d.is_restricted);
    return others.find(d => d.type === 'Computer' && d.is_active) || others.find(d => d.type === 'Computer') || others.find(d => d.is_active) || null;
  }

  async control(cmd, arg) {
    try {
      const via = this.via();
      if (cmd === 'playContext') return await this.playContext(String((arg && arg.uri) || ''), { shuffle: !!(arg && arg.shuffle), total: Number(arg && arg.total) || 0 });
      if (cmd === 'queue') return { ok: true, items: this.web.linked ? await this.web.queue() : [] };
      if (cmd === 'playlists') return { ok: true, items: await this.playlists(!!(arg && arg.refresh)) };

      if (via === 'aqua') {
        switch (cmd) {
          case 'play': return this.command('resume');
          case 'pause': return this.command('pause');
          case 'playpause': return this.command('toggle');
          case 'next': return this.command('next');
          case 'prev': return this.command('prev');
          case 'seek': return this.command('seek', Number(arg) || 0);
          case 'stop': await this.command('pause'); return this.command('seek', 0);
          case 'volume': return this.command('volume', Math.max(0, Math.min(1, Number(arg) || 0)));
          case 'shuffle': await this.web.shuffle(!!arg, this.engine.deviceId); return { ok: true };
          case 'loop': await this.web.repeat(LOOP_TO_API[arg] || 'off', this.engine.deviceId); return { ok: true };
          default: return { ok: false, error: 'unknown-command' };
        }
      }
      if (via === 'app') return this.mpris.control(cmd, arg);
      // Nothing is playing anywhere yet: "play" moves Spotify to the built-in player, or else to the Spotify app.
      if (cmd === 'play' && this.web.linked) {
        if (this.engine.status === 'ready') { await this.web.transfer(this.engine.deviceId, true); return { ok: true }; }
        const dev = await this.appDevice();
        if (dev) { await this.web.transfer(dev.id, true); if (this.mpris.poke) this.mpris.poke(800); return { ok: true }; }
      }
      return { ok: false, error: 'no-player' };
    } catch (e) {
      return { ok: false, error: e.message || 'failed', status: e.status || 0 };
    }
  }

  async playContext(uri, opts = {}) {
    if (!/^spotify:(playlist|album|artist|show):[A-Za-z0-9]+$/.test(uri)) return { ok: false, error: 'bad-uri' };
    if (!this.web.linked) return { ok: false, error: 'not-linked' };
    let deviceId = null, via = null;
    if (this.engine.status === 'ready' && this.engine.deviceId) { deviceId = this.engine.deviceId; via = 'aqua'; }
    else {
      const dev = await this.appDevice();
      if (!dev) return { ok: false, error: 'no-device' };
      deviceId = dev.id; via = 'app';
    }
    // Shuffle play starts on a random song; Spotify's own shuffle then mixes the rest.
    const offset = opts.shuffle && opts.total > 1 ? Math.floor(Math.random() * opts.total) : null;
    try { await this.web.playContext(deviceId, uri, offset); }
    catch (e) { if (offset != null && e.status === 400) await this.web.playContext(deviceId, uri, null); else throw e; }
    try { await this.web.shuffle(!!opts.shuffle, deviceId); } catch (e) { /* the song still plays */ }
    if (via === 'app' && this.mpris.poke) this.mpris.poke(900);
    return { ok: true, via, shuffle: !!opts.shuffle };
  }

  async playlists(refresh) {
    if (!refresh && this.cachedPlaylists) return this.cachedPlaylists;
    this.cachedPlaylists = await this.web.playlists();
    return this.cachedPlaylists;
  }

  stop() {
    this.stopEngine();
    try { this.server && this.server.close(); } catch (e) { /* closing */ }
  }
}

module.exports = { SpotifyHub };
