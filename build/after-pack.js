// electron-builder hook: put a small launcher in front of the Electron binary so the AppImage
// starts with the right flags on Kubuntu (XWayland for screen placement, and no sandbox where
// the system blocks the user-namespace sandbox that an AppImage would otherwise need).
const fs = require('fs');
const path = require('path');

const LAUNCHER = `#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
EXTRA=""
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] || \\
   [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = "0" ]; then
  EXTRA="--no-sandbox"
fi
exec "$HERE/aqua-md-bin" --ozone-platform=x11 --class=aqua-md $EXTRA "$@"
`;

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const dir = context.appOutDir;
  const bin = path.join(dir, 'aqua-md');
  const real = path.join(dir, 'aqua-md-bin');
  if (!fs.existsSync(real)) fs.renameSync(bin, real);
  fs.writeFileSync(bin, LAUNCHER, { mode: 0o755 });
};
