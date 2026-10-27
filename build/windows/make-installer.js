// Builds dist/AquaMD-Windows-Beta-Setup.exe from dist/win-unpacked with NSIS (native makensis, no Wine).
// Usage: node build/windows/make-installer.js <version, e.g. 0.4.0-beta.1>
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const version = process.argv[2] || require(path.join(root, 'package.json')).version;
const nums = (version.match(/\d+/g) || []).concat(['0', '0', '0', '0']).slice(0, 4).join('.');
const cache = path.join(os.homedir(), '.cache', 'electron-builder');
const nsisDir = fs.readdirSync(cache).filter(d => /^nsis-\d/.test(d))
  .flatMap(d => fs.readdirSync(path.join(cache, d)).map(x => path.join(cache, d, x)))
  .find(d => fs.existsSync(path.join(d, 'Include', 'MUI2.nsh')));
if (!nsisDir) throw new Error('NSIS not found: run an electron-builder NSIS build once to download it.');
const makensis = process.platform === 'win32' ? path.join(nsisDir, 'makensis.exe') : path.join(nsisDir, process.platform === 'darwin' ? 'mac' : 'linux', 'makensis');
fs.chmodSync(makensis, 0o755);
// Keep castLabs' Electron exactly as signed: its Widevine (VMP) signature only matches the untouched .exe.
const electronDist = path.resolve(root, process.env.AQUA_ELECTRON_DIST || path.join('..', 'castlabs-win'));
const unpacked = path.join(root, 'dist', 'win-unpacked');
if (fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  fs.copyFileSync(path.join(electronDist, 'electron.exe'), path.join(unpacked, 'aqua-md.exe'));
  fs.copyFileSync(path.join(electronDist, 'electron.exe.sig'), path.join(unpacked, 'aqua-md.exe.sig'));
} else console.warn('castLabs electron.exe not found; the Widevine signature may not match.');
const out = path.join(root, 'dist', 'AquaMD-Windows-Beta-Setup.exe');
execFileSync(makensis, ['-V2', `-DSRC=${path.join(root, 'dist', 'win-unpacked')}`, `-DOUTFILE=${out}`,
  `-DICON=${path.join(root, 'build', 'icon.ico')}`, `-DVERSION=${version}`, `-DVIVERSION=${nums}`, path.join(__dirname, 'installer.nsi')],
  { stdio: 'inherit', env: Object.assign({}, process.env, { NSISDIR: nsisDir }) });
console.log('built', out);
