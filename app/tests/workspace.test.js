// workspace.test.js — Workspace güvenlik + bağlama testleri
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const workspace = require('../workspace');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
const base = path.join(tmp, 'proje');
fs.mkdirSync(base, { recursive: true });

// workspace modülü HARLEY_DIR kullanıyor; test izolasyonu için dosya yolunu geçiciye işaret etmek
// yerine modülün kendi yollarını kullanırız ama gerçek kullanıcı dosyasını bozmamak için
// yalnızca bağlama + yol güvenliğini test ederiz.

test('path traversal engellenir', () => {
  workspace.release('test1');
  workspace.bind('test1', base);
  const r1 = workspace.resolve('test1', '../dışarı/dosya.js');
  assert.strictEqual(r1.err, 'İzin yok: dosya çalışma klasörünün dışında.');
  const r2 = workspace.resolve('test1', 'C:/Windows/system32/x.dll');
  assert.ok(r2.err, 'mutlak dış yol engellenmeli');
  const ok = workspace.resolve('test1', 'src/app.js');
  assert.strictEqual(ok.err, undefined);
  assert.ok(ok.target.startsWith(path.resolve(base) + path.sep));
});

test('yazma + okuma döngüsü', () => {
  workspace.release('test1');
  workspace.bind('test1', base);
  const w = workspace.safeWrite('test1', 'sub/deneme.txt', 'Merhaba');
  assert.strictEqual(w.ok, true);
  assert.strictEqual(w.relative, path.join('sub', 'deneme.txt'));
  const r = workspace.safeRead('test1', 'sub/deneme.txt');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.content, 'Merhaba');
});

test('liste çalışır', () => {
  const l = workspace.safeList('test1', '');
  assert.strictEqual(l.ok, true);
  assert.ok(l.items.some((x) => x.name === 'sub' && x.isDir));
});

test('mutual exclusion: aynı klasör iki session\'a bağlanamaz', () => {
  workspace.release('test1');
  workspace.release('test2');
  workspace.bind('test1', base);
  const r = workspace.bind('test2', base);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'already_bound');
});

test('release sonrası klasör tekrar bağlanabilir', () => {
  workspace.release('test1');
  const r = workspace.bind('test2', base);
  assert.strictEqual(r.ok, true);
  workspace.release('test2');
});

test('repo link: klasöre kalıcı repo bağlanır ve okunur', () => {
  workspace.release('test1');
  workspace.bind('test1', base);
  const r = workspace.linkRepo('test1', 'ornek-repo', 'https://github.com/flewqiee/ornek-repo.git', true, 'flewqiee');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.name, 'ornek-repo');
  const g = workspace.getRepo('test1');
  assert.ok(g, 'getRepo repo döndürmeli');
  assert.strictEqual(g.name, 'ornek-repo');
  assert.strictEqual(g.private, true);
});

test('repo link: bağlı olmayan sohbet için repo yok', () => {
  const g = workspace.getRepo('hic-baglanmamis');
  assert.strictEqual(g, null);
});

test('gitChangeSummary: bağlı değilse ok:false döner (crash yok)', async () => {
  const r = await workspace.gitChangeSummary('hic-baglanmamis');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test('gitChangeSummary: git repo olmayan klasörde hata değil boş değişiklik olabilir', async () => {
  workspace.release('test1');
  workspace.bind('test1', base);
  const r = await workspace.gitChangeSummary('test1');
  // Git repo yoksa "not a git repository" hatası gelebilir — ama crash/throw olmamalı
  assert.ok(r.ok === false || Array.isArray(r.changes));
  workspace.release('test1');
});

test('searchCode (RAG): eşleşen dosyayı bulur ve snippet döndürür', () => {
  // RAG için geçici bir proje klasörü kur
  const proj = path.join(tmp, 'rag-proje');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'login.js'), 'function login(user) {\n  return checkPassword(user);\n}\n');
  fs.writeFileSync(path.join(proj, 'src', 'app.js'), 'const a = 1;\n');
  workspace.release('rag1');
  workspace.bind('rag1', proj);
  const r = workspace.searchCode('rag1', 'login');
  assert.strictEqual(r.ok, true);
  assert.ok(r.items.length >= 1, 'login araması sonuç dönmeli');
  const hit = r.items.find((x) => x.file.endsWith('login.js'));
  assert.ok(hit, 'login.js bulunmalı');
  assert.ok(hit.snippet.includes('login'), 'snippet içerik içermeli');
  workspace.release('rag1');
});

test('searchCode (RAG): node_modules ve eşleşmeyen sorgulara boş döner', () => {
  const proj = path.join(tmp, 'rag-proje2');
  fs.mkdirSync(path.join(proj, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'node_modules', 'dep.js'), 'function login() {}\n');
  fs.writeFileSync(path.join(proj, 'src', 'app.js'), 'const x = 42;\n');
  workspace.release('rag2');
  workspace.bind('rag2', proj);
  // node_modules atlanmalı, src aranmalı
  const r1 = workspace.searchCode('rag2', 'login');
  assert.strictEqual(r1.ok, true);
  assert.ok(!r1.items.some((x) => x.file.includes('node_modules')), 'node_modules atlanmalı');
  // eşleşmeyen sorgu boş
  const r2 = workspace.searchCode('rag2', 'zzzz_nonexistent');
  assert.strictEqual(r2.items.length, 0);
  workspace.release('rag2');
});
