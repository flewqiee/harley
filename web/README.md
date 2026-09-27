# Harley Premium — Web Mağaza

Hesap + ödeme + **lisans anahtarı teslimi** için kendi web sunucun. Node 22+ (node:sqlite) gerekir.

## Kurulum (yerel)

```bash
cd web
npm install
copy .env.example .env       # Windows; sonra .env'i düzenle
node server.js
```
Aç: http://localhost:8080

## Ortam değişkenleri (.env)

- `SESSION_SECRET` — rastgele uzun dize (oturum imzası). **Üretimde şart.**
- `ADMIN_TOKEN` — siparişi elle "ödendi" işaretlemek için.
- `PRICE`, `CURRENCY` — fiyat (ör. 299 TRY).
- `HARLEY_LICENSE_KEY_PATH` — **lisans özel anahtarı** (Harley uygulamasındaki açık anahtarla EŞLEŞEN). Özel anahtar: `app/premium/keys/private.pem`. Sunucuda `./secrets/private.pem` olarak tut, **repoya koyma**.

## Akış

1. Kullanıcı `/dashboard` → kayıt/giriş.
2. "Premium Satın Al" → sipariş (pending).
3. Ödeme sağlayıcı entegre olunca `/api/checkout` ödeme sayfasına yönlendirir; dönüşte/callback'te sipariş "paid" olur.
4. `grantLicense()` sunucuda **Ed25519 ile lisans imzalar** → kullanıcının hesabında görünür.
5. Kullanıcı anahtarı **Harley → Ayarlar → Premium'u etkinleştir** ekranına yapıştırır. Doğrulama Harley'de **çevrimdışı** (açık anahtar gömülü).

### MVP (ödeme sağlayıcı henüz yok)
- Sipariş oluşur; admin şu çağrıyla "ödendi" işaretler (ör. Postman/curl):
  ```bash
  curl -X POST http://localhost:8080/api/admin/mark-paid -H "Content-Type: application/json" -d "{\"token\":\"ADMIN_TOKEN\",\"orderId\":1}"
  ```
- Kullanıcı dashboard'u yenileyince lisansını görür.

## Ödeme sağlayıcısı entegrasyonu (Türkiye)
- **iyzico** (Checkout Form / API) veya **PayTR** önerilir. Akış: `/api/checkout` → iyzico'ya istek → alıcı iyzico sayfasına yönlenir → **callback/webhook** → imza doğrula → `markPaid` + `grantLicense`.
- Callback'i `/api/payment/callback` olarak ekle; gelen imzayı **mutlaka doğrula** (sahtecilik önleme).

## Güvenlik kontrol listesi (üretim)
- HTTPS (reverse proxy: Caddy/Nginx) + `NODE_ENV=production` (secure cookie).
- `SESSION_SECRET`, `ADMIN_TOKEN`, özel anahtar → yalnızca sunucu env/secret; **repoda değil**.
- Şifreler `bcrypt` ile hash (12 tur) — hazır.
- Hız sınırı var; üretimde artır + ters proxy seviyesinde de ekle.
- İstemci girdilerini doğrula; ödeme callback imzasını doğrula.
- KVKK: gizlilik politikası + veri saklama/silme.
- (İleri) SMS/e-posta doğrulama, 2FA, admin paneli.

## Yayına alma (örnek)
- **VPS (Türkiye/global):** Node'u kur, `pm2` ile çalıştır, Caddy ile HTTPS + `harleyai.shop` alan adını bağla.
- **Vercel/Netlify:** mümkün ama kalıcı SQLite için kalıcı disk gerekir → VPS daha uygun.

## Not (marka)
"Harley" adı Harley-Davidson ile ilişkilendirilmemiştir; ticari kullanımda marka riskini değerlendir. Uzun vadede özgün bir marka adı önerilir.
