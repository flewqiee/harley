# Harley — Kurulum Rehberi

Harley, Windows için Electron tabanlı kişisel AI asistanıdır. Sohbet doğrudan
**DeepSeek bulut API**'sine gider; araya sunucu (n8n vb.) girmez. Tüm anahtarlar
yalnızca senin bilgisayarında saklanır.

## 1. Ön koşullar

- Windows 10/11
- [Node.js 18+](https://nodejs.org) (önerilir: 20 veya üstü)
- İnternet bağlantısı

## 2. Çalıştırma (geliştirme)

```bash
cd app
npm install
npm start
```

Bu komut Electron uygulamasını açar.

## 3. İlk açılış

1. **Rehber (onboarding):** Harley'nin ne yaptığını kısaca anlatan birkaç adım.
2. **Kurulum sihirbazı:**
   - **Adın:** Sana nasıl hitap edeceğini belirler.
   - **DeepSeek API anahtarı:** Zorunlu. https://platform.deepseek.com/api_keys
     adresinden ücretsiz oluşturabilirsin. "Kaydet ve Test Et" anahtarı doğrular.
   - **Diğer bağlantılar (isteğe bağlı):** GitHub, Google, Spotify.

Bunları sonradan sol menüdeki **Bağlantılar** panelinden de yönetebilirsin.

## 4. Servis bağlantıları

### DeepSeek (zorunlu)
1. Bağlantılar → DeepSeek → anahtarı yapıştır → **Kaydet ve Test Et**.
2. Kaydedilen dosya: `%USERPROFILE%\HarleyDosyalar\deepseek-config.json`

### Google (Takvim / Gmail / Drive / Görevler)
1. https://console.cloud.google.com → proje oluştur.
2. Gerekli API'leri etkinleştir: **Calendar**, **Gmail**, **Drive**, **Tasks**.
3. **Kimlik bilgileri → OAuth istemci ID** → tür: **Masaüstü uygulaması**.
4. Client ID + Client Secret'ı Bağlantılar panelindeki Google kartına gir → **Kaydet** → **Bağlan**.
5. Tarayıcıda izin ver; Harley erişimi güvenli biçimde saklar.

### GitHub
1. https://github.com/settings/tokens → yeni token (gerekli izinler: `repo`, `workflow`).
2. Token'ı Bağlantılar → GitHub kartına gir → **Kaydet ve Test Et**.

### Spotify
1. https://developer.spotify.com/dashboard → uygulama oluştur.
2. **Redirect URI** listesine ekle: `http://127.0.0.1:8888/callback`
3. Client ID'yi Bağlantılar → Spotify kartına gir → **Kaydet** → **Bağlan**.

## 5. Opsiyonel bileşenler

- **Roblox Studio köprüsü:** `roblox-studio/KURULUM.md` adımlarını izle.
- **Yerel ses (Piper):** İlk kullanımda otomatik indirilir (`%USERPROFILE%\HarleySes\piper`).
- **Yerel sesli komut (STT):** Whisper ilk mikrofon kullanımında indirilir/yüklenir.

## 6. Sorun giderme

| Belirti | Çözüm |
|---|---|
| "DeepSeek anahtarı yok" | Bağlantılar panelinden anahtarı gir ve test et. |
| "key GEÇERSİZ (HTTP 401)" | Anahtarı kontrol et (baş/son boşluk olmasın). |
| "bakiye yetersiz (HTTP 402)" | DeepSeek hesabına bakiye yükle. |
| Bağlantı hatası | İnternet bağlantısını kontrol et. |
| Google "izin verilmedi" | OAuth istemci türünün **Masaüstü uygulaması** olduğundan emin ol. |

Sağlık kontrolü: proje kökünden `node tool-healthcheck.js`
