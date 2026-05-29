/**
 * Prompt Layers Composer
 *
 * Decompõe o system prompt em CAMADAS independentes, cada uma com:
 *   - id        : identificador (logging/debug)
 *   - cacheable : se faz parte do "prefixo estável" (vai pro Anthropic prompt cache)
 *   - content   : texto da camada
 *
 * A ORDEM determinística é fundamental para o **prompt cache** funcionar:
 *   - Anthropic: cache_control marker no final do bloco estável → 90% economia
 *   - OpenAI: cache automático se prefix idêntico ≥ 1024 tokens (sem ação extra)
 *   - Gemini: cachedContent API (ainda não implementado)
 *
 * Layout otimizado: do MAIS ESTÁVEL ao MAIS DINÂMICO.
 */

export type PromptLayerId =
  | 'role'
  | 'goal'
  | 'identity'        // systemPrompt do agente (estável)
  | 'tools'           // instruções de tool calling (estável)
  | 'interactive'     // docs de mensagens interativas (estável)
  | 'media'           // markdown de mídia (estável)
  | 'always_skills'   // skills always-on da empresa (estável)
  | 'kb_instructions' // instrução genérica de KB (estável)
  | 'context'         // data/hora/contato (DINÂMICO — muda a cada msg)
  | 'rag'             // chunks recuperados (DINÂMICO)
  | 'matched_skills'  // skills selecionadas por similarity (DINÂMICO)
  | 'brain'           // memória de longo prazo do contato (DINÂMICO)
  | 'state'           // estado rastreado pelo State Extractor (DINÂMICO)

export interface PromptLayer {
  id: PromptLayerId
  cacheable: boolean
  content: string
}

const CACHE_MARKER = '<!--cache_breakpoint-->'

/**
 * Marker que sinaliza ao provider Anthropic onde o prefixo cacheable termina.
 * Os providers que suportam prompt cache (Anthropic) devem dividir o system
 * prompt em duas partes nesse marker e marcar a primeira com cache_control.
 */
export function getCacheBreakpointMarker(): string {
  return CACHE_MARKER
}

/**
 * Compõe o system prompt final a partir de camadas.
 * Coloca todas as camadas CACHEABLE primeiro (na ordem definida), insere o
 * marker, e em seguida as camadas DINÂMICAS.
 */
export function composeSystemPrompt(layers: PromptLayer[]): {
  text: string
  cacheable: PromptLayer[]
  dynamic: PromptLayer[]
} {
  const cacheable = layers.filter(l => l.cacheable && l.content.trim())
  const dynamic = layers.filter(l => !l.cacheable && l.content.trim())

  const cacheableText = cacheable.map(l => l.content.trim()).join('\n\n')
  const dynamicText = dynamic.map(l => l.content.trim()).join('\n\n')

  let text: string
  if (cacheableText && dynamicText) {
    text = `${cacheableText}\n\n${CACHE_MARKER}\n\n${dynamicText}`
  } else {
    text = cacheableText || dynamicText
  }

  return { text, cacheable, dynamic }
}
