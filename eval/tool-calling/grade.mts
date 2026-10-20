// Bir konuşmadaki araç çağrılarını ve son cevabı etiketle karşılaştırır.

import { foldTurkish } from './catalog.mts';
import type { ExpectedItem, TestCase } from './messages.mts';

export interface ToolCall {
  round: number;
  name: string;
  input: Record<string, unknown>;
  isError: boolean;
}

export interface Grade {
  // list_warehouses dışındaki ilk çağrı beklenen sorguyla search_products mı
  firstTool: boolean;
  // Karar aracı doğru mu: beklenen propose_* (başka öneri yok), get_stock (öneri yok) ya da belirsizlikte hiç öneri yok
  tool: boolean;
  // Parametreler doğru mu; belirsizlikte cevap soru soruyor ve adayları/eksik alanı anıyor mu
  params: boolean;
  notes: string[];
}

// "3 x 2.5 mm²" → "3x2,5mm²": küçük harf, aksansız, boşluksuz, ondalık ayırıcı virgül.
export function normalizeForMatch(text: string): string {
  return foldTurkish(text).replace(/×/g, 'x').replace(/\s+/g, '').replace(/(\d)\.(\d)/g, '$1,$2');
}

function sameItems(actual: unknown, expected: ExpectedItem[]): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return expected.every((item) =>
    (actual as unknown[]).some((raw) => {
      if (typeof raw !== 'object' || raw === null) return false;
      const candidate = raw as Record<string, unknown>;
      return candidate.product_id === item.product_id && candidate.quantity === item.quantity;
    }),
  );
}

export function grade(testCase: TestCase, calls: ToolCall[], finalText: string): Grade {
  const notes: string[] = [];
  const expected = testCase.expected;

  const firstCall = calls.find((call) => call.name !== 'list_warehouses');
  const firstQuery = firstCall?.name === 'search_products' ? normalizeForMatch(String(firstCall.input.query ?? '')) : '';
  const firstTool = firstCall?.name === 'search_products' && testCase.firstQueryTerms.some((term) => firstQuery.includes(term));
  if (!firstTool) notes.push(`ilk çağrı: ${firstCall ? `${firstCall.name}(${JSON.stringify(firstCall.input)})` : 'yok'}`);

  const proposals = calls.filter((call) => call.name.startsWith('propose_'));
  let tool = false;
  let params = false;

  switch (expected.kind) {
    case 'get_stock': {
      const stockCalls = calls.filter((call) => call.name === 'get_stock');
      tool = stockCalls.length > 0 && proposals.length === 0;
      params = stockCalls.some(
        (call) =>
          call.input.product_id === expected.product_id &&
          (expected.warehouse_id === null || call.input.warehouse_id === expected.warehouse_id),
      );
      if (proposals.length > 0) notes.push('stok sorgusunda öneri aracı çağrıldı');
      break;
    }
    case 'propose_stock_in':
    case 'propose_stock_out':
    case 'propose_transfer': {
      tool = proposals.length > 0 && proposals.every((call) => call.name === expected.kind);
      if (proposals.length > 1) notes.push(`${proposals.length} öneri çağrısı`);
      const proposal = proposals.length === 1 ? proposals[0] : undefined;
      if (proposal && tool) {
        const input = proposal.input;
        const warehousesMatch =
          expected.kind === 'propose_transfer'
            ? input.from_warehouse_id === expected.from_warehouse_id && input.to_warehouse_id === expected.to_warehouse_id
            : input.warehouse_id === expected.warehouse_id;
        const partyMatches =
          expected.kind !== 'propose_stock_in' ||
          expected.party_contains === undefined ||
          normalizeForMatch(String(input.party_name ?? '')).includes(expected.party_contains);
        params = warehousesMatch && sameItems(input.items, expected.items) && partyMatches;
        if (!params) notes.push(`öneri girdisi: ${JSON.stringify(input)}`);
      }
      break;
    }
    case 'clarify': {
      tool = proposals.length === 0;
      if (!tool) notes.push(`belirsizlikte öneri: ${proposals.map((call) => `${call.name}(${JSON.stringify(call.input)})`).join(', ')}`);
      const text = normalizeForMatch(finalText);
      const asks = finalText.includes('?');
      const mentions = expected.markers.every((group) => group.some((marker) => text.includes(marker)));
      params = tool && asks && mentions;
      if (tool && !asks) notes.push('cevapta soru yok');
      if (tool && !mentions) notes.push('cevap adayları veya eksik alanı anmıyor');
      break;
    }
  }

  return { firstTool, tool, params, notes };
}
