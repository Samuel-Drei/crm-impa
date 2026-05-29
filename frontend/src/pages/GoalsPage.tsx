import { useState, useEffect } from 'react'
import { Target, Plus, ChevronRight, ChevronDown, TrendingUp, CheckCircle2, Clock, AlertCircle, XCircle, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/Toast'
import {
  getGoals, getGoalById, createGoal, updateGoal, addGoalCheckin, getGoalSummary,
  type Goal, type GoalStatus, type GoalType, type GoalMetricType
} from '@/services/goal.service'

const STATUS_CONFIG: Record<GoalStatus, { label: string; color: string; icon: any }> = {
  NAO_INICIADO: { label: 'Não Iniciado', color: 'text-gray-400', icon: Clock },
  EM_PROGRESSO: { label: 'Em Progresso', color: 'text-blue-500', icon: TrendingUp },
  CONCLUIDO: { label: 'Concluído', color: 'text-green-500', icon: CheckCircle2 },
  CANCELADO: { label: 'Cancelado', color: 'text-red-500', icon: XCircle },
  ATRASADO: { label: 'Atrasado', color: 'text-orange-500', icon: AlertCircle },
}

const TYPE_CONFIG: Record<GoalType, { label: string; color: string; short: string }> = {
  OBJETIVO: { label: 'Objetivo', color: 'bg-indigo-500', short: 'O' },
  RESULTADO_CHAVE: { label: 'Resultado-Chave', color: 'bg-cyan-500', short: 'KR' },
  INICIATIVA: { label: 'Iniciativa', color: 'bg-emerald-500', short: 'I' },
}

const METRIC_OPTIONS: { value: GoalMetricType; label: string }[] = [
  { value: 'PERCENTUAL', label: 'Percentual (%)' },
  { value: 'NUMERICO', label: 'Numérico' },
  { value: 'MONETARIO', label: 'Monetário (R$)' },
  { value: 'BINARIO', label: 'Binário (sim/não)' },
]

function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  const color = value >= 100 ? 'bg-green-500' : value >= 70 ? 'bg-blue-500' : value >= 30 ? 'bg-amber-500' : 'bg-red-400'
  return (
    <div className={`h-2 bg-accent rounded-full overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  )
}

function formatValue(value: number, metricType: GoalMetricType) {
  if (metricType === 'PERCENTUAL') return `${Math.round(value)}%`
  if (metricType === 'MONETARIO') return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  if (metricType === 'BINARIO') return value > 0 ? 'Sim' : 'Não'
  return value.toLocaleString('pt-BR')
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [summary, setSummary] = useState<{ byStatus: Record<string, number>; byType: Record<string, number> } | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set())
  const [checkinValue, setCheckinValue] = useState('')
  const [checkinNote, setCheckinNote] = useState('')

  // Create form
  const [form, setForm] = useState({
    title: '', description: '', type: 'OBJETIVO' as GoalType,
    metricType: 'PERCENTUAL' as GoalMetricType, targetValue: 100, parentId: '',
  })
  const toast = useToast()

  const loadGoals = async () => {
    setLoading(true)
    try {
      const [data, sum] = await Promise.all([
        getGoals({ topLevel: 'true' }),
        getGoalSummary(),
      ])
      setGoals(data.goals)
      setSummary(sum)
    } catch { toast.error('Erro ao carregar objetivos') }
    setLoading(false)
  }

  useEffect(() => { loadGoals() }, [])

  const handleCreate = async () => {
    if (!form.title.trim()) return toast.error('Título é obrigatório')
    try {
      await createGoal({
        title: form.title, description: form.description,
        type: form.type, metricType: form.metricType,
        targetValue: form.targetValue,
        parentId: form.parentId || undefined,
      } as any)
      toast.success('Objetivo criado')
      setShowCreate(false)
      setForm({ title: '', description: '', type: 'OBJETIVO', metricType: 'PERCENTUAL', targetValue: 100, parentId: '' })
      loadGoals()
    } catch { toast.error('Erro ao criar objetivo') }
  }

  const handleCheckin = async () => {
    if (!selectedGoal || !checkinValue) return
    try {
      await addGoalCheckin(selectedGoal.id, parseFloat(checkinValue), checkinNote || undefined)
      toast.success('Check-in registrado')
      setCheckinValue('')
      setCheckinNote('')
      const updated = await getGoalById(selectedGoal.id)
      setSelectedGoal(updated)
      loadGoals()
    } catch { toast.error('Erro no check-in') }
  }

  const openGoal = async (g: Goal) => {
    const full = await getGoalById(g.id)
    setSelectedGoal(full)
  }

  const toggleExpand = (id: string) => {
    setExpandedGoals(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const addChild = (parentId: string, type: GoalType) => {
    setForm(f => ({ ...f, parentId, type }))
    setShowCreate(true)
  }

  const renderGoal = (goal: Goal, level = 0) => {
    const typeCfg = TYPE_CONFIG[goal.type]
    const statusCfg = STATUS_CONFIG[goal.status]
    const StatusIcon = statusCfg.icon
    const hasChildren = goal.children && goal.children.length > 0
    const isExpanded = expandedGoals.has(goal.id)

    return (
      <div key={goal.id}>
        <button onClick={() => openGoal(goal)}
          className={`w-full text-left px-4 py-3 border-b hover:bg-accent/50 transition-colors ${selectedGoal?.id === goal.id ? 'bg-accent' : ''}`}
          style={{ paddingLeft: `${16 + level * 24}px` }}>
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button onClick={e => { e.stopPropagation(); toggleExpand(goal.id) }} className="p-0.5">
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            ) : <div className="w-5" />}
            <span className={`${typeCfg.color} text-white text-[10px] font-bold px-1.5 py-0.5 rounded`}>{typeCfg.short}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{goal.title}</p>
              <div className="flex items-center gap-3 mt-0.5">
                <ProgressBar value={goal.progress} className="w-24" />
                <span className="text-xs text-muted-foreground">{Math.round(goal.progress)}%</span>
                <StatusIcon className={`h-3 w-3 ${statusCfg.color}`} />
                <span className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" />{goal.owner?.name}</span>
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p>{formatValue(Number(goal.currentValue), goal.metricType)} / {formatValue(Number(goal.targetValue), goal.metricType)}</p>
              {goal._count.children > 0 && <p className="text-[10px]">{goal._count.children} sub-itens</p>}
            </div>
          </div>
        </button>
        {hasChildren && isExpanded && goal.children!.map(child => renderGoal(child, level + 1))}
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* List */}
      <div className={`${selectedGoal ? 'w-1/2 border-r' : 'w-full'} flex flex-col`}>
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-bold">Objetivos & OKRs</h1>
            </div>
            <Button size="sm" onClick={() => { setForm(f => ({ ...f, parentId: '' })); setShowCreate(true) }}>
              <Plus className="h-4 w-4 mr-1" /> Novo Objetivo
            </Button>
          </div>
          {/* Summary cards */}
          {summary && (
            <div className="flex gap-2 flex-wrap">
              {Object.entries(TYPE_CONFIG).map(([type, cfg]) => (
                <div key={type} className="text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5">
                  <span className={`${cfg.color} text-white text-[10px] font-bold px-1 py-0.5 rounded`}>{cfg.short}</span>
                  <span>{cfg.label}</span>
                  <span className="font-mono font-bold">{summary.byType[type] || 0}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="p-4 border-b bg-accent/30 space-y-3">
            <h3 className="font-medium text-sm">{form.parentId ? `Novo ${TYPE_CONFIG[form.type]?.label || 'item'}` : 'Novo Objetivo'}</h3>
            <Input placeholder="Título *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <Textarea placeholder="Descrição (opcional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="min-h-[60px]" />
            <div className="flex gap-2">
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as GoalType }))} className="h-9 px-3 border rounded-md text-sm bg-background flex-1">
                {Object.entries(TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select value={form.metricType} onChange={e => setForm(f => ({ ...f, metricType: e.target.value as GoalMetricType }))} className="h-9 px-3 border rounded-md text-sm bg-background flex-1">
                {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Input type="number" placeholder="Meta" value={form.targetValue} onChange={e => setForm(f => ({ ...f, targetValue: parseFloat(e.target.value) || 0 }))} className="w-24 h-9" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleCreate}>Criar</Button>
            </div>
          </div>
        )}

        {/* Goal List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground"><Target className="h-5 w-5 animate-pulse" /></div>
          ) : goals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Target className="h-10 w-10 mb-2 opacity-50" />
              <p className="text-sm">Nenhum objetivo cadastrado</p>
            </div>
          ) : goals.map(g => renderGoal(g))}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedGoal && (
        <div className="w-1/2 flex flex-col">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`${TYPE_CONFIG[selectedGoal.type].color} text-white text-xs font-bold px-2 py-0.5 rounded`}>{TYPE_CONFIG[selectedGoal.type].short}</span>
                <h2 className="text-base font-bold">{selectedGoal.title}</h2>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedGoal(null)}>✕</Button>
            </div>
            {selectedGoal.description && <p className="text-sm text-muted-foreground mb-3">{selectedGoal.description}</p>}

            {/* Progress */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-muted-foreground">Progresso</span>
                <span className="font-bold">{Math.round(selectedGoal.progress)}%</span>
              </div>
              <ProgressBar value={selectedGoal.progress} className="h-3" />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>{formatValue(Number(selectedGoal.startValue), selectedGoal.metricType)}</span>
                <span className="font-medium text-foreground">{formatValue(Number(selectedGoal.currentValue), selectedGoal.metricType)}</span>
                <span>{formatValue(Number(selectedGoal.targetValue), selectedGoal.metricType)}</span>
              </div>
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-2 text-xs mb-4">
              <div><span className="text-muted-foreground">Status:</span> <span className={STATUS_CONFIG[selectedGoal.status].color}>{STATUS_CONFIG[selectedGoal.status].label}</span></div>
              <div><span className="text-muted-foreground">Dono:</span> {selectedGoal.owner?.name}</div>
              <div><span className="text-muted-foreground">Tipo:</span> {TYPE_CONFIG[selectedGoal.type].label}</div>
              <div><span className="text-muted-foreground">Métrica:</span> {METRIC_OPTIONS.find(m => m.value === selectedGoal.metricType)?.label}</div>
              {selectedGoal.startDate && <div><span className="text-muted-foreground">Início:</span> {new Date(selectedGoal.startDate).toLocaleDateString('pt-BR')}</div>}
              {selectedGoal.endDate && <div><span className="text-muted-foreground">Fim:</span> {new Date(selectedGoal.endDate).toLocaleDateString('pt-BR')}</div>}
              {selectedGoal.parent && <div className="col-span-2"><span className="text-muted-foreground">Pai:</span> {selectedGoal.parent.title}</div>}
            </div>

            {/* Add child buttons */}
            <div className="flex gap-2 mb-3">
              {selectedGoal.type === 'OBJETIVO' && (
                <Button variant="outline" size="sm" onClick={() => addChild(selectedGoal.id, 'RESULTADO_CHAVE')}>
                  <Plus className="h-3 w-3 mr-1" /> KR
                </Button>
              )}
              {(selectedGoal.type === 'OBJETIVO' || selectedGoal.type === 'RESULTADO_CHAVE') && (
                <Button variant="outline" size="sm" onClick={() => addChild(selectedGoal.id, 'INICIATIVA')}>
                  <Plus className="h-3 w-3 mr-1" /> Iniciativa
                </Button>
              )}
            </div>

            {/* Children */}
            {selectedGoal.children && selectedGoal.children.length > 0 && (
              <div className="border rounded-lg overflow-hidden mb-4">
                <div className="bg-accent/50 px-3 py-1.5 text-xs font-medium">Sub-itens ({selectedGoal.children.length})</div>
                {selectedGoal.children.map(child => (
                  <button key={child.id} onClick={() => openGoal(child)} className="w-full text-left px-3 py-2 border-t hover:bg-accent/30 flex items-center gap-2">
                    <span className={`${TYPE_CONFIG[child.type].color} text-white text-[10px] font-bold px-1 py-0.5 rounded`}>{TYPE_CONFIG[child.type].short}</span>
                    <span className="text-sm truncate flex-1">{child.title}</span>
                    <ProgressBar value={child.progress} className="w-16" />
                    <span className="text-xs text-muted-foreground">{Math.round(child.progress)}%</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Check-in */}
          <div className="p-4 border-b">
            <h4 className="text-sm font-medium mb-2 flex items-center gap-1"><TrendingUp className="h-4 w-4" /> Novo Check-in</h4>
            <div className="flex gap-2">
              <Input type="number" placeholder="Valor atual" value={checkinValue} onChange={e => setCheckinValue(e.target.value)} className="w-28" />
              <Input placeholder="Nota (opcional)" value={checkinNote} onChange={e => setCheckinNote(e.target.value)} className="flex-1" />
              <Button size="sm" onClick={handleCheckin} disabled={!checkinValue}>Registrar</Button>
            </div>
          </div>

          {/* Checkin History */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">Histórico de Check-ins</h4>
            {selectedGoal.checkins && selectedGoal.checkins.length > 0 ? (
              selectedGoal.checkins.map(c => (
                <div key={c.id} className="rounded-lg p-2.5 bg-accent/50 text-sm flex items-center justify-between">
                  <div>
                    <span className="font-mono font-medium">{formatValue(Number(c.value), selectedGoal.metricType)}</span>
                    {c.note && <span className="text-muted-foreground ml-2">— {c.note}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString('pt-BR')}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum check-in registrado</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
