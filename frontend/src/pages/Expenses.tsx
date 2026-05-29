import { useState, useEffect } from 'react'
import { Wallet, Plus, Trash2, Edit2, X, Tag } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { expenseService, expenseCategoryService, projectService } from '@/services/commercial'
import type { Expense, ExpenseCategory, Project } from '@/types'

type Tab = 'expenses' | 'categories'

export function Expenses() {
  const toast = useToast()
  const { can } = usePermissions()
  const [tab, setTab] = useState<Tab>('expenses')
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [totalAmount, setTotalAmount] = useState(0)
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<any>(null)

  const emptyExpForm = { name: '', categoryId: '', amount: 0, taxRate: 0, currency: 'BRL', date: new Date().toISOString().split('T')[0], note: '', reference: '', billable: false, recurring: false, recurringCycle: 'MONTHLY', projectId: '' }
  const emptyCatForm = { name: '', description: '' }
  const [expForm, setExpForm] = useState(emptyExpForm)
  const [catForm, setCatForm] = useState(emptyCatForm)

  useEffect(() => { load() }, [tab])

  async function load() {
    setLoading(true)
    try {
      if (tab === 'expenses') {
        const res = await expenseService.list()
        setExpenses(res.expenses)
        setTotalAmount(res.totalAmount || 0)
        // Load categories + projects for the form
        const cats = await expenseCategoryService.list()
        setCategories(cats)
        const prj = await projectService.list({ limit: 100 })
        setProjects(prj.projects)
      } else {
        const cats = await expenseCategoryService.list()
        setCategories(cats)
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  // ── Expense CRUD ──
  async function handleExpSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const data = { ...expForm, amount: Number(expForm.amount), taxRate: Number(expForm.taxRate), categoryId: expForm.categoryId || undefined, projectId: expForm.projectId || undefined }
      if (editing) { await expenseService.update(editing.id, data) }
      else { await expenseService.create(data) }
      closeForm(); load()
    } catch (e) { console.error(e) }
  }

  async function handleDeleteExp(id: string) {
    if (!await toast.confirm({ title: 'Excluir despesa', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await expenseService.delete(id); load() } catch (e) { console.error(e) }
  }

  // ── Category CRUD ──
  async function handleCatSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editing) { await expenseCategoryService.update(editing.id, catForm) }
      else { await expenseCategoryService.create(catForm) }
      closeForm(); load()
    } catch (e) { console.error(e) }
  }

  async function handleDeleteCat(id: string) {
    if (!await toast.confirm({ title: 'Excluir categoria', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await expenseCategoryService.delete(id); load() } catch (e) { console.error(e) }
  }

  function closeForm() { setShowForm(false); setEditing(null); setExpForm(emptyExpForm); setCatForm(emptyCatForm) }

  function startEditExp(exp: Expense) {
    setEditing(exp)
    setExpForm({
      name: exp.name, categoryId: exp.categoryId || '', amount: exp.amount, taxRate: exp.taxRate,
      currency: exp.currency, date: exp.date.split('T')[0], note: exp.note || '', reference: exp.reference || '',
      billable: exp.billable, recurring: exp.recurring, recurringCycle: exp.recurringCycle || 'MONTHLY',
      projectId: exp.projectId || ''
    })
    setShowForm(true)
  }

  function startEditCat(cat: ExpenseCategory) {
    setEditing(cat)
    setCatForm({ name: cat.name, description: cat.description || '' })
    setShowForm(true)
  }

  function openNew() { closeForm(); setShowForm(true) }

  if (loading && expenses.length === 0 && categories.length === 0) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><Wallet className="h-5 w-5 text-primary" /></div>
            Despesas
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Controle de despesas e custos operacionais.</p>
        </div>
        {can('expenses:manage') && (
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]">
            <Plus className="h-4 w-4" /> {tab === 'expenses' ? 'Nova Despesa' : 'Nova Categoria'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
        <button onClick={() => { setTab('expenses'); closeForm() }} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'expenses' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          <Wallet className="h-4 w-4" /> Despesas
        </button>
        <button onClick={() => { setTab('categories'); closeForm() }} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'categories' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          <Tag className="h-4 w-4" /> Categorias
        </button>
      </div>

      {/* Total Amount Card */}
      {tab === 'expenses' && (
        <div className="bg-card border border-border/60 rounded-xl p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Total de Despesas</p>
          <p className="text-2xl font-semibold text-foreground mt-1">R$ {totalAmount.toFixed(2)}</p>
        </div>
      )}

      {/* Expense Form */}
      {showForm && tab === 'expenses' && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editing ? 'Editar Despesa' : 'Nova Despesa'}</h2>
            <button onClick={closeForm} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleExpSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nome *</label>
                <input value={expForm.name} onChange={e => setExpForm({ ...expForm, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Categoria</label>
                <select value={expForm.categoryId} onChange={e => setExpForm({ ...expForm, categoryId: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                  <option value="">Sem categoria</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Projeto</label>
                <select value={expForm.projectId} onChange={e => setExpForm({ ...expForm, projectId: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                  <option value="">Nenhum</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Valor *</label>
                <input type="number" step="0.01" value={expForm.amount} onChange={e => setExpForm({ ...expForm, amount: Number(e.target.value) })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Imposto (%)</label>
                <input type="number" step="0.01" value={expForm.taxRate} onChange={e => setExpForm({ ...expForm, taxRate: Number(e.target.value) })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Data *</label>
                <input type="date" value={expForm.date} onChange={e => setExpForm({ ...expForm, date: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Referência</label>
                <input value={expForm.reference} onChange={e => setExpForm({ ...expForm, reference: e.target.value })} placeholder="NF, recibo..." className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Notas</label>
                <input value={expForm.note} onChange={e => setExpForm({ ...expForm, note: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2.5">
                <input type="checkbox" checked={expForm.billable} onChange={e => setExpForm({ ...expForm, billable: e.target.checked })} className="rounded border-border text-primary focus:ring-primary/30 h-4 w-4" />
                <label className="text-sm text-foreground">Faturável</label>
              </div>
              <div className="flex items-center gap-2.5">
                <input type="checkbox" checked={expForm.recurring} onChange={e => setExpForm({ ...expForm, recurring: e.target.checked })} className="rounded border-border text-primary focus:ring-primary/30 h-4 w-4" />
                <label className="text-sm text-foreground">Recorrente</label>
              </div>
              {expForm.recurring && (
                <select value={expForm.recurringCycle} onChange={e => setExpForm({ ...expForm, recurringCycle: e.target.value })} className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                  <option value="WEEKLY">Semanal</option>
                  <option value="MONTHLY">Mensal</option>
                  <option value="QUARTERLY">Trimestral</option>
                  <option value="ANNUAL">Anual</option>
                </select>
              )}
            </div>
            <div className="pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editing ? 'Salvar' : 'Criar Despesa'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Category Form */}
      {showForm && tab === 'categories' && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editing ? 'Editar Categoria' : 'Nova Categoria'}</h2>
            <button onClick={closeForm} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleCatSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Nome *</label>
              <input value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
              <input value={catForm.description} onChange={e => setCatForm({ ...catForm, description: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            </div>
            <div className="pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editing ? 'Salvar' : 'Criar Categoria'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Expenses Table */}
      {tab === 'expenses' && (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Nome</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Categoria</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Projeto</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Valor</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Faturável</th>
                {can('expenses:manage') && <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {expenses.map(exp => (
                <tr key={exp.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-foreground font-medium">{exp.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{exp.category?.name || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{exp.project?.name || '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">R$ {exp.amount.toFixed(2)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(exp.date).toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-3 text-center">
                    {exp.billable ? <span className="px-2 py-0.5 rounded-full text-xs bg-green-500/10 text-green-500">Sim</span> : <span className="text-xs text-muted-foreground">Não</span>}
                  </td>
                  {can('expenses:manage') && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => startEditExp(exp)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDeleteExp(exp.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {expenses.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 rounded-2xl bg-muted/50 mb-4"><Wallet className="h-10 w-10 text-muted-foreground/50" /></div>
              <h3 className="text-foreground font-medium mb-1">Nenhuma despesa</h3>
              <p className="text-muted-foreground text-sm">Registre despesas para controle financeiro.</p>
            </div>
          )}
        </div>
      )}

      {/* Categories Grid */}
      {tab === 'categories' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {categories.map(cat => (
            <div key={cat.id} className="group bg-card border border-border/50 rounded-xl p-4 hover:shadow-md hover:border-border transition-all duration-200">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center shrink-0"><Tag className="h-4 w-4 text-primary" /></div>
                  <div className="min-w-0">
                    <span className="text-foreground font-medium text-sm block truncate">{cat.name}</span>
                    {cat.description && <p className="text-muted-foreground text-xs mt-0.5 truncate">{cat.description}</p>}
                    <span className="text-muted-foreground/70 text-xs">{cat._count?.expenses || 0} desp.</span>
                  </div>
                </div>
                {can('expenses:manage') && (
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEditCat(cat)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => handleDeleteCat(cat.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {categories.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 rounded-2xl bg-muted/50 mb-4"><Tag className="h-10 w-10 text-muted-foreground/50" /></div>
              <h3 className="text-foreground font-medium mb-1">Nenhuma categoria</h3>
              <p className="text-muted-foreground text-sm">Crie categorias para organizar despesas.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
