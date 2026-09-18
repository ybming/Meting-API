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
  if (type === 'name') return song.name;
  if (type === 'artist') return Array.isArray(song.artist) ? song.artist.join('/') : song.artist;

  if (type === 'url') {
    const urlData = JSON.parse(await api.url(id, 320));
    let mUrl = urlData.url;
    if (!mUrl) return '';
    if (api.server === 'netease') {
      if (mUrl[4] !== 's') mUrl = mUrl.replace('http://', 'https://');
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

function returnData(type, data, response) {
  if ((type === 'url' || type === 'pic') && data && data.startsWith('http')) {
    response.status(302).setHeader('Location', data);
    response.end();
  } else {
    response.send(data);
  }
}

module.exports = async function handler(request, response) {
  const { query } = request;

  // No params → redirect to docs
  if (!query.type || !query.id) {
    response.redirect('/docs/');
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
        response.status(403).send('Forbidden');
        return;
      }
    }
  }

  // Content-Type
  if (['song', 'playlist'].includes(type)) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
  } else if (['name', 'lrc', 'artist'].includes(type)) {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  }

  // CORS
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const api = new Meting(server);
    api.format(true);

    // API_URI for constructing song URLs
    const API_URI = apiUri(request);

    if (type === 'playlist') {
      const rawData = await api.playlist(id);
      if (!rawData || rawData === '[]') {
        response.status(200).send('{"error":"unknown playlist id"}');
        return;
      }
      const data = JSON.parse(rawData);
      const playlist = [];
      for (const song of data) {
        playlist.push({
          name: song.name,
          artist: Array.isArray(song.artist) ? song.artist.join('/') : song.artist,
          url: API_URI + '?server=' + song.source + '&type=url&id=' + song.url_id + (AUTH ? '&auth=' + auth(song.source + 'url' + song.url_id) : ''),
          pic: API_URI + '?server=' + song.source + '&type=pic&id=' + song.pic_id + (AUTH ? '&auth=' + auth(song.source + 'pic' + song.pic_id) : ''),
          lrc: API_URI + '?server=' + song.source + '&type=lrc&id=' + song.lyric_id + (AUTH ? '&auth=' + auth(song.source + 'lrc' + song.lyric_id) : ''),
        });
      }
      response.send(JSON.stringify(playlist));
    } else {
      const needSong = !['url', 'pic', 'lrc'].includes(type);
      if (needSong && !['name', 'artist', 'song'].includes(type)) {
        response.status(200).send('{"error":"unknown type"}');
        return;
      }

      let song;
      if (needSong) {
        const rawSong = await api.song(id);
        if (!rawSong || rawSong === '[]') {
          response.status(200).send('{"error":"unknown song"}');
          return;
        }
        const arr = JSON.parse(rawSong);
        song = arr[0];
      }

      const data = await song2data(api, song, type, id, API_URI);
      if (!data) {
        response.status(404).send('{"error":"no data"}');
        return;
      }
      returnData(type, data, response);
    }
  } catch (err) {
    console.error('Meting API error:', err);
    response.status(500).send('{"error":"server error","message":"' + String(err.message || err) + '"}');
  }
};
