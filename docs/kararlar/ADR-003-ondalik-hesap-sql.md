# ADR-003: Ondalık hesaplar PostgreSQL'de (`NUMERIC`), ondalık kütüphanesi eklenmez

- **Durum:** Kabul edildi (22 Ekim 2026)
- **İlgili iş:** #33 (ayrıca #37, #38, #39)
- **Uygulama:** birim çevrimi `apps/api/src/modules/catalog/catalog.repository.ts` (`convertToBaseUnits`), stok ve maliyet `apps/api/src/modules/inventory/stock-ledger.repository.ts` (`increase`, `decrease`, `recordCount`)

## Bağlam

Mimari değişmez 4: miktar ve parayla JS `number` (kayan nokta) üzerinden aritmetik yapılmaz; ondalık kütüphanesi ya da SQL kullanılır. Kayan nokta ondalık değerleri tam tutamaz (`0.1 + 0.2 = 0.30000000000000004`) ve hata her hareketle birikir.

3. haftada şu hesaplar gerekiyor:

| Hesap | Formül | Sonucun tipi |
| --- | --- | --- |
| Birim çevrimi | girilen miktar × katsayı (3 koli × 12 = 36 adet) | `NUMERIC(14,3)` |
| Hareketli ortalama maliyet (giriş) | (stok × ortalama + giren × birim maliyet) ÷ (stok + giren) | `NUMERIC(14,4)` |
| Stok yeterliliği | stok − çıkan ≥ 0 | karşılaştırma |
| Sayım farkı | sayılan − sistemdeki | `NUMERIC(14,3)` |
| Onay özeti | önce → sonra | `NUMERIC(14,3)` |

Veritabanı bu değerleri zaten `NUMERIC` tutuyor ve Drizzle onları JS'e metin olarak veriyor. Hesapların hepsi onay transaction'ında, stok satırları `FOR UPDATE` ile kilitliyken yapılmalı.

## Seçenekler

1. **SQL'de `NUMERIC` aritmetiği.** Hesap doğrudan `UPDATE inventory SET quantity = …, average_cost = …` ifadesinde yapılır.
   - Artı: yeni bağımlılık yok. Sonuç, kolonla aynı hassasiyette ve PostgreSQL'in tek yuvarlama kuralıyla yazılır. Hesap, kilitli satırın o anki değeriyle yapılır; "oku → uygulamada hesapla → yaz" arasında başka bir işlemin değeri değiştirmesi (kayıp güncelleme) mümkün değildir.
   - Eksi: formül SQL içinde durur. Testi veritabanı ister; CI'da veritabanı olmadığı için `pnpm db:test` ile çalışır.
2. **`decimal.js` 10.6** (MIT). Keyfi hassasiyet, kapsamlı API.
   - Eksi: değerleri uygulamaya çekip hesaplayıp geri yazmak gerekir. Yuvarlama kuralı PostgreSQL'inkiyle elle eşleştirilmeli. Aynı hesap için iki kaynak (SQL ve JS) oluşur.
3. **`big.js` 7.0** (MIT, küçük). Eksileri 2. seçenekle aynı.
4. **Tamsayıya ölçekleme** (miktar × 1000, `BigInt`). Bağımlılık yok, ama bölme ve yuvarlama elle yazılır; ortalama maliyet hesabında hataya açık.

## Karar

Stoğu ve maliyeti etkileyen her hesap SQL'de `NUMERIC` ile yapılır. Ondalık kütüphanesi eklenmez.

- **Taşıma:** API ve istemciler miktar ve maliyeti metin olarak taşır (`"12.500"`). Ortak Zod şeması yalnızca biçimi doğrular (pozitif; en fazla 11 tam ve 3 ondalık hane, maliyette 4); metin sayıya çevrilmez.
- **Birim çevrimi:** `round(miktar * katsayı, 3)`, yalnızca onay transaction'ında, tek noktada.
- **Hareketli ortalama maliyet:**
  - Giriş: `round((stok * ortalama + giren * birim_maliyet) / (stok + giren), 4)`. Giren miktar her zaman pozitif olduğu için payda sıfır olamaz.
  - Birim maliyeti girilmemiş giriş, mevcut ortalamayla girer; ortalama değişmez. (Sıfır maliyet saymak ortalamayı yanlış düşürürdü.)
  - Çıkış, fire, sayım noksanı ve transfer çıkışı: ortalama değişmez; hareket o anki ortalamayla kaydedilir.
  - Transfer girişi: kaynak deponun ortalamasıyla, giriş formülüyle hesaplanır.
  - Sayım fazlası: mevcut ortalamayla girer; ortalama değişmez.
- **Yuvarlama:** PostgreSQL `round` yarımları sıfırdan uzağa yuvarlar (`round(0.00005, 4) = 0.0001`). Tek kural, tek yer.
- **Önizleme:** onay ekranındaki "önce → sonra" değerleri de API'de SQL ile hesaplanır; istemci yalnızca gösterir.
- **Gösterim:** web ve mobil, sunucudan gelen metni biçimlendirir (ondalık ayırıcı virgül, binlik ayırıcı nokta); sayıya çevirmez.

## Sonuçlar

- Yeni bağımlılık yok.
- Maliyet ve çevrim testleri gerçek veritabanında (`pnpm db:test`) çalışır; CI bunları çalıştırmaz. Bu bilinen bir kısıttır; CI'a PostgreSQL servisi eklemek ayrı bir iştir (Supabase'e özgü `auth` şeması nedeniyle basit değil).
- Ortalama maliyet her harekette 4 ondalığa yuvarlandığı için çok sayıda hareketten sonra kuruşun altında sapma olabilir. Bu bir yönetim raporudur, resmi defter değildir; VUK uyumu iddia edilmez (`docs/teknik-arastirma.md`).
- İleride istemcide gerçekten hesap gerekirse (örneğin çevrimdışı toplam), `big.js` için yeni bir ADR yazılır.
