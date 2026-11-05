import { Module } from '@nestjs/common';

import { ClaudeAdapter } from './adapters/claude.adapter.js';
import { AI_CONFIG, readAiConfig } from './ai.config.js';
import type { AiConfig } from './ai.config.js';
import { AIProvider } from './ai-provider.js';
import { AiRunsRepository } from './ai-runs.repository.js';
import { AiService } from './ai.service.js';

/**
 * Dil modeli: AIProvider portu, Claude adaptörü, sürümlü promptlar (prompts/), ai_runs kaydı ve günlük token bütçesi.
 * Asistan modülü (ajan döngüsü ve araçlar) modeli yalnızca AiService üzerinden çağırır.
 */
@Module({
  providers: [
    { provide: AI_CONFIG, useFactory: (): AiConfig => readAiConfig() },
    {
      provide: AIProvider,
      useFactory: (config: AiConfig): AIProvider =>
        new ClaudeAdapter({ apiKey: config.apiKey, model: config.chatModel, effort: config.chatEffort }),
      inject: [AI_CONFIG],
    },
    AiRunsRepository,
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
