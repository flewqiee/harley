// tool-healthcheck.js — Harley'nin tüm servislerini ve araçlarını tek komutla test eder.
//
//   node tool-healthcheck.js          (hızlı: servisler + araç uçları)
//   node tool-healthcheck.js --full   (ayrıca ekran analizi — yavaş)
//
// Çıkış kodu: 0 = hata yok, 1 = en az bir HATA, 2 = uyarı var (hata yok).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const HOME = os.homedir();

const rows = [];
function add(name, status, detail, ms) {
  rows.push({ name, status, detail, ms });
}
let HARLEY_TOKEN = '';
try { HARLEY_TOKEN = fs.readFileSync(path.join(HOME, 'HarleyDosyalar', 'harley-token.txt'), 'utf8').trim(); } catch { /* token yok — ilk açılışta üretilir */ }
function postJson(url, body, timeout = 20000) {
  const u = new URL(url);
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'X-Harley-Token': HARLEY_TOKEN, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.setTimeout(timeout, () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ status: 0, body: e.message }));
    if (data) r.write(data);
    r.end();
  });
}
function getUrl(url, timeout = 10000) {
  return new Promise((resolve) => {
    const r = http.get(url, { timeout }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.setTimeout(timeout, () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ status: 0, body: e.message }));
  });
}
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

(async () => {
  const full = process.argv.includes('--full');

  // ---------- Servisler ----------
  let t = Date.now();
  const app = await getUrl('http://127.0.0.1:59333/studio/status');
  add('Harley uygulaması (59333)', app.status === 200 ? 'OK' : 'HATA', app.status === 200 ? JSON.parse(app.body).connected ? 'çalışıyor' : 'çalışıyor (Studio bağlı değil)' : app.body.slice(0, 80), Date.now() - t);

  t = Date.now();
  const rm = await postJson('http://127.0.0.1:59333/remind', { time: 'xyz-geçersiz', message: 'healthcheck' }, 10000);
  const rmOk = rm.status === 400 || /geçersiz|eksik/i.test(rm.body);
  add('Hatırlatıcı', rmOk ? 'OK' : 'HATA', rmOk ? 'zaman çözümleyici çalışıyor (yan etkisiz test)' : (rm.body || '').slice(0, 90), Date.now() - t);

  t = Date.now();
  const st = await getUrl('http://127.0.0.1:59333/studio/status', 8000);
  let stConn = false;
  try { stConn = JSON.parse(st.body).connected; } catch { /* yok */ }
  add('Studio bağlantısı', st.status === 200 ? (stConn ? 'OK' : 'UYARI') : 'HATA', stConn ? 'HarleyStudio eklentisi bağlı' : 'eklenti bağlı değil (normal, Studio kapalıysa)', Date.now() - t);

  t = Date.now();
  const lg = await postJson('http://127.0.0.1:59333/studio/log', {}, 10000);
  add('Studio log okuma', lg.status === 200 ? 'OK' : 'HATA', (JSON.parse(lg.body || '{}').text || lg.body || '').slice(0, 90), Date.now() - t);

  // ---------- Araç uçları (yan etkisiz testler) ----------
  // Not: PC kontrolü (uygulama aç/kapat) artık classifier üzerinden çalışır, HTTP ucu yok.

  // ---------- DeepSeek API (anahtar doğrulama) ----------
  t = Date.now();
  try {
    const cfgRaw = fs.readFileSync(path.join(HOME, 'HarleyDosyalar', 'deepseek-config.json'), 'utf8');
    const cfg = JSON.parse(cfgRaw);
    const apiKey = (cfg.apiKey || '').trim();
    if (!apiKey) {
      add('DeepSeek API', 'HATA', 'apiKey alanı boş', Date.now() - t);
    } else {
      const https = require('https');
      const dsBody = JSON.stringify({ model: cfg.model || 'deepseek-chat', messages: [{ role: 'user', content: 'test' }], max_tokens: 5 });
      const dsResult = await new Promise((resolve) => {
        const req = https.request({
          hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey, 'Content-Length': Buffer.byteLength(dsBody) },
        }, (res) => {
          let d = ''; res.on('data', (c) => (d += c));
          res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', (e) => resolve({ status: 0, body: e.message }));
        req.setTimeout(10000, () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
        req.write(dsBody); req.end();
      });
      if (dsResult.status === 200) {
        add('DeepSeek API', 'OK', 'key çalışıyor (HTTP 200)', Date.now() - t);
      } else if (dsResult.status === 401) {
        add('DeepSeek API', 'HATA', 'key GEÇERSİZ (HTTP 401) — key\'i kontrol et', Date.now() - t);
      } else if (dsResult.status === 402) {
        add('DeepSeek API', 'HATA', 'bakiye yetersiz (HTTP 402)', Date.now() - t);
      } else {
        let msg = 'HTTP ' + dsResult.status;
        try { msg += ': ' + JSON.parse(dsResult.body).error.message; } catch { /* yok */ }
        add('DeepSeek API', 'HATA', msg.slice(0, 80), Date.now() - t);
      }
    }
  } catch {
    add('DeepSeek API', 'UYARI', 'deepseek-config.json bulunamadı', Date.now() - t);
  }

  // ---------- Günün Özeti (gerçek uçtan uca) ----------
  t = Date.now();
  const oz = await postJson('http://127.0.0.1:59333/ozet', {}, 70000);
  let ozRaw = {};
  try { ozRaw = JSON.parse(oz.body).raw || {}; } catch { /* yok */ }
  const ozText = (() => { try { return JSON.parse(oz.body).text || ''; } catch { return ''; } })();
  const okSecs = ['takvim', 'eposta', 'gorevler', 'drive'].filter((k) => ozRaw[k] && ozRaw[k].ok);
  add('Günün Özeti', oz.status === 200 && okSecs.length >= 2 ? 'OK' : 'UYARI', okSecs.length + '/4 bölüm ok (' + ozText.split('\n')[0] + ')', Date.now() - t);

  // ---------- Dosya/kaynak kontrolleri ----------
  const files = [
    ['HarleyDosyalar/Bellek.md', 'hafıza dosyası'],
    ['HarleyDosyalar/Notlar.txt', 'notlar'],
    ['HarleyDosyalar/hatirlatmalar.json', 'hatırlatmalar'],
    ['HarleyDosyalar/websearch-key.txt', 'web arama anahtarı (Serper)'],
    ['HarleyKod/github-token.txt', 'GitHub token'],
  ];
  for (const [p, role] of files) {
    const full = path.join(HOME, p);
    add('Kaynak: ' + p, exists(full) ? 'OK' : 'UYARI', exists(full) ? 'var' : 'yok (' + role + ')', 0);
  }
  add('Klasör: Projeler', exists(path.join(HOME, 'Projeler')) ? 'OK' : 'UYARI', exists(path.join(HOME, 'Projeler')) ? 'var' : 'yok (Proje İncele için)', 0);
  add('Klasör: HarleySes/piper', exists(path.join(HOME, 'HarleySes', 'piper', 'piper.exe')) ? 'OK' : 'UYARI', exists(path.join(HOME, 'HarleySes', 'piper', 'piper.exe')) ? 'yerel ses motoru hazır' : 'yok (Piper ilk açılışta iner)', 0);

  // ---------- Kod Çalıştır için çalışma zamanları ----------
  try { execFileSync('node', ['--version'], { stdio: 'pipe', timeout: 8000 }); add('Node.js', 'OK', 'Kod Çalıştır aracı için', 0); } catch { add('Node.js', 'HATA', 'bulunamadı', 0); }
  try { execFileSync('python', ['--version'], { stdio: 'pipe', timeout: 8000 }); add('Python', 'OK', 'Kod Çalıştır aracı için', 0); } catch { add('Python', 'UYARI', 'PATH\'te yok (node yeterli)', 0); }

  // ---------- Ekran analizi (--full) ----------
  if (full) {
    t = Date.now();
    const sc = await postJson('http://127.0.0.1:59333/screen-analyze', { question: 'Bu ekranda hata veya sorun görünüyor mu? Tek kelimeyle yanıtla.' }, 120000);
    const scOk = sc.status === 200 && !/yüklü değil|hata/i.test(sc.body);
    add('Ekran analizi', scOk ? 'OK' : 'UYARI', (JSON.parse(sc.body || '{}').text || '').slice(0, 90), Date.now() - t);
  }

  // ---------- Çıktı ----------
  console.log('');
  console.log('HARLEY ARAÇ SAĞLIK KONTROLÜ — ' + new Date().toLocaleString('tr-TR'));
  console.log('─'.repeat(78));
  let fails = 0, warns = 0;
  for (const r of rows) {
    const icon = r.status === 'OK' ? '  ✓' : r.status === 'UYARI' ? '  ⚠' : '  ✗';
    if (r.status === 'HATA') fails++;
    if (r.status === 'UYARI') warns++;
    const ms = r.ms ? ' (' + r.ms + 'ms)' : '';
    console.log(icon + ' ' + r.name.padEnd(38) + ' ' + r.status.padEnd(6) + ' ' + String(r.detail || '').slice(0, 60) + ms);
  }
  console.log('─'.repeat(78));
  console.log('Sonuç: ' + (rows.length - fails - warns) + ' OK, ' + warns + ' uyarı, ' + fails + ' hata' + (full ? '' : '  (ekran analizi için: --full)'));
  process.exit(fails ? 1 : (warns ? 2 : 0));
})().catch((e) => {
  console.error('Beklenmeyen hata:', e.message);
  process.exit(1);
});