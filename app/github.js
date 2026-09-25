// github.js — GitHub OKUMA entegrasyonu.
// Token dosyası varsa: repo listesi, son commit, diff, açık issue sayısı okunur.
// KURAL: Bu modül ASLA yazma isteği atmaz (commit/push/create yok).
// GitHub'a herhangi bir değişiklik yapmadan önce kullanıcıya sorulur.

const fs = require('fs');
const https = require('https');
const path = require('path');
const { FILES } = require('./config');

const TOKEN_FILE = FILES.githubToken;

function getToken() {
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    return t || null;
  } catch {
    return null;
  }
}

function api(route, opts = {}) {
  // GitHub istek sayacı: usage.json'a "github" bölümüne kaydedilir (görsel takip için)
  try {
    const uf = path.join(process.env.USERPROFILE || '', 'HarleyDosyalar', 'usage.json');
    let u = { github: { count: 0, today: 0, lastDay: '' }, githubDays: {} };
    try { u = JSON.parse(fs.readFileSync(uf, 'utf8')); } catch { /* yok */ }
    const g = u.github || { count: 0, today: 0, lastDay: '' };
    const today = new Date().toISOString().slice(0, 10);
    g.count = (g.count || 0) + 1;
    g.today = g.lastDay === today ? (g.today || 0) + 1 : 1;
    g.lastDay = today;
    u.github = g;
    const gd = u.githubDays || {};
    gd[today] = (gd[today] || 0) + 1;
    u.githubDays = gd;
    fs.writeFileSync(uf, JSON.stringify(u, null, 2), 'utf8');
  } catch { /* sessiz */ }
  return new Promise((resolve) => {
    const token = getToken();
    if (!token) return resolve({ error: 'no-token' });
    const body = opts.body ? JSON.stringify(opts.body) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: route,
        method: opts.method || 'GET',
        headers: {
          'User-Agent': 'Harley-Assistant',
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let j = null;
          try { j = JSON.parse(data); } catch { /* ham metin */ }
          if (res.statusCode >= 400) return resolve({ error: 'api', status: res.statusCode, message: (j && j.message) || data.slice(0, 200) });
          resolve(j);
        });
      },
    );
    req.on('error', (e) => resolve({ error: 'network', message: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    if (body) req.write(body);
    req.end();
  });
}

// GitHub kullanıcı bilgisi (login adı — remote URL için gerekir)
async function getUser() {
  const j = await api('/user');
  if (j.error) return j;
  return { login: j.login, name: j.name || '', public_repos: j.public_repos, avatar: j.avatar_url };
}

// Yeni repo oluştur (kullanıcı onayından sonra çağrılır)
// auto_init FALSE: GitHub'da BOŞ repo oluşturulur — README/commit OLUŞTURULMAZ.
// Böylece yereldeki ilk commit ile uzak geçmiş çakışmaz (non-fast-forward hatası olmaz).
async function createRepo({ name, description, private: isPrivate }) {
  const n = String(name || '').trim().replace(/\s+/g, '-');
  if (!/^[a-zA-Z0-9._-]+$/.test(n)) return { error: 'Geçersiz repo adı: ' + name + ' (harf, rakam, -, _, . kullan) ' };
  const j = await api('/user/repos', {
    method: 'POST',
    body: { name: n, description: String(description || '').trim() || undefined, private: !!isPrivate, auto_init: false },
  });
  if (j.error) return j;
  return { ok: true, name: n, full_name: j.full_name, clone_url: j.clone_url, html_url: j.html_url };
}

// Kullanıcının repoları (son güncellenene göre)
async function listRepos() {
  const j = await api('/user/repos?sort=updated&per_page=30&affiliation=owner,collaborator');
  if (!Array.isArray(j)) return j;
  return j.map((r) => ({
    name: r.full_name,
    desc: r.description || '',
    updated: r.updated_at,
    language: r.language || '',
    private: r.private,
    pushed: r.pushed_at,
  }));
}

// Tek repo: son commit + açık issue sayısı + branch
async function repoStatus(fullName) {
  const repo = await api('/repos/' + fullName);
  if (!repo || repo.error) return repo || { error: 'api' };
  const branch = repo.default_branch || 'main';
  const [commits, issues] = await Promise.all([
    api('/repos/' + fullName + '/commits?per_page=3'),
    api('/repos/' + fullName + '/issues?state=open&per_page=1'),
  ]);
  return {
    name: repo.full_name,
    desc: repo.description || '',
    defaultBranch: branch,
    private: repo.private,
    pushed: repo.pushed_at,
    lastCommits: Array.isArray(commits)
      ? commits.map((c) => ({
          sha: c.sha.slice(0, 7),
          message: (c.commit && c.commit.message || '').split('\n')[0],
          date: c.commit && c.commit.author && c.commit.author.date,
        }))
      : [],
    openIssues: Array.isArray(issues) ? issues.length : 0,
  };
}

// Son commit'in diff'i (okuma amaçlı, max ~40KB)
async function repoDiff(fullName) {
  const s = await repoStatus(fullName);
  if (s.error) return s;
  const j = await api('/repos/' + fullName + '/commits?per_page=1');
  if (!Array.isArray(j) || !j.length) return { error: 'api', message: 'commit yok' };
  const sha = j[0].sha;
  const diff = await api('/repos/' + fullName + '/compare/' + sha + '~1...' + sha);
  if (diff.error) return diff;
  const files = (diff.files || []).map((f) => ({
    file: f.filename,
    status: f.status,
    add: f.additions,
    del: f.deletions,
    patch: (f.patch || '').slice(0, 1200),
  }));
  return {
    sha: sha.slice(0, 7),
    message: (j[0].commit && j[0].commit.message || '').split('\n')[0],
    totalAdd: diff.total_commits >= 0 ? (diff.files || []).reduce((a, f) => a + f.additions, 0) : 0,
    totalDel: diff.files ? diff.files.reduce((a, f) => a + f.deletions, 0) : 0,
    files: files.slice(0, 10),
    truncated: files.length > 10,
  };
}

// Durum bilgisi: token var mı?
function config() {
  return { hasToken: !!getToken(), tokenFile: TOKEN_FILE };
}

module.exports = { listRepos, repoStatus, repoDiff, config, getToken, getUser, createRepo, api };
