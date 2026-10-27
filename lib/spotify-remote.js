'use strict';
// Shows and controls whatever Spotify is playing on another device (the Spotify desktop app, a phone...)
// through the Web API. Used on Windows, where there is no MPRIS. Same interface as MprisBridge.
const REPEAT_IN = { off: 'None', context: 'Playlist', track: 'Track' };
const REPEAT_OUT = { None: 'off', Playlist: 'context', Track: 'track' };

function pickArt(images) {
  const l = (images || []).slice().sort((a, b) => (a.width || 640) - (b.width || 640));
  const i = l.find(x => (x.width || 640) >= 250) || l[l.length - 1];
  return i ? i.url : null;
}

class RemoteBridge {
  /**
   * @param {import('./spotify-web').SpotifyWeb} web
   * @param {(state: object) => void} emit
   * @param {() => string|null} ownDevice  id of Aqua MD's built-in player, which this bridge ignores
   */
  constructor(web, emit, ownDevice) {
    this.web = web;
    this.emit = emit;
    this.ownDevice = ownDevice || (() => null);
    this.state = { available: false, status: 'Stopped' };
    this.deviceId = null;
    this.timer = null;
    this.stopped = false;
  }

  start() { this.loop(); }
  stop() { this.stopped = true; clearTimeout(this.timer); }
  poke(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.loop(), ms || 0); }

  snapshot() { return Object.assign({}, this.state, { positionAt: this.state.positionAt || Date.now() }); }

  async loop() {
    if (this.stopped) return;
    let delay = 10000;
    if (this.web.linked) {
      try {
        const p = await this.web.playback();
        const dev = p && p.device;
        const mine = dev && (dev.id === this.ownDevice() || dev.name === 'Aqua MD');
        if (p && dev && p.item && !mine) {
          const t = p.item;
          this.deviceId = dev.id;
          this.state = {
            available: true, status: p.is_playing ? 'Playing' : 'Paused',
            title: t.name || '', artist: (t.artists || []).map(a => a.name).join(', ') || (t.show && t.show.name) || '',
            album: (t.album && t.album.name) || '', art: pickArt((t.album && t.album.images) || t.images),
            length: (t.duration_ms || 0) / 1000, position: (p.progress_ms || 0) / 1000, positionAt: Date.now(),
            shuffle: !!p.shuffle_state, loop: REPEAT_IN[p.repeat_state] || 'None', trackId: t.uri || '',
            trackNumber: 0, volume: dev.volume_percent != null ? dev.volume_percent / 100 : undefined,
            canSeek: true, deviceName: dev.name || ''
          };
          delay = p.is_playing ? 2500 : 5000;
        } else {
          this.deviceId = null;
          this.state = { available: false, status: 'Stopped' };
          delay = 6000;
        }
      } catch (e) {
        delay = e && e.status === 429 ? 20000 : 12000;
      }
    } else if (this.state.available) {
      this.state = { available: false, status: 'Stopped' };
    }
    try { this.emit(this.snapshot()); } catch (e) { /* window closed */ }
    if (!this.stopped) this.timer = setTimeout(() => this.loop(), delay);
  }

  async control(cmd, arg) {
    if (!this.web.linked || !this.deviceId) return { ok: false, error: 'not-running' };
    const q = { device_id: this.deviceId };
    const s = this.state;
    try {
      switch (cmd) {
        case 'play': await this.web.api('PUT', '/me/player/play', { query: q }); s.status = 'Playing'; break;
        case 'pause': await this.web.api('PUT', '/me/player/pause', { query: q }); s.status = 'Paused'; break;
        case 'playpause': return this.control(s.status === 'Playing' ? 'pause' : 'play');
        case 'next': await this.web.api('POST', '/me/player/next', { query: q }); break;
        case 'prev': await this.web.api('POST', '/me/player/previous', { query: q }); break;
        case 'stop': await this.web.api('PUT', '/me/player/pause', { query: q }); await this.web.api('PUT', '/me/player/seek', { query: Object.assign({ position_ms: 0 }, q) }); s.status = 'Paused'; break;
        case 'seek': await this.web.api('PUT', '/me/player/seek', { query: Object.assign({ position_ms: Math.max(0, Math.round((Number(arg) || 0) * 1000)) }, q) }); s.position = Number(arg) || 0; s.positionAt = Date.now(); break;
        case 'shuffle': await this.web.api('PUT', '/me/player/shuffle', { query: Object.assign({ state: arg ? 'true' : 'false' }, q) }); s.shuffle = !!arg; break;
        case 'loop': await this.web.api('PUT', '/me/player/repeat', { query: Object.assign({ state: REPEAT_OUT[arg] || 'off' }, q) }); s.loop = REPEAT_OUT[arg] ? arg : 'None'; break;
        case 'volume': await this.web.api('PUT', '/me/player/volume', { query: Object.assign({ volume_percent: Math.round(Math.max(0, Math.min(1, Number(arg) || 0)) * 100) }, q) }); break;
        default: return { ok: false, error: 'unknown-command' };
      }
      try { this.emit(this.snapshot()); } catch (e) { /* window closed */ }
      this.poke(cmd === 'next' || cmd === 'prev' ? 700 : 400);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'failed', status: e && e.status };
    }
  }
}

module.exports = { RemoteBridge };
