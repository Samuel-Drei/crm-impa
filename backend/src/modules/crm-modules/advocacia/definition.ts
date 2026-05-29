import { ModuleDefinition } from '../types.js'

export const advocaciaModule: ModuleDefinition = {
  slug: 'advocacia',
  name: 'Advocacia',
  description: 'Módulo para escritórios de advocacia e departamentos jurídicos',
  icon: 'Scale',
  category: 'juridico',

  customFields: [
    { target: 'card', key: 'numero_processo', label: 'Nº do Processo', type: 'text', group: 'Processo', placeholder: '0000000-00.0000.0.00.0000' },
    { target: 'card', key: 'tipo_acao', label: 'Tipo de Ação', type: 'select', options: ['Cível', 'Trabalhista', 'Criminal', 'Família', 'Tributário', 'Previdenciário', 'Consumidor', 'Empresarial'], group: 'Processo' },
    { target: 'card', key: 'vara_tribunal', label: 'Vara/Tribunal', type: 'text', group: 'Processo' },
    { target: 'card', key: 'comarca', label: 'Comarca', type: 'text', group: 'Processo' },
    { target: 'card', key: 'fase_processual', label: 'Fase Processual', type: 'select', options: ['Conhecimento', 'Execução', 'Recurso', 'Cumprimento de Sentença', 'Liquidação'], group: 'Processo' },
    { target: 'card', key: 'data_audiencia', label: 'Data da Audiência', type: 'date', group: 'Audiência' },
    { target: 'card', key: 'tipo_audiencia', label: 'Tipo de Audiência', type: 'select', options: ['Conciliação', 'Instrução', 'Julgamento', 'Custódia'], group: 'Audiência' },
    { target: 'card', key: 'honorarios', label: 'Honorários', type: 'currency', group: 'Financeiro' },
    { target: 'card', key: 'valor_causa', label: 'Valor da Causa', type: 'currency', group: 'Financeiro' },
    { target: 'card', key: 'parte_contraria', label: 'Parte Contrária', type: 'text', group: 'Partes' },
    { target: 'card', key: 'advogado_contrario', label: 'Advogado Contrário', type: 'text', group: 'Partes' },
    { target: 'contact', key: 'cpf_cnpj', label: 'CPF/CNPJ', type: 'text' },
    { target: 'contact', key: 'oab', label: 'OAB', type: 'text' },
    { target: 'contact', key: 'rg', label: 'RG', type: 'text' },
  ],

  pipelineTemplates: [{
    name: 'Processo Jurídico',
    type: 'legal',
    description: 'Acompanhamento de processos jurídicos da consulta à sentença',
    stages: [
      { name: 'Consulta Inicial', slug: 'consulta-inicial', color: '#6366f1', position: 0 },
      { name: 'Análise Documental', slug: 'analise-documental', color: '#8b5cf6', position: 1 },
      { name: 'Petição Inicial', slug: 'peticao-inicial', color: '#a855f7', position: 2 },
      { name: 'Citação/Intimação', slug: 'citacao-intimacao', color: '#d946ef', position: 3 },
      { name: 'Audiência', slug: 'audiencia', color: '#f59e0b', position: 4 },
      { name: 'Sentença Favorável', slug: 'sentenca-favoravel', color: '#22c55e', position: 5, isWon: true },
      { name: 'Arquivado/Perdido', slug: 'arquivado-perdido', color: '#ef4444', position: 6, isLost: true },
    ],
  }],

  stageValidations: [
    {
      stageSlug: 'peticao-inicial',
      rules: [
        { field: 'tipo_acao', operator: 'not_empty', message: 'Selecione o tipo de ação antes de protocolar a Petição Inicial' },
      ],
    },
    {
      stageSlug: 'audiencia',
      rules: [
        { field: 'numero_processo', operator: 'not_empty', message: 'Informe o nº do processo antes de mover para Audiência' },
        { field: 'data_audiencia', operator: 'not_empty', message: 'Defina a data da audiência' },
      ],
    },
  ],

  cardActions: [
    { key: 'log_hearing', label: 'Registrar Audiência', icon: 'Calendar' },
    { key: 'generate_petition', label: 'Gerar Petição', icon: 'FileText' },
    { key: 'check_deadline', label: 'Verificar Prazos', icon: 'Clock' },
  ],

  sidebarMenus: [
    { label: 'Processos', icon: 'Scale', path: '/processos', position: 50, section: 'modules' },
    { label: 'Audiências', icon: 'Calendar', path: '/audiencias', position: 51, section: 'modules' },
  ],

  cardTabs: [
    { key: 'processo', label: 'Processo', icon: 'Scale', position: 10 },
    { key: 'audiencias', label: 'Audiências', icon: 'Calendar', position: 11 },
  ],

  dashboardWidgets: [
    { key: 'upcoming_hearings', label: 'Próximas Audiências', size: 'md', position: 0 },
    { key: 'cases_by_type', label: 'Processos por Tipo', size: 'md', position: 1 },
    { key: 'deadline_alerts', label: 'Alertas de Prazo', size: 'sm', position: 2 },
  ],
}
