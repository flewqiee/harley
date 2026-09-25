// webhook-client.js — DeepSeek bulut sohbet istemcisi.
// n8n ve Ollama kaldırıldı (Ağu 2026); sohbet doğrudan DeepSeek API'ye gider.
// Anahtar (kullanıcı ev klasörü)/HarleyDosyalar/deepseek-config.json içinde tutulur.

const http = require('http');
const fs = require('fs');
const { FILES } = require('./config');

// Kullanıcı dostu API hata metni (ham "API hatası (401)" yerine anlaşılır mesaj).
function friendlyStatus(name, status, body) {
  let detail = '';
  try { const ej = JSON.parse(String(body || '').trim()); if (ej.error && ej.error.message) detail = ej.error.message; } catch { /* yok */ }
  if (status === 401) return name + ': anahtar geçersiz (401) — Bağlantılar panelinden kontrol et.';
  if (status === 402) return name + ': bakiye yetersiz (402) — hesabına bakiye yükle.';
  if (status === 429) return name + ': çok fazla istek (429) — biraz sonra tekrar dene.';
  if (status >= 500) return name + ': sunucu hatası (' + status + ') — biraz sonra tekrar dene.';
  return name + ' API hatası (' + status + ')' + (detail ? ': ' + detail : '');
}

// Tek sohbet modeli: DeepSeek bulut. (Eski yerel Ollama modelleri kaldırıldı.)
const WEBHOOKS = {
  'deepseek-flash': {
    label: 'DeepSeek V4 Flash — Bulut',
    cloud: true,
  },
  // Eski model adıyla kaydedilmiş ayarlar için takma ad — aynı bulut modeline gider.
  'qwen2.5:3b': {
    label: 'DeepSeek V4 Flash — Bulut',
    cloud: true,
  },
};

// DeepSeek doğrudan API. Anahtar (kullanıcı ev klasörü)/HarleyDosyalar/deepseek-config.json içinde.
function deepseekConfig() {
  try {
    const raw = fs.readFileSync(FILES.deepseek, 'utf8');
    const cfg = JSON.parse(raw);
    // Key fazladan whitespace/newline içeriyorsa temizle
    if (cfg.apiKey) cfg.apiKey = cfg.apiKey.trim();
    return cfg;
  } catch {
    return {};
  }
}

// ---------- Sağlayıcılar (birincil + isteğe bağlı yedek/failover) ----------
// deepseek-config.json:
//   { "apiKey": "...", "model": "deepseek-flash", "baseURL"?: "...",
//     "backup"?: { "enabled": true, "name": "...", "baseURL": "https://...", "apiKey": "...", "model": "..." } }
// Yedek sağlayıcı OpenAI-uyumlu (/chat/completions) olmalı. Birincil hata verirse
// (ağ/timeout/429/5xx) otomatik olarak yedeğe geçilir.
function providers() {
  const cfg = deepseekConfig();
  const list = [];
  if (cfg.apiKey) {
    list.push({
      name: 'DeepSeek',
      baseURL: cfg.baseURL || 'https://api.deepseek.com',
      apiKey: cfg.apiKey,
      model: cfg.model || 'deepseek-flash',
    });
  }
  const b = cfg.backup || {};
  if (b.enabled !== false && b.apiKey && b.baseURL) {
    list.push({
      name: b.name || 'Yedek',
      baseURL: String(b.baseURL).replace(/\/+$/, ''),
      apiKey: String(b.apiKey).trim(),
      model: b.model || 'gpt-4o-mini',
    });
  }
  return list;
}

function endpoint(baseURL, pathname) {
  const u = new URL(baseURL);
  const base = u.pathname.replace(/\/+$/, '');
  u.pathname = base + pathname;
  u.search = '';
  return u;
}

// Geçici hatalarda (ağ/timeout/429/5xx) kısa backoff ile yeniden dener.
function withRetry(fn, retries = 2, delays = [600, 1600]) {
  const attempt = async (i) => {
    try {
      return await fn();
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      const m = String((e && e.message) || '');
      const transient = /zaman aşımı|timeout|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang|429|5\d\d/i.test(m);
      if (!transient || i >= retries) throw e;
      await new Promise((r) => setTimeout(r, delays[Math.min(i, delays.length - 1)]));
      return attempt(i + 1);
    }
  };
  return attempt(0);
}

// Tek sağlayıcıya akışlı istek (OpenAI-uyumlu SSE).
function streamProvider(provider, bodyObj, onChunk, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ ...bodyObj, model: provider.model });
    const mod = provider.baseURL.startsWith('http://') ? require('http') : require('https');
    const req = mod.request(endpoint(provider.baseURL, '/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + provider.apiKey, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      res.setEncoding('utf8');
      let buf = '', full = '', gotData = false;
      res.on('data', (c) => {
        gotData = true;
        buf += c;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (json === '[DONE]') continue;
          try {
            const d = JSON.parse(json);
            const delta = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
            if (delta) { full += delta; if (onChunk) onChunk(full); }
          } catch { /* kısmi satır */ }
        }
      });
      res.on('end', () => {
        if (buf.trim() && buf.trim().startsWith('data:')) {
          try {
            const d = JSON.parse(buf.trim().slice(5).trim());
            const delta = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
            if (delta) { full += delta; if (onChunk) onChunk(full); }
          } catch { /* yok */ }
        }
        if (res.statusCode >= 400 && !gotData) {
          return reject(Object.assign(new Error(friendlyStatus(provider.name, res.statusCode, buf.trim())), { status: res.statusCode, gotData }));
        }
        resolve({ output: full, provider: provider.name, gotData });
      });
    });
    req.on('error', reject);
    const onAbort = () => { req.destroy(); reject(Object.assign(new Error('İptal edildi'), { name: 'AbortError' })); };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Zaman aşımı — ' + provider.name + ' yanıt vermedi')); });
    req.write(body);
    req.end();
  });
}

// Tek sağlayıcıya JSON isteği (function-calling; akış yok).
function jsonProvider(provider, bodyObj, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ ...bodyObj, model: provider.model });
    const mod = provider.baseURL.startsWith('http://') ? require('http') : require('https');
    const req = mod.request(endpoint(provider.baseURL, '/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + provider.apiKey, 'Content-Length': Buffer.byteLength(body) },
    }, (r) => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        if (r.statusCode >= 400) {
          return reject(Object.assign(new Error(friendlyStatus(provider.name, r.statusCode, d)), { status: r.statusCode }));
        }
        try { resolve(JSON.parse(d)); } catch { reject(new Error(provider.name + ' yanıtı çözümlenemedi')); }
      });
    });
    req.on('error', reject);
    const onAbort = () => { req.destroy(); reject(Object.assign(new Error('İptal edildi'), { name: 'AbortError' })); };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Zaman aşımı — ' + provider.name + ' yanıt vermedi')); });
    req.write(body);
    req.end();
  });
}

// Harley persona'sı — hem akış (postDeepSeek) hem function-calling (postDeepSeekTools) kullanır.
const PERSONA_TEXT = 'Sen Harley\'sin — Türkçe konuşan, samimi, pratik bir kişisel AI asistan. Görevleri net, adım adım ve doğru yap.\n\nÇALIŞMA ŞEKLİN:\n1. Kullanıcı sana bir iş/görev verdiğinde önce düşün, plan yap.\n2. İş uzunsa (birden çok adım → dosya oluşturma, proje kurma, kod yazma) ÖNCE task_plan aracını çağır. Adımları sırala. Kullanıcıya planı göster.\n3. Sonra her adımı sırayla uygula (workspace_list/read/write/mkdir/run vb.). Her adımı bitirince task_mark_done ile işaretle.\n4. Tüm adımlar bittiğinde test et: workspace_run ile çalıştır, dosyaları kontrol et.\n5. Her şey başarılıysa sonucu kullanıcıya özetle ve sun. Hata varsa düzeltip tekrar dene.\n\nKod üretirken açıklamalı ve tam çalışır kod ver. workspace_write ile dosyaya yaz. KOD DOSYASI ürettiğinde her dosyayı şu formatta ver (yazma modu açıksa otomatik kaydedilir):\n<<<DOSYA:göreli_yol>>>\n<dosya içeriği>\n<<<DOSYA SONU>>>';

function postDeepSeek({ chatInput, profile }, onChunk, timeoutMs = 300000, signal) {
  const provs = providers();
  if (!provs.length) return Promise.reject(new Error('DeepSeek API anahtarı yok — Harley\'de sol menüdeki "Bağlantılar" panelinden ekle.'));
  const sysText = PERSONA_TEXT + (profile && profile.trim() ? '\nKULLANICI PROFİLİ:\n' + profile : '');
  const messages = [{ role: 'system', content: sysText }, { role: 'user', content: chatInput }];
  const bodyObj = { messages, stream: true, max_tokens: 8000, temperature: 0.6 };
  let lastErr;
  // Sağlayıcı sırası: birincil başarısız olursa yedeğe geç (failover).
  return (async () => {
    for (let i = 0; i < provs.length; i++) {
      const p = provs[i];
      try {
        const r = await withRetry(() => streamProvider(p, bodyObj, onChunk, timeoutMs, signal));
        if (i > 0) r.failover = true;
        return r;
      } catch (e) {
        lastErr = e;
        if (e && e.name === 'AbortError') throw e;
        // Kısmen akıtıldıysa provider değiştirmek çift metin üretir — burada dur.
        if (e && e.gotData) throw e;
      }
    }
    throw lastErr || new Error('Tüm sağlayıcılar başarısız oldu.');
  })();
}

// Function-calling: modele araç seti (tools) verilir; model tool_calls döndürürse
// executeTool ile çalıştırılır, sonuç modele geri verilir ve tekrar çağrılır (döngü).
// maxLoops uzun görevler için yüksek tutulur; her tool çağrısı onToolCall ile bildirilir
// (UI'da "şu adım çalışıyor" göstermek için). Güvenlik: toplam token harcaması (budget),
// toplam süre (totalTimeMs) ve tek mesaj listesinin büyümesi sınırlanır — model kendi
// kendine sonsuz döngüye girse bile token/mesaj patlamaz, döngü kırılır.
function postDeepSeekTools({ model, messages, tools, executeTool, onChunk, onToolCall, onToolDone, maxLoops = 30, timeoutMs = 300000, signal, maxTokensPerCall = 3000, totalTimeMs = 240000, beforeCall, budgetHaltMessage }) {
  const provs = providers();
  if (!provs.length) return Promise.reject(new Error('DeepSeek API anahtarı yok — Harley\'de sol menüdeki "Bağlantılar" panelinden ekle.'));
  // Her API çağrısında sağlayıcıları sırayla dener (failover).
  const callJsonFailover = async (bodyObj) => {
    let lastErr;
    for (const p of provs) {
      try {
        return await withRetry(() => jsonProvider(p, bodyObj, timeoutMs, signal));
      } catch (e) {
        lastErr = e;
        if (e && e.name === 'AbortError') throw e;
      }
    }
    throw lastErr || new Error('Tüm sağlayıcılar başarısız oldu.');
  };
  const startedAt = Date.now();
  const MAX_MSG_CHARS = 30000; // input şişmesin — 30K karakter yeterli (tool sonuçları dahil)
  const loop = async (msgs, loopCount) => {
    if (Date.now() - startedAt > totalTimeMs) {
      return { output: 'Görev toplam süre sınırını aştı (' + Math.round(totalTimeMs / 60000) + ' dk); yarıda kesildi. İstersen tekrar dene.', halted: true, reason: 'time' };
    }
    // Token bütçesi: beforeCall yalnızca GÖREV BAŞINDALARKEN (loopCount 0) kontrol edilir.
    // Başlamış bir görev yarıda kesilmez (totalTimeMs + maxLoops yine de güvenliği sağlar).
    if (loopCount === 0 && beforeCall && beforeCall(msgs)) {
      return { output: budgetHaltMessage || 'Token bütçesi doldu; görev başlamadı.', halted: true, reason: 'budget' };
    }
    // Mesaj listesini boyut limitinde tut: en son ~25 mesajı koru
    let m = msgs;
    if (m.length > 25) m = m.slice(-25);
    const bodyObj = {
      messages: m,
      tools: tools || undefined,
      tool_choice: (tools && tools.length) ? 'auto' : undefined,
      stream: false,
      max_tokens: maxTokensPerCall,
      temperature: 0.6,
    };
    const res = await callJsonFailover(bodyObj);
    const choice = res.choices && res.choices[0];
    const msg = (choice && choice.message) || {};
    const calls = (choice && choice.finish_reason === 'tool_calls' && Array.isArray(msg.tool_calls)) ? msg.tool_calls : [];
    if (calls.length && loopCount < maxLoops) {
      const toolMsgs = [];
      for (const tc of calls) {
        let result;
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* bozuk arg */ }
        try {
          if (onToolCall) onToolCall(tc.function.name, args);
          result = await executeTool(tc.function.name, args);
          if (onToolDone) onToolDone(tc.function.name, args, result);
        } catch (e) { result = 'Hata: ' + (e && e.message ? e.message : e); }
        toolMsgs.push({ role: 'tool', tool_call_id: tc.id, content: String(result || '').slice(0, 3000) });
      }
      const next = [...msgs, msg, ...toolMsgs];
      // Döngü büyürken toplam karakteri sınırla: taşan eski mesajları düş
      let total = next.reduce((a, x) => a + (String(x.content || '').length), 0);
      while (total > MAX_MSG_CHARS && next.length > 8) {
        const dropped = next.shift();
        total -= String(dropped.content || '').length;
      }
      return loop(next, loopCount + 1);
    }
    if (calls.length && loopCount >= maxLoops) {
      return { output: String(msg.content || '').trim() || 'Maksimum araç döngüsüne ulaşıldı; görev yarıda kesildi.', halted: true, reason: 'loops' };
    }
    // Model bazen tool çağrısını JSON yerine <tool_calls> METNİ olarak üretir (özellikle
    // uzun/karışık görevlerde) — hatta gerçek tool_calls ile birlikte. Bu metni HER ZAMAN süz.
    let content = String(msg.content || '').trim();
    // Önce tam genişlikli çubukları at (model <｜｜DSML｜｜tool_calls> gibi bozuk format da üretir)
    content = content.replace(/[｜│]/g, '');
    if (/<tool_calls|<invoke|<parameter|<list|<\/?invoke|workspace_|git_|task_|spotify/i.test(content)) {
      content = content.replace(/<\/?[a-z_]+[^>]*>/gi, ' ').replace(/tool_calls?/gi, '').replace(/[{}"\\]/g, '').replace(/\s+/g, ' ').trim();
      content = content.replace(/workspace_(list|read|write|run|mkdir|delete|move|search|test)[a-z_]*/gi, '');
      content = content.replace(/git_(status|diff|log|commit|push|pull|create|link|branch|revert)[a-z_]*/gi, '');
      content = content.replace(/task_(plan|mark_done)[a-z_]*/gi, '');
      content = content.slice(0, 2000);
    }
    if (!content && loopCount > 0) {
      content = '';
    }
    return { output: content };
  };
  return loop(messages, 0).then((r) => { if (onChunk && r.output) onChunk(r.output); return r; });
}

module.exports = { WEBHOOKS, postDeepSeek, postDeepSeekTools, PERSONA_TEXT, providers, withRetry, streamProvider, jsonProvider };