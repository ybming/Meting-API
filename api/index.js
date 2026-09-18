/**
 * Meting API - Vercel Serverless Function
 *
 * Query params:
 *   server: netease | tencent | xiami | kugou | baidu | kuwo (default: netease)
 *   type: song | playlist | url | pic | lrc | name | artist
 *   id: song/playlist/artist id
 *   auth: HMAC auth token (optional)
 */

const crypto = require('crypto');
const Meting = require('../lib/meting');

// Configuration
const TLYRIC = true;
const AUTH = false;
const AUTH_SECRET = 'meting-secret';

// Content-Type mapping
const CONTENT_TYPE_MAP = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4',
  flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp',
};

function apiUri(request) {
  const host = request.headers.host || '';
  const proto = (request.headers['x-forwarded-proto'] || 'http').split(',')[0];
  const url = new URL(request.url, proto + '://' + host);
  return proto + '://' + host + url.pathname;
}

function auth(name) {
  return crypto.createHmac('sha1', AUTH_SECRET).update(name).digest('hex');
}

function getContentType(url, fallback) {
  if (fallback) return fallback;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const ext = path.split('.').pop().split('?')[0];
    return CONTENT_TYPE_MAP[ext] || 'application/octet-stream';
  } catch {
    return 'application/octet-stream';
  }
}

// Test if a CDN URL returns valid content (not a fake 100-byte placeholder)
async function isUrlValid(url, isAudio = true) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!res.ok) return false;
    const len = parseInt(res.headers.get('content-length') || '0');
    if (isAudio && len > 1024) return true;
    if (!isAudio && len > 0) return true;
    return false;
  } catch {
    return false;
  }
}

// Servers that work reliably from overseas Vercel (no vkey/IP binding issues)
const RELIABLE_SERVERS = ['netease', 'kugou', 'kuwo', 'baidu'];
// Servers that need fallback (vkey bound to domestic IPs)
const PROBLEMATIC_SERVERS = ['tencent', 'xiami'];

// Get working audio URL with fallback across servers
async function getWorkingAudioUrl(server, id) {
  // For reliable servers, just get URL directly (proxy handles streaming)
  if (RELIABLE_SERVERS.includes(server)) {
    try {
      const api = new Meting(server);
      api.format(true);
      const urlData = JSON.parse(await api.url(id, 320));
      let url = urlData.url;
      if (!url) throw new Error('no url');
      if (url.startsWith('http://')) url = url.replace('http://', 'https://');
      return url;
    } catch (err) {
      console.log(`[WARN] ${server} direct URL failed: ${err.message}`);
    }
  }
  
  // For problematic servers (or if reliable failed), try fallback chain
  // Step 1: Get song info from original server
  try {
    const origApi = new Meting(server);
    origApi.format(true);
    const songRaw = await origApi.song(id);
    const songArr = JSON.parse(songRaw);
    if (!songArr || songArr.length === 0) throw new Error('no song');
    
    const songInfo = songArr[0];
    const searchTerm = (Array.isArray(songInfo.artist) ? songInfo.artist.join(' ') : (songInfo.artist || '')) + ' ' + songInfo.name;
    console.log(`[FALLBACK] ${server} → searching: ${searchTerm}`);
    
    // Step 2: Try each fallback server
    const fallbackServers = RELIABLE_SERVERS; // + PROBLEMATIC_SERVERS later if needed
    for (const fbServer of fallbackServers) {
      try {
        const fbApi = new Meting(fbServer);
        fbApi.format(true);
        const searchRaw = await fbApi.search(searchTerm);
        const results = JSON.parse(searchRaw);
        if (!results || results.length === 0) continue;
        
        const bestMatch = results[0];
        if (!bestMatch.url_id) continue;
        
        const fbUrlData = JSON.parse(await fbApi.url(bestMatch.url_id, 320));
        let fbUrl = fbUrlData.url;
        if (!fbUrl) continue;
        if (fbUrl.startsWith('http://')) fbUrl = fbUrl.replace('http://', 'https://');
        
        console.log(`[FALLBACK] Found working URL from ${fbServer}`);
        return fbUrl;
      } catch (e) {
        continue;
      }
    }
  } catch (err) {
    console.log(`[FALLBACK] ${server} fallback error: ${err.message}`);
  }
  
  // Last resort: try original server one more time
  try {
    const api = new Meting(server);
    api.format(true);
    const urlData = JSON.parse(await api.url(id, 320));
    let url = urlData.url;
    if (url && url.startsWith('http://')) url = url.replace('http://', 'https://');
    return url || null;
  } catch {
    return null;
  }
}

// Get working pic URL with fallback
async function getWorkingPicUrl(server, id) {
  try {
    const api = new Meting(server);
    api.format(true);
    const picData = JSON.parse(await api.pic(id, 90));
    let url = picData.url;
    if (!url) return null;
    if (url.startsWith('http://')) url = url.replace('http://', 'https://');
    return url;
  } catch {
    return null;
  }
}

// Proxy remote file with Range support
async function proxyRemoteFile(url, request, response, fallbackContentType) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  if (request.headers.range) {
    headers['Range'] = request.headers.range;
  }

  try {
    const remoteRes = await fetch(url, { headers });
    
    if (!remoteRes.ok) {
      response.statusCode = remoteRes.status;
      response.end();
      return;
    }
    
    const contentType = getContentType(url, remoteRes.headers.get('content-type') || fallbackContentType);
    response.setHeader('Content-Type', contentType);
    
    const contentLength = remoteRes.headers.get('content-length');
    if (contentLength) {
      response.setHeader('Content-Length', contentLength);
    }
    
    const acceptRanges = remoteRes.headers.get('accept-ranges');
    response.setHeader('Accept-Ranges', acceptRanges || 'bytes');
    
    response.statusCode = remoteRes.status || 200;
    
    if (remoteRes.status === 206) {
      const cr = remoteRes.headers.get('content-range');
      if (cr) response.setHeader('Content-Range', cr);
    }
    
    response.setHeader('Cache-Control', 'public, max-age=3600');
    response.setHeader('Access-Control-Allow-Origin', '*');
    
    // Stream response
    if (remoteRes.body && typeof remoteRes.body.getReader === 'function') {
      const reader = remoteRes.body.getReader();
      const write = (chunk) => new Promise((resolve) => {
        if (!response.write(chunk)) response.once('drain', resolve);
        else resolve();
      });
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await write(value);
        }
        response.end();
      } catch {
        try { response.end(); } catch {}
      }
    } else {
      const buf = Buffer.from(await remoteRes.arrayBuffer());
      response.end(buf);
    }
  } catch (err) {
    console.error('Proxy error:', err.message);
    response.statusCode = 502;
    response.end('Proxy Error');
  }
}

// Build song entry
function buildSong(api, server, song, API_URI) {
  return {
    name: song.name,
    artist: Array.isArray(song.artist) ? song.artist.join('/') : song.artist,
    url: API_URI + '?server=' + (song.source || server) + '&type=url&id=' + song.url_id + (AUTH ? '&auth=' + auth(server + 'url' + song.url_id) : ''),
    pic: API_URI + '?server=' + (song.source || server) + '&type=pic&id=' + song.pic_id + (AUTH ? '&auth=' + auth(server + 'pic' + song.pic_id) : ''),
    lrc: API_URI + '?server=' + (song.source || server) + '&type=lrc&id=' + song.lyric_id + (AUTH ? '&auth=' + auth(server + 'lrc' + song.lyric_id) : ''),
  };
}

module.exports = async function handler(request, response) {
  const { query } = request;

  if (!query.type || !query.id) {
    response.statusCode = 302;
    response.setHeader('Location', '/docs/');
    response.end();
    return;
  }

  const server = query.server || 'netease';
  const type = query.type;
  const id = query.id;

  if (AUTH) {
    const token = query.auth || '';
    if (['url', 'pic', 'lrc'].includes(type)) {
      if (!token || token !== auth(server + type + id)) {
        response.statusCode = 403;
        response.end('Forbidden');
        return;
      }
    }
  }

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const api = new Meting(server);
    api.format(true);
    const API_URI = apiUri(request);

    // List types: playlist, artist, search
    if (['playlist', 'artist', 'search'].includes(type)) {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      let rawData;
      if (type === 'playlist') rawData = await api.playlist(id);
      else if (type === 'artist') rawData = await api.artist(id);
      else rawData = await api.search(id);
      
      if (!rawData || rawData === '[]') {
        response.statusCode = 200;
        response.end('{"error":"unknown ' + type + ' id"}');
        return;
      }
      const data = JSON.parse(rawData);
      const result = data.map(s => buildSong(api, server, s, API_URI));
      response.end(JSON.stringify(result));
    } else if (type === 'song') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      const rawSong = await api.song(id);
      if (!rawSong || rawSong === '[]') {
        response.statusCode = 200;
        response.end('{"error":"unknown song"}');
        return;
      }
      const arr = JSON.parse(rawSong);
      response.end(JSON.stringify([buildSong(api, server, arr[0], API_URI)]));
    } else if (type === 'url') {
      // Audio proxy with fallback
      const url = await getWorkingAudioUrl(server, id);
      if (!url) {
        response.statusCode = 404;
        response.setHeader('Content-Type', 'application/json');
        response.end('{"error":"no data"}');
        return;
      }
      await proxyRemoteFile(url, request, response, 'audio/mpeg');
    } else if (type === 'pic') {
      // Image proxy (no fallback needed for pics - they usually work)
      const url = await getWorkingPicUrl(server, id);
      if (!url) {
        response.statusCode = 404;
        response.end('{"error":"no data"}');
        return;
      }
      await proxyRemoteFile(url, request, response, 'image/jpeg');
    } else if (type === 'lrc') {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const lrcData = JSON.parse(await api.lyric(id));
      let lrc;
      if (!lrcData.lyric || lrcData.lyric.trim() === '') {
        lrc = '[00:00.00]This appears to be pure music, enjoy it!';
      } else if (!lrcData.tlyric || lrcData.tlyric.trim() === '') {
        lrc = lrcData.lyric;
      } else if (TLYRIC) {
        const lrcArr = lrcData.lyric.split('\n');
        const lrcCnArr = lrcData.tlyric.split('\n');
        const lrcCnMap = {};
        for (const v of lrcCnArr) {
          if (!v) continue;
          const parts = v.split(']', 2);
          lrcCnMap[parts[0] + ']'] = (parts[1] || '').replace(/\s+/g, ' ').trim();
        }
        for (let i = 0; i < lrcArr.length; i++) {
          const v = lrcArr[i];
          if (!v) continue;
          const key = v.split(']', 1)[0] + ']';
          if (lrcCnMap[key] && lrcCnMap[key] !== '//') {
            lrcArr[i] = v + ' (' + lrcCnMap[key] + ')';
            delete lrcCnMap[key];
          }
        }
        lrc = lrcArr.join('\n');
      } else {
        lrc = lrcData.lyric;
      }
      response.end(lrc);
    } else if (type === 'name' || type === 'artist') {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const rawSong = await api.song(id);
      if (!rawSong || rawSong === '[]') {
        response.end('');
        return;
      }
      const arr = JSON.parse(rawSong);
      const val = type === 'name' ? (arr[0]?.name || '') : (Array.isArray(arr[0]?.artist) ? arr[0].artist.join('/') : (arr[0]?.artist || ''));
      response.end(val);
    } else {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json');
      response.end('{"error":"unknown type"}');
    }
  } catch (err) {
    console.error('Meting API error:', err);
    response.statusCode = 500;
    response.setHeader('Content-Type', 'application/json');
    response.end('{"error":"server error","message":"' + String(err.message || err) + '"}');
  }
};
