import { useState, useRef, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Search, Loader2, CheckCircle2, XCircle, MessageSquarePlus, Phone, User } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import api from '@/services/api'

const BACKEND_URL = import.meta.env.VITE_API_URL || ''

interface NewConversationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  instanceId: string
  onConversationStarted: (remoteJid: string) => void
}

type CheckStatus = 'idle' | 'checking' | 'found' | 'not_found' | 'error'

interface CheckResult {
  exists: boolean
  jid?: string
  number?: string
  name?: string | null
  profilePicture?: string | null
  existingConversation?: boolean
}

export default function NewConversationDialog({ open, onOpenChange, instanceId, onConversationStarted }: NewConversationDialogProps) {
  const [phoneNumber, setPhoneNumber] = useState('')
  const [contactName, setContactName] = useState('')
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('idle')
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset state quando abre/fecha
  useEffect(() => {
    if (open) {
      setPhoneNumber('')
      setContactName('')
      setCheckStatus('idle')
      setCheckResult(null)
      setStarting(false)
      setError('')
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const handleCheckNumber = async () => {
    const clean = phoneNumber.replace(/\D/g, '')
    if (clean.length < 10) {
      setError('Digite um número válido com DDD (mínimo 10 dígitos)')
      return
    }

    setCheckStatus('checking')
    setError('')
    setCheckResult(null)

    try {
      const res = await api.post('/conversations/check-number', {
        instanceId,
        phoneNumber: clean,
      })
      const data = res.data
      setCheckResult(data)
      setCheckStatus(data.exists ? 'found' : 'not_found')

      // Se já existe conversa no CRM, abrir direto
      if (data.exists && data.existingConversation && data.jid) {
        onConversationStarted(data.jid)
        onOpenChange(false)
        return
      }

      // Auto-preencher nome se retornado pela API
      if (data.exists && data.name && !contactName) {
        setContactName(data.name)
      }
    } catch (err: any) {
      setCheckStatus('error')
      setError(err.response?.data?.error || 'Erro ao verificar número')
    }
  }

  const handleStartConversation = async () => {
    const clean = phoneNumber.replace(/\D/g, '')
    if (clean.length < 10) return

    setStarting(true)
    setError('')

    try {
      const res = await api.post('/conversations/start', {
        instanceId,
        phoneNumber: clean,
        contactName: contactName || undefined,
      })
      const { remoteJid } = res.data
      onConversationStarted(remoteJid)
      onOpenChange(false)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao iniciar conversa')
    } finally {
      setStarting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (checkStatus === 'found') {
        handleStartConversation()
      } else {
        handleCheckNumber()
      }
    }
  }

  const isNumberValid = phoneNumber.replace(/\D/g, '').length >= 10

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] bg-[var(--chat-sidebar)] border-[var(--chat-border)] text-[var(--chat-text-primary)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[var(--chat-text-primary)]">
            <MessageSquarePlus className="h-5 w-5 text-[var(--chat-accent)]" />
            Nova Conversa
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Número de telefone */}
          <div className="space-y-1.5">
            <label className="text-xs text-[var(--chat-text-secondary)] font-medium">
              Número do WhatsApp
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--chat-text-secondary)]" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="5511999999999"
                  value={phoneNumber}
                  onChange={e => {
                    setPhoneNumber(e.target.value)
                    // Reset check quando muda o número
                    if (checkStatus !== 'idle' && checkStatus !== 'checking') {
                      setCheckStatus('idle')
                      setCheckResult(null)
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-[var(--chat-header)] text-[var(--chat-text-primary)] placeholder-[var(--chat-text-secondary)] text-sm border border-[var(--chat-border)] outline-none focus:ring-2 focus:ring-[var(--chat-accent)]/30 focus:border-[var(--chat-accent)]/50 transition-all"
                />
              </div>
              <button
                onClick={handleCheckNumber}
                disabled={!isNumberValid || checkStatus === 'checking'}
                className="px-4 py-2.5 rounded-lg bg-[var(--chat-accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shrink-0"
              >
                {checkStatus === 'checking' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Verificar
              </button>
            </div>
            <p className="text-[10px] text-[var(--chat-text-secondary)]">
              Inclua o código do país (55 para Brasil) + DDD + número
            </p>
          </div>

          {/* Resultado da verificação */}
          {checkStatus === 'found' && checkResult && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Avatar className="h-10 w-10 shrink-0">
                {checkResult.profilePicture ? (
                  <AvatarImage src={checkResult.profilePicture.startsWith('/') ? `${BACKEND_URL}${checkResult.profilePicture}` : checkResult.profilePicture} />
                ) : null}
                <AvatarFallback className="bg-emerald-600 text-white text-sm">
                  {checkResult.name ? checkResult.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() : (checkResult.number || '').slice(-2)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span className="text-sm font-medium text-emerald-400">Número encontrado no WhatsApp</span>
                </div>
                {checkResult.name && (
                  <p className="text-xs text-[var(--chat-text-secondary)] mt-0.5 truncate">{checkResult.name}</p>
                )}
              </div>
            </div>
          )}

          {checkStatus === 'not_found' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <XCircle className="h-4 w-4 text-red-400 shrink-0" />
              <span className="text-sm text-red-400">Número não encontrado no WhatsApp</span>
            </div>
          )}

          {checkStatus === 'error' && error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <XCircle className="h-4 w-4 text-red-400 shrink-0" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          {/* Nome do contato (opcional) */}
          {checkStatus === 'found' && (
            <div className="space-y-1.5">
              <label className="text-xs text-[var(--chat-text-secondary)] font-medium">
                Nome do contato (opcional)
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--chat-text-secondary)]" />
                <input
                  type="text"
                  placeholder="Nome para salvar no contato"
                  value={contactName}
                  onChange={e => setContactName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-[var(--chat-header)] text-[var(--chat-text-primary)] placeholder-[var(--chat-text-secondary)] text-sm border border-[var(--chat-border)] outline-none focus:ring-2 focus:ring-[var(--chat-accent)]/30 focus:border-[var(--chat-accent)]/50 transition-all"
                />
              </div>
            </div>
          )}

          {/* Botão iniciar conversa */}
          {checkStatus === 'found' && (
            <button
              onClick={handleStartConversation}
              disabled={starting}
              className="w-full py-2.5 rounded-lg bg-[var(--chat-accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {starting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquarePlus className="h-4 w-4" />
              )}
              Iniciar Conversa
            </button>
          )}

          {error && checkStatus !== 'error' && (
            <p className="text-xs text-red-400 text-center">{error}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
