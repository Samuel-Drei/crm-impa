/**
 * Contexto do CRM IMPA injetado no system prompt do "Designer de Funcionários".
 *
 * Esse arquivo descreve, de forma condensada, o que existe no CRM e quais tools
 * cada funcionário pode ganhar. O builder LLM usa isso pra recomendar tools
 * relevantes ao role (vendedor → kanban+contatos, suporte → tickets+conversas, etc).
 */

export const AVAILABLE_FLEET_TOOLS = [
  // === Auto-configuração ===
  'configure_self',
  // === Contatos / Leads / Empresas ===
  'list_contacts', 'create_lead', 'update_contact_admin',
  // === Conversas (WhatsApp / Chat) ===
  'list_conversations', 'search_messages', 'get_conversation_messages', 'list_recent_messages',
  // === Pipeline / Kanban ===
  'list_pipelines', 'list_kanban_cards', 'create_kanban_card', 'move_kanban_card',
  // === Time / Permissões ===
  'list_users', 'list_teams_admin', 'notify_user',
  // === Tickets ===
  'create_ticket', 'list_tickets',
  // === Dashboard ===
  'get_dashboard_metrics',
  // === WhatsApp ===
  'list_instances', 'send_whatsapp_message',
  // === Catálogo ===
  'list_products', 'create_product',
  // === Auto-agendamento (Missões) ===
  'list_my_missions', 'create_mission',
  // === Delegação entre membros ===
  'list_fleet_members', 'spawn_subagent',
  // === Raciocínio ===
  'think', 'update_todos',
] as const

export type AvailableFleetTool = typeof AVAILABLE_FLEET_TOOLS[number]

/**
 * Descrições curtas e práticas — o builder mostra isso pro LLM
 * pra que ele recomende tools com critério (não tudo de uma vez).
 */
export const TOOL_DESCRIPTIONS: Record<AvailableFleetTool, string> = {
  configure_self: 'Permite o próprio funcionário ajustar sua personalidade durante o onboarding inicial. Sempre incluir.',
  list_contacts: 'Lista contatos/leads do CRM com filtros (nome, email, status, tags).',
  create_lead: 'Cadastra um novo lead. Útil pra vendas, captação, SDRs.',
  update_contact_admin: 'Atualiza dados de contato existente (nome, telefone, status, tags). Útil pra higienização.',
  list_conversations: 'Lista conversas de WhatsApp/chat. Útil pra atendimento e supervisão.',
  search_messages: 'Busca texto livre dentro das conversas. Útil pra auditoria, FAQ-mining, supervisão.',
  get_conversation_messages: 'Lê o transcript completo de uma conversa/grupo específico. Essencial para analisar contexto antes de responder ou resumir problemas de um grupo.',
  list_recent_messages: 'Lista mensagens recentes sem exigir palavra-chave. Útil para ver o que aconteceu nas últimas horas em conversas ou grupos.',
  list_pipelines: 'Lista os pipelines de venda existentes (funis).',
  list_kanban_cards: 'Lista cards de um pipeline com filtros (estágio, responsável, valor).',
  create_kanban_card: 'Cria um novo card no kanban (oportunidade/negócio). Útil pra vendas.',
  move_kanban_card: 'Move card entre estágios. Útil pra automação de funil.',
  list_users: 'Lista usuários humanos da empresa.',
  list_teams_admin: 'Lista times/squads.',
  notify_user: 'Manda notificação interna pra um humano específico. Útil pra escalonamento.',
  create_ticket: 'Abre ticket de suporte/TI. Útil pra suporte L1/L2.',
  list_tickets: 'Lista tickets abertos com filtros.',
  get_dashboard_metrics: 'Retorna métricas agregadas (vendas, atendimento, financeiro). Útil pra analistas e gestores.',
  list_instances: 'Lista instâncias de WhatsApp conectadas.',
  send_whatsapp_message: 'Envia mensagem de WhatsApp via instância. Útil pra automação de follow-up, broadcast direcionado, lembretes.',
  list_products: 'Lista catálogo de produtos/serviços.',
  create_product: 'Cadastra produto no catálogo. Útil pra ops/comercial.',
  list_my_missions: 'O próprio funcionário lista suas missões agendadas (cron).',
  create_mission: 'O próprio funcionário cria missão recorrente (ex: "todo dia às 9h, gere relatório"). Pode usar linguagem natural pra agendar.',
  list_fleet_members: 'Lista outros membros ativos da Fleet para delegação de subtarefas. Útil para coordenadores e operações multiárea.',
  spawn_subagent: 'Delega uma subtarefa a outro membro da Fleet e retorna o resultado. Use só quando outro membro tem expertise melhor ou quando dividir trabalho reduz complexidade.',
  think: 'Tool de raciocínio — força o LLM a pensar passo-a-passo antes de responder. Útil pra agentes que tomam decisões complexas.',
  update_todos: 'Cria/atualiza checklist visível no chat pra tarefas com 3+ passos. Útil pra missões longas, batch operations.',
}

/**
 * Templates curados — o builder pode sugerir um deles como ponto de partida
 * quando o admin descreve um role conhecido.
 */
export interface FleetTemplate {
  id: string
  match: string[]              // palavras-chave do role
  name: string
  displayRole: string
  emoji: string
  colorTag: string
  recommendedTools: AvailableFleetTool[]
  systemPromptHint: string     // o LLM vai expandir, não é o prompt final
  temperature: number
}

export const FLEET_TEMPLATES: FleetTemplate[] = [
  {
    id: 'sdr',
    match: ['sdr', 'pré-venda', 'pre-venda', 'qualificação', 'caçador', 'prospect'],
    name: 'SDR',
    displayRole: 'SDR — Pré-Vendas',
    emoji: '🎯',
    colorTag: '#8b5cf6',
    recommendedTools: [
      'configure_self', 'list_contacts', 'create_lead', 'update_contact_admin',
      'list_conversations', 'search_messages', 'get_conversation_messages', 'list_recent_messages',
      'list_pipelines', 'list_kanban_cards', 'create_kanban_card', 'move_kanban_card',
      'send_whatsapp_message', 'create_mission', 'list_fleet_members', 'spawn_subagent', 'think', 'update_todos',
    ],
    systemPromptHint: 'Profissional de pré-vendas focado em qualificar leads, agendar reuniões e mover oportunidades no funil. Tom direto, consultivo, com foco em descobrir dor.',
    temperature: 0.7,
  },
  {
    id: 'closer',
    match: ['closer', 'vendedor', 'executivo de venda', 'consultor de venda', 'fechador'],
    name: 'Vendedor',
    displayRole: 'Closer — Fechamento',
    emoji: '💼',
    colorTag: '#10b981',
    recommendedTools: [
      'configure_self', 'list_contacts', 'update_contact_admin',
      'list_conversations', 'search_messages', 'get_conversation_messages', 'list_recent_messages',
      'list_pipelines', 'list_kanban_cards', 'create_kanban_card', 'move_kanban_card',
      'list_products', 'send_whatsapp_message', 'notify_user', 'think', 'update_todos',
    ],
    systemPromptHint: 'Vendedor experiente focado em fechamento. Sabe quando avançar, quando recuar, e quando escalar pra um humano. Conhece o catálogo a fundo.',
    temperature: 0.6,
  },
  {
    id: 'support_l1',
    match: ['suporte', 'atendimento', 'sac', 'help desk', 'l1', 'customer success', 'cs'],
    name: 'Suporte',
    displayRole: 'Suporte L1',
    emoji: '🎧',
    colorTag: '#3b82f6',
    recommendedTools: [
      'configure_self', 'list_contacts',
      'list_conversations', 'search_messages', 'get_conversation_messages', 'list_recent_messages',
      'create_ticket', 'list_tickets', 'notify_user',
      'send_whatsapp_message', 'think', 'update_todos',
    ],
    systemPromptHint: 'Atendente de primeiro nível. Empático, paciente, resolve dúvidas comuns e escalona o que não consegue resolver. Sempre cria ticket pra rastreabilidade.',
    temperature: 0.5,
  },
  {
    id: 'analyst',
    match: ['analista', 'bi', 'dados', 'relatório', 'reporting', 'gestor'],
    name: 'Analista',
    displayRole: 'Analista de Dados',
    emoji: '📊',
    colorTag: '#f59e0b',
    recommendedTools: [
      'configure_self', 'get_dashboard_metrics',
      'list_pipelines', 'list_kanban_cards', 'list_tickets',
      'list_contacts', 'list_conversations', 'search_messages', 'get_conversation_messages', 'list_recent_messages',
      'create_mission', 'list_my_missions', 'notify_user',
      'list_fleet_members', 'spawn_subagent', 'think', 'update_todos',
    ],
    systemPromptHint: 'Analista cético, baseado em dados. Sempre puxa números antes de opinar. Gera relatórios concisos com insights, não com vômito de tabelas. Sabe agendar relatórios recorrentes.',
    temperature: 0.3,
  },
  {
    id: 'ops',
    match: ['operação', 'operações', 'ops', 'admin', 'cadastro', 'higienização'],
    name: 'Operações',
    displayRole: 'Analista de Operações',
    emoji: '⚙️',
    colorTag: '#6366f1',
    recommendedTools: [
      'configure_self', 'list_contacts', 'update_contact_admin', 'create_lead',
      'list_products', 'create_product',
      'list_kanban_cards', 'move_kanban_card',
      'list_users', 'list_teams_admin', 'notify_user',
      'create_mission', 'list_my_missions',
      'list_fleet_members', 'spawn_subagent', 'think', 'update_todos',
    ],
    systemPromptHint: 'Profissional de operações focado em higienização de cadastro, automações, tarefas em lote. Metódico, valida antes de executar mudanças em massa.',
    temperature: 0.4,
  },
  {
    id: 'integrator',
    match: ['integração', 'webhook', 'api', 'http', 'integrador', 'no-code', 'automação externa'],
    name: 'Integrador',
    displayRole: 'Integrador / Automações Externas',
    emoji: '🔌',
    colorTag: '#06b6d4',
    recommendedTools: [
      'configure_self', 'list_contacts', 'update_contact_admin',
      'create_kanban_card', 'move_kanban_card',
      'notify_user', 'create_mission', 'list_my_missions',
      'list_fleet_members', 'spawn_subagent', 'think', 'update_todos',
    ],
    systemPromptHint: 'Especialista em conectar o CRM com sistemas externos via HTTP. Sabe ler documentação de API, montar requests, tratar erros. Use a ferramenta http_request quando o admin configurar.',
    temperature: 0.4,
  },
]

export function findMatchingTemplate(text: string): FleetTemplate | null {
  const t = text.toLowerCase()
  for (const tpl of FLEET_TEMPLATES) {
    if (tpl.match.some(kw => t.includes(kw.toLowerCase()))) return tpl
  }
  return null
}

/**
 * Bloco de contexto CRM injetado no system prompt do builder.
 * Mantém em string única (não array) pra economizar tokens com escapes.
 */
export const CRM_CONTEXT_BLOCK = `
=== CONTEXTO DO CRM IMPA ===

O CRM IMPA é um sistema completo com os seguintes módulos:
• **Contatos & Leads:** cadastro de pessoas/empresas, status (lead, prospect, cliente), tags personalizadas.
• **Pipeline / Kanban:** funis de venda com estágios customizáveis. Cards = oportunidades.
• **Conversas:** WhatsApp multi-instância + chat interno. Mensagens persistidas.
• **Tickets:** suporte/TI com filas e SLA.
• **Catálogo:** produtos/serviços com preço, descrição, imagem.
• **Missões:** tarefas recorrentes (cron) que o próprio funcionário AI agenda pra si.
• **Dashboard:** métricas agregadas de vendas, atendimento, financeiro.
• **Time:** usuários humanos, times, permissões granulares (RBAC).

=== FERRAMENTAS QUE O FUNCIONÁRIO PODE GANHAR ===

${AVAILABLE_FLEET_TOOLS.map(t => `• ${t}: ${TOOL_DESCRIPTIONS[t]}`).join('\n')}

=== HTTP REQUEST (avançado, opcional) ===

O funcionário também pode receber ferramentas HTTP customizadas (estilo n8n) que chamam APIs externas — útil pra integrar com Notion, Slack, GitHub, ERPs, etc. Você NÃO precisa configurar isso aqui no chat: depois que o funcionário for criado, o admin pode adicionar via UI. Se o admin pedir explicitamente "quero que ele chame a API X", recomende incluir a tool 'http_request' no membro e diga que ele configure os endpoints específicos depois no painel "Ferramentas Avançadas".

=== TEMPLATES CONHECIDOS (use como inspiração, não copie cego) ===

${FLEET_TEMPLATES.map(t => `• ${t.id} (${t.displayRole}): ${t.systemPromptHint}`).join('\n')}

=== HEURÍSTICAS DE RECOMENDAÇÃO ===

• Quem fala com cliente externo (vendedor, suporte) → precisa de send_whatsapp_message + list_conversations.
• Quem analisa grupos, faz auditoria ou precisa resumir histórico → get_conversation_messages + list_recent_messages + search_messages.
• Quem mexe em funil → list_pipelines + list_kanban_cards + move_kanban_card + create_kanban_card.
• Quem tem trabalho repetitivo/agendado → create_mission + list_my_missions.
• Quem toma decisão complexa → think + update_todos.
• Quem produz relatório → get_dashboard_metrics + list_kanban_cards + list_tickets.
• Quem coordena múltiplas áreas, faz tarefas longas ou depende de especialista → list_fleet_members + spawn_subagent.
• Quem faz integração externa → recomende http_request (admin configura depois).
• NUNCA dê todas as tools disponíveis. Selecione 6-12 relevantes ao role. Tools demais = LLM confusa.
• SEMPRE inclua: configure_self, think, update_todos por padrão.
• Para cargos operacionais, o prompt gerado DEVE reforçar: execute com tools quando o pedido for claro, não prometa sem executar, confirme só depois de success=true e peça aprovação para ações sensíveis/em massa.
`.trim()
