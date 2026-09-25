# 🗺 Harley — Geliştirme Yol Haritası

Sürüm: v0.8.0 · Tarih: 25.09.2026

## Mevcut mimari (v0.8.0)

**Tek katman:** Electron uygulaması → doğrudan **DeepSeek bulut API**. n8n ve Ollama tamamen kaldırıldı.

**Sohbet:** `deepseek-flash` / `deepseek-v4-pro`, streaming, oturum geçmişi, function-calling (araç döngüsü), token bütçesi, boş-yanıt tekrarı.

**Araçlar (function-calling + classifier):** dosya işlemleri, git/GitHub (okuma+yazma, force-with-lease), Google (Takvim/Gmail/Drive/Sheets), Spotify, Roblox Studio MCP, web arama, hatırlatıcı, test çalıştırıcı, kişiselleştirme, şifreli not, pano geçmişi, hava durumu.

**App:** tepsi modu, Ctrl+Alt+H çağırma + otomatik mikrofon, hatırlatıcı bildirimleri, pano geçmişi, ayarlar, Edge TTS → Piper, whisper STT, wake word, otomatik hafıza (Bellek.md), günaydın rutini, otomatik yedekleme, `deploy.bat`.

**Test:** `app/tests/` altında 34 test (node:test) — hepsi geçiyor.

---

## P0 — HEMEN (yeni özelliklerin doğrulanması)

- [x] **Personalization UI** — Ayarlar yanında "Kişiselleştir" paneli: yazma tonu, ayrıntı, yapı, kod stili, ilgi alanları, rutin analizi.
- [x] **Test runner UI** — "Testler" paneli: framework algılama, Testleri Çalıştır / Coverage / Push Öncesi Kontrol butonları + sonuç görünümü.
- [x] **Pre-push gate doğrulaması** — `tests/testrunner.test.js`: başarısız test push'u engelliyor, başarılı test izin veriyor (5 test).
- [x] **Personalization şifreleme** — profil AES-256-GCM ile diske yazılır; salt/key ilk açılışta üretilir.

## P1 — YÜKSEK DEĞER

- [x] **RAG güçlendirme** — keyword yerine **BM25** sıralama (rag.js): chunk'lama, IDF, ilgi skoru. `workspace_search` aracı bunu kullanır.
- [x] **Failover / yedek sağlayıcı** — `deepseek-config.json`'a `backup` bloğu: birincil hata verirse (ağ/timeout/429/5xx) otomatik yedek OpenAI-uyumlu sağlayıcıya geçer + backoff ile yeniden dener (`webhook-client.js`).
- [ ] **Görsel analiz geri getirme** — moondream ile birlikte kaldırıldı; Harley şu an görsele bakamıyor. DeepSeek vision veya yerel OCR alternatifi.
- [ ] **Kişiselleştirme derinleştirme** — rutin öğrenmeyi proaktif bildirime bağla ("bu saatte genelde X yapıyorsun").

## P2 — ÜRETKENLİK

- [ ] **Pomodoro** — odak modu altyapısı hazır; "25 dk pomodoro" komutu.
- [ ] **Panodan AI eylemi** — "Özetle / Çevir / Düzelt" butonları.
- [ ] **Hatırlatma listesi UI** — kurulan hatırlatmaları gör/sil.
- [ ] **Sohbet arama + dışa aktarma** — Ctrl+F, JSON/MD export.
- [ ] **Windows açılışında otomatik başlatma** ayarı.

## P3 — BAKIM / TEKNİK BORÇ

- [ ] **Dokümanları güncelle** — HARLEY-ANALIZ.md ve DEVELOPMENT.md hâlâ yer yer n8n/Ollama anıyor.
- [ ] **CHANGELOG.md** — sürüm geçmişi (0.7.x → 0.8.0).
- [ ] **Test scripti** — `package.json`'a `"test": "node --test tests/"` ekle (Node 24 uyumunu doğrula).
- [ ] **CI** — push'ta testleri otomatik çalıştıran GitHub Actions (create_ci_workflow aracı var).
- [ ] **Anahtar yönetimi** — `opencode.json` içindeki anahtarlar düz metin (kullanıcı şimdilik erteledi).
- [ ] **Hata logu** — `HarleyDosyalar/hata.log` + "log göster" aracı.

---

## ✅ Tamamlananlar (v0.8.0)

- n8n + Ollama tamamen kaldırıldı; sohbet doğrudan DeepSeek'e.
- DeepSeek model adı düzeltildi (`deepseek-chat` → `deepseek-flash`) + net API hataları (401/402/429).
- `personalization.js` — şifreli profil (AES-256-GCM), stil uyumu, rutin öğrenme.
- `test-runner.js` — Jest/Vitest/Mocha/Pytest/Cargo/Go + pre-push gate.
- GitHub sync — force-with-lease, remote durum kontrolü, backup squash düzeltmesi.
- Proje hiyerarşisi temizlendi, `Harley/` olarak yeniden adlandırıldı.
- Ölü kod temizliği (n8n workflow'ları, pet-export, installer.nsi).

---

## Önerilen sıra

1. Personalization + test runner **UI** (yeni özellikler görünür olsun)
2. Pre-push gate + şifreleme **uçtan uca doğrulama**
3. RAG güçlendirme (hafıza araması)
4. Görsel analiz geri getirme
5. Doküman + CHANGELOG + CI
