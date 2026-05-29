import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CreditCard, Plus, Pencil, Trash2, Loader2, Infinity, Ban, Building2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import api from '@/services/api'

interface PlanLimit {
  id: string
  featureKey: string
  limitValue: number
}

interface Plan {
  id: string
  name: string
  slug: string
  description: string | null
  price: number
  isDefault: boolean
  isActive: boolean
  sortOrder: number
  limits: PlanLimit[]
  _count: { companies: number }
}

interface FeatureKeyInfo {
  key: string
  label: string
  description: string
}

const defaultLimits: Record<string, number> = {
  maxUsers: 5,
  maxInstances: 1,
  maxContacts: 500,
  maxCampaigns: 5,
  maxFlows: 3,
  maxTeams: 2,
  maxAiAgents: 0,
  maxAiProviders: 0,
  maxKnowledgeBases: 0,
  maxTemplates: 10,
  maxAutomations: 5,
  maxLabels: 10,
}

function LimitDisplay({ value }: { value: number }) {
  if (value === -1) return <span className="flex items-center gap-1 text-green-600"><Infinity className="h-3.5 w-3.5" /> Ilimitado</span>
  if (value === 0) return <span className="flex items-center gap-1 text-red-500"><Ban className="h-3.5 w-3.5" /> Bloqueado</span>
  return <span className="font-mono">{value}</span>
}

export function AdminPlans() {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [selected, setSelected] = useState<Plan | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '', slug: '', description: '', price: 0, isDefault: false, sortOrder: 0,
  })
  const [formLimits, setFormLimits] = useState<Record<string, number>>({ ...defaultLimits })

  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ['admin-plans'],
    queryFn: async () => (await api.get('/admin/plans')).data,
  })

  const { data: featureKeys = [] } = useQuery<FeatureKeyInfo[]>({
    queryKey: ['admin-feature-keys'],
    queryFn: async () => (await api.get('/admin/plans/feature-keys')).data,
  })

  const createMut = useMutation({
    mutationFn: (d: any) => api.post('/admin/plans', d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-plans'] })
      closeForm()
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/admin/plans/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-plans'] })
      closeForm()
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/plans/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-plans'] })
      setDeleteOpen(false)
    },
  })

  function openCreate() {
    setEditingPlan(null)
    setFormData({ name: '', slug: '', description: '', price: 0, isDefault: false, sortOrder: plans.length })
    setFormLimits({ ...defaultLimits })
    setFormOpen(true)
  }

  function openEdit(plan: Plan) {
    setEditingPlan(plan)
    setFormData({
      name: plan.name,
      slug: plan.slug,
      description: plan.description || '',
      price: plan.price,
      isDefault: plan.isDefault,
      sortOrder: plan.sortOrder,
    })
    const lims: Record<string, number> = {}
    for (const fk of Object.keys(defaultLimits)) {
      const found = plan.limits.find(l => l.featureKey === fk)
      lims[fk] = found ? found.limitValue : defaultLimits[fk]
    }
    setFormLimits(lims)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingPlan(null)
  }

  function handleSave() {
    const payload = { ...formData, limits: formLimits }
    if (editingPlan) {
      updateMut.mutate({ id: editingPlan.id, data: payload })
    } else {
      createMut.mutate(payload)
    }
  }

  function handleLimitChange(key: string, raw: string) {
    const v = parseInt(raw, 10)
    setFormLimits(prev => ({ ...prev, [key]: isNaN(v) ? 0 : v }))
  }

  function setLimitPreset(key: string, value: number) {
    setFormLimits(prev => ({ ...prev, [key]: value }))
  }

  const isSaving = createMut.isPending || updateMut.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-amber-500" />
            Planos
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {plans.length} planos configurados
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Novo Plano
        </Button>
      </div>

      {/* Plans Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map(plan => (
            <Card key={plan.id} className={!plan.isActive ? 'opacity-60' : ''}>
              <CardContent className="p-5 space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-lg">{plan.name}</h3>
                      {plan.isDefault && <Badge variant="outline" className="text-amber-600 border-amber-300">Padrão</Badge>}
                      {!plan.isActive && <Badge variant="secondary">Inativo</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{plan.slug}</p>
                    {plan.description && <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold">
                      {plan.price > 0 ? `R$ ${plan.price.toFixed(2)}` : 'Gratis'}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                      <Building2 className="h-3 w-3" />
                      {plan._count.companies} empresa{plan._count.companies !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                {/* Limits */}
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableBody>
                      {(featureKeys.length > 0 ? featureKeys : Object.keys(defaultLimits).map(k => ({ key: k, label: k, description: '' }))).map(fk => {
                        const feat = typeof fk === 'string' ? { key: fk, label: fk } : fk
                        const lim = plan.limits.find(l => l.featureKey === feat.key)
                        return (
                          <TableRow key={feat.key} className="text-xs">
                            <TableCell className="py-1.5 font-medium">{feat.label}</TableCell>
                            <TableCell className="py-1.5 text-right">
                              <LimitDisplay value={lim?.limitValue ?? 0} />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(plan)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    className="text-red-500 hover:text-red-600"
                    disabled={plan._count.companies > 0}
                    onClick={() => { setSelected(plan); setDeleteOpen(true) }}
                    title={plan._count.companies > 0 ? 'Não é possível excluir planos com empresas vinculadas' : 'Excluir plano'}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPlan ? 'Editar Plano' : 'Novo Plano'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            {/* Basic info */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder="Pro" />
              </div>
              <div className="space-y-2">
                <Label>Slug (identificador único)</Label>
                <Input
                  value={formData.slug}
                  onChange={e => setFormData(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))}
                  placeholder="pro"
                  disabled={!!editingPlan}
                />
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Input value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} placeholder="Plano para empresas médias" />
              </div>
              <div className="space-y-2">
                <Label>Preço (R$)</Label>
                <Input type="number" min={0} step={0.01} value={formData.price} onChange={e => setFormData(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-2">
                <Label>Ordem de exibição</Label>
                <Input type="number" min={0} value={formData.sortOrder} onChange={e => setFormData(p => ({ ...p, sortOrder: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch checked={formData.isDefault} onCheckedChange={v => setFormData(p => ({ ...p, isDefault: v }))} />
                <Label>Plano padrão para novas empresas</Label>
              </div>
            </div>

            {/* Limits */}
            <div>
              <h4 className="font-semibold mb-3">Limites por recurso</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Use <strong>-1</strong> para ilimitado, <strong>0</strong> para bloquear o recurso.
              </p>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recurso</TableHead>
                      <TableHead className="w-[140px]">Limite</TableHead>
                      <TableHead className="w-[120px] text-center">Atalhos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(featureKeys.length > 0 ? featureKeys : Object.keys(defaultLimits).map(k => ({ key: k, label: k, description: '' }))).map(fk => {
                      const feat = typeof fk === 'string' ? { key: fk, label: fk, description: '' } : fk
                      return (
                        <TableRow key={feat.key}>
                          <TableCell>
                            <div>
                              <span className="text-sm font-medium">{feat.label}</span>
                              {feat.description && <p className="text-xs text-muted-foreground">{feat.description}</p>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={-1}
                              className="h-8 text-sm"
                              value={formLimits[feat.key] ?? 0}
                              onChange={e => handleLimitChange(feat.key, e.target.value)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1 justify-center">
                              <Button
                                type="button" variant="ghost" size="sm"
                                className="h-7 px-2 text-xs text-green-600"
                                onClick={() => setLimitPreset(feat.key, -1)}
                                title="Ilimitado"
                              >
                                <Infinity className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button" variant="ghost" size="sm"
                                className="h-7 px-2 text-xs text-red-500"
                                onClick={() => setLimitPreset(feat.key, 0)}
                                title="Bloquear"
                              >
                                <Ban className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!formData.name || !formData.slug || isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingPlan ? 'Salvar' : 'Criar Plano'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir plano?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso excluirá permanentemente o plano <strong>{selected?.name}</strong> e todos os seus limites.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => selected && deleteMut.mutate(selected.id)}
            >
              {deleteMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
