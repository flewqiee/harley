# Harley — Lisanslama Stratejisi

> Bu belge bir özet/rehberdir; hukuki tavsiye değildir. Ticari kararlar için bir avukata danış.

## Özet

- **Topluluk sürümü (bu depo):** **GNU GPLv3 (veya sonrası)**.
- **Telif hakkı sahibi:** Umut Efe Kurucay.
- **Pro/Premium sürümler:** Telif sahibi tarafından **ayrı ticari lisans** altında satılabilir.

## Neden GPLv3?

GPLv3 **güçlü copyleft** lisansıdır:

- Kodu kullanabilir, değiştirebilir, hatta **para karşılığı dağıtabilirsin**.
- **Ama** dağıttığın/değiştirdiğin sürümün **kaynak kodunu** da GPLv3 ile açmak zorundasın.
- Bu yüzden **kimse Harley'i alıp kapalı kaynak bir ürüne çevirip satamaz** (kapalı satış GPL'ye aykırıdır).

GPL "satışı" yasaklamaz; "kapalı satışı" engeller. Pratikte bu, ticari kopyacılığı caydırır.

## Telif sahibi neden Pro satabiliyor?

Telif hakkı **sende** olduğu için, kanunda bir "lisans alıcısı" değilsin; istediğin lisansı
verebilirsin. Buna **çift lisanslama** denir:

- Aynı kodu hem **GPLv3** (topluluk) hem **ticari lisans** (Pro) altında sunabilirsin.
- Pro sürümü **kapalı kaynak** tutabilirsin.

Bunun için:

1. **Telif sahibi tek kişi** (sen) olduğu sürece hiçbir ek şey gerekmez.
2. **Dışarıdan katkı** alırsan, katkıların Pro'da kullanılabilmesi için **CLA**
   (Contributor License Agreement) veya en azından katkıların çift lisanslanmasına izin veren
   bir anlaşma gerekir. Aksi halde o katkıyı kapalı Pro'da kullanamazsın.

### Önerilen CLA metni (kısa)

Her katkı sağlayıcıdan şunu onaylat (PR açıklamasına eklenebilir ya da ayrı dosya):

> Bu katkıyı yaptığım kodu, projenin sahibine (Umut Efe Kurucay) projeyi
> **GPLv3 ve herhangi bir ticari lisans** altında lisanslama hakkı verecek şekilde,
> telif hakkımı koruyarak sunuyorum.

## Pro/Premium sürümü nasıl paketlenir?

- **Topluluk deposu:** GPLv3 kod (bu repo).
- **Pro deposu/modülü:** Ayrı **özel** depo. GPL kodu içerecekse, telif sahibi olarak
  kullanabilirsin; dış katkı varsa CLA şart.
- **Lisans:** Pro için kendi **ticari lisans/EULA** dosyanı oluştur
  (ör. `COMMERCIAL-LICENSE.md`): kullanım hakkı, sınırlar, iade, destek, garanti reddi.
- **Lisans anahtarı:** Pro özellikler lisans anahtarına bağlanabilir (çevrimiçi doğrulama
  veya imzalı offline anahtar). Cracking riski vardır; asıl değeri sunucu tarafında tutmak
  (SaaS) daha güvenlidir.

## Devralınan sürümler

0.11.0 ve öncesi **Apache-2.0** ile yayınlanmış kopyalar, indirildikleri haliyle o lisans
altında kalır (Apache geri alınamaz). GPL, yayınlanan **yeni** sürümler için geçerlidir.

## Yapılacaklar (kontrol listesi)

- [ ] README ve LICENSE tutarlı (GPLv3).
- [ ] `package.json` alanı: `"license": "GPL-3.0-or-later"`.
- [ ] Katkı alırken CLA/DCO uygula.
- [ ] Pro için ayrı özel depo + `COMMERCIAL-LICENSE.md`.
- [ ] (İsteğe bağlı) İmza/marka tescili ile "Harley" adını koru.
