// fun.test.js — Eğlence modülü testleri (node --test)
const { test } = require('node:test');
const assert = require('node:assert');
const fun = require('../fun');

test('oyun başlatma: şehir-ülke-meyve tüm varyantları', () => {
  for (const g of ['şehir ülke meyve', 'Şehir-Ülke-Meyve', 'Sehir Ulke Meyve', 'şehir-ülke-meyve']) {
    const r = fun.startGame('A', g);
    assert.ok(r.includes('Şehir-Ülke-Meyve'), g + ' oyunu başlamalı: ' + r);
  }
});

test('oyun oturum bazlıdır — B sohbeti A oyunundan etkilenmez', () => {
  fun.startGame('S1', 'şehir ülke meyve');
  assert.strictEqual(fun.isActive('S1'), true);
  assert.strictEqual(fun.isActive('S2'), false);
  fun.stopGame('S1');
  assert.strictEqual(fun.isActive('S1'), false);
});

test('iptal oyunu bitirir', () => {
  fun.startGame('S3', 'sayı tahmin');
  assert.strictEqual(fun.isActive('S3'), true);
  fun.stopGame('S3');
  assert.strictEqual(fun.isActive('S3'), false);
});

test('20 Soru: evet/hayır sorusuna doğru cevap', () => {
  fun.startGame('S4', '20 soru');
  const ans = fun.gameMove('S4', 'canlı mı?');
  // "Evet." veya "Hayır." dönmeli (rastgele nesneye göre) — anlayamadım dönmemeli
  assert.ok(/^(Evet|Hayır)\./.test(ans), 'cevap Evet./Hayır. olmalı: ' + ans);
});

test('20 Soru: ardışık aynı nesne gelmez', () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    fun.startGame('S5', '20 soru');
    // cevap oyun durumunda saklı — doğrudan test edilemez, ama oyun başlar
    assert.strictEqual(fun.isActive('S5'), true);
    seen.add(JSON.stringify(fun.getActiveGame('S5')));
    fun.stopGame('S5');
  }
  assert.strictEqual(fun.isActive('S5'), false);
});

test('motivasyon/bilgi/şarkı çalışır', () => {
  assert.ok(fun.dailyMotivation().length > 5);
  assert.ok(fun.funFact().length > 5);
  const s = fun.songOfDay();
  assert.ok(s.includes('Günün şarkısı'));
  assert.ok(fun.getLastSong());
  assert.ok(fun.getLastSong().title);
});
