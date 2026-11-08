import { describe, expect, it } from 'vitest';

import { splitBoldText } from '../src/index.js';

// Asistan cevabındaki kalın yazı (#73): mobil iç içe AppText, web <strong> ile gösterir.

describe('splitBoldText', () => {
  it('işaretsiz metin tek düz parça; boş metin boş liste', () => {
    expect(splitBoldText('Merkez Depo’da 180 adet var.')).toEqual([{ text: 'Merkez Depo’da 180 adet var.', bold: false }]);
    expect(splitBoldText('')).toEqual([]);
  });

  it('tek kalın parça', () => {
    expect(splitBoldText('Merkez Depo’da **180 adet** var.')).toEqual([
      { text: 'Merkez Depo’da ', bold: false },
      { text: '180 adet', bold: true },
      { text: ' var.', bold: false },
    ]);
  });

  it('birden çok kalın parça, metnin başında ve sonunda', () => {
    expect(splitBoldText('**Topraklı priz:** toplam **240 adet**')).toEqual([
      { text: 'Topraklı priz:', bold: true },
      { text: ' toplam ', bold: false },
      { text: '240 adet', bold: true },
    ]);
  });

  it('satır sonları ve liste satırları korunur', () => {
    expect(splitBoldText('Depolar:\n- **Merkez Depo**: 180\n- **Ostim Depo**: 60')).toEqual([
      { text: 'Depolar:\n- ', bold: false },
      { text: 'Merkez Depo', bold: true },
      { text: ': 180\n- ', bold: false },
      { text: 'Ostim Depo', bold: true },
      { text: ': 60', bold: false },
    ]);
  });

  it('kapanmamış işaret düz kalır', () => {
    expect(splitBoldText('Stok **180 adet')).toEqual([{ text: 'Stok **180 adet', bold: false }]);
    expect(splitBoldText('**Merkez** ve **Ostim')).toEqual([
      { text: 'Merkez', bold: true },
      { text: ' ve **Ostim', bold: false },
    ]);
  });

  it('içi boş işaret düz kalır, sonraki kalın parça bozulmaz', () => {
    expect(splitBoldText('****')).toEqual([{ text: '****', bold: false }]);
    expect(splitBoldText('a ** ** b')).toEqual([{ text: 'a ** ** b', bold: false }]);
    expect(splitBoldText('**** sonra **kalın**')).toEqual([
      { text: '**** sonra ', bold: false },
      { text: 'kalın', bold: true },
    ]);
  });

  it('tek yıldız ve italik işareti olduğu gibi kalır', () => {
    expect(splitBoldText('5 * 3 ve *eğik* yazı')).toEqual([{ text: '5 * 3 ve *eğik* yazı', bold: false }]);
  });

  it('Türkçe harfler ve noktalama bozulmaz', () => {
    expect(splitBoldText('**Işık, şalter, çığ, öğün, ÜÇLÜ PRİZ** kritik seviyenin altında.')).toEqual([
      { text: 'Işık, şalter, çığ, öğün, ÜÇLÜ PRİZ', bold: true },
      { text: ' kritik seviyenin altında.', bold: false },
    ]);
  });

  it('akış sürerken: yarım gelen işaret önce düz, kapanınca kalın görünür', () => {
    // Cevap parça parça geldikçe ekrandaki metin büyür; her hâl ayrı ayrı bölünür.
    const states = ['Merkez Depo’da *', 'Merkez Depo’da **18', 'Merkez Depo’da **180 adet*', 'Merkez Depo’da **180 adet**'];
    expect(states.map((state) => splitBoldText(state))).toEqual([
      [{ text: 'Merkez Depo’da *', bold: false }],
      [{ text: 'Merkez Depo’da **18', bold: false }],
      [{ text: 'Merkez Depo’da **180 adet*', bold: false }],
      [
        { text: 'Merkez Depo’da ', bold: false },
        { text: '180 adet', bold: true },
      ],
    ]);
  });

  it('parçaların birleşimi işaretler dışında metnin kendisidir', () => {
    const text = 'Toplam **240 adet**; Merkez **180**, Ostim **60**.';
    expect(
      splitBoldText(text)
        .map((segment) => segment.text)
        .join(''),
    ).toBe(text.replaceAll('**', ''));
  });
});
