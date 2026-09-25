# 🎮 Oyun Tasarım Dokümanı (şablon)

Bu şablonu doldur; Harley'ye "tasarım dokümanından oyunu kur" de — Harley Studio Komut aracıyla
kodları tek tek oluşturur. Ne kadar detay verirsen sonuç o kadar iyi olur.

## 1. Oyunun özü (1 paragraf)
> Oyuncu ne yapar? Oyunun tek cümlelik özeti.

## 2. Temel döngü (adım adım)
1. ...
2. ...
3. ...

## 3. Sistemler (her sistem için: ne, nasıl, sayılar)
| Sistem | Açıklama | Önemli sayılar/ayarlar |
|---|---|---|
| Envanter | ... | ... |
| Para/Ekonomi | ... | Kazanma: ..., Harcama: ... |
| Progression | ... | ... |
| Kayıt (DataStore) | ... | Hangi veri saklanır: ... |

## 4. Oyun içi öğeler (tablo)
| Öğe | Nadirlik | Değer | Etki |
|---|---|---|---|
| ... | ... | ... | ... |

## 5. Dünya / Bölgeler
- **Bölge 1:** tema, kilit koşulu
- **Bölge 2:** tema, kilit koşulu

## 6. UI / HUD
- Üstte: para, envanter sayacı
- Sağda: butonlar (sat, yükselt...)

## 7. Kazanma / Oyun sonu
- Oyun nasıl biter / sonsuz mu?

## 8. Roblox teknik tercihler
- Oyuncu başına mı yoksa ortak dünya mı?
- RemoteEvents kullanılacak mı? (client-server)
- Oyunpass / geliştirici ürünü var mı?

---

**Harley'ye iş verirken:** "Tasarım dokümanı X. Sistem 3'ü kur: önce YAPI'yı çıkar, sonra
ÇALIŞTIR ile parçaları/scriptleri oluştur, PLAYTEST ile dene, LOK ile hataları oku ve düzelt."
