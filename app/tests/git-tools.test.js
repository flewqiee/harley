// git-tools.test.js — Git araçlarının saf mantık testleri (ağ/onay yok).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const workspace = require('../workspace');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-'));
const repo = path.join(tmp, 'deneme-repo');

// Gerçek bir git repo kur (git kuruluysa)
function initRepo() {
  try {
    fs.mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repo, stdio: 'ignore' });
    fs.writeFileSync(path.join(repo, 'deneme.txt'), 'merhaba\n');
    execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'ilk'], { cwd: repo, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('gitChangeSummary: değişiklik yoksa boş dizi döner', async () => {
  if (!hasGit || !initRepo()) return; // git yoksa atla
  workspace.release('gt1');
  workspace.bind('gt1', repo);
  const r = await workspace.gitChangeSummary('gt1');
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.changes), 'changes dizi olmalı');
  // Temiz repo'da değişiklik olmamalı (git status --porcelain boş)
  assert.deepStrictEqual(r.changes.filter((c) => !c.startsWith('??')), []);
  workspace.release('gt1');
});

test('gitChangeSummary: yeni dosya eklenince değişiklik görünür', async () => {
  if (!hasGit || !initRepo()) return;
  workspace.release('gt1');
  workspace.bind('gt1', repo);
  fs.writeFileSync(path.join(repo, 'yeni.txt'), 'yeni içerik\n');
  const r = await workspace.gitChangeSummary('gt1');
  assert.strictEqual(r.ok, true);
  assert.ok(r.changes.some((c) => c.includes('yeni.txt')), 'yeni.txt değişikliklerde olmalı');
  // Temizle
  fs.unlinkSync(path.join(repo, 'yeni.txt'));
  workspace.release('gt1');
});

test('gitHasRemote: remote yokken false', async () => {
  if (!hasGit || !initRepo()) return;
  workspace.release('gt1');
  workspace.bind('gt1', repo);
  const r = await workspace.gitHasRemote('gt1');
  assert.strictEqual(r, false);
  workspace.release('gt1');
});

test('gitHasRemote: remote eklenince true', async () => {
  if (!hasGit || !initRepo()) return;
  workspace.release('gt1');
  workspace.bind('gt1', repo);
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/x/y.git'], { cwd: repo, stdio: 'ignore' });
  const r = await workspace.gitHasRemote('gt1');
  assert.strictEqual(r, true);
  execFileSync('git', ['remote', 'remove', 'origin'], { cwd: repo, stdio: 'ignore' });
  workspace.release('gt1');
});

test('git branch: oluştur + listele + geç', async () => {
  if (!hasGit || !initRepo()) return;
  workspace.release('gt1');
  workspace.bind('gt1', repo);
  const c1 = await workspace.gitRun('gt1', ['branch', 'test-dal']);
  assert.strictEqual(c1.ok, true);
  const l = await workspace.gitRun('gt1', ['branch']);
  assert.ok(l.output.includes('test-dal'), 'test-dal listelenmeli');
  const sw = await workspace.gitRun('gt1', ['checkout', 'test-dal']);
  assert.strictEqual(sw.ok, true);
  const cur = await workspace.gitRun('gt1', ['branch', '--show-current']);
  assert.strictEqual(cur.output.trim(), 'test-dal');
  // Temizle
  await workspace.gitRun('gt1', ['checkout', 'main']);
  await workspace.gitRun('gt1', ['branch', '-D', 'test-dal']);
  workspace.release('gt1');
});

test('repo link: klasöre repo bağla, farklı sohbetten de görünür', () => {
  workspace.release('gt1');
  workspace.release('gt2');
  workspace.bind('gt1', repo);
  workspace.linkRepo('gt1', 'test-repo', 'https://github.com/x/test-repo.git', false, 'x');
  // gt1'i serbest bırak, gt2 aynı klasöre bağlanabilsin (mutual exclusion)
  workspace.release('gt1');
  workspace.bind('gt2', repo);
  const g = workspace.getRepo('gt2');
  assert.ok(g, 'farklı sohbet repo görmeli');
  assert.strictEqual(g.name, 'test-repo');
  workspace.release('gt2');
});

test('gitEnvWithToken: prompt kapatır, token komut satırına yazılmaz', () => {
  const env = workspace.gitEnvWithToken('ghp_test');
  assert.strictEqual(env.GIT_TERMINAL_PROMPT, '0');
  assert.ok(!JSON.stringify(env).includes('ghp_test'), 'token env içinde ham halde olmamalı');
});
