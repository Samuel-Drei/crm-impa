import { ModuleDefinition } from '../types.js'

export const ecommerceModule: ModuleDefinition = {
  slug: 'ecommerce',
  name: 'E-commerce',
  description: 'Módulo para lojas online, dropshipping e marketplaces',
  icon: 'ShoppingCart',
  category: 'vendas',

  customFields: [
    { target: 'card', key: 'numero_pedido', label: 'Nº do Pedido', type: 'text', group: 'Pedido' },
    { target: 'card', key: 'plataforma', label: 'Plataforma', type: 'select', options: ['Shopify', 'WooCommerce', 'Nuvemshop', 'Mercado Livre', 'Shopee', 'Magazine Luiza', 'Amazon', 'Loja Própria', 'Instagram', 'Outro'], group: 'Pedido' },
    { target: 'card', key: 'produtos', label: 'Produtos', type: 'textarea', group: 'Pedido', placeholder: 'Lista de produtos do pedido' },
    { target: 'card', key: 'quantidade_itens', label: 'Quantidade de Itens', type: 'number', group: 'Pedido' },
    { target: 'card', key: 'forma_pagamento', label: 'Forma de Pagamento', type: 'select', options: ['PIX', 'Cartão Crédito', 'Cartão Débito', 'Boleto', 'Transferência'], group: 'Financeiro' },
    { target: 'card', key: 'valor_frete', label: 'Valor do Frete', type: 'currency', group: 'Logística' },
    { target: 'card', key: 'transportadora', label: 'Transportadora', type: 'select', options: ['Correios', 'Jadlog', 'Total Express', 'Loggi', 'Azul Cargo', 'Retirada', 'Motoboy', 'Outro'], group: 'Logística' },
    { target: 'card', key: 'codigo_rastreio', label: 'Código de Rastreio', type: 'text', group: 'Logística' },
    { target: 'card', key: 'endereco_entrega', label: 'Endereço de Entrega', type: 'text', group: 'Logística' },
    { target: 'card', key: 'cupom_desconto', label: 'Cupom de Desconto', type: 'text', group: 'Promoção' },
    { target: 'contact', key: 'cpf_cnpj', label: 'CPF/CNPJ', type: 'text' },
    { target: 'contact', key: 'instagram', label: 'Instagram', type: 'text' },
  ],

  pipelineTemplates: [{
    name: 'Pedidos E-commerce',
    type: 'ecommerce',
    description: 'Pipeline de acompanhamento de pedidos do recebimento à entrega',
    stages: [
      { name: 'Pedido Recebido', slug: 'pedido-recebido', color: '#6366f1', position: 0 },
      { name: 'Pagamento Confirmado', slug: 'pagamento-confirmado', color: '#8b5cf6', position: 1 },
      { name: 'Em Separação', slug: 'em-separacao', color: '#3b82f6', position: 2 },
      { name: 'Enviado', slug: 'enviado', color: '#f59e0b', position: 3 },
      { name: 'Em Trânsito', slug: 'em-transito', color: '#f97316', position: 4 },
      { name: 'Entregue', slug: 'entregue', color: '#22c55e', position: 5, isWon: true },
      { name: 'Cancelado/Devolvido', slug: 'cancelado-devolvido', color: '#ef4444', position: 6, isLost: true },
    ],
  }],

  stageValidations: [
    {
      stageSlug: 'enviado',
      rules: [
        { field: 'codigo_rastreio', operator: 'not_empty', message: 'Informe o código de rastreio antes de marcar como enviado' },
      ],
    },
  ],

  cardActions: [
    { key: 'send_tracking', label: 'Enviar Rastreio', icon: 'Truck' },
    { key: 'print_label', label: 'Imprimir Etiqueta', icon: 'Printer' },
    { key: 'request_return', label: 'Solicitar Devolução', icon: 'RotateCcw' },
  ],

  sidebarMenus: [
    { label: 'Pedidos', icon: 'ShoppingCart', path: '/pedidos', position: 50, section: 'modules' },
  ],

  cardTabs: [
    { key: 'pedido', label: 'Pedido', icon: 'ShoppingCart', position: 10 },
    { key: 'rastreio', label: 'Rastreio', icon: 'Truck', position: 11 },
  ],

  dashboardWidgets: [
    { key: 'orders_today', label: 'Pedidos Hoje', size: 'sm', position: 0 },
    { key: 'revenue_week', label: 'Faturamento da Semana', size: 'md', position: 1 },
    { key: 'shipping_status', label: 'Status de Entregas', size: 'md', position: 2 },
  ],
}
