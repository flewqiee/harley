// personalization.js — Privacy-first user profile with style adaptation & routine learning.
// All sensitive data encrypted at rest. Local-only, no cloud sync.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FILES, HARLEY_DIR } = require('./config');

const PROFILE_FILE = path.join(HARLEY_DIR, 'profile.enc');
const ROUTINE_FILE = path.join(HARLEY_DIR, 'routine.enc');
const STYLE_FILE = path.join(HARLEY_DIR, 'style.enc');
const SALT_FILE = path.join(HARLEY_DIR, '.harley-salt');
const KEY_FILE = path.join(HARLEY_DIR, '.harley-key');

let encryptionKey = null;
let salt = null;

function ensureCrypto() {
  if (encryptionKey) return encryptionKey;
  try {
    salt = fs.readFileSync(SALT_FILE);
  } catch {
    salt = crypto.randomBytes(16);
    fs.writeFileSync(SALT_FILE, salt);
  }
  try {
    const stored = fs.readFileSync(KEY_FILE);
    encryptionKey = crypto.scryptSync(stored, salt, 32);
  } catch {
    const passphrase = crypto.randomBytes(32).toString('hex');
    encryptionKey = crypto.scryptSync(passphrase, salt, 32);
    fs.writeFileSync(KEY_FILE, passphrase);
  }
  return encryptionKey;
}

function encrypt(data) {
  const key = ensureCrypto();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(data);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function decrypt(encoded) {
  if (!encoded) return null;
  try {
    const key = ensureCrypto();
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.slice(0, 12);
    const authTag = buf.slice(12, 28);
    const ciphertext = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    return null;
  }
}

function loadEncrypted(filePath, defaultValue = {}) {
  try {
    const enc = fs.readFileSync(filePath, 'utf8').trim();
    return decrypt(enc) || defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveEncrypted(filePath, data) {
  try {
    fs.writeFileSync(filePath, encrypt(data), 'utf8');
    return true;
  } catch (e) {
    console.error('[personalization] save error:', e.message);
    return false;
  }
}

// ---------- Profile System ----------
const DEFAULT_PROFILE = {
  version: 1,
  name: '',
  address: '',
  timezone: 'Europe/Istanbul',
  language: 'tr',
  responseStyle: 'orta', // 'kisa' | 'orta' | 'detayli'
  emoji: false,
  codeStyle: {
    indent: 2,
    quotes: 'single',
    semicolons: true,
    trailingComma: 'es5',
    maxLineLength: 100,
    framework: 'auto', // auto-detect from project
    comments: 'minimal', // 'none' | 'minimal' | 'jsdoc' | 'verbose'
  },
  writingStyle: {
    tone: 'professional-friendly', // 'formal' | 'professional-friendly' | 'casual' | 'technical'
    verbosity: 'balanced', // 'concise' | 'balanced' | 'verbose'
    structure: 'direct', // 'direct' | 'guided' | 'reference'
  },
  preferences: {
    autoRunTests: true,
    confirmBeforePush: true,
    morningBriefing: true,
    emailNotifications: false,
    focusModeDefault: 25,
    theme: 'system',
  },
  interests: [], // learned from conversations
  contacts: {}, // name -> { email, github, role }
  projects: {}, // name -> { path, stack, lastWorked, notes }
  learnedFacts: [], // key-value facts from conversations
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function loadProfile() {
  return loadEncrypted(PROFILE_FILE, { ...DEFAULT_PROFILE });
}

function saveProfile(profile) {
  profile.updatedAt = Date.now();
  return saveEncrypted(PROFILE_FILE, profile);
}

function updateProfile(updates) {
  const profile = loadProfile();
  const merged = deepMerge(profile, updates);
  return saveProfile(merged);
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ---------- Style Adaptation ----------
function adaptCodeStyle(filePath, content) {
  const profile = loadProfile();
  const style = profile.codeStyle;
  const ext = path.extname(filePath).toLowerCase();

  let adapted = content;

  // Indentation
  if (style.indent !== 2) {
    const spaces = ' '.repeat(style.indent);
    adapted = adapted.replace(/^  /gm, spaces);
  }

  // Quotes (JS/TS/JSX/TSX)
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
    if (style.quotes === 'single') {
      adapted = adapted.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (m, inner) => `'${inner.replace(/'/g, "\\'")}'`);
    } else if (style.quotes === 'double') {
      adapted = adapted.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, (m, inner) => `"${inner.replace(/"/g, '\\"')}"`);
    }
  }

  // Semicolons (JS/TS)
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
    if (!style.semicolons) {
      adapted = adapted.replace(/;\s*$/gm, '');
    } else {
      // Add missing semicolons (basic)
      adapted = adapted.replace(/([^;{}\s])\s*$/gm, '$1;');
    }
  }

  // Trailing commas (JS/TS/JSON)
  if (['.js', '.jsx', '.ts', '.tsx', '.json'].includes(ext) && style.trailingComma === 'es5') {
    adapted = adapted.replace(/,\s*}/g, ' }').replace(/{\s*}/g, '{ }');
    adapted = adapted.replace(/([^,{}]),\s*]/g, '$1, ]');
  }

  return adapted;
}

function getResponseStylePrompt() {
  const profile = loadProfile();
  const style = profile.responseStyle;
  const writing = profile.writingStyle;

  const styleMap = {
    kisa: 'Kısa ve öz cevaplar ver. Gereksiz açıklama yapma. Kod istenirse sadece kodu ver.',
    orta: 'Dengeli cevaplar ver. Kod için kısa açıklama ekle. Sohbet için samimi ama net ol.',
    detayli: 'Kapsamlı cevaplar ver. Nedenleri açıkla, alternatifleri sun, örnek ver.',
  };

  const toneMap = {
    formal: 'Resmi, saygılı ton.',
    'professional-friendly': 'Profesyonel ama samimi ton.',
    casual: 'Günlük konuşma dili, rahat ton.',
    technical: 'Teknik, präzise ton.',
  };

  const verbosityMap = {
    concise: 'Minimum kelimeyle anlat.',
    balanced: 'Gerektiğinde detayla, gereksiz yere uzatma.',
    verbose: 'Detaylı anlat, bağlam ver, örneklerle destekle.',
  };

  return `
## KİŞİSEL TARZ AYARLARI
- Cevap stili: ${styleMap[style] || styleMap.orta}
- Ton: ${toneMap[writing.tone] || toneMap['professional-friendly']}
- Ayrıntı seviyesi: ${verbosityMap[writing.verbosity] || verbosityMap.balanced}
- Yapı: ${writing.structure === 'direct' ? 'Doğrudan cevap ver, giriş yapma.' : writing.structure === 'guided' ? 'Adım adım rehberle.' : 'Referans kartı gibi özetle.'}
${profile.emoji === false ? '- EMOTİKON KULLANMA — hiçbir cevapta emoji yok.' : ''}
${profile.codeStyle.comments === 'jsdoc' ? '- Kodda JSDoc yorumları ekle.' : ''}
${profile.codeStyle.comments === 'verbose' ? '- Kodda kapsamlı yorumlar ekle (neden, nasıl, örnek).' : ''}
`;
}

// ---------- Routine Learning ----------
const DEFAULT_ROUTINE = {
  version: 1,
  workHours: { start: 9, end: 18 }, // learned
  activeHours: {}, // hour -> count
  projectPatterns: {}, // projectName -> { hours: [], days: [], duration: [] }
  commandPatterns: {}, // command -> { count, lastUsed, contexts: [] }
  breakPatterns: {}, // hour -> { taken: count, skipped: count }
  weeklyPattern: {}, // dayOfWeek -> { activeHours: [], projects: [] }
  lastUpdated: Date.now(),
};

function loadRoutine() {
  return loadEncrypted(ROUTINE_FILE, { ...DEFAULT_ROUTINE });
}

function saveRoutine(routine) {
  routine.lastUpdated = Date.now();
  return saveEncrypted(ROUTINE_FILE, routine);
}

function recordActivity(type, data) {
  const routine = loadRoutine();
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sunday

  if (type === 'command') {
    const cmd = data.command;
    if (!routine.commandPatterns[cmd]) routine.commandPatterns[cmd] = { count: 0, lastUsed: 0, contexts: [] };
    routine.commandPatterns[cmd].count++;
    routine.commandPatterns[cmd].lastUsed = Date.now();
    if (data.context && !routine.commandPatterns[cmd].contexts.includes(data.context)) {
      routine.commandPatterns[cmd].contexts.push(data.context);
    }
  } else if (type === 'project') {
    const proj = data.project;
    if (!routine.projectPatterns[proj]) routine.projectPatterns[proj] = { hours: [], days: [], durations: [] };
    routine.projectPatterns[proj].hours.push(hour);
    routine.projectPatterns[proj].days.push(day);
    if (data.duration) routine.projectPatterns[proj].durations.push(data.duration);
    // Keep last 100 entries
    for (const k of ['hours', 'days', 'durations']) {
      if (routine.projectPatterns[proj][k].length > 100) routine.projectPatterns[proj][k].shift();
    }
  } else if (type === 'session_start') {
    routine.activeHours[hour] = (routine.activeHours[hour] || 0) + 1;
    if (!routine.weeklyPattern[day]) routine.weeklyPattern[day] = { activeHours: [], projects: [] };
    routine.weeklyPattern[day].activeHours.push(hour);
  } else if (type === 'break') {
    routine.breakPatterns[hour] = routine.breakPatterns[hour] || { taken: 0, skipped: 0 };
    routine.breakPatterns[hour][data.taken ? 'taken' : 'skipped']++;
  }

  saveRoutine(routine);
}

function getRoutineInsights() {
  const routine = loadRoutine();
  const insights = [];

  // Most active hour
  const activeHours = Object.entries(routine.activeHours).sort((a, b) => b[1] - a[1]);
  if (activeHours.length) {
    insights.push(`En aktif saatlerin: ${activeHours.slice(0, 3).map(([h, c]) => `${h}:00 (${c}x)`).join(', ')}`);
  }

  // Project patterns
  for (const [proj, data] of Object.entries(routine.projectPatterns)) {
    if (data.hours.length > 10) {
      const freq = {};
      for (const h of data.hours) freq[h] = (freq[h] || 0) + 1;
      const topHour = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
      insights.push(`"${proj}" projesinde genellikle saat ${topHour[0]}:00 civarında çalışıyorsun.`);
    }
  }

  // Command suggestions
  const topCmds = Object.entries(routine.commandPatterns)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);
  if (topCmds.length) {
    insights.push(`En çok kullandığın komutlar: ${topCmds.map(([c, d]) => `${c} (${d.count}x)`).join(', ')}`);
  }

  // Work hour estimation
  if (activeHours.length > 20) {
    const hours = activeHours.map(([h]) => parseInt(h)).filter(h => h >= 6 && h <= 22);
    if (hours.length) {
      const start = Math.min(...hours);
      const end = Math.max(...hours);
      if (start !== routine.workHours.start || end !== routine.workHours.end) {
        routine.workHours = { start, end };
        saveRoutine(routine);
        insights.push(`Çalışma saatlerin tahmini: ${start}:00 - ${end}:00`);
      }
    }
  }

  return insights;
}

function getProactiveSuggestion() {
  const routine = loadRoutine();
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();

  // Suggest project based on time
  for (const [proj, data] of Object.entries(routine.projectPatterns)) {
    if (data.hours.includes(hour) && data.days.includes(day)) {
      return `Bu saatlerde genellikle "${proj}" üzerinde çalışıyorsun. Devam edelim mi?`;
    }
  }

  // Suggest break
  if (routine.breakPatterns[hour] && routine.breakPatterns[hour].skipped > 3) {
    return `Saat ${hour}:00'da genellikle mola vermiyorsun. 5 dakika mola verebilirsin.`;
  }

  // Morning briefing
  if (hour === 8 && routine.weeklyPattern[day]?.activeHours?.includes(8)) {
    return 'Günaydın! Bugünün planını gözden geçirelim mi?';
  }

  return null;
}

// ---------- Style Learning from Feedback ----------
function learnFromFeedback(userMessage, assistantResponse, rating) {
  const profile = loadProfile();

  if (rating >= 4) {
    // Positive - reinforce patterns
    if (assistantResponse.length < 500 && profile.responseStyle !== 'kisa') {
      profile.responseStyle = 'kisa';
    }
    if (assistantResponse.includes('```') && profile.codeStyle.comments === 'none') {
      profile.codeStyle.comments = 'minimal';
    }
  } else if (rating <= 2) {
    // Negative - adjust
    if (assistantResponse.length > 2000 && profile.responseStyle !== 'detayli') {
      profile.responseStyle = 'detayli';
    }
    if (!assistantResponse.includes('```') && userMessage.includes('kod')) {
      profile.codeStyle.comments = 'jsdoc';
    }
  }

  saveProfile(profile);
}

// ---------- Export for IPC ----------
module.exports = {
  loadProfile,
  saveProfile,
  updateProfile,
  getResponseStylePrompt,
  adaptCodeStyle,
  loadRoutine,
  saveRoutine,
  recordActivity,
  getRoutineInsights,
  getProactiveSuggestion,
  learnFromFeedback,
  encrypt,
  decrypt,
  DEFAULT_PROFILE,
  DEFAULT_ROUTINE,
};