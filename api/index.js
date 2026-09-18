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
const TLYRIC = true;       // 显示中文歌词
const AUTH = false;        // 是否开启 AUTH
const AUTH_SECRET = 'meting-secret';

function apiUri(request) {
  const host = request.headers.host || '';
  const proto = (request.headers['x-forwarded-proto'] || 'http').split(',')[0];
  const url = new URL(request.url, proto + '://' + host);
  return proto + '://' + host + url.pathname;
}

function auth(name) {
  return crypto.createHmac('sha1', AUTH_SECRET).update(name).digest('hex');
}

async function song2data(api, song, type, id, API_URI) {
  if (type === 'name') return song ? song.name : '';
  if (type === 'artist') {
    if (!song) return '';
    return Array.isArray(song.artist) ? song.artist.join('/') : song.artist;
  }

  if (type === 'url') {
    const urlData = JSON.parse(await api.url(id, 320));
    let mUrl = urlData.url;
    if (!mUrl) return '';
    if (mUrl.startsWith('http://')) {
      mUrl = mUrl.replace('http://', 'https://');
    }
    return mUrl;
  }

  if (type === 'pic') {
    return JSON.parse(await api.pic(id, 90)).url;
  }

  if (type === 'lrc') {
    const lrcData = JSON.parse(await api.lyric(id));
    let lrc;
    if (!lrcData.lyric || lrcData.lyric.trim() === '') {
      lrc = '[00:00.00]这似乎是一首纯音乐呢，请尽情欣赏它吧！';
    } else if (!lrcData.tlyric || lrcData.tlyric.trim() === '') {
      lrc = lrcData.lyric;
    } else if (TLYRIC) {
      const lrcArr = lrcData.lyric.split('\n');
      const lrcCnArr = lrcData.tlyric.split('\n');
      const lrcCnMap = {};
      for (const v of lrcCnArr) {
        if (!v) continue;
        const parts = v.split(']', 2);
        const key = parts[0] + ']';
        const value = (parts[1] || '').replace(/\s+/g, ' ').trim();
        lrcCnMap[key] = value;
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
    return lrc;
  }

  if (type === 'song') {
    return JSON.stringify([{
      name: song.name,
      artist: Array.isArray(song.artist) ? song.artist.join('/') : song.artist,
      url: API_URI + '?server=' + song.source + '&type=url&id=' + song.url_id + (AUTH ? '&auth=' + auth(song.source + 'url' + song.url_id) : ''),
      pic: API_URI + '?server=' + song.source + '&type=pic&id=' + song.pic_id + (AUTH ? '&auth=' + auth(song.source + 'pic' + song.pic_id) : ''),
      lrc: API_URI + '?server=' + song.source + '&type=lrc&id=' + song.lyric_id + (AUTH ? '&auth=' + auth(song.source + 'lrc' + song.lyric_id) : ''),
    }]);
  }

  return '';
}

// Content-Type mapping for common file extensions
const CONTENT_TYPE_MAP = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

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

// Proxy remote file with Range support
async function proxyRemoteFile(url, request, response, fallbackContentType) {
  // Forward Range header for seek support
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://y.qq.com/',
  };
  if (request.headers.range) {
    headers['Range'] = request.headers.range;
  }

  try {
    const remoteRes = await fetch(url, { headers });
    
    // Copy relevant response headers
    const contentType = getContentType(url, remoteRes.headers.get('content-type') || fallbackContentType);
    response.setHeader('Content-Type', contentType);
    
    const contentLength = remoteRes.headers.get('content-length');
    if (contentLength) {
      response.setHeader('Content-Length', contentLength);
    }
    
    const acceptRanges = remoteRes.headers.get('accept-ranges');
    if (acceptRanges) {
      response.setHeader('Accept-Ranges', acceptRanges);
    } else {
      response.setHeader('Accept-Ranges', 'bytes');
    }
    
    // Handle status code (especially 206 Partial Content for range requests)
    const statusCode = remoteRes.status || 200;
    response.statusCode = statusCode;
    
    // Copy Content-Range header for 206 responses
    if (statusCode === 206) {
      const contentRange = remoteRes.headers.get('content-range');
      if (contentRange) {
        response.setHeader('Content-Range', contentRange);
      }
    }
    
    // Cache control
    response.setHeader('Cache-Control', 'public, max-age=3600');
    response.setHeader('Access-Control-Allow-Origin', '*');
    
    // Stream the response body
    if (remoteRes.body && typeof remoteRes.body.pipe === 'function') {
      // Node.js Readable stream
      remoteRes.body.pipe(response);
    } else if (remoteRes.body && typeof remoteRes.body.getReader === 'function') {
      // Web Streams API
      const reader = remoteRes.body.getReader();
      const write = (chunk) => new Promise((resolve) => {
        if (!response.write(chunk)) {
          response.once('drain', resolve);
        } else {
          resolve();
        }
      });
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await write(value);
        }
        response.end();
      } catch (pipeErr) {
        try { response.end(); } catch {}
      }
    } else {
      // Fallback: get all as buffer and send
      const buffer = Buffer.from(await remoteRes.arrayBuffer());
      response.end(buffer);
    }
  } catch (err) {
    console.error('Proxy error:', err.message);
    response.statusCode = 502;
    response.end('Proxy Error');
  }
}

module.exports = async function handler(request, response) {
  const { query } = request;

  // No params → redirect to docs
  if (!query.type || !query.id) {
    response.statusCode = 302;
    response.setHeader('Location', '/docs/');
    response.end();
    return;
  }

  const server = query.server || 'netease';
  const type = query.type;
  const id = query.id;

  // Auth check
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

  // CORS
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const api = new Meting(server);
    api.format(true);

    // API_URI for constructing song URLs
    const API_URI = apiUri(request);

    // Build song entry with proper URL construction
    function buildSong(song) {
      return {
        name: song.name,
        artist: Array.isArray(song.artist) ? song.artist.join('/') : song.artist,
        url: API_URI + '?server=' + song.source + '&type=url&id=' + song.url_id + (AUTH ? '&auth=' + auth(song.source + 'url' + song.url_id) : ''),
        pic: API_URI + '?server=' + song.source + '&type=pic&id=' + song.pic_id + (AUTH ? '&auth=' + auth(song.source + 'pic' + song.pic_id) : ''),
        lrc: API_URI + '?server=' + song.source + '&type=lrc&id=' + song.lyric_id + (AUTH ? '&auth=' + auth(song.source + 'lrc' + song.lyric_id) : ''),
      };
    }

    // Types that return a list of songs (like playlist)
    if (['playlist', 'artist', 'search'].includes(type)) {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      let rawData;
      if (type === 'playlist') {
        rawData = await api.playlist(id);
      } else if (type === 'artist') {
        rawData = await api.artist(id);
      } else if (type === 'search') {
        rawData = await api.search(id);
      }
      if (!rawData || rawData === '[]') {
        response.statusCode = 200;
        response.end('{"error":"unknown ' + type + ' id"}');
        return;
      }
      const data = JSON.parse(rawData);
      const result = data.map(buildSong);
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
      response.end(JSON.stringify([buildSong(arr[0])]));
    } else if (type === 'url' || type === 'pic') {
      // Proxy mode for media files — fetch CDN on server side
      const data = await song2data(api, null, type, id, API_URI);
      if (!data || !data.startsWith('http')) {
        response.statusCode = 404;
        response.setHeader('Content-Type', 'application/json');
        response.end('{"error":"no data"}');
        return;
      }
      await proxyRemoteFile(data, request, response, type === 'url' ? 'audio/mpeg' : 'image/jpeg');
    } else if (type === 'lrc') {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const data = await song2data(api, null, type, id, API_URI);
      response.end(data);
    } else if (type === 'name' || type === 'artist') {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      // These need the song object, let's fetch it
      const rawSong = await api.song(id);
      if (!rawSong || rawSong === '[]') {
        response.statusCode = 200;
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
