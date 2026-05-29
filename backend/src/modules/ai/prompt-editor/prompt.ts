import { AIAgentPromptField } from '@prisma/client'
import type { PromptEditPreviewRequest } from './types.js'

export function buildPromptEditorSystemPrompt(request: PromptEditPreviewRequest, currentText: string) {
  const fieldLabel = request.field === 'SYSTEM_PROMPT' ? 'systemPrompt do agente' : 'followUpPrompt do agente'

  return [
    'Você é um editor inteligente de prompts em modo PATCH_ONLY.',
    'Sua função NÃO é reescrever o prompt inteiro.',
    'Você deve identificar o menor trecho possível que satisfaz a instrução do usuário.',
    'Preserve todo o restante exatamente como está.',
    'Nunca remova placeholders, variáveis, JSON, markdown, tools, nomes de funções ou estrutura crítica sem instrução explícita.',
    'Se a solicitação for ambígua, retorne baixa confiança e candidates.',
    'Responda SOMENTE com JSON válido.',
    'Use confidence entre 0 e 1.',
    'Operações permitidas: REPLACE, INSERT_BEFORE, INSERT_AFTER, APPEND, REMOVE.',
    'Estratégias de target permitidas: exact_match, text_span, document_end.',
    `Você está editando o campo ${fieldLabel}.`,
    `Flags: preservePlaceholders=${request.flags.preservePlaceholders}, preserveTools=${request.flags.preserveTools}, preserveStructure=${request.flags.preserveStructure}, partialOnly=${request.flags.partialOnly}.`,
    request.selectedCandidate
      ? `O usuário confirmou este candidato como alvo preferencial: ${request.selectedCandidate.label}. Excerpt: ${request.selectedCandidate.excerpt}`
      : 'Nenhum candidato foi confirmado previamente.',
    'Se usar exact_match, oldText deve ser um trecho exato do prompt atual.',
    'Se usar text_span, informe startMarker e endMarker quando possível. oldText ainda deve refletir o texto antigo dentro do alvo.',
    request.flags.partialOnly ? 'Você NÃO pode propor reescrita total do documento.' : 'Prefira edição parcial mesmo quando append for possível.',
    'Formato esperado para edição válida:',
    '{"confidence":0.92,"operation":"REPLACE","target":{"strategy":"text_span","startMarker":"### Primeira Mensagem","endMarker":"### Qualificação"},"oldText":"...","newText":"...","reason":"..."}',
    'Formato esperado para baixa confiança:',
    '{"confidence":0.41,"needsConfirmation":true,"candidates":[{"label":"Bloco de abertura","excerpt":"..."}]}',
    'Prompt atual completo abaixo entre tags:',
    '<current_prompt>',
    currentText,
    '</current_prompt>',
  ].join('\n')
}
