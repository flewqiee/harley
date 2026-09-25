# 🤖 Harley ↔ Roblox Studio — Kurulum & Kullanım

Harley'nin Roblox Studio'na bağlanıp **senin için kod yazmasını, değiştirmesini ve çalıştırmasını** sağlar.

## Nasıl çalışır?

```
Harley sohbeti (n8n modeli)
   → "Studio Komut" aracı
   → Harley uygulaması (127.0.0.1:59333 — görev kuyruğu)
   → Studio'daki "Harley Bağla" eklentisi (saniyede bir kuyruğu poll eder)
   → Luau kodunu Studio'nda çalıştırır → sonucu Harley'ye geri yazar
```

## Kurulum (tek seferlik, ~2 dakika)

1. **Harley uygulaması açık** olsun (köprü onun üzerinden çalışır).
2. **Roblox Studio'yu aç** → `Dosya → Game Settings → Security` → **"Allow HTTP Requests"** → **On**.
3. `Eklentiler (Plugins)` sekmesi → **Eklenti Yöneticisi** (Plugin Manager) → **Yeni Eklenti**.
4. Açılan script editörüne **`HarleyStudio.luau` dosyasının tamamını** yapıştır ve **Ctrl+S** ile kaydet.
5. Eklenti araç çubuğunda (Studio üst kısmı) **"Harley Bağla"** düğmesi belirir — **tıkla**.
   - Output penceresinde `[Harley] Studio bağlandı` yazısını görürsün.
6. Harley'ye artık şunları söyleyebilirsin:
   - *"Roblox oyunuma bir maden sistemi ekle"*
   - *"YAPI'yı çıkar, bana projemin yapısını söyle"*
   - *"Şu script'i oku / düzelt"*

## Harley'nin Studio'da yapabilecekleri (Studio Komut aracı)

| Komut | Ne yapar |
|---|---|
| `ÇALIŞTIR <luau>` | Studio'da kod çalıştırır (parça oluştur, instance ekle, attribute ayarla…) |
| `YAPI` | Proje ağacını (isim + sınıf) döndürür |
| `OKU <script adı>` | Bir script'in kaynağını okur |
| `KAYNAK <script adı> \| <yeni kod>` | Script'in kaynağını değiştirir |
| (ham Luau) | Doğrudan çalıştırılır |

## Önemli kurallar

- **Sonsuz döngü yazma** — Studio donar, yeniden başlatmak gerekir.
- **Görsel yerleştirme Harley'nin işi değil** — pozisyon/estetik işlerinde Studio'da kendin bak (AI kod mantığını, sen görseli yönetirsin — bu, deneyimlerin ortak sonucu).
- **Oyun içi test:** Harley kodları Studio düzenleme modunda çalıştırır; oyunu test etmek için **Play**'e sen basarsın.
- Eklenti yalnızca **127.0.0.1** ile konuşur (kendi bilgisayarın) — dışarıya hiçbir şey göndermez.

## Sorun giderme

- **"Studio bağlı değil"** → Eklentiyi kur + "Harley Bağla" düğmesine bas; Harley uygulamasının açık olduğundan emin ol.
- **HTTP engellendi** → Game Settings → Security → Allow HTTP Requests = On.
- **Sonuç dönmüyor** → Kod sonsuz döngüde olabilir; Studio'yu kapatıp aç.
- **Harley uygulaması yeniden başlarsa** bağlantı kopmaz (eklenti poll etmeye devam eder); "Harley Bağla" düğmesi aktif kalır.

## Dosyalar

- `HarleyStudio.luau` — Studio eklentisi (yukarıdaki adımlarla kur).
- Bu köprünün arka ucu: `app/main.js` içindeki `/studio/*` uçları + `n8n-ops.js`'teki `Studio Komut` aracı (4 workflow'a ekli).
