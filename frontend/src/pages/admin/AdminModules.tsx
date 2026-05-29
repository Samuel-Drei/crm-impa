import { useState, useEffect } from 'react'
import { Package, Check, X, Settings2, ChevronDown, ChevronRight } from 'lucide-react'
import {
  getAdminModules, activateModule, deactivateModule
} from '@/services/module.service'
import { useToast } from '@/components/ui/Toast'
import { useAuthStore } from '@/stores/auth.store'
import type { ModuleRegistryItem } from '@/types'

const CATEGORY_LABELS: Record<string, string> = {
  crm: 'CRM',
  legal: 'Jurídico',
  health: 'Saúde',
  realestate: 'Imobiliário',
  education: 'Educação',
  finance: 'Financeiro',
  ecommerce: 'E-commerce',
}

export function AdminModules() {
  const toast = useToast()
  const { company } = useAuthStore()
  const [modules, setModules] = useState<(ModuleRegistryItem & { isActive?: boolean })[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null)

  useEffect(() => { loadModules() }, [])

  async function loadModules() {
    setLoading(true)
    try {
      const data = await getAdminModules(company?.id)
      setModules(data)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  async function handleToggle(slug: string, currentActive: boolean) {
    if (!company?.id) return
    try {
      if (currentActive) {
        await deactivateModule(slug, company.id)
        toast.success('Módulo desativado')
      } else {
        await activateModule(slug, company.id)
        toast.success('Módulo ativado')
      }
      loadModules()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao alterar módulo')
    }
  }

  // Group by category
  const grouped = modules.reduce<Record<string, typeof modules>>((acc, m) => {
    const cat = m.category || 'crm'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(m)
    return acc
  }, {})

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <Package className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold text-foreground">Módulos do CRM</h1>
          <p className="text-sm text-muted-foreground">
            Ative ou desative módulos para personalizar o CRM para seu nicho de mercado.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {Object.entries(grouped).map(([category, catModules]) => (
          <div key={category}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {CATEGORY_LABELS[category] || category}
            </h2>
            <div className="space-y-2">
              {catModules.map(mod => {
                const isExpanded = expandedSlug === mod.slug
                return (
                  <div key={mod.slug} className="bg-card border border-border rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div
                        className="flex items-center gap-3 flex-1 cursor-pointer"
                        onClick={() => setExpandedSlug(isExpanded ? null : mod.slug)}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <span className="text-lg">{mod.icon}</span>
                        <div>
                          <h3 className="font-medium text-foreground text-sm">{mod.name}</h3>
                          <p className="text-xs text-muted-foreground">{mod.description}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleToggle(mod.slug, !!mod.isActive)}
                        className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                          mod.isActive
                            ? 'bg-green-500/10 text-green-600 border border-green-500/30 hover:bg-red-500/10 hover:text-red-600 hover:border-red-500/30'
                            : 'bg-muted text-muted-foreground border border-border hover:bg-primary/10 hover:text-primary hover:border-primary/30'
                        }`}
                      >
                        {mod.isActive ? (
                          <><Check className="h-3.5 w-3.5" /> Ativo</>
                        ) : (
                          <><X className="h-3.5 w-3.5" /> Inativo</>
                        )}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-border px-4 py-3 bg-muted/20 space-y-2">
                        <div className="grid grid-cols-3 gap-4 text-xs">
                          <div>
                            <span className="text-muted-foreground">Categoria</span>
                            <p className="font-medium text-foreground">{CATEGORY_LABELS[mod.category || ''] || mod.category}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Slug</span>
                            <p className="font-medium text-foreground font-mono">{mod.slug}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Status</span>
                            <p className={`font-medium ${mod.isActive ? 'text-green-600' : 'text-muted-foreground'}`}>
                              {mod.isActive ? 'Ativado' : 'Desativado'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {modules.length === 0 && (
        <div className="text-center py-12">
          <Package className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-muted-foreground">Nenhum módulo disponível.</p>
        </div>
      )}
    </div>
  )
}
