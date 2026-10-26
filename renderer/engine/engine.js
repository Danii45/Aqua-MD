// Hidden page that runs Spotify's Web Playback SDK so Aqua MD itself is a Spotify speaker.
(() => {
'use strict';
const E = window.aquaEngine;
let player = null;
let deviceId = null;

function pickArt(images) {
  const list = (images || []).slice().sort((a, b) => (a.width || 640) - (b.width || 640));
  const img = list.find(i => (i.width || 640) >= 250) || list[list.length - 1];
  return img ? img.url : null;
}

function mapState(s) {
  if (!s || !s.track_window || !s.track_window.current_track) return null;
  const t = s.track_window.current_track;
  return {
    paused: !!s.paused,
    position: (s.position || 0) / 1000,
    duration: (s.duration || 0) / 1000,
    shuffle: !!s.shuffle,
    repeat: s.repeat_mode || 0,
    title: t.name || '',
    artist: (t.artists || []).map(a => a.name).join(', '),
    album: (t.album && t.album.name) || '',
    art: pickArt(t.album && t.album.images),
    uri: t.uri || '',
    contextUri: (s.context && s.context.uri) || null,
    contextName: (s.context && s.context.metadata && s.context.metadata.name) || '',
    at: Date.now()
  };
}

function sendState(s) { E.emit('state', { state: mapState(s) }); }

function setup(cfg) {
  window.onSpotifyWebPlaybackSDKReady = () => {
    player = new window.Spotify.Player({
      name: cfg.name || 'Aqua MD',
      volume: 0.5,
      getOAuthToken: cb => { E.getToken().then(t => { if (t) cb(t); }); }
    });
    player.addListener('ready', ({ device_id }) => { deviceId = device_id; E.emit('ready', { deviceId: device_id }); });
    player.addListener('not_ready', ({ device_id }) => { E.emit('not_ready', { deviceId: device_id }); });
    player.addListener('player_state_changed', s => sendState(s));
    ['initialization_error', 'authentication_error', 'account_error', 'playback_error'].forEach(type => {
      player.addListener(type, e => E.emit('error', { type, message: (e && e.message) || '' }));
    });
    player.connect().then(ok => { if (!ok) E.emit('error', { type: 'connect', message: 'The Spotify player did not connect.' }); });
    // The SDK only reports changes, so poll for position and for losing the active device.
    setInterval(() => { if (player) player.getCurrentState().then(sendState).catch(() => {}); }, 1000);
  };
  const s = document.createElement('script');
  s.src = cfg.sdkUrl;
  s.onerror = () => E.emit('error', { type: 'load', message: 'Could not download Spotify’s player. Check your internet connection.' });
  document.head.appendChild(s);
}

E.onCommand(async ({ id, cmd, arg }) => {
  let ok = true, error = '';
  try {
    if (!player) throw new Error('not-ready');
    switch (cmd) {
      case 'resume': await player.resume(); break;
      case 'pause': await player.pause(); break;
      case 'toggle': await player.togglePlay(); break;
      case 'next': await player.nextTrack(); break;
      case 'prev': await player.previousTrack(); break;
      case 'seek': await player.seek(Math.max(0, Math.round(Number(arg) * 1000))); break;
      case 'volume': await player.setVolume(Math.max(0, Math.min(1, Number(arg)))); break;
      case 'reconnect': player.disconnect(); await player.connect(); break;
      default: throw new Error('unknown-command');
    }
  } catch (e) { ok = false; error = (e && e.message) || 'failed'; }
  E.emit('ack', { id, ok, error });
});

E.config().then(async cfg => {
  if (!cfg) return;
  if (cfg.checkWidevine) {
    try {
      await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
        initDataTypes: ['cenc'],
        audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }]
      }]);
    } catch (e) {
      E.emit('error', { type: 'widevine', message: (e && e.message) || 'Widevine is not available' });
      return;
    }
  }
  setup(cfg);
});
})();
