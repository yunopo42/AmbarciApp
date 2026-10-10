import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from './create-test-app.js';

describe('GET /v1/health', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('200 ve { status: "ok" } döner', async () => {
    const response = await request(app.getHttpServer()).get('/v1/health').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('/v1 öneki olmadan 404 döner', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });
});
