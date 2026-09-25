// logger.test.js — Logger modül testleri
const { test } = require('node:test');
const assert = require('node:assert');
const { log, tail, LOG_FILE } = require('../logger');
const fs = require('fs');

test('log: farklı seviye ve kaynaklarla log yazılabilir', () => {
  log('info', 'test', 'test mesajı', { key: 'value' });
  log('warn', 'test', 'uyarı');
  log('error', 'test', 'hata');
  const entries = tail(10);
  assert.ok(entries.length >= 3, 'en az 3 log girişi olmalı');
  const info = entries.find((e) => e.message === 'test mesajı');
  assert.ok(info, 'info log bulunmalı');
  assert.strictEqual(info.level, 'info');
  assert.strictEqual(info.source, 'test');
  assert.deepStrictEqual(info.data, { key: 'value' });
});

test('tail: son N log döndürür', () => {
  const entries = tail(2);
  assert.ok(entries.length <= 2);
  assert.ok(entries.every((e) => e && e.ts && e.level));
});

test('log: dosya oluşur', () => {
  assert.ok(fs.existsSync(LOG_FILE), 'log dosyası var olmalı');
});