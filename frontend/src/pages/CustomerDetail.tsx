import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Building2, User, Users, Mail, Phone, FileText, Receipt,
  CreditCard, ScrollText, FolderKanban, CheckSquare, DollarSign, StickyNote,
  Edit2, Trash2, Plus, X, Search, ChevronDown, BarChart3, Calendar,
  ExternalLink, UserPlus, Save, MessageSquare, Loader2, RefreshCw,
  Clock, Activity, TrendingUp, AlertTriangle, Target, PieChart, Brain
} from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { customerAccountService, proposalService, invoiceService, paymentService, contractService, projectService, expenseService, expenseCategoryService, catalogService, taskService } from '@/services/commercial'
import api from '@/services/api'

// ── Constants ──

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: 'Ativo', color: 'bg-emerald-500/10 text-emerald-600' },
  INACTIVE: { label: 'Inativo', color: 'bg-gray-500/10 text-gray-500' },
  SUSPENDED: { label: 'Suspenso', color: 'bg-amber-500/10 text-amber-600' },
  CHURNED: { label: 'Cancelado', color: 'bg-red-500/10 text-red-600' },
}

const TYPE_MAP: Record<string, string> = { INDIVIDUAL: 'Pessoa Física', COMPANY: 'Empresa', GOVERNMENT: 'Governo' }

const ROLE_MAP: Record<string, string> = { PRIMARY: 'Principal', ADMIN: 'Administrador', BILLING: 'Faturamento', DECISION_MAKER: 'Decisor', OPERATIONAL: 'Operacional', TECHNICAL: 'Técnico', MEMBER: 'Membro' }

const INVOICE_STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Rascunho', color: 'bg-gray-500/10 text-gray-500' },
  SENT: { label: 'Enviada', color: 'bg-blue-500/10 text-blue-500' },
  OVERDUE: { label: 'Atrasada', color: 'bg-red-500/10 text-red-500' },
  PAID: { label: 'Paga', color: 'bg-green-500/10 text-green-500' },
  PARTIALLY_PAID: { label: 'Parcial', color: 'bg-amber-500/10 text-amber-600' },
  CANCELLED: { label: 'Cancelada', color: 'bg-red-500/10 text-red-600' },
}

const PROJECT_STATUS: Record<string, { label: string; color: string }> = {
  NOT_STARTED: { label: 'Não Iniciado', color: 'bg-gray-500/10 text-gray-500' },
  IN_PROGRESS: { label: 'Em Progresso', color: 'bg-blue-500/10 text-blue-500' },
  ON_HOLD: { label: 'Pausado', color: 'bg-yellow-500/10 text-yellow-500' },
  COMPLETED: { label: 'Concluído', color: 'bg-green-500/10 text-green-500' },
  CANCELLED: { label: 'Cancelado', color: 'bg-red-500/10 text-red-500' },
}

const PROPOSAL_STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Rascunho', color: 'bg-gray-500/10 text-gray-500' },
  SENT: { label: 'Enviada', color: 'bg-blue-500/10 text-blue-500' },
  ACCEPTED: { label: 'Aceita', color: 'bg-green-500/10 text-green-500' },
  DECLINED: { label: 'Recusada', color: 'bg-red-500/10 text-red-500' },
  REVISED: { label: 'Revisada', color: 'bg-amber-500/10 text-amber-600' },
  EXPIRED: { label: 'Expirada', color: 'bg-gray-500/10 text-gray-500' },
}

const CONTRACT_STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Rascunho', color: 'bg-gray-500/10 text-gray-500' },
  ACTIVE: { label: 'Ativo', color: 'bg-green-500/10 text-green-500' },
  EXPIRED: { label: 'Expirado', color: 'bg-amber-500/10 text-amber-600' },
  TERMINATED: { label: 'Encerrado', color: 'bg-red-500/10 text-red-600' },
}

type Tab = 'profile' | 'contacts' | 'proposals' | 'invoices' | 'payments' | 'contracts' | 'projects' | 'tasks' | 'expenses' | 'report' | 'activity' | 'notes'

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'profile', label: 'Perfil', icon: Building2 },
  { key: 'contacts', label: 'Contatos', icon: Users },
  { key: 'proposals', label: 'Propostas', icon: FileText },
  { key: 'invoices', label: 'Faturas', icon: Receipt },
  { key: 'payments', label: 'Pagamentos', icon: CreditCard },
  { key: 'contracts', label: 'Contratos', icon: ScrollText },
  { key: 'projects', label: 'Projetos', icon: FolderKanban },
  { key: 'tasks', label: 'Tarefas', icon: CheckSquare },
  { key: 'expenses', label: 'Despesas', icon: DollarSign },
  { key: 'report', label: 'Relatório', icon: PieChart },
  { key: 'activity', label: 'Atividade', icon: Activity },
  { key: 'notes', label: 'Notas', icon: StickyNote },
]

function fmt(d?: string) {
  return d ? new Date(d).toLocaleDateString('pt-BR') : '—'
}
function money(v?: number | string) {
  return `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}

// ── Component ──

interface Props {
  accountId: string
  onBack: () => void
  onEdit: (acc: any) => void
  onDeleted: () => void
}

export function CustomerDetail({ accountId, onBack, onEdit, onDeleted }: Props) {
  const toast = useToast()
  const { can } = usePermissions()
  const navigate = useNavigate()

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('profile')

  // Add contact form
  const [showAddContact, setShowAddContact] = useState(false)
  const [allContacts, setAllContacts] = useState<any[]>([])
  const [contactSearch, setContactSearch] = useState('')
  const [addContactId, setAddContactId] = useState('')
  const [addContactRole, setAddContactRole] = useState('MEMBER')

  // Status dropdown
  const [showStatusMenu, setShowStatusMenu] = useState(false)

  // Inline editing
  const [isEditing, setIsEditing] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [organizations, setOrganizations] = useState<any[]>([])
  const [editForm, setEditForm] = useState({
    accountType: '', billingName: '', billingEmail: '', taxId: '',
    creditLimit: '', paymentTermDays: '30', notes: '', organizationId: ''
  })

  const reload = useCallback(async () => {
    try {
      const result = await customerAccountService.getFull(accountId)
      setData(result)
    } catch { toast.error('Erro ao carregar cliente') }
    setLoading(false)
  }, [accountId])

  useEffect(() => { reload() }, [reload])

  async function loadAllContacts() {
    try {
      const res = await api.get('/contacts', { params: { limit: 500 } })
      setAllContacts(res.data.contacts || [])
    } catch {}
  }

  function startEditing() {
    if (!data) return
    const acc = data.account
    setEditForm({
      accountType: acc.accountType || 'COMPANY',
      billingName: acc.billingName || '',
      billingEmail: acc.billingEmail || '',
      taxId: acc.taxId || '',
      creditLimit: acc.creditLimit ? String(acc.creditLimit) : '',
      paymentTermDays: String(acc.paymentTermDays || 30),
      notes: acc.notes || '',
      organizationId: acc.organizationId || ''
    })
    setIsEditing(true)
    setActiveTab('profile')
    // Load organizations for dropdown
    api.get('/contacts/organizations', { params: { limit: 500 } })
      .then(res => setOrganizations(res.data.organizations || []))
      .catch(() => {})
  }

  async function saveEdit() {
    setSavingEdit(true)
    try {
      const payload: any = {
        accountType: editForm.accountType,
        billingName: editForm.billingName,
        billingEmail: editForm.billingEmail || null,
        taxId: editForm.taxId || null,
        creditLimit: editForm.creditLimit ? Number(editForm.creditLimit) : null,
        paymentTermDays: Number(editForm.paymentTermDays) || 30,
        notes: editForm.notes || null,
        organizationId: editForm.organizationId || null,
      }
      await customerAccountService.update(accountId, payload)
      toast.success('Conta atualizada!')
      setIsEditing(false)
      reload()
    } catch {
      toast.error('Erro ao salvar')
    }
    setSavingEdit(false)
  }

  function openConversation() {
    const primary = data?.account?.members?.find((m: any) => m.isPrimary)
    const phone = primary?.contact?.phoneNumber
    if (!phone) {
      toast.error('Contato principal sem telefone')
      return
    }
    const clean = phone.replace(/\D/g, '')
    navigate(`/messages?phone=${clean}`)
  }

  // ── Inline creation forms ──
  const [showCreateForm, setShowCreateForm] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function getPrimaryContactId() {
    const primary = data?.account?.members?.find((m: any) => m.isPrimary)
    return primary?.contactId || data?.account?.members?.[0]?.contactId || ''
  }

  // ── Catalog items for proposals/invoices ──
  const [catalogItems, setCatalogItems] = useState<any[]>([])
  useEffect(() => {
    catalogService.list({ limit: 500 }).then(r => setCatalogItems(r.items || [])).catch(() => {})
  }, [])

  function calcLineTotal(it: any) {
    const sub = it.quantity * it.unitPrice
    const disc = sub * (it.discount / 100)
    const tax = (sub - disc) * (it.taxRate / 100)
    return sub - disc + tax
  }

  const emptyItem = { description: '', quantity: 1, unit: 'un', unitPrice: 0, discount: 0, taxRate: 0, catalogItemId: '' }

  function handleCatalogSelect(items: any[], index: number, catalogId: string, setItems: (items: any[]) => void) {
    const ni = [...items]
    if (!catalogId) { ni[index] = { ...ni[index], catalogItemId: '' }; setItems(ni); return }
    const cat = catalogItems.find((c: any) => c.id === catalogId)
    if (cat) {
      ni[index] = { ...ni[index], catalogItemId: catalogId, description: cat.name, unitPrice: Number(cat.price ?? 0), unit: cat.unit || 'un', taxRate: cat.taxRate || 0 }
    }
    setItems(ni)
  }

  // ── PROPOSAL FORM ──
  const [propForm, setPropForm] = useState({ subject: '', notes: '', terms: '', openTill: '', items: [{ ...emptyItem }] })
  const propTotal = useMemo(() => propForm.items.reduce((s, it) => s + calcLineTotal(it), 0), [propForm.items])
  async function createProposal() {
    const cId = getPrimaryContactId()
    if (!cId) return toast.error('Vincule um contato antes')
    if (!propForm.subject) return toast.error('Assunto obrigatório')
    if (!propForm.items[0]?.description) return toast.error('Adicione ao menos 1 item com descrição')
    setSaving(true)
    try {
      await proposalService.create({
        contactId: cId, subject: propForm.subject, notes: propForm.notes || undefined, terms: propForm.terms || undefined,
        openTill: propForm.openTill || undefined,
        items: propForm.items.map((it, i) => ({ ...it, sortOrder: i, catalogItemId: it.catalogItemId || undefined }))
      })
      toast.success('Proposta criada!')
      setPropForm({ subject: '', notes: '', terms: '', openTill: '', items: [{ ...emptyItem }] })
      setShowCreateForm(null); reload()
    } catch { toast.error('Erro ao criar proposta') }
    setSaving(false)
  }

  // ── INVOICE FORM ──
  const [invForm, setInvForm] = useState({ dueDate: '', notes: '', terms: '', recurring: false, recurringCycle: 'MONTHLY', items: [{ ...emptyItem }] })
  const invTotal = useMemo(() => invForm.items.reduce((s, it) => s + calcLineTotal(it), 0), [invForm.items])
  async function createInvoice() {
    const cId = getPrimaryContactId()
    if (!cId) return toast.error('Vincule um contato antes')
    if (!invForm.items[0]?.description) return toast.error('Adicione ao menos 1 item com descrição')
    setSaving(true)
    try {
      await invoiceService.create({
        contactId: cId, dueDate: invForm.dueDate || undefined, notes: invForm.notes || undefined, terms: invForm.terms || undefined,
        recurring: invForm.recurring, recurringCycle: invForm.recurring ? invForm.recurringCycle : undefined,
        items: invForm.items.map((it, i) => ({ ...it, sortOrder: i, catalogItemId: it.catalogItemId || undefined }))
      })
      toast.success('Fatura criada!')
      setInvForm({ dueDate: '', notes: '', terms: '', recurring: false, recurringCycle: 'MONTHLY', items: [{ ...emptyItem }] })
      setShowCreateForm(null); reload()
    } catch { toast.error('Erro ao criar fatura') }
    setSaving(false)
  }

  // ── PAYMENT FORM ──
  const [payForm, setPayForm] = useState({ invoiceId: '', amount: '', method: 'PIX', note: '' })
  async function createPayment() {
    if (!payForm.invoiceId) return toast.error('Selecione uma fatura')
    if (!payForm.amount || Number(payForm.amount) <= 0) return toast.error('Valor obrigatório')
    setSaving(true)
    try {
      await paymentService.create({ invoiceId: payForm.invoiceId, amount: Number(payForm.amount), method: payForm.method, note: payForm.note || undefined })
      toast.success('Pagamento registrado!')
      setPayForm({ invoiceId: '', amount: '', method: 'PIX', note: '' })
      setShowCreateForm(null); reload()
    } catch { toast.error('Erro ao registrar pagamento') }
    setSaving(false)
  }

  // ── CONTRACT FORM ──
  const [ctForm, setCtForm] = useState({ subject: '', type: '', startDate: '', endDate: '', value: '', content: '', notes: '', autoRenew: false, renewalDays: '30' })
  const [ctTemplates, setCtTemplates] = useState<any[]>([])
  const [showTemplateSelector, setShowTemplateSelector] = useState(false)
  async function loadTemplates() {
    try { const t = await contractService.getTemplates(); setCtTemplates(t) } catch {}
  }
  function applyTemplate(tpl: any) {
    setCtForm(f => ({ ...f, content: tpl.content, subject: f.subject || tpl.name }))
    setShowTemplateSelector(false)
  }
  async function autoFillMergeFields() {
    const cId = getPrimaryContactId()
    if (!cId) return
    try {
      const mergeData = await contractService.getMergeData(cId)
      setCtForm(f => {
        let c = f.content
        Object.entries(mergeData).forEach(([k, v]) => { c = c.replaceAll(`{{${k}}}`, v) })
        if (f.value) c = c.replaceAll('{{VALOR}}', `R$ ${Number(f.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
        if (f.startDate) c = c.replaceAll('{{DATA_INICIO}}', new Date(f.startDate).toLocaleDateString('pt-BR'))
        if (f.endDate) c = c.replaceAll('{{DATA_FIM}}', new Date(f.endDate).toLocaleDateString('pt-BR'))
        c = c.replaceAll('{{DATA_ATUAL}}', new Date().toLocaleDateString('pt-BR'))
        return { ...f, content: c }
      })
    } catch {}
  }
  async function createContract() {
    const cId = getPrimaryContactId()
    if (!cId) return toast.error('Vincule um contato antes')
    if (!ctForm.subject) return toast.error('Assunto obrigatório')
    if (!ctForm.startDate) return toast.error('Data início obrigatória')
    setSaving(true)
    try {
      await contractService.create({
        contactId: cId, subject: ctForm.subject, type: ctForm.type || undefined,
        startDate: ctForm.startDate, endDate: ctForm.endDate || undefined,
        value: ctForm.value ? Number(ctForm.value) : 0, content: ctForm.content || undefined,
        notes: ctForm.notes || undefined, autoRenew: ctForm.autoRenew, renewalDays: Number(ctForm.renewalDays) || 30
      })
      toast.success('Contrato criado!')
      setCtForm({ subject: '', type: '', startDate: '', endDate: '', value: '', content: '', notes: '', autoRenew: false, renewalDays: '30' })
      setShowCreateForm(null); reload()
    } catch { toast.error('Erro ao criar contrato') }
    setSaving(false)
  }

  // ── PROJECT FORM ──
  const [projForm, setProjForm] = useState({ name: '', description: '', status: 'NOT_STARTED', startDate: '', deadline: '', billingType: 'FIXED', fixedCost: '', hourlyRate: '' })
  async function createProject() {
    const cId = getPrimaryContactId()
    if (!cId) return toast.error('Vincule um contato antes')
    if (!projForm.name) return toast.error('Nome obrigatório')
    setSaving(true)
    try {
      await projectService.create({
        contactId: cId, name: projForm.name, description: projForm.description || undefined,
        status: projForm.status, startDate: projForm.startDate || undefined, deadline: projForm.deadline || undefined,
        billingType: projForm.billingType,
        fixedCost: projForm.billingType === 'FIXED' && projForm.fixedCost ? Number(projForm.fixedCost) : undefined,
        hourlyRate: projForm.billingType === 'HOURLY' && projForm.hourlyRate ? Number(projForm.hourlyRate) : undefined
      })
      toast.success('Projeto criado!')
      setProjForm({ name: '', description: '', status: 'NOT_STARTED', startDate: '', deadline: '', billingType: 'FIXED', fixedCost: '', hourlyRate: '' })
      setShowCreateForm(null); reload()
    } catch { toast.error('Erro ao criar projeto') }
    setSaving(false)
  }

  // ── EXPENSE FORM ──
  const [expCategories, setExpCategories] = useState<any[]>([])
  const [expProjects, setExpProjects] = useState<any[]>([])
  const [expForm, setExpForm] = useState({ name: '', amount: '', taxRate: '', date: new Date().toISOString().split('T')[0], categoryId: '', projectId: '', reference: '', note: '', billable: false, recurring: false, recurringCycle: 'MONTHLY' })
  async function loadExpenseData() {
    try { const cats = await expenseCategoryService.list(); setExpCategories(cats) } catch {}
    try { const p = await projectService.list({ limit: 200 }); setExpProjects(p.projects || []) } catch {}
  }
  async function createExpense() {
    const cId = getPrimaryContactId()
    if (!expForm.name) return toast.error('Nome obrigatório')
    if (!expForm.amount) return toast.error('Valor obrigatório')
    if (!expForm.date) return toast.error('Data obrigatória')
    setSaving(true)
    try {
      await expenseService.create({
        contactId: cId || undefined, name: expForm.name, amount: Number(expForm.amount),
        taxRate: expForm.taxRate ? Number(expForm.taxRate) : 0, currency: 'BRL',
        date: expForm.date, categoryId: expForm.categoryId || undefined,
        projectId: expForm.projectId || undefined, reference: expForm.reference || undefined,
        note: expForm.note || undefined, billable: expForm.billable,
        recurring: expForm.recurring, recurringCycle: expForm.recurring ? expForm.recurringCycle : undefined
      })
      toast.success('Despesa criada!')
      setExpForm({ name: '', amount: '', taxRate: '', date: new Date().toISOString().split('T')[0], categoryId: '', projectId: '', reference: '', note: '', billable: false, recurring: false, recurringCycle: 'MONTHLY' })
      setShowCreateForm(null); reload()
    } catch { toast.error('Erro ao criar despesa') }
    setSaving(false)
  }

  // ── CUSTOMER TASKS ──
  const [customerTasks, setCustomerTasks] = useState<any[]>([])
  const [taskViewMode, setTaskViewMode] = useState<'kanban' | 'list'>('kanban')
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [taskForm, setTaskForm] = useState({ name: '', description: '', status: 'NOT_STARTED', priority: 'MEDIUM', dueDate: '', projectId: '' })
  const [showTimeForm, setShowTimeForm] = useState<string | null>(null)
  const [timeHours, setTimeHours] = useState('')

  const TASK_STATUSES = [
    { key: 'NOT_STARTED', label: 'A Fazer', color: 'bg-gray-500' },
    { key: 'IN_PROGRESS', label: 'Em Progresso', color: 'bg-blue-500' },
    { key: 'AWAITING_FEEDBACK', label: 'Aguardando', color: 'bg-yellow-500' },
    { key: 'COMPLETED', label: 'Concluído', color: 'bg-green-500' },
  ]
  const PRIORITY_MAP: Record<string, { label: string; color: string }> = {
    LOW: { label: 'Baixa', color: 'text-gray-500' },
    MEDIUM: { label: 'Média', color: 'text-blue-500' },
    HIGH: { label: 'Alta', color: 'text-orange-500' },
    URGENT: { label: 'Urgente', color: 'text-red-500' },
  }

  async function loadTasks() {
    try { const r = await customerAccountService.getTasks(accountId); setCustomerTasks(r.tasks) } catch {}
  }

  async function createTask() {
    const cId = getPrimaryContactId()
    if (!taskForm.name) return toast.error('Nome obrigatório')
    setSaving(true)
    try {
      await taskService.create({ ...taskForm, contactId: cId || undefined, dueDate: taskForm.dueDate || undefined, projectId: taskForm.projectId || undefined })
      toast.success('Tarefa criada!')
      setTaskForm({ name: '', description: '', status: 'NOT_STARTED', priority: 'MEDIUM', dueDate: '', projectId: '' })
      setShowTaskForm(false)
      loadTasks()
    } catch { toast.error('Erro ao criar tarefa') }
    setSaving(false)
  }

  async function handleTaskStatusChange(taskId: string, newStatus: string) {
    try { await taskService.update(taskId, { status: newStatus }); loadTasks() } catch {}
  }

  async function handleDeleteTask(id: string) {
    if (!await toast.confirm({ title: 'Excluir tarefa', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await taskService.delete(id); loadTasks() } catch {}
  }

  async function handleAddTime(taskId: string) {
    if (!timeHours) return
    try {
      const minutes = Math.round(Number(timeHours) * 60)
      if (minutes < 1) return
      await taskService.addTime(taskId, { minutes })
      setShowTimeForm(null); setTimeHours('')
      loadTasks()
      toast.success('Tempo registrado!')
    } catch {}
  }

  const taskGrouped = TASK_STATUSES.map(s => ({ ...s, tasks: customerTasks.filter(t => t.status === s.key) }))
  const taskStats = {
    total: customerTasks.length,
    completed: customerTasks.filter(t => t.status === 'COMPLETED').length,
    overdue: customerTasks.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && t.dueDate && new Date(t.dueDate) < new Date()).length,
  }

  // ── REPORT ──
  const [report, setReport] = useState<any>(null)
  const [loadingReport, setLoadingReport] = useState(false)
  async function loadReport() {
    setLoadingReport(true)
    try { const r = await customerAccountService.getReport(accountId); setReport(r) } catch {}
    setLoadingReport(false)
  }

  // ── ACTIVITY LOG ──
  const [activities, setActivities] = useState<any[]>([])
  const [activityPage, setActivityPage] = useState(1)
  const [activityTotal, setActivityTotal] = useState(0)
  const [loadingActivities, setLoadingActivities] = useState(false)
  const [activityFilter, setActivityFilter] = useState('')
  async function loadActivities(page = 1) {
    setLoadingActivities(true)
    try {
      const r = await customerAccountService.getActivities(accountId, { page, limit: 30, entity: activityFilter || undefined })
      setActivities(page === 1 ? r.activities : [...activities, ...r.activities])
      setActivityTotal(r.total)
      setActivityPage(page)
    } catch {}
    setLoadingActivities(false)
  }

  const ACTIVITY_ICONS: Record<string, { icon: string; color: string }> = {
    CREATED: { icon: '🆕', color: 'text-green-500' },
    UPDATED: { icon: '✏️', color: 'text-blue-500' },
    DELETED: { icon: '🗑️', color: 'text-red-500' },
    STATUS_CHANGED: { icon: '🔄', color: 'text-amber-500' },
    CONTACT_ADDED: { icon: '👤', color: 'text-green-500' },
    CONTACT_REMOVED: { icon: '👤', color: 'text-red-500' },
    PROPOSAL_CREATED: { icon: '📋', color: 'text-blue-500' },
    INVOICE_CREATED: { icon: '🧾', color: 'text-blue-500' },
    CONTRACT_CREATED: { icon: '📜', color: 'text-blue-500' },
    PROJECT_CREATED: { icon: '📁', color: 'text-blue-500' },
    EXPENSE_CREATED: { icon: '💸', color: 'text-red-500' },
    LABEL_ADDED: { icon: '🏷️', color: 'text-purple-500' },
    LABEL_REMOVED: { icon: '🏷️', color: 'text-gray-500' },
    AI_STARTED: { icon: '🤖', color: 'text-green-500' },
    AI_STOPPED: { icon: '🤖', color: 'text-red-500' },
    MESSAGE_SENT: { icon: '💬', color: 'text-blue-500' },
    PAYMENT_RECEIVED: { icon: '💰', color: 'text-green-500' },
  }

  // ── NOTES ──
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  async function saveNote() {
    setSavingNote(true)
    try {
      await customerAccountService.update(accountId, { notes: noteText })
      toast.success('Observações salvas!')
      reload()
    } catch { toast.error('Erro ao salvar') }
    setSavingNote(false)
  }

  if (loading || !data) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  const { account, proposals, invoices, payments, contracts, projects, expenses, creditNotes, summary } = data
  const st = STATUS_MAP[account.status] || STATUS_MAP.ACTIVE
  const primaryContact = account.members?.find((m: any) => m.isPrimary)

  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault()
    if (!addContactId) return
    try {
      await customerAccountService.addContact(accountId, { contactId: addContactId, role: addContactRole, isPrimary: false })
      setShowAddContact(false)
      setAddContactId('')
      setContactSearch('')
      reload()
      toast.success('Contato vinculado!')
    } catch { toast.error('Erro ao vincular contato') }
  }

  async function handleRemoveContact(contactId: string) {
    if (!await toast.confirm({ title: 'Remover contato', message: 'Desvincular este contato?', danger: true, confirmText: 'Remover' })) return
    try {
      await customerAccountService.removeContact(accountId, contactId)
      reload()
    } catch { toast.error('Erro') }
  }

  async function handleChangeStatus(newStatus: string) {
    setShowStatusMenu(false)
    try {
      await customerAccountService.updateStatus(accountId, newStatus)
      toast.success('Status alterado')
      reload()
    } catch { toast.error('Erro') }
  }

  async function handleDelete() {
    if (!await toast.confirm({ title: 'Excluir conta', message: `"${account.billingName}" será excluída permanentemente.`, danger: true, confirmText: 'Excluir' })) return
    try { await customerAccountService.delete(accountId); onDeleted() } catch { toast.error('Erro ao excluir') }
  }

  const filteredAllContacts = contactSearch
    ? allContacts.filter((c: any) => {
        const q = contactSearch.toLowerCase()
        return c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || c.phoneNumber.includes(q)
      }).slice(0, 15)
    : allContacts.slice(0, 15)

  // Count badges
  function badge(count: number) {
    return count > 0 ? <span className="ml-auto px-1.5 py-0.5 bg-muted text-muted-foreground text-xs rounded-full">{count}</span> : null
  }

  return (
    <div className="p-6 max-w-7xl">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-foreground truncate flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            {account.billingName || 'Sem nome'}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {/* Status dropdown */}
            <div className="relative">
              <button onClick={() => can('customers:manage') && setShowStatusMenu(!showStatusMenu)} className={`px-2.5 py-1 rounded-full text-xs font-medium ${st.color} ${can('customers:manage') ? 'cursor-pointer hover:opacity-80' : ''} flex items-center gap-1`}>
                {st.label}
                {can('customers:manage') && <ChevronDown className="h-3 w-3" />}
              </button>
              {showStatusMenu && (
                <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-20 py-1 min-w-[140px]">
                  {Object.entries(STATUS_MAP).map(([k, v]) => (
                    <button key={k} onClick={() => handleChangeStatus(k)} className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${k === account.status ? 'font-medium' : ''}`}>
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{TYPE_MAP[account.accountType] || account.accountType}</span>
            {account.taxId && <span className="text-xs text-muted-foreground">• CPF/CNPJ: {account.taxId}</span>}
            {primaryContact && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full">
                <User className="h-3 w-3" /> {primaryContact.contact.name}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Summary badges */}
          <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-muted/30 rounded-lg text-xs">
            <div className="text-center">
              <p className="text-muted-foreground">Faturado</p>
              <p className="font-bold text-foreground">{money(summary.totalInvoiced)}</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="text-center">
              <p className="text-muted-foreground">Recebido</p>
              <p className="font-bold text-green-500">{money(summary.totalPaid)}</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="text-center">
              <p className="text-muted-foreground">Pendente</p>
              <p className="font-bold text-amber-500">{money(summary.totalOutstanding)}</p>
            </div>
          </div>
          {can('customers:manage') && (
            <div className="flex gap-1">
              {isEditing ? (
                <>
                  <button onClick={saveEdit} disabled={savingEdit} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50" title="Salvar">
                    {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
                  </button>
                  <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 bg-muted text-foreground rounded-lg text-sm hover:bg-muted/80" title="Cancelar">Cancelar</button>
                </>
              ) : (
                <>
                  <button onClick={openConversation} className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8" title="Abrir conversa"><MessageSquare className="h-4 w-4" /></button>
                  <button onClick={() => navigate(`/ai-brain/customerAccount/${accountId}`)} className="p-2 rounded-lg text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10" title="Cérebro IA"><Brain className="h-4 w-4" /></button>
                  <button onClick={startEditing} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60" title="Editar"><Edit2 className="h-4 w-4" /></button>
                  <button onClick={handleDelete} className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8" title="Excluir"><Trash2 className="h-4 w-4" /></button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="border-b border-border mb-6 flex gap-1 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon
          let count = 0
          if (tab.key === 'contacts') count = account.members?.length || 0
          else if (tab.key === 'proposals') count = proposals.length
          else if (tab.key === 'invoices') count = invoices.length
          else if (tab.key === 'payments') count = payments.length
          else if (tab.key === 'contracts') count = contracts.length
          else if (tab.key === 'projects') count = projects.length
          else if (tab.key === 'expenses') count = expenses.length
          else if (tab.key === 'tasks') count = customerTasks.length
          else if (tab.key === 'activity') count = activities.length

          return (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key)
                if (tab.key === 'tasks' && customerTasks.length === 0) loadTasks()
                if (tab.key === 'report' && !report) loadReport()
                if (tab.key === 'activity' && activities.length === 0) loadActivities()
              }}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {count > 0 && <span className="bg-muted text-muted-foreground text-xs px-1.5 py-0.5 rounded-full">{count}</span>}
            </button>
          )
        })}
      </div>

      {/* ═══ TAB: PROFILE ═══ */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Info Card */}
          <div className="bg-card border border-border/60 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> Informações da Conta</h3>
            {isEditing ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Nome Faturamento *</label>
                  <input value={editForm.billingName} onChange={e => setEditForm({ ...editForm, billingName: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Email Faturamento</label>
                  <input value={editForm.billingEmail} onChange={e => setEditForm({ ...editForm, billingEmail: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">CPF/CNPJ</label>
                  <input value={editForm.taxId} onChange={e => setEditForm({ ...editForm, taxId: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Tipo</label>
                  <select value={editForm.accountType} onChange={e => setEditForm({ ...editForm, accountType: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                    <option value="INDIVIDUAL">Pessoa Física</option>
                    <option value="COMPANY">Empresa</option>
                    <option value="GOVERNMENT">Governo</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Limite de Crédito</label>
                  <input type="number" value={editForm.creditLimit} onChange={e => setEditForm({ ...editForm, creditLimit: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Prazo Pagamento (dias)</label>
                  <input type="number" value={editForm.paymentTermDays} onChange={e => setEditForm({ ...editForm, paymentTermDays: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Organização</label>
                  <select value={editForm.organizationId} onChange={e => setEditForm({ ...editForm, organizationId: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                    <option value="">— Nenhuma —</option>
                    {organizations.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Observações</label>
                  <textarea rows={3} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Nome Faturamento</span><span className="text-foreground font-medium">{account.billingName || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Email Faturamento</span>
                    {account.billingEmail ? <a href={`mailto:${account.billingEmail}`} className="text-primary hover:underline">{account.billingEmail}</a> : <span className="text-muted-foreground">—</span>}
                  </div>
                  <div className="flex justify-between"><span className="text-muted-foreground">CPF/CNPJ</span><span className="text-foreground">{account.taxId || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Tipo</span><span className="text-foreground">{TYPE_MAP[account.accountType] || account.accountType}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Limite de Crédito</span><span className="text-foreground">{money(account.creditLimit)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Prazo Pagamento</span><span className="text-foreground">{account.paymentTermDays || 0} dias</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Criado em</span><span className="text-foreground">{fmt(account.createdAt)}</span></div>
                </div>
                {account.organization && (
                  <div className="pt-3 border-t border-border/50">
                    <div className="flex justify-between"><span className="text-muted-foreground text-sm">Organização</span><span className="text-foreground text-sm font-medium">{account.organization.name}</span></div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Financial Summary */}
          <div className="space-y-4">
            <div className="bg-card border border-border/60 rounded-xl p-5">
              <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-4"><BarChart3 className="h-4 w-4 text-primary" /> Resumo Financeiro</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <p className="text-2xl font-bold text-foreground">{summary.proposalCount}</p>
                  <p className="text-xs text-muted-foreground">Propostas</p>
                </div>
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <p className="text-2xl font-bold text-foreground">{summary.invoiceCount}</p>
                  <p className="text-xs text-muted-foreground">Faturas</p>
                </div>
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <p className="text-2xl font-bold text-foreground">{summary.contractCount}</p>
                  <p className="text-xs text-muted-foreground">Contratos</p>
                </div>
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <p className="text-2xl font-bold text-foreground">{summary.projectCount}</p>
                  <p className="text-xs text-muted-foreground">Projetos</p>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border/60 rounded-xl p-5">
              <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-3"><DollarSign className="h-4 w-4 text-emerald-500" /> Extrato</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Total Faturado</span><span className="text-foreground font-medium">{money(summary.totalInvoiced)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total Pago</span><span className="text-green-500 font-medium">{money(summary.totalPaid)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Pendente</span><span className="text-amber-500 font-medium">{money(summary.totalOutstanding)}</span></div>
                <div className="flex justify-between border-t border-border/50 pt-2"><span className="text-muted-foreground">Despesas</span><span className="text-red-500 font-medium">{money(summary.totalExpenses)}</span></div>
              </div>
            </div>
          </div>

          {/* Notes */}
          {account.notes && (
            <div className="bg-card border border-border/60 rounded-xl p-5 md:col-span-2">
              <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-2"><StickyNote className="h-4 w-4" /> Observações</h3>
              <p className="text-sm text-foreground/80 whitespace-pre-wrap">{account.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: CONTACTS ═══ */}
      {activeTab === 'contacts' && (
        <div className="space-y-4">
          {can('customers:manage') && (
            <div className="flex justify-end">
              <button onClick={() => { setShowAddContact(true); loadAllContacts() }} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                <UserPlus className="h-4 w-4" /> Vincular Contato
              </button>
            </div>
          )}

          {/* Add contact form */}
          {showAddContact && (
            <form onSubmit={handleAddContact} className="bg-card border border-border/60 rounded-xl p-4 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input value={contactSearch} onChange={e => setContactSearch(e.target.value)} placeholder="Buscar contato por nome, email ou telefone..." className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              </div>
              {contactSearch && (
                <div className="max-h-40 overflow-y-auto border border-border rounded-lg divide-y divide-border/30">
                  {filteredAllContacts.map((c: any) => (
                    <button key={c.id} type="button" onClick={() => { setAddContactId(c.id); setContactSearch(c.name) }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center justify-between ${addContactId === c.id ? 'bg-primary/5 font-medium' : ''}`}>
                      <span>{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.phoneNumber}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1 block">Função</label>
                  <select value={addContactRole} onChange={e => setAddContactRole(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm">
                    {Object.entries(ROLE_MAP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <button type="submit" disabled={!addContactId} className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg disabled:opacity-50">Vincular</button>
                <button type="button" onClick={() => { setShowAddContact(false); setContactSearch(''); setAddContactId('') }} className="px-4 py-2 bg-muted text-foreground text-sm rounded-lg">Cancelar</button>
              </div>
            </form>
          )}

          {/* Members list */}
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b border-border/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Nome</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Telefone</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Função</th>
                  {can('customers:manage') && <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {(account.members || []).map((m: any) => (
                  <tr key={m.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium text-foreground flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary shrink-0">
                        {(m.contact.name || 'U')[0].toUpperCase()}
                      </div>
                      {m.contact.name}
                      {m.isPrimary && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">Principal</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{m.contact.email || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{m.contact.phoneNumber}</td>
                    <td className="px-4 py-3 text-muted-foreground">{ROLE_MAP[m.role] || m.role}</td>
                    {can('customers:manage') && (
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => handleRemoveContact(m.contactId)} className="p-1 rounded text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {(account.members || []).length === 0 && (
              <div className="py-12 text-center text-muted-foreground text-sm">Nenhum contato vinculado.</div>
            )}
          </div>
        </div>
      )}

      {/* ═══ TAB: PROPOSALS ═══ */}
      {activeTab === 'proposals' && (
        <div className="space-y-4">
          {can('proposals:manage') && (
            <div className="flex justify-end">
              <button onClick={() => setShowCreateForm(showCreateForm === 'proposal' ? null : 'proposal')} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                <Plus className="h-4 w-4" /> Nova Proposta
              </button>
            </div>
          )}
          {showCreateForm === 'proposal' && (
            <div className="bg-card border border-border/60 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-medium text-foreground">Nova Proposta</h4>
              <input value={propForm.subject} onChange={e => setPropForm({ ...propForm, subject: e.target.value })} placeholder="Assunto da proposta *" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Válida até</label>
                <input type="date" value={propForm.openTill} onChange={e => setPropForm({ ...propForm, openTill: e.target.value })} className="w-full md:w-1/3 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              </div>
              <div className="text-xs text-muted-foreground font-medium">Itens</div>
              {propForm.items.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 md:col-span-2">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Catálogo' : ''}</label>
                    <select value={item.catalogItemId} onChange={e => handleCatalogSelect(propForm.items, i, e.target.value, items => setPropForm({ ...propForm, items }))} className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                      <option value="">— Manual —</option>
                      {catalogItems.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-12 md:col-span-3">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Descrição *' : ''}</label>
                    <input value={item.description} onChange={e => { const ni = [...propForm.items]; ni[i] = { ...ni[i], description: e.target.value }; setPropForm({ ...propForm, items: ni }) }} placeholder="Descrição" className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div className="col-span-4 md:col-span-1">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Qtd' : ''}</label>
                    <input type="number" min={1} value={item.quantity} onChange={e => { const ni = [...propForm.items]; ni[i] = { ...ni[i], quantity: Number(e.target.value) }; setPropForm({ ...propForm, items: ni }) }} className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div className="col-span-4 md:col-span-1">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Unid.' : ''}</label>
                    <input value={item.unit} onChange={e => { const ni = [...propForm.items]; ni[i] = { ...ni[i], unit: e.target.value }; setPropForm({ ...propForm, items: ni }) }} className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div className="col-span-4 md:col-span-1">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Preço Un.' : ''}</label>
                    <input type="number" step="0.01" value={item.unitPrice} onChange={e => { const ni = [...propForm.items]; ni[i] = { ...ni[i], unitPrice: Number(e.target.value) }; setPropForm({ ...propForm, items: ni }) }} className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div className="col-span-4 md:col-span-1">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Desc.%' : ''}</label>
                    <input type="number" step="0.01" min={0} max={100} value={item.discount} onChange={e => { const ni = [...propForm.items]; ni[i] = { ...ni[i], discount: Number(e.target.value) }; setPropForm({ ...propForm, items: ni }) }} className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div className="col-span-4 md:col-span-1">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Imp.%' : ''}</label>
                    <input type="number" step="0.01" min={0} value={item.taxRate} onChange={e => { const ni = [...propForm.items]; ni[i] = { ...ni[i], taxRate: Number(e.target.value) }; setPropForm({ ...propForm, items: ni }) }} className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div className="col-span-3 md:col-span-1 text-right">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Total' : ''}</label>
                    <span className="text-sm font-medium text-foreground leading-[38px]">{money(calcLineTotal(item))}</span>
                  </div>
                  <div className="col-span-1 flex items-end justify-center">
                    {propForm.items.length > 1 && <button type="button" onClick={() => setPropForm({ ...propForm, items: propForm.items.filter((_, j) => j !== i) })} className="p-2 text-destructive hover:bg-destructive/10 rounded-lg"><X className="h-4 w-4" /></button>}
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setPropForm({ ...propForm, items: [...propForm.items, { ...emptyItem }] })} className="text-xs text-primary hover:underline flex items-center gap-1"><Plus className="h-3 w-3" /> Adicionar item</button>
                <div className="text-sm font-bold text-foreground">Total: {money(propTotal)}</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Notas</label>
                  <textarea rows={3} value={propForm.notes} onChange={e => setPropForm({ ...propForm, notes: e.target.value })} placeholder="Notas internas..." className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Termos / Condições</label>
                  <textarea rows={3} value={propForm.terms} onChange={e => setPropForm({ ...propForm, terms: e.target.value })} placeholder="Termos e condições..." className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={createProposal} disabled={saving} className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg disabled:opacity-50 flex items-center gap-1.5">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Criar</button>
                <button onClick={() => setShowCreateForm(null)} className="px-4 py-2 bg-muted text-foreground text-sm rounded-lg">Cancelar</button>
              </div>
            </div>
          )}
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b border-border/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Nº</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Assunto</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contato</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {proposals.map((p: any) => {
                  const s = PROPOSAL_STATUS[p.status] || PROPOSAL_STATUS.DRAFT
                  return (
                    <tr key={p.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium text-foreground">{p.prefix}{p.number}</td>
                      <td className="px-4 py-3 text-foreground">{p.subject}</td>
                      <td className="px-4 py-3 text-muted-foreground">{p.contact?.name || '—'}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span></td>
                      <td className="px-4 py-3 text-right text-foreground">{money(p.total)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmt(p.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {proposals.length === 0 && !showCreateForm && <div className="py-12 text-center text-muted-foreground text-sm">Nenhuma proposta encontrada.</div>}
          </div>
        </div>
      )}

      {/* ═══ TAB: INVOICES ═══ */}
      {activeTab === 'invoices' && (
        <div className="space-y-4">
          {can('invoices:manage') && (
            <div className="flex justify-end">
              <button onClick={() => setShowCreateForm(showCreateForm === 'invoice' ? null : 'invoice')} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                <Plus className="h-4 w-4" /> Nova Fatura
              </button>
            </div>
          )}
          {showCreateForm === 'invoice' && (
            <div className="bg-card border border-border/60 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-medium text-foreground">Nova Fatura</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Vencimento</label>
                  <input type="date" value={invForm.dueDate} onChange={e => setInvForm({ ...invForm, dueDate: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div className="flex items-end gap-3 col-span-2">
                  <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input type="checkbox" checked={invForm.recurring} onChange={e => setInvForm({ ...invForm, recurring: e.target.checked })} className="rounded border-border" /> Recorrente
                  </label>
                  {invForm.recurring && (
                    <select value={invForm.recurringCycle} onChange={e => setInvForm({ ...invForm, recurringCycle: e.target.value })} className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                      <option value="WEEKLY">Semanal</option>
                      <option value="BIWEEKLY">Quinzenal</option>
                      <option value="MONTHLY">Mensal</option>
                      <option value="QUARTERLY">Trimestral</option>
                      <option value="SEMIANNUALLY">Semestral</option>
                      <option value="ANNUALLY">Anual</option>
                    </select>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted-foreground font-medium">Itens</div>
              {invForm.items.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 md:col-span-2">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Catálogo' : ''}</label>
                    <select value={item.catalogItemId} onChange={e => handleCatalogSelect(invForm.items, i, e.target.value, items => setInvForm({ ...invForm, items }))} className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                      <option value="">— Manual —</option>
                      {catalogItems.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-12 md:col-span-3">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Descrição *' : ''}</label>
                    <input value={item.description} onChange={e => { const ni = [...invForm.items]; ni[i] = { ...ni[i], description: e.target.value }; setInvForm({ ...invForm, items: ni }) }} placeholder="Descrição" className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div className="col-span-4 md:col-span-1">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Qtd' : ''}</label>
                    <input type="number" min={1} value={item.quantity} onChange={e => { const ni = [...invForm.items]; ni[i] = { ...ni[i], quantity: Number(e.target.value) }; setInvForm({ ...invForm, items: ni }) }} className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div className="col-span-4 md:col-span-1">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Unid.' : ''}</label>
                    <input value={item.unit} onChange={e => { const ni = [...invForm.items]; ni[i] = { ...ni[i], unit: e.target.value }; setInvForm({ ...invForm, items: ni }) }} className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div className="col-span-4 md:col-span-1">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Preço Un.' : ''}</label>
                    <input type="number" step="0.01" value={item.unitPrice} onChange={e => { const ni = [...invForm.items]; ni[i] = { ...ni[i], unitPrice: Number(e.target.value) }; setInvForm({ ...invForm, items: ni }) }} className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div className="col-span-4 md:col-span-1">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Desc.%' : ''}</label>
                    <input type="number" step="0.01" min={0} max={100} value={item.discount} onChange={e => { const ni = [...invForm.items]; ni[i] = { ...ni[i], discount: Number(e.target.value) }; setInvForm({ ...invForm, items: ni }) }} className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div className="col-span-4 md:col-span-1">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Imp.%' : ''}</label>
                    <input type="number" step="0.01" min={0} value={item.taxRate} onChange={e => { const ni = [...invForm.items]; ni[i] = { ...ni[i], taxRate: Number(e.target.value) }; setInvForm({ ...invForm, items: ni }) }} className="w-full bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                  <div className="col-span-3 md:col-span-1 text-right">
                    <label className="text-xs text-muted-foreground mb-1 block">{i === 0 ? 'Total' : ''}</label>
                    <span className="text-sm font-medium text-foreground leading-[38px]">{money(calcLineTotal(item))}</span>
                  </div>
                  <div className="col-span-1 flex items-end justify-center">
                    {invForm.items.length > 1 && <button type="button" onClick={() => setInvForm({ ...invForm, items: invForm.items.filter((_, j) => j !== i) })} className="p-2 text-destructive hover:bg-destructive/10 rounded-lg"><X className="h-4 w-4" /></button>}
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setInvForm({ ...invForm, items: [...invForm.items, { ...emptyItem }] })} className="text-xs text-primary hover:underline flex items-center gap-1"><Plus className="h-3 w-3" /> Adicionar item</button>
                <div className="text-sm font-bold text-foreground">Total: {money(invTotal)}</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Notas</label>
                  <textarea rows={3} value={invForm.notes} onChange={e => setInvForm({ ...invForm, notes: e.target.value })} placeholder="Notas internas..." className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Termos / Condições</label>
                  <textarea rows={3} value={invForm.terms} onChange={e => setInvForm({ ...invForm, terms: e.target.value })} placeholder="Termos e condições..." className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={createInvoice} disabled={saving} className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg disabled:opacity-50 flex items-center gap-1.5">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Criar</button>
                <button onClick={() => setShowCreateForm(null)} className="px-4 py-2 bg-muted text-foreground text-sm rounded-lg">Cancelar</button>
              </div>
            </div>
          )}
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b border-border/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Nº</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Pago</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Vencimento</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {invoices.map((inv: any) => {
                  const s = INVOICE_STATUS[inv.status] || INVOICE_STATUS.DRAFT
                  return (
                    <tr key={inv.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium text-foreground">{inv.prefix}{inv.number}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span></td>
                      <td className="px-4 py-3 text-right text-foreground">{money(inv.total)}</td>
                      <td className="px-4 py-3 text-right text-green-500">{money(inv.amountPaid)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmt(inv.dueDate)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmt(inv.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {invoices.length === 0 && !showCreateForm && <div className="py-12 text-center text-muted-foreground text-sm">Nenhuma fatura encontrada.</div>}
          </div>
        </div>
      )}

      {/* ═══ TAB: PAYMENTS ═══ */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          {can('payments:manage') && invoices.length > 0 && (
            <div className="flex justify-end">
              <button onClick={() => setShowCreateForm(showCreateForm === 'payment' ? null : 'payment')} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                <Plus className="h-4 w-4" /> Registrar Pagamento
              </button>
            </div>
          )}
          {showCreateForm === 'payment' && (
            <div className="bg-card border border-border/60 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-medium text-foreground">Registrar Pagamento</h4>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Fatura *</label>
                <select value={payForm.invoiceId} onChange={e => { setPayForm({ ...payForm, invoiceId: e.target.value }); const inv = invoices.find((i: any) => i.id === e.target.value); if (inv) setPayForm(pf => ({ ...pf, invoiceId: e.target.value, amount: String(Number(inv.total) - Number(inv.amountPaid || 0)) })) }} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                  <option value="">Selecione...</option>
                  {invoices.filter((i: any) => i.status !== 'PAID' && i.status !== 'CANCELLED').map((i: any) => <option key={i.id} value={i.id}>{i.prefix}{i.number} — {money(i.total)} (pendente: {money(Number(i.total) - Number(i.amountPaid || 0))})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Valor *</label>
                  <input type="number" step="0.01" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Método *</label>
                  <select value={payForm.method} onChange={e => setPayForm({ ...payForm, method: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                    <option value="PIX">PIX</option>
                    <option value="CREDIT_CARD">Cartão Crédito</option>
                    <option value="DEBIT_CARD">Cartão Débito</option>
                    <option value="TRANSFER">Transferência</option>
                    <option value="BOLETO">Boleto</option>
                    <option value="CASH">Dinheiro</option>
                    <option value="OTHER">Outro</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Observação</label>
                <input value={payForm.note} onChange={e => setPayForm({ ...payForm, note: e.target.value })} placeholder="Opcional" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={createPayment} disabled={saving} className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg disabled:opacity-50 flex items-center gap-1.5">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Registrar</button>
                <button onClick={() => setShowCreateForm(null)} className="px-4 py-2 bg-muted text-foreground text-sm rounded-lg">Cancelar</button>
              </div>
            </div>
          )}
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b border-border/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Fatura</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Valor</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Método</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Transação</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {payments.map((pay: any) => (
                  <tr key={pay.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium text-foreground">{pay.invoice?.prefix}{pay.invoice?.number}</td>
                    <td className="px-4 py-3 text-right text-green-500 font-medium">{money(pay.amount)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{pay.paymentMethod || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{pay.transactionId || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmt(pay.paymentDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {payments.length === 0 && !showCreateForm && <div className="py-12 text-center text-muted-foreground text-sm">Nenhum pagamento encontrado.</div>}
          </div>
        </div>
      )}

      {/* ═══ TAB: CONTRACTS ═══ */}
      {activeTab === 'contracts' && (
        <div className="space-y-4">
          {can('contracts:manage') && (
            <div className="flex justify-end">
              <button onClick={() => setShowCreateForm(showCreateForm === 'contract' ? null : 'contract')} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                <Plus className="h-4 w-4" /> Novo Contrato
              </button>
            </div>
          )}
          {showCreateForm === 'contract' && (
            <div className="bg-card border border-border/60 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-medium text-foreground">Novo Contrato</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Assunto *</label>
                  <input value={ctForm.subject} onChange={e => setCtForm({ ...ctForm, subject: e.target.value })} placeholder="Assunto do contrato" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Tipo</label>
                  <input value={ctForm.type} onChange={e => setCtForm({ ...ctForm, type: e.target.value })} placeholder="Ex: Prestação de Serviços" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Início *</label>
                  <input type="date" value={ctForm.startDate} onChange={e => setCtForm({ ...ctForm, startDate: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Fim</label>
                  <input type="date" value={ctForm.endDate} onChange={e => setCtForm({ ...ctForm, endDate: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Valor</label>
                  <input type="number" step="0.01" value={ctForm.value} onChange={e => setCtForm({ ...ctForm, value: e.target.value })} placeholder="R$" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-muted-foreground">Conteúdo do Contrato</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { loadTemplates(); setShowTemplateSelector(!showTemplateSelector) }} className="text-xs text-primary hover:underline flex items-center gap-1"><FileText className="h-3 w-3" /> Usar Modelo</button>
                    <button type="button" onClick={autoFillMergeFields} className="text-xs text-primary hover:underline flex items-center gap-1"><RefreshCw className="h-3 w-3" /> Preencher Campos</button>
                  </div>
                </div>
                {showTemplateSelector && ctTemplates.length > 0 && (
                  <div className="mb-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto p-1">
                    {ctTemplates.map((t: any) => (
                      <button key={t.id} type="button" onClick={() => applyTemplate(t)}
                        className="group text-left bg-background border border-border/60 rounded-xl p-4 hover:border-primary/40 hover:shadow-md transition-all duration-200">
                        <div className="flex items-start gap-2 mb-2">
                          <span className="text-xl">{t.icon || '📄'}</span>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">{t.name}</h4>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground">{t.category || 'Geral'}</span>
                          </div>
                        </div>
                        {t.description && <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>}
                      </button>
                    ))}
                  </div>
                )}
                <textarea rows={10} value={ctForm.content} onChange={e => setCtForm({ ...ctForm, content: e.target.value })} placeholder="Corpo do contrato. Use merge fields: {{NOME_CLIENTE}}, {{CPF_CNPJ}}, {{VALOR}}, {{DATA_INICIO}}, {{DATA_FIM}}, {{DATA_ATUAL}}..." className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none font-mono" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Observações</label>
                <textarea rows={2} value={ctForm.notes} onChange={e => setCtForm({ ...ctForm, notes: e.target.value })} placeholder="Observações internas..." className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input type="checkbox" checked={ctForm.autoRenew} onChange={e => setCtForm({ ...ctForm, autoRenew: e.target.checked })} className="rounded border-border" /> Renovação automática
                </label>
                {ctForm.autoRenew && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground">Dias antes do venc.</label>
                    <input type="number" value={ctForm.renewalDays} onChange={e => setCtForm({ ...ctForm, renewalDays: e.target.value })} className="w-20 bg-background border border-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={createContract} disabled={saving} className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg disabled:opacity-50 flex items-center gap-1.5">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Criar</button>
                <button onClick={() => setShowCreateForm(null)} className="px-4 py-2 bg-muted text-foreground text-sm rounded-lg">Cancelar</button>
              </div>
            </div>
          )}
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b border-border/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Nº</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Título</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Valor</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Início</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Fim</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {contracts.map((c: any) => {
                  const s = CONTRACT_STATUS[c.status] || CONTRACT_STATUS.DRAFT
                  return (
                    <tr key={c.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium text-foreground">{c.prefix}{c.number}</td>
                      <td className="px-4 py-3 text-foreground">{c.title}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span></td>
                      <td className="px-4 py-3 text-right text-foreground">{money(c.contractValue)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmt(c.startDate)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmt(c.endDate)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {contracts.length === 0 && !showCreateForm && <div className="py-12 text-center text-muted-foreground text-sm">Nenhum contrato encontrado.</div>}
          </div>
        </div>
      )}

      {/* ═══ TAB: PROJECTS ═══ */}
      {activeTab === 'projects' && (
        <div className="space-y-4">
          {can('projects:manage') && (
            <div className="flex justify-end">
              <button onClick={() => setShowCreateForm(showCreateForm === 'project' ? null : 'project')} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                <Plus className="h-4 w-4" /> Novo Projeto
              </button>
            </div>
          )}
          {showCreateForm === 'project' && (
            <div className="bg-card border border-border/60 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-medium text-foreground">Novo Projeto</h4>
              <input value={projForm.name} onChange={e => setProjForm({ ...projForm, name: e.target.value })} placeholder="Nome do projeto *" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Descrição</label>
                <textarea rows={3} value={projForm.description} onChange={e => setProjForm({ ...projForm, description: e.target.value })} placeholder="Descrição do projeto..." className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                  <select value={projForm.status} onChange={e => setProjForm({ ...projForm, status: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                    <option value="NOT_STARTED">Não Iniciado</option>
                    <option value="IN_PROGRESS">Em Andamento</option>
                    <option value="ON_HOLD">Pausado</option>
                    <option value="COMPLETED">Concluído</option>
                    <option value="CANCELLED">Cancelado</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Início</label>
                  <input type="date" value={projForm.startDate} onChange={e => setProjForm({ ...projForm, startDate: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Prazo</label>
                  <input type="date" value={projForm.deadline} onChange={e => setProjForm({ ...projForm, deadline: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Cobrança</label>
                  <select value={projForm.billingType} onChange={e => setProjForm({ ...projForm, billingType: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                    <option value="FIXED">Preço Fixo</option>
                    <option value="HOURLY">Por Hora</option>
                    <option value="FREE">Gratuito</option>
                  </select>
                </div>
              </div>
              {projForm.billingType === 'FIXED' && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Custo Fixo</label>
                  <input type="number" step="0.01" value={projForm.fixedCost} onChange={e => setProjForm({ ...projForm, fixedCost: e.target.value })} placeholder="R$" className="w-full md:w-1/3 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
              )}
              {projForm.billingType === 'HOURLY' && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Valor/Hora</label>
                  <input type="number" step="0.01" value={projForm.hourlyRate} onChange={e => setProjForm({ ...projForm, hourlyRate: e.target.value })} placeholder="R$/h" className="w-full md:w-1/3 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={createProject} disabled={saving} className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg disabled:opacity-50 flex items-center gap-1.5">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Criar</button>
                <button onClick={() => setShowCreateForm(null)} className="px-4 py-2 bg-muted text-foreground text-sm rounded-lg">Cancelar</button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p: any) => {
              const s = PROJECT_STATUS[p.status] || PROJECT_STATUS.NOT_STARTED
              return (
                <div key={p.id} className="bg-card border border-border/50 rounded-xl p-5">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="text-foreground font-medium truncate">{p.name}</h4>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.color} shrink-0 ml-2`}>{s.label}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 mb-2">
                    <div className="bg-primary rounded-full h-1.5" style={{ width: `${p.progress}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{p.progress}% concluído</span>
                    <span>{p._count?.tasks || 0} tarefas</span>
                  </div>
                  {p.deadline && <p className="text-xs text-muted-foreground mt-1">Prazo: {fmt(p.deadline)}</p>}
                </div>
              )
            })}
            {projects.length === 0 && !showCreateForm && (
              <div className="md:col-span-3 py-12 text-center text-muted-foreground text-sm">Nenhum projeto encontrado.</div>
            )}
          </div>
        </div>
      )}

      {/* ═══ TAB: EXPENSES ═══ */}
      {activeTab === 'expenses' && (
        <div className="space-y-4">
          {can('expenses:manage') && (
            <div className="flex justify-end">
              <button onClick={() => { setShowCreateForm(showCreateForm === 'expense' ? null : 'expense'); if (showCreateForm !== 'expense') loadExpenseData() }} className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                <Plus className="h-4 w-4" /> Nova Despesa
              </button>
            </div>
          )}
          {showCreateForm === 'expense' && (
            <div className="bg-card border border-border/60 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-medium text-foreground">Nova Despesa</h4>
              <input value={expForm.name} onChange={e => setExpForm({ ...expForm, name: e.target.value })} placeholder="Nome da despesa *" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Valor *</label>
                  <input type="number" step="0.01" value={expForm.amount} onChange={e => setExpForm({ ...expForm, amount: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Imposto %</label>
                  <input type="number" step="0.01" min={0} value={expForm.taxRate} onChange={e => setExpForm({ ...expForm, taxRate: e.target.value })} placeholder="0" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Data *</label>
                  <input type="date" value={expForm.date} onChange={e => setExpForm({ ...expForm, date: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Categoria</label>
                  <select value={expForm.categoryId} onChange={e => setExpForm({ ...expForm, categoryId: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                    <option value="">— Nenhuma —</option>
                    {expCategories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Projeto</label>
                  <select value={expForm.projectId} onChange={e => setExpForm({ ...expForm, projectId: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                    <option value="">— Nenhum —</option>
                    {expProjects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Referência</label>
                  <input value={expForm.reference} onChange={e => setExpForm({ ...expForm, reference: e.target.value })} placeholder="Nº nota fiscal, recibo..." className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Observação</label>
                <input value={expForm.note} onChange={e => setExpForm({ ...expForm, note: e.target.value })} placeholder="Observação opcional..." className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input type="checkbox" checked={expForm.billable} onChange={e => setExpForm({ ...expForm, billable: e.target.checked })} className="rounded border-border" /> Faturável ao cliente
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input type="checkbox" checked={expForm.recurring} onChange={e => setExpForm({ ...expForm, recurring: e.target.checked })} className="rounded border-border" /> Recorrente
                </label>
                {expForm.recurring && (
                  <select value={expForm.recurringCycle} onChange={e => setExpForm({ ...expForm, recurringCycle: e.target.value })} className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                    <option value="WEEKLY">Semanal</option>
                    <option value="MONTHLY">Mensal</option>
                    <option value="QUARTERLY">Trimestral</option>
                    <option value="ANNUALLY">Anual</option>
                  </select>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={createExpense} disabled={saving} className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg disabled:opacity-50 flex items-center gap-1.5">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Criar</button>
                <button onClick={() => setShowCreateForm(null)} className="px-4 py-2 bg-muted text-foreground text-sm rounded-lg">Cancelar</button>
              </div>
            </div>
          )}
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b border-border/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Despesa</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Categoria</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Valor</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Faturável</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {expenses.map((e: any) => (
                  <tr key={e.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium text-foreground">{e.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{e.category?.name || '—'}</td>
                    <td className="px-4 py-3 text-right text-foreground">{money(e.amount)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmt(e.date)}</td>
                    <td className="px-4 py-3">{e.billable ? <span className="text-green-500 text-xs">Sim</span> : <span className="text-muted-foreground text-xs">Não</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {expenses.length === 0 && !showCreateForm && <div className="py-12 text-center text-muted-foreground text-sm">Nenhuma despesa encontrada.</div>}
          </div>
        </div>
      )}

      {/* ═══ TAB: TASKS ═══ */}
      {activeTab === 'tasks' && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-card border border-border/60 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{taskStats.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
            <div className="bg-card border border-border/60 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-green-500">{taskStats.completed}</p>
              <p className="text-xs text-muted-foreground">Concluídas</p>
            </div>
            <div className="bg-card border border-border/60 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-red-500">{taskStats.overdue}</p>
              <p className="text-xs text-muted-foreground">Atrasadas</p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button onClick={() => setTaskViewMode('kanban')} className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${taskViewMode === 'kanban' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground'}`}>Kanban</button>
              <button onClick={() => setTaskViewMode('list')} className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${taskViewMode === 'list' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground'}`}>Lista</button>
            </div>
            <button onClick={() => setShowTaskForm(!showTaskForm)} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 flex items-center gap-1"><Plus className="h-3 w-3" /> Nova Tarefa</button>
          </div>

          {/* Create Form */}
          {showTaskForm && (
            <div className="bg-card border border-border/60 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-medium text-foreground">Nova Tarefa</h4>
              <input value={taskForm.name} onChange={e => setTaskForm({ ...taskForm, name: e.target.value })} placeholder="Nome da tarefa *" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              <textarea value={taskForm.description} onChange={e => setTaskForm({ ...taskForm, description: e.target.value })} placeholder="Descrição" rows={2} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <select value={taskForm.status} onChange={e => setTaskForm({ ...taskForm, status: e.target.value })} className="bg-background border border-border rounded-lg px-3 py-2 text-sm">
                  {TASK_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <select value={taskForm.priority} onChange={e => setTaskForm({ ...taskForm, priority: e.target.value })} className="bg-background border border-border rounded-lg px-3 py-2 text-sm">
                  <option value="LOW">Baixa</option>
                  <option value="MEDIUM">Média</option>
                  <option value="HIGH">Alta</option>
                  <option value="URGENT">Urgente</option>
                </select>
                <input type="date" value={taskForm.dueDate} onChange={e => setTaskForm({ ...taskForm, dueDate: e.target.value })} className="bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                <select value={taskForm.projectId} onChange={e => setTaskForm({ ...taskForm, projectId: e.target.value })} className="bg-background border border-border rounded-lg px-3 py-2 text-sm">
                  <option value="">Sem projeto</option>
                  {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowTaskForm(false)} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
                <button onClick={createTask} disabled={saving} className="px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">{saving ? 'Salvando...' : 'Criar Tarefa'}</button>
              </div>
            </div>
          )}

          {/* Kanban */}
          {taskViewMode === 'kanban' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {taskGrouped.map(col => (
                <div key={col.key} className="bg-card border border-border/60 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border/60 flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${col.color}`} />
                    <span className="text-xs font-medium text-foreground">{col.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{col.tasks.length}</span>
                  </div>
                  <div className="p-2 space-y-2 min-h-[100px]">
                    {col.tasks.map((t: any) => {
                      const pri = PRIORITY_MAP[t.priority] || PRIORITY_MAP.MEDIUM
                      const overdue = t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'COMPLETED'
                      return (
                        <div key={t.id} className={`bg-background border rounded-lg p-3 space-y-2 ${overdue ? 'border-red-500/50' : 'border-border/60'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-foreground leading-tight">{t.name}</span>
                            <button onClick={() => handleDeleteTask(t.id)} className="text-muted-foreground hover:text-red-500 shrink-0"><Trash2 className="h-3 w-3" /></button>
                          </div>
                          <div className="flex flex-wrap gap-1.5 text-[10px]">
                            <span className={`font-medium ${pri.color}`}>{pri.label}</span>
                            {t.project && <span className="text-muted-foreground">📁 {t.project.name}</span>}
                            {t.dueDate && <span className={overdue ? 'text-red-500 font-medium' : 'text-muted-foreground'}>📅 {fmt(t.dueDate)}</span>}
                            {t.totalTimeTracked > 0 && <span className="text-muted-foreground">⏱ {(t.totalTimeTracked / 60).toFixed(1)}h</span>}
                          </div>
                          <div className="flex items-center gap-1 pt-1 border-t border-border/30">
                            {TASK_STATUSES.filter(s => s.key !== col.key).map(s => (
                              <button key={s.key} onClick={() => handleTaskStatusChange(t.id, s.key)} className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted/50 transition-colors">{s.label}</button>
                            ))}
                            <button onClick={() => { setShowTimeForm(showTimeForm === t.id ? null : t.id); setTimeHours('') }} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted/50">⏱</button>
                          </div>
                          {showTimeForm === t.id && (
                            <div className="flex gap-1 pt-1">
                              <input type="number" step="0.25" min="0.25" value={timeHours} onChange={e => setTimeHours(e.target.value)} placeholder="Horas" className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs" />
                              <button onClick={() => handleAddTime(t.id)} className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90">OK</button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {col.tasks.length === 0 && <p className="text-[10px] text-muted-foreground text-center py-4">Vazio</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* List */}
          {taskViewMode === 'list' && (
            <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5">Tarefa</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Prioridade</th><th className="px-4 py-2.5">Projeto</th><th className="px-4 py-2.5">Prazo</th><th className="px-4 py-2.5 text-right">Ações</th>
                </tr></thead>
                <tbody>
                  {customerTasks.map((t: any) => {
                    const pri = PRIORITY_MAP[t.priority] || PRIORITY_MAP.MEDIUM
                    const status = TASK_STATUSES.find(s => s.key === t.status)
                    const overdue = t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'COMPLETED'
                    return (
                      <tr key={t.id} className="border-b border-border/30 hover:bg-muted/30">
                        <td className="px-4 py-3 text-foreground font-medium">{t.name}</td>
                        <td className="px-4 py-3">
                          <select value={t.status} onChange={e => handleTaskStatusChange(t.id, e.target.value)} className="bg-background border border-border rounded px-2 py-1 text-xs">
                            {TASK_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        </td>
                        <td className={`px-4 py-3 text-xs font-medium ${pri.color}`}>{pri.label}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{t.project?.name || '—'}</td>
                        <td className={`px-4 py-3 text-xs ${overdue ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>{t.dueDate ? fmt(t.dueDate) : '—'}</td>
                        <td className="px-4 py-3 text-right"><button onClick={() => handleDeleteTask(t.id)} className="text-muted-foreground hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {customerTasks.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">Nenhuma tarefa encontrada.</div>}
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: REPORT ═══ */}
      {activeTab === 'report' && (
        <div className="space-y-4">
          {loadingReport ? (
            <div className="py-12 text-center text-muted-foreground text-sm">Carregando relatório...</div>
          ) : !report ? (
            <div className="py-12 text-center text-muted-foreground text-sm">Carregando...</div>
          ) : (
            <>
              {/* Revenue */}
              <div className="bg-card border border-border/60 rounded-xl p-5">
                <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-4"><TrendingUp className="h-4 w-4 text-green-500" /> Receita</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div><p className="text-xs text-muted-foreground">Total Faturado</p><p className="text-lg font-bold text-foreground">{money(report.revenue?.total)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Pago</p><p className="text-lg font-bold text-green-500">{money(report.revenue?.paid)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Pendente</p><p className="text-lg font-bold text-amber-500">{money(report.revenue?.pending)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Em Atraso</p><p className="text-lg font-bold text-red-500">{money(report.revenue?.overdue)}</p></div>
                </div>
              </div>

              {/* Grid 2x3 */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Proposals */}
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-3">📋 Propostas</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="text-foreground font-medium">{report.proposals?.total || 0}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Aceitas</span><span className="text-green-500 font-medium">{report.proposals?.accepted || 0}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Recusadas</span><span className="text-red-500 font-medium">{report.proposals?.declined || 0}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Pendentes</span><span className="text-amber-500 font-medium">{report.proposals?.pending || 0}</span></div>
                    <div className="flex justify-between border-t border-border/50 pt-2"><span className="text-muted-foreground">Taxa de Conversão</span><span className="text-foreground font-medium">{(report.proposals?.conversionRate || 0).toFixed(1)}%</span></div>
                  </div>
                </div>

                {/* Contracts */}
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-3">📜 Contratos</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="text-foreground font-medium">{report.contracts?.total || 0}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Ativos</span><span className="text-green-500 font-medium">{report.contracts?.active || 0}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Expirados</span><span className="text-amber-500 font-medium">{report.contracts?.expired || 0}</span></div>
                    <div className="flex justify-between border-t border-border/50 pt-2"><span className="text-muted-foreground">Valor Total</span><span className="text-foreground font-medium">{money(report.contracts?.totalValue)}</span></div>
                  </div>
                </div>

                {/* Projects */}
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-3">📁 Projetos</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="text-foreground font-medium">{report.projects?.total || 0}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Completos</span><span className="text-green-500 font-medium">{report.projects?.completed || 0}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Em Progresso</span><span className="text-blue-500 font-medium">{report.projects?.inProgress || 0}</span></div>
                    <div className="flex justify-between border-t border-border/50 pt-2"><span className="text-muted-foreground">Progresso Médio</span><span className="text-foreground font-medium">{(report.projects?.avgProgress || 0).toFixed(0)}%</span></div>
                  </div>
                </div>

                {/* Tasks */}
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-3"><Target className="h-4 w-4 text-blue-500" /> Tarefas</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="text-foreground font-medium">{report.tasks?.total || 0}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Completas</span><span className="text-green-500 font-medium">{report.tasks?.completed || 0}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Em Progresso</span><span className="text-blue-500 font-medium">{report.tasks?.inProgress || 0}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Atrasadas</span><span className="text-red-500 font-medium">{report.tasks?.overdue || 0}</span></div>
                    <div className="flex justify-between border-t border-border/50 pt-2"><span className="text-muted-foreground">Taxa Conclusão</span><span className="text-foreground font-medium">{(report.tasks?.completionRate || 0).toFixed(1)}%</span></div>
                  </div>
                </div>

                {/* Expenses */}
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-3">💸 Despesas</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="text-foreground font-medium">{report.expenses?.total || 0}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Valor Total</span><span className="text-foreground font-medium">{money(report.expenses?.totalAmount)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Faturáveis</span><span className="text-green-500 font-medium">{money(report.expenses?.billable)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Não Faturáveis</span><span className="text-red-500 font-medium">{money(report.expenses?.nonBillable)}</span></div>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              {report.timeline && report.timeline.length > 0 && (
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-3"><Clock className="h-4 w-4 text-blue-500" /> Atividade Recente</h3>
                  <div className="space-y-3">
                    {report.timeline.map((item: any, i: number) => {
                      const ai = ACTIVITY_ICONS[item.action] || { icon: '📌', color: 'text-muted-foreground' }
                      return (
                        <div key={i} className="flex items-start gap-3 text-sm">
                          <span className="text-base">{ai.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-foreground">{item.description}</p>
                            <p className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString('pt-BR')} às {new Date(item.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══ TAB: ACTIVITY ═══ */}
      {activeTab === 'activity' && (
        <div className="space-y-4">
          {/* Filter */}
          <div className="flex items-center gap-3">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <select value={activityFilter} onChange={e => { setActivityFilter(e.target.value); setTimeout(() => loadActivities(1), 0) }} className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
              <option value="">Todas as atividades</option>
              <option value="customer">Cliente</option>
              <option value="proposal">Propostas</option>
              <option value="invoice">Faturas</option>
              <option value="contract">Contratos</option>
              <option value="project">Projetos</option>
              <option value="expense">Despesas</option>
            </select>
          </div>

          {/* Timeline */}
          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            {activities.length === 0 && !loadingActivities ? (
              <div className="py-12 text-center text-muted-foreground text-sm">Nenhuma atividade registrada.</div>
            ) : (
              <div className="divide-y divide-border/30">
                {activities.map((act: any, i: number) => {
                  const ai = ACTIVITY_ICONS[act.action] || { icon: '📌', color: 'text-muted-foreground' }
                  const timeAgo = (() => {
                    const diff = Date.now() - new Date(act.createdAt).getTime()
                    const mins = Math.floor(diff / 60000)
                    if (mins < 1) return 'agora'
                    if (mins < 60) return `há ${mins}min`
                    const hours = Math.floor(mins / 60)
                    if (hours < 24) return `há ${hours}h`
                    const days = Math.floor(hours / 24)
                    if (days < 30) return `há ${days}d`
                    return fmt(act.createdAt)
                  })()
                  return (
                    <div key={act.id || i} className="px-5 py-3.5 flex items-start gap-3 hover:bg-muted/20 transition-colors">
                      <span className="text-lg mt-0.5">{ai.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground">{act.description}</p>
                        {act.oldValue && act.newValue && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <span className="line-through text-red-400">{act.oldValue}</span> → <span className="text-green-400">{act.newValue}</span>
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">{timeAgo}</span>
                          {act.entity && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{act.entity}</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {loadingActivities && <div className="py-4 text-center text-muted-foreground text-sm">Carregando...</div>}
            {activities.length < activityTotal && !loadingActivities && (
              <div className="px-5 py-3 border-t border-border/60 text-center">
                <button onClick={() => loadActivities(activityPage + 1)} className="text-xs text-primary hover:underline">Carregar mais ({activityTotal - activities.length} restantes)</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ TAB: NOTES ═══ */}
      {activeTab === 'notes' && (
        <div className="bg-card border border-border/60 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2"><StickyNote className="h-4 w-4" /> Observações</h3>
          <textarea
            rows={6}
            defaultValue={account.notes || ''}
            onChange={e => setNoteText(e.target.value)}
            onFocus={() => setNoteText(account.notes || '')}
            placeholder="Adicione observações sobre este cliente..."
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none"
          />
          <div className="flex justify-end">
            <button onClick={saveNote} disabled={savingNote} className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg disabled:opacity-50 flex items-center gap-1.5">
              {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Salvar Observações
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
