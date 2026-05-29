import { useState, useEffect, useMemo } from 'react'
import {
  Plug,
  Plus,
  Trash2,
  Edit2,
  TestTube2,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  X,
  Mic,
  CalendarDays,
  Eye,
  EyeOff,
  Search,
  ShieldCheck,
  Sparkles,
  Activity,
  AlertTriangle,
  BookOpen,
  ArrowRight,
  Zap,
  KeyRound,
  Info,
  Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/Toast'
import {
  integrationsService,
  type CompanyIntegration,
  type CompanyIntegrationType,
  type IntegrationCatalogEntry,
  type CredentialField,
} from '@/services/integrations.service'

type CategoryMeta = {
  label: string
  icon: any
  gradient: string
  tint: string
  text: string
  border: string
  glow: string
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  voice: {
    label: 'Voz',
    icon: Mic,
    gradient: 'from-violet-500 to-indigo-500',
    tint: 'bg-violet-500/10',
    text: 'text-violet-600 dark:text-violet-400',
    border: 'border-violet-500/30',
    glow: 'shadow-violet-500/20',
  },
  calendar: {
    label: 'Calendário',
    icon: CalendarDays,
    gradient: 'from-blue-500 to-cyan-500',
    tint: 'bg-blue-500/10',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-500/30',
    glow: 'shadow-blue-500/20',
  },
  other: {
    label: 'Outras',
    icon: Plug,
    gradient: 'from-emerald-500 to-teal-500',
    tint: 'bg-emerald-500/10',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-500/30',
    glow: 'shadow-emerald-500/20',
  },
}

function getCategoryMeta(category?: string): CategoryMeta {
  return CATEGORY_META[category || 'other'] || CATEGORY_META.other
}

// ─────────────────────────────────────────────────────────────────
// Logos oficiais dos provedores (com fallback para emoji do catálogo)
// ─────────────────────────────────────────────────────────────────
const PROVIDER_LOGOS: Record<string, string> = {
  FISHAUDIO: 'https://fish.audio/favicon.ico',
  CALCOM: 'https://cdn.simpleicons.org/caldotcom/0099ff',
  ELEVENLABS: 'https://cdn.simpleicons.org/elevenlabs/000000',
  AZURE_SPEECH: 'https://cdn.simpleicons.org/microsoftazure/0078D4',
  OPENAI: 'https://cdn.simpleicons.org/openai/10A37F',
  GOOGLE_CALENDAR: 'https://cdn.simpleicons.org/googlecalendar/4285F4',
  OUTLOOK_CALENDAR: 'https://cdn.simpleicons.org/microsoftoutlook/0078D4',
}

function ProviderLogo({
  type,
  fallback,
  size = 28,
  className = '',
}: {
  type: string
  fallback?: string
  size?: number
  className?: string
}) {
  const src = PROVIDER_LOGOS[type]
  const [err, setErr] = useState(false)
  if (!src || err) {
    return (
      <span className={`leading-none text-2xl ${className}`} aria-hidden>
        {fallback || '🔌'}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={`object-contain ${className}`}
      onError={() => setErr(true)}
    />
  )
}

// ─────────────────────────────────────────────────────────────────
// Provedores "Em breve" — exibidos apenas no catálogo do front
// ─────────────────────────────────────────────────────────────────
type ComingSoonEntry = {
  type: string
  name: string
  description: string
  category: 'voice' | 'calendar' | 'other'
  capabilities: string[]
  docsUrl: string
  icon: string
}

const COMING_SOON: ComingSoonEntry[] = [
  {
    type: 'ELEVENLABS',
    name: 'ElevenLabs',
    description: 'Vozes ultra-realistas com clonagem e emoção avançada (TTS).',
    category: 'voice',
    capabilities: ['tts', 'voice_models_crud'],
    docsUrl: 'https://elevenlabs.io/docs',
    icon: '🎙️',
  },
  {
    type: 'AZURE_SPEECH',
    name: 'Azure Speech',
    description: 'TTS e STT corporativo da Microsoft com SLA empresarial.',
    category: 'voice',
    capabilities: ['tts', 'stt'],
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/speech-service/',
    icon: '🗣️',
  },
  {
    type: 'GOOGLE_CALENDAR',
    name: 'Google Calendar',
    description: 'Agendamento direto na agenda Google do agente, com OAuth.',
    category: 'calendar',
    capabilities: ['create_booking', 'list_bookings', 'cancel_booking'],
    docsUrl: 'https://developers.google.com/calendar',
    icon: '📅',
  },
  {
    type: 'OUTLOOK_CALENDAR',
    name: 'Outlook Calendar',
    description: 'Integração com calendários Microsoft 365 / Exchange.',
    category: 'calendar',
    capabilities: ['create_booking', 'list_bookings', 'cancel_booking'],
    docsUrl: 'https://learn.microsoft.com/graph/api/resources/calendar',
    icon: '🗓️',
  },
]

export default function IntegrationsPage() {
  const toast = useToast()
  const [catalog, setCatalog] = useState<IntegrationCatalogEntry[]>([])
  const [items, setItems] = useState<CompanyIntegration[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<CompanyIntegration | null>(null)
  const [creatingType, setCreatingType] = useState<IntegrationCatalogEntry | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  async function refresh() {
    setLoading(true)
    try {
      const [cat, list] = await Promise.all([integrationsService.catalog(), integrationsService.list()])
      setCatalog(cat)
      setItems(list)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao carregar integrações')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleTest(it: CompanyIntegration) {
    try {
      const r = await integrationsService.test(it.id)
      ;(r.ok ? toast.success : toast.error)(r.message)
      refresh()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Falha ao testar')
    }
  }

  async function handleDelete(it: CompanyIntegration) {
    if (!confirm(`Remover integração "${it.name}"? Esta ação é irreversível.`)) return
    try {
      await integrationsService.delete(it.id)
      toast.success('Integração removida')
      refresh()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao remover')
    }
  }

  // Esconde OPENAI do catálogo se já existe AIProvider OpenAI vinculado virtualmente
  const hasVirtualOpenAI = items.some((i) => i.id.startsWith('aiprovider:') && i.type === 'OPENAI')

  const visibleCatalog = useMemo(() => {
    const real = catalog.filter((c) => !(c.type === 'OPENAI' && hasVirtualOpenAI))
    const realTypes = new Set(real.map((c) => c.type))
    // Adiciona "Em breve" apenas se ainda não existirem no catálogo real
    const soon = COMING_SOON.filter((s) => !realTypes.has(s.type as CompanyIntegrationType)).map(
      (s) =>
        ({
          type: s.type as CompanyIntegrationType,
          name: s.name,
          description: s.description,
          category: s.category,
          icon: s.icon,
          docsUrl: s.docsUrl,
          capabilities: s.capabilities as any,
          credentialFields: [],
          // flag não-tipada usada apenas no render
          comingSoon: true,
        } as unknown as IntegrationCatalogEntry)
    )
    return [...real, ...soon]
  }, [catalog, hasVirtualOpenAI])

  const categoryOptions = useMemo(
    () => Array.from(new Set(visibleCatalog.map((c) => c.category))),
    [visibleCatalog]
  )

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase()
    return visibleCatalog
      .filter((c) => categoryFilter === 'all' || c.category === categoryFilter)
      .filter((c) => {
        if (!q) return true
        return (
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.type.toLowerCase().includes(q)
        )
      })
  }, [visibleCatalog, categoryFilter, search])

  const byCategory = useMemo(
    () =>
      filteredCatalog.reduce<Record<string, IntegrationCatalogEntry[]>>((acc, c) => {
        acc[c.category] = acc[c.category] || []
        acc[c.category].push(c)
        return acc
      }, {}),
    [filteredCatalog]
  )

  const stats = useMemo(
    () => ({
      total: items.length,
      active: items.filter((i) => i.status === 'ACTIVE').length,
      errors: items.filter((i) => i.status === 'ERROR').length,
    }),
    [items]
  )

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/20">
      <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
        {/* HERO */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-700 via-blue-600 to-cyan-500 text-white shadow-xl shadow-indigo-500/20">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_60%)]" />
          <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-white/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-cyan-300/20 blur-3xl pointer-events-none" />
          <div className="relative p-6 lg:p-8">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div className="flex items-start gap-4">
                <div className="h-14 w-14 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/25 flex items-center justify-center shadow-lg shadow-black/10">
                  <Plug className="h-7 w-7 text-white" />
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-[0.22em] font-bold text-white/85">
                    Hub de integrações
                  </span>
                  <h1 className="text-2xl lg:text-3xl font-bold leading-tight mt-1">
                    Conecte. Automatize. Escale.
                  </h1>
                  <p className="text-sm lg:text-[15px] text-white/85 mt-1.5 max-w-2xl">
                    Plug-and-play em segundos: conecte serviços de voz, agenda e muito mais para deixar seus agentes IA
                    ainda mais poderosos.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className="inline-flex items-center gap-1.5 text-xs bg-white/15 backdrop-blur-sm border border-white/25 px-2.5 py-1 rounded-full font-medium">
                      <ShieldCheck className="h-3.5 w-3.5" /> AES-256-GCM · LGPD
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs bg-white/15 backdrop-blur-sm border border-white/25 px-2.5 py-1 rounded-full font-medium">
                      <Sparkles className="h-3.5 w-3.5" /> {visibleCatalog.length} provedores prontos
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs bg-white/15 backdrop-blur-sm border border-white/25 px-2.5 py-1 rounded-full font-medium">
                      <Zap className="h-3.5 w-3.5" /> Setup em &lt; 60s
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 lg:gap-4 lg:min-w-[420px]">
                <StatTile label="Conectadas" value={stats.total} icon={Plug} />
                <StatTile label="Ativas" value={stats.active} icon={CheckCircle2} accent="text-emerald-200" />
                <StatTile
                  label="Erros"
                  value={stats.errors}
                  icon={AlertTriangle}
                  accent={stats.errors > 0 ? 'text-amber-200' : 'text-white/70'}
                />
              </div>
            </div>
          </div>
        </div>

        {/* CONNECTED */}
        <section>
          <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Activity className="h-5 w-5 text-emerald-500" /> Suas integrações
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Gerencie conexões já configuradas — teste, edite ou remova.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="border rounded-2xl p-5 bg-card animate-pulse h-44" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="border border-dashed rounded-2xl p-10 text-center bg-card/50">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-purple-500/10 text-purple-500 flex items-center justify-center mb-3">
                <Plug className="h-7 w-7" />
              </div>
              <div className="text-base font-semibold">Nenhuma integração conectada ainda</div>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Escolha um provedor abaixo para liberar novas habilidades para os seus agentes IA.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {items.map((it) => {
                const cat = catalog.find((c) => c.type === it.type)
                const meta = getCategoryMeta(cat?.category)
                const isVirtual = it.id.startsWith('aiprovider:')
                const successRate =
                  it.totalRequests > 0
                    ? Math.round(((it.totalRequests - it.failedRequests) / it.totalRequests) * 100)
                    : null

                return (
                  <div
                    key={it.id}
                    className={`group relative border rounded-2xl p-5 bg-card transition-all hover:shadow-lg hover:-translate-y-0.5 ${
                      isVirtual
                        ? 'border-emerald-500/40 bg-gradient-to-br from-emerald-500/5 via-card to-card'
                        : 'hover:border-purple-500/40'
                    }`}
                  >
                    <div
                      className={`absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r ${meta.gradient} opacity-70`}
                    />

                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className={`shrink-0 h-12 w-12 rounded-xl bg-background ${meta.text} flex items-center justify-center border ${meta.border}`}
                        >
                          <ProviderLogo type={it.type} fallback={cat?.icon} size={28} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold flex items-center gap-1.5 truncate">
                            <span className="truncate">{it.name}</span>
                            {isVirtual && (
                              <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
                                Auto
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{cat?.name || it.type}</div>
                        </div>
                      </div>
                      <StatusBadge status={it.status} />
                    </div>

                    {it.description && (
                      <p className="text-sm text-muted-foreground mt-3 line-clamp-2">{it.description}</p>
                    )}

                    {!isVirtual && it.totalRequests > 0 && successRate !== null && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                          <span>Taxa de sucesso</span>
                          <span className="font-medium text-foreground">
                            {successRate}% · {it.totalRequests.toLocaleString('pt-BR')} reqs
                          </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${
                              successRate >= 95
                                ? 'from-emerald-500 to-emerald-400'
                                : successRate >= 80
                                ? 'from-amber-500 to-amber-400'
                                : 'from-red-500 to-red-400'
                            }`}
                            style={{ width: `${successRate}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {(it.lastTestedAt || it.lastError) && (
                      <div className="text-xs text-muted-foreground mt-3 space-y-1">
                        {it.lastTestedAt && (
                          <div className="flex items-center gap-1">
                            <TestTube2 className="h-3 w-3" />
                            Testada {new Date(it.lastTestedAt).toLocaleString('pt-BR')}
                          </div>
                        )}
                        {it.lastError && (
                          <div className="flex items-start gap-1 text-red-500 line-clamp-2">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>{it.lastError}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2 mt-4 pt-4 border-t">
                      <Button size="sm" variant="outline" onClick={() => handleTest(it)} className="flex-1">
                        <TestTube2 className="h-3.5 w-3.5 mr-1" /> Testar
                      </Button>
                      {!isVirtual && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setEditing(it)} className="flex-1">
                            <Edit2 className="h-3.5 w-3.5 mr-1" /> Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-500 hover:text-red-600 hover:border-red-500/50"
                            onClick={() => handleDelete(it)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* CATALOG */}
        <section>
          <div className="flex flex-col gap-4 mb-5">
            <div className="flex items-end justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-purple-500" /> Catálogo de provedores
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Conecte um novo provedor — leva menos de 60 segundos.
                </p>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar provedor..."
                  className="pl-9"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <CategoryPill
                active={categoryFilter === 'all'}
                onClick={() => setCategoryFilter('all')}
                label="Todos"
                count={visibleCatalog.length}
              />
              {categoryOptions.map((cat) => {
                const meta = getCategoryMeta(cat)
                const Icon = meta.icon
                const count = visibleCatalog.filter((c) => c.category === cat).length
                return (
                  <CategoryPill
                    key={cat}
                    active={categoryFilter === cat}
                    onClick={() => setCategoryFilter(cat)}
                    label={meta.label}
                    count={count}
                    icon={<Icon className={`h-3.5 w-3.5 ${meta.text}`} />}
                  />
                )
              })}
            </div>
          </div>

          {Object.keys(byCategory).length === 0 ? (
            <div className="border border-dashed rounded-2xl p-10 text-center text-muted-foreground">
              Nenhum provedor encontrado para a sua busca.
            </div>
          ) : (
            Object.entries(byCategory).map(([cat, entries]) => {
              const meta = getCategoryMeta(cat)
              const Icon = meta.icon
              return (
                <div key={cat} className="mb-8">
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className={`h-9 w-9 rounded-xl ${meta.tint} ${meta.text} border ${meta.border} flex items-center justify-center`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className={`text-sm font-semibold ${meta.text}`}>{meta.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {entries.length} provedor{entries.length === 1 ? '' : 'es'} disponíve{entries.length === 1 ? 'l' : 'is'}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {entries.map((c) => {
                      const isComing = (c as any).comingSoon === true
                      return (
                      <div
                        key={c.type}
                        className={`group relative border rounded-2xl p-5 bg-card transition-all overflow-hidden ${
                          isComing
                            ? 'opacity-90'
                            : 'hover:shadow-xl hover:-translate-y-0.5 hover:border-transparent'
                        }`}
                      >
                        <div
                          className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${meta.gradient} ${
                            isComing ? 'opacity-40' : 'opacity-0 group-hover:opacity-100'
                          } transition-opacity`}
                        />
                        {!isComing && (
                          <div
                            className={`pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-gradient-to-br ${meta.gradient} opacity-0 group-hover:opacity-10 blur-2xl transition-opacity`}
                          />
                        )}

                        <div className="flex items-start gap-3">
                          <div
                            className={`shrink-0 h-12 w-12 rounded-xl bg-background ${meta.text} flex items-center justify-center border ${meta.border}`}
                          >
                            <ProviderLogo type={c.type} fallback={c.icon} size={28} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold flex items-center gap-2">
                              <span className="truncate">{c.name}</span>
                              {isComing && (
                                <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 inline-flex items-center gap-1">
                                  <Clock className="h-2.5 w-2.5" /> Em breve
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.description}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1 mt-3 min-h-[24px]">
                          {c.capabilities.slice(0, 6).map((cap) => (
                            <span
                              key={cap}
                              className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                            >
                              {cap}
                            </span>
                          ))}
                        </div>

                        <div className="flex gap-2 mt-4">
                          {isComing ? (
                            <Button
                              size="sm"
                              disabled
                              variant="outline"
                              className="flex-1 cursor-not-allowed"
                            >
                              <Clock className="h-3.5 w-3.5 mr-1" /> Em breve
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => setCreatingType(c)}
                              className={`flex-1 bg-gradient-to-r ${meta.gradient} text-white border-0 hover:opacity-90 shadow-sm group/btn`}
                            >
                              <Plus className="h-3.5 w-3.5 mr-1" /> Conectar
                              <ArrowRight className="h-3.5 w-3.5 ml-1 opacity-0 group-hover/btn:opacity-100 group-hover/btn:translate-x-0.5 transition" />
                            </Button>
                          )}
                          <a
                            href={c.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center text-xs text-muted-foreground hover:text-foreground border rounded-md px-2.5 hover:bg-muted transition"
                            title="Documentação"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </section>

        {/* Modais */}
        {creatingType && (
          <IntegrationModal
            catalog={creatingType}
            onClose={() => setCreatingType(null)}
            onSaved={() => {
              setCreatingType(null)
              refresh()
            }}
          />
        )}
        {editing && (
          <IntegrationModal
            catalog={catalog.find((c) => c.type === editing.type)!}
            existing={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              refresh()
            }}
          />
        )}
      </div>
    </div>
  )
}

function StatTile({
  label,
  value,
  icon: Icon,
  accent = 'text-white',
}: {
  label: string
  value: number
  icon: any
  accent?: string
}) {
  return (
    <div className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 px-3 py-3 text-center">
      <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-white/70 font-semibold">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={`text-2xl font-bold mt-0.5 ${accent}`}>{value}</div>
    </div>
  )
}

function CategoryPill({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition ${
        active
          ? 'bg-foreground text-background border-foreground shadow-sm'
          : 'bg-card text-foreground/80 hover:bg-muted border-border'
      }`}
    >
      {icon}
      {label}
      <span
        className={`text-[10px] font-semibold px-1.5 rounded-full ${
          active ? 'bg-background/20 text-background' : 'bg-muted text-muted-foreground'
        }`}
      >
        {count}
      </span>
    </button>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string; dot: string; icon: any }> = {
    ACTIVE: {
      label: 'Ativa',
      cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
      dot: 'bg-emerald-500',
      icon: CheckCircle2,
    },
    INACTIVE: {
      label: 'Inativa',
      cls: 'bg-gray-500/10 text-gray-500 border-gray-500/30',
      dot: 'bg-gray-400',
      icon: XCircle,
    },
    ERROR: {
      label: 'Erro',
      cls: 'bg-red-500/10 text-red-500 border-red-500/30',
      dot: 'bg-red-500',
      icon: XCircle,
    },
  }
  const c = cfg[status] || cfg.INACTIVE
  return (
    <span
      className={`text-[11px] font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 border ${c.cls}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {status === 'ACTIVE' && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c.dot} opacity-75`} />
        )}
        <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${c.dot}`} />
      </span>
      {c.label}
    </span>
  )
}

function IntegrationModal({
  catalog,
  existing,
  onClose,
  onSaved,
}: {
  catalog: IntegrationCatalogEntry
  existing?: CompanyIntegration
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState(existing?.name || catalog.name)
  const [description, setDescription] = useState(existing?.description || '')
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const meta = getCategoryMeta(catalog.category)

  async function save() {
    setSaving(true)
    try {
      // Em edição, só envia credenciais se foram preenchidas
      const credPayload: Record<string, string> = {}
      for (const f of catalog.credentialFields) {
        if (credentials[f.key] !== undefined && credentials[f.key] !== '') {
          credPayload[f.key] = credentials[f.key]
        }
      }
      if (existing) {
        await integrationsService.update(existing.id, {
          name,
          description: description || undefined,
          ...(Object.keys(credPayload).length ? { credentials: credPayload } : {}),
        })
        toast.success('Integração atualizada')
      } else {
        // Validação dos obrigatórios na criação
        for (const f of catalog.credentialFields) {
          if (f.required && !credPayload[f.key]) {
            toast.error(`Campo obrigatório: ${f.label}`)
            setSaving(false)
            return
          }
        }
        await integrationsService.create({
          type: catalog.type,
          name,
          description: description || undefined,
          credentials: credPayload,
        })
        toast.success('Integração criada')
      }
      onSaved()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header com gradiente da categoria */}
        <div
          className={`relative overflow-hidden bg-gradient-to-br ${meta.gradient} text-white px-6 py-5`}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.25),transparent_60%)]" />
          <div className="absolute -bottom-12 -right-8 h-40 w-40 rounded-full bg-white/15 blur-2xl pointer-events-none" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-12 w-12 rounded-xl bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center shadow-lg shadow-black/10 shrink-0">
                <ProviderLogo type={catalog.type} fallback={catalog.icon} size={28} className="brightness-0 invert" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/85">
                  {existing ? 'Editar conexão' : 'Nova conexão'}
                </div>
                <div className="font-semibold text-lg leading-tight truncate">{catalog.name}</div>
                <p className="text-xs text-white/85 mt-0.5 line-clamp-2">{catalog.description}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white hover:bg-white/15 rounded-lg p-1.5 transition shrink-0"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">Nome de exibição</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={catalog.name} />
            <p className="text-[11px] text-muted-foreground">Como esta integração aparecerá na lista.</p>
          </div>

          <div className="grid gap-1.5">
            <label className="text-sm font-medium">
              Descrição <span className="text-muted-foreground font-normal">(opcional)</span>
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Conta principal da clínica"
            />
          </div>

          <div className="border-t pt-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-purple-500" /> Credenciais
              </div>
              <a
                href={catalog.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Como obter <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 mb-3 flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <div className="text-[11px] text-muted-foreground leading-relaxed">
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">Criptografia AES-256-GCM.</span>{' '}
                Suas credenciais são armazenadas cifradas e nunca expostas em logs.
              </div>
            </div>

            {existing && (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 mb-3 flex items-start gap-2">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="text-[11px] text-muted-foreground">
                  Deixe os campos em branco para manter as credenciais atuais.
                </div>
              </div>
            )}

            <div className="space-y-3">
              {catalog.credentialFields.map((f) => (
                <CredentialInput
                  key={f.key}
                  field={f}
                  value={credentials[f.key] || ''}
                  show={!!showSecrets[f.key]}
                  onToggleShow={() => setShowSecrets((s) => ({ ...s, [f.key]: !s[f.key] }))}
                  onChange={(v) => setCredentials((c) => ({ ...c, [f.key]: v }))}
                  placeholderMasked={existing?.credentialsMasked?.[f.key]}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t bg-muted/30">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className={`bg-gradient-to-r ${meta.gradient} text-white border-0 hover:opacity-90`}
          >
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {existing ? 'Salvar alterações' : 'Criar integração'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function CredentialInput({
  field,
  value,
  show,
  onToggleShow,
  onChange,
  placeholderMasked,
}: {
  field: CredentialField
  value: string
  show: boolean
  onToggleShow: () => void
  onChange: (v: string) => void
  placeholderMasked?: string
}) {
  const isSecret = field.type === 'password'
  return (
    <div>
      <label className="text-sm font-medium flex items-center gap-1">
        {field.label}
        {field.required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        <Input
          type={isSecret && !show ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholderMasked || field.placeholder || ''}
          className={isSecret ? 'pr-9' : ''}
        />
        {isSecret && (
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
      {field.helpText && <p className="text-xs text-muted-foreground mt-1">{field.helpText}</p>}
    </div>
  )
}
