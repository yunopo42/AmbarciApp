# Haftalık rapor şablonu

Dosya adı: `docs/raporlar/hafta-XX.md` (XX iki haneli: 01, 02 …). Sunuma uygun, sade bir dil kullan; abartılı ifade ve doldurma cümle yazma. Yapılmamış işi yapılmış gibi, ölçülmemiş sonucu rakamla yazma.

---

```markdown
# Ambarcı — N. Hafta Raporu: <haftanın konusu>

| | |
| --- | --- |
| Öğrenci | Yunus Emre ATMAZ |
| Öğrenci no | 221450018 |
| Danışman | Ali Osman Çıbıkdiken |
| Ders | Senior Design Project |
| Hafta | N. hafta (<başlangıç>–<bitiş> 2026) |
| Proje | Ambarcı — Yapay Zekâ Destekli Saha Stok Asistanı |

## 1. Özet

Haftanın sonucunu 2–3 cümlede yaz: ne hedeflendi, ne tamamlandı, hafta kapısı geçildi mi.

## 2. Bu hafta yapılanlar

| İş | Durum | Not |
| --- | --- | --- |
| … | Tamamlandı / Kısmen / Ertelendi | … |

## 3. Teknik açıklama

Her önemli iş için üç kısa paragraf:
- **Ne yapıldı:** bileşen, tablo, uç nokta veya ekran.
- **Neden önemli:** mimarideki yeri, hangi riski çözdüğü.
- **Ne öğrenildi:** yeni kavram, karşılaşılan tuzak.

## 4. Görseller

Ekran görüntüsü, diyagram veya ölçüm tablosu. Her görselin altına bir cümlelik açıklama.

## 5. Tamamlanan görevler

- [x] <görev> — #<issue-no>, <commit kısa hash>
- [ ] <yetişmeyen görev> — ertelendi, nedeni: …

## 6. Karşılaşılan sorunlar ve çözümler

| Sorun | Çözüm / durum |
| --- | --- |
| … | … |

## 7. Sonraki hafta planı

Bir sonraki haftanın hedefi ve kapısı (8 haftalık plandan), 3–6 maddelik görev listesi.

## 8. Kaynaklar

- [Başlık](bağlantı)
```

---

## Doldurma kuralları

- "Tamamlanan görevler" listesini `git log --since` ve kapanan issue'lardan çıkar; tahmin etme.
- Ölçüm (doğruluk, süre, maliyet) varsa model adı, prompt sürümü ve örnek sayısını yaz.
- Kapsam dışı istenen ve yapılmayan işleri "Sonraki hafta planı"nda değil, `docs/yol-haritasi.md` notunda an.
- Hafta sonunda kullanıcıya `hafta-N` etiketini hatırlat; etiketi kendin atma.
