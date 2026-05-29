import { z } from 'zod'
import 'dotenv/config'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3333),
  FRONTEND_URL: z.string().default('http://localhost:5454'),
  BACKEND_URL: z.string().default('http://localhost:3333'),

  DATABASE_URL: z.string(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),

  JWT_SECRET: z.string(),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Field-level encryption (AES-256-GCM envelope encryption)
  ENCRYPTION_KEK: z.string().min(64, 'ENCRYPTION_KEK deve ter 64 chars hex (256 bits)'),

  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_BUSINESS_ID: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_API_VERSION: z.string().default('v24.0'),

  TYPEBOT_API_URL: z.string().optional(),
  TYPEBOT_API_KEY: z.string().optional(),

  N8N_WEBHOOK_URL: z.string().optional(),

  // Evo Go global config
  EVO_GO_API_URL: z.string().optional(),
  EVO_GO_GLOBAL_API_KEY: z.string().optional(),

  BAILEYS_SESSIONS_PATH: z.string().default('./sessions'),

  // AI Configuration
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  CLAUDE_API_KEY: z.string().optional(),
  AI_DEFAULT_PROVIDER: z.enum(['OPENAI', 'GEMINI', 'CLAUDE', 'DEEPSEEK', 'GROQ', 'OPENROUTER', 'PERPLEXITY', 'MISTRAL', 'COHERE', 'XAI', 'TOGETHER', 'FIREWORKS', 'CEREBRAS', 'GITHUB_MODELS', 'GITHUB_COPILOT', 'ANTIGRAVITY', 'OPENAI_COMPATIBLE']).default('OPENAI'),
  AI_DEFAULT_MODEL: z.string().default('gpt-4o-mini'),
})

const _env = envSchema.safeParse(process.env)

if (!_env.success) {
  console.error('Invalid environment variables:', _env.error.format())
  throw new Error('Invalid environment variables')
}

export const env = _env.data
