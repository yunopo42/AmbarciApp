import { z } from 'zod';

// Strict araç kullanımında (strict: true) JSON Schema'nın bir alt kümesi desteklenir. Uzunluk ve sayı sınırları,
// desen (pattern) ve varsayılan değer desteklenmez; şemada kalırlarsa istek reddedilebilir. Bunlar modele gönderilen
// şemadan çıkarılır, kontrolü sunucudaki Zod şeması yapar (aynı şema, tam kurallarıyla).
const UNSUPPORTED_KEYS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'pattern',
  'minItems',
  'maxItems',
  'default',
]);

type JsonObject = Record<string, unknown>;

export interface StrictSchemaOptions {
  /**
   * Her nesnede zorunlu alanlar önce, isteğe bağlılar sonra (#86, chat-v3). Strict modda model nesneyi şemadaki alan
   * sırasıyla yazar. Öneri araçlarında isteğe bağlı `note` ve `party_id`, zorunlu `lines`'tan önce geliyordu; model
   * kalemleri yazınca nesne kapanıyor ve bu alanlar hiç gönderilemiyordu (değerlendirmede fire notu 0/4, Sonnet dahil).
   * Doğrulama değişmez: alanların anlamı aynı, yalnızca modele giden sıra değişir.
   */
  requiredFirst?: boolean;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Zorunlu alanlar kendi sıralarıyla önce, isteğe bağlılar kendi sıralarıyla sonra. */
function requiredFirstOrder(properties: JsonObject, required: unknown): JsonObject {
  const requiredKeys = new Set(Array.isArray(required) ? required.filter((key): key is string => typeof key === 'string') : []);
  const entries = Object.entries(properties);
  return Object.fromEntries([...entries.filter(([key]) => requiredKeys.has(key)), ...entries.filter(([key]) => !requiredKeys.has(key))]);
}

function clean(node: unknown, options: StrictSchemaOptions): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => clean(item, options));
  }
  if (!isObject(node)) {
    return node;
  }
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (!UNSUPPORTED_KEYS.has(key)) {
      result[key] = clean(value, options);
    }
  }
  // Strict modda her nesnede additionalProperties: false ve required bulunur (boş bile olsa).
  if (result.type === 'object') {
    result.additionalProperties = false;
    result.required ??= [];
    if (options.requiredFirst && isObject(result.properties)) {
      result.properties = requiredFirstOrder(result.properties, result.required);
    }
  }
  return result;
}

/** Zod şemasından modele gönderilecek strict JSON şeması (girdi biçimi: isteğe bağlı alanlar required'da değil). */
export function toStrictJsonSchema(schema: z.ZodType, options: StrictSchemaOptions = {}): Record<string, unknown> {
  const cleaned = clean(z.toJSONSchema(schema, { io: 'input' }), options);
  if (!isObject(cleaned)) {
    throw new Error('Araç şeması bir nesne olmalı.');
  }
  return cleaned;
}
