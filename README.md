# Aqua MD

A see-through, MiniDisc-style music player for Linux, made for the Corsair Xeneon Edge (2560 × 720) and happy in any window.

![Aqua MD on a 2560 × 720 screen](docs/img/hero-blue.webp)

- **Spotify, built in:** log in once and Aqua MD plays Spotify by itself (Spotify Premium needed). It also controls the Spotify desktop app.
- **Your own music:** MP3, M4A, FLAC, WAV, OGG, plus the sound from MP4 and MOV videos. Each album becomes a disc.
- **Seven colours:** give any disc or playlist a colour and the whole app fades to it.
- **Widget pages:** clock, weather, lyrics, now playing, up next, system stats and calendar, on pages that take turns.
- **Lyrics:** from a `.lrc` file next to the song, the song file itself, or [LRCLIB](https://lrclib.net).
- **Any window:** full screen on the Edge, or a normal resizable window. Bigger windows fit more widgets.

## Download

Get the latest `.AppImage` from [Releases](https://github.com/Danii45/Aqua-MD/releases).

1. Download the file.
2. Right-click it → Properties → Permissions, and tick the box that makes it executable.
3. Double-click it.

Built and tested on Kubuntu (x86_64).

### Windows (beta)

Download `AquaMD-Windows-Beta-Setup.exe` from [Releases](https://github.com/Danii45/Aqua-MD/releases) and double-click it. It installs for your user and adds Aqua MD to the Start menu and desktop.

- It isn't code-signed yet, so Windows may say "Windows protected your PC": click **More info → Run anyway**.
- It's a beta and hasn't been tested much on Windows yet. If the built-in Spotify player doesn't work, Aqua MD shows and controls the Spotify app through your Spotify account instead.
- CPU and GPU temperatures aren't shown on Windows.
- Please report problems in [Issues](https://github.com/Danii45/Aqua-MD/issues).

## Spotify setup

In Aqua MD, open Settings → Spotify and follow the steps: create a free app on the Spotify developer dashboard with the redirect URI `http://127.0.0.1:43821/callback`, tick Web API and Web Playback SDK, and paste its Client ID.

## Build from source

```sh
npm install
npm start            # run it
npm run dist         # build dist/AquaMD-<version>-x86_64.AppImage
npm run dist:win     # Windows installer; needs castLabs Electron for win32-x64 unpacked in ../castlabs-win
```

Built with castLabs Electron (Electron with Widevine), which Spotify's Web Playback SDK needs.

The `docs/` folder holds the project's website (served by GitHub Pages).

Not made by or affiliated with Sony, Spotify or Corsair. MiniDisc, Spotify and Xeneon are trademarks of their owners.
