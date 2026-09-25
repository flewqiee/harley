# Harley — Masaüstü Uygulaması

Electron tabanlı, gizlilik öncelikli kişisel AI asistanı. Sohbet doğrudan **DeepSeek bulut API**'ye gider; hiçbir ara sunucu (n8n vb.) yoktur.

## Çalıştırma

`start-assistant.bat` dosyasına çift tıkla ya da terminalden:

```bash
npm start
```

## Ne yapar

- Splash → sohbet penceresi.
- **Tek sohbet modeli:** DeepSeek bulut (`deepseek-flash` / `deepseek-v4-pro`).
- Anahtar: `%USERPROFILE%\HarleyDosyalar\deepseek-config.json` (Bağlantılar panelinden girilir)
- Araçlar (function-calling): dosya işlemleri, git/GitHub, Google (Takvim/Gmail/Drive/Sheets), Spotify, Roblox Studio MCP, hatırlatıcı, test çalıştırıcı, kişiselleştirme.

## Dosyalar

| Dosya | Görev |
|---|---|
| `main.js` | Electron ana süreç, IPC, araç yöneticisi |
| `preload.js` | contextBridge (Node'a tek köprü) |
| `webhook-client.js` | DeepSeek API istemcisi (akış + function-calling) |
| `classifier.js` | Intent yönlendirme (AI'sız yerel handler'lar) |
| `workspace.js` | Çalışma klasörü + git işlemleri |
| `personalization.js` | Şifreli profil, stil uyumu, rutin öğrenme |
| `test-runner.js` | Profesyonel test çalıştırıcı + pre-push gate |
| `google.js`, `github.js`, `spotify*.js` | Entegrasyonlar |
| `index.html` / `styles.css` / `renderer.js` | Arayüz |
| `pet/` | Masaüstü karakteri |

## Sorun giderme

- **"DeepSeek anahtarı yok"** → `HarleyDosyalar/deepseek-config.json` içine `apiKey` ekle.
- **"key GEÇERSİZ (HTTP 401)"** → anahtarı kontrol et.
- **"bakiye yetersiz (HTTP 402)"** → DeepSeek hesabına bakiye yükle.
- **Bağlantı hatası** → internet bağlantısını kontrol et.

## Yedek sağlayıcı (failover)

Birincil sağlayıcı hata verirse (ağ / zaman aşımı / 429 / 5xx) Harley otomatik olarak yedeğe geçer ve geçici hatalarda backoff ile yeniden dener. Yedek, OpenAI-uyumlu (`/chat/completions`) bir servis olmalı:

```json
{
  "apiKey": "sk-...",
  "model": "deepseek-flash",
  "backup": {
    "enabled": true,
    "name": "OpenAI",
    "baseURL": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "model": "gpt-4o-mini"
  }
}
```

Sağlık kontrolü: proje kökünden `node tool-healthcheck.js`
