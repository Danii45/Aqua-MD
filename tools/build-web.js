#!/usr/bin/env node
// Builds the browser version of Aqua MD's interface: the same renderer files as the desktop app, plus
// web/platform.js (bundled with music-metadata) standing in for Electron's main process.
//   node tools/build-web.js <outDir> [version] [--dev] [--web]
// The Android app ships this folder inside the APK. --web adds what the website version needs (install manifest,
// offline service worker, icons): the website serves it from docs/app/. --dev also allows the local test servers.
'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const dev = args.includes('--dev');
const webApp = args.includes('--web');
const [outDir, version] = args.filter(a => !a.startsWith('--'));
if (!outDir) { console.error('usage: node tools/build-web.js <outDir> [version] [--dev]'); process.exit(1); }
const out = path.resolve(outDir);
const ver = version || require(path.join(ROOT, 'package.json')).version;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
for (const f of ['style.css', 'app.js']) fs.copyFileSync(path.join(ROOT, 'renderer', f), path.join(out, f));
for (const f of fs.readdirSync(path.join(ROOT, 'renderer', 'fonts'))) fs.copyFileSync(path.join(ROOT, 'renderer', 'fonts', f), path.join(out, 'fonts', f));
fs.copyFileSync(path.join(ROOT, 'build', 'icon.png'), path.join(out, 'icon.png'));

esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'web', 'platform.js')],
  bundle: true, format: 'iife', platform: 'browser', target: ['chrome100'], minify: !dev, legalComments: 'none',
  define: { __AQUA_VERSION__: JSON.stringify(ver) },
  outfile: path.join(out, 'platform.js'),
  logLevel: 'warning'
});

const local = dev ? ' http://127.0.0.1:47000' : '';
const CSP = [
  "default-src 'self'",
  `script-src 'self' https://sdk.scdn.co${local}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https://i.scdn.co https://*.scdn.co https://*.spotifycdn.com" + local,
  "media-src 'self' blob:",
  `connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com https://accounts.spotify.com https://api.spotify.com https://*.spotify.com https://*.scdn.co https://lrclib.net wss://*.spotify.com${local}`,
  `frame-src https://sdk.scdn.co${local}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'"
].join('; ');

if (webApp) {
  for (const f of fs.readdirSync(path.join(ROOT, 'web', 'icons'))) fs.copyFileSync(path.join(ROOT, 'web', 'icons', f), path.join(out, f));
  fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
    name: 'Aqua MD', short_name: 'Aqua MD', description: 'A see-through MiniDisc deck for Spotify and your own music.',
    start_url: './', scope: './', display: 'standalone', orientation: 'any', background_color: '#070c17', theme_color: '#070c17',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  }, null, 2));
  const shell = ['./', 'index.html', 'app.js', 'platform.js', 'style.css', 'icon.png', 'icon-192.png', 'manifest.webmanifest',
    ...fs.readdirSync(path.join(out, 'fonts')).map(f => 'fonts/' + f)];
  fs.writeFileSync(path.join(out, 'sw.js'), fs.readFileSync(path.join(ROOT, 'web', 'sw.js'), 'utf8')
    .replace('__VERSION__', ver).replace('__SHELL__', JSON.stringify(shell)));
}

let html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
html = html
  .replace('<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<meta name="theme-color" content="#070c17">\n<link rel="icon" href="icon.png">${webApp ? '\n<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icon-180.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Aqua MD">\n<meta name="apple-mobile-web-app-status-bar-style" content="black">' : ''}`)
  .replace('<script src="app.js" defer></script>', '<script src="platform.js"></script>\n<script src="app.js" defer></script>');
if (!html.includes('platform.js') || !html.includes('Content-Security-Policy')) throw new Error('index.html changed shape; update tools/build-web.js');
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log(`built web interface ${ver} -> ${out}`);
