import { getAccessToken } from '../core/spotifyAuth.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tool:spotify] ${label}`, data ?? '');
}

async function spotifyGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Spotify API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function getRecentlyPlayed({ limit = 20 } = {}) {
  log('recently-played', `limit=${limit}`);
  const data = await spotifyGet(`/me/player/recently-played?limit=${Math.min(limit, 50)}`);
  const items = data?.items ?? [];
  if (items.length === 0) return 'No recent listening history.';

  return items.map(item => {
    const track = item.track;
    const artists = track.artists.map(a => a.name).join(', ');
    const playedAt = new Date(item.played_at);
    const timeStr = playedAt.toLocaleString('en-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `${timeStr}: ${track.name} — ${artists}`;
  }).join('\n');
}

export async function getTopArtists({ timeRange = 'short_term', limit = 10 } = {}) {
  // timeRange: short_term (4 weeks), medium_term (6 months), long_term (all time)
  const validRanges = ['short_term', 'medium_term', 'long_term'];
  const range = validRanges.includes(timeRange) ? timeRange : 'short_term';
  const rangeLabel = range === 'short_term' ? 'past 4 weeks' : range === 'medium_term' ? 'past 6 months' : 'all time';

  log('top-artists', `range=${range} limit=${limit}`);
  const data = await spotifyGet(`/me/top/artists?time_range=${range}&limit=${Math.min(limit, 50)}`);
  const items = data?.items ?? [];
  if (items.length === 0) return `No top artists data for ${rangeLabel}.`;

  const lines = items.map((a, i) => {
    const genres = a.genres.slice(0, 3).join(', ');
    return `${i + 1}. ${a.name}${genres ? ` (${genres})` : ''}`;
  });
  return `Top artists (${rangeLabel}):\n${lines.join('\n')}`;
}

export async function getCurrentlyPlaying() {
  log('currently-playing');
  const data = await spotifyGet('/me/player/currently-playing');
  if (!data || !data.item) return 'Nothing is currently playing.';

  const track = data.item;
  const artists = track.artists.map(a => a.name).join(', ');
  const progress = data.progress_ms ? `${Math.round(data.progress_ms / 1000)}s` : '?';
  const duration = track.duration_ms ? `${Math.round(track.duration_ms / 1000)}s` : '?';
  const status = data.is_playing ? 'Playing' : 'Paused';
  return `${status}: ${track.name} — ${artists} (${progress} / ${duration})`;
}
