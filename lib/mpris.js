'use strict';
// Bridge to Spotify through MPRIS, the standard Linux "media player remote" on D-Bus. It follows the Spotify
// desktop app, or, when that isn't running, Spotify's web player in a browser (open.spotify.com, which works with
// free accounts), reports what's playing, and sends play, pause, skip, seek, shuffle and loop commands.
//
// Players are reached with plain D-Bus messages rather than dbus-next's proxy objects: browsers (Chrome, Firefox)
// don't describe their media player object, so proxies for them come out empty.
let dbus = null;
try { dbus = require('dbus-next'); } catch (e) { dbus = null; }
const fs = require('fs');

const PLAYER = 'org.mpris.MediaPlayer2.Player';
const ROOT = 'org.mpris.MediaPlayer2';
const PROPS = 'org.freedesktop.DBus.Properties';
const PATH = '/org/mpris/MediaPlayer2';
const PREFIX = 'org.mpris.MediaPlayer2.';
// Browsers that publish what a tab is playing (KDE's browser integration does it for any browser).
const BROWSER = /^(chromium|chrome|google-chrome|brave|vivaldi|opera|edge|msedge|firefox|librewolf|zen|floorp|waterfox|mercury|epiphany|falkon|plasma-browser-integration)\b/i;

const val = v => (v && typeof v === 'object' && 'signature' in v && 'value' in v) ? v.value : v;
const num = v => { v = val(v); return typeof v === 'bigint' ? Number(v) : (typeof v === 'number' ? v : 0); };

// Browsers save the cover to a temporary file; pass it on as a data: URL (only real pictures, and small ones).
const fileArt = new Map();
function imageType(b) {
  if (b.length > 3 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 11 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 3 && b.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return '';
}
function artUrl(u) {
  if (!u) return null;
  u = String(u).replace(/^https?:\/\/open\.spotify\.com\/image\//, 'https://i.scdn.co/image/');
  if (/^https:\/\//.test(u)) return u;
  if (!/^file:\/\//.test(u)) return null;
  try {
    const file = decodeURIComponent(new URL(u).pathname);
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 2e6) return null;
    const key = `${file}|${st.mtimeMs}|${st.size}`;
    if (fileArt.has(key)) return fileArt.get(key);
    const buf = fs.readFileSync(file), type = imageType(buf);
    const out = type ? `data:${type};base64,${buf.toString('base64')}` : null;
    if (fileArt.size > 40) fileArt.clear();
    fileArt.set(key, out);
    return out;
  } catch (e) { return null; }
}
// Is a browser playing Spotify? Its page address when the browser gives one; otherwise anything with a song
// title, artist and album (Spotify's web player always fills in all three; a YouTube video has no album).
function looksLikeSpotify(meta) {
  const m = val(meta) || {};
  const url = String(val(m['xesam:url']) || '');
  if (url) return /^https:\/\/open\.spotify\.com\//.test(url);
  if (/spotify/i.test(String(val(m['mpris:trackid']) || ''))) return true;
  const ar = val(m['xesam:artist']);
  const artist = Array.isArray(ar) ? ar.join('') : String(ar || '');
  return !!(String(val(m['xesam:title']) || '') && artist && String(val(m['xesam:album']) || ''));
}

class MprisBridge {
  constructor(emit, match) {
    this.emit = emit;
    this.match = match || (n => /spotify/i.test(n));
    this.name = null;      // bus name of the player being followed
    this.owner = null;     // its unique name, which its signals come from
    this.web = false;      // a browser tab rather than the Spotify app
    this.webOk = true;     // the browser is playing Spotify right now
    this.identity = '';
    this.state = { status: 'Stopped' };
    this.est = { pos: 0, at: Date.now() };
    this.queue = Promise.resolve();
    this.lastScan = 0;
  }

  async start() {
    if (!dbus) return;
    try {
      this.bus = dbus.sessionBus();
      this.bus.on('error', e => console.warn('[mpris] bus error:', e && e.message));
      const o = await this.bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
      this.dbusIface = o.getInterface('org.freedesktop.DBus');
      this.dbusIface.on('NameOwnerChanged', n => { if (String(n).startsWith(PREFIX)) this.refresh(); });
      await this.dbusIface.AddMatch(`type='signal',path='${PATH}'`);
      this.bus.on('message', m => this.onMessage(m));
      await this.refresh();
      this.timer = setInterval(() => this.poll(), 1500);
    } catch (e) {
      console.warn('[mpris] not available:', e && e.message);
    }
  }

  /* ---------- plain D-Bus calls ---------- */
  call(name, iface, member, signature, body) {
    return this.bus.call(new dbus.Message({ destination: name, path: PATH, interface: iface, member, signature: signature || '', body: body || [] }))
      .then(r => (r && r.body) || []);
  }
  getAll(name, iface) { return this.call(name, PROPS, 'GetAll', 's', [iface || PLAYER]).then(b => b[0] || {}); }
  getProp(name, iface, prop) { return this.call(name, PROPS, 'Get', 'ss', [iface, prop]).then(b => b[0]); }
  setProp(prop, v) { return this.call(this.name, PROPS, 'Set', 'ssv', [PLAYER, prop, v]); }
  method(member, signature, body) { return this.call(this.name, PLAYER, member, signature, body); }

  onMessage(m) {
    if (!this.name || !m || m.type !== dbus.MessageType.SIGNAL || m.path !== PATH || m.sender !== this.owner) return;
    if (m.interface === PROPS && m.member === 'PropertiesChanged' && m.body && m.body[0] === PLAYER) this.apply(m.body[1] || {});
    else if (m.interface === PLAYER && m.member === 'Seeked') { this.est = { pos: num(m.body && m.body[0]) / 1e6, at: Date.now() }; this.publish(); }
  }

  /* ---------- which player to follow ---------- */
  refresh() {
    this.queue = this.queue.then(() => this._refresh()).catch(e => console.warn('[mpris] refresh:', e && e.message));
    return this.queue;
  }

  async _refresh() {
    this.lastScan = Date.now();
    const names = (await this.dbusIface.ListNames()).filter(n => n.startsWith(PREFIX));
    let pick = names.find(n => this.match(n)) || null, web = false;
    if (!pick) {
      // No Spotify app: Spotify's web player in a browser, preferring one that's playing.
      const found = [];
      for (const n of names.filter(x => BROWSER.test(x.slice(PREFIX.length)))) {
        try { const all = await this.getAll(n); if (looksLikeSpotify(all.Metadata)) found.push({ n, playing: val(all.PlaybackStatus) === 'Playing' }); } catch (e) { /* gone */ }
      }
      const f = found.find(x => x.playing) || found[0];
      if (f) { pick = f.n; web = true; }
    }
    if (pick === this.name) return;
    this.detach();
    if (!pick) { this.publish(); return; }
    let owner = null;
    try { owner = await this.dbusIface.GetNameOwner(pick); } catch (e) { owner = null; }
    if (!owner) { this.publish(); return; }
    this.name = pick; this.owner = owner; this.web = web; this.webOk = true;
    this.state = { status: 'Stopped' };
    this.est = { pos: 0, at: Date.now() };
    try { this.identity = String(val(await this.getProp(pick, ROOT, 'Identity')) || ''); } catch (e) { this.identity = ''; }
    const all = await this.getAll(pick);
    this.apply(all);
  }

  detach() {
    this.name = this.owner = null;
    this.web = false; this.webOk = true; this.identity = '';
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
      if (this.web) this.webOk = looksLikeSpotify(m);
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
    // Following a browser that has moved on to something else (a video in another tab): look again now and then.
    // Following nothing: a browser tab may have started playing Spotify (browsers don't announce that). Look again.
    if (((this.web && !this.webOk) || !this.name) && Date.now() - this.lastScan > 5000) {
      if (this.name) this.detach();
      this.refresh();
      return;
    }
    if (!this.name || this.state.status !== 'Playing') return;
    try {
      const pos = num(await this.getProp(this.name, PLAYER, 'Position')) / 1e6;
      // Some Spotify builds always report 0 here; then the deck keeps its own count instead.
      if (pos > 0 && Math.abs(pos - this.position()) > 1.2) { this.est = { pos, at: Date.now() }; this.publish(); }
    } catch (e) { /* player went away; NameOwnerChanged will clean up */ }
  }

  snapshot() {
    const on = !!this.name && (!this.web || this.webOk);
    return Object.assign({}, on ? this.state : { status: 'Stopped' }, {
      available: on, position: this.position(), positionAt: Date.now(),
      web: on && this.web, deviceName: on && this.web ? `Spotify in ${this.identity || 'your browser'}` : ''
    });
  }

  publish() { try { this.emit(this.snapshot()); } catch (e) { /* window closed */ } }

  async seek(sec) {
    sec = Math.max(0, sec);
    const tid = this.state.trackId;
    if (tid && tid.startsWith('/')) await this.method('SetPosition', 'ox', [tid, BigInt(Math.round(sec * 1e6))]);
    else await this.method('Seek', 'x', [BigInt(Math.round((sec - this.position()) * 1e6))]);
    this.est = { pos: sec, at: Date.now() };
  }

  async control(cmd, arg) {
    if (!this.name || (this.web && !this.webOk)) return { ok: false, error: 'not-running' };
    try {
      switch (cmd) {
        case 'play': await this.method('Play'); break;
        case 'pause': await this.method('Pause'); break;
        case 'playpause': await this.method('PlayPause'); break;
        case 'next': await this.method('Next'); break;
        case 'prev': await this.method('Previous'); break;
        case 'stop': await this.method('Pause'); await this.seek(0); break;
        case 'seek': await this.seek(Number(arg) || 0); break;
        case 'shuffle': await this.setProp('Shuffle', new dbus.Variant('b', !!arg)); break;
        case 'loop': await this.setProp('LoopStatus', new dbus.Variant('s', String(arg))); break;
        case 'volume': await this.setProp('Volume', new dbus.Variant('d', Math.max(0, Math.min(1, Number(arg) || 0)))); break;
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

module.exports = { MprisBridge, looksLikeSpotify };
