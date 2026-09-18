// Simulate what api/index.js does for tencent url

const Meting = require('./lib/meting');

(async () => {
  const api = new Meting('tencent');
  api.format(true);

  console.log('=== Test 1: tencent url for playlist song ===');
  let result = await api.url('000gSamd0iOZcj', 320);
  console.log('raw result (first 300):', result.substring(0, 300));
  
  let urlData;
  try {
    urlData = JSON.parse(result);
    console.log('parsed ok');
  } catch(e) {
    console.error('parse fail:', e.message);
    urlData = {};
  }
  
  console.log('url:', urlData.url ? 'OK (' + urlData.url.length + ' chars)' : 'EMPTY');
  console.log('br:', urlData.br, 'size:', urlData.size);
  
  if (urlData.url) {
    let finalUrl = urlData.url;
    if (finalUrl.startsWith('http://')) {
      finalUrl = finalUrl.replace('http://', 'https://');
    }
    console.log('final url (first 100):', finalUrl.substring(0, 100));
    
    // Try to HEAD this URL
    try {
      const res = await fetch(finalUrl, { method: 'HEAD', redirect: 'follow' });
      console.log('CDN response:', res.status, res.headers.get('content-type'), res.headers.get('content-length'));
    } catch(e) {
      console.log('CDN HEAD error:', e.message);
    }
  }

  console.log('\n=== Test 2: netease url ===');
  const api2 = new Meting('netease');
  api2.format(true);
  result = await api2.url('473403185', 320);
  console.log('raw result (first 300):', result.substring(0, 300));
  urlData = JSON.parse(result);
  console.log('url:', urlData.url ? 'OK' : 'EMPTY');

  console.log('\n=== Test 3: Full handler simulation for tencent ===');
  // Simulate buildSong + url call
  const tencentApi = new Meting('tencent');
  tencentApi.format(true);
  const playlist = JSON.parse(await tencentApi.playlist('7326220405'));
  console.log('playlist has', playlist.length, 'songs');
  console.log('first song:', playlist[0].name, 'url_id:', playlist[0].url_id);
  
  // Try getting URL for each of first 3 songs
  for (let i = 0; i < 3; i++) {
    const sid = playlist[i].url_id;
    const urlRes = await tencentApi.url(sid, 320);
    const u = JSON.parse(urlRes);
    console.log('  [' + i + '] ' + playlist[i].name + ' -> url:', u.url ? 'OK (' + u.url.substring(0, 60) + '...)' : 'EMPTY!');
  }
})();
