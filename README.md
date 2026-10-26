# Aqua MD

A see-through, MiniDisc-style music player for Linux, made for the Corsair Xeneon Edge (2560 × 720) and happy in any window.

![Aqua MD on a 2560 × 720 screen](website/img/hero-blue.webp)

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

Linux (x86_64) only for now. Built and tested on Kubuntu.

## Spotify setup

In Aqua MD, open Settings → Spotify and follow the steps: create a free app on the Spotify developer dashboard with the redirect URI `http://127.0.0.1:43821/callback`, tick Web API and Web Playback SDK, and paste its Client ID.

## Build from source

```sh
npm install
npm start            # run it
npm run dist         # build dist/AquaMD-<version>-x86_64.AppImage
```

Built with castLabs Electron (Electron with Widevine), which Spotify's Web Playback SDK needs.

The `website/` folder holds the project's showcase page.

Not made by or affiliated with Sony, Spotify or Corsair. MiniDisc, Spotify and Xeneon are trademarks of their owners.
