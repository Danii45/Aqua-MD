'use strict';
// Small JSON settings store kept in the app's user-data folder (~/.config/Aqua MD/settings.json).
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  weather: { name: 'Vaughan, Ontario', lat: 43.8361, lon: -79.4983 },
  startOnLogin: false,
  appMenu: true,
  display: null,          // { id, width, height } of the screen Aqua MD was last moved to
  windowMode: 'full',     // 'full' (full screen) | 'window' (normal resizable window)
  windowBounds: null,     // last size and place as a window
  onTop: null,            // stay in front of other windows while full screen; null = on for Windows (iCUE draws over the Edge), off elsewhere
  volume: 21,             // knob position, 0-30
  shuffle: false,
  repeat: 'off',          // 'off' | 'all' | 'one'
  discs: [],              // saved MP3 discs
  colors: {},             // disc id -> colour name ('blue' when missing)
  recentPlaylists: [],    // last Spotify playlists put in the deck
  spotify: {},            // { clientId, name, refresh }
  widgets: null,          // side widgets, top to bottom: [{ type, size }]; null = clock + weather
  lastDisc: null
};

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      Object.assign(this.data, saved);
    } catch (e) { /* first run or unreadable file: keep defaults */ }
    this._timer = null;
  }
  get(key) { return this.data[key]; }
  set(key, value) { this.data[key] = value; this.save(); }
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 250);
  }
  flush() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('[settings] could not save', e.message); }
  }
}

module.exports = { Settings, DEFAULTS };
