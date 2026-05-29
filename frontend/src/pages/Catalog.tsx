import { useState, useEffect } from 'react'
import { Package, Plus, Trash2, Edit2, X, Search, Tag, Layers } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/hooks/usePermissions'
import { catalogService, categoryService, bundleService } from '@/services/commercial'
import type { CatalogItem, ItemCategory, ItemBundle } from '@/types'

type Tab = 'items' | 'categories' | 'bundles'

export function Catalog() {
  const toast = useToast()
  const { can } = usePermissions()
  const [tab, setTab] = useState<Tab>('items')
  const [items, setItems] = useState<CatalogItem[]>([])
  const [categories, setCategories] = useState<ItemCategory[]>([])
  const [bundles, setBundles] = useState<ItemBundle[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<any>(null)

  // Forms
  const emptyItemForm = { name: '', description: '', type: 'SERVICE' as 'PRODUCT' | 'SERVICE', sku: '', unit: 'un', price: 0, taxRate: 0, categoryId: '', active: true }
  const emptyCatForm = { name: '', description: '' }
  const emptyBundleForm = { name: '', description: '', discount: 0, items: [] as { itemId: string; quantity: number }[] }
  const [itemForm, setItemForm] = useState(emptyItemForm)
  const [catForm, setCatForm] = useState(emptyCatForm)
  const [bundleForm, setBundleForm] = useState(emptyBundleForm)

  useEffect(() => { load() }, [tab])

  async function load() {
    setLoading(true)
    try {
      if (tab === 'items') {
        const res = await catalogService.list({ search: search || undefined })
        setItems(res.items)
      } else if (tab === 'categories') {
        const cats = await categoryService.list()
        setCategories(cats)
      } else {
        const b = await bundleService.list()
        setBundles(b)
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => {
    if (tab === 'items') {
      const timer = setTimeout(() => load(), 300)
      return () => clearTimeout(timer)
    }
  }, [search])

  // ── Item CRUD ──
  async function handleItemSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const data = { ...itemForm, price: Number(itemForm.price), taxRate: Number(itemForm.taxRate) || 0, categoryId: itemForm.categoryId || undefined }
      if (editingItem) {
        await catalogService.update(editingItem.id, data)
      } else {
        await catalogService.create(data)
      }
      closeForm(); load()
    } catch (e) { console.error(e) }
  }

  async function handleDeleteItem(id: string) {
    if (!await toast.confirm({ title: 'Excluir item', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await catalogService.delete(id); load() } catch (e) { console.error(e) }
  }

  // ── Category CRUD ──
  async function handleCatSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (editingItem) { await categoryService.update(editingItem.id, catForm) }
      else { await categoryService.create(catForm) }
      closeForm(); load()
    } catch (e) { console.error(e) }
  }

  async function handleDeleteCat(id: string) {
    if (!await toast.confirm({ title: 'Excluir categoria', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await categoryService.delete(id); load() } catch (e) { console.error(e) }
  }

  // ── Bundle CRUD ──
  async function handleBundleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const data = { ...bundleForm, discount: Number(bundleForm.discount) }
      if (editingItem) { await bundleService.update(editingItem.id, data) }
      else { await bundleService.create(data) }
      closeForm(); load()
    } catch (e) { console.error(e) }
  }

  async function handleDeleteBundle(id: string) {
    if (!await toast.confirm({ title: 'Excluir pacote', message: 'Tem certeza?', danger: true, confirmText: 'Excluir' })) return
    try { await bundleService.delete(id); load() } catch (e) { console.error(e) }
  }

  function closeForm() { setShowForm(false); setEditingItem(null); setItemForm(emptyItemForm); setCatForm(emptyCatForm); setBundleForm(emptyBundleForm) }

  function startEditItem(item: CatalogItem) {
    setEditingItem(item)
    setItemForm({ name: item.name, description: item.description || '', type: item.type, sku: item.sku || '', unit: item.unit || 'un', price: Number(item.price ?? 0), taxRate: Number(item.taxRate ?? 0), categoryId: item.categoryId || '', active: item.active })
    setShowForm(true)
  }

  function startEditCat(cat: ItemCategory) {
    setEditingItem(cat)
    setCatForm({ name: cat.name, description: cat.description || '' })
    setShowForm(true)
  }

  function startEditBundle(b: ItemBundle) {
    setEditingItem(b)
    setBundleForm({ name: b.name, description: b.description || '', discount: b.discount, items: b.items?.map(i => ({ itemId: i.itemId, quantity: i.quantity })) || [] })
    setShowForm(true)
  }

  function openNew() { closeForm(); setShowForm(true) }

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'items', label: 'Itens', icon: Package },
    { key: 'categories', label: 'Categorias', icon: Tag },
    { key: 'bundles', label: 'Pacotes', icon: Layers },
  ]

  if (loading && items.length === 0 && categories.length === 0 && bundles.length === 0) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><Package className="h-5 w-5 text-primary" /></div>
            Catálogo
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Gerencie produtos, serviços, categorias e pacotes.</p>
        </div>
        {can('catalog:manage') && (
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm hover:shadow-md active:scale-[0.98]">
            <Plus className="h-4 w-4" /> {tab === 'items' ? 'Novo Item' : tab === 'categories' ? 'Nova Categoria' : 'Novo Pacote'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); closeForm() }}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === t.key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Search for items */}
      {tab === 'items' && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar itens..." className="w-full bg-background border border-border rounded-lg pl-10 pr-4 py-2.5 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
        </div>
      )}

      {/* ── FORMS ── */}
      {showForm && tab === 'items' && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editingItem ? 'Editar Item' : 'Novo Item'}</h2>
            <button onClick={closeForm} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleItemSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Nome *</label>
              <input value={itemForm.name} onChange={e => setItemForm({ ...itemForm, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Tipo</label>
              <select value={itemForm.type} onChange={e => setItemForm({ ...itemForm, type: e.target.value as any })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                <option value="SERVICE">Serviço</option>
                <option value="PRODUCT">Produto</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">SKU</label>
              <input value={itemForm.sku} onChange={e => setItemForm({ ...itemForm, sku: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Unidade</label>
              <input value={itemForm.unit} onChange={e => setItemForm({ ...itemForm, unit: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Preço *</label>
              <input type="number" step="0.01" min="0" value={itemForm.price} onChange={e => setItemForm({ ...itemForm, price: Number(e.target.value) })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Taxa Imposto (%)</label>
              <input type="number" step="0.01" value={itemForm.taxRate} onChange={e => setItemForm({ ...itemForm, taxRate: Number(e.target.value) })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Categoria</label>
              <select value={itemForm.categoryId} onChange={e => setItemForm({ ...itemForm, categoryId: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30">
                <option value="">Sem categoria</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
              <textarea value={itemForm.description} onChange={e => setItemForm({ ...itemForm, description: e.target.value })} rows={2} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40 resize-none" />
            </div>
            <div className="md:col-span-2 flex items-center gap-2.5">
              <input type="checkbox" checked={itemForm.active} onChange={e => setItemForm({ ...itemForm, active: e.target.checked })} className="rounded border-border text-primary focus:ring-primary/30 h-4 w-4" />
              <label className="text-sm text-foreground">Ativo</label>
            </div>
            <div className="md:col-span-2 pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editingItem ? 'Salvar' : 'Criar Item'}</button>
            </div>
          </form>
        </div>
      )}

      {showForm && tab === 'categories' && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editingItem ? 'Editar Categoria' : 'Nova Categoria'}</h2>
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
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editingItem ? 'Salvar' : 'Criar Categoria'}</button>
            </div>
          </form>
        </div>
      )}

      {showForm && tab === 'bundles' && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-foreground">{editingItem ? 'Editar Pacote' : 'Novo Pacote'}</h2>
            <button onClick={closeForm} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={handleBundleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Nome *</label>
              <input value={bundleForm.name} onChange={e => setBundleForm({ ...bundleForm, name: e.target.value })} required className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Descrição</label>
              <input value={bundleForm.description} onChange={e => setBundleForm({ ...bundleForm, description: e.target.value })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Desconto (%)</label>
              <input type="number" step="0.01" value={bundleForm.discount} onChange={e => setBundleForm({ ...bundleForm, discount: Number(e.target.value) })} className="w-full bg-background border border-border rounded-lg px-3.5 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary/40" />
            </div>
            <div className="pt-2">
              <button type="submit" className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-sm active:scale-[0.98]">{editingItem ? 'Salvar' : 'Criar Pacote'}</button>
            </div>
          </form>
        </div>
      )}

      {/* ── LIST ── */}
      {tab === 'items' && (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Nome</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Tipo</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">SKU</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Preço</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Status</th>
                {can('catalog:manage') && <th className="text-right px-4 py-3 font-medium text-muted-foreground">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <span className="text-foreground font-medium">{item.name}</span>
                      {item.category && <span className="text-muted-foreground text-xs ml-2">• {item.category.name}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.type === 'SERVICE' ? 'bg-blue-500/10 text-blue-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                      {item.type === 'SERVICE' ? 'Serviço' : 'Produto'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{item.sku || '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">R$ {Number(item.price ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.active ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                      {item.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  {can('catalog:manage') && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => startEditItem(item)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDeleteItem(item.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 rounded-2xl bg-muted/50 mb-4"><Package className="h-10 w-10 text-muted-foreground/50" /></div>
              <h3 className="text-foreground font-medium mb-1">Nenhum item no catálogo</h3>
              <p className="text-muted-foreground text-sm">Adicione produtos ou serviços ao seu catálogo.</p>
            </div>
          )}
        </div>
      )}

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
                    <span className="text-muted-foreground/70 text-xs">{cat._count?.items || 0} itens</span>
                  </div>
                </div>
                {can('catalog:manage') && (
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
              <p className="text-muted-foreground text-sm">Crie categorias para organizar seus itens.</p>
            </div>
          )}
        </div>
      )}

      {tab === 'bundles' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {bundles.map(b => (
            <div key={b.id} className="group bg-card border border-border/50 rounded-xl p-4 hover:shadow-md hover:border-border transition-all duration-200">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <span className="text-foreground font-medium text-sm block truncate">{b.name}</span>
                  {b.description && <p className="text-muted-foreground text-xs mt-0.5 truncate">{b.description}</p>}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-muted-foreground/70 text-xs">{b.items?.length || 0} itens</span>
                    {(b.discount ?? 0) > 0 && <span className="px-1.5 py-0.5 rounded text-xs bg-green-500/10 text-green-500">{b.discount}% desc.</span>}
                  </div>
                </div>
                {can('catalog:manage') && (
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEditBundle(b)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8"><Edit2 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => handleDeleteBundle(b.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {bundles.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 rounded-2xl bg-muted/50 mb-4"><Layers className="h-10 w-10 text-muted-foreground/50" /></div>
              <h3 className="text-foreground font-medium mb-1">Nenhum pacote</h3>
              <p className="text-muted-foreground text-sm">Crie pacotes combinando itens do catálogo.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
