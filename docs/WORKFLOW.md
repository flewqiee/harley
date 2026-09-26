# Harley — Geliştirme / Doğrulama Akışı

Yeni bir özellik veya düzeltme eklerken izlenecek sıra. Amaç: gerçek hesaplarla
(DeepSeek/Google/GitHub/Spotify) **önce orijinal kurulumda** doğrulamak, sonra
temiz ortamda test etmek, en son GitHub'a yayınlamak.

```
1) Kod değişikliği  (bu repo / app/)
        │
        ▼
2) ORİJİNAL Harley'e entegre et     →  deploy-original.bat
   (kurulu: %USERPROFILE%\Harley)      sadece resources\app.asar güncellenir
        │
        ▼
3) Orijinalde DOĞRULA
   (gerçek anahtarlar/servisler burada olduğu için asıl test burada)
        │
        ▼
4) TEST Harley'e aktar
   (temiz ortam: `cd app && npm start` ya da indirilen `Harley-<sürüm>.exe`)
        │
        ▼
5) Temiz ortamda DOĞRULA  (sihirbaz, TR/EN, hesapsız akışlar)
        │
        ▼
6) GitHub'a push + Release (yeni sürüm)
```

## Neden bu sıra?

- **Orijinal** kurulumda kullanıcının gerçek anahtarları/servisleri vardır → oyun alanı
  özellikleri (Google, Spotify, GitHub, DeepSeek) yalnızca burada anlamlı test edilir.
- **Test** ortamı (sandbox/`npm start`) temizdir; sihirbaz, dil, hesapsız akışlar için uygundur.

## Komutlar

**Orijinale entegre (exe'ye dokunmadan, SAC güvenli):**
```bat
deploy-original.bat
```

**Temiz test ortamı (kaynak):**
```bash
cd app
npm start
```

**Masaüstü kısayolu:** `Harley (Başlat).lnk` → kurulu orijinali açar.

## Sürüm → Release

1. `app/package.json` sürümünü artır (örn. 0.11.1 → 0.11.2).
2. `npm run dist` ile `app/dist/Harley-<sürüm>.exe` üret.
3. GitHub Release oluştur, exe'yi yükle.
4. `deploy-original.bat` ile orijinali güncelle (istersen).

> Not: `.exe` taşınabilir (portable). Kurulum/servis/kayıt defteri bırakmaz.
