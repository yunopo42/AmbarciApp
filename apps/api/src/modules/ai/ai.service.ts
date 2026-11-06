import type { Database } from '@ambarci/db';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { ApiException } from '../../common/api-exception.js';
import { DATABASE } from '../../database/database.module.js';
import { AI_CONFIG } from './ai.config.js';
import type { AiConfig } from './ai.config.js';
import { AIProvider, AiProviderError } from './ai-provider.js';
import type { AiProviderErrorCode, AiTurnRequest, AiTurnResult, AiUsage } from './ai-provider.js';
import { AiRunsRepository } from './ai-runs.repository.js';
import { pricesFor } from './pricing.js';

/** Bir model çağrısının kime ve hangi mesaja ait olduğu. Şirket ve kullanıcı oturumdan gelir, modelden asla. */
export interface AiCallContext {
  organizationId: string;
  userId: string;
  /** Çağrıyı başlatan kullanıcı mesajı (messages tablosunda önceden yazılmış olmalı). */
  messageId: string | null;
  /** Aynı mesajın cevabındaki kaçıncı çağrı (1'den başlar). */
  roundNo: number;
  promptVersion: string;
  /**
   * Mesajın son izinli çağrısı (araç turu sınırı doldu). Model yine araç isterse sınır aşılmıştır: çağrı
   * AGENT_TOOL_LIMIT koduyla kaydedilir ve hata fırlatılır (mimari değişmez 10).
   */
  lastRound?: boolean;
}

// Sağlayıcı hatalarının kullanıcıya gösterilen karşılığı. Teknik ayrıntı yalnızca loga yazılır.
const PROVIDER_ERRORS: Record<AiProviderErrorCode, { status: HttpStatus; message: string }> = {
  AI_NOT_CONFIGURED: { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'Asistan şu anda kullanılamıyor.' },
  AI_AUTH_FAILED: { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'Asistan şu anda kullanılamıyor.' },
  AI_RATE_LIMITED: { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'Asistan şu anda yoğun; biraz sonra tekrar deneyin.' },
  AI_OVERLOADED: { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'Asistan şu anda yoğun; biraz sonra tekrar deneyin.' },
  AI_UNAVAILABLE: { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'Asistana şu anda ulaşılamıyor; biraz sonra tekrar deneyin.' },
  AI_REQUEST_REJECTED: { status: HttpStatus.BAD_GATEWAY, message: 'Asistan isteği işleyemedi.' },
  AI_ABORTED: { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'İstek iptal edildi.' },
};

const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

/**
 * Asistanın modeli çağırdığı tek yer: çağrıyı yapar, her çağrıyı (başarısız olanlar dahil) ai_runs'a yazar, modelin
 * reddini ve yarım kalan cevabı Türkçe hataya çevirir, günlük token bütçesini denetler (mimari değişmez 10).
 * Araç turu döngüsü assistant modülündedir.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AIProvider) private readonly provider: AIProvider,
    @Inject(AiRunsRepository) private readonly runs: AiRunsRepository,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
  ) {}

  /**
   * Kullanıcının ve şirketin bugünkü token kullanımı sınırın altında mı? Asistan bunu her kullanıcı mesajının başında
   * bir kez çağırır, her araç turunda değil: bir cevabın araç turlarının ortasında kesilmemesi için. Sınır en fazla bir
   * cevabın çağrıları kadar (5 araç turu + son cevap) aşılabilir.
   */
  async assertWithinBudget(organizationId: string, userId: string): Promise<void> {
    const used = await this.runs.dailyTokenUsage(this.db, organizationId, userId);
    // Önce şirket: şirketin sınırı dolduysa kullanıcıya kendi sınırı dolmuş gibi görünmesin.
    if (used.organization >= this.config.dailyTokenLimitPerOrganization) {
      throw new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'AI_BUDGET_EXCEEDED',
        'Şirketinizin bugünkü asistan kullanım sınırı doldu; yarın tekrar deneyebilirsiniz.',
        { scope: 'organization', limit: this.config.dailyTokenLimitPerOrganization, used: used.organization },
      );
    }
    if (used.user >= this.config.dailyTokenLimitPerUser) {
      throw new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'AI_BUDGET_EXCEEDED',
        'Bugünkü asistan kullanım sınırınıza ulaştınız; yarın tekrar deneyebilirsiniz.',
        { scope: 'user', limit: this.config.dailyTokenLimitPerUser, used: used.user },
      );
    }
  }

  /**
   * Süren bir sohbetin başladığı prompt sürümü: sohbetin kullanıcı mesajlarına bağlı ilk model çağrısının sürümü.
   * Sohbetin ortasında sistem promptu değişirse geri gönderilen düşünme blokları geçersiz olur (ADR-001); sohbet bu
   * yüzden başladığı sürümle devam eder. Henüz model çağrısı yoksa null (güncel sürüm kullanılır).
   */
  conversationPromptVersion(organizationId: string, userMessageIds: string[]): Promise<string | null> {
    return this.runs.firstPromptVersion(this.db, organizationId, userMessageIds);
  }

  /**
   * Modeli bir kez çağırır. Başarılı ya da başarısız her çağrı ai_runs'a yazılır. Model reddederse (refusal) ya da
   * araç çağrısı yazarken çıktı sınırına takılırsa çağrı yine kaydedilir, sonra hata fırlatılır; reddedilen ya da
   * yarım içerik geçmişe eklenmemelidir.
   */
  async createTurn(callContext: AiCallContext, request: AiTurnRequest): Promise<AiTurnResult> {
    const { lastRound = false, ...context } = callContext;
    let result: AiTurnResult;
    try {
      result = await this.provider.createTurn(request);
    } catch (error) {
      if (!(error instanceof AiProviderError)) {
        throw error;
      }
      this.logger.warn(`${error.code}: ${error.message}`);
      // Anahtar tanımlı değilse istek gönderilmedi; kaydedilecek bir çağrı yok.
      if (error.code !== 'AI_NOT_CONFIGURED') {
        await this.record(context, {
          model: this.provider.model,
          toolCalls: [],
          usage: NO_USAGE,
          durationMs: error.durationMs,
          firstTokenMs: null,
          stopReason: null,
          errorCode: error.code,
        });
      }
      const mapped = PROVIDER_ERRORS[error.code];
      throw new ApiException(mapped.status, error.code, mapped.message);
    }

    const toolLimitReached = lastRound && result.toolCalls.length > 0;
    await this.record(context, {
      model: result.model,
      toolCalls: result.toolCalls.map((call) => call.name),
      usage: result.usage,
      durationMs: result.durationMs,
      firstTokenMs: result.firstTokenMs,
      stopReason: result.stopReason,
      errorCode: toolLimitReached ? 'AGENT_TOOL_LIMIT' : null,
    });

    if (result.stopReason === 'refusal') {
      // Haiku 5.5'te sunucu tarafı yedek model yok (ADR-001); kullanıcıya sorusunu değiştirmesi söylenir.
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'AI_REFUSED',
        'Asistan bu isteğe cevap veremedi. Sorunuzu stokla ilgili ve farklı bir biçimde sorabilirsiniz.',
      );
    }
    if (result.stopReason === 'max_tokens' && result.toolCalls.length > 0) {
      // Yarım kalan araç girdisi geçerli görünse bile çalıştırılmaz.
      throw new ApiException(HttpStatus.BAD_GATEWAY, 'AI_RESPONSE_TRUNCATED', 'Asistanın cevabı yarım kaldı; lütfen tekrar deneyin.');
    }
    if (toolLimitReached) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'AGENT_TOOL_LIMIT',
        'Asistan bu soruyu araç sınırı içinde cevaplayamadı. Soruyu tek bir ürün için ve daha kısa sorabilirsiniz.',
      );
    }
    return result;
  }

  private async record(
    context: Omit<AiCallContext, 'lastRound'>,
    run: {
      model: string;
      toolCalls: string[];
      usage: AiUsage;
      durationMs: number;
      firstTokenMs: number | null;
      stopReason: string | null;
      errorCode: string | null;
    },
  ): Promise<void> {
    await this.runs.insert(this.db, {
      ...context,
      ...run,
      effort: this.provider.effort,
      // Fiyat, yapılandırılan modele göre (API'nin bildirdiği adla değil); model açılışta fiyat tablosunda doğrulandı.
      prices: pricesFor(this.provider.model, run.usage),
    });
  }
}
