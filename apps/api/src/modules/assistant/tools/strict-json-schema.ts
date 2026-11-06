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

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(clean);
  }
  if (!isObject(node)) {
    return node;
  }
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (!UNSUPPORTED_KEYS.has(key)) {
      result[key] = clean(value);
    }
  }
  // Strict modda her nesnede additionalProperties: false ve required bulunur (boş bile olsa).
  if (result.type === 'object') {
    result.additionalProperties = false;
    result.required ??= [];
  }
  return result;
}

/** Zod şemasından modele gönderilecek strict JSON şeması (girdi biçimi: isteğe bağlı alanlar required'da değil). */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const cleaned = clean(z.toJSONSchema(schema, { io: 'input' }));
  if (!isObject(cleaned)) {
    throw new Error('Araç şeması bir nesne olmalı.');
  }
  return cleaned;
}
