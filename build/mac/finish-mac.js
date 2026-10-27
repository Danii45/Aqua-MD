#!/usr/bin/env node
// Finishes the Mac build after `electron-builder --mac dir`: signs the app ad hoc with rcodesign (so Apple
// Silicon Macs run it and macOS offers "Open Anyway"), checks the signature, and zips it for download.
//   node build/mac/finish-mac.js <version>
// rcodesign (github.com/indygreg/apple-platform-rs) signs Mac apps from Linux. Set $RCODESIGN to its path.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const version = process.argv[2] || require(path.join(ROOT, 'package.json')).version;
const RCODESIGN = process.env.RCODESIGN || '/home/claude/dl-rcodesign/apple-codesign-0.29.0-x86_64-unknown-linux-musl/rcodesign';
const dir = path.join(ROOT, 'dist', 'mac-arm64');
const app = path.join(dir, 'Aqua MD.app');
const out = path.join(ROOT, 'dist', 'AquaMD-Mac-Beta.zip');
const run = (cmd, args, opts) => execFileSync(cmd, args, Object.assign({ stdio: ['ignore', 'pipe', 'pipe'] }, opts)).toString();

if (!fs.existsSync(app)) throw new Error(`no app at ${app}; run electron-builder --mac dir first`);
// Electron's sample app isn't needed next to ours.
fs.rmSync(path.join(app, 'Contents', 'Resources', 'default_app.asar'), { force: true });
// Ad hoc signature for the app and everything inside it (helpers, frameworks). No Apple account involved.
run(RCODESIGN, ['sign', app]);
// rcodesign's own "verify" doesn't handle ad hoc signatures, so check its signature report instead.
const info = run(RCODESIGN, ['print-signature-info', path.join(app, 'Contents', 'MacOS', 'Aqua MD')]);
if (!/ADHOC/.test(info) || !/identifier: app\.aquamd\.player/.test(info) || !/Resources/.test(info)) throw new Error('signature looks wrong:\n' + info);
const check = 'ad hoc signature on app.aquamd.player, resources sealed';
fs.rmSync(out, { force: true });
// -y keeps the framework symlinks as symlinks, which the signature depends on.
run('zip', ['-q', '-r', '-y', out, 'Aqua MD.app'], { cwd: dir });
console.log(check.trim() || 'signature verified');
console.log(`built ${out} (${(fs.statSync(out).size / 1048576).toFixed(0)} MB, ${version})`);
