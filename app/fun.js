// fun.js — Eğlence: sohbet oyunları, günlük motivasyon, ilginç bilgi, günün şarkısı.
// Oyun durumu SOHSBET OTURUMU bazlı tutulur: her sessionId'nin kendi aktif oyunu vardır.
// Böylece oyun sadece başlatıldığı sohbette devam eder; başka sohbet etkilenmez.

const games = new Map(); // sessionId -> { game, data }
let lastSong = null; // { title, artist, ts } — ts = öneri zamanı (2 dk geçerlilik)

// ---------- içerik listeleri ----------
const QUOTES = [
  '"Bugün yapabileceğin en iyi şey, yarın için attığın en küçük adımdır."',
  '"Zorluklar, gücünü keşfetmen için gelir."',
  '"Küçük ilerlemeler, büyük sonuçlar yaratır."',
  '"Başarı, her gün tekrarlanan küçük disiplinlerden doğar."',
  '"Hata yapmak öğrenmenin ilk adımıdır — devam et."',
  '"Odaklandığın şey büyür. İyiye odaklan."',
  '"Bugün dünden bir adım önde olmak yeterli."',
  '"Sakin kalmak, her kapının anahtarıdır."',
  '"Hayal et, inan, harekete geç."',
  '"En güçlü anın, pes etmeye karar verdiğin anın hemen sonrasıdır."',
];
const FACTS = [
  'Ahtapotların üç kalbi ve mavi kanı vardır.',
  'Bal arıları dans ederek birbirine yön bilgisi aktarır.',
  'İnsan vücudundaki kemik sayısı 206; yeni doğan bebekte 300 civarıdır.',
  'Deniz seviyesinde su 100°C\'de kaynar; Everest\'te ise 71°C civarında.',
  'Işık saniyede yaklaşık 300.000 km yol alır.',
  'Bir günde yaklaşık 60.000 kez nefes alırsın.',
  'Kediler gece görüşlerini geliştiren bir tapetum lucidum tabakasına sahiptir.',
  'Muz bilimsel olarak meyve, çilek ise meyve değildir (toplu çiçek kümesidir).',
  'Uzayda "uğultu" olmaz çünkü ses taşıyacak hava yoktur.',
  'İnternetteki tüm veriler toplansa, birkaç milyon sunucu dolusu disk demektir.',
  'Bir insan ömründe yaklaşık iki araba dolusu su içer.',
  'Kutup ayılarının derisi siyahtır, tüyleri şeffaftır.',
];
const SONGS = [
  { title: 'Dance Monkey', artist: 'Tones and I' },
  { title: 'Blinding Lights', artist: 'The Weeknd' },
  { title: 'Shape of You', artist: 'Ed Sheeran' },
  { title: 'Happy', artist: 'Pharrell Williams' },
  { title: 'Uptown Funk', artist: 'Mark Ronson ft. Bruno Mars' },
  { title: 'Rolling in the Deep', artist: 'Adele' },
  { title: 'Levitating', artist: 'Dua Lipa' },
  { title: 'Düşünme Hiç', artist: 'Sezen Aksu' },
  { title: 'Gel Gel', artist: 'Tarkan' },
  { title: 'Aşk Laftan Anlamaz', artist: 'Hadise' },
  { title: 'Ecstacy', artist: 'Şanışer' },
  { title: 'Yolla', artist: 'Mabel Matiz' },
];
const WORDS = ['deniz', 'elma', 'kitap', 'kalem', 'güneş', 'masa', 'kapı', 'çiçek', 'dağ', 'köprü', 'bilgisayar', 'arkadaş'];
// 20 Soru: spesifik nesneler + evet/hayır cevabı için özellikler.
// Özellik anahtarları: canli, bitki, yenilebilir, tasit, alet, giysi, ses, ucar, yuzer, evcil, buyuk, elektrikli
const SECRETS_20 = [
  { cevap: 'kedi', ipucu: 'Miyavlar, evcil olabilir.', canli: true, evcil: true, ses: true, buyuk: false, test: (s) => /kedi/i.test(s) },
  { cevap: 'köpek', ipucu: 'Havlar, sadık dost.', canli: true, evcil: true, ses: true, buyuk: false, test: (s) => /köpek|kopek/i.test(s) },
  { cevap: 'elma', ipucu: 'Kırmızı veya yeşil olabilir.', bitki: true, yenilebilir: true, canli: false, buyuk: false, test: (s) => /elma/i.test(s) },
  { cevap: 'muz', ipucu: 'Sarı, uzun, soyulur.', bitki: true, yenilebilir: true, canli: false, buyuk: false, test: (s) => /muz\b/i.test(s) },
  { cevap: 'araba', ipucu: 'Dört tekerlekli, yol gider.', tasit: true, canli: false, buyuk: false, ses: true, test: (s) => /araba|otomobil/i.test(s) },
  { cevap: 'uçak', ipucu: 'Gökyüzünde gider, kanatları var.', tasit: true, ucar: true, canli: false, buyuk: true, ses: true, test: (s) => /uçak|ucak/i.test(s) },
  { cevap: 'bisiklet', ipucu: 'İki teker, pedal çevrilir.', tasit: true, canli: false, buyuk: false, test: (s) => /bisiklet/i.test(s) },
  { cevap: 'çekiç', ipucu: 'Bir şey çakmaya yarar, metal başlı.', alet: true, canli: false, ses: true, buyuk: false, test: (s) => /çekiç|cekic/i.test(s) },
  { cevap: 'telefon', ipucu: 'Konuşulur, dokunmatik olabilir.', alet: true, elektrikli: true, ses: true, canli: false, buyuk: false, test: (s) => /telefon|cep/i.test(s) },
  { cevap: 'kitap', ipucu: 'Okunur, sayfaları vardır.', canli: false, alet: false, buyuk: false, test: (s) => /kitap/i.test(s) },
  { cevap: 'balık', ipucu: 'Suda yaşar, yüzgeçleri var.', canli: true, yuzer: true, yenilebilir: true, buyuk: false, test: (s) => /balık|balik/i.test(s) },
  { cevap: 'gül', ipucu: 'Kokar, dikenli olabilir, kırmızı.', bitki: true, canli: false, buyuk: false, test: (s) => /gül|gul\b/i.test(s) },
  { cevap: 'saat', ipucu: 'Zamanı gösterir, kol veya duvar.', alet: true, elektrikli: true, canli: false, buyuk: false, test: (s) => /saat\b/i.test(s) },
  { cevap: 'masa', ipucu: 'Üstüne eşya konulur, düz.', canli: false, alet: false, buyuk: false, test: (s) => /masa\b/i.test(s) },
  { cevap: 'kapı', ipucu: 'Açılıp kapanır, içeri girilir.', canli: false, alet: false, buyuk: false, test: (s) => /kapı|kapi\b/i.test(s) },
  { cevap: 'çilek', ipucu: 'Kırmızı, küçük, tatlı.', bitki: true, yenilebilir: true, canli: false, buyuk: false, test: (s) => /çilek|cilek/i.test(s) },
];
let last20Index = null;

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// 20 Soru: soru cümlesini analiz edip nesnenin özelliklerine göre evet/hayır döndürür.
function answer20Question(question, secret) {
  const q = String(question || '').toLowerCase().trim();
  // Soru kalıbı: "mi/mı/mu/mü" ile bitiyor veya soru işareti var
  const isQ = /[?]|(\b(m[iıuü])\b)/i.test(q) || / m[iıuü](\s|\?|$)/i.test(q);
  if (!isQ) return null; // soru değilse tahmin olarak değerlendir
  // Anahtar kelime → özellik eşlemesi
  const map = [
    [/canlı|yaşıyor|nefes|canli|yasayan|yaşayan|canlı mı|canli mi/i, 'canli'],
    [/bitki|ağaç|agac|çiçek|cicek|bitkiden|meyve mi|sebze/i, 'bitki'],
    [/yen(i|ir)|yemek|yiyebilir|yenilebilir|yenen|tatlı|tatli/i, 'yenilebilir'],
    [/giy(i|ilir)|giysi|kıyafet|giyilen|elbise/i, 'giysi'],
    [/taşır|tasi|gider|sür(ülür|er)|taşıt|tasiit|vasıta|vasita|araba/i, 'tasit'],
    [/alet|evde kullanılır|kullanılır|kullanili|çekiç|cekic|tornavida/i, 'alet'],
    [/ses (çıkarır|verir|yapar)|miyavlar|havlar|ses cikarir|konuşur|bagirir|bağırır/i, 'ses'],
    [/büyük|buyuk|küçük|kucuk|boyu|boyutu|uzun|kısa|kisa/i, 'buyuk'],
    [/elektrik|pil|şarj|sarij|fiş|fis|priz|elektrikli|çalışır|calisir/i, 'elektrikli'],
    [/uçar|ucar|uçuyor|ucuyor|kanat|gökyüzü|gokyuzu|havada|uçak|ucak/i, 'ucar'],
    [/yüzer|yuzer|suda (yaşar|yasar)|denizde|akvaryum|göl|gol/i, 'yuzer'],
    [/evcil|ehlileştir|ehlilestir|evde beslenir|evde yaşar|kucak|kucaga|kopek|kedi/i, 'evcil'],
    [/dört|4 (ayak|bacak|tane)|dort ayak|4 ayakli/i, 'dortbacak'],
    [/teker|tkr|tekerlek|jant|lastik/i, 'teker'],
  ];
  for (const [re, key] of map) {
    if (re.test(q)) {
      return secret[key] === true ? 'Evet.' : 'Hayır.';
    }
  }
  return 'Anlayamadım, net bir evet/hayır sorusu sor.';
}

// ---------- oyunlar ----------
function sid(s) { return String(s || 'default'); }
function startGame(s, name) {
  const id = sid(s);
  const g = String(name || '').toLowerCase();
  if (/kelime/i.test(g) || g.includes('av')) {
    const word = pick(WORDS);
    games.set(id, { game: 'kelime', data: { word, attempts: 0 } });
    return '[Kelime Avı] ' + word.length + ' harfli bir kelime tuttum. İpucu: ' + clueFor(word) + '\nHarf harf sorabilir ya da kelimeyi tahmin edebilirsin.';
  }
  if (/sayi|sayı|tahmin/i.test(g)) {
    const secret = 1 + Math.floor(Math.random() * 100);
    games.set(id, { game: 'sayi', data: { secret, attempts: 0 } });
    return '[Sayı Tahmin] 1 ile 100 arasında bir sayı tuttum. Tahmin et!';
  }
  if (/20|yirmi/i.test(g)) {
    let idx = Math.floor(Math.random() * SECRETS_20.length);
    if (idx === last20Index && SECRETS_20.length > 1) idx = (idx + 1) % SECRETS_20.length;
    last20Index = idx;
    const s2 = SECRETS_20[idx];
    games.set(id, { game: 'yirmi', data: { ...s2, questions: 0 } });
    return '[20 Soru] Aklımdan bir şey tuttum. İpucu: ' + s2.ipucu + '\n20 evet/hayır sorusu hakkın var. Sor veya doğrudan tahmin et!';
  }
  if (/sehir|şehir|ülke|meyve|sehir-ülke/i.test(g)) {
    const letters = 'AELNRS'.split('');
    const st = { letter: pick(letters), stage: 0, chain: [] };
    games.set(id, { game: 'sehir', data: st });
    return '[Şehir-Ülke-Meyve] "' + st.letter + '" harfiyle başlayan bir ŞEHİR söyle!';
  }
  if (/hikaye|hikâye|story/i.test(g)) {
    const opener = 'Bir sabah uyandığında, masanda parlayan bir harita buldun...';
    games.set(id, { game: 'hikaye', data: { story: opener } });
    return '[Hikâye Tamamlama] Başlıyorum:\n"' + opener + '"\nŞimdi sıra sende — devam et!';
  }
  return 'Oyun tanımadım. Şunlardan birini seç: **Kelime Avı**, **Sayı Tahmin**, **20 Soru**, **Şehir-Ülke-Meyve**, **Hikâye Tamamlama**.';
}

function clueFor(word) {
  const clues = {
    deniz: 'balıkların evi', elma: 'kırmızı bir meyve', kitap: 'okunur', kalem: 'yazı yazar',
    güneş: 'gökyüzünde parlar', masa: 'yemek yenir üstünde', kapı: 'içeri girilir', çiçek: 'bahçede açar',
    dağ: 'yüksek', köprü: 'iki yakayı bağlar', bilgisayar: 'sen şimdi kullanıyorsun', arkadaş: 'yanında olur',
  };
  return clues[word] || 'bir eşya';
}

function gameMove(s, move) {
  const id = sid(s);
  const state = games.get(id);
  const m = String(move || '').trim();
  if (!state) return 'Henüz bir oyun başlatmadın. "Bir oyun oynayalım" de.';
  if (state.game === 'sayi') {
    const n = parseInt(m, 10);
    if (isNaN(n)) return 'Bir sayı söyle (1-100).';
    state.data.attempts++;
    const sec = state.data.secret;
    if (n === sec) { const r = '[Bildin!] ' + sec + ' — ' + state.data.attempts + ' tahminde buldun!'; games.delete(id); return r; }
    return n < sec ? '[Daha büyük] (Tahmin: ' + n + ')' : '[Daha küçük] (Tahmin: ' + n + ')';
  }
  if (state.game === 'kelime') {
    state.data.attempts++;
    const w = state.data.word;
    if (m.toLowerCase() === w) { const r = '[Bildin!] Kelime: ' + w + ' ✓'; games.delete(id); return r; }
    if (m.length === 1) {
      const inPos = w.split('').map((c, i) => c === m.toLowerCase() ? (i + 1) : null).filter((x) => x !== null);
      return inPos.length ? ('✓ "' + m + '" harfi var, konumları: ' + inPos.join(', ')) : '✗ "' + m + '" harfi kelimede yok.';
    }
    return 'Yanlış. İpucu: ' + clueFor(w) + ' (' + w.length + ' harf). ' + state.data.attempts + '. deneme.';
  }
  if (state.game === 'yirmi') {
    state.data.questions++;
    if (state.data.questions > 20) { const r = '20 soru doldu! Tuttuğum: ' + state.data.cevap + '.'; games.delete(id); return r; }
    // Önce soru olup olmadığını kontrol et (evet/hayır cevapla)
    const ans = answer20Question(m, state.data);
    if (ans !== null) return ans + ' (' + state.data.questions + '/20 sorusu)';
    // Soru değilse tahmin say
    if (state.data.test(m)) { const r = '[Bildin!] Tuttuğum ' + state.data.cevap + '. ' + state.data.questions + '. soruda bildin!'; games.delete(id); return r; }
    return 'Hayır, o değil. (' + state.data.questions + '/20 sorusu)';
  }
  if (state.game === 'sehir') {
    const d = state.data;
    const names = { 0: 'Şehir', 1: 'Ülke', 2: 'Meyve' };
    if (m && m.toLowerCase().startsWith(d.letter.toLowerCase())) {
      d.chain.push(names[d.stage] + ': ' + m);
      if (d.stage === 2) { const r = '[Harika!] Zinciri tamamladın: ' + d.chain.join(' → ') + ' ✓'; games.delete(id); return r; }
      d.stage++;
      const nl = pick('AELNRS'.split('').filter((x) => x !== d.letter));
      d.letter = nl;
      return '✓ ' + names[d.stage - 1] + ': "' + m + '" kabul! Şimdi "' + d.letter + '" ile ' + names[d.stage] + ' söyle.';
    }
    return '✗ "' + m + '" "' + d.letter + '" harfiyle başlamıyor. ' + names[d.stage] + ' söyle.';
  }
  if (state.game === 'hikaye') {
    state.data.story += '\n' + m;
    const r = pick(['Sonra...', 'Ama o sırada...', 'Tam o anda...', 'Ancak...']);
    return 'Devam ediyorum:\n"' + r + '"\n' + state.data.story + '\nSen devam et!';
  }
  return 'Bilinmeyen oyun durumu.';
}

function stopGame(s) { games.delete(sid(s)); return 'Oyunu bitirdim.'; }
function isActive(s) { return games.has(sid(s)); }
function getActiveGame(s) { const st = games.get(sid(s)); return st ? st.game : null; }
function activeSessions() { return Array.from(games.keys()); }
// Oyun hamlesi gibi mi? Şehir/Sayı/Kelime oyunlarında yalnızca TEK KELİME/Sayı girişleri
// hamle sayılır; böylece oyun oynarken kullanıcı başka bir şey sorabilsin (ör. "hava nasıl?").
function looksLikeMove(s, input) {
  const game = getActiveGame(s);
  const m = String(input || '').trim();
  if (!m) return false;
  if (game === 'sehir' || game === 'sayi' || game === 'kelime') {
    return !/\s/.test(m);
  }
  return true; // 20 Soru & Hikâye serbest metin
}

module.exports = {
  startGame,
  gameMove,
  stopGame,
  isActive,
  getActiveGame,
  activeSessions,
  looksLikeMove,
  dailyMotivation: () => pick(QUOTES),
  funFact: () => pick(FACTS),
  songOfDay: () => {
    const s = pick(SONGS);
    lastSong = { title: s.title, artist: s.artist, ts: Date.now() };
    return 'Günün şarkısı: **' + s.title + '** — ' + s.artist + '. Çalmamı ister misin?';
  },
  getLastSong: () => (lastSong && Date.now() - lastSong.ts < 120000) ? lastSong : null,
  setLastSong: (s) => { lastSong = s; },
};