#!/usr/bin/env node
// Builds Aqua MD for Android without Gradle or Google's SDK downloads, using Ubuntu's Android packages:
//   sudo apt install aapt apksigner zipalign android-sdk-platform-23 dalvik-exchange   (plus a JDK)
//   node tools/build-apk.js <versionName> <versionCode> [outFile]
// Steps: web interface (tools/build-web.js) -> aapt (resources + manifest) -> javac -> dx -> zipalign -> apksigner.
// It compiles against the Android 6 SDK (the newest Ubuntu ships), targets Android 13 and needs Android 8+;
// newer Android features are reached by name at run time (see the Java files).
// Signing key: $AQUA_KEYSTORE / $AQUA_KEYSTORE_PASS, or ~/.aqua-md-keys (created on first build). Keep it:
// Android only installs an update over the app if it's signed with the same key.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const AND = path.join(ROOT, 'android');
const SDK = process.env.ANDROID_PLATFORM_JAR || '/usr/lib/android-sdk/platforms/android-23/android.jar';
const DX = process.env.DX || '/usr/lib/android-sdk/build-tools/debian/dx';
const MIN_SDK = 26, TARGET_SDK = 33;
const [versionName, versionCode, outArg] = process.argv.slice(2);
if (!versionName || !/^\d+$/.test(versionCode || '')) { console.error('usage: node tools/build-apk.js <versionName> <versionCode> [outFile]'); process.exit(1); }
const OUT = path.resolve(outArg || path.join(ROOT, 'dist', 'AquaMD-Android-Beta.apk'));
const B = path.join(AND, 'build');
const run = (cmd, args, opts) => execFileSync(cmd, args, Object.assign({ stdio: ['ignore', 'pipe', 'pipe'] }, opts)).toString();

fs.rmSync(B, { recursive: true, force: true });
for (const d of ['gen', 'classes', 'assets']) fs.mkdirSync(path.join(B, d), { recursive: true });

// 1. The deck itself, as a web page inside the APK.
run(process.execPath, [path.join(__dirname, 'build-web.js'), path.join(B, 'assets', 'www'), versionName]);

// 2. Resources and manifest.
const unsigned = path.join(B, 'unsigned.apk');
run('aapt', ['package', '-f', '-m', '-J', path.join(B, 'gen'), '-M', path.join(AND, 'AndroidManifest.xml'), '-S', path.join(AND, 'res'),
  '-A', path.join(B, 'assets'), '-I', SDK, '--min-sdk-version', String(MIN_SDK), '--target-sdk-version', String(TARGET_SDK),
  '--version-code', versionCode, '--version-name', versionName, '-F', unsigned]);

// 2b. Add the "density" (0x1000) and "colorMode" (0x4000) config-change flags, which aapt can't name with the
//     Android 6 SDK, so folding/unfolding the phone doesn't restart the deck.
run('unzip', ['-o', '-q', unsigned, 'AndroidManifest.xml', '-d', B]);
const mf = fs.readFileSync(path.join(B, 'AndroidManifest.xml'));
const want = Buffer.from([0x08, 0x00, 0x00, 0x11]); // Res_value: size 8, res0, TYPE_INT_HEX
let hits = 0;
for (let i = 0; i + 8 <= mf.length; i++) {
  if (mf.compare(want, 0, 4, i, i + 4) === 0 && mf.readUInt32LE(i + 4) === 0x40002ffc) { mf.writeUInt32LE(0x40007ffc, i + 4); hits++; }
}
if (hits !== 1) throw new Error(`expected one configChanges value in the manifest, found ${hits}`);
fs.writeFileSync(path.join(B, 'AndroidManifest.xml'), mf);
run('zip', ['-q', '-j', unsigned, path.join(B, 'AndroidManifest.xml')]);

// 3. Java -> class files -> Android bytecode.
const srcs = [];
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.java')) srcs.push(p); });
walk(path.join(AND, 'src')); walk(path.join(B, 'gen'));
run('javac', ['-nowarn', '-Xlint:-options', '-source', '8', '-target', '8', '-bootclasspath', SDK, '-encoding', 'UTF-8', '-d', path.join(B, 'classes'), ...srcs]);
run(DX, ['--dex', `--min-sdk-version=${MIN_SDK}`, `--output=${path.join(B, 'classes.dex')}`, path.join(B, 'classes')]);
run('zip', ['-q', '-j', unsigned, path.join(B, 'classes.dex')]);

// 4. Align and sign.
const aligned = path.join(B, 'aligned.apk');
run('zipalign', ['-f', '-p', '4', unsigned, aligned]);
let ks = process.env.AQUA_KEYSTORE, pass = process.env.AQUA_KEYSTORE_PASS;
if (!ks) {
  const dir = path.join(os.homedir(), '.aqua-md-keys');
  ks = path.join(dir, 'aqua-md-release.jks');
  const pf = path.join(dir, 'aqua-md-release.pass');
  if (!fs.existsSync(ks)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    pass = require('crypto').randomBytes(18).toString('base64url');
    fs.writeFileSync(pf, pass + '\n', { mode: 0o600 });
    run('keytool', ['-genkeypair', '-keystore', ks, '-storetype', 'PKCS12', '-alias', 'aquamd', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '12000',
      '-dname', 'CN=Aqua MD, O=Aqua MD', '-storepass', pass, '-keypass', pass]);
    console.log('created a new signing key:', ks);
  }
  pass = fs.readFileSync(pf, 'utf8').trim();
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
run('apksigner', ['sign', '--ks', ks, '--ks-key-alias', 'aquamd', '--ks-pass', `pass:${pass}`, '--key-pass', `pass:${pass}`,
  '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true', '--out', OUT, aligned]);
run('apksigner', ['verify', OUT]);
fs.rmSync(OUT + '.idsig', { force: true });
console.log(`built ${OUT} (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB, ${versionName} / ${versionCode})`);
