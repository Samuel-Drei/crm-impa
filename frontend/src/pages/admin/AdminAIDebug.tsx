import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/services/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Bug, Copy, Loader2, Search } from 'lucide-react'

interface AdminAgentLite {
  id: string
  name: string
  status: string
  companyId: string
  model?: string | null
  company?: { name: string } | null
  provider?: { name: string; type: string } | null
}

interface DebugMessage {
  role: string
  content: string
}

interface DebugResponse {
  agent: { id: string; name: string }
  provider: { id: string; name: string; model: string }
  params: {
    maxTokens: number
    temperature: number
    topP: number | null
    frequencyPenalty: number | null
    presencePenalty: number | null
  }
  tools: Array<{ name: string; description: string }>
  rag: { chunks: number; tokens: number; appended: string }
  systemPrompt: string
  history: DebugMessage[]
  sampleMessage: string
  finalMessages: DebugMessage[]
  stats: {
    systemPromptChars: number
    historyMessages: number
    totalChars: number
    estimatedTokens: number
  }
}

export function AdminAIDebug() {
  const [agentId, setAgentId] = useState('')
  const [sampleMessage, setSampleMessage] = useState('Olá')
  const [remoteJid, setRemoteJid] = useState('')
  const [includeRag, setIncludeRag] = useState(true)
  const [agentSearch, setAgentSearch] = useState('')
  const [result, setResult] = useState<DebugResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: agents } = useQuery<AdminAgentLite[]>({
    queryKey: ['admin', 'ai-agents'],
    queryFn: async () => (await api.get('/admin/ai/agents')).data,
  })

  const filteredAgents = (agents || []).filter(a => {
    if (!agentSearch) return true
    const q = agentSearch.toLowerCase()
    return (
      a.name.toLowerCase().includes(q) ||
      a.company?.name?.toLowerCase().includes(q) ||
      a.provider?.name?.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q)
    )
  })

  async function runDebug() {
    if (!agentId) {
      setError('Selecione um agente')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.post('/admin/ai/debug-prompt', {
        agentId,
        sampleMessage,
        remoteJid: remoteJid.trim() || undefined,
        includeRag,
      })
      setResult(res.data as DebugResponse)
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Erro ao montar prompt')
    } finally {
      setLoading(false)
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {})
  }

  const selectedAgent = (agents || []).find(a => a.id === agentId)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Bug className="h-5 w-5 text-amber-500" />
        <h1 className="text-2xl font-semibold">Debug do Prompt da IA</h1>
      </div>
      <p className="text-sm text-muted-foreground -mt-3">
        Monta o prompt FINAL que seria enviado ao provider (system + histórico + RAG + mensagem) sem chamar o LLM.
        Útil para descobrir por que a IA responde de um jeito específico.
      </p>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configuração</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Agente</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filtrar agentes por nome / empresa / provider..."
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                className="pl-9 mb-2"
              />
            </div>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">— selecione um agente —</option>
              {filteredAgents.map(a => (
                <option key={a.id} value={a.id}>
                  [{a.company?.name || '?'}] {a.name} · {a.provider?.name || '?'} · {a.status}
                </option>
              ))}
            </select>
            {selectedAgent && (
              <p className="text-[11px] text-muted-foreground">
                ID: <code className="font-mono">{selectedAgent.id}</code> · Modelo: {selectedAgent.model || 'padrão do provider'}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Mensagem de teste</label>
              <Textarea
                value={sampleMessage}
                onChange={(e) => setSampleMessage(e.target.value)}
                className="font-mono text-xs min-h-[80px]"
                placeholder="O que o cliente diria..."
              />
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Remote JID (opcional)</label>
                <Input
                  placeholder="ex: 5511999999999@s.whatsapp.net"
                  value={remoteJid}
                  onChange={(e) => setRemoteJid(e.target.value)}
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Se preenchido, carrega o histórico real desta conversa.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeRag}
                  onChange={(e) => setIncludeRag(e.target.checked)}
                />
                Incluir RAG retrieval
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button onClick={runDebug} disabled={loading || !agentId}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Bug className="h-4 w-4 mr-2" />}
              Montar prompt
            </Button>
          </div>

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <>
          {/* Resumo */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Resumo</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Metric label="Provider" value={`${result.provider.name}`} />
                <Metric label="Modelo" value={result.provider.model} />
                <Metric label="System chars" value={result.stats.systemPromptChars.toLocaleString()} />
                <Metric label="Total chars" value={result.stats.totalChars.toLocaleString()} />
                <Metric label="Tokens estimados" value={`~${result.stats.estimatedTokens.toLocaleString()}`} />
                <Metric label="Mensagens histórico" value={String(result.stats.historyMessages)} />
                <Metric label="RAG chunks" value={`${result.rag.chunks} (${result.rag.tokens}t)`} />
                <Metric label="Tools" value={String(result.tools.length)} />
              </div>

              <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <Metric label="Temperature" value={String(result.params.temperature)} />
                <Metric label="Max tokens" value={String(result.params.maxTokens)} />
                <Metric label="Top P" value={result.params.topP === null ? '—' : String(result.params.topP)} />
                <Metric label="Freq penalty" value={result.params.frequencyPenalty === null ? '—' : String(result.params.frequencyPenalty)} />
                <Metric label="Presence penalty" value={result.params.presencePenalty === null ? '—' : String(result.params.presencePenalty)} />
              </div>
            </CardContent>
          </Card>

          {/* System prompt */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">System Prompt FINAL</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{result.systemPrompt.length} chars</Badge>
                <Button size="sm" variant="outline" onClick={() => copy(result.systemPrompt)}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/40 p-3 rounded-md max-h-[480px] overflow-auto border">{result.systemPrompt}</pre>
            </CardContent>
          </Card>

          {/* Tools */}
          {result.tools.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Tools / Function calling ({result.tools.length})</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2 text-xs">
                  {result.tools.map(t => (
                    <li key={t.name} className="border rounded-md p-2">
                      <code className="font-mono font-medium">{t.name}</code>
                      <p className="text-muted-foreground mt-0.5">{t.description}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Histórico */}
          {result.history.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Histórico ({result.history.length})</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {result.history.map((m, i) => (
                  <div key={i} className="border rounded-md p-2">
                    <Badge variant="outline" className="text-[10px] mb-1">{m.role}</Badge>
                    <pre className="text-[11px] font-mono whitespace-pre-wrap">{m.content}</pre>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Messages array final */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Array completo (messages) enviado ao provider</CardTitle>
              <Button size="sm" variant="outline" onClick={() => copy(JSON.stringify(result.finalMessages, null, 2))}>
                <Copy className="h-3.5 w-3.5 mr-1" /> Copiar JSON
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/40 p-3 rounded-md max-h-[480px] overflow-auto border">
{JSON.stringify(result.finalMessages, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2 bg-muted/30">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-sm font-medium font-mono mt-0.5 break-all">{value}</div>
    </div>
  )
}
