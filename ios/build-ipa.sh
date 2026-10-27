#!/bin/bash
# Builds Aqua MD for iPhone as an unsigned .ipa. Sideloadly (or AltStore) signs it with your Apple ID.
# Needs a Mac with Xcode; GitHub's Mac runners build it (see .github/workflows/ios.yml).
#   bash ios/build-ipa.sh <version> <build-number> [out.ipa]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION="${1:-0.4.1}"
BUILD="${2:-1}"
OUT="${3:-$HERE/build/AquaMD-iPhone-Beta.ipa}"
B="$HERE/build"
APP="$B/Payload/AquaMD.app"
rm -rf "$B" && mkdir -p "$APP"

SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
SDKVER="$(xcrun --sdk iphoneos --show-sdk-version)"
xcrun --sdk iphoneos swiftc -parse-as-library -O -target arm64-apple-ios15.0 -sdk "$SDK" \
  -o "$APP/AquaMD" "$HERE"/Sources/*.swift

sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" "$HERE/Info.plist" > "$APP/Info.plist"
printf 'APPL????' > "$APP/PkgInfo"
cp "$HERE"/icons/*.png "$APP/"
# App icon (Assets.car) from the 1024 px icon.
xcrun actool "$HERE/Assets.xcassets" --compile "$APP" --platform iphoneos --minimum-deployment-target 15.0 \
  --app-icon AppIcon --output-partial-info-plist "$B/assets.plist" --target-device iphone --target-device ipad > "$B/actool.log"
# Keys Xcode normally adds.
/usr/libexec/PlistBuddy -c "Add :DTPlatformName string iphoneos" "$APP/Info.plist"
/usr/libexec/PlistBuddy -c "Add :DTPlatformVersion string $SDKVER" "$APP/Info.plist"
/usr/libexec/PlistBuddy -c "Add :DTSDKName string iphoneos$SDKVER" "$APP/Info.plist"
plutil -lint "$APP/Info.plist"
file "$APP/AquaMD"
ls -la "$APP"

rm -f "$OUT"
(cd "$B" && zip -qry "$OUT" Payload)
echo "built $OUT ($(du -h "$OUT" | cut -f1))"
