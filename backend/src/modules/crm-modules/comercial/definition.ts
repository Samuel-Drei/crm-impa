import { ModuleDefinition } from '../types.js'

export const comercialModule: ModuleDefinition = {
  slug: 'comercial',
  name: 'Comercial',
  description: 'Pipeline de vendas com gestão de oportunidades e funil comercial',
  icon: 'Briefcase',
  category: 'vendas',

  customFields: [
    { target: 'card', key: 'empresa_prospect', label: 'Empresa', type: 'text', group: 'Comercial', placeholder: 'Nome da empresa' },
    { target: 'card', key: 'cargo_decisor', label: 'Cargo do Decisor', type: 'text', group: 'Comercial' },
    { target: 'card', key: 'origem_lead', label: 'Origem do Lead', type: 'select', options: ['Site', 'Indicação', 'Redes Sociais', 'Google Ads', 'Cold Call', 'Evento', 'WhatsApp', 'Outro'], group: 'Comercial' },
    { target: 'card', key: 'produto_interesse', label: 'Produto/Serviço', type: 'text', group: 'Comercial' },
    { target: 'card', key: 'probabilidade_fechamento', label: 'Probabilidade (%)', type: 'number', group: 'Comercial' },
    { target: 'card', key: 'concorrente', label: 'Concorrente', type: 'text', group: 'Comercial' },
    { target: 'card', key: 'proxima_acao', label: 'Próxima Ação', type: 'text', group: 'Acompanhamento' },
    { target: 'card', key: 'data_proxima_acao', label: 'Data Próxima Ação', type: 'date', group: 'Acompanhamento' },
    { target: 'contact', key: 'cnpj', label: 'CNPJ', type: 'text' },
    { target: 'contact', key: 'segmento', label: 'Segmento', type: 'select', options: ['Tecnologia', 'Varejo', 'Indústria', 'Serviços', 'Saúde', 'Educação', 'Financeiro', 'Outro'] },
  ],

  pipelineTemplates: [{
    name: 'Funil de Vendas',
    type: 'sales',
    description: 'Pipeline comercial padrão com etapas de qualificação até fechamento',
    stages: [
      { name: 'Novo Lead', slug: 'novo-lead', color: '#6366f1', position: 0 },
      { name: 'Qualificação', slug: 'qualificacao', color: '#8b5cf6', position: 1 },
      { name: 'Apresentação', slug: 'apresentacao', color: '#a855f7', position: 2 },
      { name: 'Proposta', slug: 'proposta', color: '#f59e0b', position: 3 },
      { name: 'Negociação', slug: 'negociacao', color: '#f97316', position: 4 },
      { name: 'Fechamento', slug: 'fechamento', color: '#22c55e', position: 5, isWon: true },
      { name: 'Perdido', slug: 'perdido', color: '#ef4444', position: 6, isLost: true },
    ],
  }],

  stageValidations: [
    {
      stageSlug: 'proposta',
      rules: [
        { field: 'value', operator: 'not_empty', message: 'Informe o valor da proposta antes de mover para Proposta' },
      ],
    },
  ],

  cardActions: [
    { key: 'send_proposal', label: 'Enviar Proposta', icon: 'FileText' },
    { key: 'schedule_meeting', label: 'Agendar Reunião', icon: 'Calendar' },
    { key: 'follow_up', label: 'Follow-up', icon: 'PhoneForwarded' },
  ],

  cardTabs: [
    { key: 'comercial', label: 'Comercial', icon: 'Briefcase', position: 10 },
  ],

  dashboardWidgets: [
    { key: 'sales_funnel', label: 'Funil de Vendas', size: 'lg', position: 0 },
    { key: 'conversion_rate', label: 'Taxa de Conversão', size: 'sm', position: 1 },
    { key: 'monthly_revenue', label: 'Receita Mensal', size: 'md', position: 2 },
  ],
}
