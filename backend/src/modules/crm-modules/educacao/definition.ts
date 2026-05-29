import { ModuleDefinition } from '../types.js'

export const educacaoModule: ModuleDefinition = {
  slug: 'educacao',
  name: 'Educação',
  description: 'Módulo para escolas, cursos, faculdades e treinamentos corporativos',
  icon: 'GraduationCap',
  category: 'educacao',

  customFields: [
    { target: 'card', key: 'curso_interesse', label: 'Curso de Interesse', type: 'text', group: 'Matrícula' },
    { target: 'card', key: 'modalidade', label: 'Modalidade', type: 'select', options: ['Presencial', 'Online', 'Híbrido', 'EAD'], group: 'Matrícula' },
    { target: 'card', key: 'turno', label: 'Turno', type: 'select', options: ['Manhã', 'Tarde', 'Noite', 'Integral', 'Flexível'], group: 'Matrícula' },
    { target: 'card', key: 'periodo_inicio', label: 'Período de Início', type: 'text', group: 'Matrícula', placeholder: 'Ex: 2026/1' },
    { target: 'card', key: 'bolsa_desconto', label: 'Bolsa/Desconto (%)', type: 'number', group: 'Financeiro' },
    { target: 'card', key: 'forma_pagamento', label: 'Forma de Pagamento', type: 'select', options: ['À Vista', 'Boleto Mensal', 'Cartão Crédito', 'FIES', 'ProUni', 'Bolsa Integral'], group: 'Financeiro' },
    { target: 'card', key: 'data_prova', label: 'Data da Prova/Vestibular', type: 'date', group: 'Processo Seletivo' },
    { target: 'card', key: 'nota_prova', label: 'Nota da Prova', type: 'number', group: 'Processo Seletivo' },
    { target: 'contact', key: 'data_nascimento', label: 'Data de Nascimento', type: 'date' },
    { target: 'contact', key: 'escolaridade', label: 'Escolaridade', type: 'select', options: ['Fundamental', 'Médio', 'Superior Incompleto', 'Superior Completo', 'Pós-graduação'] },
    { target: 'contact', key: 'cpf', label: 'CPF', type: 'text' },
  ],

  pipelineTemplates: [{
    name: 'Captação de Alunos',
    type: 'education',
    description: 'Pipeline de captação de alunos desde o interesse até a matrícula',
    stages: [
      { name: 'Interesse', slug: 'interesse', color: '#6366f1', position: 0 },
      { name: 'Contato Realizado', slug: 'contato-realizado', color: '#8b5cf6', position: 1 },
      { name: 'Visita/Aula Experimental', slug: 'visita-aula', color: '#3b82f6', position: 2 },
      { name: 'Processo Seletivo', slug: 'processo-seletivo', color: '#f59e0b', position: 3 },
      { name: 'Aprovado', slug: 'aprovado', color: '#10b981', position: 4 },
      { name: 'Matriculado', slug: 'matriculado', color: '#22c55e', position: 5, isWon: true },
      { name: 'Desistência', slug: 'desistencia', color: '#ef4444', position: 6, isLost: true },
    ],
  }],

  stageValidations: [
    {
      stageSlug: 'processo-seletivo',
      rules: [
        { field: 'curso_interesse', operator: 'not_empty', message: 'Informe o curso de interesse' },
      ],
    },
  ],

  cardActions: [
    { key: 'schedule_visit', label: 'Agendar Visita', icon: 'Calendar' },
    { key: 'send_material', label: 'Enviar Material', icon: 'BookOpen' },
    { key: 'generate_enrollment', label: 'Gerar Matrícula', icon: 'FileText' },
  ],

  sidebarMenus: [
    { label: 'Alunos', icon: 'GraduationCap', path: '/alunos', position: 50, section: 'modules' },
  ],

  cardTabs: [
    { key: 'academico', label: 'Acadêmico', icon: 'GraduationCap', position: 10 },
  ],

  dashboardWidgets: [
    { key: 'enrollments_month', label: 'Matrículas do Mês', size: 'sm', position: 0 },
    { key: 'courses_demand', label: 'Demanda por Curso', size: 'md', position: 1 },
  ],
}
