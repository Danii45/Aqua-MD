'use strict';
// Desktop integration for the AppImage: an app-menu entry with the icon, and an optional
// "open when I log in" entry. Both are plain .desktop files in the user's home folder.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const DATA = process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share');
const CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');
const MENU_FILE = path.join(DATA, 'applications', 'aqua-md.desktop');
const ICON_FILE = path.join(DATA, 'icons', 'hicolor', '512x512', 'apps', 'aqua-md.png');
const AUTOSTART_FILE = path.join(CONFIG, 'autostart', 'aqua-md.desktop');

// Path of the thing to launch: the .AppImage file itself (the runtime sets $APPIMAGE).
function launcher() { return process.env.APPIMAGE || null; }

function quoteExec(p) {
  // Desktop Entry spec: quote the argument, escape " ` $ \ inside it, then escape backslashes for the string value.
  const q = '"' + p.replace(/(["`$\\])/g, '\\$1') + '"';
  return q.replace(/\\/g, '\\\\');
}

function entry(exec, extra) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Aqua MD',
    'GenericName=Music Player',
    'Comment=MiniDisc-style music player for the Xeneon Edge',
    'Exec=' + quoteExec(exec),
    'Icon=aqua-md',
    'Terminal=false',
    'Categories=AudioVideo;Audio;Player;',
    'StartupWMClass=aqua-md',
    ...(extra || []),
    ''
  ].join('\n');
}

function writeIfChanged(file, content) {
  try { if (fs.readFileSync(file, 'utf8') === content) return; } catch (e) { /* missing */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function remove(file) { try { fs.unlinkSync(file); } catch (e) { /* already gone */ } }

function sync({ appMenu, startOnLogin, iconPath }) {
  const exec = launcher();
  const result = { appImage: !!exec, appMenu: false, startOnLogin: false };
  if (!exec) return result; // running from source: nothing stable to point at
  try {
    if (appMenu) {
      try { fs.mkdirSync(path.dirname(ICON_FILE), { recursive: true }); fs.writeFileSync(ICON_FILE, fs.readFileSync(iconPath)); } catch (e) { /* icon is optional */ }
      writeIfChanged(MENU_FILE, entry(exec));
      result.appMenu = true;
    } else remove(MENU_FILE);
    if (startOnLogin) {
      writeIfChanged(AUTOSTART_FILE, entry(exec, ['X-GNOME-Autostart-enabled=true']));
      result.startOnLogin = true;
    } else remove(AUTOSTART_FILE);
  } catch (e) {
    console.warn('[integration]', e.message);
  }
  return result;
}

module.exports = { sync, MENU_FILE, AUTOSTART_FILE };
