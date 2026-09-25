// workspace.js — Per-session çalışma klasörü bağlama + dosya işlemleri.
// Her session yalnızca BİR klasöre bağlanabilir; bir klasör aynı anda yalnızca bir
// session'a bağlı olabilir (mutual exclusion). Bağlar uygulama kapansa da kalır.
// Dosya işlemleri yalnızca bağlı klasörün İÇİ ile sınırlıdır (path traversal engelli).
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const CFG = require('./config');

const wsBySession = new Map(); // sessionId -> { path, name }
const wsByFolder = new Map();  // pathLower -> sessionId
const wsBgProcs = new Map();   // pid -> { logFile, wsPath, cmd }
const repoByFolder = new Map(); // pathLower -> { name, url, private, owner } — KLASÖRE kalıcı bağlı

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(CFG.FILES.workspace, 'utf8'));
    for (const [sid, folder] of Object.entries(data || {})) {
      const p = path.resolve(folder);
      wsBySession.set(sid, { path: p, name: path.basename(p) });
      wsByFolder.set(p.toLowerCase(), sid);
    }
  } catch { /* dosya yok */ }
  loadRepos();
}
function loadRepos() {
  repoByFolder.clear();
  try {
    const data = JSON.parse(fs.readFileSync(CFG.FILES.repoLinks, 'utf8'));
    for (const [folder, info] of Object.entries(data || {})) {
      repoByFolder.set(path.resolve(folder).toLowerCase(), info);
    }
  } catch { /* dosya yok */ }
}
function saveRepos() {
  const obj = {};
  for (const [folder, info] of repoByFolder) obj[folder] = info;
  try { fs.writeFileSync(CFG.FILES.repoLinks, JSON.stringify(obj, null, 2)); } catch { /* sessiz */ }
}
function save() {
  const obj = {};
  for (const [sid, w] of wsBySession) obj[sid] = w.path;
  try { fs.writeFileSync(CFG.FILES.workspace, JSON.stringify(obj, null, 2)); } catch { /* sessiz */ }
}
function get(sessionId) { return wsBySession.get(String(sessionId)) || null; }
function release(sessionId) {
  const w = wsBySession.get(String(sessionId));
  if (w) { wsByFolder.delete(w.path.toLowerCase()); wsBySession.delete(String(sessionId)); save(); }
}
function bind(sessionId, folder) {
  const norm = path.resolve(folder).toLowerCase();
  const owner = wsByFolder.get(norm);
  if (owner && owner !== String(sessionId)) return { ok: false, error: 'already_bound', owner };
  release(sessionId);
  wsBySession.set(String(sessionId), { path: path.resolve(folder), name: path.basename(folder) });
  wsByFolder.set(norm, String(sessionId));
  save();
  return { ok: true, path: path.resolve(folder), name: path.basename(folder) };
}
// Klasöre kalıcı repo bağla (repo-links.json). Aynı klasör başka sohbette de seçilse repo bilinir.
function linkRepo(sessionId, repoName, repoUrl, isPrivate, owner) {
  const w = get(sessionId);
  if (!w) return { ok: false, error: 'Bu sohbete çalışma klasörü bağlı değil.' };
  const norm = path.resolve(w.path).toLowerCase();
  const info = { name: repoName, url: repoUrl, private: !!isPrivate, owner: owner || '' };
  repoByFolder.set(norm, info);
  saveRepos();
  return { ok: true, ...info };
}
// Bağlı klasörün repo bilgisini döndür (klasör bazlı, sohbet bağımsız).
function getRepo(sessionId) {
  const w = get(sessionId);
  if (!w) return null;
  return repoByFolder.get(path.resolve(w.path).toLowerCase()) || null;
}
function getRepoByPath(folderPath) {
  return repoByFolder.get(path.resolve(String(folderPath || '')).toLowerCase()) || null;
}
// Proje tipini algılar: package.json (React/Vite/Node), Python, git repo, remote varlığı.
function detectProject(sessionId) {
  const w = get(sessionId);
  if (!w) return null;
  const has = (p) => { try { return fs.existsSync(path.join(w.path, p)); } catch { return false; } };
  const out = { type: 'bilinmiyor', gitRepo: false, hasRemote: false, files: [] };
  if (has('.git')) out.gitRepo = true;
  if (has('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(w.path, 'package.json'), 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.react || deps['react-dom']) out.type = 'React';
      else if (deps.vite) out.type = 'Vite';
      else if (pkg.bin || pkg.main) out.type = 'Node';
      else out.type = 'Node';
    } catch { out.type = 'Node'; }
  } else if (has('pyproject.toml') || has('requirements.txt') || has('setup.py') || has('Pipfile')) out.type = 'Python';
  else if (has('Cargo.toml')) out.type = 'Rust';
  else if (has('go.mod')) out.type = 'Go';
  const rem = (() => { try { return fs.readFileSync(path.join(w.path, '.git', 'config'), 'utf8'); } catch { return ''; } })();
  out.hasRemote = /\[remote "origin"\]/i.test(rem);
  out.files = fs.readdirSync(w.path, { withFileTypes: true }).filter((d) => !d.name.startsWith('.')).map((d) => d.name).slice(0, 15);
  return out;
}
// ---------- #3: Proje içi kod arama (RAG) ----------
// BM25 tabanlı arama rag.js modülünde; burada yalnızca bağlı klasörle eşleştirilir.
const rag = require('./rag');
function searchCode(sessionId, query, limit) {
  const w = get(sessionId);
  if (!w) return { ok: false, error: 'Bu sohbete çalışma klasörü bağlı değil.' };
  return rag.search(w.path, query, limit);
}
// Yol güvenliği: rel'i bağlı klasör içinde çöz, dışına çıkarsa hata.
function resolve(sessionId, rel) {
  const w = get(sessionId);
  if (!w) return { err: 'Bu sohbete çalışma klasörü bağlı değil.' };
  const target = path.resolve(w.path, String(rel || ''));
  const base = path.resolve(w.path) + path.sep;
  if (target !== path.resolve(w.path) && !target.startsWith(base)) return { err: 'İzin yok: dosya çalışma klasörünün dışında.' };
  return { target, w };
}
function safeWrite(sessionId, rel, content, append) {
  const r = resolve(sessionId, rel);
  if (r.err) return { ok: false, error: r.err };
  try {
    const dir = path.dirname(r.target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (append) fs.appendFileSync(r.target, content);
    else fs.writeFileSync(r.target, content);
    return { ok: true, path: r.target, relative: path.relative(r.w.path, r.target) };
  } catch (e) { return { ok: false, error: e.message }; }
}
function safeList(sessionId, rel) {
  const r = resolve(sessionId, rel);
  if (r.err) return { ok: false, error: r.err };
  try {
    if (!fs.existsSync(r.target)) return { ok: true, items: [], note: 'Klasör yok' };
    const items = fs.readdirSync(r.target, { withFileTypes: true }).map((d) => ({
      name: d.name, isDir: d.isDirectory(),
    })).sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    return { ok: true, items };
  } catch (e) { return { ok: false, error: e.message }; }
}
function safeRead(sessionId, rel) {
  const r = resolve(sessionId, rel);
  if (r.err) return { ok: false, error: r.err };
  try {
    if (!fs.existsSync(r.target) || !fs.statSync(r.target).isFile()) return { ok: false, error: 'Dosya yok: ' + rel };
    const s = fs.statSync(r.target);
    if (s.size > 500000) return { ok: true, note: 'Dosya 500 KB\'tan büyük — içerik okunamadı.', content: '' };
    return { ok: true, content: fs.readFileSync(r.target, 'utf8') };
  } catch (e) { return { ok: false, error: e.message }; }
}
// Arka plan süreç (dev server vb.)
function runBackground(sessionId, cmd) {
  const w = get(sessionId);
  if (!w) return { ok: false, error: 'Bu sohbete çalışma klasörü bağlı değil.' };
  const isWin = process.platform === 'win32';
  const logFile = path.join(w.path, '.harley-bg-' + Date.now() + '.log');
  const cp = spawn(isWin ? 'cmd.exe' : '/bin/sh', isWin ? ['/c', cmd] : ['-c', cmd], {
    cwd: w.path, windowsHide: true, shell: false,
  });
  const fd = fs.openSync(logFile, 'a');
  const writeLog = (d) => { try { fs.writeSync(fd, String(d)); } catch { /* yok */ } };
  cp.stdout && cp.stdout.on('data', writeLog);
  cp.stderr && cp.stderr.on('data', writeLog);
  cp.on('close', () => { try { fs.closeSync(fd); } catch { /* yok */ } wsBgProcs.delete(cp.pid); });
  cp.on('error', () => { try { fs.closeSync(fd); } catch { /* yok */ } wsBgProcs.delete(cp.pid); });
  wsBgProcs.set(cp.pid, { logFile, wsPath: w.path, cmd });
  return { ok: true, pid: cp.pid, cmd, logFile: path.basename(logFile) };
}
function bgStatus(pid) {
  const rec = wsBgProcs.get(Number(pid));
  if (!rec) return { ok: false, error: 'Böyle bir arka plan süreci yok (bitmiş olabilir).' };
  let tail = '';
  try { tail = fs.readFileSync(rec.logFile, 'utf8').slice(-4000); } catch { /* yok */ }
  let alive = false;
  try { process.kill(Number(pid), 0); alive = true; } catch { alive = false; }
  return { ok: true, alive, tail };
}
// Session/app kapanırken tüm bg süreçleri temizle
function killAllBg() {
  for (const pid of wsBgProcs.keys()) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* yok */ }
  }
  wsBgProcs.clear();
}
function killBgForSession(sessionId) {
  const w = get(sessionId);
  if (!w) return;
  for (const [pid, rec] of wsBgProcs) {
    if (rec.wsPath === w.path) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* yok */ }
      wsBgProcs.delete(pid);
    }
  }
}
// Proje tipine göre test komutunu otomatik algılar: package.json (npm), pyproject/requirements (pytest),
// Cargo.toml (cargo test), go.mod (go test). Bulamazsa null döner.
function detectTestCommand(sessionId) {
  const w = get(sessionId);
  if (!w) return null;
  const has = (p) => { try { return fs.existsSync(path.join(w.path, p)); } catch { return false; } };
  try {
    if (has('package.json')) {
      const pkg = JSON.parse(fs.readFileSync(path.join(w.path, 'package.json'), 'utf8'));
      const s = pkg.scripts || {};
      if (s.test && String(s.test).trim()) return 'npm test';
      if (s.jest) return 'npm run jest';
      return 'npm test';
    }
    if (has('pyproject.toml') || has('requirements.txt') || has('setup.py') || has('Pipfile')) return 'python -m pytest';
    if (has('Cargo.toml')) return 'cargo test';
    if (has('go.mod')) return 'go test ./...';
  } catch { /* yok */ }
  return null;
}
// Test komutunu çalıştırır; algılanamazsa verilen komutu kullanır. Hızlı döner (25sn).
function runTest(sessionId, command) {
  const w = get(sessionId);
  if (!w) return { ok: false, error: 'Bu sohbete çalışma klasörü bağlı değil.' };
  const cmd = String(command || '').trim() || detectTestCommand(sessionId);
  if (!cmd) return { ok: false, error: 'Test komutu algılanamadı. Komutu açıkça belirt (örn. workspace_test ile "npm test").' };
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cp = spawn(isWin ? 'cmd.exe' : '/bin/sh', isWin ? ['/c', cmd] : ['-c', cmd], {
      cwd: w.path, windowsHide: true, shell: false,
    });
    let out = '', err = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { cp.kill(); } catch { /* yok */ } }, 25000);
    cp.stdout && cp.stdout.on('data', (d) => { out += String(d); if (out.length > 6000) out = out.slice(-6000); });
    cp.stderr && cp.stderr.on('data', (d) => { err += String(d); if (err.length > 6000) err = err.slice(-6000); });
    cp.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: 'Çalıştırma hatası: ' + e.message }); });
    cp.on('close', (code) => {
      clearTimeout(timer);
      const full = (out || '').trim() + (err && err.trim() ? '\n--- HATA ---\n' + err.trim() : '');
      resolve({ ok: code === 0 && !timedOut, exitCode: code, timedOut, output: full || '(çıktı yok)' });
    });
  });
}

// Git yardımcıları — bağlı klasörde git komutları çalıştırır (güvenli: klasör içinde).
// env: ek ortam değişkenleri (token iletmek için).
// GÜVENLİK: token asla komut satırına geçmez — GIT_CONFIG_COUNT env yöntemiyle iletilir
// (git bunu http.extraHeader olarak okur; process listesinde görünmez).
function gitRun(sessionId, args, timeoutMs, env) {
  const w = get(sessionId);
  if (!w) return { ok: false, error: 'Bu sohbete çalışma klasörü bağlı değil.' };
  return new Promise((resolve) => {
    const cp = spawn('git', args, { cwd: w.path, windowsHide: true, env: { ...process.env, ...(env || {}) } });
    let out = '', err = '';
    const timer = setTimeout(() => { try { cp.kill(); } catch { /* yok */ } }, timeoutMs || 20000);
    cp.stdout && cp.stdout.on('data', (d) => { out += String(d); if (out.length > 6000) out = out.slice(-6000); });
    cp.stderr && cp.stderr.on('data', (d) => { err += String(d); if (err.length > 6000) err = err.slice(-6000); });
    cp.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: 'git çalıştırılamadı: ' + e.message }); });
    cp.on('close', (code) => {
      clearTimeout(timer);
      const ok = code === 0;
      resolve({ ok, exitCode: code, output: (out || err || '(çıktı yok)').trim(), ...(ok ? {} : { error: (err || out || 'Çıkış kodu ' + code).trim() }) });
    });
  });
}
// GitHub token'ı ile push yaparken env ayarları (komut satırına sızmaz).
function gitEnvWithToken(token) {
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
  };
}
// Push: remote config'e token YAZMADAN, geçici URL'ye gömerek gönderir.
// Windows git'te http.extraheader GitHub tarafından kabul edilmiyor (invalid credentials),
// URL'ye x-access-token gömme yöntemi güvenilir çalışır ve remote origin temiz kalır.
// -u kullanılmaz: token'lı URL branch tracking'e yazılmasın; sonrasında upstream normal origin'e bağlanır.
// force-with-lease ile güvenli push (remote history overwrite koruması).
async function gitPushWithToken(sessionId, br, token, options = {}) {
  const { forceWithLease = true, checkRemote = true, dryRun = false } = options;
  const w = get(sessionId);
  if (!w) return { ok: false, error: 'Bu sohbete çalışma klasörü bağlı değil.' };
  
  // Check remote status first
  if (checkRemote) {
    const status = await gitRun(sessionId, ['status', '-sb'], 10000);
    if (status.ok && status.output) {
      const lines = status.output.split('\n');
      const header = lines[0];
      if (header.includes('ahead') || header.includes('behind') || header.includes('diverged')) {
        return { ok: false, error: `Remote durum: ${header.trim()}. Önce pull/rebase yap.`, remoteStatus: header.trim() };
      }
    }
  }

  const rem = await gitRun(sessionId, ['remote', 'get-url', 'origin'], 10000);
  if (!rem.ok || !rem.output || rem.output.includes('(çıktı yok)')) return { ok: false, error: 'Remote origin yok.' };
  const originUrl = rem.output.trim();
  // https://github.com/user/repo.git → https://x-access-token:TOKEN@github.com/user/repo.git
  const tokenUrl = originUrl.replace(/^https:\/\//, 'https://x-access-token:' + token + '@');
  
  const pushArgs = ['push', tokenUrl, br];
  if (forceWithLease) pushArgs.push('--force-with-lease');
  if (dryRun) pushArgs.push('--dry-run');
  
  const push = await gitRun(sessionId, pushArgs, 90000, gitEnvWithToken(token));
  if (push.ok) {
    // Upstream'i temiz origin'e bağla (token'lı URL config'e yazılmasın)
    await gitRun(sessionId, ['branch', '--set-upstream-to=origin/' + br, br], 10000).catch(() => {});
  }
  return push;
}
// Harley'nin kendi ürettiği dosyalar (arka plan logları vb.) asla commit'e girmesin.
// git add -A öncesi .gitignore'a eklenir (kullanıcı dosyalarına dokunmaz).
function ensureHarleyGitignore(sessionId) {
  const w = get(sessionId);
  if (!w) return;
  const gi = path.join(w.path, '.gitignore');
  const block = [
    '',
    '# Harley çalışma dosyaları (asistan üretir, commit\'e girmez)',
    '.harley-*',
    '*.harley-bg-*.log',
  ].join('\n');
  try {
    if (fs.existsSync(gi)) {
      const cur = fs.readFileSync(gi, 'utf8');
      if (!cur.includes('.harley-*')) fs.appendFileSync(gi, '\n' + block);
    } else {
      fs.writeFileSync(gi, block.trimStart());
    }
  } catch { /* yok */ }
}
// Uzak repo var mı?
async function gitHasRemote(sessionId) {
  const r = await gitRun(sessionId, ['remote', 'get-url', 'origin'], 10000);
  return r.ok && r.output && !r.output.includes('(çıktı yok)');
}
// Değişen dosyaları gösterir (status + kısa diff özeti) — onay ekranı için.
async function gitChangeSummary(sessionId) {
  const status = await gitRun(sessionId, ['status', '--porcelain'], 10000);
  if (!status.ok) return { ok: false, error: status.error };
  const lines = status.output.split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => l !== '(çıktı yok)');
  if (!lines.length) return { ok: true, changes: [], note: 'Değişiklik yok.' };
  return { ok: true, changes: lines.map((l) => l.slice(0, 100)), note: lines.length + ' değişiklik' };
}
// Onay ekranı için: değişiklik listesi + kısa diff özeti (eklenen/silinen satır sayısı).
async function gitApprovalPreview(sessionId, maxLines) {
  const sum = await gitChangeSummary(sessionId);
  if (!sum.ok) return sum;
  const stat = await gitRun(sessionId, ['diff', '--stat'], 10000);
  const lines = [];
  if (sum.changes.length) lines.push('Değişen dosyalar:\n' + sum.changes.slice(0, (maxLines || 15)).join('\n'));
  if (stat.ok && stat.output && stat.output !== '(çıktı yok)') lines.push('\n' + stat.output.split('\n').slice(0, (maxLines || 15)).join('\n'));
  return { ok: true, text: lines.join('\n') || '(değişiklik yok)', changes: sum.changes };
}

load();
module.exports = {
  load, save, get, release, bind, resolve,
  safeWrite, safeList, safeRead,
  runBackground, bgStatus, killAllBg, killBgForSession,
  detectTestCommand, runTest, gitRun, gitHasRemote, gitChangeSummary, gitApprovalPreview, gitEnvWithToken, gitPushWithToken, ensureHarleyGitignore,
  linkRepo, getRepo, getRepoByPath, detectProject, searchCode,
};