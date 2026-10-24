import { describe, expect, it } from 'vitest';

import { createApiClient, describeApiError } from '../src/index.js';

// İstemcinin sözleşmesi: başlıklar tek yerde eklenir, hata gövdesi tipli döner. Ağ yerine sahte fetch kullanılır.

const ORGANIZATION = '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e01';

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('API istemcisi', () => {
  it("oturum token'ını ve aktif şirketi her isteğe ekler", async () => {
    const requests: Request[] = [];
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getAccessToken: async () => 'token-1',
      organizationId: ORGANIZATION,
      fetch: async (request) => {
        requests.push(request);
        return respond(200, []);
      },
    });

    const { data } = await client.GET('/v1/warehouses');

    expect(data).toEqual([]);
    expect(requests[0]?.url).toBe('https://api.test/v1/warehouses');
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer token-1');
    expect(requests[0]?.headers.get('x-organization-id')).toBe(ORGANIZATION);
  });

  it('oturum ve şirket yoksa başlık eklemez', async () => {
    const requests: Request[] = [];
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getAccessToken: async () => null,
      fetch: async (request) => {
        requests.push(request);
        return respond(200, { status: 'ok' });
      },
    });

    await client.GET('/v1/health');

    expect(requests[0]?.headers.has('authorization')).toBe(false);
    expect(requests[0]?.headers.has('x-organization-id')).toBe(false);
  });

  it('API hatası { error: { code, message } } olarak döner ve tek biçime çevrilir', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getAccessToken: async () => 'token-1',
      organizationId: ORGANIZATION,
      fetch: async () => respond(409, { error: { code: 'INSUFFICIENT_STOCK', message: 'Stok yetersiz.', details: [] } }),
    });

    const { data, error } = await client.POST('/v1/operations/{operationId}/confirm', {
      params: { path: { operationId: ORGANIZATION }, header: { 'Idempotency-Key': 'anahtar-12345' } },
      body: { version: 1 },
    });

    expect(data).toBeUndefined();
    expect(describeApiError(error)).toEqual({ code: 'INSUFFICIENT_STOCK', message: 'Stok yetersiz.', details: [] });
  });

  it('ağ hatası ve beklenmeyen hata da kullanıcıya gösterilebilir mesaja çevrilir', () => {
    expect(describeApiError(new TypeError('fetch failed')).code).toBe('NETWORK_ERROR');
    expect(describeApiError('tuhaf')).toEqual({ code: 'UNEXPECTED', message: 'Beklenmeyen bir hata oluştu.' });
  });
});
