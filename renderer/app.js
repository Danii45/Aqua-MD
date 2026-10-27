(() => {
'use strict';
const api = window.aqua || null;           // bridge from preload.js (absent when the page runs on its own)
const $ = id => document.getElementById(id);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const stage = $('stage');
const root = document.documentElement;

/* ---------- layout: fits any window ----------
   Wide windows (like the Xeneon Edge) put widgets left and the deck right, everything scaled by height.
   Other shapes stack the deck on top and give the widgets the rest, so a bigger window holds more widgets.
   Phones: upright ("tall") rearranges the deck into a column with the disc on top; sideways and short
   ("compact") shows the deck with just the header row above it. */
const deckbox = $('deckbox'), sidebox = $('sidebox'), panelbox = $('panelbox'), s1El = $('s1');
const DECK_W = 1703, DECK_H = 720, TALL_W = 900, TALL_H = 1340;
let SCALE = 1, SSCALE = 1, GEO = { w: 730, pageH: 548, cols: 1, perCol: 3, cap: 3, colW: 730, wide: true };
let geoKey = '', LAYOUT = 'wide';
// What this copy of Aqua MD runs on, and what it can do there (the Android app has no folders, drag and drop, etc.).
let PLATFORM = 'linux';
let FEAT = { folders: true, drop: true, quit: true, startup: true, screens: true, onTop: true, fullscreen: true, keepAwake: false };
function layout() {
  const W = Math.max(1, innerWidth), H = Math.max(1, innerHeight);
  const ratio = W / H;
  const mode = ratio >= 3 ? 'wide' : ratio < 0.8 ? 'tall' : (H < 560 && ratio >= 1.25) ? 'compact' : 'stacked';
  const wide = mode === 'wide';
  const colMin = mode === 'tall' ? 540 : 700;
  LAYOUT = mode;
  let sw, sh;
  if (mode === 'tall') {
    const sd = Math.min(W / TALL_W, 0.74 * H / TALL_H);
    const top = TALL_H * sd;
    const ss = Math.max(0.5, Math.min(1, (W - 32) / colMin));
    SCALE = sd; SSCALE = ss;
    deckbox.style.transform = `translate(${(W - TALL_W * sd) / 2}px, 0px) scale(${sd})`;
    sidebox.style.transform = `translate(16px, ${top + 4}px) scale(${ss})`;
    sw = (W - 32) / ss; sh = Math.max(200, (H - top - 12) / ss);
    const ps = Math.max(0.6, Math.min(1, W / 560));
    const pw = Math.min(790, W / ps - 24), ph = Math.min(1500, H / ps - 24);
    panelbox.style.transform = `translate(${(W - pw * ps) / 2}px, ${H - (ph + 12) * ps}px) scale(${ps})`;
    panelbox.style.width = pw + 'px'; panelbox.style.height = ph + 'px';
  } else if (mode === 'compact') {
    const head = 60;
    const sd = Math.min(W / DECK_W, (H - head) / DECK_H);
    const ss = 0.72;
    SCALE = sd; SSCALE = ss;
    deckbox.style.transform = `translate(${(W - DECK_W * sd) / 2}px, ${head}px) scale(${sd})`;
    sidebox.style.transform = `translate(${Math.max(16, (W - DECK_W * sd) / 2 + 30 * sd)}px, 10px) scale(${ss})`;
    sw = (W - 2 * Math.max(16, (W - DECK_W * sd) / 2 + 30 * sd)) / ss; sh = 200;
    const ps = Math.max(0.5, Math.min(1, H / 700));
    const pw = Math.min(790, W / ps - 40), ph = Math.min(660, H / ps - 24);
    panelbox.style.transform = `translate(${16}px, ${H - (ph + 12) * ps}px) scale(${ps})`;
    panelbox.style.width = pw + 'px'; panelbox.style.height = ph + 'px';
  } else if (wide) {
    const s = H / DECK_H;
    SCALE = SSCALE = s;
    deckbox.style.transform = `translate(${W - DECK_W * s}px, 0px) scale(${s})`;
    sidebox.style.transform = `translate(${64 * s}px, ${44 * s}px) scale(${s})`;
    sw = Math.max(420, W / s - 1830); sh = 632;
    panelbox.style.transform = `translate(${36 * s}px, ${30 * s}px) scale(${s})`;
    panelbox.style.width = '790px'; panelbox.style.height = '660px';
  } else {
    const sd = Math.min(W / DECK_W, 0.6 * H / DECK_H);
    const top = DECK_H * sd;
    // Widgets follow the deck's size, except a narrow window with room for only one column uses full-size widgets.
    let ss = Math.max(0.75, Math.min(1, sd));
    if (Math.floor(((W - 96 * ss) / ss + 40) / 740) <= 1) ss = Math.max(ss, Math.min(1, W / 856));
    ss = Math.max(0.5, Math.min(ss, (H - top - 34) / 204));
    SCALE = sd; SSCALE = ss;
    deckbox.style.transform = `translate(${(W - DECK_W * sd) / 2}px, 0px) scale(${sd})`;
    sidebox.style.transform = `translate(${48 * ss}px, ${top + 10 * ss}px) scale(${ss})`;
    sw = (W - 96 * ss) / ss; sh = Math.max(200, (H - top - 34 * ss) / ss);
    const ph = Math.max(300, Math.min(660, H / ss - 60)), pw = Math.max(420, Math.min(790, W / ss - 60));
    panelbox.style.transform = `translate(${30 * ss}px, ${Math.max(0, H - (ph + 30) * ss)}px) scale(${ss})`;
    panelbox.style.width = pw + 'px'; panelbox.style.height = ph + 'px';
  }
  stage.classList.toggle('stacked', mode === 'stacked');
  stage.classList.toggle('tall', mode === 'tall');
  stage.classList.toggle('compact', mode === 'compact');
  s1El.style.width = sw + 'px'; s1El.style.height = sh + 'px';
  const pageH = Math.max(120, Math.round(sh - 84));
  const cols = Math.max(1, Math.floor((sw + 40) / (colMin + 40)));
  const perCol = Math.max(1, Math.min(6, Math.floor((pageH + 22) / (140 + 22))));
  GEO = { w: sw, pageH, cols, perCol, cap: Math.min(12, cols * perCol), colW: (sw - 40 * (cols - 1)) / cols, wide };
  const key = [Math.round(sw / 8), Math.round(pageH / 8), cols, perCol].join('|');
  if (key !== geoKey) {
    geoKey = key;
    if (typeof buildSide === 'function' && INST_READY) { buildSide(); if (openName === 'settings') renderWidgetEditor(); }
  }
}
let layoutQueued = false, INST_READY = false;
addEventListener('resize', () => { if (layoutQueued) return; layoutQueued = true; requestAnimationFrame(() => { layoutQueued = false; layout(); }); });
layout();

/* ---------- helpers ---------- */
const pad2 = n => String(n).padStart(2, '0');
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + pad2(s % 60); };
const fmtLcd = s => { s = Math.max(0, Math.floor(s || 0)); return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); };
const wait = ms => new Promise(r => setTimeout(r, REDUCED ? Math.min(ms, 120) : ms));
const plural = n => `${n} ${n === 1 ? 'track' : 'tracks'}`;
const total = d => d.tracks.reduce((a, t) => a + (t.duration || 0), 0);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(cls, text, data) { const b = el('button', cls, text); b.type = 'button'; if (data) Object.assign(b.dataset, data); return b; }

/* ---------- colour themes ---------- */
const COLORS = {
  blue: { h: 214, lh: 192, name: 'Blue' },
  teal: { h: 178, lh: 168, name: 'Teal' },
  green: { h: 140, lh: 128, name: 'Green' },
  orange: { h: 26, lh: 36, name: 'Orange' },
  red: { h: 354, lh: 2, name: 'Red' },
  pink: { h: 322, lh: 316, name: 'Pink' },
  purple: { h: 266, lh: 258, name: 'Purple' }
};
const COLOR_ORDER = Object.keys(COLORS);
let COLOR_MAP = {};
const colorName = id => (COLORS[COLOR_MAP[id]] ? COLOR_MAP[id] : 'blue');
const hueOf = id => COLORS[colorName(id)].h;
let themeNow = 'blue', hueH = 214, hueL = 192;
// Moves the whole app to a colour, taking the short way round the colour wheel.
function applyTheme(name) {
  if (name === themeNow) return;
  themeNow = name;
  const c = COLORS[name] || COLORS.blue;
  const arc = (from, to) => from + ((((to - from) % 360) + 540) % 360 - 180);
  hueH = arc(hueH, c.h); hueL = arc(hueL, c.lh);
  root.style.setProperty('--h', hueH.toFixed(1));
  root.style.setProperty('--lh', hueL.toFixed(1));
  root.dataset.color = name;
}
function setColor(id, name) {
  if (!COLORS[name]) return;
  if (name === 'blue') delete COLOR_MAP[id]; else COLOR_MAP[id] = name;
  COLOR_MAP = Object.assign({}, COLOR_MAP);
  if (api) api.set('colors', COLOR_MAP);
  rackSig = '';
  render();
  if (!plPanel.hidden) renderPlaylists();
  if (!settingsEl.hidden) renderDiscList();
}
function swatchRow(id) {
  const row = el('div', 'swatches');
  for (const name of COLOR_ORDER) {
    const b = btn('sw' + (colorName(id) === name ? ' on' : ''), null, { act: 'color', id, color: name });
    b.style.setProperty('--sh', COLORS[name].h);
    b.setAttribute('aria-label', COLORS[name].name);
    b.title = COLORS[name].name;
    row.append(b);
  }
  return row;
}

/* ---------- clock ---------- */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function tick() {
  const d = new Date();
  $('date').textContent = `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  for (const w of INST) if (w.tick) w.tick(d);
}

/* ---------- weather (Open-Meteo, no account needed) ---------- */
let wxLoc = { name: 'Vaughan, Ontario', lat: 43.8361, lon: -79.4983 };
let wxTimer = 0, lastWx = null, wxStale = false, wxFail = false;
const MINI = { sun: 'sn', moon: 'mn', partly: 'pc', 'partly-night': 'mn', cloud: 'cl', rain: 'rn', snow: 'sw', storm: 'st', fog: 'fg' };
function wmo(code, day) {
  day = day !== 0;
  if (code === 0) return { text: day ? 'Clear' : 'Clear night', kind: day ? 'sun' : 'moon' };
  if (code === 1) return { text: 'Mainly clear', kind: day ? 'sun' : 'moon' };
  if (code === 2) return { text: 'Partly cloudy', kind: day ? 'partly' : 'partly-night' };
  if (code === 3) return { text: 'Overcast', kind: 'cloud' };
  if (code === 45 || code === 48) return { text: 'Fog', kind: 'fog' };
  if (code >= 51 && code <= 57) return { text: 'Drizzle', kind: 'rain' };
  if (code >= 61 && code <= 67) return { text: code >= 66 ? 'Freezing rain' : 'Rain', kind: 'rain' };
  if (code >= 71 && code <= 77) return { text: 'Snow', kind: 'snow' };
  if (code >= 80 && code <= 82) return { text: 'Rain showers', kind: 'rain' };
  if (code === 85 || code === 86) return { text: 'Snow showers', kind: 'snow' };
  if (code >= 95) return { text: 'Thunderstorm', kind: 'storm' };
  return { text: 'Cloudy', kind: 'cloud' };
}
const hourLabel = iso => { const h = +iso.slice(11, 13); return `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`; };
const shortPlace = () => String(wxLoc.name || '').split(',')[0];
function renderWeather(j, stale) { lastWx = j; wxStale = !!stale; wxFail = false; paintWeather(); }
function paintWeather() { for (const w of INST) if (w.weather) w.weather(); }
function markWeatherLoading() { lastWx = null; wxFail = false; paintWeather(); }
function cachedWeather() { try { return JSON.parse(localStorage.getItem('aqua.wx') || 'null'); } catch (e) { return null; } }
async function loadWeather() {
  clearTimeout(wxTimer);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${wxLoc.lat}&longitude=${wxLoc.lon}` +
    '&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,weather_code,is_day' +
    '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2';
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    try { localStorage.setItem('aqua.wx', JSON.stringify({ lat: wxLoc.lat, lon: wxLoc.lon, j })); } catch (e) {}
    renderWeather(j, false);
    wxTimer = setTimeout(loadWeather, 15 * 60e3);
  } catch (e) {
    const c = cachedWeather();
    if (c && c.lat === wxLoc.lat && c.lon === wxLoc.lon) renderWeather(c.j, true);
    else { lastWx = null; wxFail = true; paintWeather(); }
    wxTimer = setTimeout(loadWeather, 2 * 60e3);
  }
}
async function searchCity(q) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return (j.results || []).map(x => ({ name: [x.name, x.admin1, x.country].filter(Boolean).join(', '), lat: x.latitude, lon: x.longitude }));
}

/* ---------- discs ---------- */
const DEMO = { id: 'demo', kind: 'demo', name: 'Demo Disc', art: null, tracks: [
  { title: 'Blue Shell Morning', artist: 'Aqua MD', album: 'Demo Disc', duration: 84, ext: 'DEMO', synth: { bpm: 96, wave: 'triangle', prog: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]] } },
  { title: 'Laser Sled', artist: 'Aqua MD', album: 'Demo Disc', duration: 72, ext: 'DEMO', synth: { bpm: 116, wave: 'square', prog: [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 48, 52]] } },
  { title: 'Table of Contents', artist: 'Aqua MD', album: 'Demo Disc', duration: 90, ext: 'DEMO', synth: { bpm: 84, wave: 'sine', prog: [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]] } }
] };
const SPOT = { id: 'spotify', kind: 'spotify', name: 'Spotify', tracks: [] };
let FILES = [];
let SP = { available: false, status: 'Stopped', via: null };
let ACCOUNT = { configured: false, linked: false, engine: { status: 'off' }, appOpen: false, redirectUri: 'http://127.0.0.1:43821/callback' };
let PLAYLISTS = null, PL_STATE = 'idle', PL_ERR = '', PL_AT = 0;
let RECENTS = [];
const plDiscs = new Map();
function plDisc(p) {
  const id = 'pl:' + p.id;
  let d = plDiscs.get(id);
  if (!d) { d = { id, kind: 'spotify', playlist: true, tracks: [] }; plDiscs.set(id, d); }
  return Object.assign(d, { pid: p.id, name: p.name, art: p.image || null, uri: p.uri, total: p.total, owner: p.owner || '' });
}
const allDiscs = () => [SPOT, ...RECENTS.map(plDisc), ...FILES, DEMO];
const discById = id => allDiscs().find(d => d.id === id) || plDiscs.get(id) || null;
const playlistByUri = uri => (uri && ((PLAYLISTS || []).find(p => p.uri === uri) || RECENTS.find(p => p.uri === uri))) || null;

const S = { discId: 'demo', ti: 0, pos: 0, playing: false, inserted: true, busy: false, drag: null,
  shuffle: false, repeat: 'off', order: [0, 1, 2], op: 0, vol: 21, errors: 0 };
const disc = () => discById(S.discId);
const isSpot = () => { const d = disc(); return !!d && d.kind === 'spotify'; };
function spTrack() {
  return SP.available && SP.title ? { title: SP.title, artist: SP.artist || '', album: SP.album || '', duration: SP.length || 0, art: SP.art || null, ext: 'SPOTIFY' } : null;
}
function track() { const d = disc(); if (!d) return null; return d.kind === 'spotify' ? spTrack() : (d.tracks[S.ti] || null); }
function spPos() {
  if (!SP.available || !SP.title) return 0;
  let p = SP.position || 0;
  if (SP.status === 'Playing') p += (Date.now() - (SP.positionAt || Date.now())) / 1000;
  return SP.length ? Math.min(p, SP.length) : Math.max(0, p);
}
function themeFor() {
  if (!S.inserted && !S.busy) return 'blue';
  const d = disc();
  if (!d) return 'blue';
  if (d.id === 'spotify' && SP.contextUri) { const p = playlistByUri(SP.contextUri); if (p) return colorName('pl:' + p.id); }
  return colorName(d.id);
}

/* ---------- play order: shuffle and loop ---------- */
function buildOrder(keepCurrent) {
  const d = disc();
  const n = d && d.kind !== 'spotify' ? d.tracks.length : 0;
  const idx = Array.from({ length: n }, (_, i) => i);
  if (S.shuffle) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    if (keepCurrent) { const k = idx.indexOf(S.ti); if (k > 0) { idx.splice(k, 1); idx.unshift(S.ti); } }
  }
  S.order = idx;
  S.op = Math.max(0, idx.indexOf(S.ti));
}
// Returns the next track index in play order, or -1 when the disc should stop.
function stepIndex(dir, auto) {
  const n = S.order.length;
  if (!n) return -1;
  let op = S.op + dir;
  if (op >= n) {
    if (auto && S.repeat === 'off') return -1;
    if (S.shuffle) {
      buildOrder(false);
      if (n > 1 && S.order[0] === S.ti) [S.order[0], S.order[1]] = [S.order[1], S.order[0]];
    }
    op = 0;
  }
  if (op < 0) op = n - 1;
  S.op = op;
  return S.order[op];
}
const REP_NEXT = { off: 'all', all: 'one', one: 'off' };
const REP_TEXT = { off: 'LOOP OFF', all: 'LOOP DISC', one: 'LOOP SONG' };
const REP_LABEL = { off: 'Loop: off', all: 'Loop: whole disc', one: 'Loop: this song' };
const REP_MPRIS = { off: 'None', all: 'Playlist', one: 'Track' };
const MPRIS_REP = { None: 'off', Playlist: 'all', Track: 'one' };
const repeatMode = () => (isSpot() && S.inserted) ? (MPRIS_REP[SP.loop] || 'off') : S.repeat;
const shuffleOn = () => (isSpot() && S.inserted) ? !!SP.shuffle : S.shuffle;

/* ---------- audio graph ---------- */
let ctx = null, out = null, anL = null, anR = null, media = null, mediaNode = null, noiseBuf = null;
const volGain = () => { const v = S.vol / 30; return v * v; };
function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  out = ctx.createGain(); out.gain.value = volGain();
  const split = ctx.createChannelSplitter(2);
  anL = ctx.createAnalyser(); anR = ctx.createAnalyser();
  anL.fftSize = anR.fftSize = 1024;
  out.connect(ctx.destination); out.connect(split);
  split.connect(anL, 0); split.connect(anR, 1);
  return ctx;
}
function applyVol() {
  if (out) out.gain.setTargetAtTime(volGain(), ctx.currentTime, 0.02);
  else if (media) media.volume = S.vol / 30;
}
function getMedia() {
  if (!media) {
    media = new Audio();
    media.preload = 'auto';
    media.addEventListener('ended', () => { const t = track(); if (t && !t.synth && !isSpot()) onTrackEnd(); });
    media.addEventListener('playing', () => { S.errors = 0; });
    media.addEventListener('error', onMediaError);
    media.addEventListener('loadedmetadata', () => {
      // Some files (MOV especially) carry no length in their tags; take it from the player and remember it.
      const t = track();
      if (t && t.url === media.src && isFinite(media.duration) && media.duration > 0 && Math.abs((t.duration || 0) - media.duration) > 0.5) {
        t.duration = media.duration;
        if (api && api.reportDuration && t.id) api.reportDuration(t.id, media.duration);
        lastDur = -1; paintLabel();
      }
    });
  }
  const c = ensureCtx();
  if (c && !mediaNode) { try { mediaNode = c.createMediaElementSource(media); mediaNode.connect(out); } catch (e) {} }
  return media;
}
function onMediaError() {
  const t = track(), d = disc();
  if (!t || t.synth || isSpot() || !media.getAttribute('src') || media.src !== t.url) return;
  S.errors++;
  S.playing = false;
  const giveUp = S.errors >= d.tracks.length;
  setMode('msg', "CAN'T PLAY", `${t.title} · ${giveUp ? 'no playable songs on this disc' : 'skipping'}`, 2400);
  render();
  if (!giveUp) setTimeout(() => { if (disc() === d && !S.busy) { const i = stepIndex(1, false); if (i >= 0) selectTrack(i, true); } }, 1600);
}

/* ---------- demo disc synth ---------- */
const synth = { active: false, t0: 0, next: 0, timer: 0, bus: null, lp: null };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function voice(freq, when, dur, type, gain, pan) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
  o.connect(g);
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(synth.lp); }
  else g.connect(synth.lp);
  o.start(when); o.stop(when + dur + 0.05);
}
function hat(when, gain) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
  const g = ctx.createGain(); g.gain.setValueAtTime(gain, when); g.gain.exponentialRampToValueAtTime(0.0005, when + 0.06);
  src.connect(hp); hp.connect(g); g.connect(synth.bus);
  src.start(when); src.stop(when + 0.08);
}
const PAT = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 2];
function playStep(sp, n, when, stepDur) {
  const bar = Math.floor(n / 16), s = n % 16, chord = sp.prog[bar % sp.prog.length];
  const lift = (s >= 8 && bar % 2 === 1) ? 12 : 0;
  const lead = { triangle: .085, square: .03, sine: .12 }[sp.wave] || .08;
  voice(mtof(chord[PAT[s]] + 12 + lift), when, stepDur * 1.9, sp.wave, lead, s % 2 ? .4 : -.4);
  if (s % 8 === 0) voice(mtof(chord[0] - 12), when, stepDur * 7.5, 'sine', .2, 0);
  if (s === 0) chord.forEach((m, i) => voice(mtof(m), when, stepDur * 15, 'triangle', .03, (i - 1) * .6));
  if (s % 4 === 2) hat(when, s % 8 === 6 ? .05 : .03);
}
function startSynth(t, pos) {
  const c = ensureCtx(); if (!c) return;
  const bus = c.createGain(); bus.gain.value = 0; bus.connect(out);
  bus.gain.setTargetAtTime(1, c.currentTime, 0.05);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = .7; lp.connect(bus);
  const stepDur = 60 / t.synth.bpm / 4;
  Object.assign(synth, { active: true, bus, lp, t0: c.currentTime - pos, next: Math.ceil(pos / stepDur) });
  const run = () => {
    if (!synth.active) return;
    const now = c.currentTime;
    while (synth.t0 + synth.next * stepDur < now + 0.2) {
      const at = synth.next * stepDur;
      if (at < t.duration) playStep(t.synth, synth.next, Math.max(synth.t0 + at, now), stepDur);
      synth.next++;
    }
  };
  run();
  clearInterval(synth.timer);
  synth.timer = setInterval(run, 40);
}
function stopSynth() {
  if (!synth.active) return;
  synth.active = false; clearInterval(synth.timer);
  const b = synth.bus;
  b.gain.cancelScheduledValues(ctx.currentTime);
  b.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
  setTimeout(() => { try { b.disconnect(); } catch (e) {} }, 300);
}

/* ---------- Spotify helpers ---------- */
function spotify(cmd, arg, failText) {
  if (!api) return Promise.resolve({ ok: false });
  return api.spotify(cmd, arg).then(r => {
    if ((!r || !r.ok) && failText) setMode('msg', 'SPOTIFY', failText, 3000);
    return r || { ok: false };
  });
}
// Why Spotify can't play right now, in words for the display.
function spotifyBlocker() {
  const eng = (ACCOUNT.engine && ACCOUNT.engine.status) || 'off';
  if (!ACCOUNT.linked && !SP.appOpen) return ['CONNECT SPOTIFY', eng === 'unsupported' ? 'Set it up in Settings' : 'Set it up in Settings, or open the Spotify app'];
  if (eng === 'unsupported') return ['SPOTIFY', 'Pick a playlist, or play something in Spotify'];
  if (ACCOUNT.linked && eng === 'starting') return ['STARTING', 'Getting Spotify’s player ready'];
  if (ACCOUNT.linked && eng === 'error' && !SP.appOpen) return ['NO SPOTIFY', 'Built-in player unavailable · see Settings'];
  return ['NO SPOTIFY', 'Open the Spotify app on this PC'];
}
function spotifyMissing() { const [a, b] = spotifyBlocker(); setMode('msg', a, b, 3800); }
const spotifyVol = () => SP.via === 'aqua' ? volGain() : S.vol / 30;
function playErrorText(r) {
  switch (r && r.error) {
    case 'not-linked': return 'Connect Spotify in Settings first';
    case 'no-device': if (ACCOUNT.engine && ACCOUNT.engine.status === 'unsupported') return 'Spotify didn’t open · open the Spotify app, then try again';
      return ACCOUNT.engine && ACCOUNT.engine.status === 'starting' ? 'Spotify’s player is still starting · try again in a moment' : 'Built-in player isn’t ready · open the Spotify app or check Settings';
    default: return r && r.status === 404 ? 'Spotify couldn’t find a player · press play again' : `Spotify: ${(r && r.error) || 'something went wrong'}`;
  }
}
async function playPlaylist(d, opts) {
  const shuffle = !!(opts && opts.shuffle);
  setMode('msg', shuffle ? 'SHUFFLE PLAY' : 'LOADING', d.name, 0);
  const r = await spotify('playContext', { uri: d.uri, shuffle, total: d.total || 0 });
  if (r && r.ok) {
    S.playing = true; SP.shuffle = shuffle;
    setMode('disc', shuffle ? 'SHUFFLE PLAY' : d.name, shuffle ? d.name : (d.total != null ? `${plural(d.total)} · Spotify` : 'Spotify playlist'), 1800);
  }
  else setMode('msg', 'SPOTIFY', playErrorText(r), 4200);
  render();
}

/* ---------- transport ---------- */
function currentPos() {
  const t = track(); if (!t || !S.inserted) return 0;
  if (isSpot()) return spPos();
  if (t.synth) return synth.active ? Math.min(t.duration, Math.max(0, ctx.currentTime - synth.t0)) : S.pos;
  return (media && media.src === t.url) ? media.currentTime : S.pos;
}
function stopSound() {
  if (synth.active) stopSynth();
  if (media && !media.paused) media.pause();
}
function prepTrack() {
  const t = track();
  if (t && !t.synth && t.url) { const m = getMedia(); if (m.src !== t.url) m.src = t.url; }
}
function play() {
  if (S.busy) return;
  if (!S.inserted) { loadDisc(disc() ? S.discId : 'demo', true); return; }
  if (isSpot()) {
    const d = disc();
    if (!SP.available) { spotifyMissing(); return; }
    if (d.playlist && (!SP.via || !SP.title)) { playPlaylist(d); return; }
    spotify('play', null, 'Press play in the Spotify app').then(r => { if (r.ok) { S.playing = true; render(); } });
    S.playing = true; render(); return;
  }
  const t = track(); if (!t) return;
  const c = ensureCtx();
  if (c && c.state !== 'running') c.resume().catch(() => {});
  if (SP.via && SP.status === 'Playing') spotify('pause'); // one thing plays at a time
  if (L.mode !== 'track') setMode('track');
  if (t.synth) startSynth(t, S.pos);
  else {
    const m = getMedia();
    if (m.src !== t.url) m.src = t.url;
    try { if (Math.abs(m.currentTime - S.pos) > .3) m.currentTime = S.pos; } catch (e) {}
    m.play().catch(() => { S.playing = false; render(); });
  }
  S.playing = true; render();
}
function pause() {
  if (isSpot()) { spotify('pause'); S.playing = false; render(); return; }
  S.pos = currentPos(); stopSound(); S.playing = false; render();
}
function stop() {
  if (isSpot()) { if (SP.via) spotify('stop'); S.playing = false; render(); return; }
  stopSound(); S.playing = false; S.pos = 0;
  const t = track(); if (t && !t.synth && media) { try { media.currentTime = 0; } catch (e) {} }
  if (S.inserted) setMode('track');
  render();
}
function selectTrack(i, keep) {
  const d = disc(); if (!d || !S.inserted || !d.tracks.length || S.busy) return;
  const was = keep == null ? S.playing : keep;
  stopSound();
  S.ti = ((i % d.tracks.length) + d.tracks.length) % d.tracks.length;
  const k = S.order.indexOf(S.ti);
  if (k < 0) buildOrder(true); else S.op = k;
  S.pos = 0; S.playing = false;
  prepTrack(); setMode('track');
  if (was) play(); else render();
}
function next() {
  if (S.busy || !S.inserted) return;
  if (isSpot()) { if (SP.via) spotify('next'); else spotifyMissing(); return; }
  const i = stepIndex(1, false); if (i >= 0) selectTrack(i);
}
function prev() {
  if (S.busy || !S.inserted) return;
  if (isSpot()) { if (SP.via) spotify('prev'); else spotifyMissing(); return; }
  if (currentPos() > 3) { seek(0); return; }
  const i = stepIndex(-1, false); if (i >= 0) selectTrack(i);
}
function onTrackEnd() {
  const d = disc(); if (!d || isSpot()) return;
  S.errors = 0;
  if (S.repeat === 'one') { stopSound(); S.pos = 0; S.playing = false; play(); return; }
  const i = stepIndex(1, true);
  if (i >= 0) selectTrack(i, true);
  else {
    stopSound(); S.playing = false;
    if (S.shuffle) buildOrder(false);
    S.op = 0; S.ti = S.order[0] || 0; S.pos = 0;
    prepTrack(); setMode('track'); render();
  }
}
function seek(p) {
  if (!S.inserted) return;
  if (isSpot()) {
    if (!SP.via || !SP.length) return;
    p = Math.max(0, Math.min(p, SP.length - 0.5));
    spotify('seek', p, 'Spotify did not allow seeking here');
    SP.position = p; SP.positionAt = Date.now(); render(); return;
  }
  const t = track(); if (!t) return;
  p = Math.max(0, Math.min(p, Math.max(0, (t.duration || 0) - 0.25)));
  if (t.synth) { if (synth.active) { stopSynth(); startSynth(t, p); } S.pos = p; }
  else { const m = getMedia(); try { m.currentTime = p; } catch (e) {} S.pos = p; }
  render();
}
function toggleShuffle() {
  if (S.busy) return;
  if (isSpot() && S.inserted) {
    if (!SP.via) { if (SP.available) setMode('msg', 'SHUFFLE', 'Start playing first', 1800); else spotifyMissing(); return; }
    const want = !SP.shuffle;
    SP.shuffle = want;
    spotify('shuffle', want, 'Change shuffle in the Spotify app');
    setMode('msg', want ? 'SHUFFLE ON' : 'SHUFFLE OFF', '', 1300); render(); return;
  }
  S.shuffle = !S.shuffle;
  buildOrder(true);
  if (api) api.set('shuffle', S.shuffle);
  setMode('msg', S.shuffle ? 'SHUFFLE ON' : 'SHUFFLE OFF', '', 1300);
  render();
}
function cycleRepeat() {
  if (S.busy) return;
  const nextMode = REP_NEXT[repeatMode()];
  if (isSpot() && S.inserted) {
    if (!SP.via) { if (SP.available) setMode('msg', 'LOOP', 'Start playing first', 1800); else spotifyMissing(); return; }
    SP.loop = REP_MPRIS[nextMode];
    spotify('loop', REP_MPRIS[nextMode], 'Change looping in the Spotify app');
  } else {
    S.repeat = nextMode;
    if (api) api.set('repeat', nextMode);
  }
  setMode('msg', REP_TEXT[nextMode], '', 1300);
  render();
}

/* ---------- volume knob ---------- */
const knob = $('knob'), knobCap = $('knobCap');
let volSaveT = 0, spVolT = 0;
function paintKnob() {
  const f = S.vol / 30;
  knob.style.setProperty('--a', (270 * f) + 'deg');
  knobCap.style.setProperty('--r', (-135 + 270 * f) + 'deg');
  knob.setAttribute('aria-valuenow', String(S.vol));
}
function setVol(v, show) {
  v = Math.max(0, Math.min(30, Math.round(v)));
  if (v === S.vol) return;
  S.vol = v; paintKnob(); applyVol();
  if (show !== false) setMode('msg', `VOLUME ${pad2(v)}`, '', 1200);
  clearTimeout(volSaveT); volSaveT = setTimeout(() => { if (api) api.set('volume', v); }, 400);
  if (isSpot() && S.inserted && SP.via) { clearTimeout(spVolT); spVolT = setTimeout(() => spotify('volume', spotifyVol()), 120); }
}
let kd = null;
knob.addEventListener('pointerdown', e => { try { knob.setPointerCapture(e.pointerId); } catch (err) {} kd = { x: e.clientX, y: e.clientY, v: S.vol }; e.preventDefault(); });
knob.addEventListener('pointermove', e => { if (!kd) return; const d = ((e.clientX - kd.x) + (kd.y - e.clientY)) / (SCALE || 1); setVol(kd.v + d / 12); });
const endKnob = () => { kd = null; };
knob.addEventListener('pointerup', endKnob);
knob.addEventListener('pointercancel', endKnob);
knob.addEventListener('wheel', e => { e.preventDefault(); setVol(S.vol + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
knob.addEventListener('keydown', e => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); setVol(S.vol + 1); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); setVol(S.vol - 1); }
});

/* ---------- disc insert / eject ---------- */
const cart = $('cart');
async function ejectAnim() {
  setMode('msg', 'EJECT', '');
  cart.classList.remove('open');
  await wait(520);
  cart.classList.add('out');
  await wait(650);
  S.inserted = false;
  render();
}
async function loadDisc(id, autoplay, opts) {
  if (S.busy) return;
  const target = discById(id); if (!target) return;
  if (target.kind === 'spotify') {
    if (target.playlist && !ACCOUNT.linked) { setMode('msg', 'CONNECT SPOTIFY', 'Set it up in Settings to play playlists', 3600); openPanel('settings'); return; }
    if (!target.playlist && !SP.available && !ACCOUNT.linked) { spotifyMissing(); if (!SP.appOpen) openPanel('settings'); return; }
  }
  S.busy = true;
  if (isSpot() && S.inserted && SP.status === 'Playing' && !(target.kind === 'spotify')) spotify('pause');
  stopSound(); S.playing = false; render();
  if (S.inserted) await ejectAnim();
  S.discId = id; S.ti = 0; S.pos = 0; S.inserted = false; S.errors = 0;
  buildOrder(false);
  if (S.shuffle && S.order.length) S.ti = S.order[0];
  S.op = 0;
  if (target.playlist) rememberPlaylist(target);
  paintLabel(); prepTrack();
  setMode('toc', 'TOC READING', '');
  render();
  cart.classList.remove('out');
  await wait(820);
  cart.classList.add('open');
  await wait(900);
  S.inserted = true; S.busy = false;
  if (api) api.set('lastDisc', id);
  if (target.playlist) { render(); await playPlaylist(target, opts); return; }
  if (target.kind === 'spotify') {
    S.playing = SP.status === 'Playing';
    if (SP.title) setMode('disc', SP.contextName || SP.album || 'Spotify', SP.artist || 'Spotify', 1700);
    else setMode('track');
  } else setMode('disc', target.name, `${plural(target.tracks.length)} · ${fmt(total(target))}`, 1700);
  render();
  if (autoplay) { await wait(1200); if (!S.playing && !S.busy && S.discId === id) play(); }
}
async function eject() {
  if (S.busy) return;
  if (S.inserted) {
    S.busy = true;
    if (isSpot() && SP.status === 'Playing') spotify('pause');
    stopSound(); S.playing = false; render();
    await ejectAnim();
    S.busy = false; setMode('nodisc'); render();
  } else loadDisc(disc() ? S.discId : 'demo');
}
function rememberPlaylist(d) {
  const p = { id: d.pid, name: d.name, uri: d.uri, image: d.art, total: d.total, owner: d.owner };
  RECENTS = [p, ...RECENTS.filter(x => x.id !== p.id)].slice(0, 4);
  if (api) api.set('recentPlaylists', RECENTS);
  rackSig = '';
}

/* ---------- display ---------- */
const titleBox = $('titleBox'), titleEl = $('title'), subEl = $('sub');
const L = { mode: 'track', token: 0 };
let curTitle = null;
function measureTitle() {
  if (REDUCED) return;
  titleEl.classList.remove('scroll');
  const over = titleEl.scrollWidth - titleBox.clientWidth;
  if (over > 4) {
    titleEl.style.setProperty('--shift', (-over - 6) + 'px');
    titleEl.style.setProperty('--dur', Math.max(4, over / 80) + 's');
    void titleEl.offsetWidth;
    titleEl.classList.add('scroll');
  }
}
function setTitle(text) {
  if (text === curTitle) return;
  curTitle = text; titleEl.textContent = text;
  titleEl.classList.remove('scroll');
  requestAnimationFrame(measureTitle);
}
function trackText() {
  const t = track();
  if (isSpot()) {
    if (!SP.available) { const [a, b] = spotifyBlocker(); setTitle(a); subEl.textContent = b; return; }
    if (!t) {
      const d = disc();
      setTitle(d && d.playlist ? d.name : 'SPOTIFY');
      subEl.textContent = SP.engineReady ? (d && d.playlist ? 'Press play' : 'Pick a playlist, or press play') : 'Play something in the Spotify app';
      return;
    }
  }
  setTitle(t ? t.title : '');
  subEl.textContent = t ? ([t.artist, t.album].filter(Boolean).join(' · ') || (t.video ? 'Video file · sound only' : '')) : '';
}
function setMode(mode, title, sub, ms) {
  L.mode = mode; const tk = ++L.token;
  titleBox.classList.toggle('blink', mode === 'toc');
  if (mode === 'track') trackText();
  else if (mode === 'nodisc') { setTitle('NO DISC'); subEl.textContent = 'Pick a disc below or add music'; }
  else { setTitle(title || ''); subEl.textContent = sub || ''; }
  if (ms) setTimeout(() => { if (L.token === tk) setMode(S.inserted ? 'track' : 'nodisc'); }, ms);
}

const artEl = $('art'), lname = $('lname'), lmeta = $('lmeta');
let lastArt = undefined;
function paintLabel() {
  const d = disc(); if (!d) return;
  let name, meta, art;
  if (d.playlist) {
    name = d.name;
    meta = d.total != null ? `${plural(d.total)} · Spotify` : 'Spotify playlist';
    art = d.art || null;
  } else if (d.kind === 'spotify') {
    const ctxP = playlistByUri(SP.contextUri);
    name = (ctxP && ctxP.name) || SP.contextName || SP.album || 'Spotify';
    meta = SP.artist || (SP.available ? (SP.via === 'app' ? 'Spotify app' : 'Spotify') : 'Not connected');
    art = (ctxP && ctxP.image) || SP.art || null;
  } else {
    const t = track();
    name = d.name;
    meta = `${plural(d.tracks.length)} · ${fmt(total(d))}`;
    art = (t && t.art) || d.art || null;
  }
  if (lname.textContent !== name) lname.textContent = name;
  if (lmeta.textContent !== meta) lmeta.textContent = meta;
  if (art !== lastArt) {
    lastArt = art;
    artEl.classList.add('gen'); artEl.style.backgroundImage = '';
    if (art) {
      // Load first so a missing cover (offline, removed file) keeps the printed label instead of a blank square.
      const img = new Image();
      img.onload = () => { if (lastArt === art) { artEl.classList.remove('gen'); artEl.style.backgroundImage = `url("${art}")`; } };
      img.src = art;
    }
  }
}

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"/></svg>',
  repeat: '<svg class="line" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2.5l3.5 3.5L17 9.5"/><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13"/><path d="M7 21.5L3.5 18 7 14.5"/><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13"/></svg>',
  repeatOne: '<svg class="line" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2.5l3.5 3.5L17 9.5"/><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13"/><path d="M7 21.5L3.5 18 7 14.5"/><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13"/><path d="M11 10.5l1.6-1V15"/></svg>'
};
const srcInds = [...document.querySelectorAll('.ind[data-src]')];
const extInd = $('extInd'), shufInd = $('shufInd'), repInd = $('repInd');
const stateInd = $('stateInd'), trkNo = $('trkNo'), playBtn = $('playBtn'), playIcon = $('playIcon'), led = $('led');
const shufBtn = $('shufBtn'), repBtn = $('repBtn'), repIcon = $('repIcon'), ptrack = $('ptrack');
let iconState = null, repIconState = null;
function render() {
  const d = disc(), on = S.inserted && !!d, t = on ? track() : null;
  applyTheme(themeFor());
  srcInds.forEach(e => e.classList.toggle('on', on && e.dataset.src === d.kind));
  const ext = on && d.kind === 'mp3' && t ? t.ext : 'MP3';
  if (extInd.textContent !== ext) extInd.textContent = ext;
  const sh = shuffleOn(), rp = repeatMode();
  shufInd.classList.toggle('on', sh);
  repInd.classList.toggle('on', rp !== 'off');
  repInd.textContent = rp === 'one' ? 'REPEAT 1' : 'REPEAT';
  shufBtn.classList.toggle('on', sh); shufBtn.setAttribute('aria-pressed', String(sh));
  repBtn.classList.toggle('on', rp !== 'off'); repBtn.setAttribute('aria-label', REP_LABEL[rp]);
  if (repIconState !== rp) { repIcon.innerHTML = rp === 'one' ? ICON.repeatOne : ICON.repeat; repIconState = rp; }

  const pos = currentPos();
  let state;
  if (!on) state = S.busy ? 'LOADING' : 'NO DISC';
  else if (isSpot() && !SP.available) state = 'NO PLAYER';
  else state = S.playing ? 'PLAY' : (pos > 0.05 ? 'PAUSE' : 'STOP');
  stateInd.textContent = state;
  if (!on) trkNo.textContent = 'TRACK --/--';
  else if (isSpot()) trkNo.textContent = SP.via === 'aqua' ? 'BUILT-IN' : (SP.via === 'app' ? 'SPOTIFY APP' : 'TRACK --');
  else trkNo.textContent = `TRACK ${pad2(S.ti + 1)}/${pad2(d.tracks.length)}`;

  playBtn.classList.toggle('lit', S.playing);
  if (iconState !== S.playing) { playIcon.innerHTML = S.playing ? ICON.pause : ICON.play; iconState = S.playing; }
  playBtn.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  led.classList.toggle('on', S.playing);
  ptrack.classList.toggle('off', !(t && t.duration));
  if (L.mode === 'track') trackText();
  paintLabel(); renderRack();
  if (plPanel && !plPanel.hidden) markActivePlaylist();
  renderWidgets();
  // The Android app shows a notification and keeps playing in the background while your own music plays.
  if (api && api.nowPlaying) {
    api.nowPlaying({ playing: !!(on && S.playing), local: !isSpot(), title: (t && t.title) || '', artist: (t && t.artist) || '' });
  }
}

/* ---------- disc rack ---------- */
const rack = $('rack');
let rackSig = '';
function chip(cls, iconEl, name, small) {
  const b = el('button', 'chip' + (cls ? ' ' + cls : '')); b.type = 'button';
  const ct = el('span', 'ct'); ct.append(el('b', '', name), el('small', '', small));
  b.append(iconEl, ct); return b;
}
function miniFor(cls, art, id) {
  const m = el('span', 'mini ' + cls + (art ? ' has-art' : ''));
  if (art) m.style.backgroundImage = `url("${art}"), var(--gen-mini)`;
  if (id) m.style.setProperty('--dh', hueOf(id));
  return m;
}
function renderRack() {
  const active = S.inserted ? S.discId : '';
  const spLive = SP.via && SP.status === 'Playing' && active !== 'spotify' && !(disc() && disc().playlist && S.inserted);
  const sig = [active, SP.available, spLive, SP.art || '', ACCOUNT.linked, JSON.stringify(COLOR_MAP),
    ...RECENTS.map(p => p.id), ...FILES.map(d => d.id + ':' + d.tracks.length)].join('|');
  if (sig === rackSig) return;
  rackSig = sig;
  const kids = [el('span', 'rack-label', 'DISCS')];
  const sp = chip((active === 'spotify' ? 'active' : '') + (SP.available ? '' : ' dim'), miniFor(spLive ? 'live' : '', SP.art, 'spotify'), 'Spotify',
    !SP.available ? (ACCOUNT.linked ? 'Starting' : 'Set up') : (spLive ? 'Playing now' : 'Now playing'));
  sp.dataset.disc = 'spotify'; kids.push(sp);
  const pl = chip('add', el('span', 'plus', '♪'), 'Playlists', ACCOUNT.linked ? 'Your Spotify' : 'Connect first');
  pl.dataset.act = 'playlists'; kids.push(pl);
  for (const p of RECENTS) {
    const d = plDisc(p);
    const b = chip(active === d.id ? 'active' : '', miniFor('', d.art, d.id), d.name, d.total != null ? plural(d.total) : 'Playlist');
    b.dataset.disc = d.id; kids.push(b);
  }
  for (const d of FILES) {
    const b = chip(active === d.id ? 'active' : '', miniFor('', d.art, d.id), d.name, plural(d.tracks.length));
    b.dataset.disc = d.id; kids.push(b);
  }
  const demo = chip(active === 'demo' ? 'active' : '', miniFor('', null, 'demo'), DEMO.name, plural(DEMO.tracks.length));
  demo.dataset.disc = 'demo'; kids.push(demo);
  const add = chip('add', el('span', 'plus', '+'), 'Add songs', FEAT.drop ? 'or drop files here' : (PLATFORM === 'android' ? 'from this phone' : 'pick files')); add.dataset.act = 'files'; kids.push(add);
  if (FEAT.folders) { const fold = chip('add', el('span', 'plus', '+'), 'Add folder', 'albums become discs'); fold.dataset.act = 'folder'; kids.push(fold); }
  const keep = rack.scrollLeft;
  rack.replaceChildren(...kids);
  rack.scrollLeft = keep;
  requestAnimationFrame(() => {
    rack.classList.toggle('fits', rack.scrollWidth <= rack.clientWidth + 2);
    const a = rack.querySelector('.chip.active');
    if (a) a.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
}
rack.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.disc) {
    const id = b.dataset.disc;
    if (id === S.discId && S.inserted) { S.playing ? pause() : play(); }
    else loadDisc(id);
  } else if (b.dataset.act === 'playlists') openPanel('playlists');
  else if (b.dataset.act) addMusic(b.dataset.act);
});
rack.addEventListener('wheel', e => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { rack.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });

/* ---------- adding music ---------- */
function addMusic(mode) {
  if (!api) { setMode('msg', 'ADD MUSIC', 'Available in the desktop app', 2400); return; }
  runImport(api.pick(mode));
}
async function runImport(promise) {
  let res;
  try { res = await promise; }
  catch (e) { setMode('msg', 'COULD NOT ADD', 'Something went wrong reading those files', 3000); return; }
  if (!res) { if (L.mode === 'msg' && curTitle === 'READING') setMode(S.inserted ? 'track' : 'nodisc'); return; }
  const cur = track();
  const curId = cur && cur.id;
  FILES = res.discs || [];
  rackSig = '';
  renderDiscList();
  if (!res.added) {
    setMode('msg', res.found ? 'ALREADY ADDED' : 'NO MUSIC FOUND',
      res.found ? (res.unsupported ? 'Apple Lossless files are not supported yet' : res.silent ? 'Those videos have no sound' : 'Those files are already on your discs') : 'Try MP3, M4A, FLAC, WAV, MP4 or MOV files', 3000);
    render(); return;
  }
  const extra = (res.silent ? ` · ${res.silent} without sound skipped` : '') + (res.unsupported ? ` · ${res.unsupported} Apple Lossless skipped` : '');
  while (S.busy) await wait(100);
  const d = disc();
  if (S.inserted && d && res.touched.includes(d.id)) {
    if (curId) { const k = d.tracks.findIndex(t => t.id === curId); if (k >= 0) S.ti = k; }
    buildOrder(true);
    setMode('msg', 'ADDED', plural(res.added) + extra, 2400);
    render();
  } else {
    render();
    await loadDisc(res.touched[0]);
    if (extra) setMode('msg', 'LOADED', plural(res.added) + extra, 2600);
  }
}
if (api) api.onImportProgress(p => { if (p && p.total > 1 && p.done < p.total) setMode('msg', 'READING', `${p.done + 1} of ${p.total} files`); });

const drop = $('drop');
let dragDepth = 0;
const hasFiles = e => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragenter', e => { if (!hasFiles(e)) return; dragDepth++; drop.classList.add('show'); });
addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.classList.remove('show'); });
addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; drop.classList.remove('show');
  if (api && FEAT.drop && e.dataTransfer && e.dataTransfer.files.length) runImport(api.importFiles(e.dataTransfer.files, e.dataTransfer.items));
});

/* ---------- controls ---------- */
playBtn.addEventListener('click', () => S.playing ? pause() : play());
$('stopBtn').addEventListener('click', stop);
$('nextBtn').addEventListener('click', next);
$('prevBtn').addEventListener('click', prev);
$('ejectBtn').addEventListener('click', eject);
shufBtn.addEventListener('click', toggleShuffle);
repBtn.addEventListener('click', cycleRepeat);
addEventListener('keydown', e => {
  if (e.key === 'Escape' && openName) { closePanel(); return; }
  if (e.target.closest && e.target.closest('input,button,textarea,[role="slider"]')) return;
  if (e.code === 'Space') { e.preventDefault(); S.playing ? pause() : play(); }
});

const pfill = $('pfill'), pknob = $('pknob');
const ratioFrom = e => { const r = ptrack.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
ptrack.addEventListener('pointerdown', e => {
  const t = track(); if (!t || !S.inserted || !t.duration) return;
  try { ptrack.setPointerCapture(e.pointerId); } catch (err) {}
  S.drag = ratioFrom(e) * t.duration;
});
ptrack.addEventListener('pointermove', e => { const t = track(); if (S.drag != null && t) S.drag = ratioFrom(e) * t.duration; });
ptrack.addEventListener('pointerup', () => { if (S.drag == null) return; const p = S.drag; S.drag = null; seek(p); });
ptrack.addEventListener('pointercancel', () => { S.drag = null; });
ptrack.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') { e.preventDefault(); seek(currentPos() + 5); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); seek(currentPos() - 5); }
});

/* ---------- side widgets, arranged in pages that take turns ---------- */
const WIDGETS = {
  clock: { name: 'Clock', sizes: { L: 200, S: 112 } },
  weather: { name: 'Weather', sizes: { L: 300, S: 132 } },
  lyrics: { name: 'Lyrics', fill: 200 },
  now: { name: 'Now Playing', fill: 200 },
  next: { name: 'Up Next', fill: 190 },
  system: { name: 'System', sizes: { L: 250, S: 150 } },
  calendar: { name: 'Calendar', sizes: { L: 310, S: 120 } }
};
const WTYPES = Object.keys(WIDGETS);
const INTERVALS = [[0, 'Off'], [5, '5 s'], [10, '10 s'], [20, '20 s'], [30, '30 s'], [60, '1 min']];
const DEFAULT_SIDE = () => ({ interval: 10, pages: [[{ type: 'clock', size: 'L' }, { type: 'weather', size: 'L' }]] });
const WGAP = 22, MAX_PAGES = 6, MAX_PER_PAGE = 12;
let SIDE = DEFAULT_SIDE();
let INST = [], PAGE_EL = [], curPage = 0, lastSwitch = Date.now(), lastManual = 0;
const sideHost = $('widgets');

function normSide(v) {
  let pages = Array.isArray(v) ? [v] : (v && Array.isArray(v.pages) ? v.pages : null);
  if (!pages) return DEFAULT_SIDE();
  pages = pages.map(p => (Array.isArray(p) ? p : []).filter(w => w && WIDGETS[w.type]).slice(0, MAX_PER_PAGE)
    .map(w => ({ type: w.type, size: w.size === 'S' ? 'S' : 'L' }))).filter(p => p.length).slice(0, MAX_PAGES);
  if (!pages.length) return DEFAULT_SIDE();
  const iv = INTERVALS.some(([n]) => n === Number(v.interval)) ? Number(v.interval) : 10;
  return { interval: iv, pages };
}

// Heights for one page: big widgets shrink to small when the page is too full; Lyrics, Now Playing and Up Next share what's left.
function layoutPage(list, H) {
  const spec = w => WIDGETS[w.type];
  const items = list.map(w => Object.assign({}, w, { eff: w.size }));
  if (items.length === 1 && !spec(items[0]).fill) items[0].eff = 'L';
  const need = () => items.reduce((a, w) => a + (spec(w).fill || spec(w).sizes[w.eff]), 0) + WGAP * (items.length - 1);
  for (let i = items.length - 1; i >= 0 && need() > H; i--) if (!spec(items[i]).fill && items[i].eff === 'L') items[i].eff = 'S';
  const fixed = items.reduce((a, w) => a + (spec(w).fill ? 0 : spec(w).sizes[w.eff]), 0);
  const fills = items.filter(w => spec(w).fill).length;
  const share = fills ? Math.max(120, Math.floor((H - fixed - WGAP * (items.length - 1)) / fills)) : 0;
  return items.map(w => Object.assign(w, { h: spec(w).fill ? share : spec(w).sizes[w.eff] }));
}

// What actually shows: each saved page split to what fits this window, each split into columns.
function chunk(list, n) { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; }
function columnsFor(list) {
  const used = Math.min(GEO.cols, list.length);
  return chunk(list, Math.ceil(list.length / Math.max(1, used)));
}
function shownPages() { return SIDE.pages.flatMap(list => chunk(list, Math.max(1, GEO.cap))); }

function buildSide() {
  for (const w of INST) if (w.destroy) w.destroy();
  INST = [];
  const pages = shownPages();
  curPage = Math.max(0, Math.min(curPage, pages.length - 1));
  const H = GEO.pageH;
  PAGE_EL = pages.map((list, pi) => {
    const page = el('div', 'wpage no-anim' + (pi === curPage ? ' on' : ''));
    page.style.height = H + 'px';
    for (const colList of columnsFor(list)) {
      const col = el('div', 'wcol');
      const lay = layoutPage(colList, H);
      const hasFill = lay.some(w => WIDGETS[w.type].fill);
      if (!hasFill) col.classList.add(lay.length === 1 ? 'solo-fixed' : 'spread');
      const colW = GEO.w / Math.min(GEO.cols, list.length);
      for (const w of lay) {
        const alone = lay.length === 1;
        const inst = makeWidget(w.type, w.eff, alone && H >= 420, alone && H >= 260 && colW >= 760);
        inst.page = pi;
        inst.el.style.height = (alone && WIDGETS[w.type].fill ? H : w.h) + 'px';
        INST.push(inst);
        col.append(inst.el);
      }
      page.append(col);
    }
    return page;
  });
  const dots = el('div', 'wdots');
  if (pages.length > 1) pages.forEach((_, i) => { const b = btn('wdot', null, { page: i }); b.append(el('i')); b.setAttribute('aria-label', `Page ${i + 1}`); dots.append(b); });
  dots.style.top = (H + 6) + 'px'; dots.style.bottom = 'auto';
  sideHost.replaceChildren(...PAGE_EL, dots);
  requestAnimationFrame(() => PAGE_EL.forEach(p => p.classList.remove('no-anim')));
  paintDots();
  tick(); paintWeather();
  LYR.key = null; refreshLyrics();
  SPQ.key = null; refreshQueue();
  for (const w of INST) if (w.render) w.render();
  pollSystem();
}

function paintDots() {
  const still = !SIDE.interval || SIDE.pages.length < 2 || Date.now() - lastManual < 30e3;
  sideHost.style.setProperty('--iv', (SIDE.interval || 10) + 's');
  sideHost.querySelectorAll('.wdot').forEach((d, i) => {
    const on = i === curPage;
    d.classList.toggle('still', still);
    if (on && !d.classList.contains('on')) { d.classList.add('on'); }
    else if (!on) d.classList.remove('on');
  });
}
function restartDot() {
  const d = sideHost.querySelector('.wdot.on i');
  if (d) { d.style.animation = 'none'; void d.offsetWidth; d.style.animation = ''; }
}

function goPage(i, manual) {
  const n = PAGE_EL.length;
  if (n < 2) return;
  const to = ((i % n) + n) % n;
  if (to === curPage) return;
  const forward = manual ? (i > curPage) : true;
  const from = PAGE_EL[curPage], next = PAGE_EL[to];
  next.classList.add('no-anim');
  next.classList.toggle('left', !forward);
  void next.offsetWidth;
  next.classList.remove('no-anim');
  from.classList.remove('on');
  from.classList.toggle('left', forward);
  next.classList.remove('left');
  next.classList.add('on');
  curPage = to;
  lastSwitch = Date.now();
  if (manual) lastManual = Date.now();
  paintDots(); restartDot();
  for (const w of INST) if (w.page === to && w.shown) w.shown();
}

setInterval(() => {
  if (!SIDE.interval || PAGE_EL.length < 2 || openName) return;
  const now = Date.now();
  if (now - lastManual < 30e3) return;
  if (now - lastSwitch >= SIDE.interval * 1000) goPage(curPage + 1, false);
  else if (sideHost.querySelector('.wdot.still')) { paintDots(); restartDot(); }
}, 400);

sideHost.addEventListener('click', e => {
  const d = e.target.closest('.wdot');
  if (d) goPage(Number(d.dataset.page), true);
});
let swipe = null;
sideHost.addEventListener('pointerdown', e => { swipe = { x: e.clientX, y: e.clientY }; });
sideHost.addEventListener('pointerup', e => {
  if (!swipe) return;
  const dx = (e.clientX - swipe.x) / (SSCALE || 1), dy = (e.clientY - swipe.y) / (SSCALE || 1);
  swipe = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) goPage(curPage + (dx < 0 ? 1 : -1), true);
});
sideHost.addEventListener('pointercancel', () => { swipe = null; });

function saveSide() {
  SIDE = normSide(SIDE);
  if (api) api.set('widgets', SIDE);
  buildSide();
  if (openName === 'settings') renderWidgetEditor();
}

/* ----- the widgets ----- */
function card(type, label) {
  const e = el('div', `w w-${type} card`);
  const head = el('div', 'w-head');
  const tag = el('span', 'w-tag');
  head.append(el('span', 'w-label', label), tag);
  e.append(head);
  return { e, tag };
}
function makeWidget(type, size, solo, roomy) {
  const w = ({ clock: wClock, weather: wWeather, lyrics: wLyrics, now: wNow, next: wNext, system: wSystem, calendar: wCalendar })[type](size, solo);
  w.type = type;
  w.el.classList.add('w-' + (type === 'clock' && roomy ? 'XL' : size));
  if (solo) w.el.classList.add('solo');
  return w;
}

function wClock() {
  const e = el('div', 'w w-clock');
  e.innerHTML = '<div class="clock"><div class="hm"><span class="c-h">12</span><span class="colon">:</span><span class="c-m">00</span></div><div class="side"><span class="ampm">AM</span><span class="secs">00</span></div></div>';
  const q = s => e.querySelector(s);
  const r = { h: q('.c-h'), m: q('.c-m'), ap: q('.ampm'), s: q('.secs'), c: q('.colon') };
  return { el: e, tick(d) {
    const h = d.getHours();
    r.ap.textContent = h >= 12 ? 'PM' : 'AM';
    r.h.textContent = h % 12 || 12;
    r.m.textContent = pad2(d.getMinutes());
    r.s.textContent = pad2(d.getSeconds());
    r.c.classList.toggle('off', d.getSeconds() % 2 === 1);
  } };
}

function wWeather() {
  const e = el('div', 'w w-weather');
  e.innerHTML = `<div class="wx loading"><div class="wx-now">
    <div class="wx-icon" data-kind="partly" aria-hidden="true"><span class="sun"></span><span class="moon"></span><span class="cloud back"></span><span class="cloud"></span>
      <span class="drops"><i></i><i></i><i></i><i></i></span><span class="flakes"><i></i><i></i><i></i><i></i></span><span class="bolt"></span><span class="fogl"><i></i><i></i><i></i></span></div>
    <div class="temp">--°</div>
    <div class="wx-meta"><div class="cond">Loading weather</div><div class="hl">&nbsp;</div><div class="loc"><span class="wl">Vaughan</span> <span class="tag" hidden>Offline</span></div></div>
  </div><div class="hours"></div></div>`;
  const q = s => e.querySelector(s);
  const r = { box: q('.wx'), icon: q('.wx-icon'), temp: q('.temp'), cond: q('.cond'), hl: q('.hl'), loc: q('.wl'), tag: q('.tag'), hours: q('.hours') };
  return { el: e, weather() {
    r.loc.textContent = shortPlace();
    if (!lastWx) {
      r.box.classList.toggle('loading', !wxFail);
      r.temp.textContent = '--°';
      r.cond.textContent = wxFail ? 'No connection' : 'Loading weather';
      r.hl.textContent = wxFail ? 'Trying again soon' : ' ';
      r.tag.hidden = !wxFail; r.hours.replaceChildren();
      return;
    }
    const j = lastWx, c = j.current, w = wmo(c.weather_code, c.is_day);
    r.icon.dataset.kind = w.kind;
    r.temp.textContent = Math.round(c.temperature_2m) + '°';
    r.cond.textContent = w.text;
    const D = j.daily || {};
    r.hl.textContent = D.temperature_2m_max ? `High ${Math.round(D.temperature_2m_max[0])}° · Low ${Math.round(D.temperature_2m_min[0])}°` : '';
    r.tag.hidden = !wxStale;
    const H = j.hourly || { time: [] };
    const start = H.time.findIndex(t => t > c.time);
    const slots = [];
    if (start >= 0) for (let k = 0; k < 5; k++) { const i = start + k * 2; if (i < H.time.length) slots.push(i); }
    r.hours.replaceChildren(...slots.map(i => {
      const hw = wmo(H.weather_code[i], H.is_day ? H.is_day[i] : 1);
      const d = el('div', 'hour');
      d.append(el('span', 't', hourLabel(H.time[i])), el('i', 'mi ' + MINI[hw.kind]), el('span', 'd', Math.round(H.temperature_2m[i]) + '°'));
      return d;
    }));
    r.box.classList.remove('loading');
  } };
}

/* lyrics: one lookup shared by every Lyrics widget */
const LYR = { key: null, state: 'idle', data: null, v: 0 };
let lyrTimer = 0;
function lyricsQuery() {
  if (!S.inserted || S.busy) return null;
  const d = disc(); if (!d) return null;
  if (d.kind === 'demo') return { key: 'demo', demo: true };
  const t = track();
  if (!t || !t.title) return null;
  if (d.kind === 'spotify') return { key: `sp|${SP.trackId || t.title}`, q: { title: t.title, artist: t.artist, album: t.album, duration: t.duration } };
  return { key: `f|${t.id}`, q: { id: t.id, title: t.title, artist: t.artist, album: t.album, duration: t.duration } };
}
function setLyrics(state, data) { LYR.state = state; LYR.data = data || null; LYR.v++; for (const w of INST) if (w.lyrics) w.lyrics(); }
function refreshLyrics() {
  if (!INST.some(w => w.type === 'lyrics')) return;
  const lq = lyricsQuery();
  const key = lq ? lq.key : '';
  if (key === LYR.key) return;
  LYR.key = key;
  clearTimeout(lyrTimer);
  if (!lq) { setLyrics('idle'); return; }
  if (lq.demo) { setLyrics('demo'); return; }
  if (!api) { setLyrics('noapi'); return; }
  setLyrics('loading');
  lyrTimer = setTimeout(async () => {
    let r;
    try { r = await api.lyrics(lq.q); } catch (e) { r = { status: 'error' }; }
    if (LYR.key !== key) return;
    setLyrics((r && r.status) || 'none', r);
  }, 350);
}
const LYR_MSG = {
  idle: 'Lyrics show up here while a song plays.', loading: 'Looking for lyrics…', none: 'No lyrics found for this song.',
  instrumental: 'Instrumental. No lyrics.', error: 'Couldn’t reach the lyrics service. Check your internet connection.',
  demo: 'The demo disc has no lyrics.', noapi: 'Lyrics work in the desktop app.'
};
function wLyrics() {
  const { e, tag } = card('lyrics', 'LYRICS');
  const body = el('div', 'wl-body'), lines = el('div', 'wl-lines'), msg = el('div', 'w-msg');
  body.append(lines); e.append(body, msg);
  let rows = [], times = [], cur = -2, mode = '';
  function center(i) {
    const row = rows[i];
    const target = row ? body.clientHeight * 0.4 - (row.offsetTop + row.offsetHeight / 2) : body.clientHeight * 0.4;
    lines.style.transform = `translateY(${Math.min(body.clientHeight * 0.4, target)}px)`;
  }
  return { el: e,
    lyrics() {
      const st = LYR.state, data = LYR.data;
      cur = -2; rows = []; times = [];
      tag.textContent = data && data.source === 'lrclib' ? 'LRCLIB' : (data && data.source === 'file' ? 'SONG FILE' : '');
      if (st === 'synced' && data.lines && data.lines.length) {
        mode = 'synced';
        lines.className = 'wl-lines';
        rows = data.lines.map(l => el('div', 'wl-line', l.text || '♪'));
        times = data.lines.map(l => l.t);
        lines.replaceChildren(...rows);
        body.hidden = false; msg.hidden = true;
        lines.style.transition = 'none'; center(-1); void lines.offsetWidth; lines.style.transition = '';
      } else if (st === 'plain' && data.plain) {
        mode = 'plain';
        lines.className = 'wl-lines plain';
        rows = data.plain.split('\n').map(t => el('div', 'wl-line', t.trim() || ' '));
        lines.replaceChildren(...rows);
        lines.style.transform = 'translateY(0)';
        body.hidden = false; msg.hidden = true;
      } else {
        mode = '';
        lines.replaceChildren();
        body.hidden = true; msg.hidden = false;
        msg.textContent = LYR_MSG[st] || LYR_MSG.none;
      }
    },
    frame(pos, dur) {
      if (mode === 'synced') {
        let i = -1;
        for (let k = 0; k < times.length; k++) { if (times[k] <= pos + 0.25) i = k; else break; }
        if (i !== cur) {
          if (cur >= 0 && rows[cur]) { rows[cur].classList.remove('on'); }
          for (let k = Math.max(0, Math.min(cur, i)); k < rows.length; k++) rows[k].classList.toggle('past', k < i);
          if (i >= 0) rows[i].classList.add('on');
          cur = i; center(i);
        }
      } else if (mode === 'plain' && dur > 0) {
        const extra = Math.max(0, lines.scrollHeight - body.clientHeight * 0.75);
        const p = Math.max(0, Math.min(1, (pos - 8) / Math.max(1, dur - 24)));
        lines.style.transform = `translateY(${(-extra * p).toFixed(1)}px)`;
      }
    },
    shown() { if (mode === 'synced') { lines.style.transition = 'none'; center(cur); void lines.offsetWidth; lines.style.transition = ''; } }
  };
}

function nowInfo() {
  const d = S.inserted ? disc() : null;
  if (!d) return null;
  const t = track();
  if (!t) return null;
  const art = d.kind === 'spotify' ? (SP.art || d.art || null) : (t.art || d.art || null);
  const src = d.kind === 'spotify' ? (SP.via === 'aqua' ? 'SPOTIFY · BUILT-IN' : 'SPOTIFY APP') : (d.kind === 'demo' ? 'DEMO DISC' : (t.ext || 'MP3'));
  return { title: t.title, artist: t.artist || '', album: t.album || (d.kind !== 'spotify' ? d.name : ''), art, src, duration: t.duration || 0 };
}
function wNow() {
  const { e, tag } = card('now', 'NOW PLAYING');
  const box = el('div', 'wn'), art = el('div', 'wn-art'), text = el('div', 'wn-text');
  const title = el('div', 'wn-title'), artist = el('div', 'wn-artist'), album = el('div', 'wn-album');
  const bar = el('div', 'wn-bar'), fill = el('div', 'wn-fill');
  bar.append(fill); text.append(title, artist, album, bar); box.append(art, text);
  const msg = el('div', 'w-msg', 'Nothing playing.');
  e.append(box, msg);
  let sig = '', lastArt = null;
  return { el: e,
    render() {
      const n = nowInfo();
      const s = n ? [n.title, n.artist, n.album, n.art, n.src].join('|') : '';
      if (s === sig) return;
      sig = s;
      box.hidden = !n; msg.hidden = !!n;
      if (!n) { tag.textContent = ''; return; }
      title.textContent = n.title; artist.textContent = n.artist; album.textContent = n.album; tag.textContent = n.src;
      if (n.art !== lastArt) {
        lastArt = n.art;
        art.style.backgroundImage = '';
        if (n.art) { const img = new Image(); img.onload = () => { if (lastArt === n.art) art.style.backgroundImage = `url("${n.art}")`; }; img.src = n.art; }
      }
    },
    frame(pos, dur) { fill.style.width = (dur > 0 ? Math.min(100, 100 * pos / dur) : 0) + '%'; }
  };
}

/* up next: local discs from the play order, Spotify from its queue */
const SPQ = { key: null, items: null, state: 'idle' };
let spqTimer = 0;
function refreshQueue() {
  if (!INST.some(w => w.type === 'next')) return;
  const d = S.inserted ? disc() : null;
  if (!d || d.kind !== 'spotify') return;
  const key = `${SP.trackId || ''}|${SP.shuffle}|${SP.via}`;
  if (key === SPQ.key) return;
  SPQ.key = key;
  if (!api || !ACCOUNT.linked || !SP.via) { SPQ.items = null; SPQ.state = ACCOUNT.linked ? 'idle' : 'unlinked'; renderNext(); return; }
  clearTimeout(spqTimer);
  SPQ.state = 'loading'; renderNext();
  spqTimer = setTimeout(async () => {
    const r = await api.spotify('queue');
    if (SPQ.key !== key) return;
    SPQ.items = r && r.ok ? r.items : null; SPQ.state = r && r.ok ? 'ok' : 'error';
    renderNext();
  }, 700);
}
function renderNext() { for (const w of INST) if (w.type === 'next') w.render(); }
function upNext() {
  if (!S.inserted || S.busy) return { msg: 'Put a disc in to see what’s next.' };
  const d = disc(); if (!d) return { msg: 'Put a disc in to see what’s next.' };
  if (d.kind === 'spotify') {
    if (SPQ.state === 'unlinked') return { msg: 'Connect Spotify in Settings to see the queue.' };
    if (SPQ.state === 'loading' && !SPQ.items) return { msg: 'Loading the queue…' };
    if (SPQ.items && SPQ.items.length) return { items: SPQ.items };
    return { msg: SP.via ? 'Nothing queued after this song.' : 'Start playing to see what’s next.' };
  }
  const items = [];
  const rep = repeatMode();
  if (rep === 'one') { const t = track(); return t ? { items: [Object.assign({ repeat: true }, t)] } : { msg: '' }; }
  for (let k = 1; k <= 6; k++) {
    let op = S.op + k;
    if (op >= S.order.length) { if (rep === 'off') break; op %= S.order.length; }
    const t = d.tracks[S.order[op]];
    if (!t || items.length >= d.tracks.length - 1) break;
    items.push({ title: t.title, artist: t.artist || '', art: t.art || d.art || null });
  }
  return items.length ? { items } : { msg: 'This is the last song on the disc.' };
}
function wNext() {
  const { e, tag } = card('next', 'UP NEXT');
  const list = el('div', 'wu-list'), msg = el('div', 'w-msg');
  e.append(list, msg);
  let sig = '';
  return { el: e,
    render() {
      const r = upNext();
      const s = JSON.stringify(r);
      if (s === sig) return;
      sig = s;
      list.hidden = !r.items; msg.hidden = !!r.items;
      tag.textContent = r.items && shuffleOn() ? 'SHUFFLE' : '';
      if (!r.items) { msg.textContent = r.msg; return; }
      list.replaceChildren(...r.items.map((t, i) => {
        const row = el('div', 'wu-row');
        const art = el('span', 'wu-art');
        if (t.art) art.style.backgroundImage = `url("${t.art}")`;
        const tx = el('span', 'wu-text');
        tx.append(el('span', 'wu-t', t.title), el('span', 'wu-a', t.repeat ? 'Plays again (loop song)' : t.artist));
        row.append(el('span', 'wu-n', String(i + 1)), art, tx);
        return row;
      }));
    }
  };
}

/* system */
let sysTimer = 0, lastSys = null;
async function pollSystem() {
  clearTimeout(sysTimer);
  if (!INST.some(w => w.type === 'system')) return;
  if (api) { try { lastSys = await api.sysStats(); } catch (e) { lastSys = null; } }
  for (const w of INST) if (w.sys) w.sys(lastSys);
  sysTimer = setTimeout(pollSystem, 2000);
}
function wSystem(size) {
  const { e, tag } = card('system', 'SYSTEM');
  const box = el('div', 'ws');
  const SEG = size === 'S' ? 16 : 20;
  const mk = name => {
    const row = el('div', 'ws-row'), bar = el('div', 'ws-bar');
    for (let i = 0; i < SEG; i++) bar.append(el('i'));
    const val = el('div', 'ws-val', '--'), temp = el('div', 'ws-temp', '');
    row.append(el('div', 'ws-name', name), bar, val, temp);
    box.append(row);
    return { row, segs: [...bar.children], val, temp };
  };
  const R = { cpu: mk('CPU'), gpu: mk('GPU'), ram: mk('RAM') };
  e.append(box);
  const setBar = (r, pct) => {
    const n = pct == null ? 0 : Math.round(pct / 100 * SEG);
    r.segs.forEach((s, i) => { s.classList.toggle('on', i < n); s.classList.toggle('hot', i >= SEG - 4); });
  };
  const deg = t => (t == null ? '' : Math.round(t) + '°');
  if (!api || PLATFORM === 'android' || PLATFORM === 'web') tag.textContent = 'DESKTOP APP ONLY';
  return { el: e, sys(st) {
    if (!st) return;
    setBar(R.cpu, st.cpu); R.cpu.val.textContent = st.cpu == null ? '--' : Math.round(st.cpu) + '%'; R.cpu.temp.textContent = deg(st.cpuTemp);
    R.gpu.row.classList.toggle('na', !st.gpu);
    setBar(R.gpu, st.gpu && st.gpu.util); R.gpu.val.textContent = st.gpu && st.gpu.util != null ? Math.round(st.gpu.util) + '%' : '--'; R.gpu.temp.textContent = deg(st.gpu && st.gpu.temp);
    const used = st.mem.used / 1073741824, totalG = st.mem.total / 1073741824;
    setBar(R.ram, 100 * st.mem.used / st.mem.total);
    R.ram.val.innerHTML = '';
    R.ram.val.append(document.createTextNode(used.toFixed(1)), el('small', '', ` / ${Math.round(totalG)} GB`));
    R.ram.temp.textContent = '';
  } };
}

function wCalendar(size) {
  const { e, tag } = card('calendar', 'CALENDAR');
  const grid = el('div', size === 'S' ? 'wc-week' : 'wc-grid');
  e.append(grid);
  let day = '';
  return { el: e, tick(d) {
    const key = d.toDateString();
    if (key === day) return;
    day = key;
    tag.textContent = `${MONTHS[d.getMonth()].toUpperCase()} ${d.getFullYear()}`;
    const cells = [];
    if (size === 'S') {
      const start = new Date(d); start.setDate(d.getDate() - d.getDay());
      for (let i = 0; i < 7; i++) {
        const x = new Date(start); x.setDate(start.getDate() + i);
        const c = el('div', 'wc-wd' + (x.toDateString() === key ? ' today' : ''));
        c.append(el('small', '', DAYS[x.getDay()].toUpperCase()), el('b', '', String(x.getDate())));
        cells.push(c);
      }
    } else {
      DAYS.forEach(n => cells.push(el('div', 'wc-dn', n.slice(0, 2).toUpperCase())));
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      const start = new Date(first); start.setDate(1 - first.getDay());
      const weeks = Math.ceil((first.getDay() + new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()) / 7);
      for (let i = 0; i < weeks * 7; i++) {
        const x = new Date(start); x.setDate(start.getDate() + i);
        cells.push(el('div', 'wc-d' + (x.getMonth() !== d.getMonth() ? ' other' : '') + (x.toDateString() === key ? ' today' : ''), String(x.getDate())));
      }
    }
    grid.replaceChildren(...cells);
  } };
}

// Called from render() and the frame loop.
function renderWidgets() {
  refreshLyrics(); refreshQueue();
  for (const w of INST) if (w.render) w.render();
}
function frameWidgets(pos, dur) {
  for (const w of INST) if (w.frame && w.page === curPage) w.frame(pos, dur);
}

/* ----- settings: side widget editor ----- */
const wEdit = $('wEdit');
function previewBlocks(list) {
  const box = el('span', 'wprev');
  const H = GEO.pageH;
  const cols = columnsFor(list.slice(0, Math.max(1, GEO.cap)));
  const cw = 56 / cols.length;
  cols.forEach((colList, ci) => {
    const lay = layoutPage(colList, H);
    const hasFill = lay.some(w => WIDGETS[w.type].fill);
    const sum = lay.reduce((a, w) => a + w.h, 0);
    let y = !hasFill && lay.length === 1 ? (H - sum) / 2 : 0;
    const gap = !hasFill && lay.length > 1 ? (H - sum) / (lay.length - 1) : WGAP;
    for (const w of lay) {
      const b = el('i');
      b.style.left = (4 + ci * cw) + 'px'; b.style.right = 'auto'; b.style.width = (cw - 3) + 'px';
      b.style.top = (4 + (y / H) * 40) + 'px';
      b.style.height = Math.max(3, (w.h / H) * 40) + 'px';
      box.append(b);
      y += w.h + gap;
    }
  });
  return box;
}
function renderWidgetEditor() {
  const kids = [];
  kids.push(el('p', 'cap-note', `At this window size: ${GEO.cols} ${GEO.cols === 1 ? 'column' : 'columns'}, up to ${GEO.cap} widgets per page.`));
  const iv = el('div', 'seg-row');
  iv.append(el('span', '', 'Switch pages every'));
  for (const [n, label] of INTERVALS) iv.append(btn('seg' + (SIDE.interval === n ? ' on' : ''), label, { act: 'interval', v: n }));
  kids.push(iv);
  SIDE.pages.forEach((list, pi) => {
    const c = el('div', 'wpc');
    const head = el('div', 'wpc-head');
    head.append(previewBlocks(list), el('span', 'wpc-title', `PAGE ${pi + 1}`));
    if (SIDE.pages.length > 1) head.append(btn('seg', 'Remove page', { act: 'delpage', p: pi }));
    c.append(head);
    list.forEach((w, wi) => {
      const row = el('div', 'wpc-row');
      row.append(el('span', 'wpc-name', WIDGETS[w.type].name));
      if (WIDGETS[w.type].sizes) {
        row.append(btn('seg' + (w.size === 'L' ? ' on' : ''), 'Big', { act: 'size', p: pi, w: wi, v: 'L' }),
          btn('seg' + (w.size === 'S' ? ' on' : ''), 'Small', { act: 'size', p: pi, w: wi, v: 'S' }));
      }
      const up = btn('seg ibtn', '↑', { act: 'move', p: pi, w: wi, v: -1 }); up.disabled = wi === 0; up.setAttribute('aria-label', 'Move up');
      const dn = btn('seg ibtn', '↓', { act: 'move', p: pi, w: wi, v: 1 }); dn.disabled = wi === list.length - 1; dn.setAttribute('aria-label', 'Move down');
      const rm = btn('seg ibtn', '✕', { act: 'remove', p: pi, w: wi }); rm.setAttribute('aria-label', `Remove ${WIDGETS[w.type].name}`);
      rm.disabled = SIDE.pages.length === 1 && list.length === 1;
      row.append(up, dn, rm);
      c.append(row);
    });
    const cap = Math.max(1, GEO.cap);
    if (list.length > cap) c.append(el('p', 'cap-note', `At this window size this page shows as ${Math.ceil(list.length / cap)} pages. Make the window bigger to fit it on one.`));
    if (list.length < Math.min(cap, MAX_PER_PAGE)) {
      const add = el('div', 'wadd');
      for (const t of WTYPES) if (t !== 'system' || !(PLATFORM === 'android' || PLATFORM === 'web')) add.append(btn('seg', '+ ' + WIDGETS[t].name, { act: 'add', p: pi, type: t }));
      c.append(add);
    } else if (list.length >= cap) c.append(el('p', 'cap-note', `This window fits ${cap} ${cap === 1 ? 'widget' : 'widgets'} per page. Make it bigger for more, or add another page.`));
    kids.push(c);
  });
  const foot = el('div', 'set-row');
  if (SIDE.pages.length < MAX_PAGES) foot.append(btn('sbtn', 'Add a page', { act: 'addpage' }));
  foot.append(btn('sbtn', 'Back to Clock + Weather', { act: 'reset' }));
  kids.push(foot);
  wEdit.replaceChildren(...kids);
}
wEdit.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const p = Number(b.dataset.p), w = Number(b.dataset.w), a = b.dataset.act;
  const pages = SIDE.pages;
  if (a === 'interval') SIDE.interval = Number(b.dataset.v);
  else if (a === 'size') pages[p][w].size = b.dataset.v;
  else if (a === 'move') { const j = w + Number(b.dataset.v); [pages[p][w], pages[p][j]] = [pages[p][j], pages[p][w]]; }
  else if (a === 'remove') { pages[p].splice(w, 1); if (!pages[p].length) pages.splice(p, 1); }
  else if (a === 'add') pages[p].push({ type: b.dataset.type, size: pages[p].length >= GEO.perCol - 1 && GEO.perCol <= 3 ? 'S' : 'L' });
  else if (a === 'delpage') pages.splice(p, 1);
  else if (a === 'addpage') { pages.push([{ type: 'lyrics', size: 'L' }]); curPage = shownPages().length; lastManual = Date.now(); }
  else if (a === 'reset') { SIDE = DEFAULT_SIDE(); curPage = 0; }
  saveSide();
});

/* ---------- side panels (settings, playlists) ---------- */
const settingsEl = $('settings'), plPanel = $('playlists'), s1 = $('s1');
const PANELS = { settings: settingsEl, playlists: plPanel };
let openName = null;
function openPanel(name) {
  const p = PANELS[name]; if (!p) return;
  if (openName && openName !== name) { const old = PANELS[openName]; old.classList.remove('open'); old.hidden = true; }
  openName = name;
  if (name === 'settings') { renderWidgetEditor(); renderDiscList(); updateScreenNote(); renderAccount(); $('wxPlace').textContent = wxLoc.name; }
  if (name === 'playlists') { renderPlaylists(); if (ACCOUNT.linked && (!PLAYLISTS || Date.now() - PL_AT > 5 * 60e3)) loadPlaylists(false); }
  s1.classList.add('away');
  p.hidden = false;
  requestAnimationFrame(() => p.classList.add('open'));
}
function closePanel() {
  const name = openName; if (!name) return;
  const p = PANELS[name];
  openName = null;
  p.classList.remove('open');
  s1.classList.remove('away');
  setTimeout(() => { if (!p.classList.contains('open')) p.hidden = true; }, 420);
}
$('gearBtn').addEventListener('click', () => openName === 'settings' ? closePanel() : openPanel('settings'));
$('plBtn').addEventListener('click', () => openName === 'playlists' ? closePanel() : openPanel('playlists'));
$('setDone').addEventListener('click', closePanel);
$('plDone').addEventListener('click', closePanel);
$('plRefresh').addEventListener('click', () => loadPlaylists(true));

/* ---------- playlists panel ---------- */
const plBody = $('plBody');
let openSwatch = null;
async function loadPlaylists(refresh) {
  if (!api || !ACCOUNT.linked) { renderPlaylists(); return; }
  PL_STATE = 'loading'; renderPlaylists();
  const r = await api.spotify('playlists', { refresh: !!refresh });
  if (r && r.ok) {
    PLAYLISTS = r.items || []; PL_STATE = 'idle'; PL_AT = Date.now();
    // Keep recent discs in step with renamed playlists and new covers.
    let changed = false;
    RECENTS = RECENTS.map(p => { const f = PLAYLISTS.find(x => x.id === p.id); if (f && (f.name !== p.name || f.image !== p.image || f.total !== p.total)) { changed = true; return f; } return p; });
    if (changed && api) { api.set('recentPlaylists', RECENTS); rackSig = ''; }
  } else {
    PL_STATE = 'error';
    PL_ERR = r && r.status === 403 ? 'Spotify refused the request. Make sure this Spotify account is the one that made the developer app.' : 'Could not load your playlists. Check your internet connection.';
  }
  renderPlaylists(); render();
}
function plMessage(html, buttons) {
  const box = el('div', 'pl-msg');
  const p = el('p'); p.innerHTML = html; box.append(p);
  if (buttons) { const row = el('div', 'set-row'); row.append(...buttons); box.append(row); }
  return box;
}
function renderPlaylists() {
  if (!ACCOUNT.linked) {
    plBody.replaceChildren(plMessage('<b>Connect Spotify to see your playlists here.</b><br>It’s a one-time setup in Settings and takes about two minutes.',
      [btn('sbtn primary', 'Open Settings', { act: 'settings' })]));
    return;
  }
  if (!PLAYLISTS) {
    plBody.replaceChildren(PL_STATE === 'error'
      ? plMessage(PL_ERR, [btn('sbtn', 'Try again', { act: 'reload' })])
      : plMessage('Loading your playlists…'));
    return;
  }
  if (!PLAYLISTS.length) { plBody.replaceChildren(plMessage('<b>No playlists yet.</b><br>Make one in Spotify, then press Refresh.')); return; }
  const keep = plBody.scrollTop;
  const rows = PLAYLISTS.map(p => {
    const id = 'pl:' + p.id;
    const row = el('div', 'pl-row');
    row.dataset.id = id;
    row.style.setProperty('--dh', hueOf(id));
    const main = btn('pl-main', null, { act: 'play', pid: p.id });
    const cover = el('span', 'pl-cover');
    if (p.image) cover.style.backgroundImage = `url("${p.image}"), var(--gen)`;
    const text = el('span', 'pl-text');
    const meta = [p.total != null ? plural(p.total) : null, p.owner && p.owner !== ACCOUNT.name ? `by ${p.owner}` : null].filter(Boolean).join(' · ');
    text.append(el('span', 'pl-name', p.name), el('span', 'pl-meta', meta || 'Playlist'));
    main.append(cover, text);
    const cbtn = btn('pl-color', null, { act: 'swatch', id });
    cbtn.setAttribute('aria-label', `Colour: ${COLORS[colorName(id)].name}`);
    cbtn.append(miniFor('', null, id));
    const sbtn = btn('pl-shuf', null, { act: 'shuffle', pid: p.id });
    sbtn.setAttribute('aria-label', `Shuffle play ${p.name}`);
    sbtn.title = 'Shuffle play';
    sbtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3.5h4.5V8"/><path d="M3.5 20 20.5 3.5"/><path d="M20.5 16v4.5H16"/><path d="M14.5 14.5l6 6"/><path d="M3.5 4l5.5 5.5"/></svg>';
    row.append(main, sbtn, cbtn);
    if (openSwatch === id) row.append(swatchRow(id));
    return row;
  });
  plBody.replaceChildren(...rows);
  plBody.scrollTop = keep;
  markActivePlaylist();
}
function markActivePlaylist() {
  const d = disc();
  const activeId = S.inserted && d ? (d.playlist ? d.id : (d.id === 'spotify' && playlistByUri(SP.contextUri) ? 'pl:' + playlistByUri(SP.contextUri).id : '')) : '';
  plBody.querySelectorAll('.pl-row').forEach(r => r.classList.toggle('active', r.dataset.id === activeId));
}
plBody.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'settings') openPanel('settings');
  else if (act === 'reload') loadPlaylists(true);
  else if (act === 'swatch') { openSwatch = openSwatch === b.dataset.id ? null : b.dataset.id; renderPlaylists(); }
  else if (act === 'color') { setColor(b.dataset.id, b.dataset.color); }
  else if (act === 'play' || act === 'shuffle') {
    const p = (PLAYLISTS || []).find(x => x.id === b.dataset.pid); if (!p) return;
    const d = plDisc(p);
    const shuffle = act === 'shuffle';
    // On a phone the list covers the deck, so get out of the way once a playlist is picked.
    if (LAYOUT === 'tall' || LAYOUT === 'compact') closePanel();
    if (S.inserted && S.discId === d.id && !S.busy) {
      if (shuffle) playPlaylist(d, { shuffle: true });
      else if (S.playing) pause(); else play();
      return;
    }
    loadDisc(d.id, false, { shuffle });
  }
});

/* ---------- settings panel ---------- */
const optLogin = $('optLogin'), optMenu = $('optMenu'), optTop = $('optTop'), intNote = $('intNote');
let APPIMAGE = false, DISPLAY = null;
$('quitBtn').addEventListener('click', () => { if (api) api.quit(); });
$('addFolder').addEventListener('click', () => addMusic('folder'));
$('addSongs').addEventListener('click', () => addMusic('files'));
$('scrNext').addEventListener('click', async () => { if (!api) return; const info = await api.nextScreen(); if (info) { DISPLAY = info; updateScreenNote(); } });
$('wxForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('wxQuery').value.trim();
  const box = $('wxResults');
  if (!q) return;
  box.replaceChildren(el('p', 'set-note small', 'Searching'));
  try {
    const found = await searchCity(q);
    if (!found.length) { box.replaceChildren(el('p', 'set-note small', `No places found for "${q}"`)); return; }
    box.replaceChildren(...found.map(f => {
      const b = btn('sbtn result', f.name);
      b.addEventListener('click', () => {
        wxLoc = f;
        if (api) api.set('weather', f);
        $('wxPlace').textContent = f.name;
        $('wxQuery').value = '';
        box.replaceChildren();
        markWeatherLoading();
        loadWeather();
      });
      return b;
    }));
  } catch (err) { box.replaceChildren(el('p', 'set-note small', 'Could not reach the weather service. Check your internet connection.')); }
});
function integrationNote(r) {
  intNote.hidden = !!(r && r.appImage);
  intNote.textContent = 'These take effect when Aqua MD runs from its AppImage file.';
}
optLogin.addEventListener('change', async () => { if (api) integrationNote(await api.set('startOnLogin', optLogin.checked)); });
optMenu.addEventListener('change', async () => { if (api) integrationNote(await api.set('appMenu', optMenu.checked)); });
optTop.addEventListener('change', () => { if (api) api.set('onTop', optTop.checked); });
const optAwake = $('optAwake');
optAwake.addEventListener('change', () => { if (api && api.setKeepAwake) api.setKeepAwake(optAwake.checked); });
// Hide the settings this platform can't use.
function applyFeatures() {
  const hide = (node, yes) => { if (node) node.hidden = !!yes; };
  hide(optLogin.closest('.set-group'), !FEAT.startup);
  hide($('quitBtn'), !FEAT.quit);
  hide($('scrNext').closest('.set-row'), !FEAT.screens);
  hide(optTop.closest('.toggle'), !FEAT.onTop);
  hide(optAwake.closest('.toggle'), !FEAT.keepAwake);
  hide($('addFolder'), !FEAT.folders);
  hide(winMode, !FEAT.fullscreen);
  if (PLATFORM === 'android') {
    const w = winMode.querySelector('[data-mode="window"]'); if (w) w.textContent = 'With status bar';
    const lab = winMode.querySelector('span'); if (lab) lab.textContent = 'Show Aqua MD';
  }
  rackSig = '';
}
const winMode = $('winMode');
function paintWinMode() {
  const mode = DISPLAY ? (DISPLAY.fullscreen ? 'full' : 'window') : 'full';
  winMode.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
}
winMode.addEventListener('click', async e => {
  const b = e.target.closest('[data-mode]'); if (!b || !api) return;
  winMode.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('on', x === b));
  const info = await api.setWindowMode(b.dataset.mode);
  if (info) { DISPLAY = info; updateScreenNote(); }
});
function updateScreenNote() {
  paintWinMode();
  const n = $('scrInfo');
  if (!DISPLAY) { n.textContent = 'Screen info unavailable'; return; }
  n.textContent = `${DISPLAY.label}${DISPLAY.edge ? ' · Xeneon Edge' : ''} · screen ${DISPLAY.index + 1} of ${DISPLAY.count}`;
  $('scrNext').disabled = DISPLAY.count < 2;
}

let discSwatch = null;
function renderDiscList() {
  const list = $('discList');
  const rows = [];
  const entry = (id, name, count, removable) => {
    const li = el('li');
    const sw = btn('sbtn small sw-btn', null, { act: 'swatch', id });
    sw.setAttribute('aria-label', `Colour for ${name}: ${COLORS[colorName(id)].name}`);
    sw.append(miniFor('', null, id));
    li.append(sw, el('span', 'dn', name), el('span', 'dc', count));
    if (removable) li.append(btn('sbtn small', 'Remove', { act: 'remove', id }));
    if (discSwatch === id) li.append(swatchRow(id));
    return li;
  };
  rows.push(entry('spotify', 'Spotify (now playing)', 'Spotify', false));
  for (const d of FILES) rows.push(entry(d.id, d.name, plural(d.tracks.length), true));
  rows.push(entry('demo', DEMO.name, plural(DEMO.tracks.length), false));
  if (!FILES.length) rows.push(el('li', 'empty', 'Add a folder, add songs, or drop files on the deck. Each album becomes a disc.'));
  list.replaceChildren(...rows);
}
$('discList').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'swatch') { discSwatch = discSwatch === b.dataset.id ? null : b.dataset.id; renderDiscList(); }
  else if (b.dataset.act === 'color') setColor(b.dataset.id, b.dataset.color);
  else if (b.dataset.act === 'remove') {
    if (!b.dataset.armed) {
      b.dataset.armed = '1'; b.textContent = 'Tap again to remove';
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Remove'; } }, 3000);
      return;
    }
    await removeDisc(b.dataset.id);
  }
});
async function removeDisc(id) {
  if (!api) return;
  if (S.discId === id && S.inserted) { await eject(); }
  FILES = await api.removeDisc(id);
  if (S.discId === id) { S.discId = 'demo'; S.ti = 0; S.pos = 0; }
  rackSig = ''; renderDiscList(); render();
}

/* ---------- settings: Spotify account ---------- */
const spBox = $('spBox');
let clientDraft = '', accountMsg = '';
function statusLine(kind, text) {
  const row = el('div', 'status-line');
  row.append(el('span', 'status-dot ' + kind), el('span', '', text));
  return row;
}
const ENGINE_TEXT = {
  widevine: 'Spotify’s copy protection (Widevine) couldn’t be set up. Check your internet connection, then press Try again.',
  account_error: 'Spotify says this account can’t use the built-in player. It needs Spotify Premium.',
  authentication_error: 'Spotify turned down the login. Press Log out, then log in again.',
  initialization_error: 'Spotify’s player couldn’t start on this computer.',
  load: 'Couldn’t download Spotify’s player. Check your internet connection, then press Try again.',
  crash: 'The built-in player stopped. Press Try again.'
};
function renderAccount() {
  if (!spBox) return;
  const A = ACCOUNT, kids = [];
  const phone = (A.engine && A.engine.status) === 'unsupported';
  if (!A.configured) {
    kids.push(el('p', 'set-note', phone
      ? 'See your Spotify playlists here and control the music. On this phone it plays through the Spotify app. One-time setup, about two minutes:'
      : 'Play Spotify right inside Aqua MD, no Spotify app needed. One-time setup, about two minutes:'));
    const ol = el('ol', 'steps');
    const li = html => { const x = el('li'); x.innerHTML = html; ol.append(x); return x; };
    const l1 = li('Open the Spotify developer dashboard and log in with your Spotify account.');
    const r1 = el('div', 'set-row'); r1.append(btn('sbtn small', 'Open dashboard', { act: 'dashboard' })); l1.append(r1);
    const inBrowser = A.platform === 'web';
    li(phone ? 'Already made an <b>Aqua MD</b> app there on your computer? Open it and skip to step 5: it works on your phone too. If not, click <b>Create app</b> and name it <b>Aqua MD</b>.'
      : inBrowser ? 'Already made an <b>Aqua MD</b> app there for the desktop version? Open it and click <b>Edit</b>. If not, click <b>Create app</b> and name it <b>Aqua MD</b>.'
      : 'Click <b>Create app</b>. Name it <b>Aqua MD</b>, and type anything as the description.');
    const l3 = li(phone ? 'Under <b>Redirect URIs</b>, paste this and click <b>Add</b> (it’s the same one the computer version uses):'
      : inBrowser ? 'Under <b>Redirect URIs</b>, paste this and click <b>Add</b> (keep any address that’s already there):' : 'Under <b>Redirect URIs</b>, paste this and click <b>Add</b>:');
    const cb = el('div', 'codebox'); cb.append(el('code', '', A.redirectUri), btn('sbtn small', 'Copy', { act: 'copy' })); l3.append(cb);
    li(phone ? 'Make sure <b>Web API</b> is ticked, then click <b>Save</b>.' : 'Tick <b>Web API</b> and <b>Web Playback SDK</b>, agree to the terms, and click <b>Save</b>.');
    li('Copy the <b>Client ID</b> from the app’s page and paste it here:');
    kids.push(ol);
    const form = el('form', 'set-row'); form.id = 'spForm';
    const inp = el('input'); inp.id = 'spClient'; inp.type = 'text'; inp.placeholder = 'Client ID'; inp.autocomplete = 'off'; inp.spellcheck = false; inp.value = clientDraft;
    form.append(inp, Object.assign(btn('sbtn primary', 'Save'), { type: 'submit' }));
    kids.push(form);
  } else if (!A.linked) {
    kids.push(statusLine('', `Client ID saved (${A.clientIdHint}).`));
    kids.push(el('p', 'set-note small', phone
      ? (A.loggingIn ? 'Finish logging in in your browser, then tap “Back to Aqua MD”.' : 'Press Log in. Your browser opens; log in to Spotify, tap Agree, then tap “Back to Aqua MD”.')
      : A.platform === 'web' ? 'Press Log in. Spotify opens in this tab; log in, click Agree, and you’ll come straight back here.'
      : (A.loggingIn ? 'Finish logging in in your browser, then come back here.' : 'Press Log in. A browser tab opens; log in to Spotify, click Agree, and come back.')));
    const row = el('div', 'set-row');
    row.append(btn('sbtn primary', A.loggingIn ? 'Open login again' : 'Log in with Spotify', { act: 'login' }), btn('sbtn', 'Change Client ID', { act: 'forget' }));
    kids.push(row);
    // Spotify only sends you back to addresses saved in your developer app. Each kind of Aqua MD uses one, so
    // keep it in sight here: reusing a Client ID from another device skips the setup steps that show it.
    kids.push(el('p', 'set-note small', 'If Spotify says “redirect_uri: Not matching configuration”, add this under Redirect URIs in your app on the Spotify dashboard, click Save, and log in again:'));
    const rb = el('div', 'codebox'); rb.append(el('code', '', A.redirectUri), btn('sbtn small', 'Copy', { act: 'copy' }));
    kids.push(rb);
  } else {
    kids.push(statusLine('ok', `Connected${A.name ? ' as ' + A.name : ''}.`));
    const eng = A.engine || { status: 'off' };
    if (phone) {
      kids.push(statusLine(A.appOpen ? 'ok' : '', A.appOpen
        ? `Following Spotify on ${A.deviceName || 'your phone'}. The deck controls it.`
        : 'Music plays through the Spotify app. Pick a playlist and Aqua MD opens Spotify for you.'));
      const prow = el('div', 'set-row');
      prow.append(btn('sbtn', 'Playlists', { act: 'playlists' }), btn('sbtn', 'Log out', { act: 'logout' }));
      kids.push(prow);
      if (A.error || accountMsg) kids.push(el('p', 'set-note small', A.error || accountMsg));
      spBox.replaceChildren(...kids);
      return;
    }
    if (eng.status === 'ready') kids.push(statusLine('ok', 'Built-in player ready. Aqua MD also shows up as a speaker in Spotify on your phone.'));
    else if (eng.status === 'starting') kids.push(statusLine('warn', 'Starting the built-in player. The first start can take a minute while Spotify’s copy protection downloads.'));
    else if (eng.status === 'error') {
      const e = eng.error || {};
      kids.push(statusLine('bad', ENGINE_TEXT[e.type] || (e.message ? `Built-in player problem: ${e.message}` : 'The built-in player isn’t working.')));
    } else kids.push(statusLine('warn', 'Built-in player is off.'));
    kids.push(statusLine(A.appOpen ? 'ok' : '', A.appOpen ? 'Spotify app is open. The deck can control it too.' : 'Spotify app isn’t open (not needed).'));
    const row = el('div', 'set-row');
    if (eng.status === 'error' || eng.status === 'off') row.append(btn('sbtn', 'Try again', { act: 'restart' }));
    row.append(btn('sbtn', 'Playlists', { act: 'playlists' }), btn('sbtn', 'Log out', { act: 'logout' }));
    kids.push(row);
  }
  if (A.error || accountMsg) kids.push(el('p', 'set-note small', A.error || accountMsg));
  spBox.replaceChildren(...kids);
}
spBox.addEventListener('input', e => { if (e.target.id === 'spClient') clientDraft = e.target.value; });
spBox.addEventListener('submit', async e => {
  e.preventDefault();
  if (!api) return;
  const r = await api.spotifySetClientId(clientDraft);
  accountMsg = r && r.ok ? '' : ((r && r.error) || 'That Client ID didn’t work.');
  if (r && r.ok) clientDraft = '';
  renderAccount();
});
spBox.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b || !api) return;
  const act = b.dataset.act;
  accountMsg = '';
  if (act === 'dashboard') api.openDashboard();
  else if (act === 'copy') { await api.copy(ACCOUNT.redirectUri); b.textContent = 'Copied'; setTimeout(() => { if (b.isConnected) b.textContent = 'Copy'; }, 1600); }
  else if (act === 'login') { const r = await api.spotifyLogin(); if (!r || !r.ok) { accountMsg = (r && r.error) || 'Could not start the login.'; renderAccount(); } }
  else if (act === 'forget') { await api.spotifyForgetClientId(); }
  else if (act === 'logout') {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to log out'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Log out'; } }, 3000); return; }
    await api.spotifyLogout(); PLAYLISTS = null;
  }
  else if (act === 'restart') api.spotifyRestart();
  else if (act === 'playlists') openPanel('playlists');
});

/* ---------- meters ---------- */
const SEGS = 30;
function buildSegs(host) { for (let i = 0; i < SEGS; i++) { const s = el('i'); if (i >= SEGS - 6) s.className = 'hot'; host.append(s); } return [...host.children]; }
const segsL = buildSegs($('segL')), segsR = buildSegs($('segR'));
const meter = { L: { lv: 0, pk: 0, hold: 0, n: -1, p: -1 }, R: { lv: 0, pk: 0, hold: 0, n: -1, p: -1 } };
const tbuf = new Float32Array(1024);
function level(an) {
  an.getFloatTimeDomainData(tbuf);
  let s = 0; for (let i = 0; i < tbuf.length; i++) s += tbuf[i] * tbuf[i];
  const db = 20 * Math.log10(Math.sqrt(s / tbuf.length) + 1e-8);
  return Math.max(0, Math.min(1, (db + 46) / 42));
}
// Spotify's audio is protected, so its meters follow a gentle pattern instead of the real signal.
function spotLevel(ch, t) {
  const v = 0.44 + 0.2 * Math.sin(t * 2.1 + ch * 1.3) * Math.sin(t * 0.7 + ch) + 0.16 * Math.abs(Math.sin(t * 7.3 + ch * 2.1)) + (Math.random() - 0.5) * 0.1;
  return Math.max(0, Math.min(1, v * (0.6 + 0.4 * Math.min(1, S.vol / 21))));
}
function updMeter(m, segs, target, dt) {
  m.lv += (target - m.lv) * Math.min(1, dt * (target > m.lv ? 28 : 6));
  if (m.lv >= m.pk) { m.pk = m.lv; m.hold = 0.6; }
  else { m.hold -= dt; if (m.hold <= 0) m.pk = Math.max(m.lv, m.pk - dt * 0.6); }
  const n = Math.round(m.lv * SEGS);
  if (n !== m.n) { for (let i = 0; i < SEGS; i++) segs[i].classList.toggle('on', i < n); m.n = n; }
  const p = m.pk > 0.04 ? Math.min(SEGS - 1, Math.round(m.pk * SEGS) - 1) : -1;
  if (p !== m.p) { if (m.p >= 0) segs[m.p].classList.remove('pk'); if (p >= 0) segs[p].classList.add('pk'); m.p = p; }
}

/* ---------- frame loop: spin, time, meters ---------- */
const discEl = $('disc'), timeEl = $('time'), elEl = $('el'), remEl = $('rem');
const SPIN = REDUCED ? 90 : 420;
let lastT = performance.now(), ang = 0, vel = 0, lastSec = -1, lastDur = -1;
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  vel += ((S.playing ? 1 : 0) - vel) * Math.min(1, dt * (S.playing ? 1.8 : 1.2));
  if (!S.playing && vel < 0.002) vel = 0;
  ang = (ang + vel * SPIN * dt) % 360;
  discEl.style.transform = `rotate(${ang.toFixed(2)}deg)`;

  const t = S.inserted ? track() : null;
  let pos = S.drag != null ? S.drag : currentPos();
  if (S.playing && t && t.synth && synth.active && pos >= t.duration - 0.02) { onTrackEnd(); pos = currentPos(); }
  const dur = t ? (t.duration || 0) : 0;
  const sec = Math.floor(pos);
  if (sec !== lastSec || dur !== lastDur) {
    lastSec = sec; lastDur = dur;
    elEl.textContent = fmt(pos);
    remEl.textContent = '-' + fmt(Math.max(0, dur - pos));
    timeEl.textContent = fmtLcd(pos);
    ptrack.setAttribute('aria-valuetext', `${fmt(pos)} of ${fmt(dur)}`);
  }
  const r = dur > 0 ? Math.min(1, pos / dur) : 0;
  pfill.style.width = (r * 100) + '%';
  pknob.style.left = (r * 100) + '%';
  frameWidgets(pos, dur);

  let lt = 0, rt = 0;
  if (S.playing && S.inserted) {
    if (isSpot()) { const s = now / 1000; lt = spotLevel(0, s); rt = spotLevel(1, s); }
    else if (ctx && anL) { lt = level(anL); rt = level(anR); }
  }
  updMeter(meter.L, segsL, lt, dt);
  updMeter(meter.R, segsR, rt, dt);
  requestAnimationFrame(frame);
}

/* ---------- Spotify updates from the main process ---------- */
function onSpotifyState(s) {
  const prevVia = SP.via;
  const before = `${SP.trackId}|${SP.title}`;
  const wasAvailable = SP.available;
  SP = s || { available: false, via: null };
  if (SP.via === 'aqua' && prevVia !== 'aqua') spotify('volume', spotifyVol());
  if (isSpot() && S.inserted && !S.busy) {
    if (!SP.available) {
      S.playing = false;
      if (wasAvailable) setMode('msg', 'SPOTIFY GONE', 'The Spotify player closed', 4000);
    } else {
      S.playing = SP.status === 'Playing';
      if (`${SP.trackId}|${SP.title}` !== before && L.mode === 'track') trackText();
    }
  }
  render();
}
function onAccount(a) {
  const wasLinked = ACCOUNT.linked;
  ACCOUNT = Object.assign({}, ACCOUNT, a || {});
  if (!ACCOUNT.linked) PLAYLISTS = null;
  if (ACCOUNT.linked && !wasLinked) { PLAYLISTS = null; if (openName === 'playlists') loadPlaylists(true); }
  if (openName === 'settings') renderAccount();
  if (openName === 'playlists') renderPlaylists();
  rackSig = '';
  render();
}
if (api) {
  api.onSpotify(onSpotifyState);
  api.onSpotifyAccount(onAccount);
  api.onSpotifyNotice(n => setMode('msg', 'SPOTIFY', (n && n.text) || '', 2600));
  api.onDisplay(info => { if (info) { DISPLAY = info; if (openName === 'settings') updateScreenNote(); } });
}

/* ---------- start ---------- */
async function init() {
  tick(); setInterval(tick, 250);
  let data = null;
  if (api) { try { data = await api.init(); } catch (e) { data = null; } }
  if (data) {
    const st = data.settings || {};
    FILES = data.discs || [];
    if (st.weather && typeof st.weather.lat === 'number') wxLoc = st.weather;
    S.shuffle = !!st.shuffle;
    S.repeat = REP_NEXT[st.repeat] ? st.repeat : 'off';
    S.vol = typeof st.volume === 'number' ? Math.max(0, Math.min(30, Math.round(st.volume))) : 21;
    COLOR_MAP = st.colors && typeof st.colors === 'object' ? st.colors : {};
    SIDE = normSide(st.widgets);
    RECENTS = Array.isArray(st.recentPlaylists) ? st.recentPlaylists.filter(p => p && p.id && p.uri) : [];
    SP = data.spotify || SP;
    ACCOUNT = Object.assign({}, ACCOUNT, data.account || {});
    DISPLAY = data.display || null;
    APPIMAGE = !!data.appImage;
    PLATFORM = data.platform || 'linux';
    FEAT = Object.assign(FEAT, data.features || {});
    applyFeatures();
    if (data.platform === 'win32' || data.platform === 'darwin') { optMenu.closest('.toggle').hidden = true; }
    optLogin.checked = !!st.startOnLogin;
    optMenu.checked = st.appMenu !== false;
    optTop.checked = !!st.onTop;
    optAwake.checked = !!st.keepAwake;
    integrationNote({ appImage: APPIMAGE });
    $('ver').textContent = `Aqua MD ${data.version || ''}${PLATFORM === 'android' ? ' · Android beta' : PLATFORM === 'web' ? ' · Web' : ''}`.trim();
    const last = st.lastDisc;
    let start = 'demo';
    if (last === 'spotify' && SP.available) start = 'spotify';
    else if (last && last.startsWith('pl:') && ACCOUNT.linked && discById(last)) start = last;
    else if (last && last !== 'spotify' && !last.startsWith('pl:') && discById(last)) start = last;
    else if (FILES.length) start = FILES[0].id;
    S.discId = start;
  }
  INST_READY = true;
  layout();
  buildSide();
  buildOrder(false);
  if (S.shuffle && S.order.length) S.ti = S.order[0];
  S.op = 0;
  S.inserted = true;
  if (isSpot()) S.playing = SP.status === 'Playing';
  paintKnob(); applyVol(); paintLabel(); prepTrack();
  setMode('track'); render();
  const c = cachedWeather();
  if (c && c.lat === wxLoc.lat && c.lon === wxLoc.lon) { try { renderWeather(c.j, false); } catch (e) {} }
  loadWeather();
  requestAnimationFrame(frame);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { curTitle = null; if (L.mode === 'track') trackText(); requestAnimationFrame(measureTitle); });
}

// Used by the Android app: its Back button and the play/next buttons in its notification.
window.__aquaRemote = {
  playpause: () => (S.playing ? pause() : play()),
  play: () => { if (!S.playing) play(); },
  pause: () => { if (S.playing) pause(); },
  next: () => next(),
  prev: () => prev(),
  back: () => { if (openName) { closePanel(); return true; } return false; }
};

// Read-only view of the player, used by the automated self-test.
window.__aquaDebug = {
  state: () => ({ discId: S.discId, ti: S.ti, playing: S.playing, inserted: S.inserted, busy: S.busy, shuffle: shuffleOn(), repeat: repeatMode(), order: S.order.slice(), vol: S.vol, pos: currentPos(), title: curTitle, sub: subEl.textContent, mode: L.mode, theme: themeNow, hue: getComputedStyle(root).getPropertyValue('--h').trim(), label: lname.textContent }),
  discs: () => allDiscs().map(d => ({ id: d.id, kind: d.kind, name: d.name, n: d.tracks.length })),
  media: () => media ? { src: media.src, time: media.currentTime, paused: media.paused, error: media.error && media.error.code } : null,
  levels: () => ({ L: meter.L.lv, R: meter.R.lv }),
  spotify: () => Object.assign({}, SP),
  account: () => Object.assign({}, ACCOUNT),
  playlists: () => (PLAYLISTS || []).slice(),
  recents: () => RECENTS.slice(),
  panel: () => openName,
  side: () => ({ shown: PAGE_EL.length, geo: GEO, pages: SIDE.pages.length, cur: curPage, interval: SIDE.interval, widgets: INST.map(w => w.type + '@' + w.page), lyrics: LYR.state, lyricLine: (document.querySelector('.wpage.on .wl-line.on') || {}).textContent || '', next: [...document.querySelectorAll('.wpage.on .wu-t')].map(x => x.textContent) }),
  act: { loadDisc, play, pause, stop, next, prev, seek, eject, toggleShuffle, cycleRepeat, setVol, selectTrack, setColor, openPanel, closePanel, loadPlaylists,
    openSettings: () => openPanel('settings'), closeSettings: closePanel, goPage: i => goPage(i, true),
    setSide: v => { SIDE = normSide(v); curPage = 0; saveSide(); },
    refreshDiscs: async () => { if (!api) return 0; const data = await api.init(); FILES = data.discs || []; rackSig = ''; render(); return FILES.length; } }
};

init();
})();
