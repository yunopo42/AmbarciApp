import type { OrganizationRole } from '@ambarci/shared';
import { Logger } from '@nestjs/common';
import type { z } from 'zod';

import { ApiException } from '../../../common/api-exception.js';
import type { AiToolDefinition } from '../../ai/ai-provider.js';
import type { OrganizationContext } from '../../organizations/organization-context.js';
import { toStrictJsonSchema } from './strict-json-schema.js';

/**
 * Aracın çalıştığı oturum: şirket, rol ve kullanıcı. API'nin guard'ları doğrulamıştır; model girdisinden asla
 * gelmez (mimari değişmez 5).
 */
export interface ToolContext {
  organization: OrganizationContext;
  userId: string;
}

/**
 * read: yalnızca okur. propose: onay bekleyen bir işlem önerisi açar (5. hafta); stok tablolarına yazmaz. Stoğu
 * değiştiren ya da onaylayan araç sınıfı bilerek yoktur (mimari değişmez 1 ve 2).
 */
export type ToolClass = 'read' | 'propose';

/** Bir aracın tanımı. Yeni araç yalnızca assistant/tools/ altında, defineTool ile eklenir. */
export interface ToolSpec<TInput> {
  name: string;
  /** Modelin aracı ne zaman kullanacağını anlattığı açıklama (Türkçe). */
  description: string;
  /** Araç çalışırken kullanıcıya gösterilen durum (ör. "Ürün aranıyor"). */
  statusLabel: string;
  toolClass: ToolClass;
  /** Yetki kuralı: aracı çağırabilecek roller. Depo bazında yetki aracın içinde, okuma servislerinde uygulanır. */
  allowedRoles: readonly OrganizationRole[];
  /** Girdi şeması (packages/shared). Modele bundan üretilen strict JSON şeması gider. */
  input: z.ZodType<TInput>;
  /** Aracın sonucu JSON'a çevrilip modele verilir. Hata için ApiException fırlatır (Türkçe mesaj modele gider). */
  run(input: TInput, context: ToolContext): Promise<unknown>;
}

/** Kayıt defterindeki araç: girdi tipi içeride kalır, dışarıya ham girdi alan tek bir çağrı açılır. */
export interface RegisteredTool {
  readonly name: string;
  readonly description: string;
  readonly statusLabel: string;
  readonly toolClass: ToolClass;
  readonly allowedRoles: readonly OrganizationRole[];
  readonly inputSchema: Record<string, unknown>;
  /** Girdi şemaya uymuyorsa Türkçe hata listesi, uyuyorsa aracın sonucu. */
  invoke(rawInput: unknown, context: ToolContext): Promise<{ ok: true; value: unknown } | { ok: false; issues: string[] }>;
}

export function defineTool<TInput>(spec: ToolSpec<TInput>): RegisteredTool {
  return {
    name: spec.name,
    description: spec.description,
    statusLabel: spec.statusLabel,
    toolClass: spec.toolClass,
    allowedRoles: spec.allowedRoles,
    inputSchema: toStrictJsonSchema(spec.input),
    async invoke(rawInput, context) {
      const parsed = spec.input.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          issues: parsed.error.issues.map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message)),
        };
      }
      return { ok: true, value: await spec.run(parsed.data, context) };
    },
  };
}

/** Aracın modele dönen sonucu: tool_result bloğunun içeriği. */
export interface ToolOutcome {
  content: string;
  isError: boolean;
}

/**
 * Asistanın araç kayıt defteri. Model yalnızca buradaki araçları görür ve çağırabilir. Bilinmeyen araç, yetkisiz rol,
 * şemaya uymayan girdi ve aracın hatası modele hata sonucu (is_error) olarak döner; model buna göre soru sorar ya da
 * başka bir yol dener. Konuşma kesilmez.
 */
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools: ReadonlyMap<string, RegisteredTool>;

  constructor(tools: RegisteredTool[]) {
    const byName = new Map<string, RegisteredTool>();
    for (const tool of tools) {
      // Stoğu değiştiren ya da onaylayan araç eklenemez (mimari değişmez 2).
      if (/^(confirm|apply)_/.test(tool.name)) {
        throw new Error(`${tool.name}: asistana onaylayan ya da stok yazan araç eklenemez.`);
      }
      if (byName.has(tool.name)) {
        throw new Error(`${tool.name}: aynı adla iki araç tanımlandı.`);
      }
      byName.set(tool.name, tool);
    }
    this.tools = byName;
  }

  /** Modele gönderilen araç tanımları. Sıra sabittir: değişirse önbellek ve düşünme blokları geçersiz olur. */
  definitions(): AiToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  statusLabel(name: string): string {
    return this.tools.get(name)?.statusLabel ?? 'Araç çalışıyor';
  }

  async execute(name: string, rawInput: unknown, context: ToolContext): Promise<ToolOutcome> {
    const tool = this.tools.get(name);
    if (!tool) {
      return failure(`Bilinmeyen araç: ${name}. Yalnızca tanımlı araçları kullan.`);
    }
    if (!tool.allowedRoles.includes(context.organization.role)) {
      return failure('Kullanıcının bu aracı kullanma yetkisi yok.');
    }
    try {
      const result = await tool.invoke(rawInput, context);
      if (!result.ok) {
        return failure(`Girdi geçersiz: ${result.issues.join('; ')}`);
      }
      return { content: JSON.stringify(result.value), isError: false };
    } catch (error) {
      if (error instanceof ApiException) {
        // Okuma servislerinin Türkçe hatası (ör. "Ürün bulunamadı."); başka şirketin kaydı da bulunamadı görünür.
        return failure(error.message);
      }
      // Beklenmeyen hata: ayrıntı yalnızca loga yazılır, modele genel bir mesaj gider.
      this.logger.error(`${name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      return failure('Araç çalışırken beklenmeyen bir hata oluştu.');
    }
  }
}

function failure(message: string): ToolOutcome {
  return { content: message, isError: true };
}
