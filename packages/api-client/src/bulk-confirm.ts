import { describeApiError } from './errors.js';
import type { ApiFailure } from './errors.js';
import { confirmKeyFor } from './operation-card.js';
import type { CardConfirmKey } from './operation-card.js';

// Onay kuyruğunda toplu onay (#87). Toplu onay için ayrı bir uç nokta yoktur: seçilen her işlem kendi onay isteğiyle
// (POST /v1/operations/{id}/confirm) ve kendi Idempotency-Key'iyle gider. Her istek kendi transaction'ında çalışır;
// biri reddedilirse (yetersiz stok, süre, sürüm) ötekiler etkilenmez. Bu dosya React'ten bağımsızdır: hangi işlemin
// hangi anahtarla gideceği ve sonucun nasıl gösterileceği burada, istek ve ekran uygulamadadır.

/** Onaylanacak işlem ve kullanıcının listede gördüğü sürüm. */
export interface BulkConfirmTarget {
  id: string;
  version: number;
}

/** Bir işlemin toplu onaydaki sonucu. */
export type BulkConfirmResult =
  | 'APPLIED'
  | 'INSUFFICIENT_STOCK'
  | 'EXPIRED'
  | 'VERSION_CHANGED'
  | 'ALREADY_APPLIED'
  | 'NOT_PENDING'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'FAILED';

/** Rozet rengi: uygulandı (yeşil), hâlâ onay bekliyor (sarı), reddedildi (kırmızı), sonuçlanmış (gri). */
export type BulkConfirmTone = 'applied' | 'pending' | 'critical' | 'muted';

export interface BulkConfirmOutcome {
  operationId: string;
  result: BulkConfirmResult;
  /** Rozetin metni (renk tek başına anlam taşımaz). */
  label: string;
  tone: BulkConfirmTone;
  /** Satırın altındaki açıklama. */
  message: string;
  /** Aynı anahtarla tekrar denemek anlamlı ve güvenli mi (ağ hatası, beklenmeyen hata). */
  retryable: boolean;
}

/** Sonuçların özet sırası: önce uygulananlar, sonra kullanıcının bakması gerekenler. */
const RESULT_ORDER: BulkConfirmResult[] = [
  'APPLIED',
  'INSUFFICIENT_STOCK',
  'EXPIRED',
  'VERSION_CHANGED',
  'ALREADY_APPLIED',
  'NOT_PENDING',
  'FORBIDDEN',
  'NOT_FOUND',
  'NETWORK',
  'FAILED',
];

const FORBIDDEN_CODES = new Set(['WAREHOUSE_FORBIDDEN', 'OPERATION_FORBIDDEN', 'ROLE_FORBIDDEN', 'ORGANIZATION_FORBIDDEN']);

/**
 * Onay isteğinin cevabından satırın sonucu. `failure` null ise istek başarılıdır (stok değişti). API'nin hata kodu
 * anlamı belirler; mesaj, kullanıcının ne yapacağını söyler.
 */
export function bulkConfirmOutcome(operationId: string, failure: ApiFailure | null): BulkConfirmOutcome {
  const outcome = (
    result: BulkConfirmResult,
    label: string,
    tone: BulkConfirmTone,
    message: string,
    retryable = false,
  ): BulkConfirmOutcome => ({ operationId, result, label, tone, message, retryable });

  if (!failure) {
    return outcome('APPLIED', 'Uygulandı', 'applied', 'İşlem onaylandı; stok güncellendi.');
  }
  switch (failure.code) {
    case 'INSUFFICIENT_STOCK':
      return outcome(
        'INSUFFICIENT_STOCK',
        'Yetersiz stok',
        'critical',
        'Stok yetmediği için uygulanmadı; hiçbir kalem yazılmadı. Özetini açıp kalemleri kontrol edin.',
      );
    case 'OPERATION_EXPIRED':
      return outcome('EXPIRED', 'Süresi doldu', 'muted', 'Önerinin onay süresi doldu; stok değişmedi.');
    case 'OPERATION_VERSION_MISMATCH':
      return outcome(
        'VERSION_CHANGED',
        'Sürüm değişti',
        'pending',
        'İşlem liste açıldıktan sonra değişti; özetini açıp güncel hâlini onaylayın.',
      );
    case 'OPERATION_ALREADY_APPLIED':
      return outcome('ALREADY_APPLIED', 'Zaten onaylanmış', 'muted', 'İşlem başka bir ekrandan onaylanmış; stok bir kez değişti.');
    case 'OPERATION_NOT_PENDING':
      return outcome('NOT_PENDING', 'Onay beklemiyor', 'muted', 'İşlem bu arada iptal edilmiş ya da sonuçlanmış; stok değişmedi.');
    case 'OPERATION_NOT_FOUND':
      return outcome('NOT_FOUND', 'Bulunamadı', 'muted', 'İşlem bulunamadı.');
    case 'NETWORK_ERROR':
      return outcome('NETWORK', 'Gönderilemedi', 'critical', `${failure.message} Tekrar denersen stok iki kez değişmez.`, true);
    default:
      if (FORBIDDEN_CODES.has(failure.code)) {
        return outcome('FORBIDDEN', 'Yetki yok', 'critical', failure.message);
      }
      return outcome('FAILED', 'Uygulanamadı', 'critical', failure.message, failure.code === 'UNEXPECTED');
  }
}

export interface BulkConfirmOptions {
  /**
   * Tek bir onay isteği: POST /v1/operations/{id}/confirm, gövdede sürüm, başlıkta anahtar. Hata fırlatırsa (API'nin
   * hata gövdesi ya da ağ hatası) o işlemin onayı başarısız sayılır.
   */
  confirm: (target: BulkConfirmTarget, idempotencyKey: string) => Promise<unknown>;
  /**
   * İşlem kimliğine göre son kullanılan anahtar. Çağıran sayfa boyunca saklar: aynı işlem aynı sürümle yeniden
   * gönderilirse (ağ hatasından sonra tekrar) aynı anahtar gider ve stok bir kez değişir; sürüm değişmişse yeni anahtar.
   */
  keys: Map<string, CardConfirmKey>;
  makeKey: () => string;
  /** Her işlemin sonucu geldiğinde (ilerleme göstergesi için). */
  onProgress?: (outcome: BulkConfirmOutcome, done: number, total: number) => void;
}

/**
 * Seçilen işlemleri sırayla, her birini ayrı istekle onaylar ve sonuçları aynı sırayla döner. Sırayla gönderilir:
 * aynı ürünü kullanan iki işlem stok satırında birbirini beklemesin, yetersiz stokta hangisinin önce uygulandığı belli
 * olsun. Bir isteğin hatası ötekileri durdurmaz. Aynı işlem listede iki kez varsa bir kez gönderilir.
 */
export async function confirmEach(targets: BulkConfirmTarget[], options: BulkConfirmOptions): Promise<BulkConfirmOutcome[]> {
  const unique = targets.filter((target, index) => targets.findIndex((other) => other.id === target.id) === index);
  const outcomes: BulkConfirmOutcome[] = [];
  for (const target of unique) {
    const key = confirmKeyFor(options.keys.get(target.id) ?? null, target.version, options.makeKey);
    options.keys.set(target.id, key);
    let failure: ApiFailure | null = null;
    try {
      await options.confirm(target, key.key);
    } catch (reason) {
      failure = describeApiError(reason);
    }
    const outcome = bulkConfirmOutcome(target.id, failure);
    outcomes.push(outcome);
    options.onProgress?.(outcome, outcomes.length, unique.length);
  }
  return outcomes;
}

/** Sonuçların tek satırlık özeti: "4 işlem gönderildi: 2 uygulandı, 1 yetersiz stok, 1 sürüm değişti." */
export function bulkConfirmSummary(outcomes: BulkConfirmOutcome[]): string {
  const counts = new Map<BulkConfirmResult, { label: string; count: number }>();
  for (const outcome of outcomes) {
    const entry = counts.get(outcome.result);
    counts.set(outcome.result, { label: outcome.label, count: (entry?.count ?? 0) + 1 });
  }
  const parts = RESULT_ORDER.flatMap((result) => {
    const entry = counts.get(result);
    return entry ? [`${entry.count} ${entry.label.toLocaleLowerCase('tr-TR')}`] : [];
  });
  return `${outcomes.length} işlem gönderildi: ${parts.join(', ')}.`;
}
