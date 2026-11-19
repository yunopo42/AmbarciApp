import { formatDecimal } from '@ambarci/shared';
import type { OperationType } from '@ambarci/shared';

import type { ApiFailure } from './errors.js';
import type { components } from './schema.js';

// Sohbetteki işlem kartı (#76 mobil, #77 web): kartın ne göstereceği ve hangi düğmenin açık olduğu. React'ten
// bağımsızdır; iki uygulama aynı kuralı kullanır. Kart, işlemin güncel hâlini önizleme ucundan okur (#75). Onay
// asistandan geçmez: kart onay ucuna doğrudan gider (mimari değişmez 2). Miktarlar sayıya çevrilmez (ADR-003).

/** GET /v1/operations/{id}/preview. */
export type CardPreview = components['schemas']['OperationPreviewDto'];
type CardPreviewLine = CardPreview['lines'][number];

/** Rozetin rengi: onay bekliyor (sarı), uygulandı (yeşil), sonuçlanmış ya da düşmüş (gri). */
export type CardTone = 'pending' | 'applied' | 'muted';

export interface CardStockChange {
  before: string;
  after: string;
}

export interface CardLine {
  lineNo: number;
  product: string;
  sku: string;
  /** "Miktar" ya da sayımda "Sayılan". */
  quantityLabel: string;
  /** Girilen birim ve ana birim karşılığı: "2 koli (40 adet)"; ana birimdeyse "40 adet". */
  quantity: string;
  /** Depo; transferde "Merkez Depo → Ostim Depo". */
  warehouse: string;
  /** Stoğun önceki ve sonraki hâli (ana birimde); onay bekleyen işlemde. Yetmeyen kalemde yok. */
  stockChange: CardStockChange | null;
  /** Transferde hedef deponun stoğu. */
  targetStockChange: CardStockChange | null;
  /** Stok yetmiyorsa açıklama; sonraki değer eksi gösterilmez, stok hiçbir zaman eksiye düşmez. */
  shortage: string | null;
}

export interface OperationCardView {
  title: string;
  status: { label: string; tone: CardTone };
  party: string | null;
  note: string | null;
  lines: CardLine[];
  /** Onay bekliyor, süresi dolmamış ve bütün kalemlerde stok yetiyor. */
  canConfirm: boolean;
  /** Onay bekliyor ve süresi dolmamış (yetmeyen stokta da iptal edilebilir, düzenlenebilir). */
  canCancel: boolean;
  canEdit: boolean;
  /** Kartın altındaki not. */
  footnote: string | null;
  /** Onay bekleyen önerinin son onay anı (ISO); süresi olmayan işlemde null. */
  expiresAt: string | null;
}

const TITLES: Record<OperationType, string> = {
  STOCK_IN: 'Stok girişi',
  STOCK_OUT: 'Stok çıkışı',
  TRANSFER: 'Transfer',
  COUNT: 'Sayım',
  WASTE: 'Fire',
  OPENING: 'Açılış stoğu',
  REVERSAL: 'Ters kayıt',
};

/** Rozetin metni ve rengi. */
const STATUS: Partial<Record<CardPreview['status'], { label: string; tone: CardTone }>> = {
  PENDING_CONFIRMATION: { label: 'Onay bekliyor', tone: 'pending' },
  APPLIED: { label: 'Uygulandı', tone: 'applied' },
  REVERSED: { label: 'Geri alındı', tone: 'muted' },
  CANCELLED: { label: 'İptal edildi', tone: 'muted' },
  EXPIRED: { label: 'Süresi doldu', tone: 'muted' },
  FAILED: { label: 'Başarısız', tone: 'muted' },
};

function amount(value: string, unit: string): string {
  return `${formatDecimal(value)} ${unit}`;
}

function change(effect: CardPreviewLine['stock'], unit: string): CardStockChange | null {
  return effect ? { before: amount(effect.before, unit), after: amount(effect.after, unit) } : null;
}

function lineOf(type: OperationType, line: CardPreviewLine): CardLine {
  const entered = amount(line.quantity, line.unit ?? line.baseUnit);
  const short = line.stock?.sufficient === false;
  return {
    lineNo: line.lineNo,
    product: line.productName,
    sku: line.sku,
    quantityLabel: type === 'COUNT' ? 'Sayılan' : 'Miktar',
    quantity: line.unit ? `${entered} (${amount(line.baseQuantity, line.baseUnit)})` : entered,
    warehouse: line.targetWarehouse ? `${line.warehouse.name} → ${line.targetWarehouse.name}` : line.warehouse.name,
    stockChange: short ? null : change(line.stock, line.baseUnit),
    targetStockChange: short ? null : change(line.targetStock, line.baseUnit),
    shortage:
      short && line.stock
        ? `Stok yetmiyor: ${amount(line.stock.before, line.baseUnit)} var, ${amount(line.baseQuantity, line.baseUnit)} gerekiyor.`
        : null,
  };
}

/**
 * Kartın görünümü. `now`: cihazın saati; önizleme okunduktan sonra süre dolmuşsa kart düğmeleri kapatır. Asıl kontrol
 * sunucuda, onayda kilit altındadır (#75); cihazın saati kaymışsa onay yine de 409 OPERATION_EXPIRED alabilir.
 */
export function operationCardView(preview: CardPreview, now: Date): OperationCardView {
  const expiredHere = preview.status === 'PENDING_CONFIRMATION' && preview.expiresAt !== null && new Date(preview.expiresAt) <= now;
  const status = expiredHere ? 'EXPIRED' : preview.status;
  const pending = status === 'PENDING_CONFIRMATION';
  const lines = preview.lines.map((line) => lineOf(preview.type, line));
  const shortage = lines.some((line) => line.shortage !== null);

  let footnote: string | null = null;
  if (pending) {
    footnote = shortage ? 'Stok yetmediği için bu öneri onaylanamaz. Miktarı sohbette düzeltebilir ya da iptal edebilirsin.' : 'Onaylamadan stok değişmez.';
  } else if (status === 'EXPIRED') {
    footnote = 'Önerinin süresi doldu; stok değişmedi. Gerekirse asistandan yeni bir öneri iste.';
  } else if (status === 'CANCELLED') {
    footnote = 'Öneri iptal edildi; stok değişmedi.';
  }

  return {
    title: pending ? `${TITLES[preview.type]} önerisi` : TITLES[preview.type],
    status: STATUS[status] ?? { label: 'Sonuçlandı', tone: 'muted' },
    party: preview.partyName,
    note: preview.note,
    lines,
    canConfirm: pending && !shortage,
    canCancel: pending,
    canEdit: pending,
    footnote,
    expiresAt: pending ? preview.expiresAt : null,
  };
}

/** Kartın onay anahtarı ve hangi sürüm için üretildiği. */
export interface CardConfirmKey {
  version: number;
  key: string;
}

/**
 * Onayın Idempotency-Key'i: kartta o sürümün ilk onay denemesinde bir kez üretilir ve aynı sürümün bütün denemeleri
 * (çift dokunma, ağ hatasından sonra tekrar) aynı anahtarla gider; API ikinci isteği tanır ve stok ikinci kez
 * değişmez. Öneri sohbette düzenlenip sürüm değişince yeni anahtar üretilir: aynı anahtar farklı bir içerik için
 * kullanılmasın.
 */
export function confirmKeyFor(current: CardConfirmKey | null, version: number, makeKey: () => string): CardConfirmKey {
  return current && current.version === version ? current : { version, key: makeKey() };
}

/**
 * Onay ya da iptal hatasının kartta gösterilecek hâli. `refresh`: kart önizlemeyi yeniden okumalı (durum ya da stok
 * değişmiş). Ağ hatasında anahtar aynı kalır; tekrar denemek güvenlidir.
 */
export function cardActionFailure(failure: ApiFailure): { message: string; refresh: boolean } {
  switch (failure.code) {
    case 'OPERATION_VERSION_MISMATCH':
      return { message: 'Öneri değişti. Güncel hâlini kontrol edip yeniden onayla.', refresh: true };
    case 'OPERATION_ALREADY_APPLIED':
      return { message: 'Bu öneri başka bir cihazdan onaylanmış; stok bir kez değişti.', refresh: true };
    case 'NETWORK_ERROR':
      return { message: `${failure.message} Tekrar denersen stok iki kez değişmez.`, refresh: false };
    case 'INSUFFICIENT_STOCK':
    case 'OPERATION_EXPIRED':
    case 'OPERATION_NOT_PENDING':
      return { message: failure.message, refresh: true };
    default:
      return { message: failure.message, refresh: false };
  }
}
