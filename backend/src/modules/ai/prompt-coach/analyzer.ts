import type { CoachIssue, CoachPillar } from './types.js'

/**
 * Heurísticas estáticas (sem IA) que detectam problemas comuns em prompts de agente.
 * Baratas, rápidas e explicáveis. Rodam em todo analyze, independente de IA estar on.
 */

// ─── Helpers ─────────────────────────────────────────────────

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re)
  return m ? m.length : 0
}

function hasSection(text: string, labels: string[]): boolean {
  const lower = text.toLowerCase()
  return labels.some((l) => lower.includes(l.toLowerCase()))
}

function extractFirstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re)
  return m ? m[0] : undefined
}

// ─── Stats (usado pelo scorer também) ────────────────────────

export interface PromptStats {
  chars: number
  words: number
  lines: number
  sections: number
  placeholders: number
  examples: number
  hasRole: boolean
  hasGoal: boolean
  hasRules: boolean
  hasTone: boolean
  hasFallback: boolean
  hasExamples: boolean
  hasFlow: boolean
  uniquePlaceholders: Set<string>
}

export function computeStats(text: string): PromptStats {
  const chars = text.length
  const words = (text.match(/\S+/g) || []).length
  const lines = text.split(/\r?\n/).length
  const sections = countMatches(text, /^#{1,6}\s+/gm) + countMatches(text, /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ\s]{3,}:$/gm)
  const placeholderMatches = text.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) || []
  const placeholders = placeholderMatches.length
  const uniquePlaceholders = new Set(placeholderMatches.map((p) => p.toLowerCase()))

  // examples: blocos que começam com "exemplo", "example", "—", ou "Usuário:"/"Cliente:" seguido por "Bot:"/"Atendente:"
  const examples =
    countMatches(text, /\bexemplos?\s*\d*\s*[:\-]/gi) +
    countMatches(text, /\bexamples?\s*\d*\s*[:\-]/gi) +
    countMatches(text, /(?:^|\n)\s*(?:cliente|usu[aá]rio|user)\s*:/gi)

  return {
    chars,
    words,
    lines,
    sections,
    placeholders,
    examples,
    hasRole: /\b(voc[eê] [eé]|you are|act as|atue como|seu papel|your role|sua fun[cç][aã]o)\b/i.test(text),
    hasGoal: /\b(objetivo|miss[aã]o|sua tarefa|your goal|your task|your objective|deve ajudar|deve atender)\b/i.test(
      text
    ),
    hasRules: hasSection(text, [
      '# regras',
      '## regras',
      'regras:',
      'nunca',
      'não pode',
      'não deve',
      'proibido',
      'obrigat',
      'rules',
      'must not',
    ]),
    hasTone: /\b(tom|estilo|seja (formal|informal|amig[aá]vel|profissional|acolhedor|descontra[ií]do)|tone|style)\b/i.test(
      text
    ),
    hasFallback: /\b(se n[aã]o (souber|tiver)|caso n[aã]o|quando n[aã]o|if you don'?t know|n[aã]o invente|n[aã]o tenho (certeza|essa informa))/i.test(
      text
    ),
    hasExamples: examples > 0,
    hasFlow: /\b(pr[oó]ximo passo|call to action|cta|transfer|encaminhar|agendar|sempre pergunte)\b/i.test(text),
    uniquePlaceholders,
  }
}

// ─── Heurísticas de problemas ────────────────────────────────

export function runStaticAnalysis(text: string, stats: PromptStats): CoachIssue[] {
  const issues: CoachIssue[] = []
  const norm = text.trim()

  // 1. Prompt vazio ou muito curto
  if (norm.length === 0) {
    issues.push({
      id: 'empty',
      pillar: 'role',
      severity: 'error',
      title: 'Prompt vazio',
      message: 'O prompt está em branco. Comece definindo o papel do agente e seu objetivo.',
      source: 'static',
    })
    return issues
  }

  if (stats.words < 30) {
    issues.push({
      id: 'too_short',
      pillar: 'quality',
      severity: 'error',
      title: 'Prompt muito curto',
      message: `Apenas ${stats.words} palavras. Um bom prompt costuma ter pelo menos 100-200 palavras cobrindo papel, objetivo, regras e exemplos.`,
      source: 'static',
    })
  }

  // 2. Papel / Persona
  if (!stats.hasRole) {
    issues.push({
      id: 'no_role',
      pillar: 'role',
      severity: 'warning',
      title: 'Papel do agente não definido',
      message: 'O prompt não deixa claro QUEM é o agente. Comece com "Você é..." ou "Atue como...".',
      source: 'static',
      suggestion: {
        label: 'Adicionar definição de papel',
        instruction:
          'Adicione logo no início uma seção definindo o papel do agente (ex: "Você é um atendente virtual especializado em..."). Preserve todo o resto.',
      },
    })
  }

  // 3. Objetivo
  if (!stats.hasGoal) {
    issues.push({
      id: 'no_goal',
      pillar: 'goal',
      severity: 'warning',
      title: 'Objetivo não explícito',
      message:
        'Não há um objetivo claro ("sua missão é...", "você deve ajudar com..."). A IA performa melhor quando sabe EXATAMENTE o que precisa entregar.',
      source: 'static',
      suggestion: {
        label: 'Adicionar objetivo',
        instruction:
          'Adicione uma seção "## Objetivo" explicando concretamente o que o agente deve fazer e qual o resultado esperado. Preserve o resto do prompt.',
      },
    })
  }

  // 4. Regras / Limites
  if (!stats.hasRules) {
    issues.push({
      id: 'no_rules',
      pillar: 'rules',
      severity: 'warning',
      title: 'Nenhuma regra ou limite definido',
      message:
        'Não há regras do tipo "nunca faça X" ou "sempre confirme Y". Sem limites explícitos, o agente pode se comportar de forma imprevisível.',
      source: 'static',
      suggestion: {
        label: 'Adicionar seção de regras',
        instruction:
          'Adicione uma seção "## Regras" com 3-5 regras claras começando com "Nunca..." ou "Sempre...". Preserve o resto.',
      },
    })
  }

  // 5. Fallback / Erro
  if (!stats.hasFallback) {
    issues.push({
      id: 'no_fallback',
      pillar: 'fallback',
      severity: 'warning',
      title: 'Sem instrução para casos que o agente não sabe',
      message:
        'O prompt não orienta o que fazer quando o agente NÃO souber a resposta. Isso leva à alucinação ("inventar" respostas).',
      source: 'static',
      suggestion: {
        label: 'Adicionar política de "não sei"',
        instruction:
          'Adicione uma regra explícita: "Se você não tiver certeza sobre a informação, diga isso claramente e ofereça transferir para um atendente humano. Nunca invente dados."',
      },
    })
  }

  // 6. Exemplos
  if (!stats.hasExamples && stats.words > 80) {
    issues.push({
      id: 'no_examples',
      pillar: 'examples',
      severity: 'info',
      title: 'Nenhum exemplo de conversa',
      message:
        'Prompts com 1-2 exemplos de diálogo (few-shot) costumam dobrar a qualidade das respostas. Considere incluir um bloco "Exemplo:" com entrada do cliente e saída ideal.',
      source: 'static',
      suggestion: {
        label: 'Sugerir estrutura de exemplos',
        instruction:
          'Adicione uma seção "## Exemplos" no final com 1-2 exemplos curtos no formato:\n\n```\nCliente: <pergunta típica>\nAgente: <resposta ideal>\n```\nPreserve o resto do prompt.',
      },
    })
  }

  // 7. Tom
  if (!stats.hasTone) {
    issues.push({
      id: 'no_tone',
      pillar: 'tone',
      severity: 'info',
      title: 'Tom de voz não especificado',
      message:
        'Não há indicação se o agente deve ser formal, descontraído, acolhedor, técnico... Sem isso, cada resposta pode variar.',
      source: 'static',
      suggestion: {
        label: 'Adicionar tom',
        instruction:
          'Adicione uma linha especificando o tom: "Tom: profissional, acolhedor e objetivo. Use emojis com moderação." Preserve o resto.',
      },
    })
  }

  // 8. Estrutura
  if (stats.sections === 0 && stats.words > 120) {
    issues.push({
      id: 'no_structure',
      pillar: 'structure',
      severity: 'info',
      title: 'Prompt sem seções/títulos',
      message:
        'Prompts longos sem títulos (`## Objetivo`, `## Regras`, `## Exemplos`) são mais difíceis para a IA navegar. Markdown ajuda.',
      source: 'static',
      suggestion: {
        label: 'Organizar em seções',
        instruction:
          'Reorganize o prompt em seções com títulos markdown: "## Papel", "## Objetivo", "## Regras", "## Exemplos". Preserve TODO o conteúdo existente, só reorganize.',
      },
    })
  }

  // 9. Frases vagas ("seja legal", "responda bem")
  const vaguePatterns = [
    { re: /\bseja (legal|bom|bonzinho|simp[aá]tico)\b/i, hint: '"seja legal" é vago — defina o tom concretamente.' },
    { re: /\bresponda (bem|direito|corretamente)\b/i, hint: '"responda bem" é vago — defina critérios do que é uma boa resposta.' },
    { re: /\bajude (o|a) (cliente|usu[aá]rio)\b/i, hint: '"ajude o cliente" é genérico — especifique COM O QUE você quer ajudar.' },
    { re: /\bfale (de forma|jeito) natural\b/i, hint: '"fale de forma natural" é vago — defina exemplos de frases.' },
  ]
  for (const { re, hint } of vaguePatterns) {
    const m = text.match(re)
    if (m) {
      issues.push({
        id: `vague_${m[0].toLowerCase().replace(/\s+/g, '_').slice(0, 20)}`,
        pillar: 'quality',
        severity: 'warning',
        title: 'Instrução vaga detectada',
        message: hint,
        excerpt: m[0],
        source: 'static',
        suggestion: {
          label: 'Trocar por algo específico',
          instruction: `Substitua a instrução vaga "${m[0]}" por algo concreto e mensurável, mantendo o sentido original. Preserve o resto do prompt.`,
        },
      })
    }
  }

  // 10. Contradições óbvias (tamanho)
  if (/\bseja breve\b/i.test(text) && /\b(exemplos? completos?|detalhadamente|explique tudo)\b/i.test(text)) {
    issues.push({
      id: 'contradiction_brevity',
      pillar: 'quality',
      severity: 'warning',
      title: 'Contradição: brevidade vs. detalhamento',
      message: 'O prompt pede ao mesmo tempo "seja breve" e "detalhadamente/explique tudo". Escolha um.',
      source: 'static',
    })
  }

  // 11. Placeholders sem chave fechada ou malformados
  const malformed = text.match(/\{[^}\n]{0,80}$|\}[^{]*\}/gm)
  if (malformed && malformed.length > 0) {
    issues.push({
      id: 'malformed_placeholder',
      pillar: 'variables',
      severity: 'warning',
      title: 'Possível variável malformada',
      message: `Encontrei algo que parece uma variável mas pode estar quebrada: ${malformed[0].slice(0, 50)}`,
      excerpt: malformed[0],
      source: 'static',
    })
  }

  // 12. Placeholders desconhecidos (fora do padrão)
  const knownVars = new Set([
    '{contact_name}',
    '{current_datetime}',
    '{current_date}',
    '{current_time}',
    '{current_day_of_week}',
    '{remote_jid}',
  ])
  for (const ph of stats.uniquePlaceholders) {
    if (!knownVars.has(ph)) {
      issues.push({
        id: `unknown_var_${ph.replace(/[^a-z0-9]/gi, '_')}`,
        pillar: 'variables',
        severity: 'info',
        title: `Variável desconhecida: ${ph}`,
        message: `A variável ${ph} não é padrão do sistema. Verifique se está no formato correto (ex: {contact_name}).`,
        excerpt: ph,
        source: 'static',
      })
    }
  }

  // 13. Prompt com emojis demais
  const emojiCount = countMatches(text, /[\p{Extended_Pictographic}]/gu)
  if (emojiCount > 20 && emojiCount > stats.words * 0.1) {
    issues.push({
      id: 'too_many_emojis',
      pillar: 'tone',
      severity: 'info',
      title: 'Muitos emojis',
      message: `${emojiCount} emojis detectados. Em prompts de sistema, emojis em excesso atrapalham a IA. Prefira texto estruturado.`,
      source: 'static',
    })
  }

  // 14. Caps lock excessivo (frases inteiras)
  const allCapsSentences = text.match(/[A-Z]{12,}/g)
  if (allCapsSentences && allCapsSentences.length > 2) {
    const sample = extractFirstMatch(text, /[A-Z]{12,}/)
    issues.push({
      id: 'too_much_caps',
      pillar: 'tone',
      severity: 'info',
      title: 'Uso excessivo de CAIXA ALTA',
      message:
        'Muitas palavras em CAIXA ALTA. Para dar ênfase, prefira negrito (**importante**) ou bullet points.',
      excerpt: sample,
      source: 'static',
    })
  }

  // 15. Prompt super longo (pode derrubar contexto)
  if (stats.words > 1500) {
    issues.push({
      id: 'too_long',
      pillar: 'quality',
      severity: 'warning',
      title: 'Prompt muito extenso',
      message: `${stats.words} palavras. Prompts acima de ~1500 palavras consomem muito contexto e podem reduzir a atenção da IA ao que importa. Considere dividir em um agente principal + conhecimento via RAG.`,
      source: 'static',
    })
  }

  return issues
}

// ─── Helpers públicos ────────────────────────────────────────

export function pillarLabel(pillar: CoachPillar): string {
  switch (pillar) {
    case 'role':
      return 'Papel / Persona'
    case 'goal':
      return 'Objetivo'
    case 'rules':
      return 'Regras / Limites'
    case 'tone':
      return 'Tom / Estilo'
    case 'structure':
      return 'Estrutura'
    case 'examples':
      return 'Exemplos'
    case 'variables':
      return 'Variáveis'
    case 'fallback':
      return 'Tratamento de erros'
    case 'flow':
      return 'Fluxo / CTA'
    case 'quality':
      return 'Qualidade da redação'
  }
}
