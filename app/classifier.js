// classifier.js — Intent routing engine.
// AI = sadece gerektiğinde çağrılan organ. Dosya aramak, saat okumak, CPU'ya bakmak,
// git diff almak, Studio'nun açık olup olmadığını anlamak için AI gerekmez.
// Classifier Regex + keyword tabanlıdır, AI kullanmaz.

const http = require('http');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { FILES, USERPROFILE } = require('./config');
const secureStore = require('./secure-store');
const i18n = require('./i18n');
let I18N_EN = {};
try { I18N_EN = require('./locales.json').en || {}; } catch { I18N_EN = {}; }
// Dinamik yanıtlar için önek/parça çevirileri (tam eşleşme yetmediğinde).
const TR_PREFIX = [
  ['VS Code açıldı: ', 'VS Code opened: '],
  ['Değişen dosya: ', 'Changed file: '],
  ['Repo bilgisi alınamadı: ', 'Could not get repo info: '],
  ['Repo listesi alınamadı: ', 'Could not get repo list: '],
  ['Profil güncellendi: ', 'Profile updated: '],
  ['Spotify bağlanamadı: ', 'Could not connect to Spotify: '],
  ['Şarkıyı çalarken hata oldu: ', 'Error while playing the song: '],
  ['API hatası: ', 'API error: '],
  ['IDE hatası: ', 'IDE error: '],
  ['Test hatası: ', 'Test error: '],
];
const TR_SUBSTR = [
  ['" diye bir şarkı bulamadım.', 'I couldn\'t find a song called "'],
];
function T(s, vars) {
  let out = s;
  if (i18n.getLang() === 'en') {
    if (I18N_EN[s] !== undefined) out = I18N_EN[s];
    else { for (const [a, b] of TR_PREFIX) if (out.startsWith(a)) { out = b + out.slice(a.length); break; } }
    for (const [a, b] of TR_SUBSTR) out = out.split(a).join(b);
  }
  if (vars) for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(String(vars[k]));
  return out;
}
const LOCALE = () => (i18n.getLang() === 'en' ? 'en-US' : 'tr-TR');
const APPDATA = process.env.APPDATA || path.join(USERPROFILE, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(USERPROFILE, 'AppData', 'Local');

// ---------- Skill registry ----------
// Her skill: { name, patterns: [regex], handler: async (match, ctx) => string|null, needsAI: false }
// ctx = { mainWindow, settings, probe, ... } — handler'a gerekli bağımlılıklar
const skills = [];

function registerSkill(skill) {
  skills.push(skill);
}

// ---------- Built-in local handlers ----------

// 1. SAAT / TARİH
registerSkill({
  name: 'clock',
  patterns: [
    /saat\s*(kaç|ne|nedir|mı)/i,
    /saati?\s*(göster|söyle|öğren)/i,
    /şu\s*an\s*(saat|zaman|vakit)/i,
    /what\s*time\s*(is\s*it|now)/i,
    /current\s*time/i,
  ],
  handler: () => {
    const now = new Date();
    const time = now.toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const date = now.toLocaleDateString(LOCALE(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return `${time} — ${date}`;
  },
});

// 2. TARİH
registerSkill({
  name: 'date',
  patterns: [
    /bugün\s*(ne\s*gün|tarih|gün)/i,
    /bugünün?\s*(tarihi|gunu)/i,
    /today'?s?\s*date/i,
  ],
  handler: () => {
    const now = new Date();
    return now.toLocaleDateString(LOCALE(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  },
});

// 3. CPU / RAM / SİSTEM DURUMU
registerSkill({
  name: 'system-status',
  patterns: [
    /(cpu|işlemci|ram|bellek|disk|hafıza)\s*(durumu|kullanımı|yüzdesi|nasıl|ne\s*durumda)/i,
    /(bilgisayar|sistem|pc)\s*(durumu|nasıl|ne\s*durumda|yavaş\s*mı)/i,
    /system\s*(status|usage|load)/i,
    /how.*(much|many)\s*(cpu|ram|memory|disk)/i,
  ],
  handler: () => new Promise((resolve) => {
    // Windows: PowerShell ile CPU + RAM + Disk bilgisi
    const ps = `$cpu=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average;` +
      `$os=Get-CimInstance Win32_OperatingSystem;` +
      `$ramTotal=[math]::Round($os.TotalVisibleMemorySize/1MB,1);` +
      `$ramFree=[math]::Round($os.FreePhysicalMemory/1MB,1);` +
      `$ramUsed=[math]::Round($ramTotal-$ramFree,1);` +
      `$ramPct=[math]::Round($ramUsed/$ramTotal*100);` +
      `$disk=(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'");` +
      `$diskFree=[math]::Round($disk.FreeSpace/1GB,1);` +
      `$diskTotal=[math]::Round($disk.Size/1GB,1);` +
      `Write-Output "CPU: $cpu% | RAM: $ramUsed/$ramTotal GB ($ramPct%) | Disk C: $diskFree/$diskTotal GB ${i18n.getLang() === 'en' ? 'free' : 'boş'}"`;
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, out) => {
      if (err || !out) return resolve(T('Sistem bilgisi alınamadı.'));
      resolve(out.trim());
    });
  }),
});

// 4. UYGULAMA AÇMA
registerSkill({
  name: 'open-app',
  patterns: [
    /^(spotify|chrome|edge|discord|steam|roblox|explorer|notepad|ayarlar|paint|harley|visual\s*studio|vscode)\s*(aç|aç|başlat|kapat| aç| aç)/i,
    /(spotify|chrome|edge|discord|steam|roblox|explorer|notepad|ayarlar|paint|harley|visual\s*studio|vscode)\s*(aç|aç|başlat)/i,
    /(aç|başlat)\s*(spotify|chrome|edge|discord|steam|roblox|explorer|notepad|ayarlar|paint|harley|visual\s*studio|vscode)/i,
    /(open|launch|start)\s*(spotify|chrome|edge|discord|steam|roblox|explorer|notepad|settings|paint|harley)/i,
  ],
  handler: (match, ctx) => {
    const APPS = {
      spotify: [path.join(APPDATA, 'Spotify', 'spotify.exe'), path.join(LOCALAPPDATA, 'Spotify', 'spotify.exe')],
      chrome: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
      edge: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
      discord: [path.join(LOCALAPPDATA, 'Discord', 'Discord.exe')],
      steam: ['C:/Program Files (x86)/Steam/steam.exe'],
      roblox: [path.join(LOCALAPPDATA, 'Roblox', 'Versions', 'RobloxPlayerBeta.exe')],
      'roblox studio': [path.join(LOCALAPPDATA, 'Roblox', 'Versions', 'RobloxStudioBeta.exe')],
      explorer: ['explorer.exe'],
      notepad: ['notepad.exe'],
      ayarlar: ['ms-settings:'],
      paint: ['mspaint.exe'],
      harley: null, // özel: pencereyi öne getir
      vscode: [path.join(LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')],
      'visual studio code': [path.join(LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')],
    };
    const text = String(match[0] || '').toLowerCase();
    // Hangi uygulama?
    let app = null;
    for (const key of Object.keys(APPS)) {
      if (text.includes(key)) { app = key; break; }
    }
    if (!app) return null; // AI'a devret

    // Kapatma isteği → uygulamayı kapat
    const wantClose = /kapat|kapat\s*$|close/i.test(text) && !/aç|open|start/i.test(text);
    if (wantClose) {
      if (app === 'harley') {
        if (ctx.hideMain) ctx.hideMain();
        return 'Harley kapatıldı.';
      }
      const procNames = {
        spotify: 'Spotify',
        chrome: 'chrome',
        edge: 'msedge',
        discord: 'Discord',
        steam: 'steam',
        roblox: 'RobloxPlayerBeta',
        'roblox studio': 'RobloxStudioBeta',
        explorer: 'explorer',
        notepad: 'notepad',
        paint: 'mspaint',
        vscode: 'Code',
        'visual studio code': 'Code',
      };
      const pn = procNames[app];
      if (!pn) return `${app} kapatılamadı — bilinen bir işlem adı yok.`;
      const ps = `Stop-Process -Name '${pn}' -Force -ErrorAction SilentlyContinue`;
      const { execFile } = require('child_process');
      execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err) => {
        if (err) return;
      });
      return `${app} kapatıldı.`;
    }

    // Harley özel: pencereyi öne getir
    if (app === 'harley') {
      if (ctx.showMain) ctx.showMain();
      return 'Harley burada — nasıl yardımcı olabilirim?';
    }

    const paths = APPS[app];
    if (!paths) return null;

    for (const p of paths) {
      if (!p) continue;
      try {
        if (p.startsWith('ms-')) {
          require('electron').shell.openExternal(p);
          return `${app} açıldı.`;
        }
        const { spawn } = require('child_process');
        spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Start-Process -FilePath '${p}'`], { windowsHide: true });
        return `${app} açıldı.`;
      } catch (e) {
        return `${app} açılamadı: ${e.message}`;
      }
    }
    return `${app} bulunamadı — yüklü olmayabilir.`;
  },
});

// 5. ROBLOX STUDIO DURUMU
registerSkill({
  name: 'studio-status',
  patterns: [
    /studio\s*(açık\s*mı|bağlı\s*mı|çalışıyor\s*mı|durumu|nerede)/i,
    /roblox\s*(studio\s*)?(açık\s*mı|bağlı\s*mı|çalışıyor\s*mı|durumu)/i,
    /studio\s*(connected|open|running|status)/i,
  ],
  handler: (match, ctx) => new Promise((resolve) => {
    const ps = 'Get-Process -Name RobloxStudioBeta -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count';
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, out) => {
      const n = parseInt(String(out || '').trim(), 10);
      if (!err && n > 0) {
        resolve('Roblox Studio açık ve çalışıyor. MCP sunucusu da bağlı.');
      } else {
        resolve('Roblox Studio şu an kapalı.');
      }
    });
  }),
});

// 6. GIT DURUMU / DIFF / STATUS
registerSkill({
  name: 'git',
  patterns: [
    /^(git|repo|depo)\s*(durumu|status|diff|log|branch|commit|push)/i,
    /(son\s*(commit|değişiklik|diff|log)|neler\s*değişti|ne\s*yapıldı)/i,
    /what.*changed|git\s*status/i,
  ],
  handler: (match, ctx) => new Promise((resolve) => {
    const text = String(match[0] || '').toLowerCase();
    const cwd = ctx.projectDir || process.cwd();

    if (text.includes('diff') || text.includes('değişiklik')) {
      execFile('git', ['diff', '--stat'], { cwd, windowsHide: true }, (e, out) => {
        resolve(out ? `Son değişiklikler:\n${out.trim()}` : 'Henüz değişiklik yok (working tree temiz).');
      });
    } else if (text.includes('log')) {
      execFile('git', ['log', '--oneline', '-5'], { cwd, windowsHide: true }, (e, out) => {
        resolve(out ? `Son 5 commit:\n${out.trim()}` : 'Commit geçmişi bulunamadı.');
      });
    } else {
      execFile('git', ['status', '--short'], { cwd, windowsHide: true }, (e, out) => {
        if (!out || !out.trim()) return resolve('Working tree temiz — bekleyen değişiklik yok.');
        const lines = out.trim().split('\n');
        resolve(`Değişen dosyalar (${lines.length}):\n${lines.slice(0, 15).join('\n')}${lines.length > 15 ? '\n...ve ' + (lines.length - 15) + ' tane daha' : ''}`);
      });
    }
  }),
});

// 7. DOSYA ARAMA
registerSkill({
  name: 'file-search',
  patterns: [
    /dosya\s*(ara|bul|nerede|neresi)/i,
    /(bul|ara)\s*(dosyayı|dosyaları)/i,
    /find\s*file/i,
    /\.([a-z]{2,4})\s*dosyası/i,
  ],
  handler: (match, ctx) => new Promise((resolve) => {
    // Kullanıcının arama sorgusunu çıkarmaya çalış
    const text = match.input || '';
    const extMatch = text.match(/\.([a-z]{2,4})\s*dosyası/i);
    const query = extMatch ? `*${extMatch[1]}` : text.replace(/dosya\s*(ara|bul|nerede)/i, '').trim();

    if (!query || query.length < 2) return resolve('Ne aramamı istiyorsun? Daha spesifik ol.');

    const searchDir = USERPROFILE;
    const cmd = `Get-ChildItem -Path '${searchDir}' -Recurse -Filter '*${query.replace(/'/g, "''")}*' -File -ErrorAction SilentlyContinue | Select-Object -First 10 FullName | ForEach-Object { $_.FullName }`;
    execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true, timeout: 15000 }, (e, out) => {
      if (!out || !out.trim()) return resolve(`"${query}" için sonuç bulunamadı.`);
      const files = out.trim().split('\n').filter(Boolean);
      resolve(`${files.length} dosya bulundu:\n${files.slice(0, 10).join('\n')}`);
    });
  }),
});

// 8. HATIRLATMA
registerSkill({
  name: 'reminder',
  patterns: [
    /hatırlat\s*(beni|bana)/i,
    /(unutma|提醒|remind|bana\s*(söyle|hatırlat))/i,
    /(\d+)\s*(dakika|saat|dak|sa)\s*(sonra|sonra|bana\s*hatırlat)/i,
  ],
  handler: () => null // main.js'deki reminder handler'ına gider
});

// 9. ŞU AN NE ÇALIYOR (Spotify)
registerSkill({
  name: 'now-playing',
  patterns: [
    /şu\s*an\s*(ne\s*çalıyor|hangi\s*şarkı|müzik|şarkı.*çalıyor)/i,
    /(what'?s?\s*playing|now\s*playing|current\s*track)/i,
  ],
  handler: (match, ctx) => new Promise((resolve) => {
    if (!ctx.spotify) return resolve(null); // AI'a devret
    ctx.spotify.getSpotifyStatus().then((s) => {
      if (!s.running) return resolve('Spotify şu an açık değil — açmamı ister misin?')
      if (!s.track) return resolve('Spotify açık ama şu an çalan bir şarkı yok — başka bir uygulama ses çalıyor olabilir.')
      resolve(s.playing
        ? `Şu an çalıyor: ${s.track} — ${s.artist || 'bilinmiyor'}`
        : `Duraklatılmış: ${s.track} — ${s.artist || 'bilinmiyor'}`)
    });
  }),
});

// 10. GITHUB DURUMU (repo listesi / son commit / diff — sadece OKUMA)
// Sadece NET GitHub komutları yakalansın; "github" kelimesi GDD gibi uzun metinlerde
// geçtiğinde yanlış tetiklenmesin.
registerSkill({
  name: 'github',
  patterns: [
    /^(github|gh)\s*(durumu|durum|repolarım|repo|hesap)/i,
    /^(repo|depolarım|repolarım)\s*(liste|göster|durum|ne\s*var|durumu)/i,
    /^(github|gh).*(listele|göster|durumu)/i,
    /^son\s*commit.*(github|repo)/i,
  ],
  handler: (match, ctx) => new Promise((resolve) => {
    if (!ctx.github) return resolve('GitHub modülü hazır değil.');
    const text = String(match.input || '').toLowerCase();
    ctx.github.config().then((cfg) => {
      if (!cfg.hasToken) {
        return resolve('GitHub tokenı yok — repo bilgisi almak için `HarleyKod/github-token.txt` dosyasına kişisel erişim tokenını yapıştır (okuma izni yeterli). Tokenı koyunca repolarını listeleyebilirim.');
      }
      // Belirli repo adı var mı? "X repo'sunun durumu"
      const repoMatch = text.match(/([a-z0-9_.-]+)\s*(repo|deposu|repository)/i);
      if (repoMatch && repoMatch[1] && repoMatch[1].length > 2) {
        ctx.github.repoStatus(repoMatch[1]).then((s) => {
          if (s.error) return resolve('Repo bilgisi alınamadı: ' + (s.message || s.error));
          const lines = [
            `📦 ${s.name}${s.private ? ' (özel)' : ''}`,
            s.desc ? s.desc : '',
            `Son push: ${s.pushed ? new Date(s.pushed).toLocaleDateString('tr-TR') : 'bilinmiyor'} | Açık issue: ${s.openIssues}`,
          ];
          if (s.lastCommits && s.lastCommits.length) {
            lines.push('Son commitler:');
            for (const c of s.lastCommits) lines.push(`  ${c.sha} ${c.message}`);
          }
          resolve(lines.filter(Boolean).join('\n'));
        });
      } else {
        ctx.github.listRepos().then((repos) => {
          if (!Array.isArray(repos)) return resolve('Repo listesi alınamadı: ' + ((repos && repos.message) || 'token sorunu'));
          if (!repos.length) return resolve('Hiç repo bulunamadı.');
          const lines = ['GitHub repoların (' + repos.length + '):'];
          for (const r of repos.slice(0, 12)) {
            lines.push(`  ${r.name}${r.private ? ' [gizli]' : ''} — ${(r.desc || r.language || 'güncellendi: ' + (r.updated || '').slice(0, 10))}`);
          }
          resolve(lines.join('\n'));
        });
      }
    });
  }),
});

// 10. PROJE DURUMU (Project Memory — "devam edelim" dediğinde geçmişi hatırla)
registerSkill({
  name: 'project-status',
  patterns: [
    /(proje|oyun|repo)\s*(ne\s*durumda|durumu|nasıl\s*gidiyor|nerede\s*kaldık|devam)/i,
    /(devam\s*edelim|kaldık|nerede\s*kaldık|sonra\s*devam)/i,
  ],
  handler: (match, ctx) => new Promise((resolve) => {
    // Aktif bir görev varken "nerede kaldık / devam et" model'e gitsin (görev bağlamıyla devam eder),
    // proje durumu raporuyla hijack etmesin.
    if (ctx && ctx.hasActiveTask) return resolve(null);
    if (!ctx.projectMemory) return resolve('Proje belleği hazır değil.');
    const text = String(match.input || '').toLowerCase();
    ctx.projectMemory.scanProjects().then((projects) => {
      if (!projects || !projects.length) return resolve('Henüz tanınmış bir proje yok. Git reposu olan klasörler otomatik izlenir.');
      // İsme göre eşleştir
      const words = text.split(/\s+/).filter((w) => w.length > 3 && !/durum|proje|devam|edelim|nasıl|gidiyor|oyun|repo|ne|kaldık/i.test(w));
      let hit = null;
      for (const w of words) {
        hit = projects.find((p) => p.name.toLowerCase().includes(w)) || null;
        if (hit) break;
      }
      if (!hit) hit = projects[0];
      const lines = [
        `[Proje] ${hit.name}${hit.stale ? ' (şu an bulunamadı)' : ''}`,
        hit.lastCommit ? 'Son commit: ' + hit.lastCommit : '',
        hit.changedFiles ? 'Değişen dosya: ' + hit.changedFiles : 'Çalışma alanı temiz',
      ];
      if (hit.todos && hit.todos.length) {
        lines.push('TODO' + (hit.todos.length > 1 ? 'lar' : '') + ':');
        for (const t of hit.todos.slice(0, 5)) lines.push('  ' + t);
      }
      lines.push('');
      lines.push('Not: Detaylar Ayarlar → Projeler bölümünden izlenir; not eklemek istersen söyle.');
      resolve(lines.join('\n'));
    });
  }),
});

// 11. MATEMATİK / HESAPLAMA
registerSkill({
  name: 'calculator',
  patterns: [
    /^[\d\s\+\-\*\/\.\(\)%]+$/ // Saf matematik ifadesi
  ],
  handler: (match) => {
    try {
      const expr = match[0].trim();
      if (expr.length < 2) return null;
      // Güvenli evaluation: sadece sayı ve operatör
      const safe = expr.replace(/[^0-9\+\-\*\/\.\(\)%\s]/g, '');
      if (safe !== expr) return null; // Güvenli değil
      // eslint-disable-next-line no-eval
      const result = Function('"use strict";return (' + safe + ')')();
      if (typeof result !== 'number' || !isFinite(result)) return null;
      return `${expr} = ${result}`;
    } catch { return null; }
  },
});

// 10. DOSYA BOYUTU
registerSkill({
  name: 'file-size',
  patterns: [
    /klasör?\s*(boyutu|ne\s*kadar|büyüklüğü)/i,
    /(dosya|klasör)\s*(büyüklüğü|boyutu)/i,
  ],
  handler: (match) => new Promise((resolve) => {
    const text = match.input || '';
    // Basit bir klasör yolu çıkarmaya çalış
    const pathMatch = text.match(/([A-Z]:[\\/])/i);
    if (!pathMatch) return resolve('Hangi klasörün boyutunu ölçmemi istiyorsun? Tam yolu söyle.');

    const dir = text.substring(text.indexOf(pathMatch[0])).split(/\s/)[0];
    const ps = `$s=(Get-ChildItem -Path '${dir}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum; if($s){"${dir}: $([math]::Round($s/1MB,1)) MB"} else{"${dir}: boş veya bulunamadı"}`;
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (e, out) => {
      resolve(out ? out.trim() : 'Klasör boyutu hesaplanamadı.');
    });
  }),
});

// 12. KOD İNCELEME MODU
registerSkill({
  name: 'code-review',
  patterns: [
    /kodu?\s*(incele|değerlendir|kontrol|gözden geçir|review)/i,
    /inceleme\s*(yap|modu)/i,
    /(hata|bug|güvenlik|performans|refactor).*bul/i,
    /kod\s*(incele|değerlendir|kontrol)/i,
  ],
  handler: () => null,
  needsAI: true,
});

// 13. EKRAN GÖRÜNTÜSÜ ANALİZİ
registerSkill({
  name: 'screen-analysis',
  patterns: [
    /ekrana\s*(bak|göster|incele|analiz)/i,
    /(ekran|monitor|görüntü).*((ne\s*var|neler|göster|incele|analiz|oku|hata|hatayı))/i,
    /screenshot.*(incele|analiz|oku|göster)/i,
    /(hatayı|hata|error).*görünce çöz/i,
  ],
  handler: () => null,
  needsAI: true,
});

// 14. GÖREV PLANI OLUŞTUR — sadece net plan isteklerinde
registerSkill({
  name: 'task-plan',
  patterns: [
    /(adım\s*adım|sıralı|planlı)\s*(yap|başlat|oluştur|devam)/i,
    /(karmaşık|büyük|uzun|kapsamlı)\s*(bir|olan|iş|görev).*(yap|oluştur|başlat)/i,
    /görev\s*(oluştur|başla|hazırla)/i,
  ],
  handler: () => null,
  needsAI: true,
});

// 15. KOD İNCELEME / REFACTORING
registerSkill({
  name: 'code-review',
  patterns: [
    /kodu?\s*(incele|değerlendir|kontrol|gözden geçir|review)/i,
    /(hata|bug|güvenlik|performans|kalite).*(bul|kontrol|incele|öz)/i,
    /refactor|yeniden\s*yaz|iyileştir/i,
    /kod\s*(öneri|tavsiye|iyileştirme)/i,
  ],
  handler: async (match, ctx) => {
    // Kod inceleme isteği — AI'a devret ama önce analiz yap
    return null;
  },
  needsAI: true,
});

// 16. GITHUB DEEP INTEGRATION — DEVRE DIŞI: modern github.js + git_* araçları kullanılıyor.
// Eski gh CLI handler'ı GDD gibi uzun metinlerde yanlış tetiklenip "gh auth login" hatası veriyor.
// registerSkill({ name: 'github-deep', patterns: [...], handler: async () => {} });

// 17. IDE ENTEGRASYONU
registerSkill({
  name: 'ide-integration',
  patterns: [
    /(vs\s*code|vscode|editör|editor).*aç/i,
    /(aç|başlat).*vs\s*code/i,
    /eklenti.*(listele|göster|yükle)/i,
    /plugin.*(listele|göster)/i,
  ],
  handler: async (match, ctx) => {
    const text = match[0].toLowerCase();
    if (text.includes('eklenti') || text.includes('plugin')) return await ideAction('extensions');
    return await ideAction('open');
  },
});

// 18. API TESTING
registerSkill({
  name: 'api-test',
  patterns: [
    /(api|endpoint|url).*((test|dene|kontrol|çağrı|istek))/i,
    /(test|dene|kontrol).*api/i,
    /(get|post|put|delete).*http/i,
    /http.*(test|dene|kontrol)/i,
  ],
  handler: async (match, ctx) => {
    // URL'yi çıkar
    const urlMatch = match[0].match(/(https?:\/\/[^\s]+)/i);
    if (urlMatch) return await apiTest(urlMatch[1]);
    return null;
  },
  needsAI: true,
});

// 19. KULLANICI TERCİHİ ÖĞRENME
registerSkill({
  name: 'user-preference',
  patterns: [
    /(ben|kullanıcı).*(seviyorum|hoşlanıyorum|tercih|istiyorum|kullanıyorum)/i,
    /(favori|beğendiğim|sevdiğim|kullandığım)/i,
    /(benim|kişisel).*(ayar|tercih|özellik)/i,
  ],
  handler: async (match, ctx) => {
    // Tercihi öğren ve kaydet
    const text = match[0];
    if (text.includes('seviyorum') || text.includes('hoşlanıyorum')) {
      learnPreference('likes', text);
      return 'Tercihin kaydedildi: ' + text;
    }
    return null;
  },
  needsAI: true,
});

// 20. HATA KURTARMA — sadece net hata ifadelerinde tetiklenir
registerSkill({
  name: 'error-recovery',
  patterns: [
    /(hata|error|sorun|problem|çalışmıyor|bozuk|kırık).*(nasıl|çözüm|ne|yap)/i,
    /(başarısız|olmadı|yapamadım).*(nasıl|çözüm|ne|yap)/i,
  ],
  handler: async (match, ctx) => {
    if (errorHistory.length > 0) {
      const lastError = errorHistory[errorHistory.length - 1];
      return getRecoverySuggestion(lastError.error);
    }
    return null;
  },
  needsAI: true,
});

// 21. KOD ÖNERİSİ / REFACTORING
registerSkill({
  name: 'code-suggestion',
  patterns: [
    /(kod|fonksiyon|sınıf|method).*(öneri|tavsiye|iyileştir|geliştir)/i,
    /(daha\s*iyi|daha\s*temiz|daha\s*akıcı).*yaz/i,
    /refactor|yeniden\s*yap/i,
  ],
  handler: async (match, ctx) => {
    return null; // AI'a devret
  },
  needsAI: true,
});

// 11. DEEPSEEK API TEST
registerSkill({
  name: 'api-test-deepseek',
  patterns: [
    /api\s*(key|anahtar)\s*(test|kontrol|dene|çalışıyor|sağlıklı)/i,
    /deepseek\s*(test|kontrol|dene|çalışıyor|bağlan)/i,
    /baglanti\s*(test|kontrol)/i,
    /sohbet\s*(çalışıyor|bağlanıyor|test)/i,
  ],
  handler: () => new Promise((resolve) => {
    const https = require('https');
    let cfg = {};
    try {
      cfg = secureStore.readJson(FILES.deepseek);
      if (cfg.apiKey) cfg.apiKey = cfg.apiKey.trim();
    } catch {
      return resolve('DeepSeek anahtarı bulunamadı — sol menüdeki "Bağlantılar" panelinden ekle.');
    }
    if (!cfg.apiKey) return resolve('DeepSeek anahtarı boş — sol menüdeki "Bağlantılar" panelinden ekle.');

    const body = JSON.stringify({ model: cfg.model || 'deepseek-flash', messages: [{ role: 'user', content: 'test' }], max_tokens: 5 });
    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          let model = '';
          try { model = JSON.parse(d).model || ''; } catch { /* yok */ }
          resolve('DeepSeek API calisiyor. Model: ' + (model || 'yanit alindi') + ' (HTTP 200)');
        } else if (res.statusCode === 401) {
          resolve('API key GECERSIZ (HTTP 401). Key\'i kontrol et: ' + cfg.apiKey.slice(0, 8) + '...');
        } else if (res.statusCode === 402) {
          resolve('Bakiye yetersiz (HTTP 402). DeepSeek hesabini yukle.');
        } else if (res.statusCode === 429) {
          resolve('Rate limit asildi (HTTP 429). Biraz bekle.');
        } else {
          let errMsg = 'HTTP ' + res.statusCode;
          try { errMsg += ': ' + JSON.parse(d).error.message; } catch { /* yok */ }
          resolve('DeepSeek hatasi: ' + errMsg);
        }
      });
    });
    req.on('error', (e) => resolve('Ag hatasi: ' + e.message));
    req.setTimeout(10000, () => { req.destroy(); resolve('Zaman asimi — DeepSeek yanit vermedi.'); });
    req.write(body);
    req.end();
  }),
});

// 12. ANLAMSIZ BOŞ / ÇOK KISA
registerSkill({
  name: 'too-short',
  patterns: [/^.{0,2}$/], // 2 karakterden kısa
  handler: () => 'Anlayamadım — biraz daha açık yazar mısın?',
});

// ---------- USER PREFERENCE LEARNING ----------
const userPrefs = {};
function learnPreference(key, value) {
  userPrefs[key] = value;
  // Belleğe kaydet
  try {
    const prefsPath = FILES.userPrefs;
    const existing = fs.existsSync(prefsPath) ? JSON.parse(fs.readFileSync(prefsPath, 'utf8')) : {};
    existing[key] = value;
    fs.writeFileSync(prefsPath, JSON.stringify(existing, null, 2), 'utf8');
  } catch (e) {}
}
function getPreference(key) {
  return userPrefs[key];
}

// ---------- ERROR RECOVERY ----------
const errorHistory = [];
function recordError(error, context) {
  errorHistory.push({ error: String(error), context, time: Date.now() });
  // Son 20 hatayı tut
  if (errorHistory.length > 20) errorHistory.shift();
}
function getRecoverySuggestion(error) {
  const errStr = String(error).toLowerCase();
  if (errStr.includes('timeout') || errStr.includes(' zaman aşımı')) return 'Bağlantı zaman aşımına uğradı. Lütfen tekrar dene.';
  if (errStr.includes('network') || errStr.includes('ağ')) return 'Ağ bağlantısı yok. Çevrimdışı modda çalışıyorum.';
  if (errStr.includes('model') || errStr.includes('model')) return 'Model yüklenemedi. Farklı bir model dene.';
  if (errStr.includes('token') || errStr.includes('limit')) return 'Token limiti aşıldı. Daha kısa bir soru sor.';
  return 'Bir hata oluştu. Tekrar dene veya farklı bir yaklaşım kullan.';
}

// ---------- REFACTORING SUGGESTIONS ----------
function analyzeCode(code) {
  const suggestions = [];
  // Uzun fonksiyon kontrolü
  const funcMatches = code.match(/function\s+\w+/g) || [];
  if (funcMatches.length > 5) suggestions.push('Çok fazla fonksiyon var. Modüllere ayır.');
  // Tekrarlanan kod kontrolü
  const lines = code.split('\n');
  const lineCount = {};
  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.length > 10) lineCount[trimmed] = (lineCount[trimmed] || 0) + 1;
  });
  Object.entries(lineCount).forEach(([line, count]) => {
    if (count > 2) suggestions.push(`Tekrarlanan satır (${count}x): ${line.slice(0, 40)}...`);
  });
  // Hata yakalama kontrolü
  if (code.includes('try') && !code.includes('catch')) suggestions.push('try bloğu var ama catch yok.');
  // Yorum eksikliği
  if (code.split('\n').length > 30 && !code.includes('//')) suggestions.push('Uzun kod parçası yorum eksik.');
  return suggestions;
}

// ---------- IDE INTEGRATION ----------
async function ideAction(action, args) {
  const { execFile } = require('child_process');
  const util = require('util');
  const execFileAsync = util.promisify(execFile);
  try {
    if (action === 'open') {
      const file = args || '.';
      await execFileAsync('code', [file]);
      return 'VS Code açıldı: ' + file;
    }
    if (action === 'extensions') {
      const { stdout } = await execFileAsync('code', ['--list-extensions']);
      return 'Yüklü eklentiler:\n' + stdout;
    }
  } catch (e) {
    return 'IDE hatası: ' + e.message;
  }
  return null;
}

// ---------- API TESTING ----------
async function apiTest(url, method, body) {
  const http = require('http');
  const https = require('https');
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const options = {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    };
    const req = mod.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(`HTTP ${res.statusCode}\n${data.slice(0, 500)}`));
    });
    req.on('error', (e) => resolve('API hatası: ' + e.message));
    req.on('timeout', () => { req.destroy(); resolve('Zaman aşımı'); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------- AKTİF PROJE (proje hafızası) ----------
registerSkill({
  name: 'active-project',
  patterns: [
    /(?:şu|bu|aktif)\s*projede\s*çalışıyoruz\s*[:]?\s*(.+)/i,
    /proje[yi]?\s*(?:seç|geç|değiştir|belirle)\s*(.+)/i,
    /aktif\s*proje\s*(.+)/i,
  ],
  handler: (match, ctx) => {
    const name = String(match[1] || '').trim();
    if (!name) return 'Hangi proje? Örn. "aktif proje deneme_todo" de.';
    if (ctx.setActiveProject) ctx.setActiveProject(name);
    return 'Aktif proje: "' + name + '". Artık bu proje için ürettiğim dosyaları oraya yazacağım ve notlarını hatırlayacağım.';
  },
});

// ---------- OTOMATİK YAZMA MODU (planla-onayla-yaz) ----------
registerSkill({
  name: 'auto-write',
  patterns: [
    /yazma modunu?\s*(aç|ac|kapat|kapa)/i,
    /(dosyaları|kodları)\s*(doğrudan|otomatik|kendin)\s*yaz/i,
    /otomatik\s*yazma/i,
  ],
  handler: (match, ctx) => {
    const turnOn = /aç|ac/i.test(match[0]) && !/kapat|kapa/i.test(match[0]);
    if (ctx.setAutoWrite) ctx.setAutoWrite(turnOn);
    return turnOn
      ? 'Tamam, otomatik yazma modu AÇIK. Kod dosyası ürettiğimde onları doğrudan projeye yazacağım (checkpoint alarak ilerlerim). "yazma modunu kapat" deyince dururum.'
      : 'Otomatik yazma modu kapalı. Artık dosyaları doğrudan yazmayacağım.';
  },
});

// ---------- SPOTIFY: bağla / şarkı çal (Web API) ----------
registerSkill({
  name: 'spotify-bind',
  patterns: [
    /spotify[ıi]?\s*(bağla|bagla|bağlan|baglan|giriş|gir|yetkilendir|bağlantı)/i,
    /(bağla|bağlan|giriş\s*yap)\s*spotify/i,
    /spotify.*(auth|login|connect|link)/i,
  ],
  handler: async (match, ctx) => {
    if (!ctx.spotifyWeb) return null;
    if (!ctx.spotifyWeb.isConfigured()) {
      return 'Spotify şarkı çalma için Client ID gerekli. HarleyDosyalar/spotify-config.json içine "clientId" eklemelisin, sonra tekrar "spotify bağla" de.';
    }
    const r = await ctx.spotifyWeb.connect();
    if (!r.ok) return 'Spotify bağlanamadı: ' + (r.message || r.error || 'Bilinmeyen hata');
    return r.message || 'Spotify\'ya bağlandım! 🎵';
  },
});

registerSkill({
  name: 'spotify-play',
  patterns: [
    // Sadece NET şarkı çalma komutları. ^ ile cümle başı zorunlu + şarkı adı (+.+) zorunlu —
    // böylece uzun oyun taslağı gibi metinlerde "müzik/şarkı" kelimesi geçince yanlış tetiklenmez.
    /^spotify'?da?\s+(?:bana\s+)?(?:bu\s+)?(?:şarkı|müzik|parça|şarkısını)\s*(?:çal|aç|başlat)\s+(.+)/i,
    /^spotify'?da?\s+(?:çal|aç|başlat)\s+(.+)/i,
    /^(?:bana\s+)?(?:şarkı|müzik|parça)\s*(?:çal|aç|başlat)\s+(.+)/i,
    /^şarkısını?\s*(?:çal|aç|başlat)\s+(.+)/i,
    /^play\s+(.+)/i,
  ],
  handler: async (match, ctx) => {
    if (!ctx.spotifyWeb) return 'Spotify şarkı çalma şu an kullanılamıyor.';
    if (!ctx.spotifyWeb.isConfigured()) return 'Spotify şarkı çalma için önce bağlanmam lazım — "Spotify bağla" de.';
    const query = String(match[1] || '').trim();
    if (!query) return 'Hangi şarkıyı çalayım? Şarkı adını söyle, örn. "şarkı aç Sezen Aksu".';
    const r = await ctx.spotifyWeb.playQuery(query);
    if (r.error === 'not_authorized') return 'Spotify hesabına henüz bağlı değilim. "Spotify bağla" de.';
    if (r.error === 'no_result') return 'Spotify\'da "' + query + '" diye bir şarkı bulamadım.';
    if (r.error === 'no_active_device') return 'Çalacak aktif bir Spotify cihazı bulamadım. Spotify uygulamasının açık olduğundan emin ol, sonra tekrar dene.';
    if (!r.ok) return 'Şarkıyı çalarken hata oldu: ' + (r.error || 'Bilinmeyen');
    return 'Şimdi Spotify\'da "' + r.track.name + '" — ' + r.track.artist + ' çalıyor. 🎵';
  },
});

// ---------- PERSONALIZATION: Profil / Stil / Rutin ----------
registerSkill({
  name: 'personalization-profile',
  patterns: [
    /(profil|profili?m)\s*(göster|getir|ne|nasıl)/i,
    /(kişisel|kendime)\s*(ayar|tercih|profil)/i,
    /benim\s*(stilim|tercihim|profilim)/i,
  ],
  handler: async (match, ctx) => {
    if (!ctx.personalization) return null;
    const profile = await ctx.personalization.getProfile();
    const lines = [
      '## Kişisel Profilin',
      `İsim: ${profile.name || '(yok)'}`,
      `Hitap: ${profile.address || '(yok)'}`,
      `Cevap stili: ${profile.responseStyle}`,
      `Ton: ${profile.writingStyle.tone}`,
      `Ayrıntı: ${profile.writingStyle.verbosity}`,
      `Emoji: ${profile.emoji ? 'açık' : 'kapalı'}`,
      `Kod stili: ${profile.codeStyle.indent} space, ${profile.codeStyle.quotes} quotes, semicolon: ${profile.codeStyle.semicolons}`,
      `İlgi alanları: ${profile.interests.length ? profile.interests.join(', ') : '(öğreniliyor)'}`,
      `Öğrenilen gerçekler: ${profile.learnedFacts.length}`,
    ];
    return lines.join('\n');
  },
});

registerSkill({
  name: 'personalization-update',
  patterns: [
    /(profil|stil|tercih)\s*(güncelle|değiştir|ayarla)\s+(.+)/i,
    /(benim|ben)\s*(isim|ad|hitap)\s*[:=]\s*(.+)/i,
    /cevap\s*stili\s*[:=]\s*(kısa|orta|detaylı)/i,
    /kod\s*stili\s*[:=]\s*(.+)/i,
  ],
  handler: async (match, ctx) => {
    if (!ctx.personalization) return null;
    const text = match[0].toLowerCase();
    const updates = {};
    
    if (text.includes('isim') || text.includes('ad') || text.includes('hitap')) {
      const val = match[3]?.trim();
      if (val) updates.address = val;
    }
    if (text.includes('cevap stili') || text.includes('response style')) {
      const val = match[3]?.trim();
      if (['kısa', 'orta', 'detaylı'].includes(val)) updates.responseStyle = val;
    }
    if (text.includes('kod stili')) {
      // basit parse: "2 space, single quotes, semicolons true"
      updates.codeStyle = {};
      const indentMatch = text.match(/(\d+)\s*space/);
      if (indentMatch) updates.codeStyle.indent = parseInt(indentMatch[1]);
      if (text.includes('double quote') || text.includes('çift tırnak')) updates.codeStyle.quotes = 'double';
      if (text.includes('single quote') || text.includes('tek tırnak')) updates.codeStyle.quotes = 'single';
      if (text.includes('semicolon') || text.includes('noktalı virgül')) {
        updates.codeStyle.semicolons = !text.includes('yok') && !text.includes('false');
      }
    }
    
    if (Object.keys(updates).length === 0) return 'Ne güncellenmeli? Örn: "cevap stili: kısa", "kod stili: 2 space single quotes semicolon true", "benim adım: Ahmet"';
    
    ctx.personalization.updateProfile(updates);
    return 'Profil güncellendi: ' + JSON.stringify(updates);
  },
});

registerSkill({
  name: 'routine-insights',
  patterns: [
    /(rutin|alışkanlık|çalışma\s*saati)\s*(göster|analiz|ne|nasıl)/i,
    /(ne\s*zaman|hangi\s*saat)\s*(en\s*aktif|çalışıyor|kodluyor)/i,
    /proaktif\s*(öneri|tavsiye)/i,
  ],
  handler: async (match, ctx) => {
    if (!ctx.personalization) return null;
    const insights = ctx.personalization.getRoutineInsights();
    const suggestion = ctx.personalization.getProactiveSuggestion();
    const lines = ['## Rutin Analizi'];
    if (insights.length) lines.push(...insights.map(i => '• ' + i));
    else lines.push('Henüz yeterli veri yok — daha fazla komut kullanınca öğrenirim.');
    if (suggestion) lines.push('\n💡 ' + suggestion);
    return lines.join('\n');
  },
});

registerSkill({
  name: 'record-activity',
  patterns: [
    /^proje\s+(.+)\s+(başladım|başlıyorum|devam)/i,
    /^(.+)\s+projesinde\s+çalışıyorum/i,
  ],
  handler: async (match, ctx) => {
    if (!ctx.personalization) return null;
    const project = match[1]?.trim();
    if (!project) return null;
    ctx.personalization.recordActivity('project', { project, duration: 0 });
    return `"${project}" projesi için aktivite kaydedildi.`;
  },
});

// ---------- TEST RUNNER ----------
registerSkill({
  name: 'test-run',
  patterns: [
    /test(ler)?\s*(çalıştır|run|yap|et)/i,
    /(npm\s*test|pytest|cargo\s*test|go\s*test)\s*(çalıştır|run)?/i,
    /test\s+watch/i,
    /test\s+coverage/i,
  ],
  handler: async (match, ctx) => {
    if (!ctx.testRunner) return null;
    const text = match[0].toLowerCase();
    const sessionId = ctx.sessionId;
    if (!sessionId) return 'Önce bir proje klasörü bağla (workspace_pick).';
    
    const options = { sessionId };
    if (text.includes('watch')) options.watch = true;
    if (text.includes('coverage')) options.coverage = true;
    if (text.includes('bail') || text.includes('strict')) options.bail = true;
    
    const result = await ctx.testRunner.run(options);
    if (!result.ok) return 'Test hatası: ' + (result.error || result.stderr);
    
    const s = result.summary;
    return `Test tamam (${result.framework}): ${s.passed} geçti, ${s.failed} başarısız, ${s.skipped} atlandı${s.duration ? ` (${s.duration.toFixed(1)}s)` : ''}`;
  },
});

registerSkill({
  name: 'test-config',
  patterns: [
    /test\s*(config|ayar|framework|algıla)/i,
    /hangi\s*test\s*(framework|kütüphane)/i,
  ],
  handler: async (match, ctx) => {
    if (!ctx.testRunner) return null;
    const sessionId = ctx.sessionId;
    if (!sessionId) return 'Önce bir proje klasörü bağla.';
    const config = await ctx.testRunner.getConfig({ sessionId });
    if (!config) return 'Test yapılandırması bulunamadı.';
    return T('Proje: {p}\nFramework: {f}\nWatch: {w}\nCoverage: {c}', {
      p: config.projectType, f: config.framework,
      w: i18n.getLang() === 'en' ? (config.hasWatch ? 'yes' : 'no') : (config.hasWatch ? 'evet' : 'hayır'),
      c: i18n.getLang() === 'en' ? (config.hasCoverage ? 'yes' : 'no') : (config.hasCoverage ? 'evet' : 'hayır'),
    });
  },
});

// ---------- Classification engine ----------

/**
 * Kullanıcı girişini sınıflandırır.
 * @param {string} input - Kullanıcının yazdığı
 * @param {object} ctx - Bağımlılıklar (mainWindow, settings, probe, vb.)
 * @returns {{ handled: boolean, response?: string, skill?: string, needsAI?: boolean }}
 */
function classify(input, ctx) {
  const text = String(input || '').trim();
  if (!text) return { handled: true, response: T('Bir yazman gerekiyor.'), skill: 'empty' };

  for (const skill of skills) {
    for (const pattern of skill.patterns) {
      const match = text.match(pattern);
      if (match) {
        console.log('[classifier] Skill tetiklendi:', skill.name, 'pattern:', pattern.toString());
        // Handler senkron veya async olabilir
        const result = skill.handler(match, ctx);
        if (result === null || result === undefined) {
          // Handler reddetti — AI'a devret
          return { handled: false, skill: skill.name, needsAI: true };
        }
        // Promise ise async olarak çöz
        if (result && typeof result.then === 'function') {
          return { handled: false, skill: skill.name, needsAI: false, _asyncHandler: result };
        }
        // Senkron cevap (TR kaynak → seçili dil)
        return { handled: true, response: (typeof result === 'string' ? T(result) : result), skill: skill.name };
      }
    }
  }

  // Eşleşme yok — AI'a gönder
  return { handled: false, needsAI: true };
}

/**
 * Async handler'ı çalıştırır.
 */
async function runAsyncHandler(classification) {
  if (classification._asyncHandler) {
    let response = await classification._asyncHandler;
    if (typeof response === 'string') response = T(response);
    return { handled: true, response, skill: classification.skill };
  }
  return classification;
}

module.exports = { classify, runAsyncHandler, registerSkill, skills, learnPreference, getPreference, recordError, getRecoverySuggestion, analyzeCode, ideAction, apiTest };
