// config.js — Merkezi yapılandırma. Tüm hardcoded yollar/sabitler tek yerden.
// Taşınabilirlik: ev dizini, uygulama yolları vs. burada toplanır.
const path = require('path');

const USERPROFILE = process.env.USERPROFILE || '';
const HOME = process.env.HOME || USERPROFILE;

// HarleyDosyalar: kullanıcı verilerinin (Google/DeepSeek/Spotify kimlikleri, bütçe, vs.) tutulduğu ana klasör.
const HARLEY_DIR = path.join(USERPROFILE, 'HarleyDosyalar');

// Kişisel veri dosyaları
const FILES = {
  deepseek: path.join(HARLEY_DIR, 'deepseek-config.json'),
  google: path.join(HARLEY_DIR, 'google-config.json'),
  googleCredentials: path.join(HARLEY_DIR, 'google-calendar-credentials.json'),
  googleToken: path.join(HARLEY_DIR, 'google-calendar-token.json'),
  spotify: path.join(HARLEY_DIR, 'spotify-config.json'),
  workspace: path.join(HARLEY_DIR, 'workspaces.json'),
  tasks: path.join(HARLEY_DIR, 'tasks.json'),
  tokenBudget: path.join(HARLEY_DIR, 'token-budget.json'),
  usage: path.join(HARLEY_DIR, 'usage.json'),
  reminders: path.join(HARLEY_DIR, 'hatirlatmalar.json'),
  autowrite: path.join(HARLEY_DIR, 'autowrite.json'),
  diag: path.join(HARLEY_DIR, 'harley-diagnostik.log'),
  memory: path.join(HARLEY_DIR, 'Bellek.md'),
  sessionSummaries: path.join(HARLEY_DIR, 'session-summaries.json'),
  harleyToken: path.join(HARLEY_DIR, 'harley-token.txt'),
  feedback: path.join(HARLEY_DIR, 'feedback.json'),
  githubToken: path.join(USERPROFILE, 'HarleyKod', 'github-token.txt'),
  repoLinks: path.join(HARLEY_DIR, 'repo-links.json'),
  agentEvolution: path.join(HARLEY_DIR, 'agent-evolution.json'),
  projects: path.join(HARLEY_DIR, 'projects.json'),
  userPrefs: path.join(HARLEY_DIR, 'user-prefs.json'),
};

// Proje alanı (RAG, aktif proje işaretçisi)
const PROJECTS_DIR = 'C:/Projects';
const ACTIVE_PROJECT_FILE = path.join(PROJECTS_DIR, '.harley-active.txt');

// Ses sentezi (piper + edge)
const PIPER_DIR = path.join(USERPROFILE, 'HarleySes', 'piper');
const PIPER_EXE = path.join(PIPER_DIR, 'piper.exe');
const PIPER_MODEL = path.join(PIPER_DIR, 'tr_TR-dfki-medium.onnx');
const PIPER_CONFIG = path.join(PIPER_DIR, 'tr_TR-dfki-medium.onnx.json');
const PIPER_VOICE_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki-medium/tr_TR-dfki-medium.onnx';
const PIPER_CFG_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki-medium/tr_TR-dfki-medium.onnx.json';
const PIPER_ZIP_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';

// Studio MCP (Roblox) giriş noktası
const MCP_DIR = path.join(USERPROFILE, 'HarleyMCP', 'node_modules', 'robloxstudio-mcp', 'dist', 'index.js');

// Kullanıcı klasörleri (kod çalışma alanı, masaüstü, belgeler)
const CODE_DIR = path.join(USERPROFILE, 'HarleyKod');
const DESKTOP_DIR = path.join(USERPROFILE, 'Desktop');
const DOCUMENTS_DIR = path.join(USERPROFILE, 'Documents');

// Yerel sunucu
const LOCAL_PORT = 59333;

// İntent'lerin (regex) kullanacağı sabit kelime grupları — kodun kendini tekrar etmemesi için.
const WORDS = {
  takvim: '(takvime?|takvimime|etkinlik|etkinlikleri?|randevu|toplantı|toplanti|buluşma|bulusma|görüşme|gorusme)',
  gorev: '(göreve?|goreve?|yapılacak|yapilacak|to-?do|liste)',
};

module.exports = {
  USERPROFILE,
  HOME,
  HARLEY_DIR,
  FILES,
  PROJECTS_DIR,
  ACTIVE_PROJECT_FILE,
  PIPER_DIR,
  PIPER_EXE,
  PIPER_MODEL,
  PIPER_CONFIG,
  PIPER_VOICE_URL,
  PIPER_CFG_URL,
  PIPER_ZIP_URL,
  MCP_DIR,
  CODE_DIR,
  DESKTOP_DIR,
  DOCUMENTS_DIR,
  LOCAL_PORT,
  WORDS,
};
