import { useState, useEffect, useMemo } from 'react'
import { X, Loader2, Save, BookPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/Toast'
import {
  getAIKnowledgeBases,
  getAIKnowledgeBase,
  createAIKnowledgeSource,
  addAIKnowledgeQAPair,
  type AIKnowledgeBase,
  type AIKnowledgeSource,
} from '@/services/ai.service'

interface Props {
  initialQuestion: string
  initialAnswer: string
  onClose: () => void
  onCreated?: () => void
}

export default function CreateFAQFromMessageModal({ initialQuestion, initialAnswer, onClose, onCreated }: Props) {
  const toast = useToast()
  const [question, setQuestion] = useState(initialQuestion)
  const [answer, setAnswer] = useState(initialAnswer)
  const [kbs, setKbs] = useState<AIKnowledgeBase[]>([])
  const [selectedKbId, setSelectedKbId] = useState('')
  const [sources, setSources] = useState<AIKnowledgeSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string>('__new__')
  const [newSourceName, setNewSourceName] = useState('FAQ — Gerado das conversas')
  const [loadingKbs, setLoadingKbs] = useState(true)
  const [loadingSources, setLoadingSources] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setLoadingKbs(true)
    getAIKnowledgeBases()
      .then(list => {
        setKbs(list)
        if (list.length > 0) setSelectedKbId(list[0].id)
      })
      .catch((e: any) => toast.error(e.response?.data?.error || 'Erro ao carregar bases de conhecimento'))
      .finally(() => setLoadingKbs(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedKbId) { setSources([]); return }
    setLoadingSources(true)
    getAIKnowledgeBase(selectedKbId)
      .then(kb => {
        const qaSources = (kb.sources || []).filter(s => s.type === 'QA')
        setSources(qaSources)
        setSelectedSourceId(qaSources.length > 0 ? qaSources[0].id : '__new__')
      })
      .catch(() => setSources([]))
      .finally(() => setLoadingSources(false))
  }, [selectedKbId])

  const canSubmit = useMemo(() => {
    if (!question.trim() || !answer.trim() || !selectedKbId) return false
    if (selectedSourceId === '__new__' && !newSourceName.trim()) return false
    return true
  }, [question, answer, selectedKbId, selectedSourceId, newSourceName])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      let sourceId = selectedSourceId
      if (sourceId === '__new__') {
        const created = await createAIKnowledgeSource({
          knowledgeBaseId: selectedKbId,
          type: 'QA',
          name: newSourceName.trim(),
          qaItems: [{ question: question.trim(), answer: answer.trim(), active: true, order: 0 }],
        })
        sourceId = created.source.id
      } else {
        await addAIKnowledgeQAPair(sourceId, {
          question: question.trim(),
          answer: answer.trim(),
          active: true,
        })
      }
      toast.success('FAQ adicionada — reindexando base de conhecimento')
      onCreated?.()
      onClose()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao criar FAQ')
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <BookPlus className="h-5 w-5 text-pink-500" />
            <h2 className="text-lg font-bold">Criar FAQ a partir desta mensagem</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Pergunta *</label>
            <Textarea value={question} onChange={e => setQuestion(e.target.value)} rows={2} required placeholder="Pergunta do cliente..." />
            <p className="text-[11px] text-muted-foreground mt-1">Sugestão preenchida com a última mensagem do cliente.</p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Resposta *</label>
            <Textarea value={answer} onChange={e => setAnswer(e.target.value)} rows={5} required placeholder="Resposta..." />
            <p className="text-[11px] text-muted-foreground mt-1">Sugestão preenchida com a resposta da IA.</p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Base de Conhecimento *</label>
            {loadingKbs ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Carregando...</div>
            ) : kbs.length === 0 ? (
              <p className="text-xs text-amber-500">Nenhuma base de conhecimento. Crie uma em Bases de Conhecimento.</p>
            ) : (
              <select
                className="w-full bg-background border rounded-md px-3 py-2 text-sm"
                value={selectedKbId}
                onChange={e => setSelectedKbId(e.target.value)}
                required
              >
                {kbs.map(kb => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Fonte Q&A *</label>
            {loadingSources ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Carregando fontes...</div>
            ) : (
              <select
                className="w-full bg-background border rounded-md px-3 py-2 text-sm"
                value={selectedSourceId}
                onChange={e => setSelectedSourceId(e.target.value)}
              >
                {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="__new__">+ Criar nova fonte Q&A</option>
              </select>
            )}
            {selectedSourceId === '__new__' && (
              <Input
                className="mt-2"
                value={newSourceName}
                onChange={e => setNewSourceName(e.target.value)}
                placeholder="Nome da nova fonte Q&A"
                required
              />
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Criar FAQ
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
