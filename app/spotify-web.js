// spotify-web.js — Spotify Web API: arama + çalma (Authorization Code + PKCE).
// Spotify, 2026'da cihaz-bazlı (device) akışı kaldırdı. Güncel yöntem PKCE'dir ve
// client secret GEREKMEZ (masaüstü uygulamalar için ideal).
//
// Ayarlar: (kullanıcı ev klasörü)/HarleyDosyalar/spotify-config.json → { "clientId": "..." }
// Ayrıca Spotify uygulamasının Redirect URI listesine şunu eklemelisin:
//   http://127.0.0.1:8888/callback
//
// Akış: "Spotify bağla" → tarayıcı açılır → kullanıcı onaylar → yerel callback
// sunucusu kodu yakalar → access+refresh token kaydedilir → "X çal" çalışır.

const https = require('https');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const urlparse = require('url');
const { exec } = require('child_process');
const { FILES } = require('./config');
const secureStore = require('./secure-store');

const CONFIG_FILE = FILES.spotify;
const AUTH_HOST = 'accounts.spotify.com';
const API_HOST = 'api.spotify.com';
const SCOPE = 'user-modify-playback-state user-read-playback-state user-read-currently-playing user-read-private';
const DEFAULT_REDIRECT = 'http://127.0.0.1:8888/callback';

let config = null;
function loadConfig() {
  if (config && config.clientId) return config;
  config = {};
  try { Object.assign(config, secureStore.readJson(CONFIG_FILE)); } catch { /* yok */ }
  if (!config.clientId && process.env.SPOTIFY_CLIENT_ID) config.clientId = process.env.SPOTIFY_CLIENT_ID;
  return config;
}
function saveConfig(patch) {
  const c = loadConfig();
  Object.assign(c, patch);
  try { secureStore.writeJson(CONFIG_FILE, c); } catch { /* yazılamadı */ }
}

function req(host, pathname, method, contentType, bodyBuf, headers) {
  return new Promise((resolve) => {
    const options = {
      hostname: host,
      path: pathname,
      method: method || 'GET',
      headers: Object.assign({ 'Content-Type': contentType || 'application/json', 'Content-Length': bodyBuf ? Buffer.byteLength(bodyBuf) : 0 }, headers || {}),
      timeout: 15000,
    };
    const r = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* değil */ }
        resolve({ status: res.statusCode, body: data, json });
      });
    });
    r.on('error', () => resolve({ status: 0, body: '', json: null }));
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, body: '', json: null }); });
    if (bodyBuf) r.write(bodyBuf);
    r.end();
  });
}

function formEncode(obj) {
  return Object.entries(obj)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)).replace(/%3A/gi, ':'))
    .join('&');
}
function postForm(host, pathname, params) {
  const body = formEncode(params);
  return req(host, pathname, 'POST', 'application/x-www-form-urlencoded', Buffer.from(body));
}
function apiJson(pathname, method, token, bodyObj) {
  return req(API_HOST, pathname, method || 'GET', 'application/json', bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null, { Authorization: 'Bearer ' + token });
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isConfigured() { return !!(loadConfig().clientId); }
function hasToken() {
  const c = loadConfig();
  return !!(c.accessToken || c.refreshToken);
}

async function getAccessToken() {
  const c = loadConfig();
  if (c.accessToken && c.expiresAt && Date.now() < c.expiresAt) return c.accessToken;
  if (c.refreshToken && c.clientId) {
    const res = await postForm(AUTH_HOST, '/api/token', {
      grant_type: 'refresh_token',
      refresh_token: c.refreshToken,
      client_id: c.clientId,
    });
    if (res.json && res.json.access_token) {
      saveConfig({ accessToken: res.json.access_token, expiresAt: Date.now() + (res.json.expires_in - 60) * 1000 });
      if (res.json.refresh_token) saveConfig({ refreshToken: res.json.refresh_token });
      return res.json.access_token;
    }
  }
  return null;
}

// ---- Authorization Code + PKCE ----
let verifier = null;
let authServer = null;

function openInBrowser(url) {
  try {
    const { shell } = require('electron');
    shell.openExternal(url);
  } catch {
    exec('start "" "' + url + '"', { windowsHide: true });
  }
}

// Tam bağlantı akışı: tarayıcıyı aç, kullanıcı onaylasın, callback'i yakala, token al.
// Sohbeti bekletmemek için ANINDA döner; token kaydı arka planda yapılır.
async function connect() {
  const c = loadConfig();
  if (!c.clientId) return { ok: false, message: 'Client ID ayarlı değil. spotify-config.json\'a "clientId" ekle.' };

  verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(18));

  // Yerel callback sunucusu — 8888 doluysa sonraki portları dene.
  const ports = [8888, 8890, 8891, 8892, 8893];
  let callbackPath = '/callback';
  let srv = null;
  let boundPort = null;
  for (const p of ports) {
    const tryBind = () => new Promise((resolve) => {
      const server = http.createServer(() => {});
      const onErr = () => { server.off('error', onErr); resolve(null); };
      server.on('error', onErr);
      server.listen(p, '127.0.0.1', () => { server.off('error', onErr); resolve(server); });
    });
    const got = await tryBind();
    if (got) { srv = got; boundPort = got.address().port; break; }
  }
  if (!srv) return { ok: false, message: 'Spotify callback portları dolu. Başka bir uygulama bu portları kullanıyor olabilir.' };
  authServer = srv;

  const redirect_uri = 'http://127.0.0.1:' + boundPort + callbackPath;
  const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    redirect_uri,
    scope: SCOPE,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  }).toString();

  // Arka planda onayı bekle, token'ı kaydet — sohbeti kilitleme.
  const codePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { if (authServer) { authServer.close(); authServer = null; } resolve({}); }, 180000);
    authServer.removeAllListeners('request');
    authServer.on('request', (req, res) => {
      const q = urlparse.parse(req.url, true);
      if (q.pathname === callbackPath) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><div style="font-family:sans-serif;text-align:center;padding-top:60px"><h2>Harley Spotify\'ya bağlandı! 🎵</h2><p>Bu pencereyi kapatabilirsin.</p></div>');
        clearTimeout(timeout);
        if (authServer) { authServer.close(); authServer = null; }
        if (q.query && q.query.error) resolve({ error: q.query.error });
        else resolve(q.query || {});
      } else {
        res.writeHead(404); res.end('not found');
      }
    });
  });
  codePromise.then(async (code) => {
    if (!code || code.error || !code.code) return;
    const res = await postForm(AUTH_HOST, '/api/token', {
      grant_type: 'authorization_code',
      code: code.code,
      redirect_uri,
      client_id: c.clientId,
      code_verifier: verifier,
    });
    verifier = null;
    if (res.json && res.json.access_token) {
      saveConfig({
        accessToken: res.json.access_token,
        refreshToken: res.json.refresh_token,
        expiresAt: Date.now() + (res.json.expires_in - 60) * 1000,
      });
    }
  }).catch(() => {});

  openInBrowser(authUrl);
  return { ok: true, message: 'Spotify onay sayfasını tarayıcıda açtım — onayladığında otomatik bağlanacağım. Onayladıktan sonra "çal [şarkı]" de. 🎵' };
}

// ---- Arama + çalma ----
async function search(query) {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'not_authorized' };
  // market verme: kullanıcının hesabındaki bölgeye göre çalınabilir parçalar gelsin.
  const res = await apiJson('/v1/search?q=' + encodeURIComponent(query) + '&type=track&limit=5', 'GET', token);
  const items = (res.json && res.json.tracks && res.json.tracks.items) || [];
  return {
    ok: true,
    tracks: items.map((t) => ({
      id: t.id,
      uri: t.uri,
      name: t.name,
      artist: (t.artists || []).map((a) => a.name).join(', '),
      album: (t.album && t.album.name) || '',
      duration_ms: t.duration_ms || 0,
      playable: t.is_playable !== false,
      explicit: !!t.explicit,
    })),
  };
}

async function getDevices() {
  const token = await getAccessToken();
  if (!token) return [];
  const res = await apiJson('/v1/me/player/devices', 'GET', token);
  return (res.json && res.json.devices) || [];
}

async function playUris(uris) {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'not_authorized' };

  const diag0 = (m) => { try { fs.appendFileSync(require('./config').FILES.diag, new Date().toISOString() + ' spotify-play ' + m + '\n'); } catch { /* yok */ } };
  let product = null;
  try { const me = await apiJson('/v1/me', 'GET', token); product = me.json && me.json.product; diag0('me product=' + product + ' country=' + (me.json && me.json.country) + ' id=' + (me.json && me.json.id)); } catch { /* yok */ }
  // Ücretsiz hesapta Spotify playback kontrolünü reddeder (204 dönse bile çalmaz).
  if (product === 'free') return { ok: false, error: 'premium_required' };

  // Açık cihazları al; tercihen AKTİF cihazda çal (en güvenilir), yoksa Computer/telefon.
  let devices = [];
  try { devices = await getDevices(); } catch { /* yok */ }
  const active = devices.find((d) => d.is_active);
  const target = active
    || devices.find((d) => d.type === 'Computer')
    || devices.find((d) => d.type === 'Smartphone')
    || devices[0];
  if (!target) return { ok: false, error: 'no_active_device' };

  const playPath = '/v1/me/player/play?device_id=' + encodeURIComponent(target.id);
  const playBody = { uris, position_ms: 0 };
  const doPlay = () => apiJson(playPath, 'PUT', token, playBody);
  const diag = (m) => { try { fs.appendFileSync(require('./config').FILES.diag, new Date().toISOString() + ' spotify-play ' + m + '\n'); } catch { /* yok */ } };
  diag('devices=[' + devices.map((d) => d.name + ':' + d.type + (d.is_active ? '*' : '') + ' vol=' + d.volume_percent + (d.is_restricted ? ' RESTRICTED' : '') + (d.is_private_session ? ' PRIVATE' : '')).join(' | ') + '] target=' + (target && target.name));

  // Her seferinde hedef cihaza transfer et — istemci "duraklı" kalıp API'ye çalıyor derken
  // ses gelmemesi durumunu (Connect desync) giderir. play:false ile transfer; sonra çal.
  try { await apiJson('/v1/me/player', 'PUT', token, { device_ids: [target.id], play: false }); } catch { /* yok */ }

  const res = await doPlay();
  diag('status=' + res.status + ' body=' + String(res.body || '').slice(0, 220));
  if (!(res.status === 204 || res.status === 202)) {
    const j = res.json || {};
    const msg = (j.error && j.error.message) ? j.error.message : ('HTTP ' + res.status);
    if (/no active device|not found/i.test(msg)) return { ok: false, error: 'no_active_device' };
    if (/premium/i.test(msg)) return { ok: false, error: 'premium_required' };
    if (res.status === 403) return { ok: false, error: msg };
    return { ok: false, error: msg };
  }

  // Doğrula: gerçekten çalıyor mu? Duraklatılmış/yönlendirilmemişse transfer edip tekrar dene.
  try {
    const cur = await apiJson('/v1/me/player', 'GET', token);
    if (cur.json) diag('after: is_playing=' + cur.json.is_playing + ' item=' + (cur.json.item && cur.json.item.name) + ' dev=' + (cur.json.device && cur.json.device.name) + ' vol=' + (cur.json.device && cur.json.device.volume_percent) + ' devActive=' + (cur.json.device && cur.json.device.is_active));
    if (cur.json && cur.json.is_playing === false) {
      try { await apiJson('/v1/me/player', 'PUT', token, { device_ids: [target.id], play: true }); } catch { /* yok */ }
      await doPlay();
      const cur2 = await apiJson('/v1/me/player', 'GET', token);
      diag('after2: is_playing=' + (cur2.json && cur2.json.is_playing) + ' item=' + (cur2.json && cur2.json.item && cur2.json.item.name));
      if (cur2.json && cur2.json.is_playing === false) return { ok: false, error: 'playback_not_started' };
    }
  } catch { /* yok */ }

  return { ok: true };
}

// Spotify uygulamasında aç (derin bağlantı). Ücretsiz hesapta API playback kapalı olduğu
// için bu yol kullanılır: uygulama açılır ve parçayı çalmaya başlar.
function openSpotifyUri(uri) {
  return new Promise((resolve) => {
    try { require('electron').shell.openExternal(uri); resolve({ ok: true }); }
    catch (e) { resolve({ ok: false, error: e.message }); }
  });
}

// Şarkı açıldıktan sonra hâlâ duraklıysa medya oynatma tuşu gönder (başlasın).
function ensurePlaying(delayMs) {
  setTimeout(async () => {
    try {
      const spotify = require('./spotify');
      const st = await spotify.getSpotifyStatus();
      if (!st || !st.playing) await spotify.sendMediaKey('play');
    } catch { /* yok */ }
  }, delayMs || 3000);
}

// Spotify penceresini öne getir (kullanıcı sekmeye gitmek zorunda kalmasın).
function focusSpotify() {
  return new Promise((resolve) => {
    const ps = "for($i=0;$i -lt 8;$i++){ try { $w = New-Object -ComObject WScript.Shell; if($w.AppActivate('Spotify')){ break } } catch {}; Start-Sleep -Milliseconds 350 }";
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, () => resolve(true));
  });
}

// Hesap Premium mu? (/me ürünü; user-read-private izni gerekir — yoksa false).
let _premCache = { ts: 0, v: null };
async function isPremiumAccount() {
  if (_premCache.v !== null && Date.now() - _premCache.ts < 300000) return _premCache.v;
  try {
    const token = await getAccessToken();
    if (!token) return false;
    const me = await apiJson('/v1/me', 'GET', token);
    _premCache = { ts: Date.now(), v: (me.json && me.json.product) === 'premium' };
    return _premCache.v;
  } catch { return false; }
}

async function playQuery(query) {
  const s = await search(query);
  if (!s.ok) return s;
  if (!s.tracks.length) return { ok: false, error: 'no_result' };
  const track = s.tracks[0];
  // Güvenilir yol (hesap türünden bağımsız): şarkıyı Spotify uygulamasında aç + pencereyi öne getir.
  const r = await openSpotifyUri(track.uri);
  if (!r.ok) return { ok: false, error: r.error || 'open_failed' };
  setTimeout(focusSpotify, 1200);
  ensurePlaying(3200); // açıldıktan sonra çalmaya başlamadıysa oynat
  return { ok: true, track, fallback: true };
}

module.exports = {
  isConfigured,
  hasToken,
  getAccessToken,
  connect,
  search,
  playQuery,
};
