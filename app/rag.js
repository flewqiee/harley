// rag.js — Kod/doküman içi arama: BM25 sıralama + bağlam snippet'i.
// workspace.searchCode bu modülü kullanır. Amaç: büyük kod tabanında
// "X nerede / ne işe yarıyor" sorusuna ilgili dosyaları okumadan bağlam vermek.
const fs = require('fs');
const path = require('path');

const RAG_EXTS = ['.js', '.jsx', '.ts', '.tsx', '.py', '.lua', '.rb', '.java', '.c', '.cpp', '.go', '.rs', '.php', '.md', '.json', '.css', '.html', '.vue', '.svelte', '.sh', '.yml', '.yaml'];
const RAG_SKIP = ['node_modules', 'dist', 'build', '.git', '.cache', '__pycache__', 'venv', '.venv', '.next', '.turbo', 'coverage', '.harley'];
const MAX_FILE_BYTES = 300000;
const MAX_FILES = 800;
const LINES_PER_CHUNK = 45;
const CHUNK_OVERLAP = 10;
const INDEX_TTL_MS = 20000;

const STOPWORDS = new Set([
  'bir', 've', 'ile', 'için', 'icin', 'bu', 'şu', 'su', 'da', 'de', 'mi', 'mı', 'mu', 'ne',
  'nasıl', 'nasil', 'ama', 'ki', 'en', 'çok', 'cok', 'var', 'yok', 'gibi', 'olan', 'ise',
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'are', 'was', 'were', 'is', 'of',
  'to', 'in', 'on', 'it', 'as', 'at', 'be', 'or', 'an', 'by', 'not', 'you', 'we', 'they',
]);

function tokenize(text) {
  const tokens = String(text || '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
  return tokens.filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function chunkFile(content) {
  const lines = content.split('\n');
  const chunks = [];
  const step = Math.max(1, LINES_PER_CHUNK - CHUNK_OVERLAP);
  for (let i = 0; i < lines.length; i += step) {
    const end = Math.min(lines.length, i + LINES_PER_CHUNK);
    chunks.push({ start: i + 1, end, text: lines.slice(i, end).join('\n') });
    if (end >= lines.length) break;
  }
  if (!chunks.length) chunks.push({ start: 1, end: 1, text: '' });
  return chunks;
}

function walkFiles(root, files, depth) {
  if (depth > 6 || files.length >= MAX_FILES) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (files.length >= MAX_FILES) return;
    if (RAG_SKIP.includes(e.name) || e.name.startsWith('.harley')) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) { walkFiles(full, files, depth + 1); continue; }
    const ext = path.extname(e.name).toLowerCase();
    if (!RAG_EXTS.includes(ext)) continue;
    try {
      if (fs.statSync(full).size > MAX_FILE_BYTES) continue;
      files.push(full);
    } catch { /* atla */ }
  }
}

const indexCache = new Map(); // root -> { ts, index }

function buildIndex(root) {
  const files = [];
  walkFiles(root, files, 0);
  const docs = [];
  const df = new Map(); // token -> doküman (chunk) sayısı
  for (const full of files) {
    let content;
    try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const rel = path.relative(root, full);
    for (const ch of chunkFile(content)) {
      const tokens = tokenize(ch.text);
      if (!tokens.length) continue;
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
      docs.push({ file: rel, start: ch.start, end: ch.end, text: ch.text, tf, len: tokens.length });
    }
  }
  return { docs, df, files: files.length, builtAt: Date.now() };
}

function getIndex(root) {
  const key = path.resolve(root).toLowerCase();
  const cached = indexCache.get(key);
  if (cached && Date.now() - cached.ts < INDEX_TTL_MS) return cached.index;
  const index = buildIndex(root);
  indexCache.set(key, { ts: Date.now(), index });
  return index;
}

// BM25 (k1=1.5, b=0.75) — sorgu terimlerine göre chunk'ları sıralar.
function bm25(index, query, limit) {
  const qTokens = [...new Set(tokenize(query))];
  const N = index.docs.length;
  if (!N || !qTokens.length) return [];
  const avgdl = index.docs.reduce((a, d) => a + d.len, 0) / N || 1;
  const k1 = 1.5, b = 0.75;
  const scored = [];
  for (const d of index.docs) {
    let score = 0;
    for (const q of qTokens) {
      const n = index.df.get(q) || 0;
      const f = d.tf.get(q) || 0;
      if (!n || !f) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.len / avgdl)));
    }
    if (score > 0) scored.push({ d, score });
  }
  scored.sort((a, b2) => b2.score - a.score);
  return scored.slice(0, limit).map(({ d, score }) => ({
    file: d.file,
    line: d.start,
    endLine: d.end,
    snippet: d.text.slice(0, 1500),
    score: Math.round(score * 100) / 100,
  }));
}

// Ana giriş: root klasörde BM25 araması. workspace.searchCode bunu çağırır.
function search(root, query, limit) {
  const q = String(query || '').trim();
  if (q.length < 2) return { ok: false, error: 'Arama için en az 2 karakter gir.' };
  const max = Math.max(1, Math.min(10, parseInt(limit, 10) || 5));
  const index = getIndex(root);
  if (!index.docs.length) return { ok: true, items: [], total: 0 };
  const results = bm25(index, q, max);
  // total: skor>0 olan tüm chunk sayısı (limit dışı dahil)
  const qTokens = [...new Set(tokenize(q))];
  let total = 0;
  for (const d of index.docs) {
    if (qTokens.some((t) => d.tf.has(t))) total++;
  }
  return { ok: true, items: results, total };
}

function clearCache() { indexCache.clear(); }

module.exports = { search, buildIndex, bm25, tokenize, clearCache, RAG_EXTS, RAG_SKIP };
