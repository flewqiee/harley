// secure-store.js — Anahtar/kimlik dosyalarını işletim sistemi şifrelemesiyle saklar.
// Electron'un safeStorage API'si Windows'ta DPAPI kullanır: dosya başka bir kullanıcıya
// ya da makineye taşınırsa çözülemez. Electron dışında (test/CLI) çalışırken düz metne düşer.
//
// Geriye dönük uyum: eski düz-metin dosyalar okunmaya devam eder. Kaydedince şifreli yazılır.
// Şifreli dosya formatı: { "__enc": true, "data": "<base64>" }
const fs = require('fs');
const path = require('path');

let safeStorage = null;
try { safeStorage = require('electron').safeStorage; } catch { safeStorage = null; }

function available() {
  try { return !!(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()); }
  catch { return false; }
}

function decrypt(raw) {
  const j = JSON.parse(raw);
  if (j && j.__enc === true && typeof j.data === 'string') {
    if (!available()) throw new Error('encrypted');
    return safeStorage.decryptString(Buffer.from(j.data, 'base64'));
  }
  return null; // düz metin
}

function encryptToFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (available()) {
    const data = safeStorage.encryptString(text).toString('base64');
    fs.writeFileSync(file, JSON.stringify({ __enc: true, data }), 'utf8');
  } else {
    fs.writeFileSync(file, text, 'utf8');
  }
}

// JSON oku (şifreli veya düz). Hata/şifre çözülememe durumunda {} döner.
function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  try {
    const plain = decrypt(raw);
    return JSON.parse(plain === null ? raw : plain);
  } catch { return {}; }
}

function readText(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  try {
    const plain = decrypt(raw);
    return plain === null ? raw : plain;
  } catch { return ''; }
}

function writeJson(file, obj) {
  encryptToFile(file, JSON.stringify(obj, null, 2));
  return true;
}

function writeText(file, text) {
  encryptToFile(file, String(text == null ? '' : text));
  return true;
}

// Dosya şifreli mi? (healthcheck / teşhis için)
function isEncrypted(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return !!(j && j.__enc === true); } catch { return false; }
}

module.exports = { readJson, writeJson, readText, writeText, isEncryptionAvailable: available, isEncrypted };
