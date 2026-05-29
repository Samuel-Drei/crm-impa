import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/Toast'
import {
  aiBrainService, BrainFact, BrainGraphPayload, BrainProfile, AIBrainFactCategory,
} from '@/services/aiBrain.service'
import { BrainGraph } from '@/components/ai-brain/BrainGraph'
import { ArrowLeft, Brain, Network, RefreshCw, Sparkles, Trash2, Plus } from 'lucide-react'

const FACT_CATEGORIES: AIBrainFactCategory[] = [
  'DEMOGRAPHIC', 'PREFERENCE', 'OBJECTION', 'INTENT',
  'PAIN_POINT', 'COMMITMENT', 'EVENT', 'CUSTOM',
]

export function AIBrainProfile() {
  const navigate = useNavigate()
  const params = useParams<{ subjectType: string; subjectId: string }>()
  const [search] = useSearchParams()
  const toast = useToast()

  const subjectType = params.subjectType || search.get('subjectType') || 'contact'
  const subjectId = params.subjectId || search.get('subjectId') || ''

  const [profile, setProfile] = useState<BrainProfile | null>(null)
  const [graph, setGraph] = useState<BrainGraphPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('summary')
  const [searchTerm, setSearchTerm] = useState('')

  // formulário de novo fato
  const [newFact, setNewFact] = useState({
    category: 'CUSTOM' as AIBrainFactCategory,
    subject: '',
    predicate: 'é',
    value: '',
  })

  async function load() {
    if (!subjectId) return
    setLoading(true)
    try {
      const [p, g] = await Promise.all([
        aiBrainService.getProfile(subjectType, subjectId),
        aiBrainService.getGraph(subjectType, subjectId, 2),
      ])
      setProfile(p)
      setGraph(g)
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao carregar Cérebro IA')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [subjectType, subjectId])

  async function handleSync() {
    try {
      if (subjectType === 'contact') await aiBrainService.syncContact(subjectId)
      else if (subjectType === 'customerAccount') await aiBrainService.syncCustomerAccount(subjectId)
      toast.success('Sincronizado com o CRM')
      load()
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao sincronizar')
    }
  }

  async function handleAddFact() {
    if (!newFact.subject || !newFact.value) {
      toast.warning('Preencha sujeito e valor')
      return
    }
    try {
      await aiBrainService.createFact({
        ...newFact,
        contactId: subjectType === 'contact' ? subjectId : undefined,
        customerAccountId: subjectType === 'customerAccount' ? subjectId : undefined,
      })
      setNewFact({ category: 'CUSTOM', subject: '', predicate: 'é', value: '' })
      load()
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao criar fato')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover este fato?')) return
    await aiBrainService.deleteFact(id)
    load()
  }

  const filteredFacts = useMemo(() => {
    const list = profile?.facts || []
    if (!searchTerm.trim()) return list
    const q = searchTerm.toLowerCase()
    return list.filter(f =>
      f.subject.toLowerCase().includes(q) ||
      f.value.toLowerCase().includes(q) ||
      f.predicate.toLowerCase().includes(q),
    )
  }, [profile, searchTerm])

  if (!subjectId) {
    return (
      <div className="p-6">
        <Card><CardContent className="p-6">Sujeito inválido. Use <code>/ai-brain/:subjectType/:subjectId</code>.</CardContent></Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
          </Button>
          <div className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-amber-400" />
            <div>
              <h1 className="text-xl font-semibold">Cérebro IA</h1>
              <p className="text-xs text-muted-foreground">
                {profile?.node?.label || subjectId}
                {' · '}
                <span className="capitalize">{subjectType}</span>
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{profile?.facts.length ?? 0} fatos</Badge>
          <Badge variant="secondary">{profile?.connectionsCount ?? 0} conexões</Badge>
          <Badge className="bg-amber-500 text-black">{profile?.learnedToday.length ?? 0} hoje</Badge>
          <Button size="sm" variant="outline" onClick={handleSync}>
            <RefreshCw className="w-4 h-4 mr-1" /> Sincronizar
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="summary">Resumo</TabsTrigger>
          <TabsTrigger value="map"><Network className="w-3 h-3 mr-1" /> Mapa</TabsTrigger>
          <TabsTrigger value="facts">Fatos</TabsTrigger>
          <TabsTrigger value="today"><Sparkles className="w-3 h-3 mr-1" /> Aprendeu hoje</TabsTrigger>
        </TabsList>

        {/* Resumo */}
        <TabsContent value="summary">
          <Card>
            <CardHeader><CardTitle>Resumo 360°</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
              {!loading && !profile?.node && (
                <div className="text-sm text-muted-foreground">
                  Ainda não há node neste contato no Cérebro. Clique em <b>Sincronizar</b> para criar a partir do CRM,
                  ou inicie uma conversa com um agente IA — ao fechar a sessão os fatos serão extraídos automaticamente.
                </div>
              )}
              {profile?.node?.summary && (
                <p className="text-sm whitespace-pre-wrap">{profile.node.summary}</p>
              )}
              {profile?.node?.metadata && (
                <pre className="bg-muted/30 p-3 rounded text-xs overflow-auto">{JSON.stringify(profile.node.metadata, null, 2)}</pre>
              )}
              <TopFacts facts={profile?.facts || []} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mapa */}
        <TabsContent value="map">
          <Card>
            <CardHeader>
              <CardTitle>Mapa de conexões</CardTitle>
              <p className="text-xs text-muted-foreground">
                Force-directed (estilo Obsidian). Clique = focar 1-hop · Duplo-clique = abrir node · Roda = zoom · Arrastar = pan
              </p>
            </CardHeader>
            <CardContent>
              {graph && graph.nodes.length > 0 ? (
                <BrainGraph
                  data={graph}
                  height={560}
                  onNodeDoubleClick={(_id, raw) => {
                    if (raw?.subjectType && raw?.subjectId) {
                      navigate(`/ai-brain/${raw.subjectType}/${raw.subjectId}`)
                    }
                  }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Sem dados ainda — sincronize ou converse com um agente IA.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Fatos */}
        <TabsContent value="facts" className="space-y-3">
          <Card>
            <CardHeader><CardTitle>Adicionar fato manual</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <Select
                value={newFact.category}
                onValueChange={v => setNewFact({ ...newFact, category: v as AIBrainFactCategory })}
              >
                <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent>
                  {FACT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                placeholder="Sujeito (ex: João)"
                value={newFact.subject}
                onChange={e => setNewFact({ ...newFact, subject: e.target.value })}
              />
              <Input
                placeholder="Verbo (ex: prefere)"
                value={newFact.predicate}
                onChange={e => setNewFact({ ...newFact, predicate: e.target.value })}
              />
              <Input
                placeholder="Valor"
                value={newFact.value}
                onChange={e => setNewFact({ ...newFact, value: e.target.value })}
              />
              <Button onClick={handleAddFact}><Plus className="w-4 h-4 mr-1" />Adicionar</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Fatos conhecidos</CardTitle>
              <Input
                placeholder="Buscar…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-64"
              />
            </CardHeader>
            <CardContent>
              <FactList facts={filteredFacts} onDelete={handleDelete} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Aprendeu hoje */}
        <TabsContent value="today">
          <Card>
            <CardHeader><CardTitle>Aprendido nas últimas 24h</CardTitle></CardHeader>
            <CardContent>
              <FactList facts={profile?.learnedToday || []} onDelete={handleDelete} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function TopFacts({ facts }: { facts: BrainFact[] }) {
  const top = facts.slice(0, 5)
  if (top.length === 0) return null
  return (
    <div>
      <h3 className="text-sm font-medium mb-2">Top fatos</h3>
      <ul className="space-y-1 text-sm">
        {top.map(f => (
          <li key={f.id} className="flex items-start gap-2">
            <Badge variant="outline" className="shrink-0">{f.category}</Badge>
            <span><b>{f.subject}</b> {f.predicate} <span className="text-amber-400">{f.value}</span></span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FactList({ facts, onDelete }: { facts: BrainFact[]; onDelete: (id: string) => void }) {
  if (facts.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum fato registrado ainda.</p>
  }
  return (
    <ul className="space-y-2">
      {facts.map(f => (
        <li key={f.id} className="flex items-start justify-between gap-3 border-b pb-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{f.category}</Badge>
              <Badge variant="secondary" className="text-[10px]">{f.sourceType}</Badge>
              <span className="text-xs text-muted-foreground">conf {(f.confidence * 100).toFixed(0)}%</span>
            </div>
            <div className="text-sm mt-1">
              <b>{f.subject}</b> <span className="text-muted-foreground">{f.predicate}</span> <span className="text-amber-400">{f.value}</span>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onDelete(f.id)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </li>
      ))}
    </ul>
  )
}
