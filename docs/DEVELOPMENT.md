# 🛠 Harley — Geliştirici Rehberi

> ⚠️ **Not:** Bu belge geçmişe ait bölümler içerir (n8n / Ollama dönemi). Harley artık
> tek katmanlıdır: Electron uygulaması doğrudan **DeepSeek bulut API**'siyle konuşur;
> n8n ve Ollama **tamamen kaldırılmıştır**. Güncel kurulum için kök `README.md` ve
> `docs/SETUP.md` dosyalarına bak. Aşağıdaki n8n/Ollama bölümleri yalnızca tarihsel
> referanstır.

Bu rehber, Harley'i (kişisel AI asistanın) kendi başına geliştirmen için. Güncel mimari:

```
┌────────────────────────────────────┐
│  app/ → Electron (arayüz + zeka)   │  main.js, renderer.js, araçlar, ses
└────────────────────────────────────┘
        │  HTTPS
        ▼
   DeepSeek bulut API  (+ opsiyonel sağlayıcılar)
```

## 📁 Önemli konumlar

| Ne | Nerede |
|---|---|
| Uygulama kaynak kodu | `app/` (main.js, renderer.js, styles.css, index.html, preload.js) |
| n8n yönetim aracı | `n8n-ops.js` (kök dizinde) |
| n8n API anahtarı | `n8n-api-key.txt` |
| Kullanıcı dosyaları | `C:/Users/kuruc/HarleyDosyalar/` (Notlar.txt, Bellek.md, projeler…) |
| Kod çalışma alanı | `C:/Users/kuruc/HarleyKod/` (script'ler) |
| Kişisel ayarlar | `%APPDATA%/KisiselAsistan/settings.json` |
| Bellek paneli içeriği | `%APPDATA%/KisiselAsistan/profile.md` |
| Derlenen kurulum | `app/dist/Harley-<versiyon>.exe` |
| Araç sağlık kontrolü | `node tool-healthcheck.js` (tüm servisleri ve araçları tek komutla test eder) |
| Günün Özeti workflow kurulumu | `node ozet-setup.js` (n8n'de "Günün Özeti" workflow'unu kurar/aktifleştirir) |

## 🧠 4 model / workflow

| Workflow | n8n ID | Ne zaman |
|---|---|---|
| My workflow (Hızlı) | `DgjVcGz6fQe7EPkm` | qwen2.5:3b — hızlı |
| My workflow (Zeki) | `A6rNseMxSRSCnOaG` | qwen2.5:7b — dengeli |
| My workflow | `MM1IenCTk1zIWAiq` | qwen2.5:7b — akıllı (önerilen yerel) |
| My workflow (Bulut) | `bBZxe79bNZ4FKnrV` | deepseek-v4-flash — **en zeki** |
| Günün Özeti | `Yk4Q2jfgN5BqB1Nm` | takvim+e-posta+görev+drive tek akış |

> ⚠️ **Model notu:** `qwen3:4b` araç modunda TÜM çıktısını `thinking` alanına koyuyor
> ve `content` boş kalıyordu — bu yüzden "My workflow" artık `qwen2.5:7b` kullanıyor
> (araçlarla kusursuz çalışıyor). Ayrıca n8n 2.34'ün AI-SDK agent katmanı Ollama
> araç çağrılarını güvenilmez biçimde düşürüyor — bu yüzden **Günün Özeti** isteği
> modeli tamamen atlar: app, özeti hazır veri olarak doğrudan yanıtlar (`app/main.js`
> içindeki `OZET_INTENT` + `runOzet()`).

Her modelin kendi webhook'u var (`app/webhook-client.js` içinde `WEBHOOKS`). Yeni model eklemek için oraya bir satır + n8n'de bir workflow kopyası gerekir.

## 🔧 Yeni bir araç (tool) eklemek

Araçlar n8n'de `toolCode` node'larıdır. `n8n-ops.js`'e yeni bir `op` ekle:

1. `n8n-ops.js`'te `add-note-tool` bloğunu örnek al. `jsCode`'u bir dizi satır olarak yaz (tırnak kaçışlarına dikkat: `\\n`, `\\(` gibi).
2. Aracın `description`'ına modelin anlayacağı net Türkçe talimat yaz — **araç kalitesi açıklamanın kalitesidir**.
3. Uygula: `node n8n-ops.js add-my-tool <workflowId>` (4 workflow'a da uygula).
4. Test et: `cd app && node test-webhook.js "deepseek-v4-flash" "sorun"` (streaming ham çıktı verir) veya app'ten dene.

**Kural:** Araç `fs`, `path`, `http`, `https` modüllerini kullanabilir ama `zlib` kullanamaz — n8n toolCode sandbox'ı onu yasaklar ("Module 'zlib' is disallowed"). Bu yüzden `web_search` aracı zlib kullanmaz (Serper → DDG → Bing, gzip açmadan çalışır).

## 🎭 Kişiliği değiştirmek

Kişilik, her workflow'un **AI Agent** node'unun `systemMessage`'ında. Şu an "Harley — kişisel asistan, Umut'un asistanı" personası + tarz/araç/dil kuralları var. Değiştirmek için:

- `n8n-ops.js` içindeki `set-persona` op'unun metnini düzenle ve 4 workflow'a uygula, **veya**
- n8n editöründe (`localhost:5678`) AI Agent → options → systemMessage'ı elle düzenle.

Kişisel ayarlar (ad, hitap, tarz, emoji) app'in ⚙ panelinden gelir ve her istekte `profile` alanıyla n8n'e gider — `app/main.js` içindeki `buildProfilePayload()`'da birleştirilir.

## 💻 Derleme & kurulum (önemli adımlar)

```bash
cd app
node --check main.js && node --check renderer.js   # sözdizimi kontrolü
npx electron-builder --win dir                      # win-unpacked klasörü üretir (kurulum yok)
```

- Sürümü `app/package.json`'da artır (örn. 0.7.6 → 0.7.7) — her derlemede.
- **Kurulum (SAC güvenli):** `dist/win-unpacked` içeriğini `C:\Users\kuruc\Harley\` üzerine kopyala → `resources/app.asar` ve `app.asar.unpacked` değişir; `Harley.exe`'ye DOKUNMA (aşağıya bak).
- Masaüstü kısayolu: hedef `C:\Users\kuruc\Harley\Harley.exe`, **argüman `resources\app.asar`**, ikon `icon.ico`.
- **n8n güncellenirse** DeepSeek düzeltmesi ve diğer yamalar app açılışında kendini onarır (`ensureDeepSeekReasoningPatch` vb.).

## 🧪 Hızlı test komutları

```bash
node n8n-ops.js list                                # workflow'ları listele
node n8n-ops.js add-web-search <workflowId>         # web aramasını yeniden kur
cd app && node test-webhook.js "deepseek-v4-flash" "merhaba"   # tek mesaj testi
node fix-workflows.js                               # 4 workflow'u onar + re-aktive et
```

## 🧠 Sohbet hafızası & boş yanıtlar (kritik!)

- Sohbet hafızası her workflow'daki **Simple Memory** (memoryBufferWindow) node'undan gelir — `sessionIdType: fromInput`, `contextWindowLength: 24`. Eğer o node **disabled** gelirse veya workflow yeniden aktive edilemezse, model devam sorusunda önceki mesajı hatırlamaz.
- Google Sheets **Görev Ekle / Update Sheets** node'larının `columns.value`'su **sütun adıyla anahtarlı OBJE** olmalı (`{"Görev": "={{ $fromAI('gorev', ...) }}", ...}`), schema id'leri de sütun adları. Eski array formatı (`[{column, value}]`) kaydedilirse n8n aktivasyon doğrulamasını geçemez ("Missing or invalid required parameters: columns, columns.gorev") ve n8n **eski sürümü çalıştırmaya devam eder** — tüm değişiklikler boşa gider.
- Bulut modelde `maxTokens: 8000` şart: DeepSeek düşünme tokenlarını da bu limitten harcar; 2000'de düşünmeye takılıp **boş yanıt** (`finish_reason: length`) veya **yarım cümle** döner. Yerel modeller 4096.
- App her açılışta `ensureWorkflowHealth()` ile bu üçünü otomatik onarır (hafıza + columns + maxTokens) ve workflow'u re-aktive eder.
- `webhook-client.js` artık içeriksiz `begin/end` NDJSON akışını ham JSON olarak göstermez — boş yanıt döner, app otomatik 2 kez tekrar dener.

## 🎙 Ses (Edge neural + Piper + Windows)

Ayarlar → **Ses motoru** seçimi: `edge` (varsayılan) / `piper` / `system`.

- **Harley Sesi — Microsoft Edge neural (varsayılan):** `node-edge-tts` paketiyle Microsoft'un sinirsel Türkçe sesi (`tr-TR-EmelNeural`). Ücretsiz, anahtar yok, sınırsız, internet ister. Çok doğal — ElevenLabs kalitesinde ama 10k sınırı yok. Kod: `app/main.js` (`edgeTTS` + `tts:edge` IPC).
- **Yerel Piper:** Çevrimdışı yedek. Runtime `C:/Users/kuruc/HarleySes/piper/` (piper.exe + `tr_TR-dfki-medium.onnx`, ASCII yolda olmalı). İlk kullanımda otomatik indirilir (~90 MB). `ensurePiper`/`piperTTS` + `tts:piper` IPC. Edge seçiliyken bile arka planda indirilir — internet yoksa otomatik devreye girer.
- **Windows sesi:** Sistem sentezi, son çare.
- **Sesli komut (STT):** Her zaman yerel `whisper-tiny` (q8) — gizlilik öncelikli. Uygulama açılırken arka planda ön-yüklenir (ilk kullanımda beklemek yok). Kayıt ~1.4 sn sessiz kalınca otomatik biter.
- **ElevenLabs KALDIRILDI** (v0.7.6) — API anahtarı, ses seçici ve bulut STT ayarları temizlendi. Bozuk anahtar kaydı settings.json'dan silindi.

## 🎛 Asistan davranışı (v0.7.7)

- **Tepsi modu:** Kapatma butonu uygulamayı gizler, tepsi simgesinde kalır (n8n/Ollama çalışmaya devam eder). Tepsi menüsünden "Kapat" gerçek çıkıştır (`app.isQuiting`).
- **Hızlı çağırma:** `Ctrl+Alt+H` her yerden Harley'yi öne getirir ve **mikrofonu otomatik başlatır** — konuşmaya hemen başlayabilirsin (`global:summon` → renderer `toggleMic`).
- **"Harley açıl":** PC Kontrol aracı `harley/asistan` hedefini tanır → pencereyi öne getirir (n8n tool açıklamasında da var).
- **Hatırlatıcı:** n8n aracı `Hatırlatıcı` → `<zaman> | <mesaj>` (örn. `10m`, `1h30m`, `18:30`, `yarın 09:00`) → app'in `POST /remind` ucu (`127.0.0.1:59333`) → `C:/Users/kuruc/HarleyDosyalar/hatirlatmalar.json`. 15 sn'de bir kontrol; vaktinde Windows bildirimi + sesli okuma (Edge→Piper) + sohbete sistem mesajı (`reminder:fire`).
- **Arka plan ön-yükleme:** Whisper modeli açılışta 4 sn sonra belleğe yüklenir (ilk mikrofon kullanımında bekleme yok).

## 🧠 Otomatik hafıza + Wake word (v0.7.12)

- **Otomatik hafıza:** `chat:send` başarıyla dönünce `learnFromChat()` çalışır — `qwen2.5:3b` (hızlı, ~13 sn) sohbetten kalıcı gerçekleri çıkarır, `Bellek.md`'ye ekler. 90 sn throttle, dedupe, 400 satır tavan, 'harley/asistan/sohbet' satırları elenir. Ayar: `autoMemory` (varsayılan açık).
- **Wake word:** renderer'da enerji-VAD döngüsü — sürekli mikrofon dinler, ses duyunca ~3.6 sn pencereyi Whisper'a gönderir, "harley" varyantları geçerse `toggleMic()` ile komut kaydı başlar. Tamamen yerel. Ayar: `wakeWord` (varsayılan kapalı). `setMicState` kayıt sırasında wake'i durdurur, boşta geri açar.
- **Web arama (v0.7.11):** Serper.dev anahtarı `HarleyDosyalar/websearch-key.txt`'te ise Google sonuçları (gl/hl=tr), yoksa DDG→Bing yedeği. Sadece başlık+özet+URL döner (içerik çekmez), 10 dk önbellek `.arama-cache.json`.

## 🎮 Roblox Studio köprüsü (v0.7.10 → v0.7.16 MCP)

Harley, kullanıcının Roblox Studio'sunda Luau çalıştırabilir / script okuyup yazabilir / proje yapısını görebilir.

### ⚡ Studio MCP (v0.7.16) — ÖNCELİKLİ yol
- **Ne:** `drgost1/robloxstudio-mcp` (npx, v2.6.0) — Studio'daki hazır "MCP Integration" eklentisi (`MCPPlugin.rbxmx`) ile **51 araç**: execute_luau, get_file_tree, get_script_source/set_script_source, search_replace_scripts, create_object_with_properties, set_property, start_playtest/get_playtest_output (log yakalar), undo, insert_asset, fill_terrain…
- **Portlar:** 3002 legacy HTTP (`POST /mcp/<tool>`, args gövde) + 58741 streamable MCP. Eklenti varsayılan 58741'e bağlanır.
- **Otomatik başlatma:** `startStudioMCP()` (main.js) — sunucu stdio-MCP; stdin kapanınca kapanır, bu yüzden `node -e "setInterval(()=>{},1e9)" | npx --yes robloxstudio-mcp@latest` üreteciyle beslenir (görünmez, detached). `ensureServices()` her açılışta `probeAny(3002)` ile kontrol edip yoksa başlatır. Test edildi: sunucu öldürülüp app yeniden başlatılınca 8 sn içinde geri geldi.
- **Proxy:** app `POST /studio/mcp` {tool, args} → 3002 `/mcp/<tool>` → `{content:[{text}]}` zarfı açılıp düz metne çevrilir.
- **n8n aracı:** `Studio MCP` (`n8n-ops.js add-studio-mcp`) — 4 workflow'a eklendi + systemMessage'a `STUDIO MCP ÖNCELİĞİ` kuralı. Dikkat: n8n toolCode şeması tek `input` alanı üretir → jsCode `input`(string/JSON/nesne)/`tool`/`args` tüm şekilleri ayrıştırır ve proxye `{tool, args}` gönderir.
- **Uçtan uca doğrulandı:** sohbet → DeepSeek → Studio MCP aracı → proxy → 3002 → Studio eklentisi → parçalar gerçekten oluşturuldu (kırmızı test parçası + `ObbyBaslangic` obby: 3 checkpoint + ölüm tuzağı), read-back ile doğrulandı.
- **Pencere yok:** sunucu `ELECTRON_RUN_AS_NODE=1` ile electron binary üzerinden doğrudan spawn edilir (npx/cmd aracısı yok → cmd penceresi çıkmaz). Paket yerelde: `C:/Users/kuruc/HarleyMCP/node_modules/robloxstudio-mcp`.
- **Bağlantı paneli (UI):** sol kenar çubuğunda "Studio" çipi — her 6 sn'de `/studio/mcp-status` (execute_luau probe, `pluginConnected` güvenilmez) ile durumu gösterir: bağlı / Studio kapalı / eklenti yok / MCP yok. Tıkla → `/studio/mcp-connect` (sunucuyu başlat + Studio'yu odakla).
- **Boş-yanıt düzeltmesi:** Bulut maxTokens 8000→16000, agent maxIterations 10→60 (`ensureWorkflowHealth` her açılışta onarır; anahtar `resources/n8n-api-key.txt`'ten okunur — deploy.bat kopyalar).
- **Bellek düzeltmesi (v0.7.16):** Whisper artık açılışta YÜKLENMİYOR — ilk mikrofon kullanımında yüklenir ve 15 dk boşta kalınca boşaltılır; DML denemesi fp32 yerine q8 ile başlar (fp32 1.5 GB ağırlığı belleğe çekip OOM sonrası RAM bırakıyordu). Ölçüm: Harley toplam 5.3 GB → **535 MB** (10×). Ollama `OLLAMA_KEEP_ALIVE=3m` ile modelleri boşta boşaltır.
- **Görev çubuğu (v0.7.16):** `productName` "Harley" yapıldı; deploy.bat artık TÜM `win-unpacked`'ı kopyalar (eski kurulum ham electron.exe'ydi → "Electron" görünüyordu). Yeni exe metadata: FileDescription/ProductName = Harley.
- **Ayarlar paneli (v0.7.16):** `.settings-grid` `overflow-y: auto` + footer `flex-shrink: 0` — alan sayısı artınca "Kaydet" butonu dışarı taşmıyor, panel içinde kaydırılıyor.
- **Günaydın rutini (v0.7.16):** `runMorningRoutine()` — ayar açıksa günde bir, açılıştan ~20 sn sonra: Open-Meteo'dan (ücretsiz, anahtarsız) şehir hava durumu + `runOzet()` günün özeti → `morning:briefing` IPC ile renderer'a, sesli okunur. Ayarlar: `city` (şehir) + `morningRoutine` (aç/kapa).
- **Güvenlik (v0.7.16):** n8n sohbet webhook'larında Basic Auth (`HarleyDosyalar/n8n-webhook-auth.txt`, kullanıcı `harley`); yerel 59333 uçlarında `X-Harley-Token` (`HarleyDosyalar/harley-token.txt`, ilk açılışta üretilir). Studio eklenti uçları (poll/result/hello/status) açık kalır. Detay: SECURITY.md.
- **Token güvenliği (v0.7.16):** Studio MCP aracının çıktısı 4000 karakterle kırpılıyor (`add-studio-mcp` ops'u; `get_file_tree` 1 MB ağaç döndürüp memory buffer'ı şişiriyordu → tek execution ~950K giriş tokeni). Ayrıca `ensureWorkflowHealth` maxIterations 60→20 ve memory penceresi 24→12 tutar (her araç adımında tüm geçmiş yeniden gönderildiği için). Doğrulama: basit sohbet 12K giriş, araç çağrılı sohbet 12.4K giriş tokeni.

Harley, kullanıcının Roblox Studio'sunda ayrıca (klasik köprü ile) Luau çalıştırabilir / script okuyup yazabilir / proje yapısını görebilir.

- **Mimari:** Studio'daki `HarleyStudio` eklentisi (`roblox-studio/HarleyStudio.luau`) saniyede bir `127.0.0.1:59333/studio/poll` ucuyla görev alır; Luau çalıştırır, sonucu `/studio/result` ile geri yazar. n8n'deki `Studio Komut` aracı (`n8n-ops.js add-studio-tool`) görev oluşturur ve sonucu bekler.
- **Uçlar:** `POST /studio/exec` {type, code} → id · `GET /studio/poll?agent=` → {task} · `POST /studio/result` {id, ok, output} · `GET /studio/result?id=` · `GET /studio/status` · `GET /studio/hello?agent=` · `POST /studio/playtest` {action: start|stop} (Studio'yu odaklar, F5/Shift+F5 gönderir — `studioFocus`/`studioKey` PowerShell AppActivate+SendKeys) · `POST /studio/focus` · `GET /studio/log` (en yeni `%LOCALAPPDATA%/Roblox/Studio/logs` dosyasından script hataları). Görevler 2 dk içinde alınmazsa düşer; sonuçlar 90 sn saklanır. Kuyruk bellekte (`studioTasks`/`studioAgents`).
- **Studio Komut komutları (n8n aracı):** ÇALIŞTIR / YAPI / OKU / KAYNAK (eklenti üzerinden) + PLAYTEST / DURDUR / LOK / ODAKLA (app üzerinden, eklenti gerekmez). Tasarım kuralı `add-design-rule` ile systemMessage'a eklendi; şablon `roblox-studio/TASARIM-SABLONU.md`.
- **Görev tipleri:** `exec` (loadstring + çalıştır), `structure` (YAPI), `get_source` (OKU), `set_source` (KAYNAK).
- **Not:** sunucu, `/studio` dışında yalnızca POST kabul eder (studio GET'leri için istisna). `GET` uçları `req.url.startsWith('/studio')` ile geçer.
- Kurulum/kullanım: `roblox-studio/KURULUM.md`. Test (sahte ajan): exec→poll→result→retrieve döngüsü doğrulandı.
- **Studio tarafı manuel:** eklentiyi Studio'da kullanıcı kurar (Eklenti Yöneticisi → yapıştır → kaydet). Uçtan uca Studio testi kullanıcıda yapılır.

## 🧹 Arayüz kuralları

- **Emoji yok** — tüm butonlar minimalist SVG ikon (`renderer.js` içindeki `ICONS` haritası). Modele de "emoji kullanma" kuralı verildi (workflow systemMessage + ayar profili).
- **Hazır sorular:** Girişin üstündeki çipler yerine **torba (bag)** butonu — üzerine gelince popover'da hazır promptlar (Günün özeti, E-postalarım, Görevlerim, Drive).
- **Ad/hitap:** Ayarlardaki Ad, artık her zaman kazanır — workflow'lardaki sert kodlu "Umut" kaldırıldı ve `settings:set` Bellek.md'deki ad satırını da senkronize eder.

## 🚨 Windows Smart App Control (KRİTİK — nasıl çalışıyor)

Bu makinede **Smart App Control açık** ve **imzasız, özel adlı exe'leri engelliyor** — electron-builder'ın paketli exe'si (`Kişisel Asistan.exe` / `Harley.exe`) her derlemede yeni hash alır ve SAC onu "Uygulama Denetimi ilkesi bu dosyayı engelledi" ile durdurur. **Ancak** geliştirici `electron.exe` binary'si (bulut itibarı olan, imzasız ama bilinen bir dosya) **engellenmiyor**.

**Çalışan çözüm — exe'yi değiştirmeden uygulamayı çalıştır:**
- `C:\Users\kuruc\Harley\Harley.exe` = **dev `electron.exe`** (npm'deki `node_modules/electron/dist/electron.exe` kopyası). Hash sabit kaldığı için SAC hep izin verir.
- Uygulama, kısayolun **argümanıyla** yüklenir: `Harley.exe resources\app.asar` (asar adı korunduğu için `app.asar.unpacked` native modülleri de doğru çözülür).
- **Güncelleme:** sadece `resources/app.asar` + `app.asar.unpacked` değiştir; exe'ye dokunma → SAC sorunsuz.
- Önceki denemeler (v0.7.5 portable, v0.7.6 klasör) o sırada çalıştı çünkü SAC yeni açılmıştı; artık yeni hash'li her imzasız exe engelleniyor.
- Kalıcı çözüm istersen: Smart App Control'ü kapat (geri alınamaz) veya gerçek kod imzalama sertifikası al.
- Kullanıcı verileri: `%APPDATA%/privacy-assistant-app/` (settings.json, profile.md) ve `C:/Users/kuruc/HarleyDosyalar/` (Bellek, şifreli notlar, hatırlatmalar.json).

## 🔤 Fontlar

- `app/fonts/` klasörü: **Typo Grotesk** (sohbet başlığı, ücretsiz kişisel kullanım) + **Hanken Grotesk** (Havelock yedeği, OFL).
- **Havelock** ticari font — lisanslı dosyayı `app/fonts/Havelock.otf` olarak eklersen "Harley" yazısı otomatik Havelock olur; yokken Hanken Grotesk kullanılır (görsel olarak çok yakın). Detay: `app/fonts/OKU-BENI.md`.

## ⚠️ Bilinen davranışlar

- **qwen2.5:3b** çok araçlı işlerde zorlanır (model limiti) — araç gerektiren sorularda Bulut'u kullan.
- DuckDuckGo yoğun testte geçici CAPTCHA verebilir; arama aracı otomatik Bing → Wikipedia'ya düşer, model de kendi bilgisiyle cevaplar.
- Bulut (DeepSeek) ara sıra boş yanıt dönebilir — app otomatik 2 kez daha dener (maxTokens 8000 ile nadir olmalı).
- Kod Çalıştır aracı script'leri aynı işlemde çalıştırır: **sonsuz döngü yazdırma** (işlem kilitlenir).
