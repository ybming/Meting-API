/**
 * Meting music framework (Node.js port)
 * https://i-meto.com
 * https://github.com/metowolf/Meting
 * Version 1.5.10 (ported from PHP)
 *
 * Copyright 2019, METO Sheel <i@i-meto.com>
 * Released under the MIT license
 */

const crypto = require('crypto');

class Meting {
  constructor(value = 'netease') {
    this.raw = '';
    this.data = '';
    this.info = {};
    this.error = 0;
    this.status = '';
    this.server = 'netease';
    this.proxy = null;
    this._format = false;
    this.header = {};
    this.temp = {};
    this.site(value);
  }

  site(value) {
    const suppose = ['netease', 'tencent', 'xiami', 'kugou', 'baidu', 'kuwo'];
    this.server = suppose.includes(value) ? value : 'netease';
    this.header = this._curlset();
    return this;
  }

  cookie(value) {
    this.header['Cookie'] = value;
    return this;
  }

  format(value = true) {
    this._format = value;
    return this;
  }

  proxy(value) {
    this.proxy = value;
    return this;
  }

  // -------------------- Core HTTP --------------------

  async _exec(api) {
    if (api.encode) {
      api = await this[api.encode](api);
    }
    if (api.method === 'GET') {
      if (api.body) {
        api.url += '?' + new URLSearchParams(api.body).toString();
        api.body = null;
      }
    }

    await this._curl(api.url, api.body);

    if (!this._format) {
      return this.raw;
    }

    this.data = this.raw;

    if (api.decode) {
      this.data = await this[api.decode](this.data);
    }
    if (api.format) {
      this.data = this._clean(this.data, api.format);
    }

    return this.data;
  }

  async _curl(url, payload = null) {
    const headers = { ...this.header };
    let options = {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    };

    if (payload) {
      options.method = 'POST';
      if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
        options.body = payload;
      } else {
        options.body = new URLSearchParams(payload).toString();
      }
    }

    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(url, options);
        this.raw = await res.text();
        this.info = {
          http_code: res.status,
          url: res.url,
        };
        this.error = 0;
        this.status = '';
        break;
      } catch (e) {
        this.error = e.code || 'CURL_ERROR';
        this.status = e.message;
        if (i === 2) break;
      }
    }
    return this;
  }

  _pickup(array, rule) {
    const t = rule.split('.');
    for (const vo of t) {
      if (array === null || array === undefined || !(vo in array)) {
        return [];
      }
      array = array[vo];
    }
    return array;
  }

  _clean(raw, rule) {
    let r;
    try {
      r = JSON.parse(raw);
    } catch (e) {
      r = raw;
    }
    if (!rule) {
      // use raw result directly
    } else {
      r = this._pickup(r, rule);
    }
    if (!Array.isArray(r)) {
      if (r && typeof r === 'object') {
        r = [r];
      } else {
        return JSON.stringify(r);
      }
    }
    const fn = this['_format_' + this.server];
    if (!fn) return JSON.stringify(r);
    const result = r.map(item => fn.call(this, item));
    return JSON.stringify(result);
  }

  // -------------------- Search --------------------

  async search(keyword, option = null) {
    let api;
    const limit = option && option.limit ? option.limit : 30;
    const page = option && option.page ? option.page : 1;
    switch (this.server) {
      case 'netease':
        api = {
          method: 'POST',
          url: 'http://music.163.com/api/cloudsearch/pc',
          body: {
            s: keyword,
            type: option && option.type ? option.type : 1,
            limit: limit,
            total: 'true',
            offset: (page - 1) * limit,
          },
          encode: '_netease_AESCBC',
          format: 'result.songs',
        };
        break;
      case 'tencent':
        api = {
          method: 'GET',
          url: 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp',
          body: { format: 'json', p: page, n: limit, w: keyword, aggr: 1, lossless: 1, cr: 1, new_json: 1 },
          format: 'data.song.list',
        };
        break;
      case 'xiami':
        api = {
          method: 'GET',
          url: 'https://acs.m.xiami.com/h5/mtop.alimusic.search.searchservice.searchsongs/1.0/',
          body: {
            data: JSON.stringify({ key: keyword, pagingVO: { page: page, pageSize: limit } }),
            r: 'mtop.alimusic.search.searchservice.searchsongs',
          },
          encode: '_xiami_sign',
          format: 'data.data.songs',
        };
        break;
      case 'kugou':
        api = {
          method: 'GET',
          url: 'http://mobilecdn.kugou.com/api/v3/search/song',
          body: { api_ver: 1, area_code: 1, correct: 1, pagesize: limit, plat: 2, tag: 1, sver: 5, showtype: 10, page: page, keyword: keyword, version: 8990 },
          format: 'data.info',
        };
        break;
      case 'baidu':
        api = {
          method: 'GET',
          url: 'http://musicapi.taihe.com/v1/restserver/ting',
          body: { from: 'qianqianmini', method: 'baidu.ting.search.merge', isNew: 1, platform: 'darwin', page_no: page, query: keyword, version: '11.2.1', page_size: limit },
          format: 'result.song_info.song_list',
        };
        break;
      case 'kuwo':
        api = {
          method: 'GET',
          url: 'http://www.kuwo.cn/api/www/search/searchMusicBykeyWord',
          body: { key: keyword, pn: page, rn: limit, httpsStatus: 1 },
          format: 'data.list',
        };
        break;
    }
    return await this._exec(api);
  }

  // -------------------- Song --------------------

  async song(id) {
    let api;
    switch (this.server) {
      case 'netease':
        api = {
          method: 'POST',
          url: 'http://music.163.com/api/v3/song/detail/',
          body: { c: '[{"id":' + id + ',"v":0}]' },
          encode: '_netease_AESCBC',
          format: 'songs',
        };
        break;
      case 'tencent':
        api = {
          method: 'GET',
          url: 'https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg',
          body: { songmid: id, platform: 'yqq', format: 'json' },
          format: 'data',
        };
        break;
      case 'xiami':
        api = {
          method: 'GET',
          url: 'https://acs.m.xiami.com/h5/mtop.alimusic.music.songservice.getsongdetail/1.0/',
          body: {
            data: JSON.stringify({ songId: id }),
            r: 'mtop.alimusic.music.songservice.getsongdetail',
          },
          encode: '_xiami_sign',
          format: 'data.data.songDetail',
        };
        break;
      case 'kugou':
        api = {
          method: 'POST',
          url: 'http://m.kugou.com/app/i/getSongInfo.php',
          body: { cmd: 'playInfo', hash: id, from: 'mkugou' },
          format: '',
        };
        break;
      case 'baidu':
        api = {
          method: 'GET',
          url: 'http://musicapi.taihe.com/v1/restserver/ting',
          body: { from: 'qianqianmini', method: 'baidu.ting.song.getInfos', songid: id, res: 1, platform: 'darwin', version: '1.0.0' },
          encode: '_baidu_AESCBC',
          format: 'songinfo',
        };
        break;
      case 'kuwo':
        api = {
          method: 'GET',
          url: 'http://www.kuwo.cn/api/www/music/musicInfo',
          body: { mid: id, httpsStatus: 1 },
          format: 'data',
        };
        break;
    }
    return await this._exec(api);
  }

  // -------------------- Album --------------------

  async album(id) {
    let api;
    switch (this.server) {
      case 'netease':
        api = {
          method: 'POST',
          url: 'http://music.163.com/api/v1/album/' + id,
          body: { total: 'true', offset: '0', id: id, limit: '1000', ext: 'true', private_cloud: 'true' },
          encode: '_netease_AESCBC',
          format: 'songs',
        };
        break;
      case 'tencent':
        api = {
          method: 'GET',
          url: 'https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_detail_cp.fcg',
          body: { albummid: id, platform: 'mac', format: 'json', newsong: 1 },
          format: 'data.getSongInfo',
        };
        break;
      case 'xiami':
        api = {
          method: 'GET',
          url: 'https://acs.m.xiami.com/h5/mtop.alimusic.music.albumservice.getalbumdetail/1.0/',
          body: {
            data: JSON.stringify({ albumId: id }),
            r: 'mtop.alimusic.music.albumservice.getalbumdetail',
          },
          encode: '_xiami_sign',
          format: 'data.data.albumDetail.songs',
        };
        break;
      case 'kugou':
        api = {
          method: 'GET',
          url: 'http://mobilecdn.kugou.com/api/v3/album/song',
          body: { albumid: id, area_code: 1, plat: 2, page: 1, pagesize: -1, version: 8990 },
          format: 'data.info',
        };
        break;
      case 'baidu':
        api = {
          method: 'GET',
          url: 'http://musicapi.taihe.com/v1/restserver/ting',
          body: { from: 'qianqianmini', method: 'baidu.ting.album.getAlbumInfo', album_id: id, platform: 'darwin', version: '11.2.1' },
          format: 'songlist',
        };
        break;
      case 'kuwo':
        api = {
          method: 'GET',
          url: 'http://www.kuwo.cn/api/www/playlist/playListInfo',
          body: { pid: id, httpsStatus: 1 },
          format: 'data.musicList',
        };
        break;
    }
    return await this._exec(api);
  }

  // -------------------- Artist --------------------

  async artist(id, limit = 50) {
    let api;
    switch (this.server) {
      case 'netease':
        api = {
          method: 'POST',
          url: 'http://music.163.com/api/v1/artist/' + id,
          body: { ext: 'true', private_cloud: 'true', top: limit, id: id },
          encode: '_netease_AESCBC',
          format: 'hotSongs',
        };
        break;
      case 'tencent':
        api = {
          method: 'GET',
          url: 'https://c.y.qq.com/v8/fcg-bin/fcg_v8_singer_track_cp.fcg',
          body: { singermid: id, begin: 0, num: limit, order: 'listen', platform: 'mac', newsong: 1 },
          format: 'data.list',
        };
        break;
      case 'xiami':
        api = {
          method: 'GET',
          url: 'https://acs.m.xiami.com/h5/mtop.alimusic.music.songservice.getartistsongs/1.0/',
          body: {
            data: JSON.stringify({ artistId: id, pagingVO: { page: 1, pageSize: limit } }),
            r: 'mtop.alimusic.music.songservice.getartistsongs',
          },
          encode: '_xiami_sign',
          format: 'data.data.songs',
        };
        break;
      case 'kugou':
        api = {
          method: 'GET',
          url: 'http://mobilecdn.kugou.com/api/v3/singer/song',
          body: { singerid: id, area_code: 1, page: 1, plat: 0, pagesize: limit, version: 8990 },
          format: 'data.info',
        };
        break;
      case 'baidu':
        api = {
          method: 'GET',
          url: 'http://musicapi.taihe.com/v1/restserver/ting',
          body: { from: 'qianqianmini', method: 'baidu.ting.artist.getSongList', artistid: id, limits: limit, platform: 'darwin', offset: 0, tinguid: 0, version: '11.2.1' },
          format: 'songlist',
        };
        break;
      case 'kuwo':
        api = {
          method: 'GET',
          url: 'http://www.kuwo.cn/api/www/artist/artistMusic',
          body: { artistid: id, httpsStatus: 1 },
          format: 'data.list',
        };
        break;
    }
    return await this._exec(api);
  }

  // -------------------- Playlist --------------------

  async playlist(id) {
    let api;
    switch (this.server) {
      case 'netease':
        api = {
          method: 'POST',
          url: 'http://music.163.com/api/v6/playlist/detail',
          body: { s: '0', id: id, n: '1000', t: '0' },
          encode: '_netease_AESCBC',
          format: 'playlist.tracks',
        };
        break;
      case 'tencent':
        api = {
          method: 'GET',
          url: 'https://c.y.qq.com/v8/fcg-bin/fcg_v8_playlist_cp.fcg',
          body: { id: id, format: 'json', newsong: 1, platform: 'jqspaframe.json' },
          format: 'data.cdlist.0.songlist',
        };
        break;
      case 'xiami':
        api = {
          method: 'GET',
          url: 'https://acs.m.xiami.com/h5/mtop.alimusic.music.list.collectservice.getcollectdetail/1.0/',
          body: {
            data: JSON.stringify({ listId: id, isFullTags: false, pagingVO: { page: 1, pageSize: 1000 } }),
            r: 'mtop.alimusic.music.list.collectservice.getcollectdetail',
          },
          encode: '_xiami_sign',
          format: 'data.data.collectDetail.songs',
        };
        break;
      case 'kugou':
        api = {
          method: 'GET',
          url: 'http://mobilecdn.kugou.com/api/v3/special/song',
          body: { specialid: id, area_code: 1, page: 1, plat: 2, pagesize: -1, version: 8990 },
          format: 'data.info',
        };
        break;
      case 'baidu':
        api = {
          method: 'GET',
          url: 'http://musicapi.taihe.com/v1/restserver/ting',
          body: { from: 'qianqianmini', method: 'baidu.ting.diy.gedanInfo', listid: id, platform: 'darwin', version: '11.2.1' },
          format: 'content',
        };
        break;
      case 'kuwo':
        api = {
          method: 'GET',
          url: 'http://www.kuwo.cn/api/www/playlist/playListInfo',
          body: { pid: id, httpsStatus: 1 },
          format: 'data.musicList',
        };
        break;
    }
    return await this._exec(api);
  }

  // -------------------- URL --------------------

  async url(id, br = 320) {
    let api;
    switch (this.server) {
      case 'netease':
        api = {
          method: 'POST',
          url: 'http://music.163.com/api/song/enhance/player/url',
          body: { ids: '[' + id + ']', br: br * 1000 },
          encode: '_netease_AESCBC',
          decode: '_netease_url',
        };
        break;
      case 'tencent':
        api = {
          method: 'GET',
          url: 'https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg',
          body: { songmid: id, platform: 'yqq', format: 'json' },
          decode: '_tencent_url',
        };
        break;
      case 'xiami':
        api = {
          method: 'GET',
          url: 'https://acs.m.xiami.com/h5/mtop.alimusic.music.songservice.getsongs/1.0/',
          body: {
            data: JSON.stringify({ songIds: [id] }),
            r: 'mtop.alimusic.music.songservice.getsongs',
          },
          encode: '_xiami_sign',
          decode: '_xiami_url',
        };
        break;
      case 'kugou':
        api = {
          method: 'POST',
          url: 'http://media.store.kugou.com/v1/get_res_privilege',
          body: JSON.stringify({
            relate: 1, userid: '0', vip: 0, appid: 1000, token: '', behavior: 'download', area_code: '1', clientver: '8990',
            resource: [{ id: 0, type: 'audio', hash: id }],
          }),
          decode: '_kugou_url',
        };
        break;
      case 'baidu':
        api = {
          method: 'GET',
          url: 'http://musicapi.taihe.com/v1/restserver/ting',
          body: { from: 'qianqianmini', method: 'baidu.ting.song.getInfos', songid: id, res: 1, platform: 'darwin', version: '1.0.0' },
          encode: '_baidu_AESCBC',
          decode: '_baidu_url',
        };
        break;
      case 'kuwo':
        api = {
          method: 'GET',
          url: 'http://www.kuwo.cn/url',
          body: { rid: id, response: 'url', type: 'convert_url3', br: '128kmp3', from: 'web', t: Math.floor(Date.now() / 1000), httpsStatus: 1 },
          decode: '_kuwo_url',
        };
        break;
    }
    this.temp.br = br;
    return await this._exec(api);
  }

  // -------------------- Lyric --------------------

  async lyric(id) {
    let api;
    switch (this.server) {
      case 'netease':
        api = {
          method: 'POST',
          url: 'http://music.163.com/api/song/lyric',
          body: { id: id, os: 'linux', lv: -1, kv: -1, tv: -1 },
          encode: '_netease_AESCBC',
          decode: '_netease_lyric',
        };
        break;
      case 'tencent':
        api = {
          method: 'GET',
          url: 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
          body: { songmid: id, g_tk: '5381' },
          decode: '_tencent_lyric',
        };
        break;
      case 'xiami':
        api = {
          method: 'GET',
          url: 'https://acs.m.xiami.com/h5/mtop.alimusic.music.lyricservice.getsonglyrics/1.0/',
          body: {
            data: JSON.stringify({ songId: id }),
            r: 'mtop.alimusic.music.lyricservice.getsonglyrics',
          },
          encode: '_xiami_sign',
          decode: '_xiami_lyric',
        };
        break;
      case 'kugou':
        api = {
          method: 'GET',
          url: 'http://krcs.kugou.com/search',
          body: { keyword: '%20-%20', ver: 1, hash: id, client: 'mobi', man: 'yes' },
          decode: '_kugou_lyric',
        };
        break;
      case 'baidu':
        api = {
          method: 'GET',
          url: 'http://musicapi.taihe.com/v1/restserver/ting',
          body: { from: 'qianqianmini', method: 'baidu.ting.song.lry', songid: id, platform: 'darwin', version: '1.0.0' },
          decode: '_baidu_lyric',
        };
        break;
      case 'kuwo':
        api = {
          method: 'GET',
          url: 'http://m.kuwo.cn/newh5/singles/songinfoandlrc',
          body: { musicId: id, httpsStatus: 1 },
          decode: '_kuwo_lyric',
        };
        break;
    }
    return await this._exec(api);
  }

  // -------------------- Pic --------------------

  async pic(id, size = 300) {
    let url;
    switch (this.server) {
      case 'netease':
        url = 'https://p3.music.126.net/' + this._netease_encryptId(id) + '/' + id + '.jpg?param=' + size + 'y' + size;
        break;
      case 'tencent':
        url = 'https://y.gtimg.cn/music/photo_new/T002R' + size + 'x' + size + 'M000' + id + '.jpg?max_age=2592000';
        break;
      case 'xiami':
      case 'kugou':
      case 'baidu':
      case 'kuwo': {
        const originalFormat = this._format;
        this._format = false;
        const data = JSON.parse(await this.song(id));
        this._format = originalFormat;
        if (this.server === 'xiami') {
          url = data.data.data.songDetail.albumLogo;
          url = url.replace('http:', 'https:') + '@1e_1c_100Q_' + size + 'h_' + size + 'w';
        } else if (this.server === 'kugou') {
          url = data.imgUrl;
          url = url.replace('{size}', '400');
        } else if (this.server === 'baidu') {
          url = (data.songinfo && (data.songinfo.pic_radio || data.songinfo.pic_small)) || '';
        } else if (this.server === 'kuwo') {
          url = (data.data && (data.data.pic || data.data.albumpic)) || '';
        }
        break;
      }
    }
    return JSON.stringify({ url: url });
  }

  // -------------------- Headers --------------------

  _curlset() {
    switch (this.server) {
      case 'netease':
        return {
          Referer: 'https://music.163.com/',
          Cookie: 'appver=8.2.30; os=iPhone OS; osver=15.0; EVNSM=1.0.0; buildver=2206; channel=distribution; machineid=iPhone13.3',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 CloudMusic/0.1.1 NeteaseMusic/8.2.30',
          'X-Real-IP': this._long2ip(Math.floor(Math.random() * (1884890111 - 1884815360 + 1) + 1884815360)),
          Accept: '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.8,gl;q=0.6,zh-TW;q=0.4',
          Connection: 'keep-alive',
          'Content-Type': 'application/x-www-form-urlencoded',
        };
      case 'tencent':
        return {
          Referer: 'http://y.qq.com',
          Cookie: 'pgv_pvi=22038528; pgv_si=s3156287488; pgv_pvid=5535248600; yplayer_open=1; ts_last=y.qq.com/portal/player.html; ts_uid=4847550686; yq_index=0; qqmusic_fromtag=66; player_exist=1',
          'User-Agent': 'QQ%E9%9F%B3%E4%B9%90/54409 CFNetwork/901.1 Darwin/17.6.0 (x86_64)',
          Accept: '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.8,gl;q=0.6,zh-TW;q=0.4',
          Connection: 'keep-alive',
          'Content-Type': 'application/x-www-form-urlencoded',
        };
      case 'xiami':
        return {
          Cookie: '_m_h5_tk=15d3402511a022796d88b249f83fb968_1511163656929; _m_h5_tk_enc=b6b3e64d81dae577fc314b5c5692df3c',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_5) AppleWebKit/537.36 (KHTML, like Gecko) XIAMI-MUSIC/3.1.1 Chrome/56.0.2924.87 Electron/1.6.11 Safari/537.36',
          Accept: 'application/json',
          'Content-type': 'application/x-www-form-urlencoded',
          'Accept-Language': 'zh-CN',
        };
      case 'kugou':
        return {
          'User-Agent': 'IPhone-8990-searchSong',
          'UNI-UserAgent': 'iOS11.4-Phone8990-1009-0-WiFi',
        };
      case 'baidu':
        return {
          Cookie: 'BAIDUID=' + this._randomHex(32) + ':FG=1',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) baidu-music/1.2.1 Chrome/66.0.3359.181 Electron/3.0.5 Safari/537.36',
          Accept: '*/*',
          'Content-type': 'application/json;charset=UTF-8',
          'Accept-Language': 'zh-CN',
        };
      case 'kuwo':
        return {
          Cookie: 'Hm_lvt_cdb524f42f0ce19b169a8071123a4797=1623339177,1623339183; _ga=GA1.2.1195980605.1579367081; Hm_lpvt_cdb524f42f0ce19b169a8071123a4797=1623339982; kw_token=3E7JFQ7MRPL; _gid=GA1.2.747985028.1623339179; _gat=1',
          csrf: '3E7JFQ7MRPL',
          Host: 'www.kuwo.cn',
          Referer: 'http://www.kuwo.cn/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36',
        };
    }
  }

  // -------------------- Helpers --------------------

  _randomHex(length) {
    return crypto.randomBytes(length / 2).toString('hex');
  }

  _long2ip(long) {
    const n = long >>> 0;
    const part1 = (n >>> 24) & 0xff;
    const part2 = (n >>> 16) & 0xff;
    const part3 = (n >>> 8) & 0xff;
    const part4 = n & 0xff;
    return part1 + '.' + part2 + '.' + part3 + '.' + part4;
  }

  _str2hex(str) {
    let hex = '';
    for (let i = 0; i < str.length; i++) {
      const hexCode = str.charCodeAt(i).toString(16);
      hex += ('0' + hexCode).slice(-2);
    }
    return hex;
  }

  _bchexdec(hex) {
    return BigInt('0x' + hex);
  }

  _bcdechex(dec) {
    let n = BigInt(dec);
    let hex = '';
    const sixteen = BigInt(16);
    while (n > 0n) {
      const last = n % sixteen;
      hex = last.toString(16) + hex;
      n = n / sixteen;
    }
    return hex;
  }

  // -------------------- Encoding --------------------

  _aesEncrypt(plaintext, key, iv) {
    const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf-8'), Buffer.from(iv, 'utf-8'));
    let encrypted = cipher.update(plaintext, 'utf-8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  }

  async _netease_AESCBC(api) {
    // PHP modulus & pubkey are DECIMAL strings
    const modulus = '157794750267131502212476817800345498121872783333389747424011531025366277535262539913701806290766479189477533597854989606803194253978660329941980786072432806427833685472618792592200595694346872951301770580765135349259590167490536138082469680638514416594216629258349130257685001248172188325316586707301643237607';
    const pubkey = '65537';  // decimal: 0x10001
    const nonce = '0CoJUm6Qyw8W8jud';
    const vi = '0102030405060708';
    const skey = this._randomHex(16);

    let body = JSON.stringify(api.body);
    body = this._aesEncrypt(body, nonce, vi);
    body = this._aesEncrypt(body, skey, vi);

    // RSA: text reversed → hex → BigInt → powmod → pad to 256 hex chars
    const skeyReversed = skey.split('').reverse().join('');
    const skeyHex = Buffer.from(skeyReversed, 'utf-8').toString('hex');
    const skeyInt = BigInt('0x' + skeyHex);
    const pubInt = BigInt(pubkey);                    // decimal → BigInt
    const modInt = BigInt(modulus);                   // decimal → BigInt (NOT hex!)
    let rsa = skeyInt ** pubInt % modInt;
    let rsaHex = rsa.toString(16);
    while (rsaHex.length < 256) rsaHex = '0' + rsaHex;

    api.url = api.url.replace('/api/', '/weapi/');
    api.body = { params: body, encSecKey: rsaHex };
    return api;
  }

  _baidu_AESCBC(api) {
    const key = 'DBEECF8C50FD160E';
    const vi = '1231021386755796';
    const data = 'songid=' + api.body.songid + '&ts=' + Date.now();
    api.body.e = this._aesEncrypt(data, key, vi);
    return api;
  }

  async _xiami_sign(api) {
    // First request to get cookie tokens
    await this._curl('https://acs.m.xiami.com/h5/mtop.alimusic.recommend.songservice.getdailysongs/1.0/?appKey=12574478&t=1560663823000&dataType=json&api=mtop.alimusic.recommend.songservice.getdailysongs&v=1.0&type=originaljson');
    const headerStr = Object.entries(this.info).map(([k, v]) => k + ': ' + v).join('\n');
    // Extract tokens from raw response (the _curl method just stores body, need headers)
    // Since fetch doesn't give response headers easily from string parsing, let's do a proper fetch call
    const res = await fetch('https://acs.m.xiami.com/h5/mtop.alimusic.recommend.songservice.getdailysongs/1.0/?appKey=12574478&t=1560663823000&dataType=json&api=mtop.alimusic.recommend.songservice.getdailysongs&v=1.0&type=originaljson', {
      method: 'GET',
      redirect: 'follow',
    });
    const setCookie = res.headers.getSetCookie() || [];
    const tokens = [];
    for (const c of setCookie) {
      const match = c.match(/_m_h5[^;]+/);
      if (match) tokens.push(match[0]);
    }
    if (tokens.length >= 2) {
      this.header.Cookie = tokens[0] + '; ' + tokens[1];
    }

    const data = JSON.stringify({ header: { platformId: 'mac' }, model: api.body.data });
    const appkey = '12574478';
    const cookie = this.header.Cookie || '';
    const tokenMatch = cookie.match(/_m_h5_tk=([^_]+)/);
    const token = tokenMatch ? tokenMatch[1] : '';
    const t = Date.now();
    const sign = crypto.createHash('md5').update(token + '&' + t + '&' + appkey + '&' + data).digest('hex');
    api.body = { appKey: appkey, t: t, dataType: 'json', data: data, api: api.body.r, v: '1.0', type: 'originaljson', sign: sign };
    return api;
  }

  _netease_encryptId(id) {
    const magic = '3go8&$8*3*3h0k(2)2';
    let result = '';
    for (let i = 0; i < id.length; i++) {
      result += String.fromCharCode(id.charCodeAt(i) ^ magic.charCodeAt(i % magic.length));
    }
    let md5 = crypto.createHash('md5').update(result).digest();
    let base64 = md5.toString('base64');
    base64 = base64.replace(/\//g, '_').replace(/\+/g, '-');
    return base64;
  }

  // -------------------- Decode --------------------

  _netease_url(result) {
    let data;
    try { data = JSON.parse(result); } catch { data = {}; }
    let urlObj = { url: '', size: 0, br: -1 };
    if (data && data.data && data.data[0]) {
      if (data.data[0].uf && data.data[0].uf.url) {
        data.data[0].url = data.data[0].uf.url;
      }
      if (data.data[0].url) {
        urlObj = { url: data.data[0].url, size: data.data[0].size || 0, br: (data.data[0].br || 0) / 1000 };
      }
    }
    return JSON.stringify(urlObj);
  }

  async _tencent_url(result) {
    let data;
    try { data = JSON.parse(result); } catch { data = { data: [{ mid: '', file: {} }] }; }
    const guid = Math.floor(Math.random() * 10000000000);
    const typeList = [
      ['size_flac', 999, 'F000', 'flac'],
      ['size_320mp3', 320, 'M800', 'mp3'],
      ['size_192aac', 192, 'C600', 'm4a'],
      ['size_128mp3', 128, 'M500', 'mp3'],
      ['size_96aac', 96, 'C400', 'm4a'],
      ['size_48aac', 48, 'C200', 'm4a'],
      ['size_24aac', 24, 'C100', 'm4a'],
    ];
    let uin = '0';
    const cookieMatch = (this.header.Cookie || '').match(/uin=(\d+)/);
    if (cookieMatch) uin = cookieMatch[1];
    const payload = {
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          guid: String(guid),
          songmid: [],
          filename: [],
          songtype: [],
          uin: uin,
          loginflag: 1,
          platform: '20',
        },
      },
    };
    for (const vo of typeList) {
      payload.req_0.param.songmid.push(data.data[0].mid);
      payload.req_0.param.filename.push(vo[2] + data.data[0].file.media_mid + '.' + vo[3]);
      payload.req_0.param.songtype.push(data.data[0].type);
    }
    const api2 = {
      method: 'GET',
      url: 'https://u.y.qq.com/cgi-bin/musicu.fcg',
      body: { format: 'json', platform: 'yqq.json', needNewCode: 0, data: JSON.stringify(payload) },
    };
    await this._curl(api2.url + '?' + new URLSearchParams(api2.body).toString());
    let response;
    try { response = JSON.parse(this.raw); } catch { response = {}; }
    const vkeys = response.req_0 && response.req_0.data ? response.req_0.data.midurlinfo : [];
    let urlObj = { url: '', size: 0, br: -1 };
    for (let i = 0; i < typeList.length; i++) {
      const vo = typeList[i];
      if (data.data[0].file && data.data[0].file[vo[0]] && vo[1] <= (this.temp.br || 320)) {
        if (vkeys && vkeys[i] && vkeys[i].vkey) {
          urlObj = {
            url: response.req_0.data.sip[0] + vkeys[i].purl,
            size: data.data[0].file[vo[0]],
            br: vo[1],
          };
          break;
        }
      }
    }
    return JSON.stringify(urlObj);
  }

  _xiami_url(result) {
    let data;
    try { data = JSON.parse(result); } catch { data = {}; }
    const typeMap = { s: 740, h: 320, l: 128, f: 64, e: 32 };
    let max = 0;
    let urlObj = { url: '', size: 0, br: -1 };
    const songs = data.data && data.data.data && data.data.data.songs ? data.data.data.songs : [];
    const listenFiles = songs[0] && songs[0].listenFiles ? songs[0].listenFiles : [];
    for (const vo of listenFiles) {
      const qualityBr = typeMap[vo.quality] || 0;
      if (qualityBr <= (this.temp.br || 320) && qualityBr > max) {
        max = qualityBr;
        urlObj = { url: vo.listenFile, size: vo.fileSize || 0, br: qualityBr };
      }
    }
    return JSON.stringify(urlObj);
  }

  async _kugou_url(result) {
    let data;
    try { data = JSON.parse(result); } catch { data = {}; }
    let max = 0;
    let urlObj = { url: '', size: 0, br: -1 };
    const rel = data.data && data.data[0] && data.data[0].relate_goods ? data.data[0].relate_goods : [];
    for (const vo of rel) {
      const bitrate = vo.info ? vo.info.bitrate : 0;
      if (bitrate <= (this.temp.br || 320) && bitrate > max) {
        const api2 = {
          method: 'GET',
          url: 'http://trackercdn.kugou.com/i/v2/',
          body: { hash: vo.hash, key: crypto.createHash('md5').update(vo.hash + 'kgcloudv2').digest('hex'), pid: 3, behavior: 'play', cmd: '25', version: 8990 },
        };
        await this._curl(api2.url + '?' + new URLSearchParams(api2.body).toString());
        let t;
        try { t = JSON.parse(this.raw); } catch { t = {}; }
        if (t.url && Array.isArray(t.url)) {
          max = (t.bitRate || 0) / 1000;
          urlObj = { url: t.url[0], size: t.fileSize || 0, br: max };
        }
      }
    }
    return JSON.stringify(urlObj);
  }

  _baidu_url(result) {
    let data;
    try { data = JSON.parse(result); } catch { data = {}; }
    let max = 0;
    let urlObj = { url: '', br: -1 };
    const urls = data.songurl && data.songurl.url ? data.songurl.url : [];
    for (const vo of urls) {
      if (vo.file_bitrate <= (this.temp.br || 320) && vo.file_bitrate > max) {
        max = vo.file_bitrate;
        urlObj = { url: vo.file_link, br: vo.file_bitrate };
      }
    }
    return JSON.stringify(urlObj);
  }

  _kuwo_url(result) {
    let data;
    try { data = JSON.parse(result); } catch { data = {}; }
    let urlObj = { url: '', br: -1 };
    if (data.code === 200 && data.url) {
      urlObj = { url: data.url, br: 128 };
    }
    return JSON.stringify(urlObj);
  }

  // -------------------- Lyric Decode --------------------

  _netease_lyric(result) {
    let r;
    try { r = JSON.parse(result); } catch { r = {}; }
    return JSON.stringify({
      lyric: (r.lrc && r.lrc.lyric) || '',
      tlyric: (r.tlyric && r.tlyric.lyric) || '',
    }, null, 2);
  }

  _tencent_lyric(result) {
    let r;
    try { r = JSON.parse(result.substring(18, result.length - 1)); } catch { r = {}; }
    return JSON.stringify({
      lyric: r.lyric ? Buffer.from(r.lyric, 'base64').toString('utf-8') : '',
      tlyric: r.trans ? Buffer.from(r.trans, 'base64').toString('utf-8') : '',
    }, null, 2);
  }

  _xiami_lyric(result) {
    let r;
    try { r = JSON.parse(result); } catch { r = {}; }
    let lyric = '';
    let tlyric = '';
    const lyrics = r.data && r.data.data && r.data.data.lyrics ? r.data.data.lyrics : [];
    if (lyrics.length > 0) {
      let content = lyrics[0].content || '';
      content = content.replace(/<[^>]+>/g, '');
      const regex = /\[([\d:\.]+)\](.*)\s\[x-trans\](.*)/gi;
      let match;
      let A = [];
      let B = [];
      while ((match = regex.exec(content)) !== null) {
        A.push('[' + match[1] + ']' + match[2]);
        B.push('[' + match[1] + ']' + match[3]);
      }
      if (A.length > 0) {
        let lyricStr = content;
        for (let i = 0; i < A.length; i++) {
          lyricStr = lyricStr.replace(A[i] + '  [x-trans]' + B[i], A[i]);
        }
        lyric = lyricStr;
        tlyric = B.join('\n');
      } else {
        lyric = content;
      }
    }
    return JSON.stringify({ lyric: lyric, tlyric: tlyric }, null, 2);
  }

  async _kugou_lyric(result) {
    let r;
    try { r = JSON.parse(result); } catch { r = {}; }
    const api2 = {
      method: 'GET',
      url: 'http://lyrics.kugou.com/download',
      body: {
        charset: 'utf8',
        accesskey: r.candidates && r.candidates[0] ? r.candidates[0].accesskey : '',
        id: r.candidates && r.candidates[0] ? r.candidates[0].id : '',
        client: 'mobi',
        fmt: 'lrc',
        ver: 1,
      },
    };
    await this._curl(api2.url + '?' + new URLSearchParams(api2.body).toString());
    let data;
    try { data = JSON.parse(this.raw); } catch { data = {}; }
    const lyric = data.content ? Buffer.from(data.content, 'base64').toString('utf-8') : '';
    return JSON.stringify({ lyric: lyric, tlyric: '' }, null, 2);
  }

  _baidu_lyric(result) {
    let r;
    try { r = JSON.parse(result); } catch { r = {}; }
    return JSON.stringify({
      lyric: r.lrcContent || '',
      tlyric: '',
    }, null, 2);
  }

  _kuwo_lyric(result) {
    let r;
    try { r = JSON.parse(result); } catch { r = {}; }
    let lyric = '';
    if (r.data && r.data.lrclist && r.data.lrclist.length > 0) {
      for (const item of r.data.lrclist) {
        const otime = item.time;
        const parts = String(otime).split('.');
        const osec = parseInt(parts[0]);
        const min = String(Math.floor(osec / 60)).padStart(2, '0');
        const sec = String(osec - min * 60).padStart(2, '0');
        const msec = parts[1] || '';
        const olyric = item.lineLyric || '';
        lyric += '[' + min + ':' + sec + '.' + msec + ']' + olyric + '\n';
      }
    }
    return JSON.stringify({ lyric: lyric, tlyric: '' }, null, 2);
  }

  // -------------------- Format --------------------

  _format_netease(data) {
    const result = {
      id: data.id,
      name: data.name,
      artist: [],
      album: data.al ? data.al.name : '',
      pic_id: data.al ? (data.al.pic_str || data.al.pic) : '',
      url_id: data.id,
      lyric_id: data.id,
      source: 'netease',
    };
    if (data.al && data.al.picUrl) {
      const m = data.al.picUrl.match(/\/(\d+)\./);
      if (m) result.pic_id = m[1];
    }
    if (data.ar) {
      for (const vo of data.ar) result.artist.push(vo.name);
    }
    return result;
  }

  _format_tencent(data) {
    if (data.musicData) data = data.musicData;
    const result = {
      id: data.mid,
      name: data.name,
      artist: [],
      album: data.album && data.album.title ? data.album.title.trim() : '',
      pic_id: data.album ? data.album.mid : '',
      url_id: data.mid,
      lyric_id: data.mid,
      source: 'tencent',
    };
    if (data.singer) {
      for (const vo of data.singer) result.artist.push(vo.name);
    }
    return result;
  }

  _format_xiami(data) {
    return {
      id: data.songId,
      name: data.songName,
      artist: data.singerVOs ? data.singerVOs.map(v => v.artistName) : [],
      album: data.albumName,
      pic_id: data.songId,
      url_id: data.songId,
      lyric_id: data.songId,
      source: 'xiami',
    };
  }

  _format_kugou(data) {
    return {
      id: data.hash,
      name: data.filename || data.fileName || '',
      artist: data.singer ? data.singer.split('-').map(s => s.trim()).filter(Boolean) : [],
      album: data.album_id || '',
      pic_id: data.imgurl || '',
      url_id: data.hash,
      lyric_id: data.hash,
      source: 'kugou',
    };
  }

  _format_baidu(data) {
    return {
      id: data.songid,
      name: data.songname,
      artist: data.author_name ? [data.author_name] : [],
      album: data.album_name || '',
      pic_id: data.pic_id || '',
      url_id: data.songid,
      lyric_id: data.songid,
      source: 'baidu',
    };
  }

  _format_kuwo(data) {
    return {
      id: data.mid || data.id,
      name: data.name,
      artist: data.artist ? data.artist.split('-').map(s => s.trim()).filter(Boolean) : [],
      album: data.album || '',
      pic_id: data.mid || '',
      url_id: data.mid || data.id,
      lyric_id: data.mid || data.id,
      source: 'kuwo',
    };
  }
}

module.exports = Meting;
