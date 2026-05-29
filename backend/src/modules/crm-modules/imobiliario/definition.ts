import { ModuleDefinition } from '../types.js'

export const imobiliarioModule: ModuleDefinition = {
  slug: 'imobiliario',
  name: 'Imobiliário',
  description: 'Módulo para imobiliárias, corretores e construtoras',
  icon: 'Building2',
  category: 'imoveis',

  customFields: [
    { target: 'card', key: 'tipo_imovel', label: 'Tipo de Imóvel', type: 'select', options: ['Apartamento', 'Casa', 'Terreno', 'Sala Comercial', 'Galpão', 'Chácara', 'Lote', 'Cobertura'], group: 'Imóvel' },
    { target: 'card', key: 'finalidade', label: 'Finalidade', type: 'select', options: ['Venda', 'Aluguel', 'Permuta', 'Temporada'], group: 'Imóvel' },
    { target: 'card', key: 'endereco_imovel', label: 'Endereço', type: 'text', group: 'Imóvel' },
    { target: 'card', key: 'bairro', label: 'Bairro', type: 'text', group: 'Imóvel' },
    { target: 'card', key: 'metragem', label: 'Metragem (m²)', type: 'number', group: 'Imóvel' },
    { target: 'card', key: 'quartos', label: 'Quartos', type: 'number', group: 'Imóvel' },
    { target: 'card', key: 'vagas_garagem', label: 'Vagas de Garagem', type: 'number', group: 'Imóvel' },
    { target: 'card', key: 'valor_condominio', label: 'Valor Condomínio', type: 'currency', group: 'Financeiro' },
    { target: 'card', key: 'valor_iptu', label: 'Valor IPTU', type: 'currency', group: 'Financeiro' },
    { target: 'card', key: 'forma_pagamento', label: 'Forma de Pagamento', type: 'select', options: ['À Vista', 'Financiamento', 'FGTS', 'Consórcio', 'Parcelado Direto'], group: 'Financeiro' },
    { target: 'card', key: 'data_visita', label: 'Data da Visita', type: 'date', group: 'Agenda' },
    { target: 'card', key: 'creci_corretor', label: 'CRECI Corretor', type: 'text', group: 'Corretor' },
    { target: 'contact', key: 'cpf_cnpj', label: 'CPF/CNPJ', type: 'text' },
    { target: 'contact', key: 'renda_mensal', label: 'Renda Mensal', type: 'currency' },
  ],

  pipelineTemplates: [{
    name: 'Venda de Imóvel',
    type: 'real_estate',
    description: 'Pipeline de vendas imobiliárias do primeiro contato à escritura',
    stages: [
      { name: 'Primeiro Contato', slug: 'primeiro-contato', color: '#6366f1', position: 0 },
      { name: 'Qualificação', slug: 'qualificacao', color: '#8b5cf6', position: 1 },
      { name: 'Visita Agendada', slug: 'visita-agendada', color: '#3b82f6', position: 2 },
      { name: 'Visita Realizada', slug: 'visita-realizada', color: '#f59e0b', position: 3 },
      { name: 'Proposta', slug: 'proposta', color: '#f97316', position: 4 },
      { name: 'Documentação', slug: 'documentacao', color: '#10b981', position: 5 },
      { name: 'Venda Concluída', slug: 'venda-concluida', color: '#22c55e', position: 6, isWon: true },
      { name: 'Desistência', slug: 'desistencia', color: '#ef4444', position: 7, isLost: true },
    ],
  }],

  stageValidations: [
    {
      stageSlug: 'visita-agendada',
      rules: [
        { field: 'data_visita', operator: 'not_empty', message: 'Defina a data da visita' },
        { field: 'tipo_imovel', operator: 'not_empty', message: 'Selecione o tipo de imóvel' },
      ],
    },
    {
      stageSlug: 'proposta',
      rules: [
        { field: 'value', operator: 'not_empty', message: 'Informe o valor da proposta' },
      ],
    },
  ],

  cardActions: [
    { key: 'schedule_visit', label: 'Agendar Visita', icon: 'MapPin' },
    { key: 'generate_contract', label: 'Gerar Contrato', icon: 'FileText' },
    { key: 'send_photos', label: 'Enviar Fotos', icon: 'Image' },
  ],

  sidebarMenus: [
    { label: 'Imóveis', icon: 'Building2', path: '/imoveis', position: 50, section: 'modules' },
    { label: 'Visitas', icon: 'MapPin', path: '/visitas', position: 51, section: 'modules' },
  ],

  cardTabs: [
    { key: 'imovel', label: 'Imóvel', icon: 'Building2', position: 10 },
    { key: 'visitas', label: 'Visitas', icon: 'MapPin', position: 11 },
  ],

  dashboardWidgets: [
    { key: 'properties_available', label: 'Imóveis Disponíveis', size: 'sm', position: 0 },
    { key: 'visits_this_week', label: 'Visitas da Semana', size: 'md', position: 1 },
    { key: 'sales_by_type', label: 'Vendas por Tipo', size: 'md', position: 2 },
  ],
}
