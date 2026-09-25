// agent-evolution.js — "Agent Evolution": hangi skill kaç kez kullanıldı.
// JSON tabanlı hafif mağaza (native sqlite bağımlılığı eklemeden).
// Her kullanımdan sonra kullanıcıya kişiselleştirme önerisi üretebilir.

const fs = require('fs');
const path = require('path');
const { FILES } = require('./config');
const i18n = require('./i18n');
let I18N_EN = {};
try { I18N_EN = require('./locales.json').en || {}; } catch { I18N_EN = {}; }
function T(s, vars) {
  let out = (i18n.getLang() === 'en' && I18N_EN[s] !== undefined) ? I18N_EN[s] : s;
  if (vars) for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(String(vars[k]));
  return out;
}

const STORE_FILE = FILES.agentEvolution;

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch { /* sessiz */ }
}

// ---------- kayıt ----------
// skill: { name, kind, ts } — kind: 'tool' | 'local' | 'voice' | 'shortcut'
function recordUse(skillName, kind) {
  const store = readStore();
  const today = new Date().toISOString().slice(0, 10);
  const s = store.skills && store.skills[skillName];
  const entry = {
    total: (s && s.total || 0) + 1,
    last: Date.now(),
    day: today,
    days: s && s.days || {},
  };
  entry.days[today] = (entry.days[today] || 0) + 1;
  store.skills = store.skills || {};
  store.skills[skillName] = entry;
  // günlük toplam
  store.daily = store.daily || {};
  store.daily[today] = (store.daily[today] || 0) + 1;
  writeStore(store);
  return entry;
}

// ---------- istatistik ----------
function getStats() {
  const store = readStore();
  const skills = store.skills || {};
  const rows = Object.entries(skills)
    .map(([name, e]) => ({ name, total: e.total, last: e.last, day: e.day }))
    .sort((a, b) => b.total - a.total);
  const totalUses = rows.reduce((acc, r) => acc + r.total, 0);
  const today = new Date().toISOString().slice(0, 10);
  const todayUses = (store.daily && store.daily[today]) || 0;
  // son 7 gün
  const last7 = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    last7[d.slice(5)] = (store.daily && store.daily[d]) || 0;
  }
  return { rows, totalUses, todayUses, last7 };
}

// ---------- öneri ----------
// En çok kullanılan → shortcut önerisi; en az/az kullanılan → "kaldırmak ister misin?".
function suggestions() {
  const { rows, totalUses } = getStats();
  if (!rows.length) return [];
  const out = [];
  const top = rows[0];
  if (top.total >= 5) {
    out.push({
      type: 'shortcut',
      skill: top.name,
      text: T('"{skill}" becerisini {n} kez kullandın — bunun için bir kısayol ekleyebilirim.', { skill: top.name, n: top.total }),
    });
  }
  // nadir kullanılanlar (toplam kullanımın <1/20 si, ama en az 1)
  const rare = rows.filter((r) => r.total <= Math.max(1, Math.floor(totalUses / 25)));
  if (rare.length >= 2) {
    out.push({
      type: 'prune',
      skills: rare.slice(0, 3).map((r) => r.name),
      text: T('Bu becerileri neredeyse hiç kullanmadın: {list}. Kaldırmak ister misin?', { list: rare.slice(0, 3).map((r) => r.name).join(', ') }),
    });
  }
  return out;
}

module.exports = { recordUse, getStats, suggestions };
