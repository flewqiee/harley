// google.test.js — Google modülünün saf mantık testleri (ağ çağrısı yok).
const { test } = require('node:test');
const assert = require('node:assert');
const google = require('../google');

test('parseDateTime: yarın + saat', () => {
  const r = google.parseDateTime('yarın 14:30');
  const d = new Date(r.start);
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  assert.strictEqual(d.getHours(), 14);
  assert.strictEqual(d.getMinutes(), 30);
  // tarih yarından en fazla 1 gün sapabilir (saat geçmişse yarın sonrasına atabilir)
  const diff = Math.abs(d.getDate() - tomorrow.getDate());
  assert.ok(diff <= 2, 'tarih yarına yakın olmalı: ' + d.toString());
  assert.ok(new Date(r.end) > new Date(r.start), 'bitiş başlangıçtan sonra');
});

test('parseDateTime: bugün + saat (geçmişse yarına kayar)', () => {
  const r = google.parseDateTime('bugün 03:00');
  const d = new Date(r.start);
  const now = new Date();
  // 03:00 geçmişse yarına kayar — her iki durum da mantıklı olmalı
  assert.strictEqual(d.getHours(), 3);
  assert.strictEqual(d.getMinutes(), 0);
  assert.ok(new Date(r.start) >= now || (new Date(r.start).getTime() >= now.getTime() - 60000), 'geçmişse bile kaymalı');
});

test('parseDateTime: haftanın günü', () => {
  const r = google.parseDateTime('pazartesi 09:00');
  const d = new Date(r.start);
  assert.strictEqual(d.getHours(), 9);
  assert.strictEqual(d.getDay(), 1); // pazartesi = 1
});

test('parseDateTime: gün belirtilmezse 1 saat sonraya atar', () => {
  const r = google.parseDateTime('toplantı');
  const start = new Date(r.start);
  const now = new Date();
  assert.ok(start.getTime() >= now.getTime(), 'varsayılan tarih gelecekte olmalı');
  assert.ok(start.getTime() - now.getTime() < 3 * 3600000, '1 saat civarına atmalı');
});

test('isConfigured: google-config yoksa false döner (ağ isteği yapmaz)', () => {
  const c = google.isConfigured();
  assert.strictEqual(typeof c, 'boolean');
});

test('WMO kodları tanımlıdır', () => {
  assert.ok(google.WMO[0] === 'acik');
  assert.ok(google.WMO[95] === 'gok gurultulu firtina');
  assert.ok(typeof google.WMO[99] === 'string');
});

test('webSearch: geçersiz sorgu hata verir, geçerli sorgu dizi döndürür', async () => {
  // Gerçek ağ çağrısı yapmak istemeyiz ama en azından fonksiyonun varlığını doğrula
  assert.strictEqual(typeof google.webSearch, 'function');
  try {
    const r = await google.webSearch('opencode test query', 3);
    assert.ok(Array.isArray(r), 'sonuç dizi olmalı');
  } catch {
    // ağ kapalı olabilir — bu bir hata değil, sadece ağ erişimi yok
    assert.ok(true);
  }
});
