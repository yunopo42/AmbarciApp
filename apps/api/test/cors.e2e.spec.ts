import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestApp } from './create-test-app.js';

const WEB_ORIGIN = 'https://panel.example.com';

describe('CORS', () => {
  let app: INestApplication<App> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.unstubAllEnvs();
  });

  it('WEB_ORIGIN adresinden gelen isteğe izin verir', async () => {
    vi.stubEnv('WEB_ORIGIN', WEB_ORIGIN);
    app = await createTestApp();

    const response = await request(app.getHttpServer())
      .get('/v1/health')
      .set('Origin', WEB_ORIGIN)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
  });

  it('başka bir adrese izin vermez', async () => {
    vi.stubEnv('WEB_ORIGIN', WEB_ORIGIN);
    app = await createTestApp();

    const response = await request(app.getHttpServer())
      .get('/v1/health')
      .set('Origin', 'https://baska-site.example.com')
      .expect(200);

    // Tarayıcı, başlıktaki adres kendi origin'iyle eşleşmediği için cevabı engeller.
    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
  });

  it('WEB_ORIGIN sonundaki "/" işaretini yok sayar', async () => {
    vi.stubEnv('WEB_ORIGIN', `${WEB_ORIGIN}/`);
    app = await createTestApp();

    const response = await request(app.getHttpServer())
      .get('/v1/health')
      .set('Origin', WEB_ORIGIN)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
  });

  it('WEB_ORIGIN tanımlı değilse CORS başlığı göndermez', async () => {
    vi.stubEnv('WEB_ORIGIN', '');
    app = await createTestApp();

    const response = await request(app.getHttpServer())
      .get('/v1/health')
      .set('Origin', WEB_ORIGIN)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
