// self-improvement.js — Harley'nin kendi kendini iyileştirme motoru.
// Kullanıcı geri bildirimlerini takip eder, hangi tür sorularda başarılı/başarısız
// olduğunu öğrenir, davranış kalıplarını zamanla iyileştirir.

const fs = require('fs');
const path = require('path');

const FEEDBACK_FILE = path.join(process.env.USERPROFILE || '', 'HarleyDosyalar', 'feedback.json');
const PATTERNS_FILE = path.join(process.env.USERPROFILE || '', 'HarleyDosyalar', 'behavior-patterns.json');

function readFeedback() {
  try { return JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8')); } catch { return { entries: [], patterns: {} }; }
}
function writeFeedback(f) {
  try {
    fs.mkdirSync(path.dirname(FEEDBACK_FILE), { recursive: true });
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(f, null, 2), 'utf8');
  } catch { /* sessiz */ }
}

function readPatterns() {
  try { return JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf8')); } catch { return {}; }
}
function writePatterns(p) {
  try {
    fs.mkdirSync(path.dirname(PATTERNS_FILE), { recursive: true });
    fs.writeFileSync(PATTERNS_FILE, JSON.stringify(p, null, 2), 'utf8');
  } catch { /* sessiz */ }
}

// Soru kategorisi tespiti
function categorizeQuestion(text) {
  const t = String(text || '').toLowerCase();
  if (/kod|lua|roblox|script|function|class|module/i.test(t)) return 'kodlama';
  if (/oyun|obby|map|world|studio/i.test(t)) return 'roblox-studio';
  if (/hata|error|bug|çalışmıyor|bozuk/i.test(t)) return 'hata-cozme';
  if (/özetle|özet|analiz|incele/i.test(t)) return 'analiz';
  if (/hatırlat|görev|plan|yapılacak/i.test(t)) return 'organizasyon';
  if (/hava|saat|tarih|bugün/i.test(t)) return 'gunluk';
  if (/öner|tavsiye|ne yapsam|ne yapayım/i.test(t)) return 'oneri';
  return 'genel';
}

// Geri bildirim kaydet
function recordFeedback(messageText, responseText, rating, category) {
  const f = readFeedback();
  const cat = category || categorizeQuestion(messageText);
  const entry = {
    timestamp: Date.now(),
    category: cat,
    rating: rating, // 'good' | 'bad' | 'neutral'
    messageSnippet: String(messageText || '').slice(0, 100),
    responseSnippet: String(responseText || '').slice(0, 100),
  };
  f.entries.push(entry);
  // Son 200 geri bildirimi tut
  if (f.entries.length > 200) f.entries = f.entries.slice(-200);
  writeFeedback(f);
  // Kalıpları güncelle
  updatePatterns(f);
  return entry;
}

// Kalıpları güncelle
function updatePatterns(f) {
  const patterns = {};
  for (const e of f.entries) {
    const cat = e.category;
    if (!patterns[cat]) patterns[cat] = { good: 0, bad: 0, total: 0 };
    patterns[cat].total++;
    if (e.rating === 'good') patterns[cat].good++;
    if (e.rating === 'bad') patterns[cat].bad++;
  }
  // Her kategori için başarı oranını hesapla
  for (const cat of Object.keys(patterns)) {
    const p = patterns[cat];
    p.successRate = p.total > 0 ? Math.round((p.good / p.total) * 100) : 50;
    p.recentTrend = calculateTrend(f.entries.filter(e => e.category === cat).slice(-10));
  }
  writePatterns(patterns);
}

// Son 10 geri bildirimdeki trendi hesapla
function calculateTrend(recentEntries) {
  if (recentEntries.length < 3) return 'yeni';
  const recent = recentEntries.slice(-5);
  const good = recent.filter(e => e.rating === 'good').length;
  const bad = recent.filter(e => e.rating === 'bad').length;
  if (good > bad * 2) return 'mükemmel';
  if (good > bad) return 'iyi';
  if (bad > good * 2) return 'kötü';
  if (bad > good) return 'düşüşte';
  return 'stabil';
}

// İyileştirme önerileri al
function getSuggestions() {
  const patterns = readPatterns();
  const suggestions = [];
  for (const [cat, p] of Object.entries(patterns)) {
    if (p.successRate < 40 && p.total >= 5) {
      suggestions.push({
        category: cat,
        message: `${cat} kategorisinde başarı oranı düşük (%${p.successRate}). Farklı bir yaklaşım denemelisin.`,
        priority: 'high',
      });
    }
    if (p.recentTrend === 'düşüşte') {
      suggestions.push({
        category: cat,
        message: `${cat} kategorisinde son zamanlarda düşüş var. Daha dikkatli ol.`,
        priority: 'medium',
      });
    }
    if (p.recentTrend === 'mükemmel' && p.total >= 10) {
      suggestions.push({
        category: cat,
        message: `${cat} kategorisinde çok iyisin — bu tarz soruları daha hızlı çöz.`,
        priority: 'low',
      });
    }
  }
  return suggestions;
}

// İstatistikleri al
function getStats() {
  const f = readFeedback();
  const patterns = readPatterns();
  const total = f.entries.length;
  const good = f.entries.filter(e => e.rating === 'good').length;
  const bad = f.entries.filter(e => e.rating === 'bad').length;
  return {
    total,
    good,
    bad,
    neutral: total - good - bad,
    successRate: total > 0 ? Math.round((good / total) * 100) : 0,
    patterns,
    suggestions: getSuggestions(),
  };
}

module.exports = { recordFeedback, getStats, getSuggestions };
