/**
 * Calculadora de custo de tokens por modelo LLM
 * Baseado no padrão Dify de billing
 * Preços em USD por 1M tokens (input / output)
 */

export interface ModelPricing {
  inputPer1M: number   // USD por 1M tokens input
  outputPer1M: number  // USD por 1M tokens output
}

// Tabela de preços (atualizada 2025)
const MODEL_PRICING: Record<string, ModelPricing> = {
  // === OpenAI ===
  'gpt-4o':                   { inputPer1M: 2.50,  outputPer1M: 10.00 },
  'gpt-4o-mini':              { inputPer1M: 0.15,  outputPer1M: 0.60  },
  'gpt-4o-mini-2024-07-18':   { inputPer1M: 0.15,  outputPer1M: 0.60  },
  'gpt-4o-2024-11-20':        { inputPer1M: 2.50,  outputPer1M: 10.00 },
  'gpt-4o-2024-08-06':        { inputPer1M: 2.50,  outputPer1M: 10.00 },
  'gpt-4-turbo':              { inputPer1M: 10.00, outputPer1M: 30.00 },
  'gpt-4-turbo-preview':      { inputPer1M: 10.00, outputPer1M: 30.00 },
  'gpt-4':                    { inputPer1M: 30.00, outputPer1M: 60.00 },
  'gpt-3.5-turbo':            { inputPer1M: 0.50,  outputPer1M: 1.50  },
  'gpt-3.5-turbo-0125':       { inputPer1M: 0.50,  outputPer1M: 1.50  },
  'o1':                       { inputPer1M: 15.00, outputPer1M: 60.00 },
  'o1-mini':                  { inputPer1M: 3.00,  outputPer1M: 12.00 },
  'o1-preview':               { inputPer1M: 15.00, outputPer1M: 60.00 },
  'o3-mini':                  { inputPer1M: 1.10,  outputPer1M: 4.40  },
  'o3':                       { inputPer1M: 10.00, outputPer1M: 40.00 },
  'gpt-4.1':                  { inputPer1M: 2.00,  outputPer1M: 8.00  },
  'gpt-4.1-mini':             { inputPer1M: 0.40,  outputPer1M: 1.60  },
  'gpt-4.1-nano':             { inputPer1M: 0.10,  outputPer1M: 0.40  },

  // === Anthropic Claude ===
  'claude-3-5-sonnet-20241022':   { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-3-5-sonnet-20240620':   { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-3-5-sonnet-latest':     { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-3-5-haiku-20241022':    { inputPer1M: 0.80,  outputPer1M: 4.00  },
  'claude-3-5-haiku-latest':      { inputPer1M: 0.80,  outputPer1M: 4.00  },
  'claude-3-opus-20240229':       { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-3-opus-latest':         { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-3-sonnet-20240229':     { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-3-haiku-20240307':      { inputPer1M: 0.25,  outputPer1M: 1.25  },
  'claude-opus-4-5':              { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-sonnet-4-5':            { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-haiku-4-5':             { inputPer1M: 0.80,  outputPer1M: 4.00  },

  // === Google Gemini ===
  'gemini-1.5-flash':             { inputPer1M: 0.075, outputPer1M: 0.30  },
  'gemini-1.5-flash-8b':         { inputPer1M: 0.0375,outputPer1M: 0.15  },
  'gemini-1.5-pro':               { inputPer1M: 1.25,  outputPer1M: 5.00  },
  'gemini-1.0-pro':               { inputPer1M: 0.50,  outputPer1M: 1.50  },
  'gemini-2.0-flash':             { inputPer1M: 0.10,  outputPer1M: 0.40  },
  'gemini-2.0-flash-lite':        { inputPer1M: 0.075, outputPer1M: 0.30  },
  'gemini-2.5-pro':               { inputPer1M: 1.25,  outputPer1M: 10.00 },
  'gemini-2.5-flash':             { inputPer1M: 0.15,  outputPer1M: 0.60  },

  // === DeepSeek ===
  'deepseek-chat':                { inputPer1M: 0.27,  outputPer1M: 1.10  },
  'deepseek-reasoner':            { inputPer1M: 0.55,  outputPer1M: 2.19  },
  'deepseek-coder':               { inputPer1M: 0.14,  outputPer1M: 0.28  },

  // === Groq (inferência rápida, preços baixos) ===
  'llama-3.3-70b-versatile':      { inputPer1M: 0.59,  outputPer1M: 0.79  },
  'llama-3.1-8b-instant':         { inputPer1M: 0.05,  outputPer1M: 0.08  },
  'llama-3.1-70b-versatile':      { inputPer1M: 0.59,  outputPer1M: 0.79  },
  'mixtral-8x7b-32768':           { inputPer1M: 0.24,  outputPer1M: 0.24  },
  'gemma2-9b-it':                 { inputPer1M: 0.20,  outputPer1M: 0.20  },

  // === Mistral ===
  'mistral-large-latest':         { inputPer1M: 2.00,  outputPer1M: 6.00  },
  'mistral-small-latest':         { inputPer1M: 0.20,  outputPer1M: 0.60  },
  'codestral-latest':             { inputPer1M: 0.30,  outputPer1M: 0.90  },
  'pixtral-large-latest':         { inputPer1M: 2.00,  outputPer1M: 6.00  },
  'open-mistral-nemo':            { inputPer1M: 0.15,  outputPer1M: 0.15  },

  // === Cohere ===
  'command-r-plus':               { inputPer1M: 2.50,  outputPer1M: 10.00 },
  'command-r':                    { inputPer1M: 0.15,  outputPer1M: 0.60  },
  'command-light':                { inputPer1M: 0.30,  outputPer1M: 0.60  },

  // === xAI (Grok) ===
  'grok-2':                       { inputPer1M: 2.00,  outputPer1M: 10.00 },
  'grok-2-mini':                  { inputPer1M: 0.20,  outputPer1M: 1.00  },
  'grok-beta':                    { inputPer1M: 5.00,  outputPer1M: 15.00 },

  // === Together AI ===
  'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo':  { inputPer1M: 0.88, outputPer1M: 0.88 },
  'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo':   { inputPer1M: 0.18, outputPer1M: 0.18 },
  'mistralai/Mixtral-8x7B-Instruct-v0.1':          { inputPer1M: 0.60, outputPer1M: 0.60 },

  // === Fireworks ===
  'accounts/fireworks/models/llama-v3p1-70b-instruct':  { inputPer1M: 0.90, outputPer1M: 0.90 },
  'accounts/fireworks/models/llama-v3p1-8b-instruct':   { inputPer1M: 0.20, outputPer1M: 0.20 },

  // === Cerebras ===
  'llama3.1-70b':                 { inputPer1M: 0.85,  outputPer1M: 0.85  },
  'llama3.1-8b':                  { inputPer1M: 0.10,  outputPer1M: 0.10  },

  // === Perplexity ===
  'sonar-pro':                    { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'sonar':                        { inputPer1M: 1.00,  outputPer1M: 1.00  },
  'sonar-reasoning-pro':          { inputPer1M: 2.00,  outputPer1M: 8.00  },
  'sonar-reasoning':              { inputPer1M: 1.00,  outputPer1M: 5.00  },
}

// Prefixos para fallback (quando não achar o modelo exato)
const MODEL_PRICING_FALLBACK: Array<{ prefix: string; pricing: ModelPricing }> = [
  { prefix: 'gpt-4o-mini',    pricing: { inputPer1M: 0.15,  outputPer1M: 0.60  } },
  { prefix: 'gpt-4o',         pricing: { inputPer1M: 2.50,  outputPer1M: 10.00 } },
  { prefix: 'gpt-4-turbo',    pricing: { inputPer1M: 10.00, outputPer1M: 30.00 } },
  { prefix: 'gpt-4',          pricing: { inputPer1M: 30.00, outputPer1M: 60.00 } },
  { prefix: 'gpt-3.5',        pricing: { inputPer1M: 0.50,  outputPer1M: 1.50  } },
  { prefix: 'o1-mini',        pricing: { inputPer1M: 3.00,  outputPer1M: 12.00 } },
  { prefix: 'o1',             pricing: { inputPer1M: 15.00, outputPer1M: 60.00 } },
  { prefix: 'o3-mini',        pricing: { inputPer1M: 1.10,  outputPer1M: 4.40  } },
  { prefix: 'claude-3-5-haiku', pricing: { inputPer1M: 0.80, outputPer1M: 4.00 } },
  { prefix: 'claude-3-5',     pricing: { inputPer1M: 3.00,  outputPer1M: 15.00 } },
  { prefix: 'claude-3-haiku', pricing: { inputPer1M: 0.25,  outputPer1M: 1.25  } },
  { prefix: 'claude-3-opus',  pricing: { inputPer1M: 15.00, outputPer1M: 75.00 } },
  { prefix: 'claude-3',       pricing: { inputPer1M: 3.00,  outputPer1M: 15.00 } },
  { prefix: 'claude',         pricing: { inputPer1M: 3.00,  outputPer1M: 15.00 } },
  { prefix: 'gemini-2.5-pro', pricing: { inputPer1M: 1.25,  outputPer1M: 10.00 } },
  { prefix: 'gemini-2.5',     pricing: { inputPer1M: 0.15,  outputPer1M: 0.60  } },
  { prefix: 'gemini-2.0',     pricing: { inputPer1M: 0.10,  outputPer1M: 0.40  } },
  { prefix: 'gemini-1.5-pro', pricing: { inputPer1M: 1.25,  outputPer1M: 5.00  } },
  { prefix: 'gemini-1.5',     pricing: { inputPer1M: 0.075, outputPer1M: 0.30  } },
  { prefix: 'gemini',         pricing: { inputPer1M: 0.10,  outputPer1M: 0.40  } },
  // DeepSeek
  { prefix: 'deepseek-reason', pricing: { inputPer1M: 0.55, outputPer1M: 2.19 } },
  { prefix: 'deepseek',       pricing: { inputPer1M: 0.27,  outputPer1M: 1.10  } },
  // Groq (llama via groq)
  { prefix: 'llama-3.3',      pricing: { inputPer1M: 0.59,  outputPer1M: 0.79  } },
  { prefix: 'llama-3.1-8b',   pricing: { inputPer1M: 0.05,  outputPer1M: 0.08  } },
  { prefix: 'llama-3.1-70b',  pricing: { inputPer1M: 0.59,  outputPer1M: 0.79  } },
  { prefix: 'llama-3.1',      pricing: { inputPer1M: 0.59,  outputPer1M: 0.79  } },
  { prefix: 'mixtral',        pricing: { inputPer1M: 0.24,  outputPer1M: 0.24  } },
  { prefix: 'gemma',          pricing: { inputPer1M: 0.20,  outputPer1M: 0.20  } },
  // Mistral
  { prefix: 'mistral-large',  pricing: { inputPer1M: 2.00,  outputPer1M: 6.00  } },
  { prefix: 'mistral-small',  pricing: { inputPer1M: 0.20,  outputPer1M: 0.60  } },
  { prefix: 'codestral',      pricing: { inputPer1M: 0.30,  outputPer1M: 0.90  } },
  { prefix: 'pixtral',        pricing: { inputPer1M: 2.00,  outputPer1M: 6.00  } },
  { prefix: 'open-mistral',   pricing: { inputPer1M: 0.15,  outputPer1M: 0.15  } },
  { prefix: 'mistral',        pricing: { inputPer1M: 0.20,  outputPer1M: 0.60  } },
  // Cohere
  { prefix: 'command-r-plus', pricing: { inputPer1M: 2.50,  outputPer1M: 10.00 } },
  { prefix: 'command-r',      pricing: { inputPer1M: 0.15,  outputPer1M: 0.60  } },
  { prefix: 'command',        pricing: { inputPer1M: 0.30,  outputPer1M: 0.60  } },
  // xAI
  { prefix: 'grok-2-mini',    pricing: { inputPer1M: 0.20,  outputPer1M: 1.00  } },
  { prefix: 'grok-2',         pricing: { inputPer1M: 2.00,  outputPer1M: 10.00 } },
  { prefix: 'grok',           pricing: { inputPer1M: 5.00,  outputPer1M: 15.00 } },
  // Sonar (Perplexity)
  { prefix: 'sonar-pro',      pricing: { inputPer1M: 3.00,  outputPer1M: 15.00 } },
  { prefix: 'sonar-reasoning', pricing: { inputPer1M: 1.00, outputPer1M: 5.00  } },
  { prefix: 'sonar',          pricing: { inputPer1M: 1.00,  outputPer1M: 1.00  } },
  // Together/Fireworks/Cerebras (Llama paths)
  { prefix: 'meta-llama/',    pricing: { inputPer1M: 0.88,  outputPer1M: 0.88  } },
  { prefix: 'accounts/fireworks/', pricing: { inputPer1M: 0.90, outputPer1M: 0.90 } },
  { prefix: 'llama3.1',       pricing: { inputPer1M: 0.85,  outputPer1M: 0.85  } },
]

export function getPricing(model: string): ModelPricing | null {
  const normalized = model.toLowerCase().trim()

  // Exact match
  if (MODEL_PRICING[normalized]) return MODEL_PRICING[normalized]

  // Prefix fallback
  for (const { prefix, pricing } of MODEL_PRICING_FALLBACK) {
    if (normalized.startsWith(prefix)) return pricing
  }

  return null
}

export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = getPricing(model)
  if (!pricing) return 0

  const inputCost  = (promptTokens    / 1_000_000) * pricing.inputPer1M
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M

  // Round to 8 decimal places (like Dify does)
  return Math.round((inputCost + outputCost) * 1e8) / 1e8
}

export function formatCostBrl(costUsd: number, usdBrlRate = 5.7): string {
  const brl = costUsd * usdBrlRate
  if (brl < 0.001) return `R$ ${(brl * 100).toFixed(4)}¢`
  return `R$ ${brl.toFixed(4)}`
}

export function formatCostUsd(costUsd: number): string {
  if (costUsd < 0.0001) return `$${(costUsd * 1000).toFixed(4)}m` // millicents
  return `$${costUsd.toFixed(6)}`
}

// Lista de modelos conhecidos por provider (para UI antes de ter a chave)
export const KNOWN_MODELS: Record<string, Array<{id: string, name: string, context: string}>> = {
  OPENAI: [
    { id: 'gpt-4o-mini',   name: 'GPT-4o Mini (rápido, barato)',  context: '128K' },
    { id: 'gpt-4o',        name: 'GPT-4o (recomendado)',           context: '128K' },
    { id: 'gpt-4.1-mini',  name: 'GPT-4.1 Mini',                  context: '1M'   },
    { id: 'gpt-4.1',       name: 'GPT-4.1',                       context: '1M'   },
    { id: 'gpt-4-turbo',   name: 'GPT-4 Turbo',                   context: '128K' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (legacy)',        context: '16K'  },
    { id: 'o1-mini',       name: 'o1 Mini (reasoning)',            context: '128K' },
    { id: 'o3-mini',       name: 'o3 Mini (reasoning avançado)',   context: '200K' },
  ],
  ANTHROPIC: [
    { id: 'claude-3-5-haiku-latest',   name: 'Claude 3.5 Haiku (rápido)',      context: '200K' },
    { id: 'claude-3-5-sonnet-latest',  name: 'Claude 3.5 Sonnet (recomendado)', context: '200K' },
    { id: 'claude-3-haiku-20240307',   name: 'Claude 3 Haiku',                 context: '200K' },
    { id: 'claude-3-opus-latest',      name: 'Claude 3 Opus (poderoso)',        context: '200K' },
  ],
  GOOGLE: [
    { id: 'gemini-2.0-flash',          name: 'Gemini 2.0 Flash (rápido, barato)', context: '1M'   },
    { id: 'gemini-1.5-flash',          name: 'Gemini 1.5 Flash',                  context: '1M'   },
    { id: 'gemini-1.5-pro',            name: 'Gemini 1.5 Pro (avançado)',          context: '2M'   },
    { id: 'gemini-2.5-flash',          name: 'Gemini 2.5 Flash',                  context: '1M'   },
    { id: 'gemini-2.5-pro',            name: 'Gemini 2.5 Pro (poderoso)',          context: '1M'   },
  ],
  DEEPSEEK: [
    { id: 'deepseek-chat',     name: 'DeepSeek V3 (chat)',             context: '128K' },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1 (reasoning)',        context: '128K' },
    { id: 'deepseek-coder',    name: 'DeepSeek Coder',                 context: '128K' },
  ],
  GROQ: [
    { id: 'llama-3.3-70b-versatile',  name: 'Llama 3.3 70B (recomendado)',  context: '128K' },
    { id: 'llama-3.1-8b-instant',     name: 'Llama 3.1 8B (ultra rápido)',  context: '128K' },
    { id: 'llama-3.1-70b-versatile',  name: 'Llama 3.1 70B',               context: '128K' },
    { id: 'mixtral-8x7b-32768',       name: 'Mixtral 8x7B',                context: '32K'  },
    { id: 'gemma2-9b-it',             name: 'Gemma 2 9B',                  context: '8K'   },
  ],
  OPENROUTER: [
    { id: 'openai/gpt-4o-mini',              name: 'GPT-4o Mini (via OpenRouter)',     context: '128K' },
    { id: 'anthropic/claude-3.5-sonnet',      name: 'Claude 3.5 Sonnet (via OpenRouter)', context: '200K' },
    { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (grátis)',       context: '1M'   },
    { id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B (grátis)',    context: '128K' },
    { id: 'deepseek/deepseek-chat',           name: 'DeepSeek V3 (via OpenRouter)',    context: '128K' },
    { id: 'mistralai/mistral-large-latest',   name: 'Mistral Large (via OpenRouter)',  context: '128K' },
  ],
  PERPLEXITY: [
    { id: 'sonar-pro',           name: 'Sonar Pro (busca avançada)',     context: '200K' },
    { id: 'sonar',               name: 'Sonar (busca rápida)',           context: '128K' },
    { id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro',            context: '128K' },
    { id: 'sonar-reasoning',     name: 'Sonar Reasoning',                context: '128K' },
  ],
  MISTRAL: [
    { id: 'mistral-large-latest',  name: 'Mistral Large (poderoso)',    context: '128K' },
    { id: 'mistral-small-latest',  name: 'Mistral Small (rápido)',      context: '128K' },
    { id: 'codestral-latest',      name: 'Codestral (código)',          context: '32K'  },
    { id: 'pixtral-large-latest',  name: 'Pixtral Large (visão)',       context: '128K' },
    { id: 'open-mistral-nemo',     name: 'Mistral Nemo (open source)',  context: '128K' },
  ],
  COHERE: [
    { id: 'command-r-plus',  name: 'Command R+ (poderoso)',     context: '128K' },
    { id: 'command-r',       name: 'Command R (rápido)',        context: '128K' },
    { id: 'command-light',   name: 'Command Light (leve)',      context: '4K'   },
  ],
  XAI: [
    { id: 'grok-2',      name: 'Grok 2 (poderoso)',         context: '128K' },
    { id: 'grok-2-mini', name: 'Grok 2 Mini (rápido)',      context: '128K' },
    { id: 'grok-beta',   name: 'Grok Beta',                 context: '128K' },
  ],
  TOGETHER: [
    { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',  name: 'Llama 3.1 70B Turbo',   context: '128K' },
    { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',   name: 'Llama 3.1 8B Turbo',    context: '128K' },
    { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1',          name: 'Mixtral 8x7B',          context: '32K'  },
  ],
  FIREWORKS: [
    { id: 'accounts/fireworks/models/llama-v3p1-70b-instruct', name: 'Llama 3.1 70B',   context: '128K' },
    { id: 'accounts/fireworks/models/llama-v3p1-8b-instruct',  name: 'Llama 3.1 8B',    context: '128K' },
  ],
  CEREBRAS: [
    { id: 'llama3.1-70b',  name: 'Llama 3.1 70B (ultra rápido)',  context: '128K' },
    { id: 'llama3.1-8b',   name: 'Llama 3.1 8B (ultra rápido)',   context: '128K' },
  ],
  GITHUB_MODELS: [
    { id: 'gpt-4o-mini',          name: 'GPT-4o Mini (via GitHub)',        context: '128K' },
    { id: 'gpt-4o',               name: 'GPT-4o (via GitHub)',             context: '128K' },
    { id: 'Meta-Llama-3.1-405B-Instruct', name: 'Llama 3.1 405B',        context: '128K' },
    { id: 'Meta-Llama-3.1-70B-Instruct',  name: 'Llama 3.1 70B',         context: '128K' },
    { id: 'Meta-Llama-3.1-8B-Instruct',   name: 'Llama 3.1 8B',          context: '128K' },
    { id: 'Mistral-large-2407',   name: 'Mistral Large',                   context: '128K' },
    { id: 'Phi-3.5-mini-instruct', name: 'Phi 3.5 Mini',                  context: '128K' },
    { id: 'Cohere-command-r-plus', name: 'Command R+',                     context: '128K' },
  ],
  GITHUB_COPILOT: [
    { id: 'gpt-4o',               name: 'GPT-4o (Copilot)',               context: '128K' },
    { id: 'gpt-4o-mini',          name: 'GPT-4o Mini (Copilot)',           context: '128K' },
    { id: 'gpt-4.1',              name: 'GPT-4.1 (Copilot)',              context: '1M'   },
    { id: 'gpt-4.1-mini',         name: 'GPT-4.1 Mini (Copilot)',         context: '1M'   },
    { id: 'gpt-5',                name: 'GPT-5 (Copilot)',                context: '272K' },
    { id: 'gpt-5-mini',           name: 'GPT-5 Mini (Copilot)',           context: '272K' },
    { id: 'o1',                   name: 'o1 (Copilot)',                   context: '200K' },
    { id: 'o3',                   name: 'o3 (Copilot)',                   context: '200K' },
    { id: 'o3-mini',              name: 'o3 Mini (Copilot)',              context: '200K' },
    { id: 'o4-mini',              name: 'o4 Mini (Copilot)',              context: '200K' },
    { id: 'claude-3.5-sonnet',    name: 'Claude 3.5 Sonnet (Copilot)',    context: '200K' },
    { id: 'claude-3.7-sonnet',    name: 'Claude 3.7 Sonnet (Copilot)',    context: '200K' },
    { id: 'claude-3.7-sonnet-thought', name: 'Claude 3.7 Sonnet Thinking (Copilot)', context: '200K' },
    { id: 'claude-sonnet-4',      name: 'Claude Sonnet 4 (Copilot)',      context: '200K' },
    { id: 'claude-sonnet-4.5',    name: 'Claude Sonnet 4.5 (Copilot)',    context: '200K' },
    { id: 'claude-opus-4',        name: 'Claude Opus 4 (Copilot)',        context: '200K' },
    { id: 'claude-opus-41',       name: 'Claude Opus 4.1 (Copilot)',      context: '200K' },
    { id: 'gemini-2.0-flash-001', name: 'Gemini 2.0 Flash (Copilot)',     context: '1M'   },
    { id: 'gemini-2.5-pro',       name: 'Gemini 2.5 Pro (Copilot)',       context: '1M'   },
    { id: 'grok-code-fast-1',     name: 'Grok Code Fast 1 (Copilot)',     context: '256K' },
  ],
  ANTIGRAVITY: [
    { id: 'gemini-2.5-flash',     name: 'Gemini 2.5 Flash',               context: '1M'   },
    { id: 'gemini-2.5-pro',       name: 'Gemini 2.5 Pro',                 context: '1M'   },
    { id: 'gemini-2.0-flash',     name: 'Gemini 2.0 Flash',               context: '1M'   },
    { id: 'gemini-1.5-pro',       name: 'Gemini 1.5 Pro',                 context: '2M'   },
  ],
}
