import { ModuleDefinition } from '../types.js'

export const financeiroModule: ModuleDefinition = {
  slug: 'financeiro',
  name: 'Financeiro / Cobrança',
  description: 'Módulo para empresas de cobrança, recuperação de crédito e gestão financeira',
  icon: 'Landmark',
  category: 'financeiro',

  customFields: [
    { target: 'card', key: 'numero_contrato', label: 'Nº do Contrato', type: 'text', group: 'Contrato' },
    { target: 'card', key: 'tipo_divida', label: 'Tipo de Dívida', type: 'select', options: ['Boleto', 'Empréstimo', 'Cartão de Crédito', 'Financiamento', 'Cheque', 'Duplicata', 'Mensalidade', 'Outro'], group: 'Contrato' },
    { target: 'card', key: 'valor_original', label: 'Valor Original', type: 'currency', group: 'Financeiro' },
    { target: 'card', key: 'valor_atualizado', label: 'Valor Atualizado', type: 'currency', group: 'Financeiro' },
    { target: 'card', key: 'data_vencimento', label: 'Data de Vencimento', type: 'date', group: 'Financeiro' },
    { target: 'card', key: 'dias_atraso', label: 'Dias em Atraso', type: 'number', group: 'Financeiro' },
    { target: 'card', key: 'desconto_oferecido', label: 'Desconto Oferecido (%)', type: 'number', group: 'Negociação' },
    { target: 'card', key: 'valor_acordo', label: 'Valor do Acordo', type: 'currency', group: 'Negociação' },
    { target: 'card', key: 'parcelas_acordo', label: 'Parcelas do Acordo', type: 'number', group: 'Negociação' },
    { target: 'card', key: 'data_primeiro_pagamento', label: 'Data 1º Pagamento', type: 'date', group: 'Negociação' },
    { target: 'card', key: 'credor', label: 'Credor/Empresa', type: 'text', group: 'Origem' },
    { target: 'contact', key: 'cpf_cnpj', label: 'CPF/CNPJ', type: 'text' },
    { target: 'contact', key: 'score_credito', label: 'Score de Crédito', type: 'number' },
  ],

  pipelineTemplates: [{
    name: 'Cobrança e Recuperação',
    type: 'collection',
    description: 'Pipeline de recuperação de crédito e negociação de dívidas',
    stages: [
      { name: 'Identificação', slug: 'identificacao', color: '#6366f1', position: 0 },
      { name: 'Primeiro Contato', slug: 'primeiro-contato', color: '#8b5cf6', position: 1 },
      { name: 'Negociação', slug: 'negociacao', color: '#f59e0b', position: 2 },
      { name: 'Acordo Proposto', slug: 'acordo-proposto', color: '#f97316', position: 3 },
      { name: 'Acordo Firmado', slug: 'acordo-firmado', color: '#3b82f6', position: 4 },
      { name: 'Pagamento Confirmado', slug: 'pagamento-confirmado', color: '#22c55e', position: 5, isWon: true },
      { name: 'Inadimplente', slug: 'inadimplente', color: '#ef4444', position: 6, isLost: true },
    ],
  }],

  stageValidations: [
    {
      stageSlug: 'acordo-proposto',
      rules: [
        { field: 'valor_acordo', operator: 'not_empty', message: 'Informe o valor do acordo' },
        { field: 'parcelas_acordo', operator: 'not_empty', message: 'Informe o número de parcelas' },
      ],
    },
  ],

  cardActions: [
    { key: 'send_boleto', label: 'Enviar Boleto', icon: 'Receipt' },
    { key: 'register_payment', label: 'Registrar Pagamento', icon: 'DollarSign' },
    { key: 'send_reminder', label: 'Enviar Lembrete', icon: 'Bell' },
  ],

  sidebarMenus: [
    { label: 'Cobranças', icon: 'Landmark', path: '/cobrancas', position: 50, section: 'modules' },
  ],

  cardTabs: [
    { key: 'financeiro', label: 'Financeiro', icon: 'Landmark', position: 10 },
    { key: 'pagamentos', label: 'Pagamentos', icon: 'DollarSign', position: 11 },
  ],

  dashboardWidgets: [
    { key: 'recovery_rate', label: 'Taxa de Recuperação', size: 'sm', position: 0 },
    { key: 'total_collected', label: 'Total Recuperado', size: 'sm', position: 1 },
    { key: 'overdue_aging', label: 'Aging de Inadimplência', size: 'lg', position: 2 },
  ],
}
