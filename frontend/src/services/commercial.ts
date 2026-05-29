import api from './api'
import type {
  ItemCategory, CatalogItem, ItemBundle,
  Proposal, Invoice, Payment, PaymentGatewayConfig,
  Contract, Project, ProjectTask, Expense, ExpenseCategory,
} from '@/types'

// ── Categorias ──
export const categoryService = {
  list: async () => (await api.get('/catalog/categories')).data.categories as ItemCategory[],
  create: async (data: Partial<ItemCategory>) => (await api.post('/catalog/categories', data)).data,
  update: async (id: string, data: Partial<ItemCategory>) => (await api.put(`/catalog/categories/${id}`, data)).data,
  delete: async (id: string) => api.delete(`/catalog/categories/${id}`),
}

// ── Itens do Catálogo ──
export const catalogService = {
  list: async (params?: Record<string, any>) => {
    const res = await api.get('/catalog/items', { params })
    return res.data as { items: CatalogItem[]; total: number; page: number; limit: number }
  },
  get: async (id: string) => (await api.get(`/catalog/items/${id}`)).data.item as CatalogItem,
  create: async (data: any) => (await api.post('/catalog/items', data)).data,
  update: async (id: string, data: any) => (await api.put(`/catalog/items/${id}`, data)).data,
  delete: async (id: string) => api.delete(`/catalog/items/${id}`),
}

// ── Bundles ──
export const bundleService = {
  list: async () => (await api.get('/catalog/bundles')).data.bundles as ItemBundle[],
  get: async (id: string) => (await api.get(`/catalog/bundles/${id}`)).data.bundle as ItemBundle,
  create: async (data: any) => (await api.post('/catalog/bundles', data)).data,
  update: async (id: string, data: any) => (await api.put(`/catalog/bundles/${id}`, data)).data,
  delete: async (id: string) => api.delete(`/catalog/bundles/${id}`),
}

// ── Propostas ──
export const proposalService = {
  list: async (params?: Record<string, any>) => {
    const res = await api.get('/proposals', { params })
    return res.data as { proposals: Proposal[]; total: number; page: number; limit: number }
  },
  get: async (id: string) => (await api.get(`/proposals/${id}`)).data.proposal as Proposal,
  create: async (data: any) => (await api.post('/proposals', data)).data,
  update: async (id: string, data: any) => (await api.put(`/proposals/${id}`, data)).data,
  delete: async (id: string) => api.delete(`/proposals/${id}`),
  addComment: async (id: string, content: string) => (await api.post(`/proposals/${id}/comments`, { content })).data,
  convertToInvoice: async (id: string) => (await api.post(`/proposals/${id}/convert-to-invoice`)).data,
  updateStatus: async (id: string, status: string) => (await api.patch(`/proposals/${id}/status`, { status })).data,
}

// ── Faturas ──
export const invoiceService = {
  list: async (params?: Record<string, any>) => {
    const res = await api.get('/invoices', { params })
    return res.data as { invoices: Invoice[]; total: number; page: number; limit: number }
  },
  get: async (id: string) => (await api.get(`/invoices/${id}`)).data.invoice as Invoice,
  create: async (data: any) => (await api.post('/invoices', data)).data,
  update: async (id: string, data: any) => (await api.put(`/invoices/${id}`, data)).data,
  delete: async (id: string) => api.delete(`/invoices/${id}`),
  updateStatus: async (id: string, status: string) => (await api.patch(`/invoices/${id}/status`, { status })).data,
}

// ── Pagamentos ──
export const paymentService = {
  list: async (params?: Record<string, any>) => {
    const res = await api.get('/payments', { params })
    return res.data as { payments: Payment[]; total: number }
  },
  create: async (data: any) => (await api.post('/payments', data)).data,
  refund: async (id: string, reason?: string) => (await api.post(`/payments/${id}/refund`, { reason })).data,
  cancel: async (id: string) => (await api.post(`/payments/${id}/cancel`)).data,
}

// ── Gateways ──
export const gatewayService = {
  list: async () => (await api.get('/payment-gateways')).data.configs as PaymentGatewayConfig[],
  create: async (data: any) => (await api.post('/payment-gateways', data)).data,
  update: async (id: string, data: any) => (await api.put(`/payment-gateways/${id}`, data)).data,
  delete: async (id: string) => api.delete(`/payment-gateways/${id}`),
}

// ── Asaas ──
export const asaasService = {
  createCharge: async (data: any) => (await api.post('/asaas/charge', data)).data,
  getQrCode: async (gatewayPaymentId: string) => (await api.get(`/asaas/qrcode/${gatewayPaymentId}`)).data,
  checkStatus: async (gatewayPaymentId: string) => (await api.get(`/asaas/status/${gatewayPaymentId}`)).data,
}

// ── Contratos ──
export const contractService = {
  list: async (params?: Record<string, any>) => {
    const res = await api.get('/contracts', { params })
    return res.data as { contracts: Contract[]; total: number; page: number; limit: number }
  },
  get: async (id: string) => (await api.get(`/contracts/${id}`)).data.contract as Contract,
  create: async (data: any) => (await api.post('/contracts', data)).data,
  update: async (id: string, data: any) => (await api.put(`/contracts/${id}`, data)).data,
  delete: async (id: string) => api.delete(`/contracts/${id}`),
  renew: async (id: string, data: any) => (await api.post(`/contracts/${id}/renew`, data)).data,
  getTemplates: async () => (await api.get('/contracts/templates')).data.templates as { id: string; name: string; category: string; description: string; icon: string; content: string; isDefault: boolean }[],
  createTemplate: async (data: any) => (await api.post('/contracts/templates', data)).data,
  updateTemplate: async (id: string, data: any) => (await api.put(`/contracts/templates/${id}`, data)).data,
  cloneTemplate: async (id: string) => (await api.post(`/contracts/templates/${id}/clone`)).data,
  deleteTemplate: async (id: string) => api.delete(`/contracts/templates/${id}`),
  getMergeData: async (contactId: string) => (await api.get(`/contracts/merge-data/${contactId}`)).data.mergeData as Record<string, string>,
}

// ── Projetos ──
export const projectService = {
  list: async (params?: Record<string, any>) => {
    const res = await api.get('/projects', { params })
    return res.data as { projects: Project[]; total: number; page: number; limit: number }
  },
  get: async (id: string) => (await api.get(`/projects/${id}`)).data.project as Project,
  overview: async (id: string) => (await api.get(`/projects/${id}/overview`)).data as import('../types').ProjectOverview,
  create: async (data: any) => (await api.post('/projects', data)).data,
  update: async (id: string, data: any) => (await api.put(`/projects/${id}`, data)).data,
  delete: async (id: string) => api.delete(`/projects/${id}`),
  changeStatus: async (id: string, data: any) => (await api.patch(`/projects/${id}/status`, data)).data,
  copy: async (id: string, data: any) => (await api.post(`/projects/${id}/copy`, data)).data,
  addMember: async (id: string, data: any) => (await api.post(`/projects/${id}/members`, data)).data,
  removeMember: async (id: string, userId: string) => api.delete(`/projects/${id}/members/${userId}`),
  addMilestone: async (id: string, data: any) => (await api.post(`/projects/${id}/milestones`, data)).data,
  updateMilestone: async (id: string, milestoneId: string, data: any) => (await api.put(`/projects/${id}/milestones/${milestoneId}`, data)).data,
  deleteMilestone: async (id: string, milestoneId: string) => api.delete(`/projects/${id}/milestones/${milestoneId}`),
  reorderMilestones: async (id: string, data: any) => (await api.patch(`/projects/${id}/milestones/reorder`, data)).data,
  // Discussions
  listDiscussions: async (id: string) => (await api.get(`/projects/${id}/discussions`)).data.discussions as import('../types').ProjectDiscussion[],
  getDiscussion: async (id: string, discussionId: string) => (await api.get(`/projects/${id}/discussions/${discussionId}`)).data.discussion as import('../types').ProjectDiscussion,
  createDiscussion: async (id: string, data: any) => (await api.post(`/projects/${id}/discussions`, data)).data,
  deleteDiscussion: async (id: string, discussionId: string) => api.delete(`/projects/${id}/discussions/${discussionId}`),
  addComment: async (id: string, discussionId: string, data: any) => (await api.post(`/projects/${id}/discussions/${discussionId}/comments`, data)).data,
  // Notes
  listNotes: async (id: string) => (await api.get(`/projects/${id}/notes`)).data.notes as import('../types').ProjectNote[],
  createNote: async (id: string, data: any) => (await api.post(`/projects/${id}/notes`, data)).data,
  updateNote: async (id: string, noteId: string, data: any) => (await api.put(`/projects/${id}/notes/${noteId}`, data)).data,
  deleteNote: async (id: string, noteId: string) => api.delete(`/projects/${id}/notes/${noteId}`),
  // Timesheets
  listTimesheets: async (id: string, params?: Record<string, any>) => {
    const res = await api.get(`/projects/${id}/timesheets`, { params })
    return res.data as { timesheets: import('../types').ProjectTimesheet[]; total: number }
  },
  createTimesheet: async (id: string, data: any) => (await api.post(`/projects/${id}/timesheets`, data)).data,
  deleteTimesheet: async (id: string, timesheetId: string) => api.delete(`/projects/${id}/timesheets/${timesheetId}`),
  // Activities
  listActivities: async (id: string, params?: Record<string, any>) => {
    const res = await api.get(`/projects/${id}/activities`, { params })
    return res.data as { activities: import('../types').ProjectActivity[]; total: number }
  },
}

// ── Tarefas ──
export const taskService = {
  list: async (params?: Record<string, any>) => {
    const res = await api.get('/tasks', { params })
    return res.data as { tasks: ProjectTask[]; total: number; page: number; limit: number }
  },
  get: async (id: string) => (await api.get(`/tasks/${id}`)).data.task as ProjectTask,
  create: async (data: any) => (await api.post('/tasks', data)).data,
  update: async (id: string, data: any) => (await api.put(`/tasks/${id}`, data)).data,
  delete: async (id: string) => api.delete(`/tasks/${id}`),
  reorder: async (data: any) => (await api.patch('/tasks/reorder', data)).data,
  addTime: async (id: string, data: any) => (await api.post(`/tasks/${id}/time`, data)).data,
}

// ── Categorias de Despesa ──
export const expenseCategoryService = {
  list: async () => (await api.get('/expense-categories')).data.categories as ExpenseCategory[],
  create: async (data: any) => (await api.post('/expense-categories', data)).data,
  update: async (id: string, data: any) => (await api.put(`/expense-categories/${id}`, data)).data,
  delete: async (id: string) => api.delete(`/expense-categories/${id}`),
}

// ── Despesas ──
export const expenseService = {
  list: async (params?: Record<string, any>) => {
    const res = await api.get('/expenses', { params })
    return res.data as { expenses: Expense[]; total: number; totalAmount: number; page: number; limit: number }
  },
  get: async (id: string) => (await api.get(`/expenses/${id}`)).data.expense as Expense,
  create: async (data: any) => (await api.post('/expenses', data)).data,
  update: async (id: string, data: any) => (await api.put(`/expenses/${id}`, data)).data,
  delete: async (id: string) => api.delete(`/expenses/${id}`),
}

// ── Contas de Cliente ──
export const customerAccountService = {
  list: async (params?: Record<string, any>) => {
    const res = await api.get('/customers', { params })
    return res.data as { accounts: any[]; total: number; page: number; limit: number }
  },
  get: async (id: string) => (await api.get(`/customers/${id}`)).data.account,
  create: async (data: any) => (await api.post('/customers', data)).data,
  update: async (id: string, data: any) => (await api.put(`/customers/${id}`, data)).data,
  delete: async (id: string) => api.delete(`/customers/${id}`),
  addContact: async (id: string, data: any) => (await api.post(`/customers/${id}/contacts`, data)).data,
  removeContact: async (id: string, contactId: string) => api.delete(`/customers/${id}/contacts/${contactId}`),
  updateStatus: async (id: string, status: string) => (await api.patch(`/customers/${id}/status`, { status })).data,
  getFull: async (id: string) => (await api.get(`/customers/${id}/full`)).data,
  getActivities: async (id: string, params?: Record<string, any>) => {
    const res = await api.get(`/customers/${id}/activities`, { params })
    return res.data as { activities: any[]; total: number; page: number; limit: number }
  },
  getTasks: async (id: string, params?: Record<string, any>) => {
    const res = await api.get(`/customers/${id}/tasks`, { params })
    return res.data as { tasks: any[]; total: number }
  },
  getReport: async (id: string) => (await api.get(`/customers/${id}/report`)).data,
}

// ── Leads ──
export const leadService = {
  list: async (params?: Record<string, any>) => {
    const res = await api.get('/leads', { params })
    return res.data as { leads: any[]; total: number; page: number; limit: number }
  },
  get: async (id: string) => (await api.get(`/leads/${id}`)).data,
  create: async (data: any) => (await api.post('/leads', data)).data,
  update: async (id: string, data: any) => (await api.put(`/leads/${id}`, data)).data,
  delete: async (id: string) => api.delete(`/leads/${id}`),
  convert: async (id: string, data: any) => (await api.post(`/leads/${id}/convert`, data)).data,
  stats: async () => (await api.get('/leads/stats/summary')).data,
}

// ── Notas de Crédito ──
export const creditNoteService = {
  list: async (params?: Record<string, any>) => {
    const res = await api.get('/credit-notes', { params })
    return res.data as { creditNotes: any[]; total: number; page: number; limit: number }
  },
  get: async (id: string) => (await api.get(`/credit-notes/${id}`)).data.creditNote,
  create: async (data: any) => (await api.post('/credit-notes', data)).data,
  apply: async (id: string, data: any) => (await api.post(`/credit-notes/${id}/apply`, data)).data,
  void: async (id: string) => (await api.patch(`/credit-notes/${id}/void`)).data,
}

// ── Relatórios ──
export const reportService = {
  dashboard: async (params?: Record<string, any>) => (await api.get('/reports/dashboard', { params })).data,
  commercial: async (params?: Record<string, any>) => (await api.get('/reports/commercial', { params })).data,
  revenueMonthly: async () => (await api.get('/reports/revenue-monthly')).data,
  pipeline: async () => (await api.get('/reports/pipeline')).data,
  paymentsByMethod: async (params?: Record<string, any>) => (await api.get('/reports/payments-by-method', { params })).data,
  topClients: async () => (await api.get('/reports/top-clients')).data,
}
