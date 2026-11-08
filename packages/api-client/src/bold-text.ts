// Asistan cevabındaki kalın yazı (**…**). Mobil ve web cevabı düz metin olarak gösterir; model bazı cevaplarda
// Markdown kalın yazı kullandığı için yıldızlar ekranda görünüyordu (4. hafta kapı denemesi). Markdown kütüphanesi
// eklenmedi: yalnızca kalın yazı desteklenir, başka işaret (başlık, liste, italik) olduğu gibi gösterilir.

/** Cevabın bir parçası: düz ya da kalın. */
export interface TextSegment {
  text: string;
  bold: boolean;
}

const MARK = '**';

/**
 * Metni düz ve kalın parçalara ayırır. `**metin**` kalın olur; kapanmamış işaret (akış sürerken cevabın yarısı gelmişse
 * olur) ve içi boş işaret (`****`, `** **`) olduğu gibi düz metin kalır. Satır sonları ve boşluklar korunur; art arda
 * düz parçalar birleştirilir. Boş metin boş liste döner.
 */
export function splitBoldText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let plain = '';
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf(MARK, index);
    if (open === -1) {
      plain += text.slice(index);
      break;
    }
    const close = text.indexOf(MARK, open + MARK.length);
    if (close === -1) {
      // Kapanmamış işaret: arkasında başka işaret yok, kalan metin düz.
      plain += text.slice(index);
      break;
    }
    const inner = text.slice(open + MARK.length, close);
    if (inner.trim() === '') {
      // İçi boş işaret çifti (****, ** **) düz metin kalır. İki işaret birlikte atlanır; kapanış işareti bir sonraki
      // kalın parçanın açılışı sanılmasın.
      plain += text.slice(index, close + MARK.length);
      index = close + MARK.length;
      continue;
    }
    plain += text.slice(index, open);
    if (plain) {
      segments.push({ text: plain, bold: false });
      plain = '';
    }
    segments.push({ text: inner, bold: true });
    index = close + MARK.length;
  }
  if (plain) {
    segments.push({ text: plain, bold: false });
  }
  return segments;
}
