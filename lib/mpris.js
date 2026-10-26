'use strict';
// Bridge to the Spotify desktop app through MPRIS, the standard Linux "media player remote" on D-Bus.
// It reports what Spotify is playing and sends play, pause, skip, seek, shuffle and loop commands.
let dbus = null;
try { dbus = require('dbus-next'); } catch (e) { dbus = null; }

const PLAYER = 'org.mpris.MediaPlayer2.Player';
const PREFIX = 'org.mpris.MediaPlayer2.';

const val = v => (v && typeof v === 'object' && 'signature' in v && 'value' in v) ? v.value : v;
const num = v => { v = val(v); return typeof v === 'bigint' ? Number(v) : (typeof v === 'number' ? v : 0); };
function artUrl(u) {
  if (!u) return null;
  u = String(u).replace(/^https?:\/\/open\.spotify\.com\/image\//, 'https://i.scdn.co/image/');
  return /^https:\/\//.test(u) ? u : null;
}

class MprisBridge {
  constructor(emit, match) {
    this.emit = emit;
    this.match = match || (n => /spotify/i.test(n));
    this.name = null;
    this.state = { status: 'Stopped' };
    this.est = { pos: 0, at: Date.now() };
    this.queue = Promise.resolve();
  }

  async start() {
    if (!dbus) return;
    try {
      this.bus = dbus.sessionBus();
      this.bus.on('error', e => console.warn('[mpris] bus error:', e && e.message));
      const o = await this.bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
      this.dbusIface = o.getInterface('org.freedesktop.DBus');
      this.dbusIface.on('NameOwnerChanged', n => { if (String(n).startsWith(PREFIX)) this.refresh(); });
      await this.refresh();
      this.timer = setInterval(() => this.poll(), 1500);
    } catch (e) {
      console.warn('[mpris] not available:', e && e.message);
    }
  }

  refresh() {
    this.queue = this.queue.then(() => this._refresh()).catch(e => console.warn('[mpris] refresh:', e && e.message));
    return this.queue;
  }

  async _refresh() {
    const names = await this.dbusIface.ListNames();
    const pick = names.find(n => n.startsWith(PREFIX) && this.match(n)) || null;
    if (pick === this.name) return;
    this.detach();
    if (!pick) { this.publish(); return; }
    const obj = await this.bus.getProxyObject(pick, '/org/mpris/MediaPlayer2');
    this.player = obj.getInterface(PLAYER);
    this.props = obj.getInterface('org.freedesktop.DBus.Properties');
    this.onChanged = (iface, changed) => { if (iface === PLAYER) this.apply(changed); };
    this.onSeeked = us => { this.est = { pos: num(us) / 1e6, at: Date.now() }; this.publish(); };
    this.props.on('PropertiesChanged', this.onChanged);
    this.player.on('Seeked', this.onSeeked);
    this.name = pick;
    this.state = { status: 'Stopped' };
    this.est = { pos: 0, at: Date.now() };
    const all = await this.props.GetAll(PLAYER);
    this.apply(all);
  }

  detach() {
    if (this.props && this.onChanged) this.props.removeListener('PropertiesChanged', this.onChanged);
    if (this.player && this.onSeeked) this.player.removeListener('Seeked', this.onSeeked);
    this.player = this.props = null;
    this.name = null;
    this.state = { status: 'Stopped' };
  }

  position() {
    const p = this.state.status === 'Playing' ? this.est.pos + (Date.now() - this.est.at) / 1000 : this.est.pos;
    return this.state.length ? Math.min(p, this.state.length) : p;
  }

  apply(p) {
    const s = Object.assign({}, this.state);
    if (p.Metadata !== undefined) {
      const m = val(p.Metadata) || {};
      const trackId = String(val(m['mpris:trackid']) || '');
      const title = String(val(m['xesam:title']) || '');
      if (trackId !== s.trackId || title !== s.title) this.est = { pos: 0, at: Date.now() };
      const ar = val(m['xesam:artist']);
      Object.assign(s, {
        trackId, title,
        artist: Array.isArray(ar) ? ar.join(', ') : String(ar || ''),
        album: String(val(m['xesam:album']) || ''),
        art: artUrl(val(m['mpris:artUrl'])),
        length: num(m['mpris:length']) / 1e6,
        trackNumber: num(m['xesam:trackNumber']) || 0
      });
    }
    if (p.PlaybackStatus !== undefined) {
      const pos = this.position();
      s.status = String(val(p.PlaybackStatus));
      this.est = { pos, at: Date.now() };
    }
    if (p.Shuffle !== undefined) s.shuffle = !!val(p.Shuffle);
    if (p.LoopStatus !== undefined) s.loop = String(val(p.LoopStatus));
    if (p.Volume !== undefined) s.volume = Number(val(p.Volume));
    if (p.CanSeek !== undefined) s.canSeek = !!val(p.CanSeek);
    if (p.Position !== undefined) {
      const pos = num(p.Position) / 1e6;
      if (pos > 0 || this.position() < 2) this.est = { pos, at: Date.now() };
    }
    this.state = s;
    this.publish();
  }

  async poll() {
    if (!this.props || this.state.status !== 'Playing') return;
    try {
      const pos = num(await this.props.Get(PLAYER, 'Position')) / 1e6;
      // Some Spotify builds always report 0 here; then the deck keeps its own count instead.
      if (pos > 0 && Math.abs(pos - this.position()) > 1.2) { this.est = { pos, at: Date.now() }; this.publish(); }
    } catch (e) { /* player went away; NameOwnerChanged will clean up */ }
  }

  snapshot() {
    return Object.assign({}, this.state, { available: !!this.name, position: this.position(), positionAt: Date.now() });
  }

  publish() { try { this.emit(this.snapshot()); } catch (e) { /* window closed */ } }

  async seek(sec) {
    sec = Math.max(0, sec);
    const tid = this.state.trackId;
    if (tid && tid.startsWith('/')) await this.player.SetPosition(tid, BigInt(Math.round(sec * 1e6)));
    else await this.player.Seek(BigInt(Math.round((sec - this.position()) * 1e6)));
    this.est = { pos: sec, at: Date.now() };
  }

  async control(cmd, arg) {
    if (!this.player) return { ok: false, error: 'not-running' };
    try {
      switch (cmd) {
        case 'play': await this.player.Play(); break;
        case 'pause': await this.player.Pause(); break;
        case 'playpause': await this.player.PlayPause(); break;
        case 'next': await this.player.Next(); break;
        case 'prev': await this.player.Previous(); break;
        case 'stop': await this.player.Pause(); await this.seek(0); break;
        case 'seek': await this.seek(Number(arg) || 0); break;
        case 'shuffle': await this.props.Set(PLAYER, 'Shuffle', new dbus.Variant('b', !!arg)); break;
        case 'loop': await this.props.Set(PLAYER, 'LoopStatus', new dbus.Variant('s', String(arg))); break;
        case 'volume': await this.props.Set(PLAYER, 'Volume', new dbus.Variant('d', Math.max(0, Math.min(1, Number(arg) || 0)))); break;
        default: return { ok: false, error: 'unknown-command' };
      }
      this.publish();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'failed' };
    }
  }

  stop() { clearInterval(this.timer); this.detach(); try { this.bus && this.bus.disconnect(); } catch (e) {} }
}

module.exports = { MprisBridge };
