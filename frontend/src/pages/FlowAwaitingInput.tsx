import { useState, useEffect } from 'react'
import { Inbox, RefreshCw, X, Check, ThumbsUp, ThumbsDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/Toast'
import api from '@/services/api'

interface PendingSession {
  sessionId: string
  flowId: string
  flowName: string
  remoteJid: string
  instanceId: string
  nodeId: string
  nodeType: 'HUMAN_INPUT' | 'APPROVAL'
  message: string
  formSchema: any
  createdAt: string
  expiresAt: string | null
}

export function FlowAwaitingInput() {
  const toast = useToast()
  const [items, setItems] = useState<PendingSession[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PendingSession | null>(null)
  const [formValues, setFormValues] = useState<Record<string, any>>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await api.get<PendingSession[]>('/flows/sessions/awaiting-input')
      setItems(r.data)
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
    setLoading(false)
  }

  function open(item: PendingSession) {
    setSelected(item)
    const initial: Record<string, any> = {}
    const fields = item.formSchema?.fields || []
    fields.forEach((f: any) => { if (f.default !== undefined) initial[f.name] = f.default })
    setFormValues(initial)
  }

  async function handleSubmit(approved?: boolean) {
    if (!selected) return
    setSubmitting(true)
    try {
      const body: any = {}
      if (selected.nodeType === 'APPROVAL') {
        body.approved = approved
      } else {
        // HUMAN_INPUT: se houver formSchema, envia objeto; senão valor único
        const fields = selected.formSchema?.fields || []
        if (fields.length > 0) body.value = formValues
        else body.value = formValues._single
      }
      await api.post(`/flows/sessions/${selected.sessionId}/human-input`, body)
      toast.success('Resposta enviada')
      setSelected(null)
      load()
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro') }
    setSubmitting(false)
  }

  function renderField(f: any) {
    const v = formValues[f.name] ?? ''
    const setV = (val: any) => setFormValues(p => ({ ...p, [f.name]: val }))
    if (f.type === 'textarea') return <Textarea value={v} onChange={e => setV(e.target.value)} rows={3} />
    if (f.type === 'number') return <Input type="number" value={v} onChange={e => setV(Number(e.target.value))} />
    if (f.type === 'boolean') return <input type="checkbox" checked={!!v} onChange={e => setV(e.target.checked)} className="h-4 w-4" />
    if (f.type === 'enum' && Array.isArray(f.options)) {
      return (
        <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={v} onChange={e => setV(e.target.value)}>
          <option value="">—</option>
          {f.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    return <Input value={v} onChange={e => setV(e.target.value)} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="h-6 w-6 text-purple-500" /> Aguardando Resposta Humana
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Sessões de fluxo pausadas em nós de aprovação ou input humano.</p>
        </div>
        <Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" /> Recarregar</Button>
      </div>

      {loading ? (
        <div className="text-center py-10 text-muted-foreground">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground border rounded-xl">
          <Inbox className="h-10 w-10 mx-auto mb-2 opacity-30" />
          Nenhuma sessão aguardando resposta no momento.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.sessionId} className="border rounded-xl p-4 hover:border-purple-400 transition cursor-pointer" onClick={() => open(item)}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${item.nodeType === 'APPROVAL' ? 'bg-amber-500/10 text-amber-600' : 'bg-purple-500/10 text-purple-500'}`}>
                      {item.nodeType === 'APPROVAL' ? 'APROVAÇÃO' : 'INPUT HUMANO'}
                    </span>
                    <span className="text-sm font-medium">{item.flowName}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{item.remoteJid?.split('@')[0]}</span>
                    {item.expiresAt && <>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-orange-500">expira {new Date(item.expiresAt).toLocaleString('pt-BR')}</span>
                    </>}
                  </div>
                  <div className="text-sm">{item.message}</div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">{new Date(item.createdAt).toLocaleString('pt-BR')}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !submitting && setSelected(null)}>
          <div className="bg-background border rounded-xl shadow-xl max-w-2xl w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selected.nodeType === 'APPROVAL' ? 'Aprovação requerida' : 'Resposta requerida'}</h2>
                <div className="text-xs text-muted-foreground mt-1">{selected.flowName} · {selected.remoteJid?.split('@')[0]}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)} disabled={submitting}><X className="h-4 w-4" /></Button>
            </div>
            <div className="border-l-4 border-purple-500 bg-purple-500/5 p-3 rounded">
              <p className="text-sm whitespace-pre-wrap">{selected.message}</p>
            </div>

            {selected.nodeType === 'APPROVAL' ? (
              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button variant="outline" onClick={() => handleSubmit(false)} disabled={submitting} className="text-red-500"><ThumbsDown className="h-4 w-4 mr-1" /> Rejeitar</Button>
                <Button onClick={() => handleSubmit(true)} disabled={submitting} className="bg-green-600 hover:bg-green-700"><ThumbsUp className="h-4 w-4 mr-1" /> Aprovar</Button>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {(selected.formSchema?.fields || []).length === 0 ? (
                    <label className="block">
                      <div className="text-sm font-medium mb-1">Resposta</div>
                      <Textarea rows={3} value={formValues._single || ''} onChange={e => setFormValues({ _single: e.target.value })} />
                    </label>
                  ) : (
                    (selected.formSchema?.fields || []).map((f: any) => (
                      <label key={f.name} className="block">
                        <div className="text-sm font-medium mb-1">{f.label || f.name}{f.required && ' *'}</div>
                        {renderField(f)}
                        {f.description && <div className="text-xs text-muted-foreground mt-1">{f.description}</div>}
                      </label>
                    ))
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-3 border-t">
                  <Button variant="outline" onClick={() => setSelected(null)} disabled={submitting}>Cancelar</Button>
                  <Button onClick={() => handleSubmit()} disabled={submitting}><Check className="h-4 w-4 mr-1" /> Enviar</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
