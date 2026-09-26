<div align="center">

![Harley](docs/banner.svg)

# Harley

**Windows için kişisel AI masaüstü asistanı** — Electron tabanlı, gizlilik öncelikli.
Sohbet doğrudan **DeepSeek bulut API**'sine gider; kendi anahtarlarını bağlarsın.
Hiçbir ara sunucu yok.

[![Lisans: GPL-3.0](https://img.shields.io/badge/lisans-GPL--3.0-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6.svg)](#gereksinimler)
[![Sürüm](https://img.shields.io/github/v/release/flewqiee/harley?label=s%C3%BCr%C3%BCm&color=e5823d)](https://github.com/flewqiee/harley/releases/latest)
[![İndirme](https://img.shields.io/github/downloads/flewqiee/harley/total?label=indirme&color=success)](https://github.com/flewqiee/harley/releases)
[![Yıldız](https://img.shields.io/github/stars/flewqiee/harley?style=social)](https://github.com/flewqiee/harley/stargazers)

[İndir](#-indir) · [Özellikler](#-özellikler) · [Kurulum](#-kaynaktan-kurulum) · [Kaldırma](#️-kaldırma-uninstall) · [Lisans](#-lisans)

</div>

---

## ✨ Harley nedir?

Harley, bilgisayarında yaşayan samimi bir AI asistanıdır: sohbet eder, kod yazar,
projelerini geliştirir, GitHub'a gönderir, takvimini/e-postanı okur, müzik çalar ve
söylediğin işleri adım adım yapar. **Tüm anahtarların ve verilerin senin bilgisayarında
kalır.**

> Bu depo, Harley'nin **herkes için** hazırlanmış sürümüdür. İlk açılışta basit bir
> kurulum sihirbazı seni karşılar; dilediğin servisi bağlar, dilediğini atlarsın.

## 🚀 İndir

<div align="center">

[![Son sürümü indir](https://img.shields.io/badge/%E2%AC%87%EF%B8%8F_Son_s%C3%BCr%C3%BCm%C3%BC_indir-Harley.exe-e5823d?style=for-the-badge)](https://github.com/flewqiee/harley/releases/latest)

</div>

1. [Son sürümü indir](https://github.com/flewqiee/harley/releases/latest) → `Harley-<sürüm>.exe`
2. Çift tıkla (kurulum gerekmez — **portable**).
3. İlk açılışta sihirbazdan **DeepSeek API anahtarını** gir.

> İmzasız olduğu için Windows SmartScreen "bilinmeyen yayıncı" uyarısı gösterebilir →
> **Ek bilgi → Yine de çalıştır**. Kaynaktan çalıştırmayı tercih edersen [Kurulum](#-kaynaktan-kurulum).

## 📸 Ekran görüntüleri

<div align="center">

![Harley arayüzü](docs/screenshot.png)

</div>

> Görseli kendi ekran görüntünle değiştirebilirsin: `docs/screenshot.png`.

## 🧩 Özellikler

| | |
|---|---|
| **Sohbet** | Akışlı (streaming) yanıt, oturum geçmişi, araç çağırma (function-calling), TR/EN |
| **Çalışma alanı** | Bir klasör bağla → dosya oku/yaz, komut çalıştır, test et (tam yetki o klasörde) |
| **Git / GitHub** | Repo oluştur/bağla, commit, push (force-with-lease), issue'lar, CI üretimi — hepsi onaylı |
| **Google** | Takvim, Gmail, Drive, Görevler — "Günün Özeti" tek mesajda |
| **Spotify** | Arama + oynatma (PKCE), üstte mini-player |
| **Roblox Studio** | MCP köprüsü ile Luau çalıştır / script oku-yaz (isteğe bağlı) |
| **Ses** | Edge neural TTS (varsayılan), yerel Piper yedeği, yerel Whisper ile sesli komut |
| **Kişiselleştirme** | Yazma tonu, kod stili, rutin öğrenme (şifreli profil) |
| **Ekstra** | Hatırlatıcılar, pano geçmişi, hava durumu, günaydın rutini, otomatik hafıza, test çalıştırıcı |

## 🧰 Gereksinimler

- **Windows 10/11**
- **Node.js 18+** (yalnızca kaynaktan çalıştırmak için; `.exe` ile gerekmez)
- İnternet (bulut model + bazı servisler)

## 🛠 Kaynaktan kurulum

```bash
git clone https://github.com/flewqiee/harley.git
cd harley/app
npm install
npm start
```

İlk açılışta: **rehber (onboarding)** → **kurulum sihirbazı** (ad + DeepSeek anahtarı) →
opsiyonel servisler.

### 🔌 Bağlantılar (kendi anahtarınla)

Uygulama içindeki **Bağlantılar** panelinden yönetilir:

| Servis | Ne için | Nereden |
|---|---|---|
| **DeepSeek** (zorunlu) | Sohbet | [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) |
| **Google** (opsiyonel) | Takvim / Gmail / Drive / Görevler | Google Cloud → OAuth (Masaüstü uygulaması) |
| **GitHub** (opsiyonel) | Repo / commit / push / issue | [github.com/settings/tokens](https://github.com/settings/tokens) |
| **Spotify** (opsiyonel) | Müzik arama / oynatma | [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) |

Anahtarlar **işletim sistemi şifrelemesiyle** (DPAPI / safeStorage) saklanır;
`%USERPROFILE%\HarleyDosyalar\` altında, yalnızca bu bilgisayarda. Sohbetten geçmez.

## 📂 Veri konumları

| Ne | Nerede |
|---|---|
| Anahtarlar / hafıza / hatırlatmalar / pano | `%USERPROFILE%\HarleyDosyalar\` |
| Kişisel ayarlar & profil | `%APPDATA%\harley\` |
| Kod çalışma alanı | `%USERPROFILE%\HarleyKod\` |
| Yerel ses (Piper) | `%USERPROFILE%\HarleySes\` |

## 🔐 Gizlilik

- Sohbet yalnızca seçtiğin sağlayıcıya (varsayılan: DeepSeek) gider — Harley sunucusu **yoktur**.
- Google / GitHub / Spotify yalnızca **sen bağlarsan** ve **senin anahtarınla** çalışır.
- GitHub'a yazma işlemleri (commit/push/issue) **her zaman önce onayını ister**.
- Yerel dosya yazma yalnızca **bağladığın çalışma klasöründe** geçerlidir.

## 🗑️ Kaldırma (Uninstall)

Harley **portable**'dır: kurulum, servis veya kayıt defteri girdisi **bırakmaz**.

**1) Uygulamayı kaldır**
- İndirdiğin `Harley-<sürüm>.exe` dosyasını **sil**. (Kaynaktan kullandıysan `harley/` klasörünü sil.)

**2) Verilerini temizle** — iki yol:

- **Uygulama içinden:** Ayarlar → **Verilerim → Tüm verileri sil**.
- **Betikle:** Depodaki **`uninstall.bat`** dosyasına çift tıkla (aşağıdaki klasörleri siler).
- **Elle:** şu klasörleri sil:
  ```
  %USERPROFILE%\HarleyDosyalar
  %APPDATA%\harley
  %USERPROFILE%\HarleySes
  %USERPROFILE%\HarleyMCP
  %USERPROFILE%\Harley          (kurulu sürüm klasörü)
  ```
  > `%USERPROFILE%\HarleyKod` kendi script'lerini içerebilir; **silmek istersen** içindeki
  > `github-token.txt` dosyasını en azından sil.

Tek komutla (PowerShell):
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\HarleyDosyalar","$env:APPDATA\harley","$env:USERPROFILE\HarleySes","$env:USERPROFILE\HarleyMCP"
```

## 🧪 Geliştirme

```bash
cd app
node --test          # testler (44 adet)
npm run dist         # electron-builder ile .exe üretir -> app/dist
```

**Push öncesi otomatik test:** depoda `pre-push` hook'u var. Bir kez etkinleştir:
```bash
git config core.hooksPath .githooks
```
Artık her `git push` öncesi testler çalışır; başarısızsa push engellenir
(atlamak için: `git push --no-verify`).

### Proje yapısı

```
harley/
├─ app/            Electron uygulaması (main.js, renderer.js, araçlar, arayüz)
│  ├─ tests/       node:test ile testler
│  └─ dist/        derleme çıktısı (gitignore)
├─ docs/           rehberler (SETUP, LICENSING, ROADMAP...)
├─ roblox-studio/  Studio köprüsü (Luau eklentisi)
└─ uninstall.bat   temiz kaldırma
```

## 🤝 Katkı

Katkılar memnuniyetle! Ancak proje **çift lisanslı** olduğu için, katkının Pro sürümde de
kullanılabilmesi adına bir **CLA** onayı istenir — ayrıntı: [docs/LICENSING.md](docs/LICENSING.md).

## 💛 Destek / Bağış

Harley tamamen **ücretsiz** ve açık kaynak. Geliştirmeye devam etmemi desteklemek istersen
(Türkiye):

- **Papara:** `<Papara numaranı buraya ekle>`
- **IBAN (havale/EFT):** `<IBAN'ını buraya ekle>`
- **Kredi kartı (Shopier):** `<Shopier linkini buraya ekle>`

## 📄 Lisans

**GNU GPLv3 (veya sonrası)** · © 2026 Umut Efe Kurucay.

Harley'i kullanabilir, değiştirebilir ve dağıtabilirsin — ama dağıttığın sürümü de
**GPLv3 + açık kaynak** yapmalısın. Böylece kimse Harley'i **kapalı kaynak** bir ürüne
çevirip satamaz. Pro/Premium sürümler ileride ayrı **ticari lisans** ile sunulabilir
([docs/LICENSING.md](docs/LICENSING.md)).
