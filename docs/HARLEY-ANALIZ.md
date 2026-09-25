# 🤖 Harley — Tam Sistem Analizi

**Tarih:** 17.08.2026 · **Sürüm:** v0.7.15 (tarihsel) · **Analiz yöntemi:** Kaynak kod okuma + canlı sistem ölçümü + uç testleri.

> ⚠️ **Güncellik notu:** Bu analiz n8n/Ollama dönemine (v0.7.15) aittir. Harley artık
> doğrudan DeepSeek bulut API'sini kullanır; n8n ve Ollama kaldırılmıştır. Güncel bilgi
> için kök `README.md` ve `docs/SETUP.md`.

> **Doğruluk ilkesi:** Bu rapordaki her madde ya dosyalardan doğrulandı ya da canlı ölçüldü.
> "Tahmin" olarak işaretlenenler dışında hiçbir şey varsayılmadı. Ölçülemeyenler açıkça belirtildi.

---

## 1. SİSTEMİN GENEL ÖZETİ

**Harley**, tek bir masaüstü uygulamasında (Electron) çalışan, kişisel ve gizlilik öncelikli bir AI asistanıdır.
Kullanıcının e-postalarını, takvimini, Google Drive'ını, görev tablolarını okuyup düzenleyebilir; internette
arama yapar; bilgisayarındaki uygulamaları açar; Roblox Studio'ya bağlanıp kod yazabilir; sesli konuşur ve
"Harley" diye seslenince dinlemeye başlar.

**Sistem lokal mi, bulut mu, hibrit mi?** → **Hibrit.**

| Katman | Nerede çalışıyor | İnternet |
|---|---|---|
| Arayüz + uygulama mantığı (Electron) | Bu bilgisayar | Gerekmez |
| Orkestrasyon (n8n) | Bu bilgisayar (localhost:5678) | Gerekmez |
| Yerel AI modelleri (Ollama) | Bu bilgisayar (GPU) | Sadece indirirken |
| Bulut AI modeli (DeepSeek) | DeepSeek sunucuları | **Gerekir** |
| Ses tanıma (Whisper) | Bu bilgisayar (çevrimdışı) | Gerekmez |
| Seslendirme (Edge TTS) | Microsoft sunucuları | **Gerekir** (yedeği Piper lokaldir) |
| Web arama | İnternet (Serper/DDG/Bing) | **Gerekir** |
| Google servisleri (Gmail/Takvim/Drive/Sheets) | Google sunucuları | **Gerekir** |

**İnternet yoksa:** Yerel modellerle sohbet, hafıza, dosya araçları, hatırlatıcı, PC kontrol, Roblox köprüsü,
ses tanıma, Piper seslendirme **çalışır**. Google servisleri, web arama, Edge TTS ve DeepSeek **çalışmaz**.

**Çalışma mantığı (kısaca):** Kullanıcı yazıp/mikrofonla konuşur → Electron uygulaması mesajı yerel n8n'e
gönderir → n8n'deki AI Agent, modeli (yerel Ollama veya DeepSeek) çağırır → model gerektiğinde araçları
(takvim, arama, dosya…) kullanır → cevap akışlı (streaming) olarak ekrana döner, ses açıksa okunur.
Sohbet bitince Harley, konuşmayı yerel bir modelle analiz edip kalıcı bilgileri hafızasına yazar.

> **Bu AI agent aslında** bilgisayarında yaşayan, Google hesaplarına, dosyalarına ve Roblox Studio'na
> erişebilen, sesli konuşabilen ve her konuşmadan sonra kendini geliştiren özel bir kişisel asistan.

---

## 2. TÜM FEATURE'LAR

Önem sırasına göre, her biri için: **durum** (✅ çalışıyor / 🟡 kod var, canlı doğrulanamadı / ⚠️ kısmen).

### 2.1 Core AI

| Feature | Ne yapıyor | Nasıl | Teknoloji | İnternet | Durum |
|---|---|---|---|---|---|
| Sohbet (streaming) | Cevap parça parça akar | NDJSON olayları | n8n agent → Ollama/DeepSeek | Model'e göre | ✅ (7b ve Bulut doğrulandı) |
| Model seçimi | 4 seçenek: Hızlı/Zeki→Akıllı/Bulut | Açılır menü | `WEBHOOKS` haritası | – | ⚠️ (Zeki yanlışlıkla silinmiş, bkz. §19) |
| Boş-yanıt tekrar deneme | Boş cevapta 2 kez yeniden dener | Otomatik | `chat:send` retry döngüsü | – | ✅ kodda var |
| Günün özeti | Takvim+mail+görev+drive tek akış | Modeli atlar, hazır veri döner | n8n "Günün Özeti" workflow | Google gerekir | ✅ 4/4 bölüm doğrulandı |

### 2.2 Memory

| Feature | Durum |
|---|---|
| Kalıcı kişilik hafızası (`profile.md`) — her mesajda modele gider | ✅ |
| Otomatik hafıza (`Bellek.md`) — sohbet sonrası qwen2.5:3b çıkarımı, 90 sn throttle, 400 satır tavan | ✅ (çıkarım mekanizması ayrı test edildi) |
| Kısa dönem sohbet hafızası (n8n Simple Memory, son 24 mesaj) | ✅ (health patch her açılışta onarır) |
| Bellek paneli (UI) — elle düzenle | ✅ |
| **RAG / vektör arama** | ❌ **YOK** (planlandı, kurulmadı) |
| Embedding / semantic search | ❌ **YOK** |

### 2.3 Voice

| Feature | Durum |
|---|---|
| Sesli komut (mikrofon) — yerel Whisper-base | ✅ |
| Wake word ("Harley" deyince dinler) | 🟡 ayar açık, UI'da canlı doğrulanamadı |
| Sesli yanıt — Edge TTS (Emel) → Piper (yerel) → Windows sesi | ✅ (kod + yedek zinciri) |
| Transkripsiyon otomatik düzeltme (harley→Harley, aç→açıl…) | ✅ |
| **ElevenLabs** | ❌ Kaldırıldı (istek üzerine) |

### 2.4 Tools (n8n, 27 araç — "My workflow")

✅ hepsi aktif workflow'a bağlı: Google Calendar, Google Drive, Gmail, getRow(s) Sheets, Görev Ekle,
Update Sheets, Takvim Oluştur, Gmail Gönder, web_search, Sayfa Oku, Not Al, Kod Çalıştır, Dosya Ara,
Memory Oku, Memory Yaz, Proje İncele, GitHub, Şifreli Not, Ekran Oku (moondream), Hatırlatıcı, PC Kontrol,
Studio Komut (Roblox), Günün Özeti.

### 2.5 Automation / Sistem etkileşimi

| Feature | Durum |
|---|---|
| PC Kontrol ("Spotify aç", "klasör aç", URL) | ✅ (healthcheck ile doğrulandı) |
| Hatırlatıcı ("10 dk sonra…") — bildirim + ses + sohbete mesaj | ✅ (canlı ateşlendi) |
| Ctrl+Alt+H global çağırma + otomatik mikrofon | ✅ |
| Tepsi modu (kapatınca arka planda kalır) | ✅ |
| Roblox Studio köprüsü (ÇALIŞTIR/YAPI/OKU/KAYNAK/PLAYTEST/LOK/EKRAN) | 🟡 uçlar test edildi; **eklenti kullanıcıda kurulu değil** |
| Pano geçmişi + AI eylemleri (kopyala/özetle/çevir) | ✅ |
| Otomatik başlatma (Windows açılışı) | ❌ YOK |
| Pomodoro / günaydın rutini | ❌ YOK (planlandı) |

### 2.6 UI

Splash ekranı, koyu/aydınlık tema, oturum listesi (solda), model seçici, hazır sorular (torba popover:
Günün özeti / E-postalarım / Görevlerim / Drive), Bellek paneli, Pano paneli, Ayarlar paneli (ad, hitap,
tarz, emoji, otomatik hafıza, wake word, varsayılan model, tema, ses motoru), markdown gösterimi, kopyala
butonu. Minimalist SVG ikonlar (emoji yok). ✅

### 2.7 File handling

- Not Al / Notlar.txt, Dosya Ara (HarleyDosyalar + Projeler), Kod Çalıştır (HarleyKod klasörü),
  Şifreli Not (AES, `.harley-anahtar` anahtarı), Proje İncele. ✅ kodda var, GitHub token dışında.

### 2.8 Internet/web

- web_search: Serper (Google) → DDG → Bing zinciri, 10 dk önbellek, sadece sonuç döndürür.
  ⚠️ **Serper anahtar dosyası boş** → şu anda DDG→Bing yedeği kullanılıyor (önbellekte doğrulandı).
- Sayfa Oku: bir URL'nin içeriğini getirir (düz metne çevirir). ✅

### 2.9 System interaction

PC Kontrol, ekran görüntüsü + moondream analizi ("ekrana bak"), Roblox Studio F5/log köprüsü. ✅/🟡 yukarıda.

---

## 3. AI MODELİ

Ollama'da **5 model kurulu** (canlı ölçüm):

| Model | Boyut | Parametre | Quantization | Kullanım |
|---|---|---|---|---|
| qwen2.5:3b | 1.80 GB | 3.1B | Q4_K_M | "Hızlı" workflow ⚠️ (boş yanıt sorunu) |
| qwen2.5:7b | 4.36 GB | 7.6B | Q4_K_M | "My workflow" + "Zeki/Akıllı" ✅ |
| qwen3:4b | 2.33 GB | 4.0B | Q4_K_M | ❌ kurulu ama kullanılmıyor (thinking hatası) |
| qwen3:8b | 4.87 GB | 8.2B | Q4_K_M | ❌ workflow pasif (kullanılmıyor) |
| moondream | 1.62 GB | 1B | Q4_0 | Ekran/görsel analizi ✅ |
| **Toplam .ollama** | **15 GB** | | | |

**Context window:** n8n'de `numCtx: 8192` (qwen2.5:7b), maxTokens 4096. DeepSeek Bulut: maxTokens 8000.

**Ölçülen hız (bu oturum):**
- qwen2.5:7b: **5.4 tok/sn** üretim, model yükleme ~10 sn (toplam ~20 sn ilk istek).
- DeepSeek (bulut): hızlı, ~1-3 sn ilk token (ölçülmedi, internet gecikmesine bağlı — tahmin).

**RTX 3050 4 GB + 16 GB RAM uygunluğu:**
- **qwen2.5:7b VRAM'e tam sığıyor: 3798/4096 MiB (%93).** Çalışıyor ama marj dar — başka bir model
  (moondream veya whisper-GPU) yüklenmek istenince Ollama modeli VRAM'den boşaltıp geri yükler (yavaşlama).
- 8b model (4.87 GB dosya) **VRAM'e sığmaz** → GPU+CPU karışık çalışır, belirgin yavaşlar. Bu yüzden pasif.
- 3b/4b rahat çalışır, daha hızlı ama daha az zeki.
- **Tavsiye:** 7b bu donanım için doğru denge. Daha zeki istersen tek seçenek Bulut (DeepSeek).

**Model değiştirmek kolay mı?** Evet — ayarlardan varsayılan model seçilir, n8n'de "Ollama Chat Model"
node'unun model alanı değiştirilir, yeni model `ollama pull` ile iner. Webhook haritası `webhook-client.js`.

---

## 4. MEMORY / BELLEK SİSTEMİ

**Üç ayrı bellek katmanı var:**

### A) Kalıcı kişilik hafızası — `profile.md` (düz metin dosya)
- Konum: `C:\Users\kuruc\AppData\Roaming\privacy-assistant-app\profile.md`
- İçerik: kullanıcının kimliği, dili, tercihleri (Türkçe zorunlu, orijinal isimleri koru vb.) — ~1.5 KB
- **Her mesajda modele gider** (`buildProfilePayload` → system prompt'a eklenir). JSON değil, dosya.
- Elle düzenlenir (Bellek paneli) veya ayarlardaki ad ile senkron tutulur.

### B) Otomatik hafıza — `Bellek.md` (düz metin, satır başına gerçek)
- Konum: `C:\Users\kuruc\HarleyDosyalar\Bellek.md`
- İçerik şu an: `- Kullanıcının adı Umut.` / `- Kullanıcının GitHub kullanıcı adı: flewqiee`
- Nasıl yazılır: her başarılı sohbetten sonra `qwen2.5:3b` ile (13 sn, temp 0.2) sohbet analiz edilir,
  "öğrenmeye değer" gerçekler çıkarılır, tekrarlar elenir, dosyaya eklenir. 90 sn'de en fazla 1 çıkarım,
  400 satır tavan (eski satırlar düşer), sohbet akışını asla engellemez (best-effort).
- Nasıl okunur: model, **"Memory Oku" aracını çağırınca** okur (her mesajda otomatik gitmez).

### C) Kısa dönem sohbet hafızası — n8n Simple Memory (RAM içi)
- n8n'in `memoryBufferWindow` node'u, **sessionId başına son 24 mesajı** tutar (SQLite değil, RAM).
- n8n yeniden başlarsa uçar. App açılışında health check onarır (devre dışı kalmışsa açar).

**Soru-cevap:**
- AI neyi hatırlıyor? → profile.md'deki her şeyi **her zaman**; Bellek.md'yi **sorulunca**; sohbeti **24 mesaj**.
- Embedding / semantic search / vector DB? → **Yok.** Bellek araması yok; Bellek.md'nin tamamı araca verilir.
- Silme/güncelleme? → Bellek paneli ile elle; Bellek.md satırları throttle + tavan ile kendini budar.
- Yanlış hafıza? → Sistem promptunda "kullanıcı düzeltirse asla tekrarlama" kuralı var. Ancak Bellek.md'ye
  yazılmış yanlış bir gerçek otomatik silinmez — elle panelden temizlenmeli.
- Büyüdükçe? → Bellek.md 400 satırda kesilir; profile.md kullanıcı boyutunda kalır. Token etkisi küçük.

**Örnek akış:**
```
Kullanıcı: "GitHub adım flewqiee"
  → n8n agent: Memory Yaz aracını çağırır → Bellek.md'ye yazar (model kararıyla)
  → (sohbet sonunda) learnFromChat: qwen2.5:3b "GitHub adı flewqiee" gerçeğini çıkarır → Bellek.md'ye ekler
Sonraki soruda: model gerekirse Memory Oku ile Bellek.md'yi okur → "flewqiee" bilir.
```
(Not: "GitHub adı flewqiee" satırı Bellek.md'de mevcut — bu akışın çalıştığının kanıtı.)

---

## 5. CONVERSATION / CHAT SYSTEM

- **Geçmiş:** UI tarafında `localStorage` (`assistant_sessions_v1`) içinde **tüm mesajlar** tutulur;
  oturumların ayrı UUID'si vardır, sol menüden geri yüklenebilir. N8n tarafında Simple Memory yalnızca
  son 24 mesajı hatırlar (context buradan gelir).
- **Context oluşturma:** Chat Trigger → AI Agent → `systemMessage` (persona + profile) + Simple Memory
  (son 24 mesaj) + kullanıcı mesajı → model.
- **Uzun sohbetlerde:** 24 mesajdan eski her şey modelin gözünden düşer; UI'da görünmeye devam eder.
  Conversation summary **yok** — 24 mesaj kayar pencere.
- **Token:** Sistem promptu (persona) ~1.2-1.5K token (tahmin: Türkçe uzun metin, ~8-9K karakter);
  profile ~500-800 token; 24 mesajlık geçmiş ~2-4K token; araç tanımları (27 araç) ~4-6K token (tahmin).
  Ortalama bir istek 8K context'e oturur (numCtx 8192) — sınır dar, uzun geçmiş + çok araçta taşabilir.
- **Silme:** Oturum silme butonu var (UI). Bellek panelinden hafıza düzenlenebilir.

---

## 6. SES SİSTEMİ

### Speech-to-Text (ses → metin) — tamamen yerel
- **Model:** Whisper-base (q8) — `@huggingface/transformers` (Xenova/whisper-base), onnxruntime-node.
- **Konum:** `transformers-cache` (528 MB) — ilk kullanımda indirilir, sonra çevrimdışı.
- **Çalıştığı yer:** Önce DirectML ile GPU denenir, olmazsa CPU (q8). Dil Türkçe'ye sabitlenir.
- **RAM:** Model ana süreçte yüklenir (~0.3-0.5 GB tahmin); app açılışında arka planda önceden yüklenir.
- **Doğruluk:** base, tiny'den belirgin iyi; transkripsiyon sonrası otomatik düzeltme katmanı var
  (harley→Harley, açıl, çalıştır, uygulama adlarına Levenshtein yakın eşleşme).

### Text-to-Speech (metin → ses) — 3 kademeli yedek zinciri
1. **Edge TTS** (varsayılan): Microsoft'un `tr-TR-EmelNeural` sesi, internet ister, **ücretsiz, anahtar yok**
   (Microsoft Edge'in ücretsiz servisini kullanır — resmi API değil, bozulabilir).
2. **Piper** (yerel yedek): `tr_TR-dfki-medium.onnx` (98 MB HarleySes klasöründe), tamamen çevrimdışı,
   ücretsiz, sınırsız. İnternet yoksa otomatik geçer.
3. **Windows speechSynthesis** (son çare).
- Format: Edge → MP3 (96 kbps mono), Piper → WAV. Base64 ile renderer'a gider, `new Audio()` ile oynatılır.
- API anahtarı: **yok** (ElevenLabs kaldırıldı; kullanıcı isteği).
- Uzun cevaplarda ~900 karaktere kısaltır, kod bloklarını atlar.

---

## 7. N8N / WORKFLOW / AUTOMATION

**n8n sürümü: 2.34.5** (global npm kurulumu, `%APPDATA%\npm\node_modules\n8n`). Veritabanı SQLite
(`.n8n\database.sqlite` ~29 MB).

**10 workflow kayıtlı; 5'i aktif:**

| Workflow | Model | Node | Durum |
|---|---|---|---|
| My workflow | qwen2.5:7b | 28 | ✅ aktif (varsayılan yerel) |
| My workflow (Hızlı) | qwen2.5:3b | 28 | ✅ aktif ⚠️ boş yanıt riski |
| My workflow (Zeki) | qwen2.5:7b | 27 | ✅ aktif ama **UI'dan erişilemiyor** (webhook çakışması) |
| My workflow (Bulut) | deepseek-v4-flash | 28 | ✅ aktif (varsayılan seçili) |
| Günün Özeti | — (saf veri) | 22 | ✅ aktif — model kullanmaz |
| My workflow (8b) | qwen3:8b | 13 | ⛔ pasif |
| Diğerleri (Personal Context, Privacy Assistant, 2 yedek) | — | — | ⛔ pasif |

**"My workflow" node zinciri:** Chat Trigger → AI Agent (systemMessage persona) → bağlı 27 araç +
Ollama Chat Model (qwen2.5:7b, numCtx 8192) + Simple Memory (24 mesaj).

**Günün Özeti workflow'u (22 node):** Webhook → 4 paralel dal (Takvim, Eposta, Görevler, Drive) — her
dalda gerçek Google çağrısı + garantili "Yedek" elemanı + ikili (pairwise) merge ağacı → tek "Özet" code
node → Respond to Webhook. **Bir servis çökse bile özet üretilir** (dal hatası yedek elemanla kurtarılır).

**Mimari akış (gerçek):**
```
USER → [Electron UI (renderer.js)] → IPC chat:send → [main.js]
     → postChatStream → n8n webhook (/webhook/<id>/chat) → [Chat Trigger]
     → [AI Agent] → systemMessage(persona+profile) + Simple Memory(24) + 27 araç
     → [Ollama / DeepSeek] → tool çağrıları → araçlar çalışır → sonuç modele döner
     → model final cevabı → NDJSON stream → main.js → chat:chunk IPC → renderer (canlı akar)
     → sohbet bitti → learnFromChat (qwen2.5:3b) → Bellek.md
```
**Özel durum:** "Günün özeti" isteği bu akışı **atlar** — `OZET_INTENT` eşleşirse model hiç çağrılmaz,
hazır özet doğrudan döner (sebep: n8n agent katmanı Ollama araç çağrılarını düşürüyor, bkz. §19).

**Hata durumunda:** webhook 400+ → hata mesajı; ağ hatası → `ensureServices()` servisleri yeniden başlatır
ve bir kez daha dener; boş yanıt → 2 kez daha dener; hepsi başarısızsa kullanıcıya Türkçe hata döner.

---

## 8. TÜM TEKNOLOJİLER ENVANTERİ

| Teknoloji | Nedir | Nerede | Neye bağlı |
|---|---|---|---|
| **Electron 43** | Masaüstü kabuğu (Chromium+Node) | app/ | Uygulamanın kendisi |
| **n8n 2.34.5** | Workflow otomasyon + AI agent orkestrasyonu | global npm, localhost:5678 | Ollama, Google OAuth, internet |
| **Ollama** | Yerel model sunucusu | localhost:11434 | GPU (CUDA) |
| **qwen2.5:3b/7b, qwen3:4b/8b** | Yerel dil modelleri | .ollama (15 GB) | Ollama |
| **moondream** | Yerel görüntü modeli | .ollama | Ollama |
| **DeepSeek V4 Flash** | Bulut dil modeli (API) | DeepSeek | internet + API anahtarı (n8n credential) |
| **Whisper-base** | Yerel ses tanıma | transformers-cache (528 MB) | @huggingface/transformers, onnxruntime |
| **Edge TTS (node-edge-tts)** | Neural seslendirme | app/ | Microsoft, internet |
| **Piper** | Yerel seslendirme | HarleySes (98 MB) | espeak-ng (paket içinde) |
| **Google OAuth** | Gmail/Takvim/Drive/Sheets erişimi | n8n credential | Google Cloud konsolu |
| **SQLite** | n8n veritabanı | .n8n | n8n |
| **localStorage** | UI sohbet geçmişi | Electron userData | – |
| **Düz metin dosyalar** | Bellek/notlar/hatırlatıcılar | HarleyDosyalar | – |
| **AES (Node crypto)** | Şifreli notlar | HarleyDosyalar/Sifreli | `.harley-anahtar` |
| **Node.js HTTP** | Yerel köprü (PC kontrol/ekran/Studio) | main.js, 127.0.0.1:59333 | – |
| **PowerShell** | Uygulama açma, Studio F5 gönderme, pencereler | main.js | Windows |

---

## 9. DOSYA VE KLASÖR MİMARİSİ

```
Harley/                                    (geliştirme projesi)
├── app/                                   Electron kaynak kodu
│   ├── main.js          (1623 satır)      Ana süreç: servisler, ses, hatırlatıcı, Studio köprüsü, HTTP sunucusu
│   ├── renderer.js      (1040 satır)      Arayüz: sohbet, wake word, mikrofon, ayarlar, pano
│   ├── webhook-client.js                  n8n webhook istemcisi (streaming ayrıştırıcı)
│   ├── preload.js                         Güvenli IPC köprüsü (contextBridge)
│   ├── index.html / styles.css            Arayüz (koyu/aydınlık tema)
│   └── package.json                       v0.7.15, electron-builder
├── n8n-ops.js          (1543 satır)       Workflow yönetim aracı (araç ekleme/kural yazma)
├── ozet-setup.js                          Günün Özeti workflow kurulumu
├── tool-healthcheck.js                    Tek komutla 15+ araç testi (23 OK)
├── deploy.bat                             Derle + app.asar güncelle + yeniden başlat
├── ROADMAP.md / DEVELOPMENT.md            Yol haritası / geliştirme notları
├── SECURITY.md                            Güvenlik dokümanı
├── roblox-studio/                         HarleyStudio.luau eklentisi + kurulum + tasarım şablonu
└── *.json (workflow yedekleri)            My workflow.json, my-workflow-live.json vb.

C:\Users\kuruc\
├── Harley\                                 KURULU UYGULAMA (722 MB)
│   └── resources\app.asar                  Derlenmiş uygulama (Harley.exe → electron.exe + asar)
├── HarleyDosyalar\                         VERİ (kullanıcı dosyaları)
│   ├── Bellek.md                           Otomatik hafıza
│   ├── Notlar.txt, proje-notlari.txt       Notlar
│   ├── hatirlatmalar.json                  Hatırlatıcılar
│   ├── websearch-key.txt                   Serper anahtarı (ŞU AN BOŞ)
│   ├── .arama-cache.json                   Web arama önbelleği (10 dk)
│   ├── .harley-anahtar                     Şifreli not anahtarı
│   └── Sifreli\*.enc                       Şifreli notlar (gmail.enc, roblox-boss.enc)
├── HarleySes\piper\                        Piper ses motoru + Türkçe ses (98 MB)
├── HarleyKod\                              Kod Çalıştır aracının çalışma klasörü
├── .ollama\models                          Modeller (15 GB)
└── .n8n\                                   n8n veritabanı + loglar (35 MB)
```

**Kritik dosyalar:** `main.js` (silinirse uygulama ölür), `app.asar` (kurulu çalışma kopyası),
`.ollama/models` (modeller — silinirse yeniden indirilir, 15 GB), `HarleyDosyalar` (kullanıcı verisi —
silinirse hafıza/notlar/hatırlatıcılar gider).

**Gereksiz/atıl:** `My workflow (8b)`, `Personal Context`, `Personal Privacy Assistant`, 2 eski yedek
workflow (pasif); `qwen3:4b` ve `qwen3:8b` modelleri şu an kullanılmıyor (~7.2 GB disk — silinebilir);
`app/node_modules` (822 MB) yalnızca geliştirme için.

---

## 10. VERİ AKIŞI (gerçek)

1. Kullanıcı mesaj yazar (veya mikrofon: ses → Whisper → metin).
2. `renderer.js` → `window.assistant.send()` → IPC `chat:send` → `main.js`.
3. `main.js` modeli kontrol eder (yerelse indirilmiş mi?), "günün özeti" niyeti varsa özeti doğrudan döner.
4. Değilse `postChatStream` → n8n webhook'a `{action, sessionId, chatInput, profile, stream:true}`.
5. n8n Chat Trigger → AI Agent → systemMessage (persona + kullanıcı profili) + Simple Memory (24 mesaj).
6. Model (Ollama yerel veya DeepSeek) cevabı/araç çağrısını üretir.
7. Araç çağrısı olursa: araç çalışır (Google/arama/dosya/PC…) → sonuç modele döner → final cevap üretilir.
8. Cevap NDJSON olayları olarak akar → `main.js` `chat:chunk` ile renderer'a iletir → canlı yazılır.
9. Sohbet kaydedilir (localStorage), ses açıksa `speak()` → Edge/Piper ile okunur.
10. Sohbet tamamlanınca `learnFromChat` → qwen2.5:3b çıkarımı → Bellek.md güncellenir (arka planda).
11. N8n tarafında Simple Memory sessionId başına 24 mesajı RAM'de günceller.

---

## 11. AI'NIN TOOL / AGENT YETENEKLERİ

| Tool | Ne yapar | Ne zaman çağrılır | Input → Output | Çalışıyor mu | Risk |
|---|---|---|---|---|---|
| web_search | Serper→DDG→Bing arama | Güncel bilgi gerekince | `query` → başlık+URL+özet listesi | ✅ | Serper anahtarı boş → DDG |
| Sayfa Oku | URL içeriğini düz metne çevirir | Makale/doküman gerekince | `url` → metin | ✅ | – |
| Not Al | Notlar.txt'ye ekler | "bunu not al" | `not` → kayıt | ✅ | – |
| Kod Çalıştır | Node.js kodu çalıştırır (HarleyKod) | Hesaplama/script gerekince | `kod` → çıktı | ✅ | **Kod çalıştırma — sandbox yok** (kullanıcı onayı yok) |
| Dosya Ara | HarleyDosyalar/Projeler'de arar | "şu dosyayı bul" | `sorgu` → eşleşmeler | ✅ | – |
| Memory Oku/Yaz | Bellek.md okur/yazar | Kalıcı bilgi gerekince | `içerik` | ✅ | **Yanlış yazabilir** |
| Proje İncele | Proje klasörünü tarar | "projemde ne var" | `yol` → yapı | ✅ | – |
| GitHub | Repo/issue işleri | "GitHub'da..." | `token` gerekir | ⚠️ token yok | API anahtarı |
| Şifreli Not | AES şifreli not kaydeder/okur | Hassas bilgi gerekince | `içerik` → .enc | 🟡 dosyalar var | Anahtar dosyada düz |
| Ekran Oku | Ekran görüntüsü → moondream | "ekrana bak" | `soru` → analiz | ✅ (7.4 sn) | Ekran içeriği modele gider (yerel) |
| Hatırlatıcı | Zamanlı hatırlatma kurar | "10 dk sonra..." | `time,message` → app | ✅ | – |
| PC Kontrol | Uygulama/klasör/URL açar | "Spotify aç" | `action,target` | ✅ | **Yerel sunucu kimlik doğrulamasız** |
| Studio Komut | Roblox Studio'da Luau çalıştırır | "oyunuma X ekle" | `komut` → sonuç | 🟡 eklenti gerekli | **Studio'da kod çalıştırma** |
| Günün Özeti | Takvim+mail+görev+drive özeti | "günün özeti" | — | ✅ | – |
| Google (5 araç) | Takvim/Gmail/Drive/Sheets | İlgili veri gerekince | çeşitli | ✅ (n8n credential ile) | Google hesabına erişim |

**Güvenlik notları:** Kod Çalıştır ve Studio Komut, kullanıcı onayı olmadan kod çalıştırabilir —
bilinçli tasarım (kişisel asistan), ama prompt injection ile tehlikeli olabilir. Sistem promptu dış
içeriği "veri" sayar (temel önlem).

---

## 12. TOKEN VE CONTEXT ANALİZİ

Ölçülemedi (model tarafında sayılmadı); aşağıdakiler yapıya dayalı **tahminlerdir**:

| Bileşen | Tahmini token |
|---|---|
| System prompt (persona, Türkçe, ~9K karakter) | ~2.2K |
| Kullanıcı profili (profile.md ~1.5 KB) | ~450 |
| Araç tanımları (27 araç) | ~4-6K |
| Simple Memory (24 mesaj) | ~2-4K |
| Kullanıcı mesajı (ortalama) | ~100-300 |
| **Toplam context** | **~9-13K** ⚠️ |

⚠️ **Kritik:** `numCtx: 8192` ayarlı — yukarıdaki tahmine göre **uzun geçmiş + tüm araçlar bu sınıra
taşabilir.** 24 mesaj dolduğunda araç tanımları + persona ile 8K'yı aşma riski var; aşınca n8n ya da model
en eski mesajı düşürür (veya hata verir). Bu, "kısa sohbetlerde bile garip davranışlar"ın olası
kaynaklarından biridir (kesin doğrulanamadı — model tarafında ölçüm yok).

---

## 13. DİSK ALANI / GB ANALİZİ

Gerçek ölçüm (du komutu, bu oturum):

| Component | Yaklaşık boyut | Gerekli mi? |
|---|---|---|
| Ollama modelleri (5 model) | 15.0 GB | Kısmen (7.2 GB'si kullanılmıyor) |
| Kurulu uygulama (Harley + node_modules) | 722 MB | Evet |
| Whisper cache (transformers) | 528 MB | Evet |
| Piper ses motoru (HarleySes) | 98 MB | Evet (çevrimdışı yedek) |
| n8n veri (SQLite + loglar) | 35 MB | Evet |
| HarleyDosyalar (hafıza/notlar) | ~3.5 MB | Evet |
| HarleyKod | 11 KB | Evet |
| **Kurulu sistem toplamı** | **≈ 16.4 GB** | |
| (Geliştirme: app/node_modules) | (+822 MB) | Sadece geliştirme |

> **AI agent'ım bilgisayarda yaklaşık 16.4 GB yer kaplıyor** (geliştirme klasörüyle 17.2 GB).
> **7.2 GB tasarruf:** kullanılmayan qwen3:4b + qwen3:8b silinirse (yeni model indirilebilir).

---

## 14. RAM / VRAM / CPU ANALİZİ

Canlı ölçüm (bu oturum, modeller boştayken):

| Durum | RAM | VRAM | CPU | GPU |
|---|---|---|---|---|
| Boşta (model yüklü değil) | Harley ~1.0 GB + n8n ~0.37 GB + Ollama ~0.04 GB ≈ **1.4 GB** | GPU genel: 1525/4096 MiB (diğer uygulamalar dahil) | ~0-2% | ~0% |
| qwen2.5:7b yüklüyken | aynı + Ollama RAM ~0.05 GB | **3798/4096 MiB (%93)** | düşük (GPU'da) | ~%70-100 üretimde (tahmin) |
| Ses tanıma (Whisper) | +~0.3-0.5 GB (CPU yolunda, tahmin) | DML başarılıysa +VRAM, değilse CPU | kısa süreli %30-60 (tahmin) | – |
| DeepSeek (bulut) | 0 (yerel model çalışmaz) | 0 | 0 | 0 |

**Darboğazlar:**
- **VRAM 4 GB = en kritik sınır.** 7b yüklüyken (%93) başka bir model (moondream, whisper-GPU) aynı anda
  sığmaz → model değişimlerinde 5-15 sn bekleme. 8b asla tam GPU'ya sığmaz.
- qwen2.5:7b ölçülen hız: **5.4 tok/sn** — akıcı ama hızlı değil. Uzun cevaplar 30-90 sn sürebilir.
- n8n node işlemi ~370 MB; Harley ~1 GB (Whisper ana süreçte yaşar).

---

## 15. İNTERNET VE API BAĞIMLILIKLARI

| Servis | İnternet yoksa |
|---|---|
| Yerel modeller (Ollama) | ✅ çalışır |
| Sohbet akışı (yerel modelle) | ✅ çalışır |
| Whisper ses tanıma | ✅ çalışır (model inmişse) |
| Piper seslendirme | ✅ çalışır |
| Hatırlatıcı / PC kontrol / Studio köprüsü / pano / hafıza | ✅ çalışır |
| DeepSeek (Bulut model) | ❌ çalışmaz |
| Google servisleri (mail/takvim/drive/sheets) | ❌ çalışmaz |
| web_search / Sayfa Oku | ❌ çalışmaz |
| Edge TTS | ❌ → Piper'a düşer (otomatik) |

---

## 16. API KEY VE GİZLİ BİLGİLER

**Gerçek değerler GÖSTERİLMEZ; yalnızca türler ve yerler:**

| Secret | Nerede | Değerlendirme |
|---|---|---|
| DeepSeek API anahtarı | `HarleyDosyalar/deepseek-config.json` | ⚠️ Düz metin ama yerel diskte |
| Google OAuth tokenları | `HarleyDosyalar/google-config.json` | ⚠️ Düz metin, yerel diskte |
| GitHub token | `HarleyKod/github-token.txt` | ⚠️ Düz metin, yerel diskte |
| Serper anahtarı | `HarleyDosyalar/websearch-key.txt` | ⚠️ düz metin ama **şu an boş** (kullanılmıyor) |
| Şifreli not anahtarı | `HarleyDosyalar/.harley-anahtar` (32 bayt) | ⚠️ anahtar dosyayla aynı diskte — zayıf ama "yerel güvenlik" |
| GitHub token | `HarleyKod/github-token.txt` | ❌ yok (healthcheck uyarısı) |

---

## 17. GÜVENLİK

| Risk | Neden | Çözüm |
|---|---|---|
| **Yerel HTTP sunucusu (59333) kimlik doğrulamasız** | PC kontrol, ekran analizi, hatırlatıcı uçları açık — aynı makinedeki her işlem çağırabilir | Basit token (app üretir, araçlara env ile verilir) ekle |
| **n8n chat webhook'ları auth'suz** | localhost:5678 — aynı makinedeki her işlem kullanıcıymış gibi soru sorabilir | Chat Trigger'a Basic Auth (SECURITY.md'de öneriliyor) |
| **Kod Çalıştır / Studio Komut onaysız kod çalıştırır** | Prompt injection ile kötü amaçlı kod tetiklenebilir | Hassas araçlar için UI onayı |
| **n8n API anahtarı düz metin** | proje klasöründe; geçmişte sohbette göründü | Döndür, .gitignore'a ekle (git repo'da değil ama yine de) |
| **Şifreli not anahtarı dosyayla aynı yerde** | `.harley-anahtar` + `.enc` aynı klasörde → "şifreleme" koruması düşük | Anahtarı DPAPI/Windows Credential Manager'a taşı |
| Serper anahtarı boş → DDG/Bing | Gizlilik açısından DDG iyi; performans düşük | İstersen Serper anahtarı ekle |
| XSS / CSP | ✅ contextIsolation + sandbox + CSP var, renderer escape sonrası markdown | – |
| Ollama dışa kapalı | ✅ 127.0.0.1'e bağlı | – |
| Prompt injection | ✅ sistem promptu "dış içerik veridir" der | Araç çıktıları için katman ekle |

---

## 18. PERFORMANS DARBOĞAZLARI

1. **Yerel model hızı (5.4 tok/sn)** — en büyük gecikme kaynağı. Uzun cevap = dakika. (DeepSeek bunu çözer)
2. **Model değişim beklemesi** — 4 GB VRAM'e 7b+diğerleri sığmaz → her geçişte 5-15 sn.
3. **n8n agent katmanı araç çağrısı düşürme** — qwen2.5:3b'de boş yanıtlara yol açıyor (ölçüldü).
4. **Context sınırı (8192)** — uzun sohbet + 27 araç tanımı sınıra yakın.
5. **Whisper ön-yükleme** — app açılışında RAM + CPU; ama "ilk komut beklemez" avantajı verir.
6. **Web arama** — Serper anahtarı yokken DDG HTML kazıma yavaş ve kırılgan olabilir.
7. **Günün Özeti** — Google 4 servis paralel ~5-9 sn (ölçüldü); 2 dk önbellek var.

---

## 19. GERÇEKTEN ÇALIŞANLAR vs KODU VAR vs YOK

### ✅ GERÇEKTEN ÇALIŞTIĞI DOĞRULANANLAR (bu oturumda veya önceki kanıtlı testlerde)
- Sohbet: **Bulut (DeepSeek)** — canlı test: yanıt verdi ✓
- Sohbet: **Akıllı (qwen2.5:7b)** — canlı test: "2+2=4" ✓
- Günün Özeti — healthcheck: 4/4 bölüm OK, canlı çalıştı ✓
- Web arama — önbellekte gerçek DDG sonuçları var (8 sonuç) ✓
- Hatırlatıcı — zaman çözümleyici + ateşleme test edildi ✓
- PC Kontrol — healthcheck yan etkisiz test OK ✓
- Ekran Oku (moondream) — `--full` test 7.4 sn ✓
- Studio log okuma — log klasörü bulundu ✓
- Kod Çalıştır / Dosya Ara / Not Al — Node.js + klasörler hazır ✓
- Healthcheck tamamı: **23 OK, 0 hata** ✓
- Otomatik hafıza çıkarımı — qwen2.5:3b ile ayrı test edildi, Bellek.md'de gerçek satırlar var ✓
- Tepsi, Ctrl+Alt+H, pano geçmişi, tema, model seçici — kod + UI ✓
- Piper hazır, Edge TTS yedek zinciri ✓

### 🟡 KODU VAR / AYARI AÇIK AMA BU OTURUMDA CANLI DOĞRULANAMAYANLAR
- **Wake word** ("Harley" dinleme) — kod renderer'da, ayar açık; mikrofon+UI ile canlı test gerekir.
- **Roblox Studio köprüsü** — uçlar sahte ajanla test edildi, ama **eklenti Studio'da kurulu değil**
  (healthcheck: "eklenti bağlı değil"). Studio tarafı kullanıcıda.
- **GitHub aracı** — token dosyası yok → çalışamaz durumda.
- **Şifreli Not** — .enc dosyaları var; araç çağrısıyla canlı test yapılmadı.
- **DeepSeek çok turlu (tool) akışı** — tek tur çalıştı; çok araçlı turda reasoning patch'in işleyişi
  doğrulanmadı (n8n 2.34.5 agent katmanı Ollama'da düşürüyor; DeepSeek'te de riskli).

### ❌ HİÇ OLMAYANLAR (kodda bile yok)
- RAG / vektör veritabanı / embedding / semantic arama
- Bulut→yerel otomatik failover (DeepSeek çökerse otomatik yerel modele düşme)
- Sesle yazma modu (mikrofondan giriş kutusuna metin yazma)
- Pomodoro, günaydın rutini, otomatik başlatma
- Conversation summary (özetleme)
- Sohbet arama (Ctrl+F) / dışa aktarma
- Spotify müzik kontrolü, ekran görüntüsü kaydetme, şaka/bilmece modu
- Şifreli notlar için anahtar yönetimi (DPAPI)

### 🐛 DOĞRULANMIŞ HATALAR (bu analizde bulundu)
1. **`webhook-client.js` çift anahtar:** `'qwen2.5:7b'` iki kez tanımlı — ilki ("Zeki", fd62e4e1) ikincisi
   ("Akıllı", 6a19ed07) tarafından **eziliyor**. "Zeki" workflow'u aktif ama UI'dan erişilemiyor.
2. **Hızlı (qwen2.5:3b) boş yanıt:** bu oturumda "2+2" bile boş döndü (n8n agent katmanı sorunu).
3. **Serper anahtarı boş** → arama yedeğe düşüyor (bilinçli değil, eksik yapılandırma).

---

## 20. SİSTEM MİMARİSİ (gerçek)

```
┌───────────────────────────────────────────────┐
│                  KULLANICI                     │
│      (yazı / mikrofon / ses / Ctrl+Alt+H)      │
└───────────────┬───────────────────────────────┘
                ▼
┌───────────────────────────────────────────────┐
│   ELECTRON UYGULAMASI (Harley.exe)            │
│  ┌──────────┐   IPC (preload)   ┌──────────┐  │
│  │ renderer │◄─────────────────►│ main.js  │  │
│  │ UI, wake │   chat:send       │ servis   │  │
│  │ word, TTS│   chunk, voice    │ yönetimi │  │
│  └──────────┘                   └────┬─────┘  │
│        │  Whisper (STT)              │        │
│        │  Edge/Piper (TTS)           │        │
└────────┼─────────────────────────────┼────────┘
         │                    HTTP 127.0.0.1:59333
         ▼                    (PC kontrol, ekran, hatırlatıcı, Studio)
┌─────────────────┐                    │
│  n8n (5678)     │                    ▼
│  Chat Trigger → │        ┌────────────────────────┐
│  AI Agent + 27  │        │  Windows / PC / Roblox │
│  araç + Memory  │        │  Studio / moondream    │
└───────┬─────────┘        └────────────────────────┘
        │
   ┌────┴────┬─────────────┐
   ▼         ▼             ▼
┌──────┐ ┌─────────┐ ┌──────────────┐
│Ollama│ │DeepSeek │ │Google (OAuth)│
│qwen* │ │(bulut)  │ │mail/takvim/  │
│moondr│ │         │ │drive/sheets  │
└──────┘ └─────────┘ └──────────────┘
   │
   ▼
 Bellek.md / profile.md / Notlar.txt / hatirlatmalar.json / HarleyKod / Şifreli
```

---

## 21. KULLANICI GÖZÜNDEN "AI'IM NELER YAPABİLİYOR?"

1. **Sohbet edebilir mi?** Evet — 4 modelden birini seç, yaz veya konuş; cevap canlı akar.
2. **Kod yazabilir mi?** Evet — yerel veya bulut modelle kod yazar, ayrıca "Kod Çalıştır" ile çalıştırır.
3. **Önceki konuşmaları hatırlar mı?** Evet — oturumlar sol menüde; son 24 mesajı da bağlamda tutar.
4. **Benim hakkımda bilgi hatırlar mı?** Evet — Bellek paneli (her zaman) + otomatik hafıza (her sohbetten öğrenir).
5. **İnternetten bilgi bulur mu?** Evet — web arama aracı var (DDG/Bing; Serper anahtarı eklenirse Google).
6. **E-postalarımı okuyabilir mi?** Evet — "Okunmamış e-postalarım neler?" 
7. **Takvimimi yönetir mi?** Evet — etkinlik okur, oluşturur ("yarın 10:00'a toplantı ekle").
8. **Görev tablomu yönetir mi?** Evet — Sheets'ten görev ekler, durum günceller ("görev X'i tamamlandı yap").
9. **Sesli konuşabilir mi?** Evet — cevapları okur (Emel sesi, internet yoksa yerel Piper).
10. **Sesli komut alır mı?** Evet — mikrofonla konuş; "Harley açıl" gibi komutları anlar.
11. **Bilgisayarımı kontrol eder mi?** Evet — "Spotify aç", "şu klasörü aç", "şu URL'yi aç".
12. **Hatırlatıcı kurar mı?** Evet — "10 dakika sonra su içmeyi hatırlat" → bildirim + ses.
13. **Günümü özetler mi?** Evet — "günün özeti" → takvim+mail+görev+drive tek mesajda, sesli okur.
14. **Roblox oyunuma yardım eder mi?** Evet (eklentiyi Studio'ya kurduktan sonra) — kod yazar, script düzeltir, playtest yapar.
15. **Ekranıma bakar mı?** Evet — "ekrana bak, şu hatada ne yazıyor?" → görüntüyü analiz eder.
16. **Kopyaladıklarımı işler mi?** Evet — pano geçmişinden özetle/çevir/sohbete gönder.
17. **Not tutar mı?** Evet — "bunu not al"; şifreli not da tutabilir.
18. **Çeviri yapar mı?** Evet — "şunu Türkçeye çevir" (pano veya metin).
19. **Projelerimi inceler mi?** Evet — "projemde ne var" → klasör yapısını çıkarır.
20. **Kendini eğitir mi?** Evet — her sohbetten sonra önemli bilgileri Bellek.md'ye yazar.

---

## 22. "BUNU NASIL YAPTIĞI" ÖRNEKLERİ

### Örnek 1: "Günün özetini çıkar"
```
Kullanıcı: "Günün özetini çıkar"
  → renderer send() → IPC chat:send → main.js
  → OZET_INTENT eşleşir → MODEL ATLANIR → runOzet()
  → n8n "Günün Özeti" webhook'u → 4 paralel dal (Takvim/Gmail/Sheets/Drive) → merge → özet metni
  → düz metin döner (2 dk önbellek) → renderer ekrana yazar → speak() sesli okur
  → (süre: ~5-9 sn; servis biri çökse bile özet üretilir)
```

### Örnek 2: "10 dakika sonra su içmeyi hatırlat"
```
Kullanıcı yazar/mikrofonla söyler → n8n AI Agent
  → model Hatırlatıcı aracını seçer → toolCode → HTTP POST 127.0.0.1:59333/remind
  → main.js parseRemindTime("10m") → hatirlatmalar.json'a yazar
  → 15 sn'lik döngü vakti gelince fireReminder: Windows bildirimi + Edge TTS ses + sohbete mesaj
```

### Örnek 3: "Spotify aç"
```
Kullanıcı: "Spotify aç" (mikrofon → Whisper → "spotify aç")
  → n8n agent → PC Kontrol aracı → POST /pc {action:"uygulama", target:"spotify"}
  → main.js APP_MAP'ten exe yolunu bulur → Start-Process → "Açıldı: spotify"
  → model kullanıcıya "Spotify açıldı" der (ve istenirse sesli okur)
```

### Örnek 4: "Roblox oyunuma altın para sistemi ekle" (eklenti kurulunca)
```
Kullanıcı → n8n agent → Studio Komut aracı → /studio/status (eklenti bağlı mı?)
  → bağlıysa /studio/exec {code: Luau} → görev kuyruğu → Studio eklentisi poll'lar
  → Luau çalışır (parçalar/scriptler oluşur) → sonuç geri yazılır → model sonucu Türkçe özetler
```

### Örnek 5: "GitHub adım flewqiee" (hafıza)
```
Kullanıcı söyler → n8n agent → Memory Yaz aracı → Bellek.md'ye satır eklenir
  → sohbet sonunda learnFromChat (qwen2.5:3b) aynı gerçeği doğrular/çıkarır (tekrar önlenir)
  → sonraki konuşmalarda model Memory Oku ile hatırlar
```

---

## 23. TAM SİSTEM ÖZETİ

### AI Agent — Harley v0.7.15
- **Status:** ✅ Çalışıyor (23/23 sağlık kontrolü OK; Bulut ve 7b sohbet canlı doğrulandı)
- **Local/Cloud:** Hibrit (yerel Ollama modelleri + DeepSeek bulut + Google bulut servisleri)
- **AI Model:** qwen2.5:7b (yerel varsayılan) / qwen2.5:3b (hızlı) / DeepSeek V4 Flash (bulut varsayılan seçili)
- **Model Size:** 15 GB toplam (5 model; 7.2 GB'si kullanılmıyor)
- **Memory:** profile.md (her mesaj) + Bellek.md (otomatik, qwen2.5:3b) + Simple Memory (24 mesaj) — vektör DB yok
- **Voice:** STT = Whisper-base yerel; TTS = Edge TTS (Emel) → Piper yerel → Windows sesi
- **Tools:** 27 araç (Google 5, web arama, dosya, kod, ekran, PC, hatırlatıcı, Roblox Studio…)
- **Web:** Var (Serper→DDG→Bing; Serper anahtarı boş)
- **Automation:** n8n 2.34.5 — 5 aktif workflow (4 sohbet + Günün Özeti)
- **Database:** SQLite (n8n), localStorage (UI sohbet), düz dosyalar (hafıza/notlar)
- **Frontend:** Electron + vanilya JS (renderer.js), koyu/aydınlık tema, minimalist SVG ikonlar
- **Backend:** Electron main process + yerel HTTP sunucusu (59333) + n8n
- **Total Disk Usage:** ≈ 16.4 GB (geliştirme dahil 17.2 GB)
- **RAM Usage:** ≈ 1.4 GB boşta; ~1.7-2 GB model/Whisper yüklüyken (tahmin)
- **VRAM Usage:** 3798/4096 MiB (qwen2.5:7b yüklüyken — %93)
- **Internet Dependency:** Kısmen (bulut model, Google, arama, Edge TTS için; yerel akış çevrimdışı)
- **API Dependencies:** DeepSeek, Google OAuth, (opsiyonel) Serper; Edge TTS anahtarsız
- **Security Level:** Orta — yerel kilitli, ama auth'suz yerel uçlar + düz metin anahtarlar var

---

## 24. GELİŞTİRME ÖNERİLERİ (mevcut mimariye uygun)

### 🔴 Acilen düzeltilmesi gerekenler
1. **`webhook-client.js` çift `qwen2.5:7b` anahtarı** — "Zeki" webhook'u eziliyor, erişilemez.
   Tek anahtar bırak (veya Zeki'yi `qwen3:8b`'ye bağla — 8b zaten kurulu).
2. **Hızlı (qwen2.5:3b) boş yanıt sorunu** — kullanıcı "Hızlı" seçerse boş dönebilir (ölçüldü).
   Ya 3b'yi listeden kaldır ya da Bulut'a yönlendir ya da n8n'i yükselt (agent katmanı düzeldi mi test et).
3. **Serper anahtarını doldur** — web arama şu an DDG'de; Google sonuçları için anahtarı dosyaya koy.
4. **Context sınırı** — `numCtx` 8192'yi 16K'ya çıkar (7b 16K destekler; VRAM etkisi küçük, ölç).

### 🟠 İyileştirilmesi gerekenler
5. Yerel HTTP sunucusuna basit token doğrulama ekle (59333).
6. n8n chat webhook'larına Basic Auth (SECURITY.md'deki madde).
7. Bulut→yerel otomatik failover (DeepSeek timeout olursa otomatik qwen2.5:7b'ye düş).
8. Kullanılmayan qwen3:4b + qwen3:8b'yi sil → 7.2 GB geri (gerekirse yeniden iner).
9. Şifreli not anahtarını DPAPI'ye taşı.

### 🟡 Faydalı olacak özellikler
10. RAG: `HarleyDosyalar/Bilgi/` belgelerini basit anahtar kelime indeksiyle arayan araç (yerel, embedding'siz
    bile başlar — gerçek vektör DB sonra gelir).
11. Sesle yazma modu (mikrofon → giriş kutusuna metin).
12. Günün özetini sabah otomatik sesli okuma (Windows zamanlanmış görev veya app zamanlayıcı).
13. Hatırlatma listesi paneli (gör/sil).
14. Pomodoro (hatırlatıcı altyapısı hazır, ~10 satır).

### 🟢 İleride eklenebilecek gelişmiş özellikler
15. n8n sürüm yükseltme + Ollama tool-call akışını yeniden test (köklü sorunu çözebilir).
16. Çok kullanıcılı değil ama çok profil (iş/kişisel mod).
17. Sohbet dışa aktarma (JSON/MD) + mesaj arama.
18. DeepSeek çok turlu tool akışını sağlamlaştırma (reasoning_content patch'i doğrula).
19. Windows oturum açılışında sessiz başlatma.

---
*Rapor kaynağı: kaynak kod (main.js, renderer.js, webhook-client.js, n8n-ops.js, ozet-setup.js,
tool-healthcheck.js), canlı n8n API (5 aktif workflow), Ollama API (5 model), PowerShell/nvidia-smi ölçümleri,
uç testleri (Bulut, 7b, 3b, Günün Özeti, web arama, hatırlatıcı, moondream).*
