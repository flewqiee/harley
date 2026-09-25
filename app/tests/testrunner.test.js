// testrunner.test.js — Test çalıştırıcı + pre-push gate uçtan uca testi.
// Gerçek bir geçici proje kurar, testleri çalıştırır ve gate'in
// başarısız testte push'u engellediğini doğrular.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const workspace = require('../workspace');
const testRunner = require('../test-runner');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-test-'));
const SESSION = 'tr-test-session';

function writeProject(failing) {
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
    name: 'tr-demo',
    version: '1.0.0',
    scripts: { test: 'node t.js' },
  }, null, 2));
  fs.writeFileSync(path.join(tmp, 't.js'), failing ? 'process.exit(1);\n' : 'process.exit(0);\n');
}

test.before(() => { workspace.bind(SESSION, tmp); });
test.after(() => { workspace.release(SESSION); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* yok */ } });

test('proje türü ve framework algılanır', () => {
  writeProject(false);
  assert.strictEqual(testRunner.detectProjectType(tmp), 'node');
  const fw = testRunner.detectTestFramework(tmp, 'node');
  assert.ok(fw, 'framework bulunmalı');
  assert.strictEqual(fw.name, 'npm test');
});

test('başarılı test: ok=true, gate push\'a izin verir', async () => {
  writeProject(false);
  const r = await testRunner.runTests(SESSION, { timeout: 60000 });
  assert.strictEqual(r.ok, true, 'test geçmeli: ' + (r.error || ''));
  const gate = await testRunner.prePushGate(SESSION, { strict: true, timeout: 60000 });
  assert.strictEqual(gate.allowPush, true, 'başarılı testte push serbest olmalı');
});

test('başarısız test: ok=false, gate push\'u engeller', async () => {
  writeProject(true);
  const r = await testRunner.runTests(SESSION, { timeout: 60000 });
  assert.strictEqual(r.ok, false, 'başarısız test ok=false dönmeli');
  const gate = await testRunner.prePushGate(SESSION, { strict: true, timeout: 60000 });
  assert.strictEqual(gate.allowPush, false, 'başarısız testte push engellenmeli');
});

test('strict=false iken başarısız test push\'u engellemez', async () => {
  writeProject(true);
  const gate = await testRunner.prePushGate(SESSION, { strict: false, timeout: 60000 });
  assert.strictEqual(gate.allowPush, true, 'strict=false ise uyarıya rağmen izin verir');
});

test('bağlı klasör yoksa gate güvenli hata döner', async () => {
  const r = await testRunner.runTests('olmayan-session', { timeout: 5000 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error, 'hata mesajı olmalı');
});
