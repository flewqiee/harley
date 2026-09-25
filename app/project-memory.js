// project-memory.js — Proje belleği: bilgisayardaki projeleri tanır,
// her biri için metadata tutar (teknolojiler, son değişen dosyalar, TODO'lar,
// son commit, durum). JSON tabanlı. LLM'e sürekli gönderilmez — sadece istendiğinde.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { FILES, USERPROFILE, DESKTOP_DIR, DOCUMENTS_DIR } = require('./config');

const STORE_FILE = FILES.projects;
// Kullanıcının günlük kullandığı klasörler (güvenli tarafta varsayılanlar)
const DEFAULT_ROOTS = [...new Set([
  process.cwd(),
  DESKTOP_DIR,
  DOCUMENTS_DIR,
  path.join(USERPROFILE, 'OneDrive', 'Masaüstü'),
  USERPROFILE,
])];

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch { /* sessiz */ }
}

// Bir klasörün git bilgisini çek (son commit, değişen dosyalar)
function gitInfo(dir) {
  return new Promise((resolve) => {
    if (!fs.existsSync(path.join(dir, '.git'))) return resolve(null);
    execFile('git', ['log', '-1', '--pretty=%h %s (%cr)'], { cwd: dir, windowsHide: true, timeout: 8000 }, (e1, logOut) => {
      execFile('git', ['status', '--short'], { cwd: dir, windowsHide: true, timeout: 8000 }, (e2, statusOut) => {
        // TODO taraması: yaygın TODO formatları
        let todos = [];
        try {
          const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') || f.endsWith('.txt'));
          for (const f of files.slice(0, 5)) {
            const txt = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 60000);
            const m = txt.match(/TODO[^\n]{0,80}|- \[ \][^\n]{0,80}/gi);
            if (m) todos = todos.concat(m.slice(0, 8));
          }
        } catch { /* yok */ }
        resolve({
          dir,
          name: path.basename(dir),
          lastCommit: e1 ? '' : logOut.trim(),
          changedFiles: e2 ? 0 : statusOut.trim().split('\n').filter(Boolean).length,
          todos: todos.slice(0, 5),
        });
      });
    });
  });
}

// Projeleri tara (kök klasörlerde git reposu olan dizinler)
async function scanProjects() {
  const store = readStore();
  const known = store.projects || {};
  const roots = store.roots && store.roots.length ? store.roots : DEFAULT_ROOTS;
  const found = [];
  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      // sadece git repo'su olanları proje say (ya da bilinenleri her zaman)
      if (fs.existsSync(path.join(dir, '.git')) || known[e.name]) {
        const info = await gitInfo(dir);
        if (info) found.push(info);
      }
    }
  }
  // Bilinen ama artık bulunamayanları koru
  for (const [name, meta] of Object.entries(known)) {
    if (!found.some((f) => f.name === name)) {
      found.push({ dir: meta.dir || '', name, lastCommit: (meta.lastCommit) || '', changedFiles: 0, todos: meta.todos || [], stale: true });
    }
  }
  const projects = {};
  for (const f of found) {
    projects[f.name] = { ...(known[f.name] || {}), ...f, lastSeen: Date.now() };
  }
  store.projects = projects;
  writeStore(store);
  return Object.values(projects).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

// Bir projenin kalıcı notlarını okuma/yazma (amaç, durum, teknolojiler, bug'lar)
function getProject(name) {
  const store = readStore();
  const p = store.projects && store.projects[name];
  return p || { name, notes: {} };
}

function setProjectNotes(name, notes) {
  const store = readStore();
  store.projects = store.projects || {};
  store.projects[name] = { ...(store.projects[name] || {}), name, notes: notes || {}, updatedAt: Date.now() };
  writeStore(store);
  return store.projects[name];
}

// GitHub repo URL'si kaydet ve commit tarihini hatırla (push istemez — sadece bilgi)
function setGithubRepo(name, url) {
  const store = readStore();
  store.projects = store.projects || {};
  store.projects[name] = { ...(store.projects[name] || {}), github: url };
  writeStore(store);
}

module.exports = { scanProjects, getProject, setProjectNotes, setGithubRepo, gitInfo };