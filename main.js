'use strict';
const { app, BrowserWindow, Menu, ipcMain, screen, dialog, protocol, session, shell, clipboard, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { Settings } = require('./lib/settings');
const { Library, ALL_EXT } = require('./lib/library');
const { MprisBridge } = require('./lib/mpris');
const { RemoteBridge } = require('./lib/spotify-remote');
const { SpotifyWeb } = require('./lib/spotify-web');
const { SpotifyHub } = require('./lib/spotify-hub');
const { Lyrics } = require('./lib/lyrics');
const { SysInfo } = require('./lib/sysinfo');
const integration = require('./lib/integration');

const RENDERER = path.join(__dirname, 'renderer');
const ICON = path.join(__dirname, 'build', 'icon.png');
const DASHBOARD = 'https://developer.spotify.com/dashboard';

app.setName('Aqua MD');
if (process.platform === 'linux') {
  // Native Wayland does not let an app choose its screen, so run through XWayland to land on the Edge.
  if (!process.argv.some(a => a.startsWith('--ozone-platform'))) app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('class', 'aqua-md');
  // Keep the saved Spotify login in Aqua MD's own settings file instead of prompting for a KDE Wallet.
  app.commandLine.appendSwitch('password-store', 'basic');
  if (app.setDesktopName) app.setDesktopName('aqua-md.desktop');
}
// Spotify's player starts music without a click on the page that hosts it.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (process.platform === 'win32') app.setAppUserModelId('app.aquamd.player');

if (!app.requestSingleInstanceLock()) { app.quit(); }

protocol.registerSchemesAsPrivileged([
  { scheme: 'aqua', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

let win = null, settings = null, library = null, mpris = null, web = null, hub = null, lyrics = null;
const sysinfo = new SysInfo();

/* ---------------- screens ---------------- */
const px = d => ({ w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor) });
const isEdge = d => { const { w, h } = px(d); return w / h > 3.2; }; // Xeneon Edge is 2560x720 (32:9)

function pickDisplay() {
  const all = screen.getAllDisplays();
  const saved = settings.get('display');
  if (saved) {
    const d = all.find(x => x.id === saved.id) || all.find(x => px(x).w === saved.width && px(x).h === saved.height);
    if (d) return d;
  }
  return all.find(isEdge) || null;
}

const windowMode = () => (settings.get('windowMode') === 'window' ? 'window' : 'full');

function displayInfo() {
  if (!win) return null;
  const all = screen.getAllDisplays();
  const d = screen.getDisplayMatching(win.getBounds());
  const { w, h } = px(d);
  return { count: all.length, index: Math.max(0, all.findIndex(x => x.id === d.id)), label: `${w} × ${h}`, edge: isEdge(d), fullscreen: win.isFullScreen(), mode: windowMode() };
}

function placeOn(d) {
  if (!win || !d) return;
  const go = () => {
    win.setBounds(d.bounds);
    setTimeout(() => { if (win) { win.setFullScreen(true); sendDisplay(); } }, 200);
  };
  if (win.isFullScreen()) { win.once('leave-full-screen', () => setTimeout(go, 100)); win.setFullScreen(false); }
  else go();
}

// A normal window: the size and place it had last time, or 1600 x 900 in the middle of a screen.
function windowBoundsOn(d) {
  const saved = settings.get('windowBounds');
  if (saved && screen.getAllDisplays().some(x => {
    const b = x.workArea;
    return saved.x < b.x + b.width - 80 && saved.x + saved.width > b.x + 80 && saved.y >= b.y - 20 && saved.y < b.y + b.height - 80;
  }) && (!d || screen.getDisplayMatching(saved).id === d.id)) return saved;
  const area = (d || screen.getPrimaryDisplay()).workArea;
  const width = Math.min(1600, area.width - 80), height = Math.min(900, area.height - 80);
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
}

function asWindow(d) {
  if (!win) return;
  const go = () => { if (win) { win.setBounds(windowBoundsOn(d)); sendDisplay(); } };
  if (win.isFullScreen()) { win.once('leave-full-screen', () => setTimeout(go, 150)); win.setFullScreen(false); }
  else go();
}

// Other apps can draw their own full-screen window on the Edge (Corsair iCUE does on Windows) and cover
// Aqua MD. While full screen, Aqua MD can sit in the always-on-top layer and push itself to the front.
const onTopWanted = () => { const v = settings.get('onTop'); return v == null ? process.platform === 'win32' : !!v; };
function applyOnTop() {
  if (!win || win.isDestroyed()) return;
  const on = onTopWanted() && win.isFullScreen();
  if (win.isAlwaysOnTop() !== on) win.setAlwaysOnTop(on, 'screen-saver');
  if (on) win.moveTop();
}
let frontTimers = [];
function bringToFront() {
  frontTimers.forEach(clearTimeout);
  applyOnTop();
  // iCUE may grab the front again right after we start, so check back a few times.
  frontTimers = [500, 1500, 4000, 9000].map(ms => setTimeout(applyOnTop, ms));
}

function setWindowMode(mode) {
  settings.set('windowMode', mode === 'window' ? 'window' : 'full');
  const here = screen.getDisplayMatching(win.getBounds());
  if (mode === 'window') asWindow(here);
  else placeOn(here);
  return displayInfo();
}

function sendDisplay() { setTimeout(() => send('window:display', displayInfo()), 300); }

function nextScreen() {
  const all = screen.getAllDisplays();
  if (!win || !all.length) return displayInfo();
  const cur = screen.getDisplayMatching(win.getBounds());
  const i = all.findIndex(x => x.id === cur.id);
  const d = all[(i + 1) % all.length];
  const { w, h } = px(d);
  settings.set('display', { id: d.id, width: w, height: h });
  if (windowMode() === 'window') { settings.set('windowBounds', null); asWindow(d); }
  else placeOn(d);
  return displayInfo();
}

/* ---------------- window ---------------- */
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  const target = pickDisplay();
  const full = windowMode() === 'full' && !!target;
  const start = full ? target.bounds : windowBoundsOn(target);
  win = new BrowserWindow({
    title: 'Aqua MD',
    icon: ICON,
    backgroundColor: '#070c17',
    show: false,
    autoHideMenuBar: true,
    x: start.x, y: start.y, width: start.width, height: start.height,
    minWidth: 640, minHeight: 360,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  });
  win.once('ready-to-show', () => {
    win.show();
    if (full) placeOn(target);
    sendDisplay();
  });
  win.on('enter-full-screen', () => { sendDisplay(); bringToFront(); });
  win.on('leave-full-screen', () => { sendDisplay(); applyOnTop(); });
  win.on('restore', applyOnTop);
  win.on('focus', applyOnTop);
  let saveT = 0;
  const remember = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isFullScreen() || win.isMaximized() || win.isMinimized()) return;
      settings.set('windowBounds', win.getBounds());
    }, 600);
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { e.preventDefault(); setWindowMode(win.isFullScreen() ? 'window' : 'full'); }
    if (input.control && (input.key === 'q' || input.key === 'Q')) { e.preventDefault(); app.quit(); }
  });
  win.on('closed', () => { win = null; app.quit(); });
  win.loadURL('aqua://app/index.html');
}

/* ---------------- aqua:// protocol ---------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https://i.scdn.co https://*.scdn.co https://*.spotifycdn.com",
  "media-src 'self' blob:",
  "connect-src https://api.open-meteo.com https://geocoding-api.open-meteo.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'"
].join('; ');

function notFound() { return new Response('Not found', { status: 404 }); }

function serveApp(pathname, req) {
  // Songs and cover art are served from the page's own origin so the deck's level meters can read the audio.
  if (pathname.startsWith('/~media/')) {
    const m = library.media(decodeURIComponent(pathname.slice(8)));
    return m ? serveFile(m.path, m.mime, req) : notFound();
  }
  if (pathname.startsWith('/~art/')) {
    const p = library.artPath(pathname.slice(6));
    return p ? serveFile(p, p.endsWith('.png') ? 'image/png' : 'image/jpeg', req) : notFound();
  }
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const file = path.join(RENDERER, rel || 'index.html');
  if (!file.startsWith(RENDERER + path.sep)) return notFound();
  try {
    const data = fs.readFileSync(file);
    const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' };
    if (file.endsWith('.html')) headers['content-security-policy'] = CSP;
    return new Response(data, { headers });
  } catch (e) { return notFound(); }
}

function serveFile(file, mime, req) {
  let size;
  try { size = fs.statSync(file).size; } catch (e) { return notFound(); }
  const range = req.headers.get('range');
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m && size > 0) {
    let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    const body = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(body, {
      status: 206,
      headers: { 'content-type': mime, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' }
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    status: 200, headers: { 'content-type': mime, 'content-length': String(size), 'accept-ranges': 'bytes' }
  });
}

function registerProtocol() {
  protocol.handle('aqua', req => {
    let u;
    try { u = new URL(req.url); } catch (e) { return notFound(); }
    if (u.host === 'app') return serveApp(u.pathname, req);
    return notFound();
  });
}

/* ---------------- IPC ---------------- */
const SETTABLE = new Set(['weather', 'startOnLogin', 'appMenu', 'onTop', 'volume', 'lastDisc', 'shuffle', 'repeat', 'colors', 'recentPlaylists', 'widgets']);
const fromDeck = e => !!(win && !win.isDestroyed() && e.sender === win.webContents);
function deckHandle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => { if (!fromDeck(e)) return null; return fn(...args); });
}

function runIntegration() {
  return integration.sync({ appMenu: settings.get('appMenu'), startOnLogin: settings.get('startOnLogin'), iconPath: ICON });
}

async function importPaths(paths) {
  const res = await library.importPaths(paths, p => send('library:progress', p));
  return Object.assign(res, { discs: library.forRenderer() });
}

function wireIpc() {
  deckHandle('init', () => ({
    version: app.getVersion(),
    platform: process.platform,
    appImage: !!process.env.APPIMAGE || process.platform === 'win32' || process.platform === 'darwin',
    settings: {
      weather: settings.get('weather'), startOnLogin: settings.get('startOnLogin'), appMenu: settings.get('appMenu'), onTop: onTopWanted(),
      volume: settings.get('volume'), lastDisc: settings.get('lastDisc'), shuffle: !!settings.get('shuffle'), repeat: settings.get('repeat') || 'off',
      colors: settings.get('colors') || {}, recentPlaylists: settings.get('recentPlaylists') || [], widgets: settings.get('widgets')
    },
    discs: library.forRenderer(),
    spotify: hub.now(),
    account: hub.accountState(),
    display: displayInfo(),
    extensions: ALL_EXT
  }));
  deckHandle('library:pick', async mode => {
    const folder = mode === 'folder';
    const r = await dialog.showOpenDialog(win, folder
      ? { title: 'Add a music folder', properties: ['openDirectory', 'multiSelections'] }
      : { title: 'Add songs', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Music and video', extensions: ALL_EXT }] });
    if (r.canceled || !r.filePaths.length) return null;
    return importPaths(r.filePaths);
  });
  deckHandle('library:import', paths => importPaths((paths || []).filter(p => typeof p === 'string')));
  deckHandle('library:duration', (id, sec) => library.setDuration(String(id), Number(sec)));
  deckHandle('library:remove', id => { library.removeDisc(String(id)); return library.forRenderer(); });

  deckHandle('spotify:control', (cmd, arg) => hub.control(String(cmd), arg));
  deckHandle('spotify:setClientId', id => web.setClientId(id));
  deckHandle('spotify:forgetClientId', () => { hub.stopEngine(); web.forgetClientId(); hub.pushAccount(); hub.pushNow(); return true; });
  deckHandle('spotify:login', () => {
    try {
      const url = web.loginUrl();
      global.__aqua.lastLoginUrl = url;
      if (process.env.AQUA_TEST_NO_BROWSER !== '1') shell.openExternal(url);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  deckHandle('spotify:logout', () => { hub.stopEngine(); web.logout(); hub.cachedPlaylists = null; hub.pushAccount(); hub.pushNow(); return true; });
  deckHandle('spotify:restartEngine', () => { hub.stopEngine(); hub.startEngine(); return true; });
  deckHandle('spotify:openDashboard', () => { shell.openExternal(DASHBOARD); return true; });
  deckHandle('lyrics:find', q => {
    if (!q || typeof q !== 'object') return { status: 'none' };
    return lyrics.find({ id: q.id ? String(q.id) : '', title: String(q.title || ''), artist: String(q.artist || ''), album: String(q.album || ''), duration: Number(q.duration) || 0 });
  });
  deckHandle('sys:stats', () => sysinfo.read());
  deckHandle('clipboard:write', text => { clipboard.writeText(String(text || '')); return true; });

  deckHandle('settings:set', (key, value) => {
    if (!SETTABLE.has(key)) return false;
    settings.set(key, value);
    if (key === 'startOnLogin' || key === 'appMenu') return runIntegration();
    if (key === 'onTop') bringToFront();
    return true;
  });
  deckHandle('window:next-screen', () => nextScreen());
  deckHandle('window:fullscreen', () => { if (win) setWindowMode(win.isFullScreen() ? 'window' : 'full'); return true; });
  deckHandle('window:mode', mode => setWindowMode(String(mode)));
  deckHandle('app:quit', () => { app.quit(); return true; });
}

/* ---------------- lifecycle ---------------- */
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => { if (!url.startsWith('aqua://app/')) e.preventDefault(); });
});

const vault = {
  encrypt: s => safeStorage.isEncryptionAvailable()
    ? 'enc:' + safeStorage.encryptString(s).toString('base64')
    : 'raw:' + Buffer.from(s).toString('base64'),
  decrypt: s => s.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'))
    : s.startsWith('raw:') ? Buffer.from(s.slice(4), 'base64').toString() : s
};

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  settings = new Settings(app.getPath('userData'));
  library = new Library(app.getPath('userData'), settings);
  lyrics = new Lyrics(app.getPath('userData'), library, app.getVersion());
  web = new SpotifyWeb({ settings, vault, onChange: () => hub && hub.pushAccount() });
  // Linux sees the Spotify app over MPRIS; elsewhere Aqua MD follows Spotify through the Web API.
  const useMpris = process.platform === 'linux' && process.env.AQUA_FORCE_REMOTE !== '1';
  mpris = useMpris
    ? new MprisBridge(state => hub && hub.onMpris(state))
    : new RemoteBridge(web, state => hub && hub.onMpris(state), () => hub && hub.engine.deviceId);
  hub = new SpotifyHub({ web, mpris, emit: send, getWindow: () => win });
  global.__aqua = { win: () => win, library, settings, mpris, web, hub, lyrics, importPaths, lastLoginUrl: '' };
  registerProtocol();
  wireIpc();
  hub.wireEngineIpc();
  createWindow();
  mpris.start();
  runIntegration();
  await hub.startServer();
  if (web.linked) hub.startEngine();

  screen.on('display-added', (_e, d) => { if (win && isEdge(d) && !settings.get('display') && windowMode() === 'full') placeOn(d); else sendDisplay(); });
  screen.on('display-removed', sendDisplay);
  screen.on('display-metrics-changed', sendDisplay);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (settings) settings.flush(); if (mpris) mpris.stop(); if (hub) hub.stop(); });
