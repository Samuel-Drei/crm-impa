import { ModuleDefinition } from '../types.js'

export const clinicaEsteticaModule: ModuleDefinition = {
  slug: 'clinica-estetica',
  name: 'Clínica de Estética',
  description: 'Módulo para clínicas de estética, dermatologia e procedimentos estéticos',
  icon: 'Heart',
  category: 'saude',

  customFields: [
    { target: 'card', key: 'procedimento', label: 'Procedimento', type: 'select', options: ['Botox', 'Preenchimento', 'Peeling', 'Laser', 'Lipo', 'Harmonização Facial', 'Depilação', 'Microagulhamento', 'Drenagem', 'Outro'], group: 'Procedimento' },
    { target: 'card', key: 'area_tratamento', label: 'Área de Tratamento', type: 'text', group: 'Procedimento' },
    { target: 'card', key: 'num_sessoes', label: 'Nº de Sessões', type: 'number', group: 'Procedimento' },
    { target: 'card', key: 'sessoes_realizadas', label: 'Sessões Realizadas', type: 'number', group: 'Procedimento' },
    { target: 'card', key: 'data_proxima_sessao', label: 'Próxima Sessão', type: 'date', group: 'Agendamento' },
    { target: 'card', key: 'profissional', label: 'Profissional', type: 'text', group: 'Agendamento' },
    { target: 'card', key: 'anamnese', label: 'Anamnese', type: 'textarea', group: 'Clínico' },
    { target: 'card', key: 'alergias', label: 'Alergias', type: 'text', group: 'Clínico' },
    { target: 'card', key: 'contraindicacoes', label: 'Contraindicações', type: 'textarea', group: 'Clínico' },
    { target: 'card', key: 'forma_pagamento', label: 'Forma de Pagamento', type: 'select', options: ['Dinheiro', 'Cartão Crédito', 'Cartão Débito', 'PIX', 'Boleto', 'Parcelado'], group: 'Financeiro' },
    { target: 'contact', key: 'data_nascimento', label: 'Data de Nascimento', type: 'date' },
    { target: 'contact', key: 'tipo_pele', label: 'Tipo de Pele', type: 'select', options: ['Normal', 'Oleosa', 'Seca', 'Mista', 'Sensível'] },
  ],

  pipelineTemplates: [{
    name: 'Atendimento Estético',
    type: 'clinic',
    description: 'Jornada do paciente desde o agendamento até o acompanhamento pós-procedimento',
    stages: [
      { name: 'Agendamento', slug: 'agendamento', color: '#6366f1', position: 0 },
      { name: 'Avaliação', slug: 'avaliacao', color: '#8b5cf6', position: 1 },
      { name: 'Orçamento', slug: 'orcamento', color: '#f59e0b', position: 2 },
      { name: 'Em Tratamento', slug: 'em-tratamento', color: '#3b82f6', position: 3 },
      { name: 'Retorno', slug: 'retorno', color: '#10b981', position: 4 },
      { name: 'Concluído', slug: 'concluido', color: '#22c55e', position: 5, isWon: true },
      { name: 'Desistência', slug: 'desistencia', color: '#ef4444', position: 6, isLost: true },
    ],
  }],

  stageValidations: [
    {
      stageSlug: 'em-tratamento',
      rules: [
        { field: 'procedimento', operator: 'not_empty', message: 'Selecione o procedimento antes de iniciar o tratamento' },
      ],
    },
  ],

  cardActions: [
    { key: 'schedule_session', label: 'Agendar Sessão', icon: 'Calendar' },
    { key: 'record_session', label: 'Registrar Sessão', icon: 'ClipboardCheck' },
    { key: 'send_reminder', label: 'Enviar Lembrete', icon: 'Bell' },
  ],

  sidebarMenus: [
    { label: 'Pacientes', icon: 'Heart', path: '/pacientes', position: 50, section: 'modules' },
    { label: 'Agenda', icon: 'Calendar', path: '/agenda-clinica', position: 51, section: 'modules' },
  ],

  cardTabs: [
    { key: 'prontuario', label: 'Prontuário', icon: 'ClipboardList', position: 10 },
    { key: 'sessoes', label: 'Sessões', icon: 'Calendar', position: 11 },
  ],

  dashboardWidgets: [
    { key: 'todays_appointments', label: 'Agenda do Dia', size: 'md', position: 0 },
    { key: 'procedures_summary', label: 'Procedimentos do Mês', size: 'md', position: 1 },
  ],
}
