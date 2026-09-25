// i18n.js — Dil tespiti (TR/EN). Ayar dosyasından okur; yoksa sistem diline bakar.
// Çeviri sözlüğü app/locales.json'da (hem main hem preload okur).
const fs = require('fs');
const path = require('path');

function settingsLang() {
  try {
    const { app } = require('electron');
    const p = path.join(app.getPath('userData'), 'settings.json');
    const s = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (s.language === 'en' || s.language === 'tr') return s.language;
  } catch { /* yok */ }
  return null; // 'auto' veya ayar yok → sistem
}

function systemLang() {
  try {
    const { app } = require('electron');
    const l = String(app.getLocale() || '').toLowerCase();
    return l.startsWith('en') ? 'en' : 'tr';
  } catch { return 'tr'; }
}

function getLang() { return settingsLang() || systemLang(); }

module.exports = { getLang, systemLang, settingsLang };
