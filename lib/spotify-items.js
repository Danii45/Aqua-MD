'use strict';
// Shared by the desktop app (lib/spotify-hub.js) and the browser and phone versions (web/platform.js):
// turns Spotify's pages of playlist songs into simple rows, and works out which songs can actually play.

function smallArt(images) {
  const l = (images || []).slice().sort((a, b) => (a.width || 640) - (b.width || 640));
  const i = l.find(x => (x.width || 640) >= 64) || l[l.length - 1];
  return i ? i.url : null;
}

/**
 * Why a song can't play, or '' when it can. Spotify keeps songs in playlists after they stop being available,
 * and its own apps quietly hide them; asked to play one directly, it says it "can't play this" and skips on.
 * @returns {'' | 'local' | 'gone' | 'market' | 'explicit' | 'product' | string}
 */
function whyNot(t, isLocal) {
  if (isLocal || (t && t.is_local)) return 'local';
  if (!t || !t.uri) return 'gone';
  const reason = t.restrictions && t.restrictions.reason;
  if (t.is_playable === false) return reason || 'market';
  return reason || '';
}

function shapeSong(entry) {
  const t = entry ? (entry.item || entry.track || null) : null;
  const why = whyNot(t, entry && entry.is_local);
  return {
    uri: (t && t.uri) || '',
    title: (t && t.name) || 'Unknown song',
    artist: t ? ((t.artists || []).map(a => a && a.name).filter(Boolean).join(', ') || (t.show && t.show.name) || '') : '',
    art: t ? smallArt((t.album && t.album.images) || t.images) : null,
    duration: ((t && t.duration_ms) || 0) / 1000,
    playable: !why,
    why
  };
}

/** One page of GET /playlists/{id}/items. */
function shapePage(j, offset) {
  const items = ((j && j.items) || []).map(shapeSong);
  return { total: j && typeof j.total === 'number' ? j.total : (offset || 0) + items.length, offset: offset || 0, items, more: !!(j && j.next) };
}

/** A song object from the queue or the track endpoint, as a row. */
function shapeTrack(t) { return shapeSong({ item: t }); }

/** GET /search results: songs, albums and playlists (Spotify sometimes sends empty slots; those are dropped). */
function shapeSearch(j) {
  const list = k => ((j && j[k] && j[k].items) || []).filter(Boolean);
  return {
    songs: list('tracks').map(shapeTrack),
    albums: list('albums').filter(a => a.uri).map(a => ({
      uri: a.uri, name: a.name || 'Album', artist: (a.artists || []).map(x => x && x.name).filter(Boolean).join(', '),
      art: smallArt(a.images), total: typeof a.total_tracks === 'number' ? a.total_tracks : null, year: String(a.release_date || '').slice(0, 4)
    })),
    playlists: list('playlists').filter(p => p.id).map(p => {
      const imgs = (p.images || []).slice().sort((a, b) => (a.width || 640) - (b.width || 640));
      const img = imgs.find(i => (i.width || 640) >= 200) || imgs[imgs.length - 1] || null;
      const count = p.items && typeof p.items.total === 'number' ? p.items.total : (p.tracks && typeof p.tracks.total === 'number' ? p.tracks.total : null);
      return { id: p.id, uri: p.uri || `spotify:playlist:${p.id}`, name: p.name || 'Untitled playlist', owner: (p.owner && (p.owner.display_name || p.owner.id)) || '', total: count, image: img ? img.url : null };
    })
  };
}

module.exports = { smallArt, whyNot, shapeSong, shapePage, shapeTrack, shapeSearch };
