'use strict';
// Music library: turns files and folders into "discs" (one per album or folder), reads tags and
// cover art, and remembers everything in settings so discs come back on the next launch.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'webm'];
const VIDEO_EXT = ['mp4', 'm4v', 'mov'];
const ALL_EXT = new Set([...AUDIO_EXT, ...VIDEO_EXT]);
const MAX_FILES = 3000;

const MIME = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4'
};

const extOf = p => path.extname(p).slice(1).toLowerCase();
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

let mmPromise = null;
const loadMM = () => (mmPromise = mmPromise || import('music-metadata'));

class Library {
  constructor(dataDir, settings) {
    this.settings = settings;
    this.artDir = path.join(dataDir, 'art');
    this.tracks = new Map();
    this.discs = [];
    const saved = settings.get('discs') || [];
    for (const d of saved) {
      const tracks = (d.tracks || []).filter(t => t && t.path && fs.existsSync(t.path));
      if (!tracks.length) continue;
      const disc = Object.assign({}, d, { tracks });
      this.discs.push(disc);
      tracks.forEach(t => this.tracks.set(t.id, t));
    }
    const savedCount = saved.reduce((a, d) => a + ((d.tracks || []).length), 0);
    if (savedCount !== this.tracks.size) this.persist();
  }

  persist() { this.settings.set('discs', this.discs); }

  media(id) {
    const t = this.tracks.get(id);
    if (!t) return null;
    return { path: t.path, mime: MIME[extOf(t.path)] || 'application/octet-stream' };
  }

  artPath(name) {
    if (!/^[0-9a-f]{16}\.(jpg|png)$/.test(name)) return null;
    return path.join(this.artDir, name);
  }

  forRenderer() {
    return this.discs.map(d => ({
      id: d.id, name: d.name, kind: 'mp3', art: d.art ? 'aqua://app/~art/' + d.art : null,
      tracks: d.tracks.map(t => ({
        id: t.id, title: t.title, artist: t.artist, album: t.album, duration: t.duration || 0,
        video: !!t.video, ext: extOf(t.path).toUpperCase(),
        art: t.art ? 'aqua://app/~art/' + t.art : null, url: 'aqua://app/~media/' + t.id
      }))
    }));
  }

  async expand(paths) {
    const out = [];
    const seen = new Set();
    const walk = async (p, depth) => {
      if (out.length >= MAX_FILES) return;
      let st;
      try { st = await fsp.stat(p); } catch (e) { return; }
      if (st.isDirectory()) {
        if (depth > 8) return;
        let names;
        try { names = await fsp.readdir(p); } catch (e) { return; }
        names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        for (const n of names) {
          if (n.startsWith('.')) continue;
          await walk(path.join(p, n), depth + 1);
        }
      } else if (st.isFile() && ALL_EXT.has(extOf(p))) {
        const r = path.resolve(p);
        if (!seen.has(r)) { seen.add(r); out.push(r); }
      }
    };
    for (const p of paths) if (typeof p === 'string' && p) await walk(p, 0);
    return out;
  }

  async saveArt(pic) {
    if (!pic || !pic.data || !pic.data.length) return null;
    const buf = Buffer.from(pic.data);
    const ext = /png/i.test(pic.format || '') ? 'png' : 'jpg';
    const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '.' + ext;
    const file = path.join(this.artDir, name);
    if (!fs.existsSync(file)) {
      await fsp.mkdir(this.artDir, { recursive: true });
      await fsp.writeFile(file, buf);
    }
    return name;
  }

  async readTrack(file) {
    const mm = await loadMM();
    const ext = extOf(file);
    const video = VIDEO_EXT.includes(ext);
    let common = {}, format = {}, parsed = false;
    try {
      const meta = await mm.parseFile(file, { duration: true });
      common = meta.common || {};
      format = meta.format || {};
      parsed = true;
    } catch (e) { /* unreadable tags: still try to play it */ }
    const pics = common.picture || [];
    const pic = typeof mm.selectCover === 'function' ? mm.selectCover(pics) : pics[0];
    let art = null;
    try { art = await this.saveArt(pic); } catch (e) { art = null; }
    return {
      id: hash(file), path: file,
      title: common.title || path.basename(file, path.extname(file)),
      artist: common.artist || common.albumartist || '',
      albumArtist: common.albumartist || common.artist || '',
      album: common.album || '',
      trackNo: (common.track && common.track.no) || 0,
      discNo: (common.disk && common.disk.no) || 0,
      duration: format.duration || 0,
      video,
      // A video with no sound has nothing for the deck to play. Only skip when the file clearly has video tracks and nothing else.
      silent: video && parsed && !format.codec && (format.trackInfo || []).length > 0 &&
        format.trackInfo.every(ti => ti.video || ti.type === 1),
      art,
      // Chromium has no Apple Lossless decoder, so those files would play as silence.
      unsupported: /alac/i.test(format.codec || '')
    };
  }

  async importPaths(paths, onProgress) {
    const all = await this.expand(paths);
    const files = all.filter(f => !this.tracks.has(hash(f)));
    const fresh = [];
    let silent = 0, unsupported = 0;
    for (let i = 0; i < files.length; i++) {
      if (onProgress) onProgress({ done: i, total: files.length });
      const t = await this.readTrack(files[i]);
      if (t.silent) { silent++; continue; }
      if (t.unsupported) { unsupported++; continue; }
      delete t.silent; delete t.unsupported;
      fresh.push(t);
    }
    if (onProgress) onProgress({ done: files.length, total: files.length });

    // One disc per album tag, or per folder when files have no album tag.
    const groups = new Map();
    fresh.forEach((t, i) => {
      t._order = i;
      const key = t.album
        ? `album:${(t.albumArtist || '').toLowerCase()}|${t.album.toLowerCase()}`
        : `folder:${path.dirname(t.path)}`;
      if (!groups.has(key)) groups.set(key, { key, name: t.album || path.basename(path.dirname(t.path)) || 'My Music', tracks: [] });
      groups.get(key).tracks.push(t);
    });

    const touched = new Set();
    const singles = [];
    const addTo = (id, name, tracks) => {
      let disc = this.discs.find(d => d.id === id);
      if (!disc) { disc = { id, name, art: null, tracks: [] }; this.discs.push(disc); }
      disc.tracks.push(...tracks);
      touched.add(disc);
    };
    for (const g of groups.values()) {
      const id = hash(g.key);
      if (g.tracks.length >= 2 || this.discs.some(d => d.id === id)) addTo(id, g.name, g.tracks);
      else singles.push(...g.tracks);
    }
    if (singles.length) addTo('loose', 'My Music', singles);

    for (const d of touched) {
      d.tracks.forEach((t, i) => { if (t._order == null) t._order = -100000 + i; });
      d.tracks.sort((a, b) => (a.discNo - b.discNo) || (a.trackNo - b.trackNo) || (a._order - b._order));
      d.tracks.forEach(t => { delete t._order; this.tracks.set(t.id, t); });
      if (!d.art) { const w = d.tracks.find(t => t.art); d.art = w ? w.art : null; }
    }
    this.persist();
    return {
      touched: [...touched].map(d => d.id),
      added: fresh.length,
      already: all.length - files.length,
      silent,
      unsupported,
      found: all.length
    };
  }

  setDuration(id, sec) {
    const t = this.tracks.get(id);
    if (!t || !(sec > 0) || !isFinite(sec) || Math.abs((t.duration || 0) - sec) < 0.5) return false;
    t.duration = sec;
    this.persist();
    return true;
  }

  removeDisc(id) {
    const i = this.discs.findIndex(d => d.id === id);
    if (i < 0) return false;
    this.discs[i].tracks.forEach(t => this.tracks.delete(t.id));
    this.discs.splice(i, 1);
    this.persist();
    return true;
  }
}

module.exports = { Library, ALL_EXT: [...ALL_EXT], AUDIO_EXT, VIDEO_EXT };
