// renderer.js — UI logic. No Node access; everything goes through window.assistant.

// Renderer hatalarını ana sürece raporla (diagnostik log'a düşer — UI sorunlarını görmek için)
window.addEventListener('error', (e) => {
  try { window.assistant && window.assistant.log && window.assistant.log('error: ' + (e.message || '') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); } catch { /* yok */ }
});
window.addEventListener('unhandledrejection', (e) => {
  try { window.assistant && window.assistant.log && window.assistant.log('rejection: ' + (e.reason && e.reason.message || e.reason)); } catch { /* yok */ }
});

const $ = (id) => document.getElementById(id);

// ---------- i18n (TR kaynak → EN) ----------
let LANG = 'tr';
const LOCALES = { en: {} };
// t('Türkçe kaynak', {degisken}) → EN modunda çevirir; anahtar yoksa Türkçe kalır.
function t(s, vars) {
  let out = (LANG === 'en' && LOCALES.en && LOCALES.en[s] !== undefined) ? LOCALES.en[s] : s;
  if (vars) for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(String(vars[k]));
  return out;
}
// Statik HTML metinlerini ve attribute'ları çevirir (TR kaynak anahtarlarıyla).
function applyI18n(root) {
  if (LANG !== 'en') return;
  const scope = root || document.body;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const raw = n.nodeValue;
    const key = norm(raw);
    if (!key) continue;
    const tr = LOCALES.en[key];
    if (tr !== undefined) n.nodeValue = raw.replace(raw.trim(), tr);
  }
  scope.querySelectorAll('[placeholder]').forEach((el) => { const v = el.getAttribute('placeholder'); const tr = LOCALES.en[norm(v)]; if (tr !== undefined) el.setAttribute('placeholder', tr); });
  scope.querySelectorAll('[title]').forEach((el) => { const v = el.getAttribute('title'); const tr = LOCALES.en[norm(v)]; if (tr !== undefined) el.setAttribute('title', tr); });
  scope.querySelectorAll('[data-q]').forEach((el) => { const v = el.getAttribute('data-q'); const tr = LOCALES.en[norm(v)]; if (tr !== undefined) el.setAttribute('data-q', tr); });
}
// Arayüzü yeniden yükle (will-navigate engeli location.reload'u kestiği için IPC).
function reloadApp() {
  try { if (window.assistant && window.assistant.appReload) { window.assistant.appReload(); return; } } catch { /* yok */ }
  try { location.reload(); } catch { /* yok */ }
}
async function initLang() {
  try {
    const d = await window.assistant.i18n.data();
    LANG = (d && d.lang) || 'tr';
    if (d && d.en) LOCALES.en = d.en;
  } catch { LANG = 'tr'; }
  document.documentElement.lang = LANG;
}

const LS_SESSIONS = 'assistant_sessions_v1';
const LS_MODEL = 'assistant_model';
const LS_THEME = 'harley_theme';

// Temayı ilk boyamadan önce uygula (flash olmasın) — localStorage senkron okunur.
function currentTheme() {
  const d = document.documentElement.dataset.theme;
  if (d === 'dark' || d === 'light') return d;
  try {
    const s = localStorage.getItem(LS_THEME);
    if (s === 'dark' || s === 'light') return s;
  } catch { /* yok */ }
  return 'light';
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(LS_THEME, t);
  } catch { /* yok */ }
  const btn = $('theme-btn');
  if (btn) {
    setIcon(btn, t === 'dark' ? 'sun' : 'moon');
    btn.title = t === 'dark' ? 'Aydınlık moda geç' : 'Koyu moda geç';
  }
}
try {
  applyTheme(currentTheme());
} catch { /* henüz DOM hazır değilse init'te tekrar uygulanır */ }

// ---------- minimalist SVG ikonlar (emoji yok) ----------
const ICONS = {
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  speaker: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  sparkle: '<path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
  'thumb-up': '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>',
  'thumb-down': '<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3z"/><path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
  attach: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  zap: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77 0"/>',
  game: '<path d="M6 11h4M8 9v4"/><path d="M15.5 11h.01M18.5 13h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.6L2 16a2.5 2.5 0 0 0 4.72.9L8.5 14h7l1.78 2.9A2.5 2.5 0 0 0 22 16l-.7-7.4A4 4 0 0 0 17.32 5z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  git: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><circle cx="6" cy="18" r="2.2"/><path d="M6 8.2v7.6M8.2 6h4.3a1.5 1.5 0 0 1 1.5 1.5v8M15.8 15.8H13.4a2 2 0 0 1-1.4-.6l-3-3"/>',
  briefcase: '<rect x="2" y="7" width="20" height="13" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 12h20"/>',
  wrench: '<path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6l-2.5 2.5-2.7-.8-.8-2.7z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  lock: '<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z"/>',
  python: '<path d="M12 3c-4 0-6 1.5-6 3.5S8 10 12 10s6-1.5 6-3.5S16 3 12 3z"/><path d="M12 10v4c0 2-1.5 3-6 3M12 10c4 0 6 1.5 6 3.5"/><circle cx="8.5" cy="6.5" r=".8"/><circle cx="15.5" cy="17.5" r=".8"/>',
  nodejs: '<path d="M12 3 3 7.5v9L12 21l9-4.5v-9z"/><path d="M12 12 3 7.5M12 12l9-4.5M12 12v9"/>',
  sync: '<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/><path d="M12 8v4l2.5 2.5"/>',
};
function svgIcon(name, size) {
  const s = size || 17;
  return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
}
function setIcon(el, name, size) {
  if (el) el.innerHTML = svgIcon(name, size);
}

const splash = $('splash');
const appEl = $('app');
const hubEl = $('hub');
const messagesEl = $('messages');
const inputEl = $('input');
const sendBtn = $('send');
const modelSelect = $('model-select');
const newChatBtn = $('new-chat');
const sessionList = $('session-list');
const chatTitle = $('chat-title');
const statusDot = $('status-dot');
const statusText = $('status-text');
const bagBtnWork = $('bag-btn-work');
const bagBtnFun = $('bag-btn-fun');
const bagBtnGit = $('bag-btn-git');
const bagPopoverWork = $('bag-popover-work');
const bagPopoverFun = $('bag-popover-fun');
const bagPopoverGit = $('bag-popover-git');
const wsBtn = $('ws-btn');
const wsBadge = $('ws-badge');
const memoryBtn = $('memory-btn');
const memoryOverlay = $('memory-overlay');
const memoryInput = $('memory-input');
const memorySave = $('memory-save');
const memoryClose = $('memory-close');
const memoryStatus = $('memory-status');

let sessions = loadSessions();
let activeId = sessions[0] ? sessions[0].id : null;
let busy = false;
let models = [];
let streamSessionId = null;
let streamMsgEl = null;
let attachedFiles = []; // Ekli dosyalar (dosya ekleme preview)

// ---------- persistence ----------
function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(LS_SESSIONS)) || [];
  } catch {
    return [];
  }
}
function saveSessions() {
  localStorage.setItem(LS_SESSIONS, JSON.stringify(sessions));
}
function activeSession() {
  return sessions.find((s) => s.id === activeId) || null;
}

// ---------- sessions ----------
function newSession() {
  const s = { id: crypto.randomUUID(), title: 'Yeni Sohbet', createdAt: Date.now(), messages: [] };
  sessions.unshift(s);
  activeId = s.id;
  saveSessions();
  renderSidebar();
  renderMessages();
  updateHeader();
  refreshWorkspaceIndicator();
  inputEl.focus();
  showChat(); // yeni sohbet → hub kapanır, prompt girişine odaklanır
}

function deleteSession(id) {
  // Çalışma klasörü bağını serbest bırak (o klasör başka sohbette kullanılabilsin).
  try { if (window.assistant && window.assistant.workspace) window.assistant.workspace.release(id); } catch { /* yok */ }
  sessions = sessions.filter((s) => s.id !== id);
  if (activeId === id) {
    activeId = sessions[0] ? sessions[0].id : null;
    if (!activeId) sessions.unshift({ id: crypto.randomUUID(), title: 'Yeni Sohbet', createdAt: Date.now(), messages: [] });
    activeId = sessions[0].id;
  }
  saveSessions();
  renderSidebar();
  renderMessages();
  updateHeader();
  refreshWorkspaceIndicator();
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

// Çalışma klasörü göstergesi: 0/1 (bağlı değil) veya 1/1 (bağlı, kırmızı).
async function refreshWorkspaceIndicator() {
  const s = activeSession();
  if (!wsBtn || !wsBadge) return;
  if (!s || !window.assistant || !window.assistant.workspace) {
    wsBadge.textContent = '0/1';
    wsBtn.classList.remove('bound');
    wsBtn.title = 'Bu sohbete çalışma klasörü bağla';
    return;
  }
  try {
    const ws = await window.assistant.workspace.get(s.id);
    if (ws && ws.path) {
      wsBadge.textContent = '1/1';
      wsBtn.classList.add('bound');
      wsBtn.title = 'Bağlı: ' + ws.path + (ws.repo ? '\nRepo: ' + ws.repo.name : '\nRepo: yok — "repo oluştur/bağla" de') + ' (tıkla: başka klasör seç)';
    } else {
      wsBadge.textContent = '0/1';
      wsBtn.classList.remove('bound');
      wsBtn.title = 'Bu sohbete çalışma klasörü bağla';
    }
  } catch { wsBadge.textContent = '0/1'; wsBtn.classList.remove('bound'); }
}

// Global hata yakalayıcı: hata olsa bile uygulama yaşamaya devam etsin, sessiz çökmesin.
window.addEventListener('error', (e) => { console.error('[Harley-global]', e.message); });
window.addEventListener('unhandledrejection', (e) => { console.error('[Harley-global-rej]', (e.reason && (e.reason.message || e.reason)) || e.reason); });

// ---------- İlk kurulum sihirbazı (ad + DeepSeek anahtarı + opsiyonel servisler) ----------
async function maybeShowSetup() {
  const wizard = $('setup-wizard');
  const items = $('sw-items');
  const actions = $('sw-actions');
  const title = $('sw-title');
  const sub = $('sw-sub');
  const note = $('sw-note');
  if (!wizard || !items || !window.assistant.setup) return;

  let st = { deepseek: false, spotify: false, google: false };
  let conn = {};
  let settings = {};
  try { st = await window.assistant.setup.status(); } catch { /* yok */ }
  try { conn = await window.assistant.connections.status(); } catch { /* yok */ }
  try { settings = (await window.assistant.settings.get()) || {}; } catch { /* yok */ }

  let hasDeepseek = !!(st.deepseek || conn.deepseek);
  // Zaten kuruluysa ve kullanıcı sihirbazı bitirdiyse bir daha gösterme.
  if (hasDeepseek && settings.setupDone) return;

  let step = hasDeepseek ? 2 : 0;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hide = () => wizard.classList.add('hidden');
  const currentName = () => ($('sw-name') ? $('sw-name').value.trim() : (settings.name || ''));

  const saveName = async (name) => {
    const v = String(name || '').trim();
    settings.name = v;
    try { await window.assistant.settings.set({ name: v }); } catch { /* yok */ }
    const n = $('hub-name');
    if (n && v) n.textContent = v;
  };
  const finish = async () => {
    try { await window.assistant.settings.set({ setupDone: true }); } catch { /* yok */ }
    hide();
  };

  const btn = (id, cls) => '<button class="sw-btn' + (cls ? ' ' + cls : '') + '" data-sw="' + id + '">' + t(id) + '</button>';
  const chip = (label, ok) => '<div class="sw-item' + (ok ? ' ok' : '') + '"><span class="sw-check">' + (ok ? '✓' : '•') + '</span><div class="sw-text"><div>' + t(label) + '</div><div class="sw-hint">' + (ok ? t('Hazır') : t('bağlı değil')) + '</div></div></div>';

  const render = () => {
    if (step === 0) {
      title.textContent = t("Harley'ye hoş geldin!");
      sub.textContent = t('Seni tanıyalım — birkaç saniye sürer.');
      note.textContent = t('Adını sonra Ayarlar > Adın alanından da değiştirebilirsin.');
      items.innerHTML =
        '<div class="sw-field"><span>' + t('Seni nasıl çağırayım?') + '</span>' +
        '<input id="sw-name" type="text" placeholder="' + t('örn. Ayşe') + '" value="' + esc(settings.name || '') + '" autocomplete="off" /></div>';
      actions.innerHTML = btn('Atla') + btn('Devam', 'primary');
    } else if (step === 1) {
      title.textContent = t('Sohbet anahtarı');
      sub.textContent = t('Harley, DeepSeek API anahtarınla düşünür. Anahtar yalnızca bu bilgisayarda saklanır.');
      note.textContent = t('Ücretsiz anahtar: platform.deepseek.com/api_keys');
      items.innerHTML =
        chip('DeepSeek bağlı', hasDeepseek) +
        '<div class="sw-field"><span>' + t('DeepSeek API anahtarı') + '</span>' +
        '<input id="sw-key" type="password" placeholder="sk-..." autocomplete="off" /></div>' +
        '<div class="sw-status" id="sw-status"></div>';
      actions.innerHTML = hasDeepseek ? (btn('Geri') + btn('Devam', 'primary')) : (btn('Geri') + btn('Kaydet ve Test Et', 'primary'));
    } else if (step === 2) {
      title.textContent = t('Diğer bağlantılar (isteğe bağlı)');
      sub.textContent = t('İstediklerini bağla; kalanı sonra Bağlantılar panelinden halledebilirsin.');
      note.textContent = t('Bağlanmayan servisler Harley\'yi engellemez.');
      items.innerHTML =
        chip('GitHub — repo, commit & push, issue', !!(conn.github)) +
        chip('Google — Takvim / Gmail / Drive / Görevler', !!(conn.google || st.google)) +
        chip('Spotify — komutla müzik başlatma', !!(conn.spotify || st.spotify)) +
        '<button class="sw-btn" id="sw-open-conn">' + t('Bağlantılar panelini aç') + '</button>';
      actions.innerHTML = btn('Geri') + btn('Bitir', 'primary');
    } else {
      title.textContent = t('Harley hazır!');
      sub.textContent = t('Aşağıdaki kutuya bir şey yaz — "Merhaba Harley" diyebilirsin.');
      note.textContent = '';
      items.innerHTML = '<div class="sw-item ok"><span class="sw-check">✓</span><div class="sw-text"><div>' + t('Kurulum tamamlandı') + '</div><div class="sw-hint">' + t('Anahtarları dilediğin zaman Bağlantılar panelinden değiştirebilirsin.') + '</div></div></div>';
      actions.innerHTML = btn('Başla', 'primary');
    }
    wire();
  };

  const wire = () => {
    actions.querySelectorAll('[data-sw]').forEach((b) => {
      b.addEventListener('click', async () => {
        const label = b.getAttribute('data-sw');
        if (label === 'Devam') { if (step === 0) await saveName(currentName()); step += 1; render(); }
        else if (label === 'Geri') { step -= 1; render(); }
        else if (label === 'Atla' || label === 'Bitir' || label === 'Başla') { await finish(); }
        else if (label === 'Kaydet ve Test Et') {
          const key = ($('sw-key') && $('sw-key').value.trim()) || '';
          const statusEl = $('sw-status');
          if (!key) { if (statusEl) { statusEl.textContent = t('Anahtar boş.'); statusEl.className = 'sw-status err'; } return; }
          if (statusEl) { statusEl.textContent = t('Test ediliyor…'); statusEl.className = 'sw-status'; }
          b.disabled = true;
          let r;
          try { r = await window.assistant.connections.saveDeepseek(key); } catch (e) { r = { ok: false, message: String(e.message || e) }; }
          b.disabled = false;
          if (r && r.ok) { hasDeepseek = true; if (statusEl) { statusEl.textContent = t('Anahtar çalışıyor — bağlandı.'); statusEl.className = 'sw-status ok'; } step = 2; render(); }
          else if (statusEl) { statusEl.textContent = (r && r.message) || t('Kaydedilemedi.'); statusEl.className = 'sw-status err'; }
        }
      });
    });
    const openConn = $('sw-open-conn');
    if (openConn) openConn.addEventListener('click', () => { if (typeof openConnections === 'function') openConnections(); });
    const nameEl = $('sw-name');
    if (nameEl) nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (typeof nameEl.blur === 'function') nameEl.blur(); const d = actions.querySelector('[data-sw="Devam"]'); if (d) d.click(); } });
  };

  const closeBtn = $('sw-close');
  if (closeBtn) closeBtn.onclick = async () => { if (step === 0) await saveName(currentName()); await finish(); };

  render();
  wizard.classList.remove('hidden');
}

// ---------- Kullanıcı rehberi (onboarding) ----------
// İlk açılışta bir kez gösterilir; localStorage'da "onboarded" işareti tutulur.
const ONBOARD_STEPS = [
  { title: 'Harley\'ye hoş geldin!', icon: 'game', body: 'Ben senin kişisel AI asistanınım. Sohbet edebilir, projelerini geliştirebilir ve GitHub\'a gönderebilirim.<br><br><b>Başlamak için:</b> Sağ alttaki <b>Gönder</b> kutusuna bir şey yaz — mesela "Merhaba Harley!"' },
  { title: 'Çalışma Alanı', icon: 'folder', body: 'Bir proje klasörü seçtiğinde o klasörde <b>tam yetki</b> kazanırım: dosya okuyabilir, yazabilir, komut çalıştırabilir, test edebilirim.<br><br>Footer\'daki <b>0/1</b> butonuna basarak klasör bağlarsın.' },
  { title: 'GitHub Senkronu', icon: 'refresh', body: 'Bağlı klasörünü GitHub\'da repo yapabilir veya mevcut bir repoya bağlayabilirim.<br><br>"Repo oluştur", "Commit et", "Push et" dediğinde sana <b>onay sorarım</b> — sen "Evet" demezsen hiçbir şey göndermem.' },
  { title: 'Hazır Sorular', icon: 'bulb', body: 'Alt taraftaki butonlarla hızlı başlayabilirsin: İş/Proje, Proje/Git, Eğlence.<br><br>Bir prompta tıklayınca yazı kutusuna dolar, sen Enter\'a basarsın.' },
  { title: 'Senin Güvenliğin', icon: 'lock', body: 'Tokenların asla sohbetten geçmez, GitHub yazma işlemleri hep onayınla olur. İstediğin zaman "Tümünü Kapat" butonuyla Harley ve yardımcı programları kapatabilirsin.' },
];
const ONBOARD_STEPS_EN = [
  { title: 'Welcome to Harley!', icon: 'game', body: 'I am your personal AI assistant. I can chat, build your projects and push them to GitHub.<br><br><b>To start:</b> type something in the <b>Send</b> box at the bottom — try "Hello Harley!"' },
  { title: 'Workspace', icon: 'folder', body: 'When you pick a project folder I get <b>full access</b> there: I can read/write files, run commands and tests.<br><br>Click the <b>0/1</b> button in the footer to bind a folder.' },
  { title: 'GitHub Sync', icon: 'refresh', body: 'I can turn your bound folder into a GitHub repo or link it to an existing one.<br><br>When you say "Create repo", "Commit", "Push", I <b>ask for your approval</b> — nothing is sent unless you say yes.' },
  { title: 'Quick Prompts', icon: 'bulb', body: 'Use the buttons at the bottom to start fast: Work/Project, Project/Git, Fun.<br><br>Clicking a prompt fills the input box; you press Enter.' },
  { title: 'Your Security', icon: 'lock', body: 'Your tokens never pass through chat, GitHub write actions always need your approval. You can shut down Harley and helper programs anytime with "Shut down".' },
];
function maybeShowOnboarding() {
  const overlay = $('onboard-overlay');
  if (!overlay) return false;
  try { if (localStorage.getItem('harley_onboarded_v3')) return false; } catch { return false; }
  let step = 0;
  const title = $('onboard-title');
  const body = $('onboard-body');
  const dots = $('onboard-dots');
  const prev = $('onboard-prev');
  const next = $('onboard-next');
  const skip = $('onboard-skip');
  const STEPS = (LANG === 'en' && ONBOARD_STEPS_EN) ? ONBOARD_STEPS_EN : ONBOARD_STEPS;
  const render = () => {
    const s = STEPS[step];
    title.innerHTML = (s.icon ? svgIcon(s.icon, 22) : '') + ' ' + s.title;
    body.innerHTML = s.body;
    dots.innerHTML = STEPS.map((_, i) => '<span class="onboard-dot' + (i === step ? ' active' : '') + '"></span>').join('');
    prev.disabled = step === 0;
    next.textContent = step === STEPS.length - 1 ? t('Başla') : t('Devam →');
  };
  const close = () => {
    overlay.classList.add('hidden');
    try { localStorage.setItem('harley_onboarded_v3', '1'); } catch { /* yok */ }
    // Rehber bitti — şimdi kurulum sihirbazını göster
    if (typeof maybeShowSetup === 'function') maybeShowSetup();
  };
  prev.onclick = () => { if (step > 0) { step--; render(); } };
  next.onclick = () => { if (step < STEPS.length - 1) { step++; render(); } else close(); };
  skip.onclick = close;
  render();
  overlay.classList.remove('hidden');
  return true;
}

// ---------- Detaylı Rehber (ana menüdeki "Rehber" butonu) ----------
// Harley'nin kapasitesi, proje geliştirme adımları, Git/GitHub kavramları.
const GUIDE_TABS = {
  baslangic: {
    title: 'Başlangıç',
    html: '<div class="guide-sec"><h3>Harley ne yapabilir?</h3><ul class="guide-list">' +
      '<li><b>Sohbet:</b> Türkçe konuşur, sorularına cevap verir, kod yazar, açıklar.</li>' +
      '<li><b>Çalışma Alanı:</b> Bir klasör seçtiğinde o klasörde dosya okuyabilir, yazabilir, komut çalıştırabilir, test edebilir.</li>' +
      '<li><b>GitHub:</b> Projelerini GitHub\'da repo olarak saklayabilir, değişiklikleri yedekleyebilir (commit/push).</li>' +
      '<li><b>Google:</b> Takvim, e-posta, görevler, Drive dosyalarınla çalışabilir.</li>' +
      '<li><b>Eğlence:</b> Oyunlar, motivasyon, ilginç bilgiler, günün şarkısı.</li>' +
      '</ul></div>' +
      '<div class="guide-sec"><h3>Nereden başlamalıyım?</h3><p>En kolayı: alttaki yazı kutusuna <b>"Merhaba Harley"</b> yaz. Sonra bir proje klasörü bağlayıp <b>"Bu klasörde proje geliştir"</b> de.</p></div>',
  },
  proje: {
    title: 'Proje Yapımı',
    html: '<div class="guide-sec"><h3>Bir proje nasıl yapılır? (adım adım)</h3><ol class="guide-list">' +
      '<li><b>Klasör bağla:</b> Alttaki <b>0/1</b> butonuna bas ve proje klasörünü seç. Harley o klasörde çalışır.</li>' +
      '<li><b>Proje kur:</b> "React projesi kur" veya "Python projesi oluştur" de. Harley hazır iskelet kurar (şablon).</li>' +
      '<li><b>Geliştir:</b> "Şöyle bir özellik ekle" de. Harley dosyaları yazar, gerekenleri kurar, test eder.</li>' +
      '<li><b>GitHub\'a gönder:</b> "GitHub\'da repo oluştur" de. Onay verince projen GitHub\'a yüklenir.</li>' +
      '<li><b>Güncelle:</b> Değişiklik yaptıkça "Commit et ve push et" de — onay verirsen güncellenir.</li>' +
      '</ol><p class="guide-note">İstersen tek komutla: <b>"Her şeyi senkronize et"</b> — Harley test eder, commit eder, push eder.</p></div>',
  },
  git: {
    title: 'Git / GitHub',
    html: '<div class="guide-sec"><h3>Git / GitHub nedir? (basitçe)</h3><ul class="guide-list">' +
      '<li><b>Git:</b> Dosyalarının geçmişini tutan bir sistem. Her kayıt = <b>commit</b>. İstediğin zaman eski hale dönebilirsin.</li>' +
      '<li><b>GitHub:</b> Git geçmişini internette saklayan platform. Projen bulutta yedeklenir.</li>' +
      '<li><b>Commit:</b> "Şu an bu halini kaydet" demek. Harley bunu senin onayınla yapar.</li>' +
      '<li><b>Push:</b> Yerel kayıtları GitHub\'a göndermek (yedekleme).</li>' +
      '<li><b>Pull:</b> GitHub\'dan en son hali çekmek.</li>' +
      '<li><b>Branch:</b> Projenin ayrı bir kopyası. Yeni özellik ayrı dalda yapılır, sonra ana dala (main) birleştirilir — bozuk kod ana sürüme girmez.</li>' +
      '</ul></div>' +
      '<div class="guide-sec"><h3>Korkma — Harley halleder</h3><p>Git komutlarını sen bilmek zorunda değilsin. Sadece <b>"commit et", "push et", "branch aç", "main\'e al"</b> gibi doğal sözler söyle. Harley sana onay sorar; sen "Evet" demezsen hiçbir şey yapılmaz.</p></div>',
  },
  komutlar: {
    title: 'Komutlar',
    html: '<div class="guide-sec"><h3>Sık kullanılan komutlar</h3><ul class="guide-list">' +
      '<li><b>"Günün özeti"</b> — takvim + e-posta + görevler tek mesajda</li>' +
      '<li><b>"Git durumunu göster"</b> — hangi dosyalar değişti</li>' +
      '<li><b>"Commit et"</b> — değişiklikleri kaydet (onay ister)</li>' +
      '<li><b>"Push et"</b> — GitHub\'a gönder (onay ister)</li>' +
      '<li><b>"Repo oluştur"</b> — projeyi GitHub\'da yeni repo yap</li>' +
      '<li><b>"Repoya bağlan"</b> — mevcut bir GitHub repoya bağla</li>' +
      '<li><b>"Her şeyi senkronize et"</b> — test + commit + push tek komutta</li>' +
      '<li><b>"Kod incele"</b> — son değişikliklerde hata/bug ara</li>' +
      '<li><b>"Proje şablonu kur"</b> — React/Python/Node iskeleti</li>' +
      '<li><b>"Issue\'ları listele"</b> — GitHub görevlerini gör</li>' +
      '</ul></div>',
  },
  ipuclari: {
    title: 'İpuçları',
    html: '<div class="guide-sec"><h3>En iyi kullanım için</h3><ul class="guide-list">' +
      '<li><b>Net konuş:</b> "Şu dosyada X\'i yap" gibi net istekler daha iyi sonuç verir.</li>' +
      '<li><b>Güvenlik:</b> GitHub yazma işlemleri hep onay ister. Onaylamazsan hiçbir şey gönderilmez.</li>' +
      '<li><b>Otomatik yedekleme:</b> Ayarlarda açarsan her 30 dk\'da projen "backup" dalına yedeklenir.</li>' +
      '<li><b>Token bütçesi:</b> Ayarlarda token kullanımını görürsün. Dolunca "bütçeyi sıfırla" diyebilirsin.</li>' +
      '<li><b>Çoklu proje:</b> Farklı sohbetlerde farklı klasörler bağlayabilirsin; hepsi ana menüde görünür.</li>' +
      '<li><b>Hatalar:</b> Bir şey ters giderse ana menüdeki "Son Hatalar" paneline bak.</li>' +
      '</ul></div>',
  },
  gizlilik: {
    title: 'Gizlilik',
    html: '<div class="guide-sec"><h3>Verilerin nerede?</h3><ul class="guide-list">' +
      '<li><b>Anahtarlar / hafıza / hatırlatmalar / pano:</b> <code>%USERPROFILE%\\HarleyDosyalar\\</code></li>' +
      '<li><b>Kişisel ayarlar &amp; profil:</b> <code>%APPDATA%\\harley\\</code></li>' +
      '<li><b>Kod çalışma alanı:</b> <code>%USERPROFILE%\\HarleyKod\\</code></li>' +
      '</ul><p class="guide-note">Hiçbir veri Harley sunucularına gitmez — böyle bir sunucu yok.</p></div>' +
      '<div class="guide-sec"><h3>Neler dışarı gider?</h3><ul class="guide-list">' +
      '<li>Sohbet yalnızca seçtiğin sağlayıcıya (varsayılan: DeepSeek) gider.</li>' +
      '<li>Google / GitHub / Spotify yalnızca sen bağlarsan ve senin anahtarınla çalışır.</li>' +
      '<li>GitHub\'a yazma işlemleri (commit/push/issue) her zaman önce onayını ister.</li>' +
      '<li>Yerel dosya yazma, sadece bağladığın çalışma klasöründe geçerlidir.</li>' +
      '</ul></div>' +
      '<div class="guide-sec"><h3>Sil / yedekle</h3><p>Ayarlar → <b>Verilerim</b> bölümünden tüm yerel verini tek tıkla yedekleyebilir veya silebilirsin.</p></div>',
  },
};
const GUIDE_TABS_EN = {
  baslangic: {
    title: 'Getting Started',
    html: '<div class="guide-sec"><h3>What can Harley do?</h3><ul class="guide-list">' +
      '<li><b>Chat:</b> Talks naturally, answers questions, writes and explains code.</li>' +
      '<li><b>Workspace:</b> When you pick a folder it can read/write files, run commands and tests there.</li>' +
      '<li><b>GitHub:</b> Store projects as GitHub repos, back up changes (commit/push).</li>' +
      '<li><b>Google:</b> Work with your calendar, email, tasks and Drive files.</li>' +
      '<li><b>Fun:</b> Games, motivation, fun facts, song of the day.</li>' +
      '</ul></div>' +
      '<div class="guide-sec"><h3>Where do I start?</h3><p>Easiest: type <b>"Hello Harley"</b> in the box below. Then bind a project folder and say <b>"build a project in this folder"</b>.</p></div>',
  },
  proje: {
    title: 'Building Projects',
    html: '<div class="guide-sec"><h3>How to build a project (step by step)</h3><ol class="guide-list">' +
      '<li><b>Bind a folder:</b> Press the <b>0/1</b> button below and pick your project folder. Harley works there.</li>' +
      '<li><b>Set up:</b> Say "set up a React project" or "create a Python project". Harley scaffolds it.</li>' +
      '<li><b>Develop:</b> Say "add a feature like this". Harley writes files, installs what is needed, tests.</li>' +
      '<li><b>Push to GitHub:</b> Say "create a GitHub repo". Once you approve, your project is uploaded.</li>' +
      '<li><b>Update:</b> As you change things say "commit and push" — approved changes are synced.</li>' +
      '</ol><p class="guide-note">Or one command: <b>"sync everything"</b> — Harley tests, commits and pushes.</p></div>',
  },
  git: {
    title: 'Git / GitHub',
    html: '<div class="guide-sec"><h3>What are Git / GitHub? (simply)</h3><ul class="guide-list">' +
      '<li><b>Git:</b> A system that keeps your file history. Each save = a <b>commit</b>. You can go back anytime.</li>' +
      '<li><b>GitHub:</b> A platform that stores Git history online. Your project is backed up in the cloud.</li>' +
      '<li><b>Commit:</b> "Save this state". Harley does it with your approval.</li>' +
      '<li><b>Push:</b> Sending local commits to GitHub (backup).</li>' +
      '<li><b>Pull:</b> Fetching the latest state from GitHub.</li>' +
      '<li><b>Branch:</b> A separate copy. New features go to a branch, then merge into main — broken code never hits the main version.</li>' +
      '</ul></div>' +
      '<div class="guide-sec"><h3>Don\'t worry — Harley handles it</h3><p>You don\'t need to know Git commands. Just say natural things like <b>"commit", "push", "open a branch", "merge to main"</b>. Harley asks for approval; nothing happens unless you say yes.</p></div>',
  },
  komutlar: {
    title: 'Commands',
    html: '<div class="guide-sec"><h3>Common commands</h3><ul class="guide-list">' +
      '<li><b>"Today\'s summary"</b> — calendar + email + tasks in one message</li>' +
      '<li><b>"Show git status"</b> — which files changed</li>' +
      '<li><b>"Commit"</b> — save changes (asks approval)</li>' +
      '<li><b>"Push"</b> — send to GitHub (asks approval)</li>' +
      '<li><b>"Create a repo"</b> — make the project a new GitHub repo</li>' +
      '<li><b>"Link to a repo"</b> — connect to an existing GitHub repo</li>' +
      '<li><b>"Sync everything"</b> — test + commit + push in one command</li>' +
      '<li><b>"Review code"</b> — look for bugs in recent changes</li>' +
      '<li><b>"Set up a project template"</b> — React/Python/Node scaffold</li>' +
      '<li><b>"List issues"</b> — see GitHub tasks</li>' +
      '</ul></div>',
  },
  ipuclari: {
    title: 'Tips',
    html: '<div class="guide-sec"><h3>For best results</h3><ul class="guide-list">' +
      '<li><b>Be clear:</b> Specific requests like "do X in this file" work best.</li>' +
      '<li><b>Security:</b> GitHub write actions always ask approval. Nothing is sent unless you approve.</li>' +
      '<li><b>Auto backup:</b> Enable it in Settings and your project is backed up to the "backup" branch every 30 min.</li>' +
      '<li><b>Token budget:</b> See token usage in Settings. When exhausted, say "reset the budget".</li>' +
      '<li><b>Multiple projects:</b> Bind different folders in different chats; all show on the home screen.</li>' +
      '<li><b>Errors:</b> If something goes wrong, check the "Recent Errors" panel on the home screen.</li>' +
      '</ul></div>',
  },
  gizlilik: {
    title: 'Privacy',
    html: '<div class="guide-sec"><h3>Where is your data?</h3><ul class="guide-list">' +
      '<li><b>Keys / memory / reminders / clipboard:</b> <code>%USERPROFILE%\\HarleyDosyalar\\</code></li>' +
      '<li><b>Personal settings &amp; profile:</b> <code>%APPDATA%\\harley\\</code></li>' +
      '<li><b>Code workspace:</b> <code>%USERPROFILE%\\HarleyKod\\</code></li>' +
      '</ul><p class="guide-note">No data goes to Harley servers — there is no such server.</p></div>' +
      '<div class="guide-sec"><h3>What leaves your machine?</h3><ul class="guide-list">' +
      '<li>Chat goes only to the provider you choose (default: DeepSeek).</li>' +
      '<li>Google / GitHub / Spotify work only if you connect them, with your keys.</li>' +
      '<li>GitHub write actions (commit/push/issue) always ask for approval first.</li>' +
      '<li>Local file writes only apply to the workspace folder you bound.</li>' +
      '</ul></div>' +
      '<div class="guide-sec"><h3>Delete / back up</h3><p>From Settings → <b>My data</b> you can back up or delete all your local data in one click.</p></div>',
  },
};
function wireGuide() {
  const btn = $('guide-btn');
  const overlay = $('guide-overlay');
  const body = $('guide-body');
  if (!btn || !overlay || !body) return;
  const closeBtn = $('guide-close');
  const open = () => { overlay.classList.remove('hidden'); renderTab('baslangic'); };
  const close = () => overlay.classList.add('hidden');
  const renderTab = (key) => {
    const TABS = (LANG === 'en') ? GUIDE_TABS_EN : GUIDE_TABS;
    const tab = TABS[key];
    if (!tab) return;
    body.innerHTML = tab.html;
    document.querySelectorAll('.guide-tab').forEach((t) => t.classList.toggle('active', t.dataset.gtab === key));
  };
  btn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.querySelectorAll('.guide-tab').forEach((t) => {
    t.addEventListener('click', () => renderTab(t.dataset.gtab));
  });
}

function copyToClipboard(text) {
  // En güvenilir: ana süreç clipboard modülü (Electron'da navigator.clipboard her zaman çalışmaz).
  if (window.assistant && window.assistant.clipboard && window.assistant.clipboard.set) {
    window.assistant.clipboard.set(text).catch(() => fallbackCopy(text));
    return;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      return;
    }
  } catch { /* yok */ }
  fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* yok */ }
  document.body.removeChild(ta);
}
// Kısa süreli geri bildirim (toast) — kopyala/kaydet başarılı olunca.
function showToast(msg) {
  try {
    msg = t(msg);
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);z-index:500;background:var(--ok,#6f9e5c);color:#fff;padding:8px 16px;border-radius:20px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.3);opacity:0;transition:opacity .2s;';
    document.body.appendChild(el);
    requestAnimationFrame(() => (el.style.opacity = '1'));
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => { try { document.body.removeChild(el); } catch { /* yok */ } }, 250); }, 1800);
  } catch { /* yok */ }
}
// Kod bloğu kopyalama: satır numaraları olmadan ham kodu kopyalar.
window.copyCode = function (btn) {
  const codeEl = btn && btn.closest('pre') && btn.closest('pre').querySelector('code');
  if (!codeEl) return;
  const clone = codeEl.cloneNode(true);
  clone.querySelectorAll('.line-num').forEach((n) => n.remove());
  copyToClipboard(clone.textContent);
    showToast(t('Kopyalandı ✓'));
  btn.textContent = 'Kopyalandı!';
  setTimeout(() => { if (btn) btn.textContent = 'Kopyala'; }, 1500);
};
// Üretilen kodu proje klasörüne dosya olarak yaz (kullanıcı yolu onaylar).
// NOT: Electron'da window.prompt()/alert() çalışmaz — özel modal kullanılır.
function customPrompt(message, initial) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--card,#fff);border:1px solid var(--line,#ddd);border-radius:14px;padding:18px;width:min(420px,90vw);font-family:inherit;box-shadow:0 12px 40px rgba(0,0,0,.3);';
    const label = document.createElement('div');
    label.textContent = message;
    label.style.cssText = 'font-size:13px;color:var(--ink,#222);margin-bottom:8px;font-weight:600;';
    const input = document.createElement('input');
    input.value = initial || '';
    input.placeholder = 'örn. app/index.py';
    input.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--line,#ddd);border-radius:8px;font-size:13px;outline:none;';
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px;';
    const ok = document.createElement('button'); ok.textContent = 'Kaydet'; ok.style.cssText = 'padding:6px 14px;border-radius:8px;cursor:pointer;background:var(--accent,#e5823d);border:none;color:#fff;font-size:12px;';
    const cancel = document.createElement('button'); cancel.textContent = 'İptal'; cancel.style.cssText = 'padding:6px 14px;border-radius:8px;cursor:pointer;background:none;border:1px solid var(--line,#ddd);color:var(--muted,#888);font-size:12px;';
    const done = (v) => { try { document.body.removeChild(wrap); } catch { /* yok */ } resolve(v); };
    ok.onclick = () => done(input.value.trim());
    cancel.onclick = () => done(null);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim()); if (e.key === 'Escape') done(null); });
    btns.appendChild(cancel); btns.appendChild(ok);
    box.appendChild(label); box.appendChild(input); box.appendChild(btns);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    input.focus(); input.select();
  });
}

window.writeCodeFile = async function (btn) {
  const pre = btn && btn.closest('pre');
  const codeEl = pre && pre.querySelector('code');
  if (!codeEl) return;
  const clone = codeEl.cloneNode(true);
  clone.querySelectorAll('.line-num').forEach((n) => n.remove());
  const content = clone.textContent;
  const rel = await customPrompt('Dosya yolu (proje klasörüne göre):', (btn.dataset.path || '').replace(/^[\/\\]+/, ''));
  if (!rel) return;
  const r = await window.assistant.code.writeFile(rel, content);
  const old = btn.textContent;
  if (r && r.ok) {
    btn.textContent = 'Kaydedildi ✓'; setTimeout(() => { btn.textContent = old; }, 1500);
    showToast(t('Dosya kaydedildi: {f}', { f: rel }));
    try { new Notification('Harley', { body: 'Dosya kaydedildi: ' + rel }).show(); } catch { /* yok */ }
  } else {
    btn.textContent = 'Hata!'; setTimeout(() => { btn.textContent = old; }, 2000);
    showToast(t('Kaydedilemedi: {e}', { e: (r && r.error) || t('bilinmeyen') }));
    console.error('[Harley-save]', (r && r.error) || 'bilinmeyen');
  }
};
// Kod bloğu butonları (CSP inline onclick'i engellediği için olay delegasyonu kullanılır)
messagesEl.addEventListener('click', (e) => {
  const btn = e.target && e.target.closest && e.target.closest('button.copy-code-btn');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'copy') window.copyCode(btn);
  else if (act === 'save') window.writeCodeFile(btn);
});

// ---------- Tool çağrısı metnini temizle (model bazen <tool_calls> veya <｜｜DSML｜｜tool_calls> üretir) ----------
function cleanToolCallsText(text) {
  return String(text || '')
    .replace(/[｜│]/g, '')
    .replace(/<[\/]*[^>]*?(tool_calls|invoke|parameter|list|dict|function)[^>]*>/gi, '')
    .replace(/^\s*<\/?[a-z_][a-z0-9_]*[^>]*>\s*/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{3,}/g, ' ')
    .trim();
}

// ---------- markdown-lite (XSS-safe: escape first, then transform) ----------
function md(text) {
  let s = String(text)
    // Model bazen tool çağrısını metin olarak üretir (<tool_calls> veya <｜｜DSML｜｜tool_calls> blokları) — kullanıcıya ham gitmesin
    .replace(/[｜│]/g, '')
    .replace(/<[\/]*[^>]*?(tool_calls|invoke|parameter|list|dict|function)[^>]*>/gi, '')
    .replace(/^\s*<\/?[a-z_][a-z0-9_]*[^>]*>\s*/gim, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  s = s.replace(/```([\s\S]*?)```/g, (m, code) => {
    const trimmed = code.trim();
    const lines = trimmed.split('\n');
    const numbered = lines.map((l, i) => '<span class="line-num">' + (i + 1) + '</span>' + l).join('\n');
    return '<pre><code>' + numbered + '</code><button class="copy-code-btn" data-act="copy">Kopyala</button><button class="copy-code-btn" data-act="save">Kaydet</button></pre>';
  });
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Markdown tablo: bitişik "| ... |" satırlarını tek <table> yap
  s = s.replace(/(^\|.+\|\s*\n)+/gm, (block) => {
    const rows = block.trim().split('\n').map((r) => r.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim()));
    if (!rows.length) return '';
    const head = rows[0];
    const body = rows.slice(1).filter((r) => !/^[\-:\s]+$/.test(r.join('')));
    return '<table><thead><tr>' + head.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' + body.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  });
  s = s.replace(/\n/g, '<br>');
  return s;
}

// ---------- Toast Notifications ----------
function showToast(message, type) {
  type = type || 'info';
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = t(message);
  container.appendChild(toast);
  setTimeout(() => { if (toast.isConnected) toast.remove(); }, 3000);
}

// ---------- Skeleton Loading ----------
function showSkeleton(count) {
  count = count || 3;
  messagesEl.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'skeleton-msg';
    el.innerHTML = '<div class="skeleton skeleton-line ' + (i % 2 === 0 ? 'long' : 'medium') + '"></div><div class="skeleton skeleton-line short"></div>';
    messagesEl.appendChild(el);
  }
}

// ---------- Empty State ----------
function showEmptyState() {
  messagesEl.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.innerHTML = '<svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>' +
    '<h3>Merhaba! Ben Harley</h3>' +
    '<p>Senin kişisel asistanın. Ne yapmak istersen sor, yardımcı olayım.</p>' +
    '<div class="empty-actions">' +
    '<button onclick="sendQuick(\'Günün özetini çıkar\')">Günün Özeti</button>' +
    '<button onclick="sendQuick(\'Roblox oyun öner\')">Oyun Öner</button>' +
    '<button onclick="sendQuick(\'Hava durumunu söyle\')">Hava Durumu</button>' +
    '<button onclick="sendQuick(\'Kod inceleme yap\')">Kod İncele</button>' +
    '</div>';
  messagesEl.appendChild(el);
}

function sendQuick(text) {
  inputEl.value = text;
  send();
}

// ---------- rendering ----------
function renderMessages() {
  const s = activeSession();
  messagesEl.innerHTML = '';
  if (!s || !s.messages || s.messages.length === 0) {
    showEmptyState();
    return;
  }
  for (const m of s.messages) {
    const el = document.createElement('div');
    if (m.role === 'system' || m.role === 'error') {
      el.className = 'msg ' + m.role;
      el.textContent = m.text;
    } else {
      el.className = 'msg ' + m.role;
      el.innerHTML = md(m.text);
      const meta = document.createElement('span');
      meta.className = 'msg-meta';
      meta.textContent = fmtTime(m.ts);
      el.appendChild(meta);
      if (m.role === 'assistant') {
        const copy = document.createElement('button');
        copy.className = 'copy-btn';
        copy.innerHTML = svgIcon('copy', 14);
        copy.title = 'Kopyala';
        copy.addEventListener('click', () => {
          copyToClipboard(m.text);
          copy.innerHTML = svgIcon('copy', 14);
          setTimeout(() => (copy.innerHTML = svgIcon('copy', 14)), 1200);
        });
        el.appendChild(copy);
        // Feedback butonları (👍👎)
        const fbWrap = document.createElement('span');
        fbWrap.className = 'feedback-wrap';
        const goodBtn = document.createElement('button');
        goodBtn.className = 'feedback-btn';
        goodBtn.innerHTML = svgIcon('thumb-up', 14);
        goodBtn.title = 'Bu cevap iyiydi';
        goodBtn.addEventListener('click', () => {
          const prevMsg = s.messages[s.messages.indexOf(m) - 1];
          window.assistant.feedback.record(prevMsg ? prevMsg.text : '', m.text, 'good');
          goodBtn.classList.add('active');
          badBtn.classList.remove('active');
        });
        const badBtn = document.createElement('button');
        badBtn.className = 'feedback-btn';
        badBtn.innerHTML = svgIcon('thumb-down', 14);
        badBtn.title = 'Bu cevap kötüydü';
        badBtn.addEventListener('click', () => {
          const prevMsg = s.messages[s.messages.indexOf(m) - 1];
          window.assistant.feedback.record(prevMsg ? prevMsg.text : '', m.text, 'bad');
          badBtn.classList.add('active');
          goodBtn.classList.remove('active');
        });
        fbWrap.appendChild(goodBtn);
        fbWrap.appendChild(badBtn);
        el.appendChild(fbWrap);
      }
    }
    messagesEl.appendChild(el);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderSidebar() {
  sessionList.innerHTML = '';
  for (const s of sessions) {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === activeId ? ' active' : '');
    const title = document.createElement('span');
    title.className = 'session-title';
    title.textContent = s.title;
    title.addEventListener('click', () => {
      // Streaming durumunu sıfırla (eski sohbet yanıt beklerken yeni sohbete geçme)
      streamSessionId = null;
      streamMsgEl = null;
      if (busy) setBusy(false);
      activeId = s.id;
      saveSessions();
      renderSidebar();
      renderMessages();
      updateHeader();
      refreshWorkspaceIndicator();
      showChat(); // sidebar'dan sohbet seçilince hub kapanır, sohbet gelir
    });
    const del = document.createElement('button');
    del.className = 'session-del';
    del.textContent = '✕';
    del.title = 'Sil';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(s.id);
    });
    item.appendChild(title);
    item.appendChild(del);
    sessionList.appendChild(item);
  }
}

function updateHeader() {
  if (hubEl && !hubEl.classList.contains('hidden')) {
    chatTitle.textContent = 'Ana Menü';
    return;
  }
  const s = activeSession();
  chatTitle.textContent = s ? s.title : 'Yeni Sohbet';
}

// Uzun görev algılama: mesaj uzun mu veya karmaşık görev ifadeleri içeriyor mu?
function isLongTask(text) {
  const longPatterns = [
    /adım\s*adım/i, /sıralı/i, /planla/i, /karmaşık/i, /büyük/i, /uzun/i,
    /kapsamlı/i, /detaylı/i, /örnek.*ver/i, /listele/i, /oluştur/i, /yap/i,
    /kod.*yaz/i, /projeyi/i, /temizle/i, /düzelt/i, /geliştir/i, /güçlendir/i,
    /ekle/i, /kaldır/i, /değiştir/i, /dönüştür/i, /taş/i, /yeniden/i,
    /roblox.*obby/i, /obby.*kur/i, /tuzak/i, /checkpoint/i, /sistem/i,
    /gui.*yap/i, /arayüz/i, /tasarım/i, /stil/i, /css/i, /html/i,
    /python.*kod/i, /java.*kod/i, /c#.*kod/i, /kod.*blok/i, /fonksiyon/i,
    /sınıf.*oluştur/i, /modül/i, /api.*yaz/i, /test.*yaz/i,
  ];
  return longPatterns.some(p => p.test(text));
}

// Akıllı thinking indicator:_plan mı yoksa basit düşünme mi?
function showTyping(isPlanNeeded) {
  const el = document.createElement('div');
  el.className = 'typing';
  {
    // Ferah canlı durum satırı — HER mesajda görünür: süre sayacı + değişen adım + parlama çizgisi.
    // Uzun/karmaşık görevlerde 3 aşama, basit sorularda kısa 2 aşama gösterilir.
    const planSteps = isPlanNeeded
      ? ['Görev çözümleniyor', 'Plan kuruluyor', 'Yanıt üretiliyor']
      : ['Yanıt düşünülüyor', 'Yanıt yazılıyor'];
    const fmt = (sec) => {
      const s = sec % 60, m = Math.floor(sec / 60);
      return (m ? m + ' dk ' : '') + s + ' sn';
    };
    el.innerHTML = '<div class="hs">' +
      '<div class="hs-top">' +
        '<span class="hs-dot"></span>' +
        '<span class="hs-label">Harley</span>' +
        '<span class="hs-step">' + planSteps[0] + '…</span>' +
        '<span class="hs-time">0 sn</span>' +
      '</div>' +
      '<div class="hs-rail"><span class="hs-shine"></span></div>' +
    '</div>';
    const start = Date.now();
    const step = el.querySelector('.hs-step');
    const timeEl = el.querySelector('.hs-time');
    const update = () => {
      const sec = Math.round((Date.now() - start) / 1000);
      if (timeEl) timeEl.textContent = fmt(sec);
      const idx = Math.min(Math.floor(sec / 2), planSteps.length - 1);
      const next = planSteps[idx] + '…';
      if (step && step.textContent !== next) {
        step.style.opacity = 0;
        step.textContent = next;
        requestAnimationFrame(() => { step.style.opacity = 1; });
      }
    };
    update();
    el._planTimer = setInterval(update, 1000);
    const origRemove = el.remove.bind(el);
    el.remove = () => {
      if (el._planTimer) { clearInterval(el._planTimer); el._planTimer = null; }
      origRemove();
    };
  }
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function setBusy(b) {
  busy = b;
  setIcon(sendBtn, b ? 'x' : 'send');
  sendBtn.title = b ? 'Durdur' : 'Gönder';
  inputEl.disabled = b;
}

// ---------- send ----------
async function send(text) {
  if (busy) return;
  let q = (text || inputEl.value).trim();
  if (!q && (!attachedFiles || attachedFiles.length === 0)) return;
  if (!activeSession()) newSession();
  showChat(); // sohbete geçildi — hub arka planda

  // Ekli dosyaları mesaja ekle (fotoğrafsa önce yerel modelle analiz edip metne çevir)
  if (attachedFiles && attachedFiles.length > 0) {
    const extra = [];
    for (const f of attachedFiles) {
      if (f.type === 'text' && f.content) {
        extra.push('📎 ' + f.name + ' dosyası eklendi:\n' + f.content.slice(0, 12000));
      } else if (f.type === 'image' && f.content) {
        // Görüntü analizi kaldırıldı (Ollama/moondream ile birlikte). Harley görsele bakamaz.
        extra.push('📎 ' + f.name + ' (görsel ek). Not: Harley görselleri inceleyemiyor — resmi yazıyla anlat, ayrıca sorabilirsin.');
      } else {
        extra.push('📎 ' + f.name + (f.note ? ' (' + f.note + ')' : ' dosyası eklendi.'));
      }
    }
    q = (q ? q + '\n\n' : '') + extra.join('\n\n');
    attachedFiles = [];
    renderFilePreview();
  }

  const s = activeSession();
  inputEl.value = '';
  autoGrow();
  s.messages.push({ role: 'user', text: q, ts: Date.now() });
  if (s.title === 'Yeni Sohbet') {
    // Noktalama işaretlerini temizle, sadece harf ve rakam bırak
    s.title = q.replace(/[.!?,;:'"()\[\]{}|\/\\@#$%^&*+=<>~`]/g, '').trim().slice(0, 40);
    if (!s.title) s.title = 'Yeni Sohbet';
  }
  saveSessions();
  renderSidebar();
  renderMessages();
  updateHeader();

  setBusy(true);
  streamSessionId = s.id;
  // Uzun görev algılama — plan oluşturucu göster
  const planNeeded = isLongTask(q);
  const typing = showTyping(planNeeded);
  // Tool indicator: AI calisirken hangi tool'u kullandigini goster
  const toolEl = $('tool-indicator');
  const toolNameEl = $('tool-name');
  if (toolEl) toolEl.classList.remove('hidden');
  if (toolNameEl) toolNameEl.textContent = planNeeded ? 'Plan oluşturuluyor…' : 'Düşünüyor...';
  // Inline tracker: aktif gorev varsa gostericisini goster
  const trackerEl = $('inline-tracker');
  const trackerStepsEl = $('tracker-steps');
  const trackerProgressEl = $('tracker-progress');
  if (activeTask && trackerEl && trackerStepsEl) {
    trackerEl.classList.remove('hidden');
    const done = activeTask.steps.filter(s => s.done).length;
    const total = activeTask.steps.length;
    if (trackerProgressEl) trackerProgressEl.style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
    trackerStepsEl.innerHTML = activeTask.steps.map((st, i) => {
      const cls = st.done ? 'tracker-step done' : (i === done ? 'tracker-step active' : 'tracker-step');
      return '<span class="' + cls + '"><span class="tracker-step-dot"></span>' + (i + 1) + '</span>';
    }).join('');
  }
  try {
// Bağlam: son 8 mesajı modele gönder. Token tasarrufu için her mesaj 4000 karakterde kesilir.
    const history = (s.messages || [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map((m) => (m.role === 'user' ? 'Kullanıcı: ' : 'Harley: ') + String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 4000))
      .join('\n');
    const _sendStart = Date.now();
    const res = await window.assistant.send(q, modelSelect.value, s.id, history);
    // Uzun görev bittiğinde sistem bildirimi (eğer uygulama arka plandaysa görünür)
    if (Date.now() - _sendStart > 15000 && res && res.output) {
      try { new Notification('Harley', { body: 'Uzun görev tamamlandı: ' + q.slice(0, 60) }).show(); } catch { /* yok */ }
    }
    if (typing.isConnected) typing.remove();
    const finishStreaming = (text) => {
      if (streamMsgEl && streamMsgEl.isConnected) streamMsgEl.remove();
      streamMsgEl = null;
      if (text) s.messages.push({ role: 'assistant', text: cleanToolCallsText(text), ts: Date.now() });
    };
    if (res && res.cancelled) {
      finishStreaming(streamMsgEl && streamMsgEl.textContent ? streamMsgEl.textContent : '');
      s.messages.push({ role: 'system', text: 'Durduruldu.', ts: Date.now() });
    } else if (res && res.error) {
      finishStreaming('');
      s.messages.push({ role: 'error', text: res.error, ts: Date.now() });
    } else if (!res || !res.output) {
      finishStreaming('');
      s.messages.push({ role: 'error', text: 'Boş yanıt alındı. Model bu soruyu cevaplayamadı — farklı bir model dene.', ts: Date.now() });
    } else {
      finishStreaming(res.output);
      speak(res.output);
    }
    // Tracker ve tool indicator temizle
    const te = $('inline-tracker'); if (te) te.classList.add('hidden');
    const ti = $('tool-indicator'); if (ti) ti.classList.add('hidden');
  } catch (err) {
    if (typing.isConnected) typing.remove();
    if (streamMsgEl && streamMsgEl.isConnected) streamMsgEl.remove();
    streamMsgEl = null;
    s.messages.push({
      role: 'error',
      text: 'Hata: ' + (err && err.message ? err.message : String(err)),
      ts: Date.now(),
    });
  } finally {
    streamSessionId = null;
    saveSessions();
    renderMessages();
    setBusy(false);
    inputEl.focus();
  }
}

// live streaming: main process pushes chunks while chat:send is running.
// Günaydın rutini: ana süreç hava durumu + günün özetini hazırlayıp gönderir.
window.assistant.morning.onBriefing(({ text }) => {
  if (!text) return;
  if (!activeSession()) newSession();
  const s = activeSession();
  s.messages.push({ role: 'assistant', text, ts: Date.now() });
  saveSessions();
  renderMessages();
  speak(text);
});

window.assistant.onChunk(({ sessionId, text }) => {
  if (!streamSessionId || sessionId !== streamSessionId) return;
  const typing = messagesEl.querySelector('.typing');
  if (!streamMsgEl) {
    if (typing) typing.remove();
    streamMsgEl = document.createElement('div');
    streamMsgEl.className = 'msg assistant streaming';
    messagesEl.appendChild(streamMsgEl);
  }
  streamMsgEl.innerHTML = md(text);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

function autoGrow() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
}

// ---------- voice: text-to-speech ----------
const LS_TTS = 'assistant_tts';
let ttsEnabled = localStorage.getItem(LS_TTS) !== 'off';
let ttsVoices = [];

function refreshVoices() {
  ttsVoices = speechSynthesis ? speechSynthesis.getVoices() : [];
}
if (speechSynthesis) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
}

function pickTurkishVoice() {
  const tr = ttsVoices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('tr'));
  if (tr.length) return tr[0];
  return ttsVoices.find((v) => v.default) || null;
}

function shortenForSpeech(text) {
  let clean = String(text || '');
  // Kod bloklarını ve satır içi kodu çıkar — sesli okumada anlamsız.
  clean = clean.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  // Bağlantılar, markdown işaretleri, emojiler ve gereksiz boşluklar.
  clean = clean.replace(/https?:\/\/[^\s]+/g, ' ').replace(/[*_#>|~\[\]()]/g, ' ').replace(/\d+\.\s/g, ' ');
  clean = clean.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 900) return clean;
  // Uzunsa cümle sınırından kes (ilk ~900 karakter) — tam cümle bitsin.
  const firstSentences = clean.match(/[^.!?…]+[.!?…]+/g) || [];
  let acc = '';
  for (const s of firstSentences) {
    if ((acc + s).length > 900) break;
    acc += s;
  }
  return acc.length > 40 ? acc : clean.slice(0, 900);
}

let currentAudio = null;
let ttsEngine = 'edge'; // edge | piper | system
let piperReady = false;
let piperDownloading = false;

async function refreshVoicePrefs() {
  try {
    const st = await window.assistant.settings.get();
    ttsEngine = st.ttsEngine || 'edge';
    const stt = await window.assistant.tts.status();
    piperReady = !!(stt && stt.piperReady);
    // Edge seçiliyken bile Piper'ı arka planda indir — internet yoksa yedek hazır olsun.
    if (!piperReady && !piperDownloading) {
      piperDownloading = true;
      window.assistant.tts.piper('').then((r) => {
        piperDownloading = false;
        if (r && r.ready) {
          piperReady = true;
        }
      });
    }
  } catch {
    /* yok */
  }
}

function playAudio(dataUrl) {
  stopSpeech();
  currentAudio = new Audio(dataUrl);
  currentAudio.onended = () => (currentAudio = null);
  currentAudio.play().catch(() => {});
}

async function speak(text) {
  if (!ttsEnabled || !text) return;
  const short = shortenForSpeech(text);
  if (!short) return;
  // Motor sırası: seçilen motor → başarısızsa sıradaki → en son Windows sesi.
  const order =
    ttsEngine === 'system' ? ['system'] :
    ttsEngine === 'piper' ? ['piper', 'system'] :
    ['edge', 'piper', 'system'];
  for (const eng of order) {
    try {
      if (eng === 'edge') {
        const r = await window.assistant.tts.edge(short);
        if (r && r.audio) {
          playAudio('data:' + (r.mime || 'audio/mpeg') + ';base64,' + r.audio);
          return;
        }
      } else if (eng === 'piper') {
        if (!piperReady) await window.assistant.tts.piper(''); // indirmeyi tetikle
        const r = await window.assistant.tts.piper(short);
        if (r && r.audio) {
          playAudio('data:' + (r.mime || 'audio/wav') + ';base64,' + r.audio);
          return;
        }
      } else {
        if (!speechSynthesis) continue;
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(short);
        u.lang = 'tr-TR';
        const v = pickTurkishVoice();
        if (v) u.voice = v;
        u.rate = 1.02;
        u.pitch = 1;
        speechSynthesis.speak(u);
        return;
      }
    } catch {
      /* sıradaki motora geç */
    }
  }
}

function stopSpeech() {
  if (speechSynthesis) speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

function toggleTts() {
  ttsEnabled = !ttsEnabled;
  localStorage.setItem(LS_TTS, ttsEnabled ? 'on' : 'off');
  const btn = $('tts-btn');
  if (btn) {
    btn.classList.toggle('active', ttsEnabled);
    btn.title = ttsEnabled ? 'Sesli yanıt: açık' : 'Sesli yanıt: kapalı';
  }
  if (!ttsEnabled) stopSpeech();
}

// ---------- personal settings ----------
let _langAtOpen = 'auto';
async function openSettings() {
  const st = await window.assistant.settings.get();
  _langAtOpen = st.language || 'auto';
  if ($('set-lang')) $('set-lang').value = _langAtOpen;
  $('set-name').value = st.name || '';
  $('set-address').value = st.address || '';
  $('set-style').value = st.style || 'orta';
  $('set-emoji').checked = st.emoji !== false;
  $('set-automemory').checked = st.autoMemory !== false;
  $('set-city').value = st.city || '';
  $('set-morning').checked = st.morningRoutine === true;
  $('set-autobackup').checked = st.autoBackup === true;
  $('set-email').checked = st.emailNotify === true;
  const sm = $('set-model');
  sm.innerHTML = '';
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    sm.appendChild(opt);
  }
  sm.value = st.defaultModel || modelSelect.value;
  $('set-theme').value = st.theme || currentTheme();
  // Ses
  $('set-tts-engine').value = st.ttsEngine || 'edge';
  $('settings-status').textContent = '';
  $('settings-overlay').classList.remove('hidden');
}

function closeSettings() {
  $('settings-overlay').classList.add('hidden');
}

async function saveSettings() {
  const s = {
    name: $('set-name').value.trim(),
    address: $('set-address').value.trim(),
    style: $('set-style').value,
    emoji: $('set-emoji').checked,
    autoMemory: $('set-automemory').checked,
    city: $('set-city').value.trim(),
    morningRoutine: $('set-morning').checked,
    autoBackup: $('set-autobackup').checked,
    emailNotify: $('set-email').checked,
    defaultModel: $('set-model').value,
    theme: $('set-theme').value,
    ttsEngine: $('set-tts-engine') ? $('set-tts-engine').value : 'edge',
    language: $('set-lang') ? $('set-lang').value : 'auto',
  };
  const ok = await window.assistant.settings.set(s);
  const status = $('settings-status');
  if (ok) {
    if (s.defaultModel) {
      modelSelect.value = s.defaultModel;
      localStorage.setItem(LS_MODEL, s.defaultModel);
    }
    applyTheme(s.theme === 'dark' ? 'dark' : 'light');
    refreshVoicePrefs();
    // Dil değiştiyse arayüzü yeniden yükle
    if (s.language && s.language !== _langAtOpen) {
      status.textContent = t('Dil değişti — yeniden yükleniyor…');
      setTimeout(reloadApp, 600);
      return;
    }
    status.textContent = 'Kaydedildi — Harley artık bu tercihlerle konuşuyor';
    setTimeout(closeSettings, 1100);
  } else {
    status.textContent = 'Kaydedilemedi';
  }
}

// ---------- clipboard panel ----------
async function openClipboard() {
  try {
    const list = await window.assistant.clipboard.history();
    renderClipboard(list);
  } catch (e) {
    console.error('[Harley-clipboard]', e);
    renderClipboard([]);
  }
  const ov = $('clipboard-overlay');
  if (ov) ov.classList.remove('hidden');
}

function closeClipboard() {
  $('clipboard-overlay').classList.add('hidden');
}

function renderClipboard(list) {
  const el = $('clipboard-list');
  el.innerHTML = '';
  if (!list || !list.length) {
    el.innerHTML = '<p class="clip-empty">Henüz kopyalanmış bir şey yok — bir şey kopyala, burada belirsin.</p>';
    return;
  }
  for (const c of list) {
    const item = document.createElement('div');
    item.className = 'clip-item';
    const txt = document.createElement('div');
    txt.className = 'clip-text';
    txt.textContent = c.text.length > 240 ? c.text.slice(0, 240) + '…' : c.text;
    const btns = document.createElement('div');
    btns.className = 'clip-actions';
    const mk = (icon, title, fn) => {
      const b = document.createElement('button');
      b.innerHTML = svgIcon(icon, 15);
      b.title = title;
      b.addEventListener('click', fn);
      btns.appendChild(b);
    };
    mk('copy', 'Kopyala', () => window.assistant.clipboard.set(c.text));
    mk('arrow', 'Sohbete gönder', () => {
      window.assistant.clipboard.set(c.text);
      closeClipboard();
      send(c.text);
    });
    mk('sparkle', 'Özetle', () => {
      closeClipboard();
      send('Şunu özetle:\n' + c.text.slice(0, 1500));
    });
    mk('globe', 'Türkçeye çevir', () => {
      closeClipboard();
      send('Bunu Türkçeye çevir:\n' + c.text.slice(0, 1500));
    });
    item.appendChild(txt);
    item.appendChild(btns);
    el.appendChild(item);
  }
}

// ---------- Roblox Studio bağlantı paneli ----------
async function refreshStudio() {
  try {
    const st = await window.assistant.studio.status();
    const dot = $('studio-dot');
    const txt = $('studio-text');
    if (!dot || !txt) return;
    if (st && st.connected) {
      dot.className = 'dot ok';
      txt.textContent = 'bağlı';
    } else if (st && st.mcpUp && !st.studioUp) {
      dot.className = 'dot neutral';
      txt.textContent = 'Studio kapalı';
    } else if (st && st.mcpUp) {
      dot.className = 'dot warn';
      txt.textContent = 'eklenti bağlı değil';
    } else {
      dot.className = 'dot bad';
      txt.textContent = 'MCP sunucusu yok';
    }
  } catch {
    const dot = $('studio-dot');
    if (dot) dot.className = 'dot bad';
  }
}

// ---------- status ----------
async function refreshStatus() {
  try {
    const st = await window.assistant.status();
    if (st.deepseek) {
      statusDot.className = 'dot ok';
      statusText.textContent = 'DeepSeek hazır';
    } else {
      statusDot.className = 'dot bad';
      statusText.textContent = 'DeepSeek anahtarı yok';
    }
  } catch {
    statusDot.className = 'dot bad';
    statusText.textContent = 'Durum alınamadı';
  }
}

// ---------- Spotify mini-player ----------
let spotifyTrack = null;
let spotifyArtist = null;
let spotifyPlaying = false;
let spotifyClosed = false;   // Spotify süreci yok
let spotifyPos = 0;          // saniye cinsinden tahmini konum
let spotifyDur = 0;
let lastTrackKey = '';       // kapak isteği için: son şarkı kimliği

const SP_ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14l-11-7z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
};

function fmtSp(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60);
}

async function refreshSpotify() {
  const bar = $('spotify-bar');
  if (!bar) return;
  // Widget her koşulda GÖRÜNÜR kalmalı — hata olsa bile "Spotify kapalı" gösterir.
  bar.classList.remove('hidden');
  let st;
  try {
    st = await window.assistant.spotify.status();
  } catch (e) {
    if (window.assistant && window.assistant.log) window.assistant.log('spotify:status hatası: ' + (e && e.message));
    st = null;
  }

  const statusEl = $('sp-status');
  const trackEl = $('sp-track');
  const artistEl = $('sp-artist');
  const coverEl = $('sp-cover');
  const playBtn = $('sp-play');
  const posEl = $('sp-pos');
  const durEl = $('sp-dur');
  const prog = $('sp-progress-bar');

  // --- Spotify tamamen kapalı: çubuk görünür ama "kapalı" der ---
  if (!st || !st.running) {
    spotifyClosed = true;
    spotifyPlaying = false;
    bar.classList.remove('hidden');
    bar.classList.add('closed');
    if (statusEl) { statusEl.textContent = 'Spotify kapalı'; statusEl.className = 'sp-status sp-off'; }
    if (trackEl) trackEl.textContent = 'açmak için tıkla';
    if (artistEl) artistEl.textContent = '';
    if (coverEl) coverEl.classList.add('hidden');
    if (playBtn) playBtn.innerHTML = SP_ICONS.play;
    if (posEl) posEl.textContent = '0:00';
    if (durEl) durEl.textContent = '';
    if (prog) prog.style.width = '0%';
    return;
  }
  spotifyClosed = false;
  bar.classList.remove('closed');

  // Spotify açık ama çalan şarkı yok (duraklatılmış veya başka uygulama çalıyor)
  if (!st.track) {
    spotifyPlaying = false;
    spotifyTrack = null;
    spotifyArtist = null;
    spotifyDur = 0;
    if (statusEl) { statusEl.textContent = 'Spotify açık'; statusEl.className = 'sp-status sp-off'; }
    if (trackEl) trackEl.textContent = 'şarkı çalmıyor';
    if (artistEl) artistEl.textContent = '';
    if (coverEl) coverEl.classList.add('hidden');
    if (playBtn) playBtn.innerHTML = SP_ICONS.play;
    if (posEl) posEl.textContent = '0:00';
    if (durEl) durEl.textContent = '';
    if (prog) prog.style.width = '0%';
    return;
  }

  spotifyPlaying = !!st.playing;
  spotifyTrack = st.track;
  spotifyArtist = st.artist || '';
  spotifyDur = st.duration || 0;
  if (st.position !== undefined && st.position !== null) spotifyPos = st.position;

  const key = spotifyTrack + '|' + spotifyArtist;
  if (key !== lastTrackKey) {
    lastTrackKey = key;
    if (coverEl) {
      coverEl.classList.add('hidden');
      window.assistant.spotify.cover(spotifyArtist, spotifyTrack).then((url) => {
        if (url && $('sp-cover')) {
          $('sp-cover').src = url;
          $('sp-cover').classList.remove('hidden');
        }
      }).catch(() => {});
    }
  }

  if (statusEl) {
    statusEl.textContent = spotifyPlaying ? 'Çalıyor' : 'Duraklatıldı';
    statusEl.className = 'sp-status ' + (spotifyPlaying ? 'sp-on' : 'sp-paused');
  }
  if (trackEl) trackEl.textContent = spotifyTrack;
  if (artistEl) artistEl.textContent = spotifyArtist ? spotifyArtist + (st.album ? ' · ' + st.album : '') : (st.album || '');
  if (playBtn) playBtn.innerHTML = spotifyPlaying ? SP_ICONS.pause : SP_ICONS.play;
  if (posEl) posEl.textContent = fmtSp(spotifyPos);
  if (durEl) durEl.textContent = spotifyDur ? fmtSp(spotifyDur) : '';
  if (prog) prog.style.width = (spotifyDur ? Math.min(100, (spotifyPos / spotifyDur) * 100) : 0) + '%';

  // çalan müzik → kedi kulaklık takar + notalar; değilse çıkarır
}

// 1 sn'de bir konumu ilerlet (status 5 sn'de bir tazelenir)
setInterval(() => {
  if (spotifyPlaying && !spotifyClosed) {
    spotifyPos += 1;
    const posEl = $('sp-pos');
    const prog = $('sp-progress-bar');
    if (posEl) posEl.textContent = fmtSp(spotifyPos);
    if (prog) prog.style.width = (spotifyDur ? Math.min(100, (spotifyPos / spotifyDur) * 100) : 0) + '%';
  }
}, 1000);

function wireSpotify() {
  const bar = $('spotify-bar');
  const prev = $('sp-prev'), play = $('sp-play'), next = $('sp-next');
  if (prev) { prev.innerHTML = SP_ICONS.prev; prev.addEventListener('click', (e) => { e.stopPropagation(); window.assistant.spotify.control('prev'); }); }
  if (next) { next.innerHTML = SP_ICONS.next; next.addEventListener('click', (e) => { e.stopPropagation(); window.assistant.spotify.control('next'); }); }
  if (play) { play.innerHTML = SP_ICONS.play; play.addEventListener('click', (e) => { e.stopPropagation(); window.assistant.spotify.control('play'); }); }
  // Progress çubuğuna tıkla → o saniyeye atla
  const prog = $('sp-progress');
  if (prog) prog.addEventListener('click', (e) => {
    e.stopPropagation();
    if (spotifyClosed || !spotifyDur) return;
    const r = prog.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const target = Math.round(ratio * spotifyDur);
    spotifyPos = target;
    window.assistant.spotify.seek(target);
    const posEl = $('sp-pos');
    if (posEl) posEl.textContent = fmtSp(target);
  });
  // Spotify kapalıyken çubuğa tıkla → Spotify'ı aç
  if (bar) bar.addEventListener('click', () => {
    if (spotifyClosed) window.assistant.spotify.control('open');
  });
  refreshSpotify();
  setInterval(refreshSpotify, 2000);
  // Şarkı çalınca (Web API) ana süreç anında bildirir → bar anında tazelenir.
  if (window.assistant.spotify && window.assistant.spotify.onRefresh) {
    window.assistant.spotify.onRefresh(() => { spotifyTrack = null; refreshSpotify(); });
  }
}

// ---------- Focus Mode ----------
let focusTimer = null;
function fmtFocus(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
}

const FOCUS_RING_C = 2 * Math.PI * 52; // r=52 → 326.7
async function renderFocus() {
  const st = await window.assistant.focus.heartbeat();
  const chip = $('focus-chip');
  const ft = $('focus-text');
  const fdot = $('focus-dot');
  const timer = $('focus-timer');
  const ring = $('focus-ring-fill');
  const meta = $('focus-meta');
  const run = $('focus-run');
  const start = $('focus-start');
  const summary = $('focus-summary');
  if (st.state === 'idle') {
    if (chip) { chip.classList.remove('running'); if (ft) ft.textContent = 'başlat'; }
    if (fdot) fdot.className = 'dot neutral';
    if (start) start.classList.remove('hidden');
    if (run) run.classList.add('hidden');
    if (timer) timer.textContent = '25:00';
    if (ring) ring.style.strokeDashoffset = FOCUS_RING_C.toFixed(1);
    if (meta) meta.textContent = '0 dk geçti · 25 dk kaldı';
    return;
  }
  if (chip) { chip.classList.add('running'); if (ft) ft.textContent = st.project + ' · ' + fmtFocus(st.remainingMs); }
  if (fdot) fdot.className = 'dot ' + (st.state === 'paused' ? 'neutral' : 'warn');
  if (timer) timer.textContent = fmtFocus(st.remainingMs);
  const pct = st.minutes ? Math.min(100, Math.max(0, (st.elapsedMs / (st.minutes * 60000)) * 100)) : 0;
  if (ring) ring.style.strokeDashoffset = (FOCUS_RING_C * (1 - pct / 100)).toFixed(1);
  const wrap = $('focus-ring-wrap');
  if (wrap) wrap.classList.toggle('paused', st.state === 'paused');
  if (meta) {
    const el = Math.floor(st.elapsedMs / 60000);
    const rem = Math.max(0, Math.ceil(st.remainingMs / 60000));
    meta.textContent = el + ' dk geçti · ' + rem + ' dk kaldı';
  }
  if (start) start.classList.add('hidden');
  if (run) run.classList.remove('hidden');
  const proj = $('focus-run-proj');
  const goal = $('focus-run-goal');
  if (proj) proj.textContent = st.project;
  if (goal) goal.textContent = st.goal ? 'Hedef: ' + st.goal : '';
  const pauseBtn = $('focus-pause');
  if (pauseBtn) pauseBtn.textContent = st.state === 'running' ? 'Duraklat' : (st.state === 'paused' ? 'Devam' : 'Duraklat');
  if (st.state === 'done' && summary) {
    summary.classList.remove('hidden');
    summary.textContent = 'Oturum tamamlandı: ' + (st.summary.project || '') + ' — ' + st.summary.elapsedMin + ' dk odaklanıldı. İyi iş!';
    if (fdot) fdot.className = 'dot ok';
    stopFocusTimer();
  }
}

function startFocusTimer() {
  stopFocusTimer();
  focusTimer = setInterval(renderFocus, 1000);
}
function stopFocusTimer() {
  if (focusTimer) { clearInterval(focusTimer); focusTimer = null; }
}

function wireFocus() {
  const chip = $('focus-chip');
  const overlay = $('focus-overlay');
  if (!chip || !overlay) return;
  // Hızlı proje çipleri — gerçek taranan projelerden (bir kez, async)
  (async () => {
    const qc = $('focus-quick');
    if (!qc) return;
    try {
      const list = await window.assistant.projects.scan();
      const names = (list || []).slice(0, 6).map((p) => p.name).filter(Boolean);
      if (!names.length) return;
      qc.innerHTML = '';
      for (const n of names) {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'focus-chip2';
        c.textContent = n;
        c.addEventListener('click', () => { const ip = $('focus-project'); if (ip) ip.value = n; });
        qc.appendChild(c);
      }
    } catch { /* çipler opsiyonel */ }
  })();
  chip.addEventListener('click', () => {
    overlay.classList.remove('hidden');
    renderFocus();
  });
  $('focus-close').addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
  $('focus-go').addEventListener('click', async () => {
    const st = await window.assistant.focus.start({
      project: $('focus-project').value,
      goal: $('focus-goal').value,
      minutes: $('focus-minutes').value,
    });
    startFocusTimer();
    renderFocus();
  });
  $('focus-pause').addEventListener('click', async () => {
    const cur = await window.assistant.focus.heartbeat();
    await window.assistant.focus.control(cur.state === 'paused' ? 'resume' : 'pause');
    renderFocus();
  });
  $('focus-stop').addEventListener('click', async () => {
    const st = await window.assistant.focus.control('stop');
    stopFocusTimer();
    renderFocus();
    // Oturum özetini sohbete düşür — Focus Mode "bitince session summary çıkar" prensibi.
    if (st && st.summary && activeSession()) {
      const s = activeSession();
      const dur = (st.summary.elapsedMin || 0) + ' dk';
      const proj = st.summary.project ? ' — ' + st.summary.project : '';
      const goal = st.summary.goal ? '\nHedef: ' + st.summary.goal : '';
      const txt = '🎯 Odak oturumu bitti: ' + dur + proj + goal + (st.summary.finished ? '' : ' (erken sonlandırıldı)') + '\n\nHarley: Odaklanman bitti — iyi iş! Şimdi kısa bir mola ver ya da sonraki hedefe geç.';
      s.messages.push({ role: 'assistant', text: txt, ts: Date.now() });
      saveSessions();
      renderMessages();
    }
  });
}

// ---------- Agent Evolution panel ----------
function wireEvolution() {
  const btn = $('evolution-btn');
  const overlay = $('evolution-overlay');
  if (!overlay) return;
  // Sidebar'daki görünür "Beceriler" butonu
  if (btn) btn.addEventListener('click', openEvolution);
  // Ctrl+E kısayolu
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      overlay.classList.contains('hidden') ? openEvolution() : overlay.classList.add('hidden');
    }
  });
  $('evolution-close').addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
}

async function openEvolution() {
  const overlay = $('evolution-overlay');
  overlay.classList.remove('hidden');
  const statsEl = $('evolution-stats');
  const sugEl = $('evolution-suggest');
  const skillsEl = $('evolution-skills');
  try {
    const skills = await window.assistant.evolution.skills();
    if (skillsEl && Array.isArray(skills) && skills.length) {
      const names = { clock: 'Saat & tarih', date: 'Tarih', 'system-status': 'Sistem durumu (CPU/RAM)', 'open-app': 'Uygulama aç/kapat', 'studio-status': 'Roblox Studio durumu', git: 'Git durumu', 'file-search': 'Dosya ara', reminder: 'Hatırlatıcı', calculator: 'Hesap makinesi', 'file-size': 'Klasör boyutu', 'too-short': 'Kısa mesaj', 'now-playing': 'Şu an ne çalıyor', github: 'GitHub (okuma)', 'project-status': 'Proje durumu' };
      skillsEl.innerHTML = '';
      for (const s of skills) {
        const chip = document.createElement('span');
        chip.className = 'skill-chip';
        chip.textContent = names[s] || s;
        skillsEl.appendChild(chip);
      }
    }
  } catch { /* liste alınamazsa boş kalır */ }
  try {
    const st = await window.assistant.evolution.stats();
    statsEl.innerHTML = '';
    if (!st || !st.rows || !st.rows.length) {
      statsEl.innerHTML = '<p class="ev-row">Henüz veri yok — Harley ile konuştukça burada dolacak.</p>';
    } else {
      const max = Math.max(1, st.rows[0].total);
      for (const r of st.rows.slice(0, 12)) {
        const row = document.createElement('div');
        row.className = 'ev-row';
        const name = document.createElement('span');
        name.className = 'ev-name';
        name.textContent = r.name;
        const bar = document.createElement('span');
        bar.className = 'ev-bar';
        const fill = document.createElement('i');
        fill.style.width = Math.round((r.total / max) * 100) + '%';
        bar.appendChild(fill);
        const count = document.createElement('span');
        count.className = 'ev-count';
        count.textContent = r.total;
        row.appendChild(name); row.appendChild(bar); row.appendChild(count);
        statsEl.appendChild(row);
      }
    }
    const sug = await window.assistant.evolution.suggest();
    sugEl.innerHTML = '';
    if (sug && sug.length) {
      for (const s of sug) {
        const d = document.createElement('div');
        d.className = 'ev-suggest';
        d.innerHTML = '<b>Harley öneriyor:</b> ' + s.text.replace(/</g, '&lt;');
        sugEl.appendChild(d);
      }
    }
  } catch {
    statsEl.innerHTML = '<p class="ev-row">İstatistik alınamadı.</p>';
  }
}

// ---------- Personalization panel ----------
function wirePersonalization() {
  const btn = $('personalization-btn');
  const overlay = $('personalization-overlay');
  if (!overlay) return;
  if (btn) btn.addEventListener('click', openPersonalization);
  $('personalization-close').addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
  $('personalization-save').addEventListener('click', savePersonalization);
  $('p-analyze').addEventListener('click', runRoutineAnalysis);
}

async function openPersonalization() {
  const overlay = $('personalization-overlay');
  overlay.classList.remove('hidden');
  try {
    const p = await window.assistant.personalization.getProfile();
    const cs = p.codeStyle || {};
    const ws = p.writingStyle || {};
    $('p-tone').value = ws.tone || 'professional-friendly';
    $('p-verbosity').value = ws.verbosity || 'balanced';
    $('p-structure').value = ws.structure || 'direct';
    $('p-indent').value = String(cs.indent || 2);
    $('p-quotes').value = cs.quotes || 'single';
    $('p-semicolons').value = cs.semicolons === false ? 'false' : 'true';
    $('p-interests').value = Array.isArray(p.interests) ? p.interests.join(', ') : '';
  } catch { /* sessiz */ }
  runRoutineAnalysis();
}

async function savePersonalization() {
  const status = $('personalization-status');
  const interests = $('p-interests').value.split(',').map((s) => s.trim()).filter(Boolean);
  const updates = {
    writingStyle: {
      tone: $('p-tone').value,
      verbosity: $('p-verbosity').value,
      structure: $('p-structure').value,
    },
    codeStyle: {
      indent: parseInt($('p-indent').value, 10) || 2,
      quotes: $('p-quotes').value,
      semicolons: $('p-semicolons').value === 'true',
    },
    interests,
  };
  const ok = await window.assistant.personalization.updateProfile(updates);
  if (status) status.textContent = ok ? 'Kaydedildi — Harley artık buna göre davranır' : 'Kaydedilemedi';
  setTimeout(() => { if (status) status.textContent = ''; }, 2000);
}

async function runRoutineAnalysis() {
  const body = $('p-insights-body');
  if (!body) return;
  body.innerHTML = '<p class="muted">Analiz ediliyor…</p>';
  try {
    const insights = await window.assistant.personalization.getRoutineInsights();
    const suggestion = await window.assistant.personalization.getProactiveSuggestion();
    const parts = [];
    if (Array.isArray(insights) && insights.length) {
      for (const i of insights) parts.push('<span class="p-insight">• ' + escapeText(i) + '</span>');
    } else {
      parts.push('<p class="muted">Henüz yeterli veri yok — Harley ile çalıştıkça öğrenir.</p>');
    }
    if (suggestion) parts.push('<span class="p-insight p-suggest">💡 ' + escapeText(suggestion) + '</span>');
    body.innerHTML = parts.join('');
  } catch {
    body.innerHTML = '<p class="muted">Analiz alınamadı.</p>';
  }
}

// ---------- Test Runner panel ----------
function wireTestRunner() {
  const btn = $('testrunner-btn');
  const overlay = $('testrunner-overlay');
  if (!overlay) return;
  if (btn) btn.addEventListener('click', openTestRunner);
  $('testrunner-close').addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
  $('tr-run').addEventListener('click', () => runFromUI('run'));
  $('tr-coverage').addEventListener('click', () => runFromUI('coverage'));
  $('tr-gate').addEventListener('click', () => runFromUI('gate'));
}

async function openTestRunner() {
  const overlay = $('testrunner-overlay');
  overlay.classList.remove('hidden');
  const cfgEl = $('tr-config');
  cfgEl.innerHTML = '<p class="muted">Taranıyor…</p>';
  try {
    const cfg = await window.assistant.testRunner.getConfig({ sessionId: activeId });
    if (!cfg) {
        cfgEl.innerHTML = '<p class="muted">' + t('Bu sohbete çalışma klasörü bağlı değil. Footer\'daki klasör (0/1) butonundan bağla.') + '</p>';
      return;
    }
    if (!cfg.framework || cfg.framework === 'none') {
      cfgEl.innerHTML = '<b>Proje:</b> ' + cfg.projectType + '<br>Desteklenen bir test framework\'ü algılanamadı.';
      return;
    }
    cfgEl.innerHTML = '<b>Proje türü:</b> ' + cfg.projectType + ' &nbsp;·&nbsp; <b>Framework:</b> ' + cfg.framework +
      '<br>Watch: ' + (cfg.hasWatch ? 'var' : 'yok') + ' &nbsp;·&nbsp; Coverage: ' + (cfg.hasCoverage ? 'var' : 'yok');
  } catch (e) {
    cfgEl.innerHTML = '<p class="muted">Yapılandırma alınamadı: ' + escapeText(e.message || e) + '</p>';
  }
}

async function runFromUI(mode) {
  const resEl = $('tr-result');
  resEl.classList.remove('hidden');
  resEl.innerHTML = '<div class="tr-running">Çalışıyor… (testler uzun sürebilir)</div>';
  const buttons = [$('tr-run'), $('tr-coverage'), $('tr-gate')];
  buttons.forEach((b) => b && (b.disabled = true));
  try {
    let r;
    if (mode === 'gate') r = await window.assistant.testRunner.prePushGate({ sessionId: activeId, strict: true });
    else r = await window.assistant.testRunner[mode]({ sessionId: activeId });
    renderTestResult(r, mode);
  } catch (e) {
    resEl.innerHTML = '<div class="tr-summary"><span class="bad">Hata</span></div>' + escapeText(e.message || e);
  } finally {
    buttons.forEach((b) => b && (b.disabled = false));
  }
}

function renderTestResult(r, mode) {
  const resEl = $('tr-result');
  if (!r) { resEl.innerHTML = '<div class="tr-summary"><span class="bad">Sonuç yok</span></div>'; return; }
  if (mode === 'gate') {
    const s = (r.result && r.result.summary) || {};
    resEl.innerHTML = '<div class="tr-summary">' +
      '<span class="' + (r.allowPush ? 'ok' : 'bad') + '">' + (r.allowPush ? 'Push serbest ✓' : 'Push engellendi ✗') + '</span>' +
      '<span class="ok">' + (s.passed || 0) + ' geçti</span>' +
      '<span class="bad">' + (s.failed || 0) + ' başarısız</span>' +
      '<span class="skip">' + (s.skipped || 0) + ' atlandı</span></div>' +
      escapeText((r.result && (r.result.stdout || r.result.error)) || r.message || '');
    return;
  }
  if (r.error && !r.stdout) {
    resEl.innerHTML = '<div class="tr-summary"><span class="bad">Hata</span></div>' + escapeText(r.error);
    return;
  }
  const s = r.summary || {};
  const head = '<div class="tr-summary">' +
    '<span class="' + (r.ok ? 'ok' : 'bad') + '">' + (r.ok ? 'Geçti ✓' : 'Başarısız ✗') + '</span>' +
    '<span class="ok">' + (s.passed || 0) + ' geçti</span>' +
    '<span class="bad">' + (s.failed || 0) + ' başarısız</span>' +
    '<span class="skip">' + (s.skipped || 0) + ' atlandı</span>' +
    (s.duration ? '<span class="skip">' + s.duration.toFixed(1) + 's</span>' : '') +
    '</div>';
  resEl.innerHTML = head + escapeText(r.stdout || r.error || '(çıktı yok)');
}

function escapeText(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- Bağlantılar paneli ----------
function wireConnections() {
  const btn = $('connections-btn');
  const overlay = $('connections-overlay');
  if (!overlay) return;
  if (btn) btn.addEventListener('click', openConnections);
  $('connections-close').addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
  overlay.querySelectorAll('[data-conn-save]').forEach((b) => {
    b.addEventListener('click', () => saveConn(b.getAttribute('data-conn-save')));
  });
  overlay.querySelectorAll('[data-conn-test]').forEach((b) => {
    b.addEventListener('click', () => reTestConn(b.getAttribute('data-conn-test')));
  });
  const spotifyConnect = $('conn-spotify-connect');
  if (spotifyConnect) spotifyConnect.addEventListener('click', async () => {
    setConnStatus('Spotify onay sayfası açılıyor…');
    const r = await window.assistant.connections.connectSpotify();
    setConnStatus(r && r.message ? r.message : 'Tarayıcıyı kontrol et.');
    setTimeout(refreshConnStatus, 6000);
  });
  const googleConnect = $('conn-google-connect');
  if (googleConnect) googleConnect.addEventListener('click', async () => {
    setConnStatus('Google onay sayfası açılıyor… (tarayıcıda izin ver)');
    const r = await window.assistant.connections.connectGoogle();
    setConnStatus(r && r.message ? r.message : 'Tarayıcıyı kontrol et.');
    refreshConnStatus();
  });
}

function setConnStatus(msg) {
  const el = $('connections-status');
  if (el) el.textContent = msg || '';
}

async function saveConn(which) {
  setConnStatus('Kaydediliyor ve test ediliyor…');
  let r;
  try {
    if (which === 'deepseek') r = await window.assistant.connections.saveDeepseek($('conn-deepseek').value.trim());
    else if (which === 'github') r = await window.assistant.connections.saveGithub($('conn-github').value.trim());
    else if (which === 'spotify') r = await window.assistant.connections.saveSpotify($('conn-spotify').value.trim());
    else if (which === 'google') r = await window.assistant.connections.saveGoogle($('conn-google-id').value.trim(), $('conn-google-secret').value.trim());
  } catch (e) { r = { ok: false, message: String(e.message || e) }; }
  setConnStatus(r && r.message ? r.message : (r && r.ok ? 'Kaydedildi.' : 'Kaydedilemedi.'));
  refreshConnStatus();
}

async function refreshConnStatus() {
  try {
    const st = await window.assistant.connections.status();
    const dot = (id, ok, onText, offText) => {
      const el = $(id);
      if (!el) return;
      el.textContent = ok ? (onText || 'Bağlı ✓') : (offText || 'bağlı değil');
      el.classList.toggle('conn-on', !!ok);
    };
    dot('conn-dot-deepseek', st.deepseek, 'Bağlı ✓', 'anahtar yok');
    dot('conn-dot-github', st.github, st.githubLogin ? ('@' + st.githubLogin) : 'Bağlı ✓', 'token yok');
    dot('conn-dot-spotify', st.spotify, 'Bağlı ✓', st.spotifyConfigured ? 'Client ID var, bağlan' : 'ayarlı değil');
    dot('conn-dot-google', st.google, 'Bağlı ✓', 'ayarlı değil');
    // Son test zamanı/sonucu
    const tests = st.tests || {};
    const last = (id, key) => {
      const el = $(id);
      if (!el) return;
      const t = tests[key];
      if (!t) { el.textContent = 'Henüz test edilmedi'; el.className = 'conn-last'; return; }
      const d = new Date(t.ts);
      const when = d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      el.textContent = 'Son test: ' + when + ' · ' + (t.ok ? 'başarılı' : 'başarısız');
      el.className = 'conn-last' + (t.ok ? ' ok' : ' err');
    };
    last('conn-last-deepseek', 'deepseek');
    last('conn-last-github', 'github');
    last('conn-last-spotify', 'spotify');
    last('conn-last-google', 'google');
  } catch { /* yok */ }
}

async function reTestConn(name) {
  setConnStatus('Test ediliyor…');
  let r;
  try { r = await window.assistant.connections.test(name); } catch (e) { r = { ok: false, message: String(e.message || e) }; }
  setConnStatus(r && r.message ? r.message : (r && r.ok ? 'Bağlı.' : 'Başarısız.'));
  refreshConnStatus();
}

async function openConnections() {
  const overlay = $('connections-overlay');
  overlay.classList.remove('hidden');
  setConnStatus('');
  refreshConnStatus();
}

// ---------- Task Planner ----------
let activeTask = null;

async function loadActiveTask() {
  try {
    activeTask = await window.assistant.task.active();
    renderTaskPanel();
  } catch { activeTask = null; }
}

function renderTaskPanel() {
  const panel = $('task-panel');
  const title = $('task-title');
  const stepsEl = $('task-steps');
  const bar = $('task-progress-bar');
  const count = $('task-count');
  if (!panel) return;

  if (!activeTask) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  if (title) title.textContent = activeTask.description;

  const done = activeTask.steps.filter(s => s.done).length;
  const total = activeTask.steps.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  if (bar) bar.style.width = pct + '%';
  if (count) count.textContent = done + '/' + total;

  if (stepsEl) {
    stepsEl.innerHTML = activeTask.steps.map((s, i) => {
      const cls = s.done ? 'task-step done' : (s.startedAt && !s.done ? 'task-step active' : 'task-step');
      return '<div class="' + cls + '" data-step-id="' + s.id + '">' +
        '<div class="task-check"></div>' +
        '<span class="task-step-text">' + (i + 1) + '. ' + escapeHtml(s.text) + '</span>' +
        '</div>';
    }).join('');

    // Tıklama ile tamamla/başlat
    stepsEl.querySelectorAll('.task-step').forEach((el) => {
      el.addEventListener('click', async () => {
        const stepId = parseInt(el.dataset.stepId);
        const step = activeTask.steps.find(s => s.id === stepId);
        if (!step) return;
        if (!step.done) {
          if (!step.startedAt) {
            await window.assistant.task.startStep(stepId);
            step.startedAt = new Date().toISOString();
          } else {
            await window.assistant.task.completeStep(stepId);
            step.done = true;
            step.completedAt = new Date().toISOString();
          }
          renderTaskPanel();
          // Tümü tamamlandıysa kapat
          if (activeTask.steps.every(s => s.done)) {
            activeTask = null;
            renderTaskPanel();
          }
        }
      });
    });
  }
}

// ---------- Kullanıcı onayı (git push / repo oluşturma vb.) ----------
// Ana süreç onay isteği gönderir; basit bir overlay ile Evet/Hayır sorulur.
function wireApproval() {
  if (!window.assistant.approval || !window.assistant.approval.onRequest) return;
  let overlay = null;
  window.assistant.approval.onRequest((p) => {
    if (!p || !p.id) return;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'approval-overlay hidden';
      overlay.innerHTML = '<div class="approval-box">' +
        '<div class="approval-title" id="approval-title"></div>' +
        '<div class="approval-msg" id="approval-msg"></div>' +
        '<div class="approval-actions">' +
        '<button id="approval-yes" class="approval-btn approval-yes">' + t('Evet, onayla') + '</button>' +
        '<button id="approval-no" class="approval-btn approval-no">' + t('Hayır') + '</button>' +
        '</div></div>';
      document.body.appendChild(overlay);
    }
    const title = overlay.querySelector('#approval-title');
    const msg = overlay.querySelector('#approval-msg');
    const yes = overlay.querySelector('#approval-yes');
    const no = overlay.querySelector('#approval-no');
    title.textContent = p.title || 'Onay gerekiyor';
    // Mesajı güvenli şekilde göster; diff satırları renkli (eklenen + yeşil, silinen - kırmızı)
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = String(p.message || '').split('\n');
    const html = lines.map((ln) => {
      const t = ln.startsWith('+') ? 'diff-add' : ln.startsWith('-') ? 'diff-del' : '';
      return '<div class="approval-line ' + t + '">' + esc(ln).replace(/\s/g, '&nbsp;') + '</div>';
    }).join('');
    msg.innerHTML = html;
    const finish = (approved) => {
      overlay.classList.add('hidden');
      yes.onclick = null;
      no.onclick = null;
      window.assistant.approval.respond(p.id, approved);
    };
    yes.onclick = () => finish(true);
    no.onclick = () => finish(false);
    overlay.classList.remove('hidden');
  });
}

function wireTaskPanel() {
  const closeBtn = $('task-close');
  const cancelBtn = $('task-cancel');
  if (closeBtn) closeBtn.addEventListener('click', () => {
    $('task-panel').classList.add('hidden');
  });
  if (cancelBtn) cancelBtn.addEventListener('click', async () => {
    await window.assistant.task.cancel();
    activeTask = null;
    renderTaskPanel();
  });
  // Model task_plan/task_mark_done araçlarını kullandığında planı canlı güncelle
  if (window.assistant.task && window.assistant.task.onUpdate) {
    window.assistant.task.onUpdate((task) => {
      // Plan tamamlandıysa tracker ve paneli KAPAT, temizle
      if (task && task.completedAt) {
        activeTask = null;
        renderTaskPanel();
        const te = $('inline-tracker');
        if (te) te.classList.add('hidden');
        return;
      }
      activeTask = task;
      renderTaskPanel();
      const done = task && task.steps ? task.steps.filter((s) => s.done).length : 0;
      const total = task && task.steps ? task.steps.length : 0;
      const te = $('inline-tracker');
      const ts = $('tracker-steps');
      const tp = $('tracker-progress');
      if (te && ts && task) {
        te.classList.remove('hidden');
        if (tp) tp.style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
        ts.innerHTML = task.steps.map((st, i) => {
          const cls = st.done ? 'tracker-step done' : (i === done ? 'tracker-step active' : 'tracker-step');
          return '<span class="' + cls + '"><span class="tracker-step-dot"></span>' + (i + 1) + '</span>';
        }).join('');
      }
    });
  }
  // Tool çalışırken gösterge: "Dosya yazılıyor", "Komut çalıştırılıyor" vb.
  if (window.assistant.tool && window.assistant.tool.onProgress) {
    window.assistant.tool.onProgress((p) => {
      const toolEl = $('tool-indicator');
      const toolNameEl = $('tool-name');
      if (!toolEl || !toolNameEl) return;
      if (p && p.label) {
        toolEl.classList.remove('hidden');
        toolNameEl.textContent = p.label + '…';
      } else {
        toolEl.classList.add('hidden');
      }
    });
  }
}

// Görev mesajı geldiğinde otomatik oluştur
async function handleTaskMessage(text) {
  try {
    const model = modelSelect.value;
    activeTask = await window.assistant.task.create(text, model);
    renderTaskPanel();
    return 'Görev planı oluşturuldu! ' + activeTask.steps.length + ' adım var. İlerlemek için adımlara tıkla.';
  } catch {
    return null;
  }
}

// ---------- Ana Menü (hub) ----------
const HUB_PROMPTS = [
  { icon: 'briefcase', cat: 'İş / Proje', items: [
    { t: 'Günün özetini çıkar', q: 'Bana günün özetini çıkar' },
    { t: 'Okunmamış e-postalarım', q: 'Okunmamış e-postalarım neler?' },
    { t: 'Görevlerim', q: 'Görevlerimin durumu ne?' },
    { t: 'Takvime etkinlik ekle', q: 'Bugün 14:00\'e 30 dakikalık bir toplantı ekle' },
    { t: 'Proje durumunu özetle', q: 'Projelerimin son durumunu özetle' },
    { t: 'Drive dosyasını özetle', q: 'Google Drive\'daki "Yoklama" dosyasını özetle' },
  ]},
  { icon: 'wrench', cat: 'Proje / Git', items: [
    { t: 'Git durumunu göster', q: 'git_status aracıyla çalışma klasörünün durumunu göster' },
    { t: 'Değişiklikleri göster', q: 'git_diff ile son değişiklikleri göster' },
    { t: 'Commit et', q: 'Tüm değişiklikleri commit et (git_commit), mantıklı bir mesaj yaz' },
    { t: 'Push et', q: 'Commit\'leri GitHub\'a push et (git_push)' },
    { t: 'Repo oluştur', q: 'Bu klasörü GitHub\'da yeni repo yap (git_create_repo)' },
    { t: 'Repoya bağlan', q: 'Bu klasörü mevcut bir GitHub repoya bağla (git_link_repo)' },
    { t: 'Yeni branch', q: 'git_branch ile yeni bir branch oluştur ve ona geç' },
    { t: 'Proje şablonu kur', q: 'scaffold_project ile bir proje şablonu kur (React)' },
    { t: 'Issue\'ları listele', q: 'github_issues ile bağlı reponun açık issue\'larını listele' },
    { t: 'Doküman üret', q: 'generate_docs ile README ve CHANGELOG oluştur' },
  ]},
  { icon: 'game', cat: 'Eğlence / Farklılık', items: [
    { t: 'Bir oyun başlat', q: 'Bir oyun oynayalım (Sayı Tahmin)' },
    { t: 'Kelime Avı', q: 'Kelime Avı oyunu oyna' },
    { t: '20 Soru', q: '20 Soru oynayalım' },
    { t: 'Şehir-Ülke-Meyve', q: 'Şehir-Ülke-Meyve oyna' },
    { t: 'Hikâye tamamla', q: 'Bir hikâye tamamlayalım' },
    { t: 'Günlük motivasyon', q: 'Bana günlük motivasyon ver' },
    { t: 'İlginç bir bilgi', q: 'İlginç bir bilgi söyle' },
    { t: 'Günün şarkısı', q: 'Bugünün şarkısı ne?' },
  ]},
];
function showHub() {
  if (!hubEl) return;
  hubEl.classList.remove('hidden');
  messagesEl.classList.add('hidden');
  // Hub'da footer'ı gizle
  const footer = document.querySelector('footer');
  if (footer) footer.classList.add('hidden');
  const fp = $('file-preview');
  if (fp) fp.classList.add('hidden');
  renderHub();
  updateHeader();
  const tp = $('task-panel');
  if (tp) tp.classList.add('hidden');
}
function showChat() {
  if (!hubEl) return;
  hubEl.classList.add('hidden');
  messagesEl.classList.remove('hidden');
  // Footer'ı göster
  const footer = document.querySelector('footer');
  if (footer) footer.classList.remove('hidden');
  // Busy state'i sıfırla (sohbet değiştirince sorun olmasın)
  if (busy) {
    setBusy(false);
    const typing = messagesEl.querySelector('.typing');
    if (typing) typing.remove();
    const toolEl = $('tool-indicator');
    if (toolEl) toolEl.classList.add('hidden');
    const trackerEl = $('inline-tracker');
    if (trackerEl) trackerEl.classList.add('hidden');
  }
  renderTaskPanel();
  updateHeader();
}
// Hub veri önbelleği — panelleri her açışta disk/git taraması yapmamak için (kasma önleyici)
const _hubCache = { usageTs: 0, usage: null, projTs: 0, proj: null, promptsBuilt: false, workspaces: null, wsTs: 0 };
async function renderHub() {
  if (!hubEl) return;
  // Canlı saat + tarih
  const tickClock = () => {
    const c = $('hub-clock'), d = $('hub-date');
    if (!c) return;
    const now = new Date();
    c.textContent = now.toLocaleTimeString(LANG === 'en' ? 'en-US' : 'tr-TR', { hour: '2-digit', minute: '2-digit' });
    if (d) d.textContent = now.toLocaleDateString(LANG === 'en' ? 'en-US' : 'tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  tickClock();
  if (!window.__hubClockTimer) {
    window.__hubClockTimer = setInterval(() => {
      if (hubEl && !hubEl.classList.contains('hidden')) tickClock();
    }, 15000);
  }
  // Kart ikonları (bir kez)
  [['ic-usage', 'chart'], ['ic-workspaces', 'folder'], ['ic-projects', 'folder'], ['ic-prompts', 'zap'], ['ic-quick', 'search'], ['ic-ozet', 'sun'], ['ic-errors', 'gear']].forEach(([id, n]) => {
    const el = $(id);
    if (el && !el.innerHTML) setIcon(el, n, 15);
  });
  // Günün özeti önizleme (arka planda, hub'ı bekletmez, oturumda bir kez)
  if (!$('hub-ozet-preview').dataset.loaded) {
    $('hub-ozet-preview').dataset.loaded = '1';
    window.assistant.send('Bana günün özetini çıkar', modelSelect.value, 'ozet-preview-' + Date.now()).then((r) => {
      const p = $('hub-ozet-preview');
      if (!p) return;
      if (r && r.output) {
        p.textContent = String(r.output).slice(0, 220) + (String(r.output).length > 220 ? '…' : '');
      } else if (r && r.error) {
        p.textContent = t('Özet alınamadı: ') + r.error;
      }
    }).catch(() => {});
  }
  // İsim (ucuz — her açılışta taze tut)
  try {
    const st = await window.assistant.settings.get();
    const n = $('hub-name');
    if (n) n.textContent = (st && st.name) ? st.name : t('dostum');
  } catch { /* varsayılan */ }
  // Token panosu (5 sn önbellek)
  try {
    let u = _hubCache.usage;
    if (!u || Date.now() - _hubCache.usageTs > 5000) {
      u = await window.assistant.usage.get();
      _hubCache.usage = u;
      _hubCache.usageTs = Date.now();
    }
    const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || 0);
    // DeepSeek dashboard tarzi canvas grafik
    const totalEl = $('usage-total');
    const reqCountEl = $('usage-req-count');
    const tokenCountEl = $('usage-token-count');
    const avgEl = $('usage-avg');
    if (totalEl) totalEl.textContent = fmt(u.total || 0);
    if (reqCountEl) {
      const totalMsgs = (u.days || []).reduce((s, d) => s + (d.msgs || 0), 0);
      reqCountEl.textContent = String(totalMsgs);
    }
    if (tokenCountEl) tokenCountEl.textContent = fmt(u.total || 0);
    if (avgEl) {
      const days = (u.days || []).length || 1;
      avgEl.textContent = fmt(Math.round((u.total || 0) / days)) + t('/gun');
    }
    // GitHub istek sayacı + bütçe doluluk (görsel takip)
    const ghCountEl = $('usage-gh-count');
    const ghTodayEl = $('usage-gh-today');
    if (ghCountEl) ghCountEl.textContent = String((u.github && u.github.count) || 0);
    if (ghTodayEl) ghTodayEl.textContent = String((u.github && u.github.today) || 0);
    const budgetFillEl = $('usage-budget-fill');
    const budgetLabelEl = $('usage-budget-label');
    if (budgetFillEl && u.budget) {
      const pct = Math.min(100, Math.round((u.budget.used / Math.max(1, u.budget.max)) * 100));
      budgetFillEl.style.width = pct + '%';
      budgetFillEl.classList.toggle('usage-budget-full', u.budget.bypass || pct >= 100);
      if (budgetLabelEl) {
        budgetLabelEl.textContent = u.budget.bypass
          ? t('Bütçe koruması kapalı — ') + fmt(u.budget.used) + ' / ' + fmt(u.budget.max)
          : fmt(u.budget.used) + ' / ' + fmt(u.budget.max) + ' (' + pct + '%)';
      }
    }
    // Tab degisimi
    document.querySelectorAll('.usage-tab').forEach((tab) => {
      tab.onclick = () => {
        document.querySelectorAll('.usage-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const m = tab.dataset.utab;
        const mode = m === 'requests' ? 'requests' : m === 'github' ? 'github' : 'tokens';
        if (window.__usageChart) window.__usageChart.setData(u.days || [], mode, u.githubDays || []);
      };
    });
    // Canvas chart ciz
    if (window.__usageChart) {
      window.__usageChart.setData(u.days || [], 'tokens', u.githubDays || []);
    } else {
      window.__usageChart = new UsageChart('usage-canvas');
      window.__usageChart.setData(u.days || [], 'tokens', u.githubDays || []);
    }
    // Model dağılımı (en çok kullanılan 3)
    const modelsEl = $('usage-models');
    if (modelsEl) {
      const ms = u.models || [];
      if (!ms.length) { modelsEl.innerHTML = ''; }
      else {
        modelsEl.innerHTML = ms.slice(0, 3).map((mm) => {
          const mt = (mm.input || 0) + (mm.output || 0);
          const pct = Math.round((mt / Math.max(1, u.total || 0)) * 100);
          const short = String(mm.id || '').replace(/^deepseek\//i, '').replace(/^ollama\//i, '').replace(/^n8n\//i, '');
          return '<span class="um-row" title="' + escapeHtml(mm.id) + '"><i></i><b>' + escapeHtml(short) + '</b><em>' + pct + '%</em></span>';
        }).join('');
      }
    }
  } catch { /* pano yok */ }
  // Projeler (20 sn önbellek — git taraması pahalı)
  try {
    let list = _hubCache.proj;
    if (!list || Date.now() - _hubCache.projTs > 20000) {
      list = await window.assistant.projects.scan();
      _hubCache.proj = list;
      _hubCache.projTs = Date.now();
    }
    const el = $('hub-proj-list');
    if (el && !projSearchActive) {
      if (!list || !list.length) { el.innerHTML = '<p class="muted">' + t('Proje bulunamadı — git repo\'su olan klasörler taranır.') + '</p>'; }
      else {
        el.innerHTML = '';
        for (const p of list.slice(0, 6)) {
          const b = document.createElement('button');
          b.className = 'proj-item';
          b.innerHTML = '<span class="proj-name">' + escapeHtml(p.name) + '</span>' +
            '<span class="proj-meta">' + (p.changedFiles ? p.changedFiles + t(' değişiklik') : t('temiz')) + (p.lastCommit ? ' · ' + escapeHtml(p.lastCommit) : '') + '</span>';
          b.addEventListener('click', () => { openProjectSearch(p.name, p.dir); });
          el.appendChild(b);
        }
      }
    }
  } catch { /* taranamadı */ }
  // Çalışma Alanları: bağlı klasörler + repo durumu (10 sn önbellek)
  try {
    let ws = _hubCache.workspaces;
    if (!ws || Date.now() - _hubCache.wsTs > 10000) {
      ws = await window.assistant.workspace.listAll();
      _hubCache.workspaces = ws;
      _hubCache.wsTs = Date.now();
    }
    const wsel = $('hub-ws-list');
    if (wsel) {
      if (!ws || !ws.length) {
        wsel.innerHTML = '<p class="muted">' + t('Henüz çalışma alanı yok — bir klasör bağla ve proje geliştirmeye başla.') + '</p>';
      } else {
        wsel.innerHTML = ws.slice(0, 6).map((w) => {
          const icon = w.type === 'Python' ? 'python' : w.type === 'Node' ? 'nodejs' : 'folder';
          const repoBadge = w.repo
            ? '<span class="proj-meta ws-repo">' + svgIcon('refresh', 11) + ' ' + escapeHtml(w.repo.name) + '</span>'
            : '<span class="proj-meta ws-norepo">' + t('repo yok') + '</span>';
          return '<div class="proj-item">' +
            '<span class="proj-name">' + svgIcon(icon, 13) + ' ' + escapeHtml(w.name) + '</span>' +
            '<span class="proj-meta">' + (w.gitRepo ? '· git' : '') + (w.hasRemote ? ' · remote' : '') + '</span>' + repoBadge +
            '</div>';
        }).join('');
      }
    }
  } catch { /* yok */ }
  // Son Hatalar (diagnostik — son 6 error log)
  try {
    const errs = await window.assistant.logs.errors(6);
    const el = $('hub-err-list');
    if (el) {
      if (!errs || !errs.length) {
        el.innerHTML = '<p class="muted">' + t('Kayıtlı hata yok.') + '</p>';
      } else {
        el.innerHTML = errs.map((e) =>
          '<div class="err-item"><span class="err-meta">' + escapeHtml(e.ts.slice(11, 19)) + ' · ' + escapeHtml(e.source) + '</span><span class="err-msg">' + escapeHtml(e.message || '').slice(0, 80) + '</span></div>'
        ).join('');
      }
    }
  } catch { /* yok */ }
  // Hazır sorular (bir kez kur, sonra dokunma)
  const hp = $('hub-prompts');
  if (hp && !_hubCache.promptsBuilt) {
    _hubCache.promptsBuilt = true;
    hp.innerHTML = HUB_PROMPTS.map((g) =>
      '<div class="bag-group"><div class="bag-group-title">' + (g.icon ? svgIcon(g.icon, 14) : '') + ' ' + escapeHtml(g.cat) + '</div>' +
      g.items.map((it) => '<button class="bag-item" data-q="' + escapeHtml(it.q).replace(/"/g, '&quot;') + '">' + escapeHtml(it.t) + '</button>').join('') +
      '</div>').join('');
    hp.querySelectorAll('.bag-item').forEach((b) =>
      b.addEventListener('click', () => { showChat(); inputEl.value = b.dataset.q; inputEl.focus(); }));
  }
}
function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
let projSearchActive = null;
// Proje içi metin arama — sonuçlar hub'da gösterilir, tıklayınca sohbete dosya içeriği gider
async function openProjectSearch(name, dir) {
  projSearchActive = name;
  const el = $('hub-proj-list');
  if (!el) return;
  el.innerHTML = '';
  const back = document.createElement('button');
  back.className = 'proj-item proj-back';
  back.innerHTML = '<span class="proj-name">← ' + escapeHtml(name) + ' — içinde ara</span>';
  back.addEventListener('click', renderHub);
  el.appendChild(back);
  const input = document.createElement('input');
  input.className = 'proj-search';
  input.placeholder = 'Kelime ara (örn. checkpoint, RoundManager, MCP)…';
  el.appendChild(input);
  const res = document.createElement('div');
  res.className = 'proj-results';
  el.appendChild(res);
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { res.innerHTML = ''; return; }
      res.innerHTML = '<p class="muted">Aranıyor…</p>';
      try {
        const r = await window.assistant.projects.search(name, q);
        if (!r || r.error) { res.innerHTML = '<p class="muted">' + escapeHtml(r && r.error || 'Hata') + '</p>'; return; }
        if (!r.results.length) { res.innerHTML = '<p class="muted">Eşleşme yok.</p>'; return; }
        res.innerHTML = '';
        for (const hit of r.results.slice(0, 10)) {
          const b = document.createElement('button');
          b.className = 'proj-hit';
          b.innerHTML = '<span class="proj-hit-file">' + escapeHtml(hit.file) + '</span><span class="proj-hit-line">' + escapeHtml(hit.line) + '</span>';
          b.addEventListener('click', () => {
            // Dosyayı okuyup sohbete gönder (gerçek RAG hissi) — dir, scan sonucundan gelir
            window.assistant.files.readPath(String(dir || '') + '/' + hit.file).then((fr) => {
              if (fr && fr.ok && fr.type === 'text') {
                showChat();
                send('📎 ' + hit.file + ' dosyasındaki "' + q + '" eşleşmesi (proje: ' + name + '):\n\n' + (fr.content || '').slice(0, 6000));
              } else {
                showChat();
                send('Proje ' + name + ' — ' + hit.file + ' dosyasında "' + q + '" geçiyor. İçeriğini incele.');
              }
            });
          });
          res.appendChild(b);
        }
      } catch { res.innerHTML = '<p class="muted">Arama hatası.</p>'; }
    }, 350);
  });
  input.focus();
}

// ---------- init ----------
(async function init() {
  await initLang();
  applyI18n();
  // Dinamik eklenen metinleri otomatik çevir (EN modunda, sözlükte karşılığı varsa).
  if (LANG === 'en' && window.MutationObserver) {
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') { if (m.target && m.target.parentNode) applyI18n(m.target.parentNode); continue; }
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) applyI18n(n);
          else if (n.nodeType === 3 && n.parentNode) applyI18n(n.parentNode);
        });
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  models = await window.assistant.models();
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    modelSelect.appendChild(opt);
  }
  const saved = localStorage.getItem(LS_MODEL);
  if (saved && models.some((m) => m.id === saved)) modelSelect.value = saved;
  modelSelect.addEventListener('change', () =>
    localStorage.setItem(LS_MODEL, modelSelect.value));

  if (!activeSession()) newSession();
  renderSidebar();
  renderMessages();
  updateHeader();

  // ---------- Ana Menü (hub) ----------
  setIcon($('home-btn'), 'home', 15);
  $('home-btn').insertAdjacentHTML('beforeend', '<span></span>');
  $('home-btn').lastChild.textContent = t('Ana Menü');
  $('home-btn').addEventListener('click', showHub);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); showHub(); }
  });
  // Sidebar toggle (başlık satırındaki buton + daraltılmışken logoya tıkla-genişlet)
  const sidebarToggle = $('sidebar-toggle');
  const sideLogo = document.querySelector('.side-logo');
  const setCollapsed = (collapsed) => {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0');
    if (sidebarToggle) sidebarToggle.title = collapsed ? 'Menüyü genişlet' : 'Menüyü daralt';
    if (sideLogo) sideLogo.title = collapsed ? 'Menüyü genişlet' : '';
  };
  if (sidebarToggle) {
    setIcon(sidebarToggle, 'menu', 16);
    sidebarToggle.addEventListener('click', () => {
      setCollapsed(!document.body.classList.contains('sidebar-collapsed'));
    });
  }
  if (sideLogo) sideLogo.addEventListener('click', () => setCollapsed(false));
  // Kaydedilmiş sidebar durumunu uygula
  if (localStorage.getItem('sidebar_collapsed') === '1') {
    document.body.classList.add('sidebar-collapsed');
  }
  setCollapsed(document.body.classList.contains('sidebar-collapsed'));
  // Kart aksiyonları
  hubEl.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.action;
      if (act === 'chat') showChat();
      else if (act === 'summary') { showChat(); send('Bana günün özetini çıkar'); }
      else if (act === 'focus') { const ov = $('focus-overlay'); if (ov) { ov.classList.remove('hidden'); renderFocus(); } }
      else if (act === 'evolution') openEvolution();
      else if (act === 'memory') openMemory();
      else if (act === 'clipboard') openClipboard();
      else if (act === 'usage') renderHub();
      else if (act === 'projects') renderHub();
      else if (act === 'prompts') renderHub();
    });
  });
  // Başlangıçta hub'ı göster (platform hissi — sohbet yerine menü açılır)
  showHub();
  wireGuide();
  setIcon($('guide-btn-ic'), 'book', 15);
  setIcon($('guide-head-ic'), 'book', 18);
  // İlk açılışta önce kısa rehber (onboarding), sonra kurulum sihirbazı.
  // Rehber zaten görülmüşse doğrudan sihirbaz açılır.
  setTimeout(async () => {
    const shown = maybeShowOnboarding();
    if (!shown) maybeShowSetup();
  }, 800);

  // statik buton ikonları (minimalist SVG, emoji yok)
  setIcon($('new-chat'), 'plus', 15);
  setIcon($('memory-btn'), 'book', 15);
  setIcon($('clipboard-btn'), 'clipboard', 15);
  setIcon($('evolution-btn'), 'sparkle', 15);
  setIcon($('personalization-btn'), 'bulb', 15);
  setIcon($('testrunner-btn'), 'chart', 15);
  setIcon($('connections-btn'), 'globe', 15);
  setIcon($('settings-btn'), 'gear', 17);
  setIcon($('tts-btn'), 'speaker', 17);
  setIcon($('send'), 'send', 17);
  setIcon($('bag-btn-work'), 'bag', 17);
  setIcon($('bag-btn-fun'), 'game', 17);
  setIcon($('bag-btn-git'), 'git', 17);
  setIcon($('bag-gi-work'), 'briefcase', 14);
  setIcon($('bag-gi-git'), 'wrench', 14);
  setIcon($('bag-gi-fun'), 'game', 14);
  setIcon($('ws-ic'), 'folder', 16);
  setIcon($('clipboard-clear'), 'trash', 15);
  ['new-chat', 'memory-btn', 'clipboard-btn', 'evolution-btn', 'personalization-btn', 'testrunner-btn', 'connections-btn'].forEach((id) => {
    const el = $(id);
    if (el) el.insertAdjacentHTML('beforeend', '<span></span>');
  });
  $('new-chat').lastChild.textContent = t('Yeni Sohbet');
  $('memory-btn').lastChild.textContent = t('Bellek');
  $('clipboard-btn').lastChild.textContent = t('Pano');
  $('evolution-btn').lastChild.textContent = t('Beceriler');
  $('personalization-btn').lastChild.textContent = t('Kişiselleştir');
  $('testrunner-btn').lastChild.textContent = t('Testler');
  $('connections-btn').lastChild.textContent = t('Bağlantılar');
  setIcon($('attach-btn'), 'attach', 15);

  // ---------- dosya ekleme ----------
  const attachBtn = $('attach-btn');
  const fileInput = $('file-input');
  const filePreviewEl = $('file-preview');
  const filePreviewInner = $('file-preview-inner');

  // Dosyayı File API ile okur (Electron File.path kaldırıldığı için güvenilir yol).
  function handleFileObj(file) {
    return new Promise((resolve) => {
      if (!file) return resolve();
      const name = file.name || 'dosya';
      const isImg = file.type && file.type.startsWith('image/');
      const size = file.size || 0;
      if (isImg) {
        const rd = new FileReader();
        rd.onload = () => {
          attachedFiles.push({ name, type: 'image', content: rd.result || '', note: 'Görsel dosya — model görseli göremez, yalnızca ad eklendi.', preview: rd.result || null, path: null });
          renderFilePreview();
          resolve();
        };
        rd.readAsDataURL(file);
        return;
      }
      if (size > 500000) {
        attachedFiles.push({ name, type: 'file', content: '', note: 'Dosya 500 KB\'tan büyük — içerik okunamadı, yalnızca ad eklendi.', preview: null, path: null });
        renderFilePreview();
        return resolve();
      }
      const rd = new FileReader();
      rd.onload = () => {
        attachedFiles.push({ name, type: 'text', content: String(rd.result || ''), note: '', preview: null, path: null });
        renderFilePreview();
        resolve();
      };
      rd.onerror = () => resolve();
      rd.readAsText(file);
    });
  }

  if (attachBtn) {
    attachBtn.addEventListener('click', () => {
      if (fileInput) fileInput.click();
    });
  }
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (f) await handleFileObj(f);
    });
  }

  function renderFilePreview() {
    if (!filePreviewInner) return;
    filePreviewInner.innerHTML = '';
    if (attachedFiles.length === 0) {
      if (filePreviewEl) filePreviewEl.classList.add('hidden');
      return;
    }
    if (filePreviewEl) filePreviewEl.classList.remove('hidden');
    attachedFiles.forEach((f, idx) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      // Önizleme: fotoğraf varsa img, PDF ise icon, diğerleri icon
      if (f.preview) {
        const img = document.createElement('img');
        img.className = 'file-chip-preview';
        img.src = f.preview;
        chip.appendChild(img);
      } else {
        const iconDiv = document.createElement('div');
        iconDiv.className = 'file-chip-icon';
        const isPdf = f.name && f.name.toLowerCase().endsWith('.pdf');
        const isImage = f.type === 'image' || (f.name && /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(f.name));
        if (isPdf) {
          iconDiv.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
        } else if (isImage) {
          iconDiv.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
        } else {
          iconDiv.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
        }
        chip.appendChild(iconDiv);
      }
      const nameSpan = document.createElement('span');
      nameSpan.className = 'file-chip-name';
      nameSpan.textContent = f.name;
      nameSpan.title = f.name;
      chip.appendChild(nameSpan);
      // Çarpı butonu
      const removeBtn = document.createElement('button');
      removeBtn.className = 'file-chip-remove';
      removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      removeBtn.title = 'Kaldır';
      removeBtn.addEventListener('click', () => {
        attachedFiles.splice(idx, 1);
        renderFilePreview();
      });
      chip.appendChild(removeBtn);
      filePreviewInner.appendChild(chip);
    });
  }

  if (attachBtn) {
    attachBtn.addEventListener('click', async () => {
      try {
        const r = await window.assistant.files.pick();
        if (!r || r.canceled) return;
        // Önizleme oluştur
        let preview = null;
        if (r.type === 'image' || (r.name && /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(r.name))) {
          // Fotoğraf → base64 önizleme
          if (r.content && r.content.startsWith('data:')) {
            preview = r.content;
          } else if (r.path) {
            preview = 'file:///' + r.path.replace(/\\/g, '/');
          }
        }
        attachedFiles.push({
          name: r.name || 'dosya',
          type: r.type || 'text',
          content: r.content || '',
          note: r.note || '',
          preview: preview,
          path: r.path || null,
        });
        renderFilePreview();
      } catch { /* kullanıcı iptal etti */ }
    });
  }
  // Dosya sürükle-bırak → içeriği prompt'a yükle (altına yazı ekleyip gönderebilirsin)
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    inputEl.classList.add('drag-over');
  });
  document.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) inputEl.classList.remove('drag-over');
  });
  document.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    inputEl.classList.remove('drag-over');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    await handleFileObj(files[0]);
    autoGrow();
    inputEl.focus();
  });

  // Panoda dosya varsa (Ctrl+C ile kopyalanmış) yapıştırınca yakala
  inputEl.addEventListener('paste', async (e) => {
    try {
      const r = await window.assistant.files.fromClipboard();
      if (r && r.file) {
        e.preventDefault();
        // Önizleme oluştur
        let preview = null;
        if (r.file.type === 'image' || (r.file.name && /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(r.file.name))) {
          if (r.file.content && r.file.content.startsWith('data:')) {
            preview = r.file.content;
          }
        }
        attachedFiles.push({
          name: r.file.name || 'dosya',
          type: r.file.type || 'text',
          content: r.file.content || '',
          note: r.file.note || '',
          preview: preview,
          path: r.file.path || null,
        });
        renderFilePreview();
        autoGrow();
      }
    } catch { /* normal yapıştırma devam eder */ }
  });

  sendBtn.addEventListener('click', () => {
    if (busy) window.assistant.stop();
    else send();
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
    // Escape ile dosya önizlemesini kapat
    if (e.key === 'Escape' && attachedFiles.length > 0) {
      attachedFiles = [];
      renderFilePreview();
    }
  });
  inputEl.addEventListener('input', autoGrow);
  newChatBtn.addEventListener('click', newSession);
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      newSession();
    }
  });
  // Ctrl+B (İş/Proje), Ctrl+Shift+B (Eğlence), Ctrl+Alt+B (Proje/Git) ile torbayı aç/kapa
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && (e.key === 'b' || e.key === 'B') && bagPopoverGit) {
      e.preventDefault();
      bagPopoverGit.classList.toggle('hidden');
      if (bagPopoverWork) bagPopoverWork.classList.add('hidden');
      if (bagPopoverFun) bagPopoverFun.classList.add('hidden');
      return;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'b' || e.key === 'B') && bagPopoverFun) {
      e.preventDefault();
      bagPopoverFun.classList.toggle('hidden');
      if (bagPopoverWork) bagPopoverWork.classList.add('hidden');
      if (bagPopoverGit) bagPopoverGit.classList.add('hidden');
      return;
    }
    if (e.ctrlKey && (e.key === 'b' || e.key === 'B') && bagPopoverWork) {
      e.preventDefault();
      bagPopoverWork.classList.toggle('hidden');
      if (bagPopoverFun) bagPopoverFun.classList.add('hidden');
      if (bagPopoverGit) bagPopoverGit.classList.add('hidden');
    }
  });
  // Ctrl+F ile sohbet arama
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      toggleChatSearch();
    }
    // Escape ile aramayı kapat
    if (e.key === 'Escape') {
      const searchEl = $('chat-search');
      if (searchEl && !searchEl.classList.contains('hidden')) {
        closeChatSearch();
      }
    }
  });

  // ---------- Sohbet Arama ----------
  let searchMatches = [];
  let searchIdx = -1;

  function toggleChatSearch() {
    const searchEl = $('chat-search');
    if (!searchEl) return;
    if (searchEl.classList.contains('hidden')) {
      searchEl.classList.remove('hidden');
      $('chat-search-input').focus();
    } else {
      closeChatSearch();
    }
  }

  function closeChatSearch() {
    const searchEl = $('chat-search');
    if (searchEl) searchEl.classList.add('hidden');
    clearSearchHighlights();
    searchMatches = [];
    searchIdx = -1;
  }

  function clearSearchHighlights() {
    messagesEl.querySelectorAll('mark').forEach((m) => {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
  }

  function performSearch(query) {
    clearSearchHighlights();
    searchMatches = [];
    searchIdx = -1;
    const countEl = $('search-count');
    if (!query || query.length < 2) {
      if (countEl) countEl.textContent = '';
      return;
    }
    const msgs = messagesEl.querySelectorAll('.msg');
    msgs.forEach((msg) => {
      const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT, null, false);
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      textNodes.forEach((node) => {
        const idx = node.textContent.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return;
        const span = document.createElement('span');
        span.innerHTML = node.textContent.slice(0, idx) + '<mark>' + node.textContent.slice(idx, idx + query.length) + '</mark>' + node.textContent.slice(idx + query.length);
        node.parentNode.replaceChild(span, node);
        // mark elementlerini topla
        span.querySelectorAll('mark').forEach((m) => searchMatches.push(m));
      });
    });
    if (countEl) countEl.textContent = searchMatches.length > 0 ? (searchIdx + 1) + '/' + searchMatches.length : '0 sonuç';
    if (searchMatches.length > 0) navigateSearch(0);
  }

  function navigateSearch(dir) {
    if (searchMatches.length === 0) return;
    searchMatches.forEach((m) => m.classList.remove('current'));
    searchIdx = (searchIdx + dir + searchMatches.length) % searchMatches.length;
    searchMatches[searchIdx].classList.add('current');
    searchMatches[searchIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    const countEl = $('search-count');
    if (countEl) countEl.textContent = (searchIdx + 1) + '/' + searchMatches.length;
  }

  // Search event listeners
  const searchInput = $('chat-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => performSearch(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        navigateSearch(e.shiftKey ? -1 : 1);
      }
    });
  }
  const searchPrev = $('search-prev');
  const searchNext = $('search-next');
  const searchClose = $('search-close');
  if (searchPrev) searchPrev.addEventListener('click', () => navigateSearch(-1));
  if (searchNext) searchNext.addEventListener('click', () => navigateSearch(1));
  if (searchClose) searchClose.addEventListener('click', closeChatSearch);
  // ---------- hazır sorular (torba): İş/Proje + Eğlence ----------
  // Her buton kendi popover'ını açar; ikisi asla aynı anda görünmez.
  // Hover: buton↔popover arasındaki boşluğu telafi eden kısa bir grace süresi kullanılır
  // (imleç alttan yukarı taşınırken popover erken kapanmasın).
  const _bagPairs = [
    { btn: bagBtnWork, pop: bagPopoverWork },
    { btn: bagBtnFun, pop: bagPopoverFun },
    { btn: bagBtnGit, pop: bagPopoverGit },
  ].filter((p) => p.btn && p.pop);
  const _bagOpen = (pop) => {
    _bagPairs.forEach((p) => p.pop.classList.toggle('hidden', p.pop !== pop));
  };
  const _bagCloseAll = () => _bagPairs.forEach((p) => p.pop.classList.add('hidden'));
  const _bagHovered = (pair) => pair.btn.matches(':hover') || pair.pop.matches(':hover');
  _bagPairs.forEach((pair) => {
    pair.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!pair.pop.classList.contains('hidden')) _bagCloseAll();
      else _bagOpen(pair.pop);
    });
    pair.btn.addEventListener('mouseenter', () => _bagOpen(pair.pop));
    pair.pop.addEventListener('mouseenter', () => _bagOpen(pair.pop));
    pair.btn.addEventListener('mouseleave', () => {
      setTimeout(() => { if (!_bagHovered(pair)) _bagCloseAll(); }, 220);
    });
    pair.pop.addEventListener('mouseleave', () => {
      setTimeout(() => { if (!_bagHovered(pair)) _bagCloseAll(); }, 220);
    });
    pair.pop.querySelectorAll('.bag-item').forEach((b) =>
      b.addEventListener('click', () => {
        _bagCloseAll();
        // Otomatik gönderme — prompt'u yazı kutusuna doldur, kullanıcı elle gönderir
        inputEl.value = b.dataset.q;
        inputEl.focus();
        showChat();
      }));
  });
  document.addEventListener('click', (e) => {
    if (!_bagPairs.some((p) => p.pop.contains(e.target) || e.target === p.btn)) _bagCloseAll();
  });

  // ---------- workspace: sohbet başına çalışma klasörü bağlama ----------
  // Gösterge: 0/1 (bağlı değil) veya 1/1 (bağlı, kırmızı). Bağlama session'a özeldir.
  if (wsBtn) {
    wsBtn.addEventListener('click', async () => {
      const s = activeSession();
      if (!s) { newSession(); }
      const sess = activeSession();
      if (!sess) return;
      try {
        const r = await window.assistant.workspace.pick(sess.id);
        if (r && r.error === 'already_bound') {
          showToast(t('Bu klasör zaten başka bir sohbete bağlı.'));
        } else if (r && r.ok) {
          let msg = 'Bağlandı: ' + r.name;
          const p = r.project;
          if (p) {
            msg += '\nTip: ' + p.type + (p.gitRepo ? ' · Git repo' : '') + (p.hasRemote ? ' · remote var' : '');
          }
          if (r.repo) msg += '\nRepo: ' + r.repo.name;
          showToast(msg);
          // Akıllı öneri: git repo + remote yoksa → repo oluştur önerisi
          if (p && p.gitRepo && !p.hasRemote && !r.repo) {
            setTimeout(() => showToast(t('İpucu: bu klasör GitHub\'da değil. "Repo oluştur" veya "Repoya bağlan" diyebilirsin.')), 2500);
          }
        }
        refreshWorkspaceIndicator();
      } catch { /* iptal veya hata */ refreshWorkspaceIndicator(); }
    });
  }

  // ---------- voice ----------
  const ttsBtn = $('tts-btn');
  if (ttsBtn) {
    ttsBtn.classList.toggle('active', ttsEnabled);
    ttsBtn.title = ttsEnabled ? 'Sesli yanıt: açık' : 'Sesli yanıt: kapalı';
    ttsBtn.addEventListener('click', toggleTts);
  }

  // ---------- settings panel ----------
  refreshVoicePrefs();
  const settingsBtn = $('settings-btn');
  const settingsOverlay = $('settings-overlay');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', openSettings);
    $('settings-close').addEventListener('click', closeSettings);
    $('settings-save').addEventListener('click', saveSettings);
    const dataExport = $('data-export');
    if (dataExport) dataExport.addEventListener('click', async () => {
      const el = $('settings-status');
      if (el) el.textContent = 'Yedekleniyor…';
      let r; try { r = await window.assistant.data.export(); } catch (e) { r = { ok: false, message: String(e.message || e) }; }
      if (el) el.textContent = (r && r.message) || '';
    });
    const dataReset = $('data-reset');
    if (dataReset) dataReset.addEventListener('click', async () => {
      let r; try { r = await window.assistant.data.reset(); } catch (e) { r = { ok: false, message: String(e.message || e) }; }
      if (r && r.ok) {
        try { localStorage.clear(); } catch { /* yok */ }
        setTimeout(reloadApp, 900);
      } else {
        const el = $('settings-status');
        if (el) el.textContent = (r && r.message) || '';
      }
    });
    settingsOverlay.addEventListener('click', (e) => {
      if (e.target === settingsOverlay) closeSettings();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !settingsOverlay.classList.contains('hidden')) closeSettings();
    });
    // kayıtlı tema ayarını settings.json'dan doğrula (tek kaynak)
    window.assistant.settings.get().then((st) => {
      if (st && (st.theme === 'dark' || st.theme === 'light')) applyTheme(st.theme);
    });
    // hızlı tema geçişi: başlıktaki ay butonu
    const themeBtn = $('theme-btn');
    if (themeBtn) {
      applyTheme(currentTheme()); // simgeyi başlat
      themeBtn.addEventListener('click', async () => {
        const next = currentTheme() === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        try {
          const st = await window.assistant.settings.get();
          await window.assistant.settings.set({ ...(st || {}), theme: next });
        } catch { /* kaydedilemezse sadece görsel kalır */ }
      });
    }
    // TÜMÜNÜ KAPAT: Harley + bağlı programlar (MCP + Piper). Onay ister.
    const shutdownBtn = $('shutdown-btn');
    if (shutdownBtn) {
      setIcon(shutdownBtn, 'power', 17);
      shutdownBtn.addEventListener('click', () => {
        if (confirm('Harley ve bağlı programları (Studio MCP sunucusu, ses motoru) kapatılsın mı?')) {
          try { window.assistant.shutdownAll(); } catch { /* kapandı */ }
        }
      });
    }
  }

  // ---------- hatırlatıcılar ----------
  window.assistant.tts.onPlay((p) => {
    if (p && p.audio) playAudio('data:' + (p.mime || 'audio/mpeg') + ';base64,' + p.audio);
  });
  window.assistant.reminders.onFire((p) => {
    const s = activeSession();
    if (!s) return;
    s.messages.push({ role: 'system', text: 'Hatırlatma: ' + (p.message || ''), ts: Date.now() });
    saveSessions();
    renderMessages();
  });

  // ---------- clipboard panel ----------
  const clipBtn = $('clipboard-btn');
  const clipOverlay = $('clipboard-overlay');
  if (clipBtn) {
    clipBtn.addEventListener('click', openClipboard);
    $('clipboard-close').addEventListener('click', closeClipboard);
    $('clipboard-clear').addEventListener('click', async () => {
      await window.assistant.clipboard.clear();
      renderClipboard([]);
    });
    clipOverlay.addEventListener('click', (e) => {
      if (e.target === clipOverlay) closeClipboard();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !clipOverlay.classList.contains('hidden')) closeClipboard();
    });
    window.assistant.clipboard.onNew(() => {
      if (!clipOverlay.classList.contains('hidden')) {
        window.assistant.clipboard.history().then(renderClipboard);
      }
    });
  }

  // ---------- memory panel ----------
  let memTimer = null;
  async function openMemory() {
    memoryInput.value = await window.assistant.memory.get();
    memoryStatus.textContent = '';
    memoryOverlay.classList.remove('hidden');
    memoryInput.focus();
  }
  function closeMemory() {
    memoryOverlay.classList.add('hidden');
  }
  async function saveMemory() {
    const ok = await window.assistant.memory.set(memoryInput.value);
    memoryStatus.textContent = ok ? 'Kaydedildi — artık her sohbette kullanılıyor' : 'Kaydedilemedi';
    clearTimeout(memTimer);
    memTimer = setTimeout(closeMemory, 1400);
  }
  memoryBtn.addEventListener('click', openMemory);
  memoryClose.addEventListener('click', closeMemory);
  memorySave.addEventListener('click', saveMemory);
  memoryOverlay.addEventListener('click', (e) => {
    if (e.target === memoryOverlay) closeMemory();
  });
  memoryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMemory();
    if (e.ctrlKey && e.key === 'Enter') saveMemory();
  });

  refreshStatus();
  setInterval(refreshStatus, 6000);

  // ---------- Studio paneli ----------
  const studioChip = $('studio-chip');
  if (studioChip) {
    studioChip.addEventListener('click', async () => {
      const txt = $('studio-text');
      if (txt) txt.textContent = 'bağlanıyor…';
      try {
        await window.assistant.studio.connect();
      } catch { /* yok */ }
      refreshStudio();
    });
  }
  refreshStudio();
  setInterval(refreshStudio, 6000);

  // ---------- Spotify + Focus + Evolution + Task ----------
  wireSpotify();
  wireFocus();
  wireEvolution();
  wirePersonalization();
  wireTestRunner();
  wireConnections();
  wireTaskPanel();
  wireApproval();
  loadActiveTask();

  // Güncelleme bildirimi (GitHub Releases)
  (function wireUpdates() {
    const banner = $('update-banner');
    if (!banner || !window.assistant.updates) return;
    let current = null;
    const show = (u) => {
      if (!u || !u.version) return;
      current = u;
      const t = $('update-text');
      if (t) t.textContent = 'Yeni sürüm v' + u.version + ' hazır';
      banner.classList.remove('hidden');
    };
    if (window.assistant.updates.onAvailable) window.assistant.updates.onAvailable(show);
    const close = $('update-close');
    if (close) close.onclick = () => banner.classList.add('hidden');
    const open = $('update-open');
    if (open) open.onclick = () => { if (current && current.url) window.assistant.updates.open(current.url); };
    window.assistant.updates.check().then((u) => { if (u && u.version && !u.upToDate) show(u); }).catch(() => {});
  })();

  // Panel açılınca body.overlay-open — kedi animasyonları duraklar (GPU yükü düşer, panel akıcı açar)
  const overlayObs = new MutationObserver(() => {
    const anyOpen = ['settings-overlay', 'memory-overlay', 'clipboard-overlay', 'focus-overlay', 'evolution-overlay', 'personalization-overlay', 'testrunner-overlay', 'connections-overlay']
      .some((id) => { const el = $(id); return el && !el.classList.contains('hidden'); });
    document.body.classList.toggle('overlay-open', anyOpen);
  });
  ['settings-overlay', 'memory-overlay', 'clipboard-overlay', 'focus-overlay', 'evolution-overlay', 'personalization-overlay', 'testrunner-overlay', 'connections-overlay'].forEach((id) => {
    const el = $(id);
    if (el) overlayObs.observe(el, { attributes: true, attributeFilter: ['class'] });
  });

  setTimeout(() => {
    splash.classList.add('fade');
    appEl.classList.remove('hidden');
    setTimeout(() => splash.remove(), 500);
    inputEl.focus();
  }, 2200);
})();
