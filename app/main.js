// main.js — Electron main process.
const { app, BrowserWindow, ipcMain, shell, session, clipboard, desktopCapturer, nativeImage, Tray, Menu, Notification, globalShortcut, dialog } = require('electron');
// RTX 3050'li dizüstünde GPU compositing süreci ara sıra çöküp uygulamayı
// beraberinde götürüyordu ("GPU process exited unexpectedly", "Network service
// crashed"). GPU hızlandırmayı kapatmak bu çökmeleri bitirir.
app.disableHardwareAcceleration();
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, execFile, execFileSync } = require('child_process');
const { WEBHOOKS, postDeepSeek, postDeepSeekTools, PERSONA_TEXT } = require('./webhook-client');
const CFG = require('./config');
const { FILES, PROJECTS_DIR, ACTIVE_PROJECT_FILE, LOCAL_PORT } = CFG;
const fun = require('./fun');
const taskPlanner = require('./task-planner');
const workspace = require('./workspace');
const google = require('./google');
const logger = require('./logger');
const { log } = logger;
const { classify, runAsyncHandler } = require('./classifier');
const spotify = require('./spotify');
const spotifyWeb = require('./spotify-web');
const evolution = require('./agent-evolution');
const focusMode = require('./focus-mode');
const projectMemory = require('./project-memory');
const testRunner = require('./test-runner');
const github = require('./github');
const secureStore = require('./secure-store');
const i18n = require('./i18n');
let I18N_EN = {};
try { I18N_EN = require('./locales.json').en || {}; } catch { I18N_EN = {}; }
// Main süreçte TR kaynak → EN çeviri (kullanıcıya görünen bildirim/mesajlar için).
function T(s, vars) {
  let out = (i18n.getLang() === 'en' && I18N_EN[s] !== undefined) ? I18N_EN[s] : s;
  if (vars) for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(String(vars[k]));
  return out;
}

// Proje kökü + otomatik yazma dosyası — module scope'ta (TDZ riski olmasın).
const PROJECT_BASE = path.resolve(PROJECTS_DIR);
const AUTO_WRITE_FILE = FILES.autowrite;

function getActiveProject() { try { const t = fs.readFileSync(ACTIVE_PROJECT_FILE, 'utf8').trim(); return t || null; } catch { return null; } }
function setActiveProject(name) { try { fs.writeFileSync(ACTIVE_PROJECT_FILE, String(name || '').trim(), 'utf8'); } catch { /* yok */ } }

// ---------- ölüm teşhisi (uygulama sessizce kapanıyor — sebebi buraya yazılır) ----------
const DIAG_FILE = FILES.diag;
function diag(msg) {
  try { fs.appendFileSync(DIAG_FILE, new Date().toISOString() + ' ' + msg + '\n'); } catch { /* sessiz */ }
}
process.on('uncaughtException', (e) => { diag('uncaughtException: ' + ((e && e.stack) || e)); log('error', 'main', 'uncaughtException', { msg: (e && e.message) || e }); });
process.on('unhandledRejection', (e) => { diag('unhandledRejection: ' + ((e && e.stack) || e)); log('error', 'main', 'unhandledRejection', { msg: (e && e.message) || e }); });
process.on('exit', (code) => diag('process exit code=' + code));
app.on('quit', () => { workspace.killAllBg(); diag('app quit event'); });
// GPU/audio sürücü çökmesi renderer'ı da götürüyor (RTX 3050 + Dolby DCHU).
// Uygulamayı KAPATMAK yerine sadece içeriği yenile — kullanıcı kesinti hissetmez.
// 45 sn içinde 5+ çökme olursa döngü sayılır ve kısa mola verilir.
let crashReloads = [];
function maybeProtect() {
  const now = Date.now();
  crashReloads = crashReloads.filter((t) => now - t < 45000);
  crashReloads.push(now);
  if (crashReloads.length >= 5) {
    diag('crash-loop: 45sn bekleniyor');
    setTimeout(() => { crashReloads = []; maybeProtect(); }, 45000);
    return;
  }
  // GPU/audio/Network servisi çökse bile uygulamayı KAPATMA — pencereyi yeniden kur.
  // (Eski kod app.relaunch()+app.exit(0) yapıyordu; bu makinede Smart App Control
  // yeniden başlatılan exe'yi engellediği için uygulama ölüyordu.)
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload(); // pencere açık kalır, içerik yenilenir
    } else {
      createWindow(); // pencere yoksa yeniden kur (çıkma, tepside kalma)
    }
  } catch {
    try { createWindow(); } catch { /* yok */ }
  }
}
app.on('render-process-gone', (_e, _wc, details) => {
  diag('render-process-gone: ' + JSON.stringify(details));
  if (details.reason && details.reason !== 'clean-exit') maybeProtect();
});
// Global hata yakalayıcı: sessiz çökme yerine diag'a yaz, uygulama yaşamaya devam etsin.
process.on('uncaughtException', (e) => { try { diag('uncaughtException: ' + ((e && e.stack) || e)); } catch { /* yok */ } });
process.on('unhandledRejection', (e) => { try { diag('unhandledRejection: ' + ((e && (e.stack || e.message || e)) || e)); } catch { /* yok */ } });
app.on('child-process-gone', (_e, details) => {
  diag('child-process-gone: ' + JSON.stringify(details));
  const t = String((details && details.type) || '');
  if (t === 'GPU' || t === 'Utility' || t === 'Network Service') maybeProtect();
});
// Renderer hatalarını/konsol mesajlarını diagnostik log'a düşür (UI sorunlarını görmek için)
ipcMain.on('renderer:log', (_e, msg) => diag('renderer: ' + String(msg).slice(0, 500)));

let mainWindow = null;
let tray = null;
let currentAbort = null;

const ICON = path.join(__dirname, 'assets', 'icon.ico');

// settings.json'ı oku — whenReady dışındaki handler'lardan da erişilebilir.
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

// ---------- Güncelleme kontrolü (GitHub Releases) ----------
// Not: electron-updater ile sessiz otomatik güncelleme, NSIS/kurulum + kod imzalama
// gerektirir. Portable dağıtımda en sağlıklısı yeni sürümü bildirip indirmeye yönlendirmek.
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y ? 1 : -1; }
  return 0;
}
function checkForUpdates() {
  return new Promise((resolve) => {
    const req = https.get({
      hostname: 'api.github.com',
      path: '/repos/flewqiee/harley/releases/latest',
      headers: { 'User-Agent': 'Harley', 'Accept': 'application/vnd.github+json' },
      timeout: 10000,
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (!j || !j.tag_name) return resolve(null);
          const latest = String(j.tag_name).replace(/^v/i, '');
          if (compareVersions(latest, app.getVersion()) > 0) {
            resolve({ version: latest, url: j.html_url, name: j.name || ('v' + latest) });
          } else resolve(null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

function startHidden(command, args, extraEnv) {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}


// ---------- Roblox Studio MCP server (drgost1/robloxstudio-mcp) ----------
// Studio'daki "MCP Integration" eklentisi (MCPPlugin.rbxmx) bu sunucuya bağlanır
// ve 51 araç sunar: execute_luau, get_file_tree, get_script_source,
// set_script_source, start_playtest, get_playtest_output, undo, insert_asset...
// Sunucu stdio-MCP olarak çalışır; stdin kapanınca kendini kapatır (dist/index.js
// içinde process.stdin.on('end'/'close', shutdown)). Pencere açılmaması için
// npx/npm aracısı KULLANILMAZ — paket yerel kuruludur (kullanıcı ev klasörü/HarleyMCP),
// doğrudan node ile başlatılır ve stdin'i açık tutarız (pipe referansı).
let mcpChild = null;
function startStudioMCP() {
  const entry = CFG.MCP_DIR;
  // Paket yerel kurulu değilse başlatmayız: npx ile indirmek bir konsol penceresi
  // açıyor ve kullanıcı istemeden çalışıyordu. Studio köprüsü tamamen isteğe bağlıdır
  // (roblox-studio/KURULUM.md). Kuruluysa arka planda, penceresiz başlatılır.
  if (!fs.existsSync(entry)) return false;
  try {
    mcpChild = spawn(process.execPath, [entry], {
      detached: true,
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'ignore'], // stdin pipe — kapatmıyoruz
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, // electron.exe'yi node gibi çalıştır
    });
    if (mcpChild.stdin) mcpChild.stdin.on('error', () => {});
    mcpChild.unref();
    return true;
  } catch { return false; }
}
// MCP köprüsü durumu (UI paneli için): sunucu ayakta mı + Studio açık mı +
// eklenti gerçekten çalışıyor mu (execute_luau probe — /status pluginConnected
// sunucu yeniden başlayınca sıfırlanıyor, güvenilmez).
let studioProcCache = { ts: 0, running: false };
function isStudioRunning() {
  return new Promise((resolve) => {
    if (Date.now() - studioProcCache.ts < 5000) return resolve(studioProcCache.running);
    const ps = 'Get-Process -Name RobloxStudioBeta -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count';
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, out) => {
      const n = parseInt(String(out || '').trim(), 10);
      studioProcCache = { ts: Date.now(), running: !err && n > 0 };
      resolve(studioProcCache.running);
    });
  });
}
function probeMCP(timeoutMs) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ code: 'return 1' });
    const r = http.request({ hostname: '127.0.0.1', port: 3002, path: '/mcp/execute_luau', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (resp) => {
      let d = '';
      resp.on('data', (c) => (d += c));
      resp.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve(JSON.parse(j.content[0].text).success === true);
        } catch { resolve(false); }
      });
    });
    r.setTimeout(timeoutMs || 3000, () => r.destroy(new Error('timeout')));
    r.on('error', () => resolve(false));
    r.write(body);
    r.end();
  });
}
let mcpStatusCache = { ts: 0, data: null };
async function getMCPStatus() {
  if (Date.now() - mcpStatusCache.ts < 5000 && mcpStatusCache.data) return mcpStatusCache.data;
  const [mcpUp, studioUp] = await Promise.all([probeAny(3002, '/health', 2500), isStudioRunning()]);
  let connected = false;
  if (mcpUp) connected = await probeMCP(3000);
  mcpStatusCache = { ts: Date.now(), data: { mcpUp, studioUp, connected } };
  return mcpStatusCache.data;
}
async function ensureMCPUp() {
  if (await probeAny(3002, '/health', 2500)) return true;
  if (!startStudioMCP()) return false;
  return waitAny(3002, '/health', 60000);
}
// Herhangi bir HTTP yanıtı (404/405 dahil) = sunucu ayakta.
function probeAny(port, pth, timeoutMs) {
  return new Promise((resolve) => {
    const r = http.get({ hostname: 'localhost', port, path: pth, timeout: timeoutMs || 2500 }, (resp) => {
      resp.resume();
      resolve(true);
    });
    r.on('error', () => resolve(false));
    r.on('timeout', () => {
      r.destroy();
      resolve(false);
    });
  });
}
async function waitAny(port, pth, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await probeAny(port, pth)) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

// Brings services up if they're down. Returns the list of what we started.
async function ensureServices() {
  const started = [];
  // Roblox Studio MCP sunucusu (port 3002 legacy HTTP). npx ilk seferde indirir.
  if (!(await probeAny(3002, '/mcp'))) {
    if (startStudioMCP()) {
      started.push('StudioMCP');
      await waitAny(3002, '/mcp', 60000);
    }
  }
  return started;
}

// ---------- window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#16100a',
    icon: ICON,
    title: 'Harley — Kişisel Asistan',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    shell.openExternal(url);
  });

  // Kapatma butonu uygulamayı bitirmez — tepsiye gizler (asistan arka planda kalır).
  mainWindow.on('close', (e) => {
    if (app.isQuiting) return;
    e.preventDefault();
    mainWindow.hide();
  });
}

// Harley'yi öne getir (tepsi / kısayol / sesli komut).
function showMain() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------- Piper TTS (yerel, ücretsiz, sınırsız) ----------
// Windows binary'si + Türkçe ses (dfki-medium) HarleySes/piper klasörüne indirilir.
// ASCII yolda olmalı — piper.exe espeak-ng-data'yı Türkçe karakterli yollardan açamıyor.
const PIPER_DIR = CFG.PIPER_DIR;
const PIPER_EXE = CFG.PIPER_EXE;
const PIPER_MODEL = CFG.PIPER_MODEL;
const PIPER_CONFIG = CFG.PIPER_CONFIG;
const PIPER_VOICE_URL = CFG.PIPER_VOICE_URL;
const PIPER_CFG_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx.json';
const PIPER_ZIP_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';

function httpGetFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const r = mod.get(url, { headers: { 'User-Agent': 'Harley/1.0' } }, (res) => {
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      const f = fs.createWriteStream(dest);
      res.on('data', (c) => {
        got += c.length;
        if (onProgress && total) onProgress(Math.min(1, got / total));
      });
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve(dest)));
      f.on('error', reject);
      res.on('error', reject);
    });
    r.on('error', reject);
    r.setTimeout(300000, () => r.destroy(new Error('indirme zaman aşımı: ' + url)));
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    try {
      fs.mkdirSync(destDir, { recursive: true });
    } catch { /* var */ }
    const cmd = `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
    const p = spawn('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (c) => (err += c));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('zip açılamadı: ' + err.slice(0, 200)))));
  });
}

// Piper runtime'ı indir/kontrol et. İndirme ilerlemesi renderer'a gider.
async function ensurePiper() {
  if (fs.existsSync(PIPER_EXE) && fs.existsSync(PIPER_MODEL) && fs.existsSync(PIPER_CONFIG)) return true;
  try {
    fs.mkdirSync(PIPER_DIR, { recursive: true });
  } catch { /* var */ }
  const send = (msg) => {
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.webContents.send('tts:piper-progress', msg); } catch { /* yok */ }
    }
  };
  send('piper indiriliyor…');
  if (!fs.existsSync(path.join(PIPER_DIR, 'piper.exe'))) {
    const zip = path.join(PIPER_DIR, 'piper.zip');
    send('Piper motoru indiriliyor… (%0)');
    await httpGetFile(PIPER_ZIP_URL, zip, (p) => send('Piper motoru indiriliyor… (%' + Math.round(p * 100) + ')'));
    // zip içinde piper/piper.exe var — köke taşı
    await extractZip(zip, path.join(PIPER_DIR, '_x'));
    const nested = path.join(PIPER_DIR, '_x', 'piper');
    const srcDir = fs.existsSync(nested) ? nested : path.join(PIPER_DIR, '_x');
    for (const f of fs.readdirSync(srcDir)) {
      const from = path.join(srcDir, f);
      const to = path.join(PIPER_DIR, f);
      if (!fs.existsSync(to)) fs.renameSync(from, to);
    }
    try { fs.rmSync(path.join(PIPER_DIR, '_x'), { recursive: true, force: true }); } catch { /* yok */ }
    try { fs.rmSync(zip, { force: true }); } catch { /* yok */ }
  }
  if (!fs.existsSync(PIPER_MODEL)) {
    send('Türkçe ses modeli indiriliyor… (%0)');
    await httpGetFile(PIPER_VOICE_URL, PIPER_MODEL, (p) => send('Türkçe ses modeli indiriliyor… (%' + Math.round(p * 100) + ')'));
  }
  if (!fs.existsSync(PIPER_CONFIG)) {
    await httpGetFile(PIPER_CFG_URL, PIPER_CONFIG);
  }
  send('piper hazır');
  return true;
}

function piperTTS(text) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(require('os').tmpdir(), 'harley-piper-' + Date.now() + '.wav');
    const child = spawn(PIPER_EXE, ['-m', PIPER_MODEL, '-c', PIPER_CONFIG, '-f', tmp], { cwd: PIPER_DIR, windowsHide: true });
    let err = '';
    child.stderr.on('data', (c) => (err += c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error('Piper hatası: ' + err.slice(0, 250)));
      fs.readFile(tmp, (e, buf) => {
        try { fs.unlinkSync(tmp); } catch { /* yok */ }
        if (e) return reject(e);
        resolve({ audio: buf.toString('base64'), mime: 'audio/wav' });
      });
    });
    child.stdin.write(String(text || ''));
    child.stdin.end();
  });
}

// ---------- Edge TTS (Microsoft neural sesler — ücretsiz, anahtar yok, internet ister) ----------
// node-edge-tts paketiyle Microsoft Edge'in sinirsel seslerini kullanır.
// Türkçe: tr-TR-EmelNeural (kadın) / tr-TR-AhmetNeural (erkek).
const EDGE_VOICE = 'tr-TR-EmelNeural';
function edgeTTS(text) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(require('os').tmpdir(), 'harley-edge-' + Date.now() + '.mp3');
    let tts;
    try {
      const { EdgeTTS } = require('node-edge-tts');
      tts = new EdgeTTS({
        voice: EDGE_VOICE,
        lang: 'tr-TR',
        outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
        rate: '+0%',
        timeout: 15000,
      });
    } catch (e) {
      return reject(new Error('node-edge-tts yüklenemedi: ' + e.message));
    }
    tts.ttsPromise(String(text || ''), tmp)
      .then(() => {
        fs.readFile(tmp, (e, buf) => {
          try { fs.unlinkSync(tmp); } catch { /* yok */ }
          if (e) return reject(e);
          resolve({ audio: buf.toString('base64'), mime: 'audio/mpeg' });
        });
      })
      .catch((e) => {
        try { fs.unlinkSync(tmp); } catch { /* yok */ }
        reject(new Error('Edge TTS: ' + (e && e.message ? e.message : e)));
      });
  });
}

// ---------- Otomatik hafıza ("kendini eğitsin") ----------
// Her tamamlanan sohbetten sonra yerel model (qwen3:4b) kullanıcı hakkında
// KALICI gerçekleri çıkarır ve Bellek.md'ye ekler. Best-effort: herhangi bir
// hata sessizce yutulur, asla sohbet akışını engellemez.
function cloudComplete(prompt, maxTokens) {
  return new Promise((resolve, reject) => {
    let cfg = {};
    try {
      cfg = secureStore.readJson(FILES.deepseek);
    } catch { /* yok */ }
    if (!cfg.apiKey) return resolve('');
    const body = JSON.stringify({
      model: cfg.model || 'deepseek-flash',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      max_tokens: maxTokens || 600,
      temperature: 0.2,
    });
    const https = require('https');
    const req = https.request({
      hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve((JSON.parse(d).choices && JSON.parse(d).choices[0] && JSON.parse(d).choices[0].message.content) || ''); }
        catch { resolve(''); }
      });
    });
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.on('error', () => reject(new Error('DeepSeek erişilemedi')));
    req.write(body);
    req.end();
  });
}
let lastLearnAt = 0;
async function learnFromChat(userText, assistantText) {
  const s = readSettings();
  if (s.autoMemory === false) return;
  // Throttle: 60 sn — modeli yormayacak sıklıkta öğrenme.
  const now = Date.now();
  if (now - lastLearnAt < 60000) return;
  lastLearnAt = now;
  const chat = String(userText || '') + '\n' + String(assistantText || '');
  if (chat.trim().length < 80) return; // çok kısa sohbetleri atla
  // Güçlü bulut modeli (DeepSeek) kullan
  const learnModel = 'deepseek-flash';
  const prompt =
    'Aşağıdaki sohbetten KULLANICI hakkında SADECE faydalı ve kalıcı bilgileri çıkar.\n' +
    'ÇIKARILACAK BİLGİLER (sadece bunlar):\n'
    + '- Proje isimleri, teknolojiler, framework\'ler\n'
    + '- Kişisel tercihler (programlama dili, IDE, kodlama stili)\n'
    + '- Hedefler, görevler, yapılacaklar\n'
    + '- Önemli kararlar ("şunu yapacağız", "buna geçtik")\n'
    + '- Kişiler (isim + ilişki: "arkadaşım", "ekip arkadaşım")\n'
    + '- Roblox/studio tercihleri, oyun türleri, tasarım kararları\n'
    + '- Teknik tercihler ("DeepSeek kullanıyoruz", "Google Sheets")\n'
    + '\nÇIKARMAYACAĞIN BİLGİLER (önemsiz, boş ver):\n'
    + '- Renk tercihleri, yiyecek/içecek, hava durumu, saat\n'
    + '- Geçici durumlar ("şu an müzik dinliyorum")\n'
    + '- Harley hakkındaki yorumlar, teşekkürler, selamlaşmalar\n'
    + '- Genel/günlük konuşmalar, şakalar, modulesvb\n'
    + '\nHer gerçeği tek satır, "- " ile başlat, kısa ve net yaz. ' +
    'Öğrenilecek faydalı bir şey yoksa sadece YOK yaz.\n\nSOHBET:\n' +
    chat.slice(-4000);
  let out = '';
  try {
    out = await cloudComplete(learnModel, prompt, 400);
  } catch {
    // model hazır değilse sessiz kal
    return;
  }
  const lines = String(out || '')
    .split('\n')
    .map((l) => l.replace(/^[-•]\s*/, '').trim())
    .filter((l) => l && l.length > 5 && !/^yok/i.test(l) && !/harley|asistan|sohbet|merhaba|teşekkür/i.test(l));
  if (!lines.length) return;
  const file = FILES.memory;
  let existing = '';
  try { existing = fs.readFileSync(file, 'utf8'); } catch { /* yoksa boş */ }
  const existingLower = existing.toLowerCase();
  const fresh = lines.filter((l) => !existingLower.includes(l.toLowerCase().slice(0, 40)));
  if (!fresh.length) return;
  let all = (existing.trim() + '\n' + fresh.map((l) => '- ' + l).join('\n')).trim().split('\n');
  if (all.length > 400) all = all.slice(all.length - 400);
  fs.writeFileSync(file, all.join('\n') + '\n', 'utf8');
}

// === Konuşma Özeti: her başarılı yanıt sonrası 1 cümlelik özet çıkar ===
let lastSummaryAt = 0;
async function summarizeConversation(userText, assistantText) {
  const s = readSettings();
  if (s.autoMemory === false) return;
  const now = Date.now();
  if (now - lastSummaryAt < 120000) return; // 2 dakikada bir max
  lastSummaryAt = now;
  const chat = String(userText || '') + '\n' + String(assistantText || '');
  if (chat.trim().length < 200) return;
  const prompt =
    'Bu konuşmayı 1 cümlede özetle — SADECE projeler, kararlar, hedefler veya önemli teknik bilgiler hakkında. ' +
    'Kişisel tercihler (renk, yiyecek) veya genel konuşmaları yazma. ' +
    'Cümle "' + (s.name || 'Kullanıcı') + ' ..." ile başlasın. Kısa ve net yaz. Maksimum 100 karakter.\n\nSOHBET:\n' +
    chat.slice(-3000);
  try {
    const out = await cloudComplete(prompt, 500);
    const summary = String(out || '').trim();
    if (!summary || summary.length < 15 || /^yok/i.test(summary)) return;
    const sf = FILES.sessionSummaries;
    let summaries = [];
    try { summaries = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch { summaries = []; }
    // Tekrar ekleme
    if (!summaries.some((s) => s.toLowerCase() === summary.toLowerCase())) {
      summaries.push(summary);
      if (summaries.length > 50) summaries = summaries.slice(-50);
      fs.writeFileSync(sf, JSON.stringify(summaries, null, 2), 'utf8');
    }
  } catch { /* sessiz */ }
}

// ---------- Token & kullanım takibi (usage.json) ----------
const USAGE_FILE = FILES.usage;
function readUsage() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    return { days: {}, models: {}, total: 0 };
  }
}
function writeUsage(u) {
  try {
    fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(u, null, 2), 'utf8');
  } catch { /* sessiz */ }
}
// Tahmini token: karakter / 4 (yaklaşık; Türkçe için biraz iyimser ama tutarlı)
function approxTokens(text) {
  return Math.max(1, Math.round(String(text || '').length / 4));
}
function recordUsage(modelId, inputText, outputText) {
  try {
    const u = readUsage();
    const today = new Date().toISOString().slice(0, 10);
    const inT = approxTokens(inputText);
    const outT = approxTokens(outputText);
    const d = u.days[today] || { input: 0, output: 0, msgs: 0 };
    d.input += inT; d.output += outT; d.msgs += 1;
    u.days[today] = d;
    const m = u.models[modelId] || { input: 0, output: 0, msgs: 0 };
    m.input += inT; m.output += outT; m.msgs += 1;
    u.models[modelId] = m;
    u.total = (u.total || 0) + inT + outT;
    // son 60 günü tut
    const keys = Object.keys(u.days).sort();
    if (keys.length > 60) for (const k of keys.slice(0, keys.length - 60)) delete u.days[k];
    writeUsage(u);
  } catch { /* sessiz */ }
}

// ---------- Hatırlatıcılar ----------
// "10 dakika sonra hatırlat" gibi komutlar buraya gelir (yerel JSON dosyası).
const REMIND_FILE = FILES.reminders;
let reminders = [];
function loadReminders() {
  try {
    const now = Date.now();
    reminders = (JSON.parse(fs.readFileSync(REMIND_FILE, 'utf8')) || [])
      .filter((r) => r && r.due > now - 5 * 60000); // geçmişte kalanları at (5dk tolerans)
  } catch {
    reminders = [];
  }
}
function saveReminders() {
  try {
    fs.mkdirSync(path.dirname(REMIND_FILE), { recursive: true });
    fs.writeFileSync(REMIND_FILE, JSON.stringify(reminders), 'utf8');
  } catch { /* yazılamazsa sadece bellekte kalır */ }
}
// "10m", "1h30m", "45s", "18:30", "yarın 09:00" veya ISO tarih → milisaniye.
function parseRemindTime(input) {
  const s = String(input || '').trim().toLowerCase();
  const rel = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (rel && (rel[1] || rel[2] || rel[3])) {
    const h = parseInt(rel[1] || 0, 10), mi = parseInt(rel[2] || 0, 10), se = parseInt(rel[3] || 0, 10);
    if (h + mi + se > 0) return Date.now() + (h * 3600 + mi * 60 + se) * 1000;
  }
  const clock = s.match(/^(?:yarın\s+)?(\d{1,2})[:.](\d{2})$/);
  if (clock) {
    const d = new Date();
    if (s.startsWith('yarın')) d.setDate(d.getDate() + 1);
    d.setHours(parseInt(clock[1], 10), parseInt(clock[2], 10), 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}
async function fireReminder(message) {
  const clean = String(message || '').trim().slice(0, 300);
  // Windows bildirimi
  try {
    new Notification({ title: T('Harley — Hatırlatma'), body: clean, icon: ICON }).show();
  } catch { /* yok */ }
  // Sesli oku (Edge → Piper yedeği)
  if (clean) {
    (async () => {
      try {
        const r = await edgeTTS('Hatırlatma: ' + clean);
        for (const w of BrowserWindow.getAllWindows()) {
          try { w.webContents.send('tts:play', { audio: r.audio, mime: r.mime }); } catch { /* yok */ }
        }
      } catch {
        try {
          await ensurePiper();
          const r = await piperTTS('Hatırlatma: ' + clean);
          for (const w of BrowserWindow.getAllWindows()) {
            try { w.webContents.send('tts:play', { audio: r.audio, mime: 'audio/wav' }); } catch { /* yok */ }
          }
        } catch { /* ses yoksa sessiz geç */ }
      }
    })();
  }
  // Sohbete de yaz
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('reminder:fire', { message: clean }); } catch { /* yok */ }
  }
}

// ---------- Roblox Studio köprüsü ----------
// Studio'daki "Harley Bağla" eklentisi (HarleyStudio) bu kuyruğu saniyede bir
// poll'lar; görev gelince Luau çalıştırır ve sonucu geri yazar. Böylece Harley
// (Studio Komut aracı üzerinden) kullanıcının Studio'sunda kod
// çalıştırabilir, script kaynağı okuyup değiştirebilir, proje yapısını görebilir.
const studioTasks = new Map();
const studioAgents = new Map(); // agent id -> son görülme
let studioSeq = 0;
const STUDIO_TASK_TTL = 120000; // görev 2 dk içinde alınmazsa düşer
const STUDIO_RESULT_TTL = 90000; // sonuç 90 sn sonra temizlenir
function studioNewId() {
  return 's' + (++studioSeq) + '-' + Date.now().toString(36);
}
// Studio penceresini öne getir (Playtest F5 tuşu oraya gitsin).
function studioFocus() {
  return new Promise((resolve) => {
    const ps =
      "Get-Process | Where-Object { $_.MainWindowTitle -like '*Roblox Studio*' } | Select-Object -First 1 -ExpandProperty Id";
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, out) => {
      const pid = String(out || '').trim();
      if (!pid) return resolve(false);
      const cmd =
        'Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate(' + pid + ')';
      execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true }, () => resolve(true));
    });
  });
}
// Studio'ya klavye kısayolu gönder: F5 = Play, Shift+F5 = Stop.
function studioKey(keys) {
  return new Promise((resolve) => {
    const cmd = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('" + keys + "')";
    execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true }, () => resolve(true));
  });
}
// Studio'nun en yeni log dosyasından script hatalarını topla.
function readStudioLog() {
  try {
    const dir = path.join(process.env.LOCALAPPDATA || path.join(CFG.USERPROFILE, 'AppData', 'Local'), 'Roblox', 'Studio', 'logs');
    if (!fs.existsSync(dir)) return 'Studio log klasörü bulunamadı: ' + dir;
    const files = fs
      .readdirSync(dir)
      .map((f) => path.join(dir, f))
      .filter((f) => { try { return fs.statSync(f).isFile() && /\.log$/i.test(f); } catch { return false; } })
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (!files.length) return 'Log dosyası yok.';
    const txt = fs.readFileSync(files[0], 'utf8');
    const lines = txt
      .split('\n')
      .filter((l) => /error|attempt to|Script '|Workspace\.|ServerScriptService|Stack Begin|unable to|invalid|Expected|unexpected/i.test(l))
      .slice(-40);
    if (!lines.length) return 'Son logda script hatası görünmüyor (' + path.basename(files[0]) + ').';
    return 'STUDIO LOG HATALARI (' + path.basename(files[0]) + '):\n' + lines.join('\n');
  } catch (e) {
    return 'Log okunamadı: ' + e.message;
  }
}

ipcMain.handle('tts:edge', async (_e, { text }) => {
  try {
    const r = await edgeTTS(text);
    return { audio: r.audio, mime: r.mime };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('tts:piper', async (_e, { text }) => {
  try {
    await ensurePiper();
    if (!text) return { ready: true };
    const r = await piperTTS(text);
    return { audio: r.audio, mime: r.mime };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('tts:status', async () => {
  return {
    piperReady: fs.existsSync(PIPER_EXE) && fs.existsSync(PIPER_MODEL) && fs.existsSync(PIPER_CONFIG),
  };
});

// ---------- single instance ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ---------- IPC ----------
// ---------- Günün özeti (tek akış, servis hatası özeti öldürmez) ----------
// Günün Özeti 4 Google servisini PARALEL toplar; bir servis çökse bile özet
// üretilir. Sonuç 2 dk önbelleğe alınır ve modelin okuyacağı düz metne kurulur.
// ---------- Günün Özeti: doğrudan Google API (n8n kaldırıldı) ----------
// Kimlik bilgileri (kullanıcı ev klasörü)/HarleyDosyalar/google-config.json içinde tutulur:
//   { "client_id": "...", "client_secret": "...", "refresh_token": "..." }
// 4 servis PARALEL toplanır; bir servis hata verirse diğerleri yine üretilir.
// (Tüm Google fonksiyonları google.js modülüne taşındı.)
// ---------- Hava durumu (Open-Meteo — ücretsiz, anahtar yok) ----------
const WMO = { 0:'açık', 1:'az bulutlu', 2:'parçalı bulutlu', 3:'kapalı', 45:'sisli', 48:'kırağılı sis', 51:'hafif çisenti', 53:'çisenti', 55:'yoğun çisenti', 61:'hafif yağmur', 63:'yağmur', 65:'şiddetli yağmur', 66:'dondurucu yağmur', 67:'şiddetli dondurucu yağmur', 71:'hafif kar', 73:'kar', 75:'yoğun kar', 77:'kar taneleri', 80:'hafif sağanak', 81:'sağanak', 82:'şiddetli sağanak', 85:'hafif kar sağanağı', 86:'yoğun kar sağanağı', 95:'gök gürültülü fırtına', 96:'fırtına ve dolu', 99:'şiddetli fırtına ve dolu' };
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
  try {
    const geo = await httpJson('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1&language=tr&format=json');
    const loc = geo && geo.results && geo.results[0];
    if (!loc) return null;
    const f = await httpJson('https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude + '&longitude=' + loc.longitude + '&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1');
    const c = f.current || {};
    const d = f.daily || {};
    const num = (x) => (x == null ? null : Math.round(x));
    return {
      sehir: loc.name,
      durum: WMO[c.weather_code] || 'bilinmiyor',
      sicaklik: num(c.temperature_2m),
      ruzgar: num(c.wind_speed_10m),
      max: d.temperature_2m_max && num(d.temperature_2m_max[0]),
      min: d.temperature_2m_min && num(d.temperature_2m_min[0]),
      yagis: d.precipitation_probability_max && num(d.precipitation_probability_max[0]),
    };
  } catch { return null; }
}
// Günaydın rutini: ayar açıksa günde bir — hava durumu + günün özetini sesli söyler.
async function runMorningRoutine() {
  const st = readSettings();
  if (st.morningRoutine !== true) return;
  const today = new Date().toDateString();
  if (st.morningLastRun === today) return;
  const hitap = String(st.address || st.name || '').trim();
  const lines = ['Günaydın' + (hitap ? ' ' + hitap : '') + '!'];
  if (st.city && String(st.city).trim()) {
    const w = await getWeather(String(st.city).trim());
    if (w) {
      lines.push(w.sehir + ' bugün ' + w.durum + ', ' + w.sicaklik + ' derece.');
      if (w.min != null && w.max != null) lines.push('Günün en düşüğü ' + w.min + ', en yükseği ' + w.max + ' derece.');
      if (w.yagis != null) lines.push('Yağış olasılığı yüzde ' + w.yagis + '.');
      if (w.ruzgar != null) lines.push('Rüzgar saatte ' + w.ruzgar + ' kilometre.');
    } else {
      lines.push('Hava durumunu çekemedim (internet yok olabilir).');
    }
  }
  try {
    const oz = await google.runOzet();
    if (oz && oz.text) lines.push(String(oz.text).replace(/^GÜNÜN ÖZETİ[\s\S]*?:\s*\n?/i, '').trim());
  } catch { /* özet yoksa hava durumu yeter */ }
  // #1: Bağlı projelerin dünkü değişiklik özeti
  try {
    const wsList = (() => { try { return JSON.parse(fs.readFileSync(FILES.workspace, 'utf8')); } catch { return {}; } })();
    const sids = Object.keys(wsList || {});
    if (sids.length) {
      const projLines = [];
      for (const sid of sids) {
        const repo = workspace.getRepo(sid);
        const log = await workspace.gitRun(sid, ['log', '--since=1 day ago', '--oneline'], 10000);
        const commits = (log.ok && log.output && log.output !== '(çıktı yok)') ? log.output.split('\n').filter(Boolean) : [];
        if (commits.length) projLines.push('  · ' + (repo ? repo.name : 'proje') + ': ' + commits.length + ' yeni commit');
      }
      if (projLines.length) lines.push('\nDünkü proje özeti:\n' + projLines.join('\n'));
    }
  } catch { /* yok */ }
  const text = lines.filter(Boolean).join('\n');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('morning:briefing', { text });
  }
  // Başarıyla üretildikten sonra günde-bir işaretini koy (tekrar denemez).
  try { fs.writeFileSync(settingsPath(), JSON.stringify({ ...readSettings(), morningLastRun: today }, null, 2)); } catch { /* önemsiz */ }
  console.log('[assistant] günaydın rutini tamam');
}
// Günün özeti niyetini yakala — modeli ATLA, hazır özeti doğrudan döndür
// (deterministik + anında + sesli okunur).
const OZET_INTENT = /^\s*(bana\s+)?(günün özeti|gunun ozeti|günün özetini|gunun ozetini|bugünün özeti|bugunun ozeti|bugünün özetini|bugunun ozetini|özet çıkar|ozet cikar|özetini çıkar|ozetini cikar|özeti ver|ozeti ver|özet al|ozet al|bugün ne var|bugun ne var|bugün ne yapıyor|bugun ne yapiyor|bugün neler var|bugun neler var|bugün ne bekliyor|bugun ne bekliyor|günüm nasıl|gunum nasil|bugünüm nasıl|bugunum nasil|gününü özetle|gununu ozetle|günaydın|gunaydin|güne genel bakış|gune genel bakis|güne genel bakıs)\b.*/i;
// E-posta niyeti — okunmamış mailler doğrudan Google'dan çekilir (model gerekmez).
const EMAIL_INTENT = /^\s*(bana\s+)?(okunmamış\s+|okunmamis\s+)?(e-?posta(ları|larım|larımı|ların)?|email(ler)?(im)?(im)?|mailler(im)?(imi)?|mail(ler)?(im)?(imi)?)(\s*(neler|neleri|nedir|var mı|varmı|göster|goster|söyle|soyle|listele|oku|okuyabilir misin|okuyabilirmisin|sor)\??)?.*/i;
// Takvim'e etkinlik ekleme niyeti.
const ADD_EVENT_INTENT = /(takvime?|takvimime|etkinlik|etkinlikleri?|randevu|toplantı|toplanti|buluşma|bulusma|görüşme|gorusme)\s+(ekle|oluştur|olustur|kaydet|programla|planla|ayarla|kur)|(ekle|oluştur|olustur|kaydet)\s+(takvime?|takvimime|etkinlik|randevu|toplantı|toplanti)/i;
// Görev ekleme niyeti.
const ADD_TASK_INTENT = /(göreve?|goreve?|görev olarak|gorev olarak|yapılacaklara?|yapilacaklara?|to-?do(ya)?|liste(me)?(ye)?)\s+ekle|ekle\s*:\s*.+/i;
// Görev tamamlama niyeti. "tamamla/kapat/bitir" gibi fiiller tek başına yeterli değil —
// mutlaka görev bağlamı (görev/yapılacak/madde/liste) olmalı. Aksi halde
// "hikâye tamamlayalım" gibi oyun istekleri yanlışlıkla görev-tamamlamaya gider.
const COMPLETE_TASK_INTENT = /(görev|gorev|yapılacak|yapilacak|madde|liste)\S*\s+[^\s]+\s+(tamamla|tamamlandı|tamamlandi|bitir|bitti|kapat|yaptım|yaptim|işaretle|isaretle)|(görev|gorev|yapılacak|yapilacak|madde|liste)\S*\s+(tamamla|tamamlandı|tamamlandi|bitir|bitti|kapat|yaptım|yaptim|işaretle|isaretle)|(tamamla|tamamlandı|tamamlandi|bitir|bitti|kapat|yaptım|yaptim|işaretle|isaretle)\s+(görev|gorev|yapılacak|yapilacak|madde|liste)\S*/i;
// Eğlence niyetleri.
const GAME_START_INTENT = /(oyun (oynayalım|oyna|başlatalım|oynayalim|oynayalım mı|oynayalım$)|oyun başlat|birlikte oynayalım|kelime avı|kelime avi|sayı tahmin|sayi tahmin|20 soru|yirmi soru|[şs]ehir[\s-]?[üu]lke[\s-]?meyve|[şs]ehir[\s-]?[üu]lke|[üu]lke[\s-]?meyve|hik[âa]y[eâ] tamamla|hik[âa]y[eâ] tamamlama|hik[âa]y[eâ] yaz)/i;
const STOP_GAME_INTENT = /(oyunu? (bitir|kapat|dur)|oyun bitti|durdur|oyunu bırak|oyunu birak|iptal|vazgeç|vazgec|boş\s*ver|bos\s*ver|yeter|bırak|birak)/i;
const MOTIVATION_INTENT = /(motivasyon|motive|ilham ver|ilham|moral ver|moralim|moral)/i;
const FACT_INTENT = /(ilginç|ilginc|enteresan|şaşırtıcı|sasirtici) (bir )?bilgi/i;
const SONG_INTENT = /(günün şarkısı|gunun sarkisi|şarkı öner|sarki oner|günün müziği|gunun muzigi)/i;
// "Günün şarkısı" önerisini onaylayan cevaplar → saklanan şarkı çalınır. Sadece net şarkı
// onayları kabul edilir; "evet/tamam/harika" gibi genel kelimeler uzun prompt'ta yanlış
// tetiklenmesin. Ayrıca lastSong 2 dk'dan eskiyse iptal (zaman aşımı).
const CONFIRM_PLAY_INTENT = /^(evet çal|evet dinlemek istiyorum|dinlemek isterim|dinleyelim|çal şunu|çal şarkıyı|çal)\s*$/i;

// ---------- Function-calling araç kaydı (DeepSeek tools) ----------
const TOOLS = [
  { type: 'function', function: { name: 'get_time', description: 'Şu anki tarih ve saati döndürür.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'get_emails', description: 'Kullanıcının okunmamış e-postalarını (konu + gönderen) listeler.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'get_calendar', description: 'Kullanıcının bugünkü takvim etkinliklerini listeler.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'get_tasks', description: 'Kullanıcının açık görevlerini (Google Tasks) listeler.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'get_summary', description: 'Günün özetini üretir (takvim + e-posta + görevler + drive).', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'add_calendar_event', description: 'Kullanıcının takvimine etkinlik ekler.', parameters: { type: 'object', properties: { summary: { type: 'string', description: 'Etkinlik adı' }, start: { type: 'string', description: 'Başlangıç, ISO tarih-saat (RFC3339). Örnek: 2026-08-21T10:00:00+03:00' }, end: { type: 'string', description: 'Bitiş, ISO tarih-saat. Boşsa başlangıçtan 1 saat sonra olur.' }, description: { type: 'string' } }, required: ['summary', 'start'] } } },
  { type: 'function', function: { name: 'add_task', description: 'Kullanıcının Google Tasks listesine görev ekler.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Görev adı' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'complete_task', description: 'Kullanıcının Google Tasks listesindeki bir açık görevi tamamlar.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Tamamlanacak görevin adı (kısmen de olur)' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'web_search', description: 'İnternette güncel bilgi arar (web araması). Modelin güncel/doğrulanabilir bilgiye ihtiyacı olduğunda kullan.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Arama sorgusu' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'drive_summarize', description: 'Google Drive\'daki bir dosyanın içeriğini okur ve özetler (Google Doküman/Tablo veya metin dosyası).', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Dosya adı veya adın parçası. Boşsa en son dosyayı özetler.' } }, required: [] } } },
  { type: 'function', function: { name: 'start_game', description: 'Eğlence sohbet oyunu başlatır. Kullanıcı oyun oynamak istediğinde çağır.', parameters: { type: 'object', properties: { game: { type: 'string', description: 'Oyun adı: Kelime Avı, Sayı Tahmin, 20 Soru, Şehir-Ülke-Meyve, Hikâye Tamamlama' } }, required: ['game'] } } },
  { type: 'function', function: { name: 'game_move', description: 'Aktif oyundaki kullanıcı hamlesini işler. Kullanıcı cevap/tahmin/soru söylediğinde çağır.', parameters: { type: 'object', properties: { move: { type: 'string', description: 'Kullanıcının hamlesi (tahmin, cevap, soru veya hikâye devamı)' } }, required: ['move'] } } },
  { type: 'function', function: { name: 'daily_motivation', description: 'Günlük ilham verici bir söz döndürür. Kullanıcı motivasyon/ilham istediğinde çağır.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'fun_fact', description: 'İlginç/şaşırtıcı bir bilgi döndürür. Kullanıcı ilginç bilgi istediğinde çağır.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'song_of_day', description: 'Günün şarkısını önerir. Kullanıcı günün şarkısını istediğinde çağır.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'hava_durumu', description: 'Belirtilen şehir için GÜNCEL hava durumunu döndürür. Kullanıcı hava durumunu/havayı sorduğunda MUTLAKA bunu çağır (web araması YAPMA). Şehir verilmezse kullanıcının ayarlardaki şehri kullanılır.', parameters: { type: 'object', properties: { sehir: { type: 'string', description: 'Şehir adı, örn. İstanbul. Boş bırakılırsa ayarlardaki şehir.' } }, required: [] } } },
  { type: 'function', function: { name: 'spotify_play', description: 'Spotify\'da belirtilen şarkıyı/sanatçıyı çalar. Kullanıcı "şu şarkıyı çal / müzik aç" dediğinde çağır. Spotify\'ın bağlı ve masaüstü uygulamasının açık olması gerekir.', parameters: { type: 'object', properties: { sarki: { type: 'string', description: 'Şarkı adı ve/veya sanatçı, örn. "Sezen Aksu" veya "Shape of You"' } }, required: ['sarki'] } } },
  { type: 'function', function: { name: 'workspace_list', description: 'Bu sohbete bağlı çalışma klasöründeki dosya/klasörleri listeler.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Klasöre göre göreli yol. Boşsa kök.' } }, required: [] } } },
  { type: 'function', function: { name: 'workspace_read', description: 'Çalışma klasöründeki bir dosyanın içeriğini okur (kökten göreli yol).', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Göreli dosya yolu, ör. src/app.js' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'workspace_write', description: 'Çalışma klasörüne dosya yazar veya üzerine yazar (kökten göreli yol). Klasörler otomatik oluşturulur.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Göreli dosya yolu' }, content: { type: 'string', description: 'Dosya içeriği' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'workspace_append', description: 'Çalışma klasöründeki bir dosyanın sonuna metin ekler (günlük, log, TODO gibi).', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Göreli dosya yolu' }, content: { type: 'string', description: 'Eklenecek metin' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'workspace_mkdir', description: 'Çalışma klasöründe yeni bir klasör (dizin) oluşturur.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Oluşturulacak göreli klasör yolu' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'workspace_delete', description: 'Çalışma klasöründeki bir dosyayı veya boş klasörü siler.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Silinecek göreli yol' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'workspace_move', description: 'Çalışma klasöründeki bir dosyayı/klasörü taşır veya yeniden adlandırır.', parameters: { type: 'object', properties: { from: { type: 'string', description: 'Mevcut göreli yol' }, to: { type: 'string', description: 'Yeni göreli yol' } }, required: ['from', 'to'] } } },
  { type: 'function', function: { name: 'workspace_run', description: 'Çalışma klasöründe bir komut çalıştırır (terminal). Örn: node app.js, npm install, python main.py, npx tsc, npm run build. Çıktıyı döndürür.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Çalıştırılacak komut' }, timeout: { type: 'number', description: 'Milisaniye cinsinden zaman aşımı (varsayılan 30000)' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'task_plan', description: 'Uzun görevi adım adım plana döker. SADECE gerçekten uzun görevlerde kullan (3+ dosya / 3+ adım). Adımlar KISA olsun — 3-6 adım, her biri en fazla 6-8 kelime, madde işareti gibi. Örn: "Klasör kur", "Sınıfı yaz", "Test et". Detaylı cümleler yazma.', parameters: { type: 'object', properties: { description: { type: 'string', description: 'Görevin kısa açıklaması' }, steps: { type: 'array', items: { type: 'string' }, description: 'Kısa adımlar (3-6 adım, her biri 6-8 kelime)' } }, required: ['description', 'steps'] } } },
  { type: 'function', function: { name: 'task_mark_done', description: 'Plana göre bir adımı tamamlandı olarak işaretler. Adımı bitirdikten sonra çağır.', parameters: { type: 'object', properties: { step: { type: 'integer', description: 'Tamamlanan adımın numarası (0 tabanlı, plana göre)' } }, required: ['step'] } } },
  { type: 'function', function: { name: 'workspace_run_bg', description: 'Çalışma klasöründe bir komutu ARKA PLANDA başlatır (dev server, watcher vb.). PID döndürür; çıktı log dosyasına yazılır. wsBgStatus ile durumunu kontrol et, wsHttp ile test et.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Çalıştırılacak komut' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'workspace_bg_status', description: 'Arka planda çalışan bir sürecin durumunu ve son çıktısını döndürür.', parameters: { type: 'object', properties: { pid: { type: 'number', description: 'Süreç numarası (PID)' } }, required: ['pid'] } } },
  { type: 'function', function: { name: 'workspace_http', description: 'Belirtilen URL\'ye HTTP GET isteği atar. Dev sunucusu test etmek için kullanılır (localhost:5173, 3000 vb.).', parameters: { type: 'object', properties: { url: { type: 'string', description: 'Test edilecek URL (örn. http://localhost:5173)' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'workspace_test', description: 'Bağlı klasörde testleri çalıştırır. Proje tipini otomatik algılar (npm test / pytest / cargo test / go test). İşi bitirmeden önce mutlaka test et.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'İsteğe bağlı özel test komutu. Boşsa otomatik algılanır.' } }, required: [] } } },
  { type: 'function', function: { name: 'workspace_search', description: 'Bağlı klasördeki kaynak kodda bir kavramı/işlevi arar (RAG). "X nerede/ne işe yarıyor" gibi sorularda önce bunu çağır — ilgili dosyaları tek tek okumak yerine bağlam al.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Aranacak kavram/anahtar kelimeler (örn. "login handler" veya "parseDateTime")' }, limit: { type: 'number', description: 'Kaç sonuç dönsün (varsayılan 5)' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'git_status', description: 'Bağlı klasörün git durumunu gösterir (değişen dosyalar, branch).', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'git_diff', description: 'Bağlı klasördeki değişiklikleri (unstaged diff) gösterir.', parameters: { type: 'object', properties: { file: { type: 'string', description: 'İsteğe bağlı: yalnızca bu dosyanın diff\'i' } }, required: [] } } },
  { type: 'function', function: { name: 'git_commit', description: 'Bağlı klasördeki değişiklikleri commit\'ler (tüm değişiklikler stage edilir).', parameters: { type: 'object', properties: { message: { type: 'string', description: 'Commit mesajı' } }, required: ['message'] } } },
  { type: 'function', function: { name: 'git_log', description: 'Bağlı klasörün son commit geçmişini gösterir.', parameters: { type: 'object', properties: { count: { type: 'number', description: 'Kaç commit gösterilecek (varsayılan 10)' } }, required: [] } } },
  { type: 'function', function: { name: 'git_push', description: 'Bağlı klasördeki commit\'leri GitHub\'a gönderir (push). KULLANICIDAN ONAY İSTER — değişiklikleri önce git_diff ile göster, sonra çalıştır.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'git_pull', description: 'GitHub\'dan bağlı klasöre değişiklikleri çeker (pull).', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'git_create_repo', description: 'Bağlı klasörü GitHub\'da yeni bir repo olarak oluşturur ve ilk push\'u yapar. KULLANICIDAN ONAY İSTER — repo adını öner ve kullanıcıya sor.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Repo adı (harf/rakam/-, _, .)' }, description: { type: 'string', description: 'Repo açıklaması (isteğe bağlı)' }, private: { type: 'boolean', description: 'Gizli repo olsun mu (varsayılan false)' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'git_link_repo', description: 'Bağlı klasörü GitHub\'da ZATEN VAR olan bir repoya bağlar (remote ekler) ve mevcut dosyaları push eder. Repo adı zaten kullanılıyorsa yeni repo oluşturmak yerine bunu kullan. KULLANICIDAN ONAY İSTER.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Bağlanılacak repo adı (örn. harley-test-v2)' }, private: { type: 'boolean', description: 'Repo gizliyse true' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'git_branch', description: 'Git branch yönetimi: listele (varsayılan), oluştur, geç (switch), birleştir (merge), sil. Kullanıcı branch istediğinde çağır.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'create', 'switch', 'merge', 'delete'], description: 'İşlem (varsayılan list)' }, name: { type: 'string', description: 'Branch adı (create/switch/delete için gerekli)' }, target: { type: 'string', description: 'merge için: birleştirilecek branch (varsayılan geçerli branch)' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'git_revert', description: 'Son commit\'i veya belirtilen commit\'i geri alır (yeni bir commit oluşturur). KULLANICIDAN ONAY İSTER.', parameters: { type: 'object', properties: { commit: { type: 'string', description: 'Geri alınacak commit hash veya "HEAD" (varsayılan HEAD — son commit)' } }, required: [] } } },
  { type: 'function', function: { name: 'scaffold_project', description: 'Bağlı klasöre hazır proje iskeleti kurar (React/Vite+TS, Python, Node CLI). HIZLI şablon — varsayılan olarak npm install YAPMAZ (anında biter); install:true verilirse kurar. Kullanıcı "proje kur" derse bunu çağır.', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['react', 'python', 'node-cli', 'empty'], description: 'Proje tipi (varsayılan react)' }, name: { type: 'string', description: 'Proje adı (package.json/klasör adı)' }, install: { type: 'boolean', description: 'true ise bağımlılıkları kur (npm install), varsayılan false' } }, required: [] } } },
  { type: 'function', function: { name: 'create_ci_workflow', description: 'Bağlı klasöre GitHub Actions CI workflow dosyası oluşturur (.github/workflows/ci.yml) — push\'ta otomatik build + test çalıştırır.', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['node', 'python', 'auto'], description: 'CI tipi (varsayılan auto)' } }, required: [] } } },
  { type: 'function', function: { name: 'github_issues', description: 'Bağlı reponun GitHub issue\'larını listeler veya yeni issue açar. KULLANICIDAN ONAY İSTER (issue açarken).', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'open'], description: 'İşlem (varsayılan list)' }, title: { type: 'string', description: 'Açılacak issue başlığı (open için)' }, body: { type: 'string', description: 'Issue açıklaması' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'generate_docs', description: 'Bağlı proje için README.md ve/veya CHANGELOG.md üretir (mevcut dosyalara dayanarak).', parameters: { type: 'object', properties: { which: { type: 'string', enum: ['readme', 'changelog', 'both'], description: 'Hangisi üretilsin (varsayılan both)' } }, required: [] } } },
  { type: 'function', function: { name: 'auto_sync', description: 'OTOMATİK SENKRONİZASYON: bağlı klasördeki değişiklikleri GitHub repoya gönderir. Adımlar: 1) değişiklikleri göster, 2) testleri çalıştır (workspace_test), 3) commit et, 4) push et. KULLANICIDAN TOPLU ONAY İSTER. Kullanıcı "her şeyi senkronize et", "değişiklikleri commit edip push et", "güncelle" derse bunu çağır.', parameters: { type: 'object', properties: { message: { type: 'string', description: 'Commit mesajı (boşsa otomatik oluşturulur)' } }, required: [] } } },
  { type: 'function', function: { name: 'review_code', description: 'Bağlı klasördeki değişiklikleri inceler (diff okur), hata/bug/iyileştirme önerileri üretir. Commit etmeden önce kod kalitesini kontrol etmek için kullan.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'feature_workflow', description: 'MULTI-BRANCH İŞ AKIŞI: yeni özellik için feature branch oluşturur, değişiklikleri commit eder, test eder, sonra main branch\'e merge edip push eder (PR benzeri). Kullanıcı "yeni özellik üzerinde çalışalım", "branch aç ve bitince main\'e al" derse çağır. KULLANICIDAN ONAY İSTER.', parameters: { type: 'object', properties: { feature: { type: 'string', description: 'Özellik adı (branch adı olur)' }, message: { type: 'string', description: 'Commit mesajı (boşsa otomatik)' } }, required: ['feature'] } } },
];
// ---------- Kullanıcı onayı (git push / repo oluşturma gibi dışa yazma işlemleri) ----------
// Model dışa-yazma aracı çağırdığında renderer'a onay isteği gider; kullanıcı evet/hayır der.
// Cevap onay:respond IPC'siyle gelir; 60sn içinde cevap gelmezse iptal sayılır.
let _approvalId = 0;
const _approvalWaiters = new Map();
function requestUserApproval(payload) {
  return new Promise((resolve) => {
    const id = '_a' + (++_approvalId) + '_' + Date.now();
    const timer = setTimeout(() => { _approvalWaiters.delete(id); resolve({ approved: false, reason: 'timeout' }); }, 60000);
    _approvalWaiters.set(id, { resolve, timer });
    try {
      // Ana pencereyi öne getir (gizliyse kullanıcı onayı göremez)
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        try { mainWindow.webContents.send('approval:request', { id, ...payload }); } catch { /* yok */ }
      }
      // Fallback: tüm pencerelere gönder
      for (const w of BrowserWindow.getAllWindows()) {
        if (w !== mainWindow) try { w.webContents.send('approval:request', { id, ...payload }); } catch { /* yok */ }
      }
      // Sistem bildirimi: kullanıcı arka plandaysa görsün
      try { new Notification(T('Harley — Onay gerekiyor'), { body: payload.title + ': ' + (payload.message || '').split('\n')[0].slice(0, 80) }).show(); } catch { /* yok */ }
    } catch {
      clearTimeout(timer);
      _approvalWaiters.delete(id);
      resolve({ approved: false, reason: 'no-window' });
    }
  });
}
function respondApproval(id, approved) {
  const w = _approvalWaiters.get(id);
  if (!w) return false;
  clearTimeout(w.timer);
  _approvalWaiters.delete(id);
  w.resolve({ approved: !!approved, reason: 'user' });
  return true;
}

const TOOL_HANDLERS = {
  get_time: async () => { const n = new Date(); return 'Şu an: ' + n.toLocaleString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); },
  get_emails: async () => { try { const m = await google.epostaFetch(); return m.raw && m.raw.length ? m.raw.map((e) => `- "${e.konu}" — ${e.kimden}`).join('\n') : m.text; } catch (e) { return 'Hata: ' + e.message; } },
  get_calendar: async () => {
    try {
      if (!google.isConfigured()) return 'Google bağlantısı kurulmadı.';
      const token = await google.ensureToken();
      const s = new Date(); s.setHours(0, 0, 0, 0); const e = new Date(s.getTime() + 86400000);
      const j = await google.get(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(s.toISOString())}&timeMax=${encodeURIComponent(e.toISOString())}&singleEvents=true&orderBy=startTime&maxResults=10`, token);
      return (j.items || []).length ? (j.items || []).map((x) => `- ${x.summary} (${x.start && (x.start.dateTime || x.start.date)})`).join('\n') : 'Bugün etkinlik yok.';
    } catch (e) { return 'Hata: ' + e.message; }
  },
  get_tasks: async () => {
    try {
      if (!google.isConfigured()) return 'Google bağlantısı kurulmadı.';
      const token = await google.ensureToken();
      const j = await google.get('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?maxResults=20&showCompleted=false', token);
      return (j.items || []).length ? (j.items || []).map((x) => `- ${x.title}`).join('\n') : 'Açık görev yok.';
    } catch (e) { return 'Hata: ' + e.message; }
  },
  get_summary: async () => { try { const s = await google.runOzet(); return s.text || 'Özet alınamadı.'; } catch (e) { return 'Hata: ' + e.message; } },
  add_calendar_event: async (a) => { try { const r = await google.addCalendarEvent(a); return 'Eklendi: ' + (r.id || 'OK'); } catch (e) { return 'Hata: ' + e.message; } },
  add_task: async (a) => { try { await google.addTask(a); return 'Eklendi: ' + (a.title || ''); } catch (e) { return 'Hata: ' + e.message; } },
  complete_task: async (a) => { const r = await google.completeTask(a); return r.notFound ? 'Görev bulunamadı.' : ('Tamamlandı: ' + (r.title || a.title)); },
  web_search: async (a) => {
    const q = String((a && (a.query || a.q)) || '').trim();
    if (!q) return 'Arama sorgusu boş.';
    try {
      const items = await google.webSearch(q, 6);
      if (!items || !items.length) return 'Sonuç bulunamadı.';
      return items.map((r) => '- ' + r.title + (r.snippet ? '\n  ' + r.snippet : '') + '\n  ' + r.url).join('\n\n');
    } catch (e) { return 'Arama hatası: ' + (e && e.message ? e.message : e); }
  },
  drive_summarize: async (a) => {
    const name = String((a && a.name) || '').trim();
    try {
      return await google.driveSummarize(name);
    } catch (e) { return 'Drive okuma hatası: ' + (e && e.message ? e.message : e); }
  },
  start_game: (a, sessionId) => fun.startGame(sessionId, (a && a.game) || ''),
  game_move: (a, sessionId) => fun.gameMove(sessionId, (a && a.move) || ''),
  daily_motivation: () => fun.dailyMotivation(),
  fun_fact: () => fun.funFact(),
  song_of_day: () => fun.songOfDay(),
  hava_durumu: async (a) => {
    const st = loadSettings();
    const city = String((a && a.sehir) || st.city || '').trim() || 'Istanbul';
    const w = await getWeather(city);
    if (!w || w.sicaklik == null) return 'Hava durumu alınamadı (şehir bulunamadı veya internet yok).';
    return w.sehir + ': ' + w.durum + ', şu an ' + w.sicaklik + '°C (en yüksek ' + w.max + '°, en düşük ' + w.min + '°), rüzgar ' + w.ruzgar + ' km/s, yağış olasılığı %' + w.yagis + '.';
  },
  spotify_play: async (a) => {
    if (!spotifyWeb.isConfigured()) return 'Spotify bağlı değil — sol menüdeki "Bağlantılar" panelinden Client ID girip "Bağlan" de.';
    const q = String((a && a.sarki) || '').trim();
    if (!q) return 'Hangi şarkıyı çalayım?';
    let r;
    try { r = await spotifyWeb.playQuery(q); } catch (e) { return 'Spotify hatası: ' + (e && e.message ? e.message : e); }
    if (r.error === 'no_result') return 'Spotify\'da "' + q + '" bulunamadı.';
    if (r.error === 'not_authorized') return 'Spotify oturumu yok — Bağlantılar panelinden tekrar "Bağlan" de.';
    if (r.error === 'no_active_device') return 'Çalacak açık bir Spotify cihazı yok — Spotify masaüstü uygulamasını aç ve tekrar dene.';
    if (/premium/i.test(String(r.error || ''))) return 'Spotify şarkı başlatmak için Premium hesap gerekiyor (Spotify kısıtı).';
    if (!r.ok) return 'Çalınamadı: ' + (r.error || 'bilinmeyen hata');
    spotify.clearCache();
    for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send('spotify:refresh'); } catch { /* yok */ } }
    return 'Şimdi çalıyor: ' + r.track.name + ' — ' + r.track.artist;
  },
  workspace_list: async (a, sessionId) => {
    const r = workspace.safeList(sessionId, a && a.path);
    return r.ok ? (r.items.length ? r.items.map((x) => (x.isDir ? '[K] ' : '    ') + x.name).join('\n') : '(boş)') : r.error;
  },
  workspace_read: async (a, sessionId) => {
    const r = workspace.safeRead(sessionId, a && a.path);
    return r.ok ? (r.note || r.content || '(boş dosya)') : r.error;
  },
  workspace_write: async (a, sessionId) => {
    const r = workspace.safeWrite(sessionId, a && a.path, String(a && a.content != null ? a.content : ''));
    return r.ok ? ('Yazıldı: ' + r.relative) : r.error;
  },
  workspace_append: async (a, sessionId) => {
    const r = workspace.safeWrite(sessionId, a && a.path, String(a && a.content != null ? a.content : ''), true);
    return r.ok ? ('Eklendi: ' + r.relative) : r.error;
  },
  workspace_mkdir: async (a, sessionId) => {
    const r = workspace.resolve(sessionId, a && a.path);
    if (r.err) return r.err;
    try {
      fs.mkdirSync(r.target, { recursive: true });
      return 'Klasör oluşturuldu: ' + a.path;
    } catch (e) { return 'Hata: ' + e.message; }
  },
  workspace_delete: async (a, sessionId) => {
    const r = workspace.resolve(sessionId, a && a.path);
    if (r.err) return r.err;
    try {
      if (!fs.existsSync(r.target)) return 'Dosya yok: ' + a.path;
      const st = fs.statSync(r.target);
      if (st.isDirectory()) fs.rmSync(r.target, { recursive: true, force: true });
      else fs.unlinkSync(r.target);
      return 'Silindi: ' + a.path;
    } catch (e) { return 'Hata: ' + e.message; }
  },
  workspace_move: async (a, sessionId) => {
    const r1 = workspace.resolve(sessionId, a && a.from);
    const r2 = workspace.resolve(sessionId, a && a.to);
    if (r1.err) return r1.err;
    if (r2.err) return r2.err;
    try {
      if (!fs.existsSync(r1.target)) return 'Dosya yok: ' + a.from;
      fs.mkdirSync(path.dirname(r2.target), { recursive: true });
      fs.renameSync(r1.target, r2.target);
      return 'Taşındı: ' + a.from + ' → ' + a.to;
    } catch (e) { return 'Hata: ' + e.message; }
  },
  workspace_run: async (a, sessionId) => {
    const w = workspace.get(sessionId);
    if (!w) return 'Bu sohbete çalışma klasörü bağlı değil.';
    const cmd = String((a && a.command) || '').trim();
    if (!cmd) return 'Komut boş.';
    // Güvenlik: git/gh/curl/wget komutlarını workspace_run ile çalıştırma.
    const lower = cmd.toLowerCase();
    diag('workspace_run engel kontrolü: ' + cmd.slice(0, 80));
    if (/^(git|gh|curl|wget)\b/i.test(lower) || /^\s*(git|gh|curl|wget)\s/i.test(lower) || /^gh\b/.test(lower)) {
      if (/git\s+(push|pull|commit|init|remote|clone|add)/.test(lower) || /^gh\b/.test(lower) || /curl|wget/.test(lower)) {
        diag('workspace_run engellendi: ' + cmd.slice(0, 80));
        return 'Git/GitHub komutlarını (git, gh, curl, wget) workspace_run ile çalıştırma. Şu araçları kullan: git_status, git_diff, git_log (okuma), git_commit, git_push, git_pull, git_create_repo (yazma). Token global dosyadan otomatik kullanılır — token test etme, her projeye ayrı token gerekmez.';
      }
    }
    const timeout = Math.max(2000, Math.min(60000, parseInt(a && a.timeout, 10) || 25000));
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const cp = spawn(isWin ? 'cmd.exe' : '/bin/sh', isWin ? ['/c', cmd] : ['-c', cmd], {
        cwd: w.path, windowsHide: true, shell: false,
      });
      let out = '', err = '', timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { cp.kill(); } catch { /* yok */ }
      }, timeout);
      cp.stdout && cp.stdout.on('data', (d) => { out += String(d); if (out.length > 4000) out = out.slice(-4000); });
      cp.stderr && cp.stderr.on('data', (d) => { err += String(d); if (err.length > 4000) err = err.slice(-4000); });
      cp.on('error', (e) => { clearTimeout(timer); resolve('Çalıştırma hatası: ' + e.message); });
      cp.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          // Sunucu gibi bitmeyen komutlar: arka plana geçir ve log kaydını açıkla
          const r = workspace.runBackground(sessionId, cmd);
          return resolve('Komut ' + Math.round(timeout / 1000) + ' sn içinde bitmedi — arka planda çalışmaya devam ediyor (PID ' + (r.ok ? r.pid : '?') + ').\nŞu ana kadarki çıktı:\n' + (out || err || '(çıktı yok)') + '\nDev sunucuysa workspace.bgStatus ve workspace_http ile test et.');
        }
        const o = (out || '').trim(), e = (err || '').trim();
        let s = 'Çıkış kodu: ' + code;
        if (o) s += '\n--- ÇIKTI ---\n' + o;
        if (e) s += '\n--- HATA ---\n' + e;
        if (!o && !e) s += ' (çıktı yok)';
        resolve(s);
      });
    });
  },
  task_plan: async (a, sessionId) => {
    const desc = String((a && a.description) || 'Görev').trim();
    const steps = Array.isArray(a && a.steps) ? a.steps.map((s) => String(s).trim()).filter(Boolean) : [];
    if (!steps.length) return 'Plan için en az bir adım gir.';
    // Kısa ve öz adımlar — maks 6 adım, her biri 6-8 kelimeyi geçmesin
    const short = steps.slice(0, 6).map((s) => s.length > 80 ? s.slice(0, 77) + '...' : s);
    const task = { id: Date.now().toString(36), description: desc, steps: short.map((s, i) => ({ id: i, text: s, done: false, startedAt: null, completedAt: null })), createdAt: new Date().toISOString(), completedAt: null };
    const t = taskPlanner.readTasks();
    t.active = task;
    taskPlanner.writeTasks(t);
    try { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send('task:update', task); } catch { /* yok */ } } } catch { /* yok */ }
    return 'Plan oluşturuldu (' + task.steps.length + ' adım):\n' + task.steps.map((s, i) => (i + 1) + '. ' + s.text).join('\n');
  },
  task_mark_done: async (a, sessionId) => {
    const step = parseInt(a && a.step, 10);
    if (isNaN(step)) return 'Adım numarası gir.';
    try {
      const active = taskPlanner.getActiveTask();
      if (!active) return 'Aktif plan yok.';
      const st = active.steps[step];
      if (!st) return 'Adım bulunamadı: ' + step;
      st.done = true; st.completedAt = new Date().toISOString();
      const allDone = active.steps.every((s) => s.done);
      if (allDone) { active.completedAt = new Date().toISOString(); }
      const t = taskPlanner.readTasks();
      t.active = active;
      taskPlanner.writeTasks(t);
      try { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send('task:update', active); } catch { /* yok */ } } } catch { /* yok */ }
      return 'Adım ' + (step + 1) + ' tamamlandı ✓' + (allDone ? ' — Tüm adımlar bitti!' : '');
    } catch (e) { return 'Hata: ' + e.message; }
  },
  workspace_run_bg: async (a, sessionId) => {
    const cmd = String((a && a.command) || '').trim();
    if (!cmd) return 'Komut boş.';
    const r = workspace.runBackground(sessionId, cmd);
    if (!r.ok) return r.error;
    return 'Arka planda başlatıldı (PID ' + r.pid + '): ' + cmd + '\nÇıktı log: ' + r.logFile + '\nworkspace.bgStatus ile durumu kontrol edebilirsin.';
  },
  workspace_bg_status: async (a, sessionId) => {
    const r = workspace.bgStatus(a && a.pid);
    if (!r.ok) return r.error;
    return 'Çalışıyor: ' + (r.alive ? 'EVET' : 'HAYIR') + (r.tail ? '\n--- SON ÇIKTI ---\n' + r.tail : '');
  },
  workspace_http: async (a, sessionId) => {
    const url = String((a && a.url) || '').trim();
    if (!/^https?:\/\//i.test(url)) return 'Geçerli bir URL gir (http://...).';
    return new Promise((resolve) => {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? require('https') : require('http');
      const req = mod.get(url, { timeout: 15000 }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; if (body.length > 2000) body = body.slice(0, 2000); });
        res.on('end', () => resolve('HTTP ' + res.statusCode + '\n' + (body || '').slice(0, 1500)));
      });
      req.on('timeout', () => { try { req.destroy(); } catch { /* yok */ } resolve('Zaman aşımı — sunucu yanıt vermedi (port kapalı veya henüz açılmadı).'); });
      req.on('error', (e) => resolve('İstek hatası: ' + e.message));
    });
  },
  workspace_test: async (a, sessionId) => {
    const r = await workspace.runTest(sessionId, a && a.command);
    if (!r.ok) {
      const why = r.timedOut ? ' (25 sn zaman aşımı — test uzun sürebilir)' : (r.error ? ': ' + r.error : '');
      return 'Test başarısız' + why + '\n' + (r.output || '');
    }
    return 'Tüm testler başarılı ✓\n' + (r.output || '');
  },
  workspace_search: async (a, sessionId) => {
    const q = String((a && a.query) || '').trim();
    if (!q) return 'Arama sorgusu boş.';
    const r = await workspace.searchCode(sessionId, q, a && a.limit);
    if (!r.ok) return r.error;
    if (!r.items.length) return 'Eşleşen sonuç bulunamadı: "' + q + '".';
    return r.items.map((x) => 'Dosya: ' + x.file + ' (satır ' + x.line + ')\n```\n' + x.snippet + '\n```').join('\n\n') + '\n\n(' + r.total + ' eşleşme, ' + r.items.length + ' gösteriliyor)';
  },
  git_status: async (_a, sessionId) => {
    const r = await workspace.gitRun(sessionId, ['status', '--short', '--branch']);
    return r.ok ? r.output : r.error;
  },
  git_diff: async (a, sessionId) => {
    const args = ['diff', '--stat'];
    const file = String((a && a.file) || '').trim();
    if (file) args.push('--', file);
    const r = await workspace.gitRun(sessionId, args, 15000);
    if (!r.ok) return r.error;
    if (!r.output || r.output === '(çıktı yok)') return 'Değişiklik yok.';
    return r.output;
  },
  git_commit: async (a, sessionId) => {
    const msg = String((a && a.message) || '').trim();
    if (!msg) return 'Commit mesajı boş — message parametresini ver.';
    workspace.ensureHarleyGitignore(sessionId);
    const preview = await workspace.gitApprovalPreview(sessionId);
    if (!preview.ok) return 'Bu sohbete çalışma klasörü bağlı değil — git_commit için önce klasör bağla.';
    const approval = await requestUserApproval({
      type: 'git_commit',
      title: 'GitHub commit',
      message: T('Şu değişiklikler commit edilecek:\n{p}\n\nMesaj: {m}', { p: preview.text, m: msg }),
    });
    if (!approval.approved) return 'Kullanıcı onaylamadı — commit yapılmadı.';
    await workspace.gitRun(sessionId, ['add', '-A']);
    const r = await workspace.gitRun(sessionId, ['commit', '-m', msg]);
    return r.ok ? 'Commit tamam: ' + msg : r.error;
  },
  git_log: async (a, sessionId) => {
    const count = Math.max(1, Math.min(20, parseInt(a && a.count, 10) || 10));
    const r = await workspace.gitRun(sessionId, ['log', '--oneline', '-n', String(count)]);
    return r.ok ? (r.output || 'Henüz commit yok.') : r.error;
  },
  git_push: async (_a, sessionId) => {
    if (!github.getToken()) return 'GitHub token yok (github-token.txt).';
    const preview = await workspace.gitApprovalPreview(sessionId);
    if (!preview.ok) return 'Bu sohbete çalışma klasörü bağlı değil — git_push için önce klasör bağla.';
    const hasRemote = await workspace.gitHasRemote(sessionId);
    if (!hasRemote) return 'Bu klasörün GitHub remote\'u yok. Önce git_create_repo ile oluştur.';
    const approval = await requestUserApproval({
      type: 'git_push',
      title: 'GitHub push',
      message: T('Şu değişiklikler GitHub\'a gönderilecek:\n{p}', { p: preview.text.includes('değişiklik') ? preview.text : T('(çalışma alanı temiz — yalnızca commit\'ler push edilecek)') }),
    });
    if (!approval.approved) return 'Kullanıcı onaylamadı — push yapılmadı.';
    const branch = await workspace.gitRun(sessionId, ['branch', '--show-current'], 10000);
    const br = (branch.output || 'main').trim() || 'main';
    const token = github.getToken();
    const r = await workspace.gitPushWithToken(sessionId, br, token);
    return r.ok ? 'Push tamam — GitHub\'a gönderildi (' + br + ').' : r.error;
  },
  git_pull: async (_a, sessionId) => {
    if (!github.getToken()) return 'GitHub token yok.';
    const r = await workspace.gitRun(sessionId, ['pull', '--ff-only'], 60000);
    return r.ok ? 'Pull tamam — güncel.' : r.error;
  },
  git_create_repo: async (a, sessionId) => {
    diag('git_create_repo çağrıldı: ' + JSON.stringify(a || {}).slice(0, 120));
    const hasTok = !!github.getToken();
    diag('git_create_repo: token var mı = ' + hasTok);
    if (!hasTok) return 'GitHub token yok (github-token.txt).';
    const name = String((a && a.name) || '').trim();
    if (!name) return 'Repo adı ver.';
    const desc = String((a && a.description) || '').trim();
    const isPrivate = !!(a && a.private);
    const approval = await requestUserApproval({
      type: 'git_create_repo',
      title: T('GitHub repo oluştur'),
      message: T('GitHub\'da yeni bir repo oluşturulacak:\nAd: {n}{d}\nGizli: {g}\n\nBu klasör bu repoya bağlanacak ve içeriği push edilecek.', {
        n: name,
        d: desc ? T('\nAçıklama: {x}', { x: desc }) : '',
        g: i18n.getLang() === 'en' ? (isPrivate ? 'yes' : 'no') : (isPrivate ? 'evet' : 'hayır'),
      }),
    });
    diag('git_create_repo: onay = ' + JSON.stringify(approval));
    if (!approval.approved) return 'Kullanıcı onaylamadı — repo oluşturulmadı.';
    const user = await github.getUser();
    diag('git_create_repo: getUser = ' + JSON.stringify(user).slice(0, 80));
    if (user.error) return 'GitHub kullanıcısı alınamadı: ' + (user.message || 'token geçersiz olabilir');
    const created = await github.createRepo({ name, description: desc, private: isPrivate });
    diag('git_create_repo: createRepo = ' + JSON.stringify(created).slice(0, 100));
    if (created.error) {
      // 422: repo adı zaten kullanımda (GitHub "Repository creation failed" döner)
      if (created.status === 422) {
        return 'Repo oluşturulamadı: "' + name + '" adında bir repo zaten var (GitHub 422). Farklı bir ad seç (örn. ' + name + '-v2) veya mevcut repoya bağlanmak istersen git_push kullan.';
      }
      return 'Repo oluşturulamadı: ' + (created.message || 'hata');
    }
    // Remote'u ekle (önce varsa eski origin'i kaldır)
    const oldRemote = await workspace.gitRun(sessionId, ['remote', 'get-url', 'origin'], 5000);
    if (oldRemote.ok && oldRemote.output) {
      const rm = await workspace.gitRun(sessionId, ['remote', 'remove', 'origin'], 10000);
      if (rm.error) return 'Eski remote kaldırılamadı: ' + rm.error;
    }
    const addUrl = await workspace.gitRun(sessionId, ['remote', 'add', 'origin', created.clone_url], 10000);
    if (addUrl.error) return 'Remote eklenemedi: ' + addUrl.error;
    // İlk commit yoksa oluştur
    workspace.ensureHarleyGitignore(sessionId);
    const hasLog = await workspace.gitRun(sessionId, ['log', '-1'], 10000);
    if (!hasLog.ok) {
      await workspace.gitRun(sessionId, ['add', '-A'], 10000);
      const ci = await workspace.gitRun(sessionId, ['commit', '-m', 'Initial commit'], 10000);
      if (ci.error) return 'İlk commit oluşturulamadı: ' + ci.error;
    }
    const branch = await workspace.gitRun(sessionId, ['branch', '--show-current'], 10000);
    const br = (branch.output || 'main').trim() || 'main';
    const token = github.getToken();
    const push = await workspace.gitPushWithToken(sessionId, br, token);
    if (!push.ok) return 'Repo oluştu ama push başarısız: ' + push.error;
    workspace.linkRepo(sessionId, created.name, created.clone_url, isPrivate, user.login);
    log('info', 'github', 'repo oluşturuldu', { name: created.name, url: created.html_url, sessionId });
    return 'Repo oluşturuldu ve push edildi: ' + created.html_url;
  },
  git_link_repo: async (a, sessionId) => {
    diag('git_link_repo çağrıldı: ' + JSON.stringify(a || {}).slice(0, 100));
    if (!github.getToken()) return 'GitHub token yok (github-token.txt).';
    const sum = await workspace.gitChangeSummary(sessionId);
    if (!sum.ok) return 'Bu sohbete çalışma klasörü bağlı değil — git_link_repo için önce klasör bağla.';
    const me = ((await github.getUser()) || {}).login || '';
    const name = String((a && a.name) || '').trim().replace(me ? new RegExp('^' + me + '/', 'i') : /^[^/]+\//, '');
    if (!name) return 'Repo adı ver (örn. harley-test-v2).';
    const isPrivate = !!(a && a.private);
    const fullName = (me ? me + '/' : '') + name;
    const approval = await requestUserApproval({
      type: 'git_link_repo',
      title: T('GitHub repo bağla'),
      message: T('Bu klasör GitHub\'daki mevcut repoya bağlanacak:\nRepo: {r}{p}\n\nLocal dosyalar bu repoya push edilecek.', { r: fullName, p: isPrivate ? T(' (gizli)') : '' }),
    });
    if (!approval.approved) return 'Kullanıcı onaylamadı — bağlanılmadı.';
    // Repo var mı kontrol et + clone_url al
    const repoInfo = await github.api('/repos/' + fullName);
    if (repoInfo.error) return 'Repo bulunamadı (' + fullName + '): ' + (repoInfo.message || 'hata') + ' — git_create_repo ile yenisini oluşturabilirsin.';
    // Remote ekle (eski origin varsa kaldır)
    const oldRemote = await workspace.gitRun(sessionId, ['remote', 'get-url', 'origin'], 5000);
    if (oldRemote.ok && oldRemote.output) {
      await workspace.gitRun(sessionId, ['remote', 'remove', 'origin'], 10000);
    }
    const addUrl = await workspace.gitRun(sessionId, ['remote', 'add', 'origin', repoInfo.clone_url], 10000);
    if (addUrl.error) return 'Remote eklenemedi: ' + addUrl.error;
    // İlk commit yoksa oluştur
    workspace.ensureHarleyGitignore(sessionId);
    const hasLog = await workspace.gitRun(sessionId, ['log', '-1'], 10000);
    if (!hasLog.ok) {
      await workspace.gitRun(sessionId, ['add', '-A'], 10000);
      const ci = await workspace.gitRun(sessionId, ['commit', '-m', 'Initial commit'], 10000);
      if (ci.error) return 'İlk commit oluşturulamadı: ' + ci.error;
    }
    const branch = await workspace.gitRun(sessionId, ['branch', '--show-current'], 10000);
    const br = (branch.output || 'main').trim() || 'main';
    const token = github.getToken();
    const push = await workspace.gitPushWithToken(sessionId, br, token);
    if (!push.ok) return 'Bağlandı ama push başarısız: ' + push.error;
    workspace.linkRepo(sessionId, repoInfo.name, repoInfo.clone_url, repoInfo.private, repoInfo.owner && repoInfo.owner.login);
    log('info', 'github', 'repoya bağlandı', { name: repoInfo.name, url: repoInfo.html_url, sessionId });
    return 'Bağlandı ve push edildi: ' + repoInfo.html_url;
  },
  git_branch: async (a, sessionId) => {
    const sum = await workspace.gitChangeSummary(sessionId);
    if (!sum.ok) return 'Bu sohbete çalışma klasörü bağlı değil — önce klasör bağla.';
    const action = String((a && a.action) || 'list');
    const name = String((a && a.name) || '').trim();
    if (action === 'list') {
      const r = await workspace.gitRun(sessionId, ['branch', '-a']);
      return r.ok ? (r.output || 'Branch yok.') : r.error;
    }
    if (action === 'create') {
      if (!name) return 'Branch adı ver.';
      const r = await workspace.gitRun(sessionId, ['branch', name]);
      return r.ok ? 'Branch oluşturuldu: ' + name + ' (geçmek için git_branch switch kullan)' : r.error;
    }
    if (action === 'switch') {
      if (!name) return 'Geçilecek branch adı ver.';
      const r = await workspace.gitRun(sessionId, ['checkout', name]);
      return r.ok ? 'Şu an: ' + name + ' branch\'inde.' : r.error;
    }
    if (action === 'merge') {
      const target = String((a && a.target) || '').trim();
      if (!target) return 'Birleştirilecek branch adı ver (target).';
      const approval = await requestUserApproval({ type: 'git_merge', title: T('Git branch birleştir'), message: T('Branch "{t}" geçerli branch ile birleştirilecek.', { t: target }) });
      if (!approval.approved) return 'Kullanıcı onaylamadı — merge yapılmadı.';
      const r = await workspace.gitRun(sessionId, ['merge', target]);
      return r.ok ? 'Birleştirildi: ' + target + ' → geçerli branch.' : r.error;
    }
    if (action === 'delete') {
      if (!name) return 'Silinecek branch adı ver.';
      const approval = await requestUserApproval({ type: 'git_delete_branch', title: T('Git branch sil'), message: T('Branch "{n}" silinecek.', { n: name }) });
      if (!approval.approved) return 'Kullanıcı onaylamadı — silinmedi.';
      const r = await workspace.gitRun(sessionId, ['branch', '-d', name]);
      return r.ok ? 'Branch silindi: ' + name : r.error;
    }
    return 'Bilinmeyen işlem: ' + action + ' (list/create/switch/merge/delete)';
  },
  git_revert: async (a, sessionId) => {
    const sum = await workspace.gitChangeSummary(sessionId);
    if (!sum.ok) return 'Bu sohbete çalışma klasörü bağlı değil — önce klasör bağla.';
    const commit = String((a && a.commit) || 'HEAD').trim();
    const approval = await requestUserApproval({ type: 'git_revert', title: T('Git commit geri al'), message: T('Commit "{c}" geri alınacak (yeni bir commit oluşur).', { c: commit }) });
    if (!approval.approved) return 'Kullanıcı onaylamadı — geri alınmadı.';
    const r = await workspace.gitRun(sessionId, ['revert', '--no-edit', commit]);
    return r.ok ? 'Geri alındı: ' + commit : r.error;
  },
  scaffold_project: async (a, sessionId) => {
    const w = workspace.get(sessionId);
    if (!w) return 'Bu sohbete çalışma klasörü bağlı değil — önce klasör bağla.';
    const type = String((a && a.type) || 'react');
    const name = String((a && a.name) || '').trim() || path.basename(w.path);
    if (type === 'react') {
      // Vite + React + TypeScript + eslint iskeleti
      const files = {
        'package.json': JSON.stringify({
          name: name.toLowerCase().replace(/\s+/g, '-'), private: true, version: '0.1.0', type: 'module',
          scripts: { dev: 'vite', build: 'tsc && vite build', preview: 'vite preview', lint: 'eslint .' },
          dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
          devDependencies: { '@types/react': '^18.3.3', '@types/react-dom': '^18.3.0', '@vitejs/plugin-react': '^4.3.1', typescript: '^5.5.3', vite: '^5.4.0', eslint: '^9.8.0' },
        }, null, 2),
        'index.html': '<!doctype html>\n<html lang="tr">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>' + name + '</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n',
        'vite.config.ts': "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({ plugins: [react()] })\n",
        'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2020', useDefineForClassFields: true, lib: ['ES2020', 'DOM', 'DOM.Iterable'], module: 'ESNext', skipLibCheck: true, moduleResolution: 'bundler', allowImportingTsExtensions: true, resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: 'react-jsx', strict: true, noUnusedLocals: true, noUnusedParameters: true, noFallthroughCasesInSwitch: true }, include: ['src'] }, null, 2),
        '.eslintrc.cjs': "module.exports = { root: true, env: { browser: true, es2020: true }, extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'], parser: '@typescript-eslint/parser', plugins: ['@typescript-eslint'], ignorePatterns: ['dist', '.eslintrc.cjs'], rules: {} }\n",
        'src/main.tsx': "import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport App from './App'\nimport './index.css'\n\nReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)\n",
        'src/App.tsx': "function App() {\n  return (\n    <div style={{ fontFamily: 'system-ui', padding: 40 }}>\n      <h1>Hello, " + name + '!</h1>\n      <p>Harley tarafından oluşturuldu.</p>\n    </div>\n  )\n}\n\nexport default App\n',
        'src/index.css': 'body { margin: 0; font-family: system-ui, sans-serif; background: #16100a; color: #f5ede4; }\n',
      };
      for (const [p, c] of Object.entries(files)) {
        workspace.safeWrite(sessionId, p, c);
      }
      // Hızlı şablon: npm install yapma (demo/kayıt için anında bitsin).
      // İsteğe bağlı: install: true verilirse bağımlılıkları kur.
      if (a && a.install === true) {
        const inst = await workspace.runTest(sessionId, 'npm install');
        return 'React + TypeScript + Vite projesi kuruldu: ' + name + '\nDosyalar: ' + Object.keys(files).join(', ') + '\n' + (inst.ok ? 'Bağımlılıklar kuruldu ✓' : 'npm install: ' + (inst.output || '').slice(0, 200));
      }
      return 'React + TypeScript + Vite projesi kuruldu: ' + name + '\nDosyalar: ' + Object.keys(files).join(', ') + '\n(Bağımlılıkları kurmak için "npm install" de.)';
    }
    if (type === 'python') {
      const files = {
        'main.py': 'def main():\n    print("Hello, ' + name + '!")\n\n\nif __name__ == "__main__":\n    main()\n',
        'requirements.txt': '# proje bağımlılıkları\n',
        'README.md': '# ' + name + '\n\nHarley tarafından oluşturuldu.\n',
      };
      for (const [p, c] of Object.entries(files)) workspace.safeWrite(sessionId, p, c);
      return 'Python projesi kuruldu: ' + name + '\nDosyalar: main.py, requirements.txt, README.md';
    }
    if (type === 'node-cli') {
      const files = {
        'package.json': JSON.stringify({ name: name.toLowerCase().replace(/\s+/g, '-'), version: '1.0.0', bin: { [name.toLowerCase().replace(/\s+/g, '-')]: 'index.js' }, scripts: { start: 'node index.js' } }, null, 2),
        'index.js': '#!/usr/bin/env node\nconsole.log("Hello from ' + name + '!")\n',
      };
      for (const [p, c] of Object.entries(files)) workspace.safeWrite(sessionId, p, c);
      return 'Node CLI projesi kuruldu: ' + name;
    }
    return 'Bilinmeyen şablon: ' + type + ' (react/python/node-cli/empty)';
  },
  create_ci_workflow: async (a, sessionId) => {
    const w = workspace.get(sessionId);
    if (!w) return 'Bu sohbete çalışma klasörü bağlı değil — önce klasör bağla.';
    const type = String((a && a.type) || 'auto');
    let yml;
    if (type === 'python') {
      yml = 'name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-python@v5\n        with:\n          python-version: "3.12"\n      - run: pip install pytest\n      - run: python -m pytest\n';
    } else {
      yml = 'name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: "20"\n          cache: "npm"\n      - run: npm ci\n      - run: npm run build\n      - run: npm test --if-present\n';
    }
    workspace.safeWrite(sessionId, '.github/workflows/ci.yml', yml);
    return 'CI workflow oluşturuldu: .github/workflows/ci.yml\n' + (type === 'python' ? 'Python (pytest)' : 'Node (npm build + test)') + '\nPush yapınca GitHub Actions otomatik çalışır.';
  },
  github_issues: async (a, sessionId) => {
    const token = github.getToken();
    if (!token) return 'GitHub token yok.';
    const repo = workspace.getRepo(sessionId);
    if (!repo) return 'Bu klasöre bağlı GitHub repo yok — önce git_link_repo/git_create_repo ile bağla.';
    const action = String((a && a.action) || 'list');
    const owner = repo.owner || ((await github.getUser()) || {}).login || '';
    const full = owner + '/' + repo.name;
    if (action === 'list') {
      const j = await github.api('/repos/' + full + '/issues?state=open&per_page=20');
      if (!Array.isArray(j)) return 'Issue alınamadı: ' + ((j && j.message) || 'hata');
      return j.filter((x) => !x.pull_request).map((x) => '#' + x.number + ' — ' + x.title).join('\n') || 'Açık issue yok.';
    }
    if (action === 'open') {
      const title = String((a && a.title) || '').trim();
      if (!title) return 'Issue başlığı ver.';
      const approval = await requestUserApproval({ type: 'github_issue_open', title: T('GitHub issue aç'), message: T('Yeni issue açılacak:\nBaşlık: {t}\nRepo: {r}', { t: title, r: full }) });
      if (!approval.approved) return 'Kullanıcı onaylamadı — issue açılmadı.';
      const j = await github.api('/repos/' + full + '/issues', { method: 'POST', body: { title, body: String((a && a.body) || '').trim() || '' } });
      if (j.error) return 'Issue açılamadı: ' + (j.message || 'hata');
      return 'Issue açıldı: #' + j.number + ' — ' + j.title;
    }
    return 'Bilinmeyen işlem: ' + action + ' (list/open)';
  },
  generate_docs: async (a, sessionId) => {
    const w = workspace.get(sessionId);
    if (!w) return 'Bu sohbete çalışma klasörü bağlı değil — önce klasör bağla.';
    const which = String((a && a.which) || 'both');
    const repo = workspace.getRepo(sessionId);
    const out = [];
    if (which === 'readme' || which === 'both') {
      const pkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(w.path, 'package.json'), 'utf8')); } catch { return null; } })();
      const name = (pkg && pkg.name) || w.name || path.basename(w.path);
      const readme = '# ' + name + '\n\n' + (repo ? 'Bu proje GitHub repo olarak senkronize ediliyor: `' + repo.name + '`\n' : '') + '\n## Geliştirme\n\n```bash\nnpm install   # bağımlılıkları kur\nnpm run dev   # geliştirme sunucusu\nnpm run build # üretim derlemesi\nnpm test      # testleri çalıştır\n```\n\nHarley tarafından oluşturuldu.\n';
      workspace.safeWrite(sessionId, 'README.md', readme);
      out.push('README.md ✓');
    }
    if (which === 'changelog' || which === 'both') {
      const log = await workspace.gitRun(sessionId, ['log', '--oneline', '-20'], 10000);
      const lines = (log.ok && log.output) ? log.output.split('\n').filter(Boolean).slice(0, 20) : [];
      const changelog = '# CHANGELOG\n\n## Son değişiklikler\n\n' + (lines.map((l) => '- ' + l).join('\n') || '(commit yok)') + '\n';
      workspace.safeWrite(sessionId, 'CHANGELOG.md', changelog);
      out.push('CHANGELOG.md ✓');
    }
    return out.length ? 'Oluşturuldu: ' + out.join(', ') : 'Hangi dokümanı üreteyim? (readme/changelog/both)';
  },
  auto_sync: async (a, sessionId) => {
    const token = github.getToken();
    if (!token) return 'GitHub token yok (github-token.txt).';
    const preview = await workspace.gitApprovalPreview(sessionId);
    if (!preview.ok) return 'Bu sohbete çalışma klasörü bağlı değil — önce klasör bağla.';
    const hasRemote = await workspace.gitHasRemote(sessionId);
    if (!hasRemote) return 'Bu klasörün GitHub remote\'u yok. Önce git_link_repo/git_create_repo ile bağla.';
    if (!preview.changes.length) {
      // Çalışma alanı temiz — push edilecek commit var mı kontrol et
      const status = await workspace.gitRun(sessionId, ['status', '-sb'], 10000);
      return status.ok ? 'Çalışma alanı temiz. ' + (status.output || '') : status.error;
    }
    const message = String((a && a.message) || '').trim() || ('auto-sync: ' + preview.changes.length + ' değişiklik');
    const approval = await requestUserApproval({
      type: 'auto_sync',
      title: T('Otomatik senkron'),
      message: T('Şu değişiklikler GitHub\'a gönderilecek:\n{p}\n\nMesaj: {m}', { p: preview.text, m: message }),
    });
    if (!approval.approved) return 'Kullanıcı onaylamadı — senkron iptal.';
    
    // 1) Test et (pre-push gate) — profesyonel test runner ile
    const gate = await testRunner.prePushGate(sessionId, { strict: true, timeout: 180000 });
    let log = [];
    log.push('Test (pre-push): ' + gate.message);
    if (!gate.allowPush) return 'Senkron durduruldu: ' + gate.message + '\nDetay:\n' + gate.result.stdout;
    
    // 2) Commit et
    workspace.ensureHarleyGitignore(sessionId);
    await workspace.gitRun(sessionId, ['add', '-A'], 15000);
    const commit = await workspace.gitRun(sessionId, ['commit', '-m', message], 15000);
    if (!commit.ok && !/nothing to commit/i.test(commit.error || '')) return 'Commit başarısız: ' + commit.error;
    log.push('Commit: ✓ ' + message);
    
    // 3) Push et (force-with-lease + remote check)
    const branch = await workspace.gitRun(sessionId, ['branch', '--show-current'], 10000);
    const br = (branch.output || 'main').trim() || 'main';
    const push = await workspace.gitPushWithToken(sessionId, br, token, { forceWithLease: true, checkRemote: true });
    if (!push.ok) return 'Commit tamam ama push başarısız: ' + push.error + (push.remoteStatus ? '\nRemote: ' + push.remoteStatus : '');
    log.push('Push: ✓ GitHub\'a gönderildi (' + br + ') (force-with-lease)');
    
    return 'Senkron tamam:\n' + log.join('\n');
  },
  review_code: async (_a, sessionId) => {
    const w = workspace.get(sessionId);
    if (!w) return 'Bu sohbete çalışma klasörü bağlı değil — önce klasör bağla.';
    // Değişen dosyaların diff'ini topla (son commit'ten bu yana + çalışma alanı)
    const stat = await workspace.gitRun(sessionId, ['diff', 'HEAD', '--stat'], 15000);
    const diff = await workspace.gitRun(sessionId, ['diff', 'HEAD', '--', '*.js', '*.ts', '*.tsx', '*.jsx', '*.py', '*.lua'], 20000);
    const files = [];
    if (stat.ok && stat.output && stat.output !== '(çıktı yok)') {
      files.push(stat.output.split('\n').filter(Boolean).slice(0, 20).join('\n'));
    }
    let body = '';
    if (diff.ok && diff.output && diff.output !== '(çıktı yok)') {
      // Çok uzunsa kırp — önce ilk ~12KB'ı göster
      body = diff.output.slice(0, 12000) + (diff.output.length > 12000 ? '\n...(devamı kırpıldı)' : '');
    }
    if (!files.length && !body) {
      const st = await workspace.gitChangeSummary(sessionId);
      return st.ok && !st.changes.length ? 'Çalışma alanı temiz — incelecek değişiklik yok.' : 'Diff alınamadı (henüz commit yok olabilir).';
    }
    return 'İnceleme sonuçları:\n' + (files.length ? files.join('\n') + '\n\n' : '') + (body || '(metin değişikliği yok — yalnızca dosya durumu değişmiş)');
  },
  feature_workflow: async (a, sessionId) => {
    const token = github.getToken();
    if (!token) return 'GitHub token yok (github-token.txt).';
    const preview = await workspace.gitApprovalPreview(sessionId);
    if (!preview.ok) return 'Bu sohbete çalışma klasörü bağlı değil — önce klasör bağla.';
    const hasRemote = await workspace.gitHasRemote(sessionId);
    if (!hasRemote) return 'Bu klasörün GitHub remote\'u yok. Önce git_link_repo/git_create_repo ile bağla.';
    const feature = String((a && a.feature) || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
    if (!feature) return 'Özellik adı ver (branch adı olur).';
    // Önce mevcut branch'i al
    const cur = await workspace.gitRun(sessionId, ['branch', '--show-current'], 10000);
    const currentBranch = (cur.output || 'main').trim() || 'main';
    // Feature branch oluştur + geç (yoksa)
    const hasBranch = await workspace.gitRun(sessionId, ['branch', '--list', feature], 10000);
    if (!(hasBranch.ok && hasBranch.output.includes(feature))) {
      const cb = await workspace.gitRun(sessionId, ['checkout', '-b', feature], 15000);
      if (!cb.ok) return 'Branch oluşturulamadı: ' + cb.error;
    } else {
      await workspace.gitRun(sessionId, ['checkout', feature], 15000);
    }
    // Commit et (değişiklik varsa)
    const message = String((a && a.message) || '').trim() || ('feat: ' + feature);
    workspace.ensureHarleyGitignore(sessionId);
    const changePreview = await workspace.gitApprovalPreview(sessionId);
    if (changePreview.changes.length) {
      await workspace.gitRun(sessionId, ['add', '-A'], 15000);
      const ci = await workspace.gitRun(sessionId, ['commit', '-m', message], 15000);
      if (!ci.ok && !/nothing to commit/i.test(ci.error || '')) return 'Commit başarısız: ' + ci.error;
    }
    // Kullanıcı onayı: main'e merge + push
    const approval = await requestUserApproval({
      type: 'feature_merge',
      title: T('Özellik branch birleştir'),
      message: T('Feature branch "{f}" main branch\'e merge edilip GitHub\'a push edilecek.\n\nHazırsan onayla.', { f: feature }),
    });
    if (!approval.approved) {
      // Onaylanmazsa feature branch'te kal (kullanıcı çalışmaya devam edebilir)
      return 'Onaylanmadı — şu an "' + feature + '" branch\'indesin. İşin bitince "main\'e al" de, merge + push edeyim.';
    }
    // main'e dön + merge
    await workspace.gitRun(sessionId, ['checkout', currentBranch], 15000);
    const merge = await workspace.gitRun(sessionId, ['merge', feature], 20000);
    if (!merge.ok && !/already up-to-date|already up to date/i.test(merge.error || '')) {
      // Çakışma olabilir
      return 'Merge başarısız: ' + merge.error + '\nÇakışmayı çözmen gerekebilir.';
    }
    // Pre-push test gate on feature branch before merging to main
    const gate = await testRunner.prePushGate(sessionId, { strict: true, timeout: 180000 });
    if (!gate.allowPush) return 'Merge sonrası testler başarısız — push engellendi: ' + gate.message;
    // Push (force-with-lease + remote check)
    const br = currentBranch;
    const push = await workspace.gitPushWithToken(sessionId, br, token, { forceWithLease: true, checkRemote: true });
    if (!push.ok) return 'Merge tamam ama push başarısız: ' + push.error + (push.remoteStatus ? '\nRemote: ' + push.remoteStatus : '');
    // Temizlik: feature branch'i sil (merge edildi)
    await workspace.gitRun(sessionId, ['branch', '-d', feature], 10000);
    return 'Özellik "' + feature + '" ' + br + ' branch\'ine merge edildi ve GitHub\'a push edildi (force-with-lease).';
  },
};

app.whenReady().then(() => {
    app.setAppUserModelId('com.harley.assistant');

  // This is the user's own assistant — allow microphone access without a prompt.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'mediaKeySystem');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    permission === 'media' || permission === 'mediaKeySystem');

  // Show the window right away (splash). Yardımcı servisler (Roblox Studio MCP)
  // artık otomatik BAŞLATILMAZ — kullanıcı isterse sol menüdeki "Studio" çipinden
  // bağlanır. Böylece açılışta istenmeyen konsol/pencere ve indirme olmaz.
  createWindow();
  setTimeout(() => runMorningRoutine().catch(() => {}), 20000);
  // Paketlenmiş sürümde açılıştan bir süre sonra sessizce yeni sürüm var mı diye bak.
  if (app.isPackaged) setTimeout(async () => {
    try { const u = await checkForUpdates(); if (u && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:available', u); } catch { /* yok */ }
  }, 10000);

  // ---------- Personalization: oturum başlangıcı kaydı ----------
  // Uygulama açıldığında saat + proje bağlamını öğrenme sistemine kaydet.
  const personalization = require('./personalization');
  personalization.recordActivity('session_start', {});

  // ---------- #7: Yeni e-posta bildirimi (her 5 dk'da kontrol) ----------
  // Google bağlıysa okunmamış e-postaları denetler; yeni geldiyse masaüstü bildirimi gösterir.
  // Ayarlarda "emailNotify: true" olmalı (varsayılan: kapalı — istenmeyen bildirim olmasın).
  let _lastEmailCount = -1;
  setInterval(async () => {
    try {
      const st = loadSettings();
      if (st.emailNotify !== true) { _lastEmailCount = -1; return; }
      if (!google.isConfigured()) return;
      const m = await google.epostaFetch();
      const count = (m.raw && m.raw.length) || 0;
      if (_lastEmailCount === -1) { _lastEmailCount = count; return; } // ilk ölçüm — baz al
      if (count > _lastEmailCount) {
        const fresh = count - _lastEmailCount;
        try { new Notification(T('Harley — Yeni e-posta'), { body: T('{n} yeni okunmamış e-posta var.', { n: fresh }) }).show(); } catch { /* yok */ }
      }
      _lastEmailCount = count;
    } catch { /* sessiz */ }
  }, 5 * 60000);

  // ---------- Otomatik yedekleme (ayar açıksa) ----------
  // Bağlı her klasörü periyodik olarak "backup" branch'ine auto-commit+push eder.
  // Kullanıcı onayı beklenmez (yalnızca backup dalına yazılır; main'e dokunmaz).
  // Ayar: settings.json → autoBackup: true
  const autoBackup = async () => {
    try {
      let st = {};
      try { st = loadSettings(); } catch { return; }
      if (st.autoBackup !== true) return;
      for (const [sid, w] of Object.entries((() => { try { return JSON.parse(fs.readFileSync(FILES.workspace, 'utf8')); } catch { return {}; } })())) {
        if (!github.getToken()) continue;
        const hasRemote = await workspace.gitHasRemote(sid);
        if (!hasRemote) continue;
        const preview = await workspace.gitApprovalPreview(sid);
        if (!preview.ok || !preview.changes.length) continue;
        workspace.ensureHarleyGitignore(sid);
        // backup branch'e geç (yoksa oluştur), commit et
        await workspace.gitRun(sid, ['checkout', '-B', 'backup'], 15000);
        await workspace.gitRun(sid, ['add', '-A'], 15000);
        const ci = await workspace.gitRun(sid, ['commit', '-m', 'auto-backup ' + new Date().toISOString().slice(0, 16).replace('T', ' ')], 15000);
        if (!ci.ok && !/nothing to commit/i.test(ci.error || '')) {
          await workspace.gitRun(sid, ['checkout', '-'], 10000);
          continue;
        }
        // Backup branch'te commit sayısını kontrol et; 50'den fazlaysa soft reset ile eski commit'leri temizle
        const log = await workspace.gitRun(sid, ['rev-list', '--count', 'backup'], 10000);
        const commitCount = parseInt((log.output || '0').trim(), 10);
        if (commitCount > 50) {
          await workspace.gitRun(sid, ['reset', '--soft', 'HEAD~25'], 10000).catch(() => {});
          await workspace.gitRun(sid, ['commit', '-m', 'squashed auto-backup'], 10000).catch(() => {});
        }
        // Push (force-with-lease — backup dalı sadece bizim)
        await workspace.gitPushWithToken(sid, 'backup', github.getToken(), { forceWithLease: true, checkRemote: false });
        // Önceki branch'e dön
        await workspace.gitRun(sid, ['checkout', '-'], 10000);
      }
    } catch { /* sessiz — yedekleme başarısız olursa sohbeti bozma */ }
  };
  setInterval(() => autoBackup().catch(() => {}), 30 * 60000);

  // ---------- #8: Haftalık proje raporu (Pazar akşamı) ----------
  // Her Pazar 20:00'de bağlı projelerin haftalık commit özetini renderer'a gönderir.
  const weeklyReport = async () => {
    try {
      const now = new Date();
      if (now.getDay() !== 0 || now.getHours() !== 20) return; // Pazar 20:00
      const st = loadSettings();
      if (st.weeklyReport === false) return;
      const wsList = (() => { try { return JSON.parse(fs.readFileSync(FILES.workspace, 'utf8')); } catch { return {}; } })();
      const lines = ['Haftalık Proje Raporu', '---'];
      for (const [sid, folder] of Object.entries(wsList || {})) {
        const repo = workspace.getRepo(sid);
        const log = await workspace.gitRun(sid, ['log', '--since=7 days ago', '--oneline', '--stat'], 60000);
        const commits = (log.ok && log.output && log.output !== '(çıktı yok)') ? log.output.split('\n').filter(Boolean) : [];
        const name = repo ? repo.name : path.basename(folder || '');
        if (commits.length) {
          const cnt = commits.filter((l) => /\d+ file| \d+ insertion| \d+ deletion/.test(l)).length;
          lines.push('"' + name + '": ' + commits.length + ' commit' + (cnt ? ', ' + cnt + ' değişiklik' : ''));
          lines.push(commits.filter((l) => l.startsWith('-')).slice(0, 5).join('\n'));
        } else {
          lines.push('"' + name + '": geçen hafta değişiklik yok');
        }
      }
      if (lines.length <= 2) lines.push('Bağlı proje yok.');
      const text = lines.join('\n');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('morning:briefing', { text });
      }
    } catch { /* sessiz */ }
  };
  setInterval(() => weeklyReport().catch(() => {}), 3600000); // her saat kontrol et

  // ---------- tepsi + hızlı çağırma ----------
  // Kapatma butonu uygulamayı gizler; tepsi simgesinden veya Ctrl+Alt+H ile geri gelir.
  app.isQuiting = false;
  try {
    tray = new Tray(ICON);
    tray.setToolTip('Harley — Kişisel Asistan');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Harley\'yi Aç', click: showMain },
      { type: 'separator' },
      { label: 'Kapat', click: () => { app.isQuiting = true; app.quit(); } },
    ]));
    tray.on('double-click', showMain);
  } catch { /* tepsi yoksa sessizce geç */ }
  const hotkey = globalShortcut.register('CommandOrControl+Alt+H', () => {
    showMain();
  });
  console.log('[assistant] summon hotkey:', hotkey ? 'Ctrl+Alt+H' : 'kayit edilemedi');

  // ---------- hatırlatıcı döngüsü ----------
  loadReminders();
  setInterval(() => {
    const now = Date.now();
    const due = reminders.filter((r) => r.due <= now);
    if (!due.length) return;
    reminders = reminders.filter((r) => r.due > now);
    saveReminders();
    for (const r of due) fireReminder(r.message);
  }, 15000);

ipcMain.handle('chat:models', () => {
    const seen = new Set();
    return Object.entries(WEBHOOKS)
      .filter(([id, w]) => {
        if (seen.has(w.label)) return false;
        seen.add(w.label);
        return true;
      })
      .map(([id, w]) => ({ id, label: w.label }));
  });

  const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
  const loadSettings = () => {
    try {
      return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    } catch {
      return {};
    }
  };
  const saveSettings = (s) => {
    try {
      fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  };
  // Kişisel ayarlar → modelin profile metnine eklenir (tarzı ona göre şekillenir).
  // === PERSONA: Harley'nin kimliği, davranış kuralları, dil bilgisi ===
  const PERSONA = [
    '## KİMLİK\nSen Harley’sin — kullanıcının kişisel yapay zeka asistanı.\n' +
    'Adın Harley. Kişiliğin: yardımsever, zeki, sadık, ama gereksiz yere ballandırmayan. ' +
    'Kullanıcıya "sen" diye hitap et; adını biliyorsan adıyla, bilmiyorsan nötr bir hitapla konuş. Samimi ama profesyonel ol. ' +
    'Gereksiz laf kalabalığı yapma — net, kısa, işe yarar cevaplar ver.\n' +
    (i18n.getLang() === 'en'
      ? 'Yanıtlarını İngilizce yaz. Kullanıcı başka bir dilde yazarsa o dilde yanıtla.\n\n'
      : 'Yanıtlarını Türkçe yaz. Kullanıcı başka bir dilde yazarsa o dilde yanıtla.\n\n'),

    '## DAVRANIŞ KURALLARI (HER ZAMAN UY — ihlal etme)\n'
    + '1. ASLA uydurma bilgi verme. Emin olmadığın bir şeyi bilmiyorsan "Bilmiyorum" de veya web ara.\n'
    + '2. Kod üretirken: Runnable, test edilebilir kod yaz. Yorum satırları ekle, hata yakalama (try/catch) ekle.\n'
    + '3. Roblox/Luau kodu istenirse: Roblox API kurallarına uy, gravity/physics kurallarını bil, baseplate oluştururken Anchored=true kullan.\n'
    + '4. Cevapların doğal ve samimi olsun — laf kalabalığı yapma ama soruyu anladığını göster. Sohbet sorusu gelince tek cümleyle geçiştirme; soru "fikir/öneri/nasıl yapılır" gibi bir soruysa biraz açıklayıcı cevap ver. Kod istenirse "İşte kodun:" de, kodu yapıştır, kısa açıklama ekle.\n'
    + '5. Hata mesajı geldiyse: kök nedeni bul, çözümü ver, tekrar deneme talimatı yaz.\n'
    + '6. Proje geliştirme istenirse: mevcut dosyaları oku, yapıyı anla, incremental öner.\n'
    + '7. Kullanıcının dilinde yaz (yukarıdaki DİL kuralı). İngilizce teknik terimleri olduğu gibi bırak (API, SDK, class vs.).\n'
    + '8. Emoji KULLANMA — hiçbir cevapta emoji yok. Sade, temiz, minimalist yaz.\n'
    + '9. "Yapabilirim" veya "İstersen şunu yapabilirim" gibi boş laf eyleme. Ya yap ya da yapamıyorsan söyle.\n'
    + '10. Kod parçası istenirse: tam çalışır kod ver, parçalı/lüks verme. Modüler yaz.\n\n',

    '## KOD YETENEĞİ (özel talimat)\n'
    + 'Kod yazma isteklerinde şu adımları izle:\n'
    + '- Önce projenin mevcut yapısını/teknolojisini sor (eğer bilinmiyorsa).\n'
    + '- Kodu modüler yaz: her fonksiyon tek bir iş yapsın.\n'
    + '- Hata yakalama (try/catch) ekle.\n'
    + '- Roblox/Luau: RunService, Instance.new, WaitForChild gibi API’leri doğru kullan.\n'
    + '- Node.js: async/await kullan, callback hell’den kaçın.\n'
    + '- Git commit mesajı istenirse: conventional commits formatında yaz.\n'
    + '- Refactoring istenirse: mevcut kodu oku, ihtiyacı anla, minimal değişiklik yap.\n\n',

    '## ZAMAN BAĞLAMI\n'
    + 'Şu an: ' + new Date().toLocaleString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '\n'
    + 'Bu bilgiyi kullanarak zamanına uygun cevap ver (gece geç saatte "iyi geceler", sabah "günaydın" gibi).\n'
    + 'Sağlık farkındalığı: Saat 23:00-06:00 arasındaysa ve kullanıcı uzun bir iş istiyorsa, "şu an geç oldu, bu işi yarına saklamak iyi olabilir, ama istersen şimdi de yapabilirim" gibi nazikçe hatırlat. Yine de işi reddetme, sadece bir hatırlatma yap.\n\n',
  ].join('');

  const buildProfilePayload = () => {
    const s = loadSettings();
    const lines = [];
    if (s.name) lines.push('* Ad: ' + s.name);
    if (s.address) lines.push('* Hitap: ' + s.address);
    if (s.city) lines.push('* Şehir: ' + s.city + ' (hava durumu sorularında bu şehri kullan)');
    if (s.style && s.style !== 'orta') lines.push('* Cevap stili: ' + (s.style === 'kısa' ? 'kısa ve öz' : 'detaylı ve kapsamlı'));
    if (s.emoji === false) lines.push('* Emoji: KESİNLİKLE KULLANMA — hiçbir cevapta, hiçbir yerde emoji yok.');
    if (s.emoji === true) lines.push('* Emoji: kullanabilirsin');
    const settingsBlock = lines.length
      ? '\n## KULLANICI AYARLARI\n' + lines.join('\n') + '\n'
      : '';
    // Otomatik öğrenilen kalıcı gerçekler (learnFromChat → Bellek.md):
    let memoryBlock = '';
    try {
      const mem = fs.readFileSync(FILES.memory, 'utf8');
      const memLines = mem.split('\n').map((l) => l.trim()).filter(Boolean).slice(-30);
      if (memLines.length) {
        memoryBlock = '## KALICI HAFIZA\n' + memLines.join('\n') + '\n';
      }
    } catch { /* yoksa atla */ }
    // Eski sohbet özeti (session summaries)
    let summaryBlock = '';
    try {
      const sf = FILES.sessionSummaries;
      if (fs.existsSync(sf)) {
        const summaries = JSON.parse(fs.readFileSync(sf, 'utf8'));
        if (Array.isArray(summaries) && summaries.length) {
          const recent = summaries.slice(-8);
          summaryBlock = '## ÖNCEKİ KONUŞMA ÖZETLERİ\n' + recent.map((r) => '- ' + r).join('\n') + '\n';
        }
      }
    } catch { /* yoksa atla */ }
    // Manuel Bellek (kullanıcının yazdığı)
    let manualProfile = '';
    try {
      manualProfile = fs.readFileSync(profileFile(), 'utf8');
    } catch { /* yoksa boş */ }
    // Kişisel stil ayarları (şifreli profilden)
    const stylePrompt = personalization.getResponseStylePrompt();
    return PERSONA + settingsBlock + memoryBlock + summaryBlock + (manualProfile ? '\n## KULLANICI NOTLARI\n' + manualProfile : '') + (stylePrompt ? '\n' + stylePrompt : '');
  };
  const profileFile = () => path.join(app.getPath('userData'), 'profile.md');
  ipcMain.handle('settings:get', () => loadSettings());
  // Birleştirerek kaydet — hızlı tema geçişi gibi kısmi güncellemeler diğer ayarları silmesin.
  ipcMain.handle('settings:set', (_e, s) => {
    const merged = saveSettings({ ...loadSettings(), ...(s || {}) });
    // Ayarlardaki ad değişince, modelin Memory Oku aracının okuduğu Bellek.md'deki
    // eski ad satırını da güncelle — böylece iki kaynak çelişmez, ayarlar her zaman kazanır.
    if (merged && s && typeof s.name === 'string' && s.name.trim()) {
      try {
        const p = FILES.memory;
        if (fs.existsSync(p)) {
          const txt = fs.readFileSync(p, 'utf8').replace(/^- Kullanıcının adı .*$/gm, '- Kullanıcının adı ' + s.name.trim() + '.');
          fs.writeFileSync(p, txt, 'utf8');
        }
      } catch { /* yok */ }
    }
    return merged;
  });
  ipcMain.handle('memory:get', () => {
    try {
      return fs.readFileSync(profileFile(), 'utf8');
    } catch {
      return '';
    }
  });
  ipcMain.handle('memory:set', (_e, text) => {
    try {
      fs.writeFileSync(profileFile(), String(text || ''), 'utf8');
      return true;
    } catch {
      return false;
    }
  });

  // ---------- Veri yönetimi: yedekle / tümünü sil ----------
  ipcMain.handle('data:export', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Yedek için klasör seç' });
    if (r.canceled || !r.filePaths.length) return { ok: false, message: 'İptal edildi.' };
    const stamp = new Date().toISOString().slice(0, 10);
    const dest = path.join(r.filePaths[0], 'HarleyYedek-' + stamp);
    try {
      fs.mkdirSync(dest, { recursive: true });
      if (fs.existsSync(CFG.HARLEY_DIR)) fs.cpSync(CFG.HARLEY_DIR, path.join(dest, 'HarleyDosyalar'), { recursive: true });
      const ud = app.getPath('userData');
      for (const f of ['settings.json', 'profile.md']) {
        const s = path.join(ud, f);
        if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dest, f));
      }
      return { ok: true, message: 'Yedeklendi: ' + dest, path: dest };
    } catch (e) { return { ok: false, message: 'Yedeklenemedi: ' + e.message }; }
  });

  ipcMain.handle('data:reset', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const r = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Vazgeç', 'Evet, sil'],
      defaultId: 0,
      cancelId: 0,
      title: 'Tüm verileri sil',
      message: 'Tüm yerel Harley verileri silinsin mi?',
      detail: 'Anahtarlar, hafıza, hatırlatmalar, pano ve ayarlar kalıcı olarak silinir. Bu işlem geri alınamaz.',
    });
    if (r.response !== 1) return { ok: false, message: 'İptal edildi.' };
    try {
      if (fs.existsSync(CFG.HARLEY_DIR)) fs.rmSync(CFG.HARLEY_DIR, { recursive: true, force: true });
      const ud = app.getPath('userData');
      for (const f of ['settings.json', 'profile.md', 'clipboard.json']) {
        try { fs.rmSync(path.join(ud, f), { force: true }); } catch { /* yok */ }
      }
      return { ok: true, message: 'Tüm veriler silindi. Uygulama yeniden başlatılıyor.' };
    } catch (e) { return { ok: false, message: 'Silinemedi: ' + e.message }; }
  });

  // ---------- Dil ----------
  ipcMain.handle('i18n:lang', () => i18n.getLang());
  ipcMain.handle('i18n:data', () => ({ lang: i18n.getLang(), en: I18N_EN }));

  // ---------- Güncelleme kontrolü ----------
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:checkUpdates', async () => {
    const u = await checkForUpdates();
    if (u && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:available', u);
    return u || { upToDate: true, version: app.getVersion() };
  });
  ipcMain.handle('app:openExternal', (_e, url) => {
    try { if (/^https:\/\//i.test(String(url || ''))) shell.openExternal(String(url)); return true; } catch { return false; }
  });
  // Arayüzü main üzerinden yeniden yükle (will-navigate engeli location.reload()'u kesiyor).
  ipcMain.handle('app:reload', () => {
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload(); return true; } catch { return false; }
  });

  function friendlyError(err) {
    const m = String((err && err.message) || err);
    if (/not found/i.test(m)) return 'Bu model henüz hazır değil — indirme devam ediyor. Birkaç dakika sonra tekrar dene.';
    if (/ECONNREFUSED|timeout/i.test(m)) return 'Servisler başlatılıyor, birazdan tekrar dene.';
    if (/HTTP 500/i.test(m)) return 'Servis hatası oluştu: ' + m.slice(0, 160);
    return m;
  }

  ipcMain.handle('chat:send', async (_event, { chatInput, model, sessionId, history }) => {
    // ---- Token bütçesi koruması (tek projede aşırı harcamayı engelle) ----
    // Oturum başına birikimli tahmini token sayısı tutulur; bütçe dolunca model
    // çağrılmaz (bütçe korumasını kaldırmadan). Bütçe değeri env veya dosyadan okunur.
    const BUDGET_FILE = FILES.tokenBudget;
    let _tb = { used: 0, bypass: false };
    try { _tb = Object.assign(_tb, JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'))); } catch { /* yok */ }
    const BUDGET_MAX = parseInt(process.env.HARLEY_TOKEN_BUDGET || '100000', 10);
    const _tbSave = () => { try { fs.writeFileSync(BUDGET_FILE, JSON.stringify(_tb)); } catch { /* yok */ } };
    const _tbEstimate = (s) => Math.ceil(String(s || '').length / 3);
    const _raw = String(chatInput || '').trim();
    if (/bütçe.*(sıfırla|sifirla)|reset\s*budget/i.test(_raw)) { _tb.used = 0; _tb.bypass = false; _tbSave(); return { output: T('Token bütçesi sıfırlandı.'), streamed: false, local: true, skill: 'budget' }; }
    if (/bütçeyi\s*aş|bütçe.*aş|(raise|bypass)\s*budget/i.test(_raw)) { _tb.bypass = true; _tbSave(); return { output: T('Tamam, bütçe korumasını geçici olarak kaldırdım — dikkatli ol.'), streamed: false, local: true, skill: 'budget' }; }
    if (!_tb.bypass && _tb.used >= BUDGET_MAX) {
      return { output: T('Bu oturumun token bütçesi doldu ({n} token). Yeni bir görev için "bütçeyi sıfırla" ya da "bütçeyi aş" de.', { n: BUDGET_MAX.toLocaleString(i18n.getLang() === 'en' ? 'en-US' : 'tr') }), streamed: false, local: true, skill: 'budget' };
    }
    // Kullanıcının GERÇEK son mesajı — geçmiş eklendikten SONRA niyet/classifier
    // testleri yapılmaz; aksi halde geçmişteki "günün özeti", "günaydın", "spotify
    // aç" gibi satırlar her yeni soruyu yanlış tetiklerdi.
    const rawInput = String(chatInput || '').trim();
    // Sohbet bağlamı: renderer son ~8 mesajı gönderir. Gerçek konuşma geçmişi
    // buradan gelir — modele "önceki konuşma" olarak öneklenir.
    const h = String(history || '').trim();
    if (h) {
      // Token bütçesi: 8 mesaj × ~300 karakter → ~2.4K karakter (≈600-900 token).
      chatInput = 'ÖNCEKİ KONUŞMA (bağlam — kullanıcının son mesajları, devam sorusu/hatırlama için):\n' + h + '\n\nSON MESAJ:\n' + chatInput;
    }
    const webhook = WEBHOOKS[model] || WEBHOOKS['deepseek-flash'];
    // Günün özeti isteği → modeli ATLA, hazır özeti doğrudan döndür.
    // SADECE son mesajın kendisi değerlendirilir (rawInput) — geçmiş değil.
    if (rawInput && OZET_INTENT.test(rawInput)) {
      try {
        const s = await google.runOzet();
        if (s.text) {
          evolution.recordUse('gunun-ozeti', 'local');
          return { output: s.text, streamed: false, summary: true };
        }
      } catch { /* modele düş */ }
    }
    // E-posta sorusu → modeli ATLA, okunmamış mailleri doğrudan çek.
    if (rawInput && EMAIL_INTENT.test(rawInput)) {
      try {
        const m = await google.epostaFetch();
        evolution.recordUse('eposta', 'local');
        return { output: m.text, streamed: false, local: true, skill: 'eposta' };
      } catch (e) {
        return { output: 'E-postaların alınamadı: ' + (e && e.message ? e.message : 'Google servisine ulaşılamadı'), streamed: false, local: true, skill: 'eposta' };
      }
    }
    // Takvim'e etkinlik ekleme → modeli ATLA, doğrudan ekle.
    if (rawInput && ADD_EVENT_INTENT.test(rawInput)) {
      try {
        const evText = rawInput
          .replace(ADD_EVENT_INTENT, ' ')
          .replace(/takvime?|takvimime|etkinlik|randevu|toplantı|toplanti|buluşma|bulusma|görüşme|gorusme|ekle|oluştur|olustur|kaydet|programla|planla|ayarla|kur/g, ' ')
          .replace(/(\d{1,2})[:.](\d{2})/g, ' ')
          .replace(/\b(yarın|yarin|bugün|bugun|öbür gün|obur gun|pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar)\b/gi, ' ')
          .replace(/[^\p{L}\p{N} ]/gu, ' ')
          .replace(/\s+/g, ' ').trim()
          || 'Etkinlik';
        const t = google.parseDateTime(rawInput);
        const r = await google.addCalendarEvent({ summary: evText, start: t.start, end: t.end });
        evolution.recordUse('takvim-ekle', 'tool');
        const saat = new Date(t.start).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        return { output: 'Takvime eklendi: "' + evText + '" — ' + new Date(t.start).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }) + ' ' + saat + ' (' + r.id + ')', streamed: false, local: true, skill: 'takvim-ekle' };
      } catch (e) {
        return { output: 'Etkinlik eklenemedi: ' + (e && e.message ? e.message : 'Google servisine ulaşılamadı'), streamed: false, local: true, skill: 'takvim-ekle' };
      }
    }
    // Görev ekleme → modeli ATLA, doğrudan ekle.
    if (rawInput && ADD_TASK_INTENT.test(rawInput)) {
      let title = (rawInput.match(/ekle\s*[:]?\s*(.+)/i) || [])[1];
      if (!title) title = (rawInput.match(/^\s*(.+?)\s+(?:ı|i|u|ü|'ı|'i|'u|'ü)\s+(?:göreve?|goreve?|yapılacaklara?|yapilacaklara?|listeme?|to-?do)\s+ekle/i) || [])[1];
      title = (title || '').trim().replace(/[.\s]+$/, '');
      if (title) {
        try {
          const r = await google.addTask({ title });
          evolution.recordUse('gorev-ekle', 'tool');
          return { output: 'Görev eklendi: "' + title + '" ✓', streamed: false, local: true, skill: 'gorev-ekle' };
        } catch (e) {
          return { output: 'Görev eklenemedi: ' + (e && e.message ? e.message : 'Google servisine ulaşılamadı'), streamed: false, local: true, skill: 'gorev-ekle' };
        }
      }
    }
    // Görev tamamlama → modeli ATLA, doğrudan tamamla.
    if (rawInput && COMPLETE_TASK_INTENT.test(rawInput) && !/ekle/i.test(rawInput)) {
      let ttitle = rawInput
        .replace(COMPLETE_TASK_INTENT, ' ')
        .replace(/\b(tamamla|tamamlandı|tamamlandi|işaretle|isaretle|bitti|yaptım|yaptim|kapat|bitir|görev|gorev|yapılacak|yapilacak)\b/gi, ' ')
        .replace(/[^\p{L}\p{N} ]/gu, ' ')
        .replace(/\s+/g, ' ').trim();
      if (ttitle) {
        try {
          const r = await google.completeTask({ title: ttitle });
          evolution.recordUse('gorev-tamamla', 'tool');
          if (r.notFound) return { output: 'Açık görevlerde "' + ttitle + '" bulunamadı.', streamed: false, local: true, skill: 'gorev-tamamla' };
          return { output: 'Görev tamamlandı: "' + (r.title || ttitle) + '" ✓', streamed: false, local: true, skill: 'gorev-tamamla' };
        } catch (e) {
          return { output: 'Görev tamamlanamadı: ' + (e && e.message ? e.message : 'Google servisine ulaşılamadı'), streamed: false, local: true, skill: 'gorev-tamamla' };
        }
      }
    }
    // ---------- EĞLENCE: oyun hamleleri (aktif oyun varken kısa girişler doğrudan işlenir) ----------
    const isStory = fun.getActiveGame(sessionId) === 'hikaye';
    if (fun.isActive(sessionId) && rawInput && !STOP_GAME_INTENT.test(rawInput) && fun.looksLikeMove(sessionId, rawInput) && (isStory || rawInput.length < 40) && !OZET_INTENT.test(rawInput) && !EMAIL_INTENT.test(rawInput)) {
      evolution.recordUse('oyun', 'local');
      return { output: fun.gameMove(sessionId, rawInput), streamed: false, local: true, skill: 'oyun' };
    }
    if (rawInput && STOP_GAME_INTENT.test(rawInput) && fun.isActive(sessionId)) {
      return { output: fun.stopGame(sessionId), streamed: false, local: true, skill: 'oyun' };
    }
    if (rawInput && GAME_START_INTENT.test(rawInput)) {
      const gameName = (rawInput.match(/(kelime avı|kelime avi|sayı tahmin|sayi tahmin|20 soru|yirmi soru|[şs]ehir[\s-]?[üu]lke[\s-]?meyve|[şs]ehir[\s-]?[üu]lke|hik[âa]y[eâ] tamamla|hik[âa]y[eâ] yaz)/i) || [])[0] || 'oyun';
      evolution.recordUse('oyun', 'local');
      return { output: fun.startGame(sessionId, gameName), streamed: false, local: true, skill: 'oyun' };
    }
    if (rawInput && MOTIVATION_INTENT.test(rawInput)) { evolution.recordUse('motivasyon', 'local'); return { output: fun.dailyMotivation(), streamed: false, local: true, skill: 'motivasyon' }; }
    if (rawInput && FACT_INTENT.test(rawInput)) { evolution.recordUse('bilgi', 'local'); return { output: fun.funFact(), streamed: false, local: true, skill: 'bilgi' }; }
    if (rawInput && SONG_INTENT.test(rawInput)) { evolution.recordUse('sarki', 'local'); return { output: fun.songOfDay(), streamed: false, local: true, skill: 'sarki' }; }
    // ---------- Önerilen şarkıyı onaylayınca çal ----------
    if (rawInput && CONFIRM_PLAY_INTENT.test(rawInput)) {
      const ls = fun.getLastSong();
      if (ls && spotifyWeb.isConfigured()) {
        try {
          const q = ls.title + ' ' + (ls.artist || '');
          const r = await spotifyWeb.playQuery(q);
          if (r.ok && r.track) {
            spotify.clearCache();
            for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send('spotify:refresh'); } catch { /* yok */ } }
            evolution.recordUse('sarki', 'local');
            return { output: 'Şimdi Spotify\'da "' + r.track.name + '" — ' + r.track.artist + ' çalıyor.', streamed: false, local: true, skill: 'spotify-play' };
          }
          return { output: 'Şarkıyı çalamadım: ' + (r.error === 'no_result' ? 'o şarkıyı bulamadım' : 'Spotify hatası') + '.', streamed: false, local: true, skill: 'sarki' };
        } catch (e) {
          return { output: 'Şarkıyı çalamadım: ' + (e && e.message ? e.message : 'bilinmeyen hata') + '.', streamed: false, local: true, skill: 'sarki' };
        }
      }
      if (ls && !spotifyWeb.isConfigured()) {
        return { output: 'Spotify\'a bağlı değilim — "Spotify bağla" de, sonra "günün şarkısı" deyip çaldırabilirsin. Önerim: ' + ls.title + ' — ' + ls.artist + '.', streamed: false, local: true, skill: 'sarki' };
      }
      // lastSong yoksa klasik akışa bırak (model cevap versin).
    }
    // ---------- CLASSIFIER: AI = gerektiğinde çağrılan organ ----------
    // Saat, takvim, CPU, git durumu, Studio açık mı, uygulama aç, matematik...
    // gibi şeyler için modeli çağırmaya gerek yok — yerel handler'lar hızlı ve ücretsiz.
    {
      const personalization = require('./personalization');
      const testRunner = require('./test-runner');
      const clsCtx = { 
        showMain, 
        hideMain: () => { if (mainWindow) mainWindow.hide(); }, 
        projectDir: 'C:/Projects', 
        github, 
        projectMemory, 
        spotify, 
        spotifyWeb, 
        setAutoWrite, 
        setActiveProject, 
        hasActiveTask: !!(taskPlanner.getActiveTask && taskPlanner.getActiveTask()),
        personalization,
        testRunner,
        sessionId,
      };
      const cls = classify(rawInput, clsCtx);
      if (cls.handled) {
        evolution.recordUse(cls.skill || 'local', 'local');
        return { output: String(cls.response), streamed: false, local: true, skill: cls.skill };
      }
      if (cls._asyncHandler) {
        try {
          const done = await runAsyncHandler(cls);
          if (done && done.handled && done.response) {
            // Şarkı çalınca üstteki Spotify player'ı anında tazele
            if (done.skill === 'spotify-play') {
              spotify.clearCache();
              for (const w of BrowserWindow.getAllWindows()) {
                try { w.webContents.send('spotify:refresh'); } catch { /* yok */ }
              }
            }
            evolution.recordUse(done.skill || 'local', 'local');
            return { output: String(done.response), streamed: false, local: true, skill: done.skill };
          }
        } catch (err) {
          return { error: 'Yerel işlem hatası: ' + err.message };
        }
      }
    }
    const sendOnce = async () => {
      const ac = new AbortController();
      currentAbort = ac;
      try {
        const ap = getActiveProject();
        const context = await google.buildContext();
        const wsInfo = workspace.get(sessionId);
        const wsRepo = workspace.getRepo(sessionId);
        const wsRepoCtx = wsRepo
          ? '\nBAĞLI GITHUB REPO: ' + wsRepo.name + (wsRepo.private ? ' (gizli)' : ' (açık)') + ' — ' + wsRepo.url + '\nBu klasör bu repoya bağlı; yaptığın değişiklikleri git_commit + git_push ile bu repoya gönderebilirsin.'
          : (wsInfo ? '\nBU KLASÖR HENÜZ GITHUB REPOSUNA BAĞLI DEĞİL. Kullanıcı isterse git_create_repo (yeni) veya git_link_repo (mevcut) ile bağla.' : '');
        const wsCtx = wsInfo
          ? '\nÇALIŞMA KLASÖRÜ: ' + wsInfo.path + '\nBu klasörde tam yetkin var. Dosya işlemleri için workspace_list, workspace_read, workspace_write, workspace_append, workspace_mkdir, workspace_delete, workspace_move araçlarını kullan. Komut çalıştırmak için workspace_run. Dev sunucusu gibi bitmeyen komutlar için workspace_run_bg ile arka planda başlat, workspace_bg_status ile durumu izle, workspace_http ile sunucuyu test et. Testleri çalıştırmak için workspace_test kullan.\nÖNEMLİ: Windows\'tasın! Unix komutları (cat, grep, tail, head, find, xargs, wc, ls, chmod, sudo) ÇALIŞMAZ. workspace_run bir cmd.exe komutu alır. Dosya içeriğini OKUMAK İÇİN workspace_run ile "cat" kullanma — workspace_read kullan. Dosya yazmak için workspace_write kullan. Dizin aramak için workspace_list kullan.\nGit: git_status/git_diff/git_log ile durumu gör. GitHub\'a yazmak için git_create_repo, git_link_repo, git_commit, git_push, git_pull araçlarını kullan — KESİNLİKLE workspace_run ile git/gh/curl/wget komutu çalıştırma, sadece bu araçları kullan. gh CLI YOKTUR, GitHub işlemleri için git_* araçlarını kullan. Token github-token.txt dosyasında hazır, test etme. Eğer git_create_repo "ad zaten var" derse git_link_repo ile mevcut repoya bağlan. Yollar kökten göreli (ör. "src/app.js").\nGit yazma işlemleri HER ZAMAN kullanıcı onayı ister — önce değişiklikleri göster, sonra aracı çağır. Kullanıcı "repo oluştur" veya "şu repoya bağlan" derse ilgili aracı çağır, onay penceresini bekle, onaylanmazsa kullanıcıya bildir.\nKarmaşık bir görevse önce task_plan ile adımları belirle (adımlar KISA olsun: 3-6 adım, her biri 6-8 kelime, örn. "Klasör kur", "Sınıfı yaz"), sonra uygula, ardından task_mark_done ile adımları işaretle, en son test et (workspace_test/workspace_run/workspace_http) ve sonucu kullanıcıya sun.' + wsRepoCtx
          : '';
        const activeTask = taskPlanner.getActiveTask();
        const taskCtx = activeTask
          ? '\nAKTİF PLAN: ' + activeTask.description + '\nAdımlar:\n' + activeTask.steps.map((s, i) => '  [' + (s.done ? '✓' : ' ') + '] ' + (i + 1) + '. ' + s.text).join('\n') + '\n(task_plan ile yeni plan oluştur, task_mark_done ile adım işaretle.)'
          : '';
        const profile = (ap ? '\nAKTİF PROJE: ' + ap + '\n' : '') + buildProfilePayload() + (context ? '\n' + context : '') + wsCtx + taskCtx;
        let streamed = false;
        const onChunk = (text) => {
          streamed = true;
          try {
            event.sender.send('chat:chunk', { sessionId, text });
          } catch { /* pencere kapandıysa yok say */ }
        };
        // DeepSeek function-calling: model gerekirse Google/hafıza araçlarını kendisi çağırır.
        // Başarısız olursa düz akışlı sohbete düşer (retry akışında tekrar denenir).
        const messages = [{ role: 'system', content: PERSONA_TEXT + (profile ? '\nKULLANICI PROFİLİ:\n' + profile : '') }, { role: 'user', content: chatInput }];
        const executeTool = async (name, args) => {
  const h = TOOL_HANDLERS[name];
  if (!h) return 'Bilinmeyen araç: ' + name;
  if (name === 'start_game' || name === 'game_move') return String(await h((args && (args.game || args.move)) || '', sessionId));
  // workspace_ ve git_ araçları sessionId'ye ihtiyaç duyar (bağlı klasörü bulmak için)
  if (name.startsWith('workspace_') || name.startsWith('git_')) return String(await h(args || {}, sessionId));
  return String(await h(args || {}));
};
        const onToolCall = (name, args) => {
          try {
            diag('tool-call: ' + name + ' ' + JSON.stringify(args || {}).slice(0, 150));
            const label = ({ workspace_write: 'Dosya yazılıyor', workspace_read: 'Dosya okunuyor', workspace_list: 'Klasör taranıyor', workspace_append: 'Dosyaya ekleniyor', workspace_mkdir: 'Klasör oluşturuluyor', workspace_delete: 'Dosya siliniyor', workspace_move: 'Dosya taşınıyor', workspace_run: 'Komut çalıştırılıyor', task_plan: 'Plan oluşturuluyor', task_mark_done: 'Adım tamamlanıyor', web_search: 'Web aranıyor', drive_summarize: 'Drive okunuyor' })[name] || name;
            event.sender.send('tool:progress', { sessionId, label });
          } catch { /* yok */ }
        };
        const onToolDone = (name, args, result) => {
          try {
            diag('tool-done: ' + name + ' → ' + String(result || '').slice(0, 150));
            event.sender.send('tool:progress', { sessionId, label: '' });
          } catch { /* yok */ }
        };
        const res2 = await postDeepSeekTools({
          model: webhook.modelId || 'deepseek-flash',
          messages, tools: TOOLS, executeTool, onChunk, onToolCall, onToolDone,
          maxTokensPerCall: 8000, totalTimeMs: 300000, timeoutMs: 120000, signal: ac.signal,
          // Her model çağrısından önce: tahmini token ekle, bütçe aşıldıysa döngüyü durdur
          beforeCall: (msgs) => {
            const est = (msgs || []).reduce((a, x) => a + (x.content ? Math.ceil(String(x.content).length / 3) : 0), 0);
            const cost = Math.min(est, 12000) + 300; // gerçekçi — uzun döngüler bütçeyi şişirmesin
            _tb.used += cost;
            _tbSave();
            // Agentic döngüdeki her model çağrısını da usage panosuna işle (tutarlı takip)
            recordUsage(webhook.id || model || 'deepseek-flash', String((msgs || [])[msgs.length - 1] && (msgs[msgs.length - 1].content) || '').slice(0, 2000), '');
            return !_tb.bypass && _tb.used >= BUDGET_MAX;
          },
          budgetHaltMessage: T('**Token bütçesi doldu ({n} token).** Görev yarıda kesildi. Devam etmek için "bütçeyi sıfırla" ya da "bütçeyi aş" de.', { n: BUDGET_MAX.toLocaleString(i18n.getLang() === 'en' ? 'en-US' : 'tr') }),
        });
        // halted durumlarda kullanıcıya net feedback ver + aktif görevin ilerlemesini ekle
        if (res2.halted) {
          const active = taskPlanner.getActiveTask();
          const progress = active && Array.isArray(active.steps)
            ? '\n\n**Görev ilerlemesi:**\n' + active.steps.map((s, i) => '  [' + (s.done ? '✓' : ' ') + '] ' + (i + 1) + '. ' + s.text).join('\n')
              + '\n*Devam etmek için "bütçeyi sıfırla" / "bütçeyi aş" de, sonra görevi tekrar sor.*'
            : '\n\n*Devam etmek için "bütçeyi sıfırla" ya da "bütçeyi aş" de.*';
          const reasonText = {
            budget: T('**Token bütçesi doldu ({n} token).** Görev yarıda kesildi.', { n: BUDGET_MAX.toLocaleString(i18n.getLang() === 'en' ? 'en-US' : 'tr') }) + progress,
            time:   T('**Süre aşıldı.** ') + (res2.output || '') + progress,
            loops:  T('**Döngü sınırına ulaşıldı.** ') + (res2.output || '') + progress,
          }[res2.reason] || res2.output;
          return { output: reasonText, streamed: true };
        }
        if (res2.output) return { output: res2.output, streamed: true };
        // Tool akışı boş sonuç verdi (model tool çağrısı yapamadı ya da content üretemedi).
        // Düz akışa düş — model normal Türkçe cevap üretir. Ama aynı prompt'la tekrar araç
        // çağırıp döngüye girmesin diye NET bir talimat ekle: araç YOK, sadece metinle cevap ver.
        let fallbackText = '';
        try {
          const active = taskPlanner.getActiveTask();
          if (active && active.steps) {
            const done = active.steps.filter((s) => s.done).length;
            const total = active.steps.length;
            fallbackText = T('Şu ana kadar {d}/{t} adım tamamlandı. Devam ediyorum:\n', { d: done, t: total });
          }
        } catch { /* yok */ }
        const fallbackInput = chatInput + '\n\n(SİSTEM NOTU: Artık hiçbir araç/fonksiyon kullanmana izin yok. <tool_calls> veya araç çağrısı üretme. Sadece düz Türkçe metinle cevap ver. Görevin son durumunu kullanıcıya kısaca özetle ve görevi bitirmek için somut adımı anlat.)';
        const { output } = await postDeepSeek({ model: webhook.modelId || 'deepseek-flash', chatInput: fallbackInput, profile: '' }, onChunk, 300000, ac.signal);
        return { output: (fallbackText + output).trim() || T('Görev devam ediyor. "devam et" demen yeterli.'), streamed };
      } catch (err) {
        if (err.name === 'AbortError') return { cancelled: true };
        throw err;
      } finally {
        if (currentAbort === ac) currentAbort = null;
      }
    };
    let res;
    try {
      res = await sendOnce();
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || /timeout/i.test(err.message)) {
        await ensureServices();
        try {
          res = await sendOnce();
        } catch (err2) {
          res = { error: friendlyError(err2) };
        }
      } else {
        res = { error: friendlyError(err) };
      }
    }
    // Model bazen (geçici ağ/API gecikmesi veya düşünme tokenlarının tükenmesi)
    // boş dönebilir — 2 kez daha dene (artık maxTokens 8000 ile nadir olmalı).
    let retries = 0;
    while (res && !res.output && !res.error && !res.cancelled && retries < 2) {
      retries++;
      try {
        res = await sendOnce();
      } catch (err3) {
        res = { error: friendlyError(err3) };
      }
    }
    // Tekrarlanan boş yanıt → anlamlı hata (retry'ler tükendi).
    // Literal "null"/"undefined" dönen model yanıtlarını da boş say (ekrana "null" düşmesin).
    if (res && res.output && /^(null|undefined)$/i.test(String(res.output).trim())) res.output = '';
    if (res && !res.output && !res.error && !res.cancelled) {
      res = { error: 'Yanıt boş geldi — model bu soruyu cevaplayamadı. Farklı bir model dene ya da soruyu başka kelimelerle sor.' };
    }
    // Otomatik yazma modu açıksa, modelin ürettiği dosya bloklarını projeye yaz
    if (res && res.output && !res.error && autoWriteEnabled()) {
      const aw = autoWriteFiles(res.output);
      if (aw.created.length || aw.updated.length || aw.errors.length) res.output = aw.output;
    }
    // Otomatik hafıza: başarılı cevaptan kalıcı gerçekleri çıkar (arka planda, sohbeti bekletmez).
    if (res && res.output && !res.error) {
      evolution.recordUse('ai-sohbet', 'tool');
      learnFromChat(chatInput, res.output).catch(() => {});
      summarizeConversation(chatInput, res.output).catch(() => {});
      // Token panosu: girdi (bağlam dahil) + çıktı token tahmini kaydet
      recordUsage(webhook.id || model || 'yerel', chatInput, res.output);
      // Bütçe koruması: tahmini tokenları birikimli say
      _tb.used += _tbEstimate(chatInput) + _tbEstimate(res.output);
      _tbSave();
    }
    return res;
  });

  // ---------- #6: hata raporlama ----------
  ipcMain.handle('logs:errors', (_e, n) => logger.tail(Math.max(1, Math.min(50, n || 10))).filter((x) => x.level === 'error'));
  ipcMain.handle('logs:tail', (_e, n) => logger.tail(Math.max(1, Math.min(100, n || 20))));

  // ---------- token kullanım panosu ----------
  ipcMain.handle('usage:get', () => {
    const u = readUsage();
    const days = Object.entries(u.days || {}).sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-30);
    const today = new Date().toISOString().slice(0, 10);
    const t = u.days[today] || { input: 0, output: 0, msgs: 0 };
    let week = 0, month = 0;
    const now = new Date();
    for (const [k, v] of days) {
      const d = new Date(k + 'T00:00:00');
      if (now - d < 7 * 86400000) week += (v.input || 0) + (v.output || 0);
      if (now - d < 30 * 86400000) month += (v.input || 0) + (v.output || 0);
    }
    // Token bütçesi (token-budget.json) — bütçe koruması ile tutarlı göster
    let budget = { used: 0, bypass: false };
    try { budget = Object.assign(budget, JSON.parse(fs.readFileSync(FILES.tokenBudget, 'utf8'))); } catch { /* yok */ }
    return {
      today: t,
      week,
      month,
      total: u.total || 0,
      budget: { used: budget.used || 0, max: parseInt(process.env.HARLEY_TOKEN_BUDGET || '50000', 10), bypass: !!budget.bypass },
      github: u.github || { count: 0, today: 0 },
      githubDays: Object.entries(u.githubDays || {}).sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-30).map(([k, v]) => ({ day: k.slice(5), count: v || 0 })),
      days: days.map(([k, v]) => ({ day: k.slice(5), input: v.input || 0, output: v.output || 0, msgs: v.msgs || 0 })),
      models: Object.entries(u.models || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.input + b.output) - (a.input + a.output)),
    };
  });

  // ---------- TÜMÜNÜ KAPAT: Harley + bağlı programlar (MCP sunucusu + Piper TTS) ----------
  // Normal kapatma (pencere X / app.quit) yalnız Harley'yi kapatır. Bu buton, Harley'nin
  // arka planda başlattığı yardımcı süreçleri de bitirir — oyun oynarken kaynak boşaltmak için.
  ipcMain.handle('app:shutdown-all', () => {
    try {
      if (mcpChild && !mcpChild.killed) { try { mcpChild.kill(); } catch { /* zaten kapandı */ } }
      try { execFile('taskkill.exe', ['/f', '/im', 'piper.exe'], { windowsHide: true }, () => {}); } catch { /* yok */ }
    } catch { /* yok */ }
    setTimeout(() => { app.exit(0); }, 250);
    return { ok: true };
  });

  // ---------- proje RAG: proje içinde metin arama (git repo'su olan kök klasörler) ----------
  ipcMain.handle('projects:search', async (_e, name, query) => {
    const list = await projectMemory.scanProjects();
    const proj = list.find((p) => p.name === String(name || ''));
    if (!proj || !proj.dir || !fs.existsSync(proj.dir)) return { error: 'Proje bulunamadı: ' + name };
    const q = String(query || '').trim().toLowerCase();
    if (!q) return { error: 'Arama sorgusu boş' };
    const results = [];
    const EXTS = ['.lua', '.ts', '.tsx', '.js', '.jsx', '.py', '.md', '.txt', '.json', '.lua.txt', '.rbxl', '.rbxmx'];
    const walk = (dir, depth) => {
      if (depth > 5 || results.length >= 25) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name === '.git' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (EXTS.includes(path.extname(e.name).toLowerCase())) {
          try {
            const txt = fs.readFileSync(full, 'utf8');
            const idx = txt.toLowerCase().indexOf(q);
            if (idx >= 0) {
              const lineStart = txt.lastIndexOf('\n', idx) + 1;
              const lineEnd = txt.indexOf('\n', idx);
              const line = txt.slice(lineStart, lineEnd < 0 ? txt.length : lineEnd).trim().slice(0, 200);
              results.push({ file: full.slice(proj.dir.length + 1), line: line.slice(0, 200) });
            }
          } catch { /* ikili dosya */ }
        }
      }
    };
    walk(proj.dir, 0);
    return { results: results.slice(0, 25), project: proj.name };
  });

  ipcMain.handle('chat:stop', () => {
    if (currentAbort) currentAbort.abort();
  });

  ipcMain.handle('status:check', () => {
    let deepseek = false;
    try {
      deepseek = !!(secureStore.readJson(FILES.deepseek).apiKey);
    } catch { /* yok */ }
    return { deepseek };
  });

  // ---------- Roblox Studio bağlantı durumu (UI paneli) ----------
  ipcMain.handle('studio:status', () => getMCPStatus());
  ipcMain.handle('studio:connect', async () => {
    const started = await ensureMCPUp();
    await studioFocus();
    const st = await getMCPStatus();
    return { ...st, started };
  });

  // ---------- Spotify mini-player ----------
  ipcMain.handle('spotify:status', () => spotify.getSpotifyStatus());
  ipcMain.handle('spotify:cover', (_e, artist, track) => spotify.getCover(artist, track));
  ipcMain.handle('spotify:seek', (_e, seconds) => spotify.seek(seconds));
  ipcMain.handle('spotify:control', async (_e, action) => {
    // action: play | next | prev | stop | open
    if (action === 'open') {
      const ok = await spotify.startSpotify();
      return { ok };
    }
    const ok = await spotify.sendMediaKey(action);
    evolution.recordUse('spotify-' + action, 'tool');
    return { ok };
  });

  // ---------- Focus Mode ----------
  ipcMain.handle('focus:start', (_e, p) => {
    const s = focusMode.start(p || {});
    evolution.recordUse('focus-mode', 'tool');
    return s;
  });
  ipcMain.handle('focus:control', (_e, action) => {
    if (action === 'pause') return focusMode.pause();
    if (action === 'resume') return focusMode.resume();
    if (action === 'stop') return focusMode.stop();
    return focusMode.snapshot();
  });
  ipcMain.handle('focus:heartbeat', () => focusMode.heartbeat());

  // ---------- Agent Evolution (kullanım istatistikleri) ----------
  ipcMain.handle('evolution:stats', () => evolution.getStats());
  ipcMain.handle('evolution:suggest', () => evolution.suggestions());
  ipcMain.handle('evolution:skills', () => {
    try {
      return classifier.skills.map((s) => s.name);
    } catch {
      return [];
    }
  });

  // ---------- Task Planner (görev planlayıcı) ----------
  ipcMain.handle('task:create', (_e, desc, model) => taskPlanner.createTask(desc, model));
  ipcMain.handle('task:active', () => taskPlanner.getActiveTask());
  ipcMain.handle('task:completeStep', (_e, stepId) => taskPlanner.completeStep(stepId));
  ipcMain.handle('task:startStep', (_e, stepId) => taskPlanner.startStep(stepId));
  ipcMain.handle('task:cancel', () => taskPlanner.cancelTask());

  // ---------- Spotify Web API (şarkı çalma / bağlantı) ----------
  // Not: 'spotify:status' tek kez kaydedilir (mini-player handler'ı yukarıda) —
  // aynı kanala ikinci kez ipcMain.handle çağırmak Electron'da
  // "Attempted to register a second handler" hatası fırlatır ve açılışı bozar.
  ipcMain.handle('spotify:connect', () => spotifyWeb.connect());

  ipcMain.handle('services:status', async () => {
    let deepseek = false;
    try {
      deepseek = !!(secureStore.readJson(FILES.deepseek).apiKey);
    } catch { /* yok */ }
    const studio = await getMCPStatus();
    return { deepseek, studio };
  });

  // ---------- İlk kurulum durumu (sihirbaz için) ----------
  ipcMain.handle('setup:status', async () => {
    let deepseek = false;
    try { deepseek = !!(secureStore.readJson(FILES.deepseek).apiKey); } catch { /* yok */ }
    let spotify = false;
    try { spotify = !!spotifyWeb.isConfigured() && !!spotifyWeb.hasToken(); } catch { spotify = false; }
    let google = false;
    try {
      const g = JSON.parse(fs.readFileSync(GOOGLE_CFG, 'utf8'));
      google = !!(g.client_id && g.client_secret && g.refresh_token);
    } catch { google = false; }
    return { deepseek, spotify, google };
  });

  // ---------- Bağlantılar paneli (BYO: kendi anahtarını gir) ----------
  // Kullanıcı dostu hata mesajları (ham "HTTP 401" yerine anlaşılır metin).
  function friendlyNetError(e) {
    const m = String((e && e.message) || e || '');
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(m)) return 'İnternet bağlantısı yok gibi görünüyor.';
    if (/timeout|zaman aşımı/i.test(m)) return 'Zaman aşımı — internetini kontrol edip tekrar dene.';
    return 'Bağlanamadı: ' + m;
  }
  function friendlyApiError(status, body) {
    let detail = '';
    try { detail = (JSON.parse(body).error && JSON.parse(body).error.message) || ''; } catch { /* yok */ }
    if (status === 401) return 'Anahtar geçersiz (401) — kontrol et.';
    if (status === 402) return 'Bakiye yetersiz (402) — DeepSeek hesabına bakiye yükle.';
    if (status === 429) return 'Çok fazla istek (429) — biraz sonra tekrar dene.';
    if (status >= 500) return 'Sunucu hatası (' + status + ') — biraz sonra tekrar dene.';
    return 'Bağlanamadı (' + status + ')' + (detail ? ': ' + detail : '');
  }
  function testDeepseekKey(key, model) {
    return new Promise((resolve) => {
      const body = JSON.stringify({ model: model || 'deepseek-flash', messages: [{ role: 'user', content: 'test' }], max_tokens: 3 });
      const req = https.request({ hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode === 200) return resolve({ ok: true, message: 'Anahtar çalışıyor.' });
          resolve({ ok: false, message: friendlyApiError(res.statusCode, d) });
        });
      });
      req.on('error', (e) => resolve({ ok: false, message: friendlyNetError(e) }));
      req.setTimeout(12000, () => { req.destroy(); resolve({ ok: false, message: 'Zaman aşımı — internetini kontrol edip tekrar dene.' }); });
      req.write(body);
      req.end();
    });
  }

  // Servis bağlantılarının son test sonucu (Bağlantılar panelinde gösterilir).
  function readConnTests() { try { return JSON.parse(fs.readFileSync(FILES.connectionTests, 'utf8')); } catch { return {}; } }
  function writeConnTest(name, ok, message) {
    try {
      const all = readConnTests();
      all[name] = { ts: Date.now(), ok: !!ok, message: String(message || '') };
      fs.mkdirSync(CFG.HARLEY_DIR, { recursive: true });
      fs.writeFileSync(FILES.connectionTests, JSON.stringify(all, null, 2), 'utf8');
    } catch { /* yok */ }
  }

  ipcMain.handle('connections:status', async () => {
    const out = { deepseek: false, github: false, spotify: false, google: false, githubLogin: '', spotifyConfigured: false, tests: readConnTests() };
    try { out.deepseek = !!(secureStore.readJson(FILES.deepseek).apiKey); } catch { /* yok */ }
    try { out.github = !!github.getToken(); } catch { /* yok */ }
    try { out.spotifyConfigured = !!spotifyWeb.isConfigured(); out.spotify = out.spotifyConfigured && !!spotifyWeb.hasToken(); } catch { /* yok */ }
    try { out.google = google.isConfigured(); } catch { /* yok */ }
    if (out.github) { try { const u = await github.getUser(); if (u && u.login) out.githubLogin = u.login; } catch { /* yok */ } }
    return out;
  });

  // Kayıtlı bir bağlantıyı yeniden test et (paneldeki "Yeniden test et").
  ipcMain.handle('connections:test', async (_e, { name } = {}) => {
    let r;
    if (name === 'deepseek') {
      let key = '';
      try { key = String(secureStore.readJson(FILES.deepseek).apiKey || '').trim(); } catch { /* yok */ }
      r = key ? await testDeepseekKey(key) : { ok: false, message: 'Kayıtlı anahtar yok.' };
    } else if (name === 'github') {
      if (!github.getToken()) r = { ok: false, message: 'Kayıtlı token yok.' };
      else { const u = await github.getUser(); r = (u && u.login) ? { ok: true, message: 'Bağlı: @' + u.login } : { ok: false, message: 'Token doğrulanamadı: ' + ((u && (u.message || u.error)) || 'bilinmeyen') }; }
    } else if (name === 'spotify') {
      try {
        if (!spotifyWeb.isConfigured()) r = { ok: false, message: 'Client ID kayıtlı değil.' };
        else if (!spotifyWeb.hasToken()) r = { ok: false, message: 'Henüz bağlanmadı — "Bağlan" de.' };
        else r = { ok: true, message: 'Spotify bağlı.' };
      } catch (e) { r = { ok: false, message: String(e.message || e) }; }
    } else if (name === 'google') {
      try { await google.ensureToken(); r = { ok: true, message: 'Google bağlı.' }; } catch (e) { r = { ok: false, message: String(e.message || e) }; }
    } else { r = { ok: false, message: 'Bilinmeyen servis.' }; }
    writeConnTest(name, r.ok, r.message);
    return r;
  });

  ipcMain.handle('connections:saveDeepseek', async (_e, { apiKey, model }) => {
    const key = String(apiKey || '').trim();
    if (!key) return { ok: false, message: 'Anahtar boş.' };
    const test = await testDeepseekKey(key, model);
    writeConnTest('deepseek', test.ok, test.message);
    if (!test.ok) return test;
    try {
      let cur = {};
      try { cur = secureStore.readJson(FILES.deepseek); } catch { /* yok */ }
      secureStore.writeJson(FILES.deepseek, { ...cur, apiKey: key, model: model || cur.model || 'deepseek-flash' });
      return { ok: true, message: 'Kaydedildi.' };
    } catch (e) { return { ok: false, message: e.message }; }
  });

  ipcMain.handle('connections:saveGithub', async (_e, { token }) => {
    const t = String(token || '').trim();
    if (!t) return { ok: false, message: 'Token boş.' };
    try {
      secureStore.writeText(FILES.githubToken, t);
    } catch (e) { return { ok: false, message: e.message }; }
    const u = await github.getUser();
    const ok = !!(u && u.login);
    const msg = ok ? 'Bağlandı: @' + u.login : 'Token doğrulanamadı: ' + ((u && (u.message || u.error)) || 'bilinmeyen');
    writeConnTest('github', ok, msg);
    return { ok, message: msg };
  });

  ipcMain.handle('connections:saveSpotify', async (_e, { clientId }) => {
    const id = String(clientId || '').trim();
    if (!id) return { ok: false, message: 'Client ID boş.' };
    try {
      let cur = {};
      try { cur = secureStore.readJson(FILES.spotify); } catch { /* yok */ }
      secureStore.writeJson(FILES.spotify, { ...cur, clientId: id });
      return { ok: true, message: 'Kaydedildi. Şimdi "Bağlan" de.' };
    } catch (e) { return { ok: false, message: e.message }; }
  });

  ipcMain.handle('connections:connectSpotify', async () => {
    let r; try { r = await spotifyWeb.connect(); } catch (e) { r = { ok: false, message: String(e.message || e) }; }
    writeConnTest('spotify', !!(r && r.ok), (r && r.message) || '');
    return r;
  });

  ipcMain.handle('connections:saveGoogle', async (_e, { clientId, clientSecret }) => {
    const r = google.saveCredentials({ client_id: clientId, client_secret: clientSecret });
    return r.ok ? { ok: true, message: 'Kaydedildi. Şimdi "Bağlan" de.' } : { ok: false, message: r.message };
  });

  ipcMain.handle('connections:connectGoogle', async () => {
    let r; try { r = await google.connectOAuth(); } catch (e) { r = { ok: false, message: String(e.message || e) }; }
    writeConnTest('google', !!(r && r.ok), (r && r.message) || '');
    return r;
  });

  // ---------- Kod dosyaya yazma (planla-onayla-yaz temeli) ----------
  ipcMain.handle('code:writeFile', (_e, { path: relPath, content }) => {
    try {
      const abs = path.resolve(PROJECT_BASE, String(relPath || ''));
      if (!abs.startsWith(PROJECT_BASE + path.sep)) return { ok: false, error: 'İzin verilen proje klasörü dışında bir yol.' };
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, String(content || ''), 'utf8');
      return { ok: true, path: abs };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ---------- Otomatik yazma modu (tek izin → checkpoint → doğrudan enjekte) ----------
  function autoWriteEnabled() { try { return JSON.parse(fs.readFileSync(AUTO_WRITE_FILE, 'utf8')).enabled !== false; } catch { return true; } }
  function setAutoWrite(v) { try { fs.writeFileSync(AUTO_WRITE_FILE, JSON.stringify({ enabled: !!v })); } catch { /* yok */ } }
  // Modelin ürettiği <<<DOSYA:yol>>> ... <<<DOSYA SONU>>> bloklarını projeye yazar.
  function autoWriteFiles(output) {
    const out = String(output || '');
    const re = /<<<DOSYA:([^>]+)>>>(.*?)<<<DOSYA SONU>>>/gs;
    const created = [];
    const updated = [];
    const errors = [];
    let m;
    while ((m = re.exec(out)) !== null) {
      const rel = String(m[1]).trim().replace(/^[\/\\]+/, '');
      const content = m[2].replace(/\r?\n?$/, '');
      const abs = path.resolve(PROJECT_BASE, rel);
      if (!abs.startsWith(PROJECT_BASE + path.sep)) { errors.push(rel + ': klasör dışı'); continue; }
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const existed = fs.existsSync(abs);
        fs.writeFileSync(abs, content, 'utf8');
        (existed ? updated : created).push(rel);
      } catch (e) { errors.push(rel + ': ' + e.message); }
    }
    if (!created.length && !updated.length && !errors.length) return { output: out, created: [], updated: [], errors: [] };
    const clean = out.replace(/<<<DOSYA:[^>]+>>>\r?\n?/g, '').replace(/\r?\n?<<<DOSYA SONU>>>/gs, '');
    const parts = [];
    if (created.length) parts.push('Oluşturulan: ' + created.join(', '));
    if (updated.length) parts.push('Güncellenen: ' + updated.join(', '));
    if (errors.length) parts.push('Hatalar: ' + errors.join('; '));
    return { output: clean + '\n\n' + parts.join('\n'), created, updated, errors };
  }
  ipcMain.handle('autowrite:set', (_e, v) => { setAutoWrite(v); return { enabled: !!v }; });
  ipcMain.handle('autowrite:get', () => ({ enabled: autoWriteEnabled() }));

  // ---------- Self-Improvement (kendi kendini iyileştirme) ----------
  const selfImprovement = require('./self-improvement');
  ipcMain.handle('feedback:record', (_e, msg, resp, rating, cat) => {
    selfImprovement.recordFeedback(msg, resp, rating, cat);
    // Kişisel stil öğrenmesi — kullanıcı beğendiği/hoşlanmadığı cevap paternlerinden öğren
    try { personalization.learnFromFeedback(msg, resp, rating); } catch { /* sessiz */ }
  });
  ipcMain.handle('feedback:stats', () => selfImprovement.getStats());

  // ---------- Personalization (gizlilik-öncelikli profil, stil uyumu, rutin öğrenme) ----------
  ipcMain.handle('personalization:getProfile', () => personalization.loadProfile());
  ipcMain.handle('personalization:updateProfile', (_e, updates) => personalization.updateProfile(updates));
  ipcMain.handle('personalization:getRoutineInsights', () => personalization.getRoutineInsights());
  ipcMain.handle('personalization:getProactiveSuggestion', () => personalization.getProactiveSuggestion());
  ipcMain.handle('personalization:recordActivity', (_e, type, data) => personalization.recordActivity(type, data));
  ipcMain.handle('personalization:learnFromFeedback', (_e, userMsg, assistantResp, rating) => personalization.learnFromFeedback(userMsg, assistantResp, rating));

  // ---------- Test Runner (profesyonel test çalıştırıcı + pre-push gate) ----------
  ipcMain.handle('testRunner:run', (_e, options) => testRunner.runTests(options.sessionId, options));
  ipcMain.handle('testRunner:coverage', (_e, options) => testRunner.runCoverage(options.sessionId, options));
  ipcMain.handle('testRunner:watch', (_e, options) => testRunner.runTestsWatch(options.sessionId, options.onProgress));
  ipcMain.handle('testRunner:getConfig', (_e, options) => testRunner.getTestConfig(options.sessionId));
  ipcMain.handle('testRunner:prePushGate', (_e, options) => testRunner.prePushGate(options.sessionId, options));

  // ---------- Dosya ekleme (seçici + pano) ----------
  const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'];
  function readFileForHarley(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const name = path.basename(filePath);
    const size = fs.statSync(filePath).size;
    if (IMG_EXTS.includes(ext)) {
      return { name, type: 'image', content: null, note: 'Görsel dosya — Harley görseli göremez; içerik eklenmedi.' };
    }
    if (size > 500000) {
      return { name, type: 'file', content: null, note: 'Dosya 500 KB\'tan büyük — içerik okunamadı, yalnızca ad eklendi.' };
    }
    return { name, type: 'text', content: fs.readFileSync(filePath, 'utf8') };
  }
  ipcMain.handle('file:pick', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Harley\'ye dosya ekle' });
    if (r.canceled || !r.filePaths.length) return { canceled: true };
    try {
      return { canceled: false, ...readFileForHarley(r.filePaths[0]) };
    } catch (e) {
      return { canceled: false, name: path.basename(r.filePaths[0]), type: 'file', content: null, note: 'Okunamadı: ' + e.message };
    }
  });
  ipcMain.handle('file:readPath', async (_e, filePath) => {
    if (!filePath || typeof filePath !== 'string') return { ok: false };
    try {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return { ok: false };
      return { ok: true, ...readFileForHarley(filePath) };
    } catch (e) {
      return { ok: false, note: e.message };
    }
  });
  // Workspace IPC (registry modül scope'ta tanımlı — wsLoad whenReady'de çağrılır).
  ipcMain.handle('workspace:pick', async (_e, sessionId) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Bu sohbete çalışma klasörü bağla' });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const folder = path.resolve(r.filePaths[0]);
    const res = workspace.bind(sessionId, folder);
    if (!res.ok) return res;
    log('info', 'workspace', 'klasör bağlandı', { sessionId, path: folder });
    // Akıllı proje algılama: tip + git durumu + repo bağlantısı
    const proj = workspace.detectProject(sessionId);
    const repo = workspace.getRepo(sessionId);
    return { ok: true, path: res.path, name: res.name, project: proj, repo };
  });
  ipcMain.handle('workspace:release', (_e, sessionId) => { workspace.release(sessionId); return { ok: true }; });
  // Kullanıcı onayı cevabı (git push/repo oluşturma vb.)
  ipcMain.handle('approval:respond', (_e, id, approved) => respondApproval(id, approved));
  ipcMain.handle('workspace:get', (_e, sessionId) => {
    const w = workspace.get(sessionId);
    if (!w) return null;
    return { ...w, repo: workspace.getRepo(sessionId) };
  });
  // Çoklu proje paneli: tüm bağlı klasörler + repo durumu (okuma amaçlı)
  ipcMain.handle('workspace:list-all', () => {
    const items = [];
    try {
      const data = JSON.parse(fs.readFileSync(FILES.workspace, 'utf8'));
      for (const [sid, folder] of Object.entries(data || {})) {
        const p = path.resolve(folder);
        const proj = (() => {
          try {
            if (fs.existsSync(path.join(p, 'package.json'))) return 'Node';
            if (fs.existsSync(path.join(p, 'pyproject.toml')) || fs.existsSync(path.join(p, 'requirements.txt'))) return 'Python';
            return 'Diğer';
          } catch { return 'Diğer'; }
        })();
        const hasGit = fs.existsSync(path.join(p, '.git'));
        const rem = (() => { try { return fs.readFileSync(path.join(p, '.git', 'config'), 'utf8').includes('[remote "origin"]'); } catch { return false; } })();
        items.push({
          sessionId: sid,
          name: path.basename(p),
          path: p,
          type: proj,
          gitRepo: hasGit,
          hasRemote: rem,
          repo: workspace.getRepo(sid) || null,
        });
      }
    } catch { /* yok */ }
    return items;
  });
  ipcMain.handle('workspace:list', (_e, sessionId, rel) => workspace.safeList(sessionId, rel));
  ipcMain.handle('workspace:read', (_e, sessionId, rel) => workspace.safeRead(sessionId, rel));
  ipcMain.handle('workspace:write', (_e, sessionId, rel, content, append) => workspace.safeWrite(sessionId, rel, content, append));
  ipcMain.handle('clipboard:files', () => {
    try {
      const fmts = clipboard.availableFormats();
      let filePath = null;
      if (fmts.includes('FileNameW')) {
        const buf = clipboard.readBuffer('FileNameW');
        filePath = buf.toString('utf16le').replace(/\0/g, '').trim();
      } else if (fmts.includes('text/uri-list')) {
        const t = clipboard.readText();
        const m = String(t || '').match(/^file:\/\/(.+)$/m);
        if (m) filePath = decodeURIComponent(m[1]);
      }
      if (!filePath || !fs.existsSync(filePath)) return { file: null };
      return { file: { path: filePath, ...readFileForHarley(filePath) } };
    } catch {
      return { file: null };
    }
  });

  // ---------- Project Memory ----------
  ipcMain.handle('projects:scan', async () => {
    const list = await projectMemory.scanProjects();
    return list;
  });
  ipcMain.handle('projects:get', (_e, name) => projectMemory.getProject(String(name || '')));
  ipcMain.handle('projects:setNotes', (_e, name, notes) => projectMemory.setProjectNotes(String(name || ''), notes || {}));
  ipcMain.handle('projects:setGithub', (_e, name, url) => projectMemory.setGithubRepo(String(name || ''), String(url || '')));

  // ---------- GitHub (OKUMA amaçlı — asla commit/push yapmaz) ----------
  ipcMain.handle('github:list', async () => {
    evolution.recordUse('github', 'tool');
    return github.listRepos();
  });
  ipcMain.handle('github:status', async (_e, name) => {
    evolution.recordUse('github', 'tool');
    return github.repoStatus(String(name || ''));
  });
  ipcMain.handle('github:diff', async (_e, name) => {
    evolution.recordUse('github', 'tool');
    return github.repoDiff(String(name || ''));
  });
  ipcMain.handle('github:config', () => github.config());

  // ---------- Yerel HTTP sunucusu (Studio + özet + hatırlatma köprüsü) ----------
  const LOCAL_PORT = 59333;

  // ---------- Yerel API token'ı (güvenlik) ----------
  // İlk açılışta üretilir; Studio eklentisi ve yerel köprüler X-Harley-Token gönderir.
  // Studio eklentisinin (poll/result/hello) ve salt-okunur status ucu açık kalır;
  // geri kalan her uç token ister (yerel başka süreçler keyfi komut çalıştıramaz).
  const TOKEN_FILE = FILES.harleyToken;
  let LOCAL_TOKEN = '';
  try { LOCAL_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { /* ilk açılış */ }
  if (!LOCAL_TOKEN) {
    LOCAL_TOKEN = crypto.randomBytes(24).toString('hex');
    try {
      fs.mkdirSync(CFG.HARLEY_DIR, { recursive: true });
      fs.writeFileSync(TOKEN_FILE, LOCAL_TOKEN, 'utf8');
    } catch { /* sessiz */ }
  }
  const server = http.createServer((req, res) => {
    // Studio eklentisi poll/status gibi uçları GET ile çağırır; diğerleri POST'tur.
    if (req.method !== 'POST' && !req.url.startsWith('/studio')) {
      res.writeHead(405);
      res.end();
      return;
    }
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', async () => {
      let payload = {};
      try {
        payload = JSON.parse(data || '{}');
      } catch { /* bozuk */ }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      // Token kontrolü — Studio eklentisi ve salt-okunur durum uçları hariç.
      {
        const p0 = String(req.url || '').split('?')[0];
        const OPEN = ['/studio/poll', '/studio/result', '/studio/hello', '/studio/status'];
        if (!OPEN.includes(p0) && String(req.headers['x-harley-token'] || '') !== LOCAL_TOKEN) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'yetkisiz' }));
          return;
        }
      }
      try {
        if (req.url === '/ozet') {
          const r = await google.runOzet();
          res.writeHead(200);
          res.end(JSON.stringify({ text: r.text, raw: r.raw, cached: !!r.cached, error: !!r.error }));
        } else if (req.url === '/debug/dom') {
          // UI teşhisi: widget/öğeler gerçekten DOM'da mı (renderer'a sorar)
          let out = { error: 'pencere yok' };
          try {
            if (mainWindow && !mainWindow.isDestroyed()) {
              out = await mainWindow.webContents.executeJavaScript(`
                (() => {
                  const bar = document.getElementById('spotify-bar');
                  const h = document.querySelector('.h-right');
                  const r = bar ? bar.getBoundingClientRect() : null;
                  return {
                    barExists: !!bar,
                    barClass: bar ? bar.className : null,
                    display: bar ? getComputedStyle(bar).display : null,
                    rect: r ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) } : null,
                    hRightKids: h ? h.children.length : -1,
                    viewW: document.documentElement.clientWidth,
                    hubExists: !!document.getElementById('hub'),
                    hubClass: (document.getElementById('hub') || {}).className || null,
                    hubCards: document.querySelectorAll('#hub .hub-card').length,
                    homeBtn: !!document.getElementById('home-btn'),
                    bodyKids: document.body.children.length,
                  };
                })()
              `);
            }
          } catch (e) {
            out = { error: e.message };
          }
          res.writeHead(200);
          res.end(JSON.stringify(out));
        } else if (req.url === '/remind') {
          const due = parseRemindTime(payload.time);
          const msg = String(payload.message || '').trim().slice(0, 300);
          if (!due || !msg) {
            res.writeHead(400);
            res.end(JSON.stringify({ text: 'Zaman veya mesaj eksik/geçersiz. Format: time=10m, message=...' }));
          } else {
            reminders.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), due, message: msg });
            saveReminders();
            const when = new Date(due);
            res.writeHead(200);
            res.end(JSON.stringify({ text: 'Hatırlatma kuruldu: ' + when.toLocaleString('tr-TR') + ' — ' + msg }));
          }
        } else if (req.url.startsWith('/studio')) {
          // ---------- Roblox Studio köprüsü ----------
          // Studio'daki "Harley Bağla" eklentisi bu uçları poll'lar ve Luau çalıştırır.
          const u = new URL(req.url, 'http://localhost');
          const p = u.pathname;
          const agent = u.searchParams.get('agent') || '';
          if (agent) studioAgents.set(agent, Date.now());
          if (p === '/studio/hello') {
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, agent }));
          } else if (p === '/studio/exec' && (payload.type === 'structure' || String(payload.code || '').trim())) {
            const id = studioNewId();
            studioTasks.set(id, {
              id, type: payload.type || 'exec', arg: String(payload.code || ''),
              ts: Date.now(), claimed: false, done: false, result: null, resultAt: 0,
            });
            res.writeHead(200);
            res.end(JSON.stringify({ id }));
          } else if (p === '/studio/poll') {
            let task = null;
            for (const t of studioTasks.values()) {
              if (!t.claimed && !t.done && Date.now() - t.ts < STUDIO_TASK_TTL) {
                t.claimed = true;
                task = { id: t.id, type: t.type, arg: t.arg };
                break;
              }
            }
            // temizlik: sonuçlanmış/eski görevler
            const now = Date.now();
            for (const [id, t] of studioTasks) {
              if (t.done && now - t.resultAt > STUDIO_RESULT_TTL) studioTasks.delete(id);
              else if (!t.claimed && now - t.ts > STUDIO_TASK_TTL) studioTasks.delete(id);
            }
            res.writeHead(200);
            res.end(JSON.stringify({ task }));
          } else if (p === '/studio/result' && req.method === 'POST') {
            const t = studioTasks.get(String(payload.id || ''));
            if (t) {
              t.done = true;
              t.resultAt = Date.now();
              t.result = { ok: !!payload.ok, output: String(payload.output || '') };
            }
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
          } else if (p === '/studio/result') {
            const t = studioTasks.get(u.searchParams.get('id') || '');
            if (t && t.done) {
              res.writeHead(200);
              res.end(JSON.stringify({ done: true, ok: t.result.ok, output: t.result.output }));
            } else {
              res.writeHead(200);
              res.end(JSON.stringify({ done: false }));
            }
          } else if (p === '/studio/status') {
            const now = Date.now();
            const connected = [...studioAgents.values()].some((v) => now - v < 15000);
            res.writeHead(200);
            res.end(JSON.stringify({ connected, agents: studioAgents.size }));
          } else if (p === '/studio/playtest') {
            const action = u.searchParams.get('action') || payload.action || 'start';
            const wait = Math.min(Math.max(parseInt(u.searchParams.get('wait') || payload.wait || '0', 10) || 0, 0), 30);
            const ok = await studioFocus();
            if (!ok) {
              res.writeHead(200);
              res.end(JSON.stringify({ text: "Roblox Studio penceresi bulunamadı. Önce Studio'yu aç." }));
            } else {
              await new Promise((r) => setTimeout(r, 600));
              await studioKey(action === 'stop' ? '+{F5}' : '{F5}');
              if (wait > 0) await new Promise((r) => setTimeout(r, wait * 1000));
              res.writeHead(200);
              res.end(JSON.stringify({
                text: action === 'stop'
                  ? 'Playtest durduruldu (Shift+F5).'
                  : 'Playtest başlatıldı (F5)' + (wait > 0 ? ' ve ' + wait + ' saniye beklendi — şimdi ekran analizi (EKRAN) yapabilirsin.' : '.'),
              }));
            }
          } else if (p === '/studio/focus') {
            const ok = await studioFocus();
            res.writeHead(200);
            res.end(JSON.stringify({ text: ok ? 'Studio odaklandı.' : 'Studio penceresi bulunamadı.' }));
          } else if (p === '/studio/log') {
            res.writeHead(200);
            res.end(JSON.stringify({ text: readStudioLog() }));
          } else if (p === '/studio/mcp-status') {
            // UI paneli için: sunucu + Studio + eklenti durumu (execute_luau probe).
            res.writeHead(200);
            res.end(JSON.stringify(await getMCPStatus()));
          } else if (p === '/studio/mcp-connect') {
            const started = await ensureMCPUp();
            await studioFocus();
            const st = await getMCPStatus();
            res.writeHead(200);
            res.end(JSON.stringify({ ...st, started }));
          } else if (p === '/studio/mcp') {
            // Roblox Studio MCP köprüsü: { tool, args } → 3002/mcp/<tool> → zarfı açar.
            const tool = String(payload.tool || '').trim();
            if (!tool) {
              res.writeHead(400);
              res.end(JSON.stringify({ text: 'tool gerekli (örn. execute_luau, get_file_tree)' }));
              return;
            }
            try {
              const body = JSON.stringify(payload.args || {});
              const rr = await new Promise((resolve, reject) => {
                const r = http.request({ hostname: '127.0.0.1', port: 3002, path: '/mcp/' + tool, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (resp) => {
                  let d = '';
                  resp.on('data', (c) => (d += c));
                  resp.on('end', () => resolve({ status: resp.statusCode, body: d }));
                });
                r.setTimeout(35000, () => r.destroy(new Error('MCP timeout')));
                r.on('error', reject);
                r.write(body);
                r.end();
              });
              if (rr.status >= 400) {
                res.writeHead(200);
                res.end(JSON.stringify({ text: 'MCP hatası ' + rr.status + ': ' + rr.body.slice(0, 250) }));
                return;
              }
              let inner = rr.body;
              try {
                const j = JSON.parse(rr.body);
                if (Array.isArray(j.content) && j.content[0] && typeof j.content[0].text === 'string') inner = j.content[0].text;
              } catch { /* ham bırak */ }
              res.writeHead(200);
              res.end(JSON.stringify({ text: inner }));
            } catch (e) {
              res.writeHead(200);
              res.end(JSON.stringify({ text: 'MCP sunucusuna ulaşılamadı: ' + e.message + ' — Harley MCP sunucusunu otomatik başlatır; Studio eklentisinin bağlı olduğundan emin ol.' }));
            }
          } else {
            res.writeHead(404);
            res.end(JSON.stringify({ text: 'Bilinmeyen studio ucu: ' + req.url }));
          }
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ text: 'Bilinmeyen uç: ' + req.url }));
        }
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ text: 'Hata: ' + e.message }));
      }
    });
  });
  server.listen(LOCAL_PORT, '127.0.0.1');

  // ---------- Pano (clipboard) geçmişi ----------
  const clipFile = () => path.join(app.getPath('userData'), 'clipboard.json');
  let clipHistory = [];
  try {
    clipHistory = JSON.parse(fs.readFileSync(clipFile(), 'utf8')) || [];
  } catch { /* yok */ }
  let lastClip = '';
  function pushClip(text) {
    const t = String(text || '').trim();
    if (!t || t === lastClip) return;
    lastClip = t;
    clipHistory = clipHistory.filter((x) => x.text !== t);
    clipHistory.unshift({ text: t, ts: Date.now() });
    if (clipHistory.length > 60) clipHistory.length = 60;
    try {
      fs.writeFileSync(clipFile(), JSON.stringify(clipHistory), 'utf8');
    } catch { /* yok */ }
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        w.webContents.send('clipboard:new', t);
      } catch { /* yok */ }
    }
  }
  setInterval(() => {
    try {
      const t = clipboard.readText();
      if (t && t !== lastClip) pushClip(t);
    } catch { /* pano erişilemiyor */ }
  }, 1500);
  ipcMain.handle('clipboard:history', () => clipHistory.slice(0, 40));
  ipcMain.handle('clipboard:set', (_e, text) => {
    try {
      clipboard.writeText(String(text || ''));
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('clipboard:clear', () => {
    clipHistory = [];
    try {
      fs.writeFileSync(clipFile(), '[]', 'utf8');
    } catch { /* yok */ }
    return true;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Tepsi modunda pencere kapanınca uygulama arka planda kalmaya devam eder;
  // yalnızca gerçek kapatmada (tepsi menüsü) çıkılır.
  if (app.isQuiting) app.quit();
  else if (process.platform !== 'darwin' && BrowserWindow.getAllWindows().length === 0) {
    // Renderer/GPU çökmesi pencereyi yok ettiyse hemen yeniden kur (uygulama ölmesin).
    setTimeout(() => { if (!app.isQuiting && BrowserWindow.getAllWindows().length === 0) createWindow(); }, 800);
  }
});
}

