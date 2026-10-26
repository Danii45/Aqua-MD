'use strict';
// Finds lyrics for the song on the deck: a .lrc file next to the song, lyrics stored in the song file,
// or LRCLIB (a free public lyrics database). Results are cached on disk so each song is looked up once.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const API = (process.env.AQUA_LYRICS_API || 'https://lrclib.net').replace(/\/$/, '');
const MAX_CACHE = 600;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Parses LRC text into [{ t: seconds, text }], sorted by time. Returns [] when it has no timestamps. */
function parseLrc(src) {
  const out = [];
  let offset = 0;
  for (const raw of String(src || '').split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    const stamps = [];
    let rest = raw, m;
    const re = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
    while ((m = re.exec(rest))) {
      const frac = m[3] ? Number(m[3]) / Math.pow(10, m[3].length) : 0;
      stamps.push(Number(m[1]) * 60 + Number(m[2]) + frac);
      rest = rest.slice(m[0].length);
    }
    if (!stamps.length) continue;
    const text = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim(); // drop word-level timing
    for (const t of stamps) out.push({ t: Math.max(0, t - offset), text });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

const cleanPlain = s => String(s || '').replace(/\r/g, '').trim();
const norm = s => String(s || '').toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+.*(remaster|version|edit|mix).*$/i, '').replace(/\s+/g, ' ').trim();

class Lyrics {
  constructor(dataDir, library, version) {
    this.file = path.join(dataDir, 'lyrics-cache.json');
    this.library = library;
    this.ua = `Aqua MD/${version || '0'} (personal music player)`;
    this.cache = new Map();
    this.inflight = new Map();
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, v] of saved) this.cache.set(k, v);
    } catch (e) { /* no cache yet */ }
    this.saveTimer = null;
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value);
        fs.writeFileSync(this.file, JSON.stringify([...this.cache]));
      } catch (e) { /* cache is optional */ }
    }, 1000);
  }

  remember(key, value) {
    this.cache.delete(key);
    this.cache.set(key, value);
    this.save();
    return value;
  }

  /**
   * @param {{ id?: string, title: string, artist?: string, album?: string, duration?: number }} q
   */
  async find(q) {
    const title = String(q.title || '').trim();
    if (!title) return { status: 'none' };
    const key = q.id ? `file:${q.id}` : `web:${norm(q.artist)}|${norm(title)}|${Math.round(q.duration || 0)}`;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = this.lookup(q, title).then(r => this.remember(key, r)).catch(e => ({ status: 'error', message: String(e && e.message || e) }))
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  async lookup(q, title) {
    if (q.id) {
      const local = await this.fromFile(q.id);
      if (local) return local;
    }
    return this.fromLrclib({ title, artist: q.artist, album: q.album, duration: q.duration });
  }

  async fromFile(id) {
    const t = this.library && this.library.tracks.get(id);
    if (!t) return null;
    // 1. "Song.lrc" next to "Song.mp3"
    const base = t.path.slice(0, t.path.length - path.extname(t.path).length);
    for (const ext of ['.lrc', '.LRC']) {
      try {
        const txt = await fsp.readFile(base + ext, 'utf8');
        const lines = parseLrc(txt);
        if (lines.length) return { status: 'synced', lines, source: 'file' };
        if (cleanPlain(txt)) return { status: 'plain', plain: cleanPlain(txt), source: 'file' };
      } catch (e) { /* no sidecar */ }
    }
    // 2. Lyrics stored in the file's tags
    try {
      const mm = await import('music-metadata');
      const meta = await mm.parseFile(t.path, { skipCovers: true, duration: false });
      for (const l of (meta.common && meta.common.lyrics) || []) {
        if (l && typeof l === 'object' && Array.isArray(l.syncText) && l.syncText.length) {
          const lines = l.syncText.filter(x => x && x.text != null).map(x => ({ t: (Number(x.timestamp) || 0) / 1000, text: String(x.text).trim() }))
            .sort((a, b) => a.t - b.t);
          if (lines.length) return { status: 'synced', lines, source: 'file' };
        }
        const text = typeof l === 'string' ? l : (l && l.text);
        if (text) {
          const lines = parseLrc(text);
          if (lines.length) return { status: 'synced', lines, source: 'file' };
          if (cleanPlain(text)) return { status: 'plain', plain: cleanPlain(text), source: 'file' };
        }
      }
    } catch (e) { /* unreadable tags */ }
    return null;
  }

  async request(pathAndQuery) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(API + pathAndQuery, { headers: { 'user-agent': this.ua, 'lrclib-client': this.ua } });
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
    // Close matches: same song, different album or slightly different length.
    const list = await this.request(`/api/search?${new URLSearchParams({ track_name: title, artist_name: firstArtist })}`);
    const scored = (Array.isArray(list) ? list : [])
      .filter(x => x && (x.syncedLyrics || x.plainLyrics || x.instrumental))
      .map(x => ({ x, d: duration ? Math.abs((x.duration || 0) - duration) : 0 }))
      .filter(s => !duration || s.d <= 6)
      .sort((a, b) => (Number(!!b.x.syncedLyrics) - Number(!!a.x.syncedLyrics)) || (a.d - b.d));
    return (scored.length && this.shape(scored[0].x)) || { status: 'none' };
  }
}

module.exports = { Lyrics, parseLrc };
