// logger.js — Yapılandırılmış JSON log sistemi.
// Tüm önemli olaylar tek bir JSONL dosyasına (her satır bir JSON) yazılır.
// hata ayıklama ve izleme için: Harleydosyalar/harley-events.log
// Kullanım: log('info', 'workspace', 'klasör bağlandı', { path });
const fs = require('fs');
const path = require('path');
const CFG = require('./config');

const LOG_FILE = path.join(CFG.HARLEY_DIR, 'harley-events.log');
const MAX_BYTES = 2 * 1024 * 1024; // 2MB dolunca döngüsel sar

function _rotateIfNeeded() {
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > MAX_BYTES) {
      fs.renameSync(LOG_FILE, LOG_FILE + '.1'); // eskiyi .1 yap, yeniye başla
    }
  } catch { /* dosya yok */ }
}

function log(level, source, message, data) {
  try {
    _rotateIfNeeded();
    const entry = {
      ts: new Date().toISOString(),
      level: level || 'info',
      source: source || 'app',
      message: String(message || ''),
      ...(data ? { data } : {}),
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch { /* sessiz — log hatası uygulamayı bozmasın */ }
}

// Kısa okuma: son N olay (hata ayıklama/IPC için)
function tail(n) {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-(n || 50)).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

module.exports = { log, tail, LOG_FILE };
