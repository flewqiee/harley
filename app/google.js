// google.js — Google API (takvim, e-posta, görevler, Drive) + web arama + hava durumu.
// Tüm fonksiyonlar config.js'deki FILES.google yoluyla kimlik bilgilerini okur.
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const { exec } = require('child_process');
const { FILES } = require('./config');
const secureStore = require('./secure-store');

const WARN = 'Google baglantisi kurulmadi. HarleyDosyalar/google-config.json icine client_id, client_secret ve refresh_token ekle.';

// Google OAuth (loopback) — gerekli izinler
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

function cfg() {
  try { return secureStore.readJson(FILES.google); } catch { return {}; }
}

let _token = { access: '', expiry: 0 };

function post(url, form) {
  return new Promise((resolve, reject) => {
    const body = Object.entries(form).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    const r = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Google token yaniti cozumlenemedi')); } });
    });
    r.setTimeout(30000, () => r.destroy(new Error('Google token zaman asimi')));
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

function get(url, token) {
  return new Promise((resolve, reject) => {
    const r = https.get(url, { headers: { Authorization: 'Bearer ' + token } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (res.statusCode >= 400) reject(new Error('Google API ' + res.statusCode + ': ' + (j.error && j.error.message ? j.error.message : d.slice(0, 150))));
          else resolve(j);
        } catch (e) { reject(e); }
      });
    });
    r.setTimeout(30000, () => r.destroy(new Error('Google API zaman asimi')));
    r.on('error', reject);
  });
}

function getRaw(url, token) {
  return new Promise((resolve, reject) => {
    const r = https.get(url, { headers: { Authorization: 'Bearer ' + token } }, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error('Google API ' + res.statusCode + ': ' + d.slice(0, 180)));
        else resolve(d);
      });
    });
    r.setTimeout(30000, () => r.destroy(new Error('Google API zaman asimi')));
    r.on('error', reject);
  });
}

function request(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : null;
    const r = https.request(url, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(b ? { 'Content-Length': Buffer.byteLength(b) } : {}) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(d || '{}'); } catch { /* bos */ }
        if (res.statusCode >= 400) reject(new Error('Google API ' + res.statusCode + ': ' + (j.error && j.error.message ? j.error.message : d.slice(0, 180))));
        else resolve(j);
      });
    });
    r.setTimeout(30000, () => r.destroy(new Error('Google API zaman asimi')));
    r.on('error', reject);
    if (b) r.write(b);
    r.end();
  });
}

async function ensureToken() {
  const c = cfg();
  if (!c.client_id || !c.client_secret || !c.refresh_token) return null;
  if (_token.access && Date.now() < _token.expiry) return _token.access;
  const r = await post('https://oauth2.googleapis.com/token', {
    client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token',
  });
  if (!r.access_token) throw new Error('Google token alinamadi (refresh_token gecersiz olabilir).');
  _token = { access: r.access_token, expiry: Date.now() + ((r.expires_in || 3600) - 120) * 1000 };
  return _token.access;
}

async function epostaFetch() {
  const c = cfg();
  if (!c.client_id || !c.client_secret || !c.refresh_token) throw new Error(WARN);
  const token = await ensureToken();
  const j = await get('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=is:unread', token);
  const items = [];
  for (const m of (j.messages || []).slice(0, 8)) {
    try {
      const d = await get('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + m.id + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject', token);
      const hdr = (name) => { const h = (d.payload && d.payload.headers || []).find((x) => x.name === name); return h ? h.value : ''; };
      items.push({ konu: hdr('Subject'), kimden: hdr('From').split('<')[0].trim().slice(0, 50) });
    } catch { /* tek mesaj atla */ }
  }
  if (!items.length) return { text: 'Okunmamis e-postan yok.' };
  const lines = items.map((e, i) => `  ${i + 1}. "${e.konu}" — ${e.kimden}`).join('\n');
  return { text: 'Okunmamis e-postalarin:\n' + lines, raw: items };
}

async function addCalendarEvent({ summary, start, end, description }) {
  const c = cfg();
  if (!c.client_id || !c.client_secret || !c.refresh_token) throw new Error(WARN);
  const token = await ensureToken();
  const s = new Date(start);
  const e = new Date(end || (s.getTime() + 3600000));
  return await request('POST', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', token, {
    summary: String(summary || '').trim(),
    description: String(description || '').trim() || undefined,
    start: { dateTime: s.toISOString() },
    end: { dateTime: e.toISOString() },
  });
}

async function addTask({ title }) {
  const c = cfg();
  if (!c.client_id || !c.client_secret || !c.refresh_token) throw new Error(WARN);
  const token = await ensureToken();
  return await request('POST', 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', token, { title: String(title || '').trim() });
}

async function completeTask({ title }) {
  const c = cfg();
  if (!c.client_id || !c.client_secret || !c.refresh_token) throw new Error(WARN);
  const token = await ensureToken();
  const list = await get('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?maxResults=100&showCompleted=false', token);
  const q = String(title || '').toLowerCase().trim();
  const match = (list.items || []).find((t) => q && String(t.title || '').toLowerCase().includes(q));
  if (!match) return { notFound: true };
  await request('PATCH', 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/' + encodeURIComponent(match.id), token, { status: 'completed' });
  return { id: match.id, title: match.title };
}

function parseDateTime(input) {
  const now = new Date();
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  let date = new Date(now);
  if (/obur gun|oteceki gun/i.test(input)) date = addDays(now, 2);
  else if (/yar[ıi]n/i.test(input)) date = addDays(now, 1);
  else if (/bug[uü]n|bu gun/i.test(input)) date = new Date(now);
  else {
    const wd = (input.match(/(pazartesi|sal[ıi]|car[sS]amba|persembe|per[sS]embe|cuma|cumartesi|pazar)/i) || [])[0];
    if (wd) {
      const map = { pazartesi: 1, salı: 2, sali: 2, çarşamba: 3, carsamba: 3, perşembe: 4, persembe: 4, cuma: 5, cumartesi: 6, pazar: 0 };
      const diff = (map[wd.toLowerCase()] - now.getDay() + 7) % 7 || 7;
      date = addDays(now, diff);
    }
  }
  const tm = input.match(/(\d{1,2})[:.](\d{2})\s*(?:'da|'de|da|de)?/);
  if (tm) {
    date.setHours(+tm[1], +tm[2], 0, 0);
    if (date < now) date = addDays(date, 1);
  } else {
    date.setHours(now.getHours() + 1, 0, 0, 0);
    if (date.getTime() < now.getTime()) date = addDays(date, 1);
  }
  return { start: date.toISOString(), end: new Date(date.getTime() + 3600000).toISOString() };
}

function webSearch(query, max) {
  return new Promise((resolve, reject) => {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Accept-Language': 'tr,en;q=0.8' } }, (res) => {
      let html = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (html += c));
      res.on('end', () => {
        try {
          const items = [];
          const reA = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;
          let m;
          while ((m = reA.exec(html)) !== null && items.length < (max || 6)) {
            let href = m[1];
            if (href.startsWith('//')) href = 'https:' + href;
            items.push({ title: m[2].replace(/<[^>]+>/g, '').trim(), url: href, snippet: '' });
          }
          const reS = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)<\/a>/g;
          let mm, i = 0;
          while ((mm = reS.exec(html)) !== null && i < items.length) { items[i].snippet = mm[1].replace(/<[^>]+>/g, '').trim(); i++; }
          resolve(items);
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(30000, () => { req.destroy(new Error('Web aramasi zaman asimi')); });
    req.on('error', reject);
  });
}

async function driveSummarize(name) {
  const c = cfg();
  if (!c.client_id || !c.client_secret || !c.refresh_token) throw new Error(WARN);
  const token = await ensureToken();
  const list = await get('https://www.googleapis.com/drive/v3/files?pageSize=100&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime%20desc', token);
  let files = (list.files || []).filter((f) => f.mimeType && !f.mimeType.startsWith('application/vnd.google-apps.folder'));
  const q = name.toLowerCase();
  if (name) files = files.filter((f) => String(f.name || '').toLowerCase().includes(q));
  if (!files.length) return 'Elesen dosya bulunamadi.';
  if (name && files.length > 1) {
    return 'Birden fazla eslesme var. Hangisini ozetleyeyim?\n' + files.slice(0, 8).map((f) => '- ' + f.name).join('\n');
  }
  const f = files[0];
  const doc = 'application/vnd.google-apps.document';
  const sheet = 'application/vnd.google-apps.spreadsheet';
  let content = '';
  try {
    if (f.mimeType === doc) content = await getRaw('https://www.googleapis.com/drive/v3/files/' + f.id + '/export?mimeType=text/plain', token);
    else if (f.mimeType === sheet) content = await getRaw('https://www.googleapis.com/drive/v3/files/' + f.id + '/export?mimeType=text/csv', token);
    else if (/text\/|application\/json/.test(f.mimeType)) content = await getRaw('https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media', token);
    else return 'Bu dosya turunu metne ceviremiyorum (sadece adi): ' + f.name + ' (' + f.mimeType + ')';
  } catch (e) { return f.name + ' okunamadi: ' + e.message + ' (drive.readonly kapsami gerekli)'; }
  if (!content || !content.trim()) return f.name + ' dosyasi bos.';
  return f.name + ':\n' + content.slice(0, 4000);
}

let _gctx = { ts: 0, text: '' };
async function buildContext() {
  if (Date.now() - _gctx.ts < 60000 && _gctx.text) return _gctx.text;
  let text = '';
  try {
    const c = cfg();
    if (!c.client_id || !c.client_secret || !c.refresh_token) throw new Error('yok');
    const token = await ensureToken();
    const s = new Date(); s.setHours(0, 0, 0, 0);
    const e = new Date(s.getTime() + 86400000);
    const [cal, mail, tasks] = await Promise.all([
      get(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(s.toISOString())}&timeMax=${encodeURIComponent(e.toISOString())}&singleEvents=true&orderBy=startTime&maxResults=5`, token).catch(() => ({ items: [] })),
      get('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=is:unread', token).catch(() => ({ messages: [] })),
      get('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?maxResults=5&showCompleted=false', token).catch(() => ({ items: [] })),
    ]);
    const parts = [];
    if ((cal.items || []).length) parts.push('Bugunku takvim: ' + cal.items.map((x) => x.summary).join(', '));
    if ((mail.messages || []).length) parts.push('Okunmamis e-posta sayisi: ' + mail.messages.length);
    if ((tasks.items || []).length) parts.push('Acik gorevler: ' + tasks.items.map((x) => x.title).join(', '));
    if (parts.length) text = '## CANLI GOOGLE VERISI (guncel)\n' + parts.join('\n') + '\n';
  } catch { /* bos */ }
  _gctx = { ts: Date.now(), text };
  return text;
}

let _ozetCache = { ts: 0, text: '', raw: null };
async function ozetFetch() {
  const c = cfg();
  if (!c.client_id || !c.client_secret || !c.refresh_token) throw new Error(WARN);
  const token = await ensureToken();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const dayStr = (d) => d.toISOString();
  const [takvim, eposta, gorevler, drive] = await Promise.all([
    get(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(dayStr(todayStart))}&timeMax=${encodeURIComponent(dayStr(todayEnd))}&singleEvents=true&orderBy=startTime&maxResults=10`, token)
      .then((j) => ({ items: (j.items || []).map((e) => ({ ad: e.summary, baslangic: e.start && (e.start.dateTime || e.start.date), yer: (e.location || '').slice(0, 60) })) }))
      .catch((e) => ({ ok: false, error: e.message })),
    get('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=is:unread', token)
      .then(async (j) => {
        const items = [];
        for (const m of (j.messages || []).slice(0, 8)) {
          try {
            const d = await get('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + m.id + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject', token);
            const hdr = (name) => { const h = (d.payload && d.payload.headers || []).find((x) => x.name === name); return h ? h.value : ''; };
            items.push({ konu: hdr('Subject'), kimden: hdr('From').split('<')[0].trim().slice(0, 50), okundu: 'okunmamis' });
          } catch { /* tek mesaj atla */ }
        }
        return { items };
      })
      .catch((e) => ({ ok: false, error: e.message })),
    (async () => {
      try {
        const j = await get('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?maxResults=15&showCompleted=false', token);
        const items = (j.items || []).slice(0, 8).map((t) => ({ gorev: t.title || '', durum: t.status === 'completed' ? 'Tamamlandi' : 'Bekliyor' })).filter((x) => x.gorev);
        return { items };
      } catch (e) { return { ok: false, error: e.message }; }
    })(),
    get('https://www.googleapis.com/drive/v3/files?pageSize=8&orderBy=modifiedTime%20desc&fields=files(name,modifiedTime)', token)
      .then((j) => ({ items: (j.files || []).map((f) => ({ ad: f.name })) }))
      .catch((e) => ({ ok: false, error: e.message })),
  ]);
  return { takvim, eposta, gorevler, drive };
}

async function runOzet() {
  if (Date.now() - _ozetCache.ts < 120000 && _ozetCache.text) return { text: _ozetCache.text, raw: _ozetCache.raw, cached: true };
  let root;
  try {
    root = await ozetFetch();
  } catch (e) {
    return { text: 'Gunun ozeti alinamadi: ' + (e && e.message ? e.message : 'Google servisine ulasilamadi') + '.', raw: null, error: true };
  }
  const today = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const lines = ['GUNUN OZETI - ' + today + ':', ''];
  const parts = [
    ['TAKVIM', root.takvim],
    ['E-POSTALAR', root.eposta],
    ['GOREVLER', root.gorevler],
    ['DRIVE', root.drive],
  ];
  let any = false;
  for (const [head, sec] of parts) {
    lines.push(head + ':');
    if (!sec) { lines.push('  - veri alinamadi'); continue; }
    if (sec.ok === false) { lines.push('  - alinamadi (' + String(sec.error || 'servis hatasi') + ')'); continue; }
    const items = Array.isArray(sec.items) ? sec.items : [];
    if (!items.length) { lines.push('  - (yok)'); continue; }
    any = true;
    for (const it of items.slice(0, 8)) {
      if (head === 'TAKVIM' && it.ad) lines.push('  - ' + (it.baslangic ? it.baslangic.slice(11, 16) + ' ' : '') + it.ad + (it.yer ? ' — ' + it.yer : ''));
      else if (head === 'E-POSTALAR' && it.konu) lines.push('  - ' + (it.kimden ? it.kimden + ': ' : '') + it.konu + (it.okundu === 'okunmamis' ? ' (yeni)' : ''));
      else if (head === 'GOREVLER') {
        const g = it.gorev || it.Gorev || (it.ad && it.ad) || '';
        const d = it.durum || it.Durum || it.status || '';
        if (g) lines.push('  - ' + g + (d ? ' [' + d + ']' : ''));
      }
      else if (head === 'DRIVE' && it.ad) lines.push('  - ' + it.ad);
    }
  }
  if (!any) lines.push('(Bugun icin planlanmis kayitli bir sey yok.)');
  const text = lines.join('\n');
  _ozetCache = { ts: Date.now(), text, raw: root };
  return { text, raw: root, cached: false };
}

// Hava durumu (Open-Meteo — ucretsiz, anahtar yok)
const WMO = { 0: 'acik', 1: 'az bulutlu', 2: 'parcali bulutlu', 3: 'kapali', 45: 'sisli', 48: 'kiragili sis', 51: 'hafif cisenti', 53: 'cisenti', 55: 'yogun cisenti', 61: 'hafif yagmur', 63: 'yagmur', 65: 'siddetli yagmur', 66: 'dondurucu yagmur', 67: 'siddetli dondurucu yagmur', 71: 'hafif kar', 73: 'kar', 75: 'yogun kar', 77: 'kar taneleri', 80: 'hafif saganak', 81: 'saganak', 82: 'siddetli saganak', 85: 'hafif kar saganagi', 86: 'yogun kar saganagi', 95: 'gok gurultulu firtina', 96: 'firtina ve dolu', 99: 'siddetli firtina ve dolu' };
function httpJson(url, timeout) {
  return new Promise((resolve, reject) => {
    const r = https.get(url, { timeout: timeout || 10000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    r.setTimeout(timeout || 10000, () => r.destroy(new Error('timeout')));
    r.on('error', reject);
  });
}
async function getWeather(city) {
  const defaultCity = city || 'Izmir';
  const name = defaultCity.replace(/İ/g, 'i').toLowerCase();
  const geo = await httpJson('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(name) + '&count=1', 15000);
  if (!geo.results || !geo.results[0]) throw new Error('Hava durumu icin sehir bulunamadi.');
  const { latitude: lat, longitude: lon, timezone: tz, name: cityName } = geo.results[0];
  const w = await httpJson('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current_weather=true&daily=temperature_2m_max,temperature_2m_min&timezone=' + encodeURIComponent(tz), 15000);
  const c = w.current_weather;
  const d = w.daily;
  return 'Hava durumu - ' + cityName + ':\nSimdi: ' + c.temperature + '°C, ' + (WMO[c.weathercode] || 'bilinmiyor') + ', ruzgar ' + c.windspeed + ' km/s\nEn yuksek: ' + d.temperature_2m_max[0] + '°C, En dusuk: ' + d.temperature_2m_min[0] + '°C';
}
async function morningRoutine() {
  let text = 'Gunaydin!';
  try { const w = await getWeather(); text += '\n' + w; } catch { /* yok */ }
  try { const o = await runOzet(); if (o.text) text += '\n\n' + o.text; } catch { /* yok */ }
  return text;
}

// ---------- Bağlantı kurulumu (Bağlantılar paneli) ----------
// Client ID/Secret'ı kaydeder (refresh_token ayrı akışta gelir).
function saveCredentials({ client_id, client_secret }) {
  try {
    const cur = cfg();
    if (client_id) cur.client_id = String(client_id).trim();
    if (client_secret) cur.client_secret = String(client_secret).trim();
    secureStore.writeJson(FILES.google, cur);
    return { ok: true };
  } catch (e) { return { ok: false, message: e.message }; }
}

// Tarayıcı tabanlı OAuth (loopback): tarayıcı açılır → giriş → izin → kod yakalanır
// → refresh_token kaydedilir. client_id/secret önceden kaydedilmiş olmalı.
// Google Cloud'da OAuth istemci türü "Masaüstü uygulaması" olmalı (loopback destekler).
function connectOAuth() {
  return new Promise((resolve) => {
    const c = cfg();
    if (!c.client_id || !c.client_secret) {
      return resolve({ ok: false, message: 'Önce Client ID ve Client Secret gir.' });
    }
    const state = crypto.randomBytes(16).toString('hex');
    const ports = [8890, 8891, 8892, 8893, 8894];
    const tryBind = (p) => new Promise((res) => {
      const s = http.createServer();
      const onErr = () => { s.off('error', onErr); res(null); };
      s.on('error', onErr);
      s.listen(p, '127.0.0.1', () => { s.off('error', onErr); res(s); });
    });
    (async () => {
      let srv = null, port = null;
      for (const p of ports) { const s = await tryBind(p); if (s) { srv = s; port = p; break; } }
      if (!srv) return resolve({ ok: false, message: 'Callback portları (8890-8894) dolu.' });

      const redirect_uri = 'http://127.0.0.1:' + port;
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: c.client_id,
        redirect_uri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString();

      try { exec('start "" "' + authUrl + '"', { windowsHide: true }); } catch { /* yok */ }

      const timer = setTimeout(() => { try { srv.close(); } catch { /* yok */ } resolve({ ok: false, message: 'Zaman aşımı (3 dk) — pencereyi kapatıp tekrar dene.' }); }, 180000);

      srv.on('request', async (req, res) => {
        let u;
        try { u = new URL(req.url, 'http://127.0.0.1:' + port); } catch { res.writeHead(400); return res.end('bad'); }
        if (u.pathname !== '/') { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><div style="font-family:sans-serif;text-align:center;padding-top:60px"><h2>Harley Google\'a baglandi!</h2><p>Bu pencereyi kapatabilirsin.</p></div>');
        clearTimeout(timer);
        try { srv.close(); } catch { /* yok */ }
        const err = u.searchParams.get('error');
        const code = u.searchParams.get('code');
        const gotState = u.searchParams.get('state');
        if (err) return resolve({ ok: false, message: 'İzin verilmedi: ' + err });
        if (!code || gotState !== state) return resolve({ ok: false, message: 'Geçersiz yanıt (state/kod).' });
        try {
          const tok = await post('https://oauth2.googleapis.com/token', {
            code,
            client_id: c.client_id,
            client_secret: c.client_secret,
            redirect_uri,
            grant_type: 'authorization_code',
          });
          if (!tok.refresh_token) {
            return resolve({ ok: false, message: tok.error_description || 'refresh_token alınamadı. Google hesabından Harley erişimini kaldırıp tekrar dene.' });
          }
          const cur = cfg();
          secureStore.writeJson(FILES.google, {
            ...cur,
            refresh_token: tok.refresh_token,
            access_token: tok.access_token,
            expiry: Date.now() + ((tok.expires_in || 3600) - 60) * 1000,
          });
          _token = { access: tok.access_token, expiry: Date.now() + ((tok.expires_in || 3600) - 60) * 1000 };
          resolve({ ok: true, message: 'Google bağlandı.' });
        } catch (e) {
          resolve({ ok: false, message: 'Token alınamadı: ' + e.message });
        }
      });
    })();
  });
}

module.exports = {
  ensureToken, epostaFetch, addCalendarEvent, addTask, completeTask, parseDateTime,
  webSearch, driveSummarize, buildContext, runOzet, getWeather, morningRoutine, WMO, httpJson,
  get, request, isConfigured: () => { const c = cfg(); return !!(c.client_id && c.client_secret && c.refresh_token); },
  saveCredentials, connectOAuth,
};
