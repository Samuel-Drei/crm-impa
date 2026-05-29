import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'

const API_BASE = import.meta.env.VITE_API_URL || ''

// ── Página pública de QR Code — layout profissional ──────
export default function SharedQRCode() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<'loading' | 'password' | 'qr' | 'connected' | 'error'>('loading')
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [linkInfo, setLinkInfo] = useState<any>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [timer, setTimer] = useState(40)
  const [verifiedPassword, setVerifiedPassword] = useState('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isDark = linkInfo?.theme !== 'light'

  // ── Buscar info do link ──
  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/api/shared/${token}`)
      .then(async res => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `Erro ${res.status}`)
        }
        return res.json()
      })
      .then(data => {
        setLinkInfo(data)
        if (data.requiresPassword) setState('password')
        else if (data.instanceStatus === 'CONNECTED') setState('connected')
        else { setState('qr'); fetchQR() }
      })
      .catch(err => { setError(err.message || 'Link inválido ou expirado'); setState('error') })
  }, [token])

  // ── Buscar QR Code ──
  const fetchQR = useCallback(async (pwd?: string) => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/shared/${token}/qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd || verifiedPassword || undefined }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao gerar QR Code')
      }
      const data = await res.json()
      if (data.status === 'CONNECTED') { setState('connected'); setQrCode(null); return }
      if (data.qrCode) { setQrCode(data.qrCode); setState('qr'); startTimer() }
      else setTimeout(() => fetchQR(pwd), 3000)
    } catch (err: any) {
      setError(err.message)
      if (err.message?.includes('Senha')) setPasswordError(err.message)
    } finally { setLoading(false) }
  }, [token, verifiedPassword])

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    setTimer(40)
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) { if (timerRef.current) clearInterval(timerRef.current); return 0 }
        return prev - 1
      })
    }, 1000)
  }, [])

  // ── Polling de status ──
  useEffect(() => {
    if (state === 'qr' && qrCode) {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/shared/${token}/status`)
          if (res.ok) {
            const data = await res.json()
            if (data.status === 'CONNECTED') {
              setState('connected'); setQrCode(null)
              if (timerRef.current) clearInterval(timerRef.current)
              if (pollRef.current) clearInterval(pollRef.current)
            }
          }
        } catch {}
      }, 3000)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [state, qrCode, token])

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim()) return
    setPasswordError(''); setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/shared/${token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Erro na verificação') }
      setVerifiedPassword(password); setState('qr'); fetchQR(password)
    } catch (err: any) { setPasswordError(err.message || 'Senha incorreta') }
    finally { setLoading(false) }
  }

  // ── Helper: cor da barra de progresso (computado inline) ──
  const getProgressBarColor = (t: number) =>
    t > 15 ? 'bg-gradient-to-r from-blue-500 to-indigo-500'
    : t > 7 ? 'bg-gradient-to-r from-amber-500 to-orange-500'
    : 'bg-gradient-to-r from-red-500 to-rose-500'

  // ── Cores por tema (estáveis, sem dependência de timer) ──
  const c = isDark ? {
    card: 'bg-[#0f1d32]/95 border border-white/[0.07] backdrop-blur-xl shadow-2xl shadow-blue-950/30',
    text: 'text-white',
    sub: 'text-gray-300',
    muted: 'text-gray-400',
    dim: 'text-gray-500',
    inputBg: 'bg-white/[0.05] border-white/[0.1] text-white placeholder-gray-500 focus:border-blue-400/60 focus:ring-blue-400/15',
    btn: 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-700/25',
    btnSec: 'bg-white/[0.07] hover:bg-white/[0.12] text-gray-300 border border-white/[0.1]',
    accent: 'text-blue-400',
    accentBg: 'bg-blue-500/15',
    step: 'bg-gradient-to-br from-blue-500 to-indigo-500 text-white',
    div: 'border-white/[0.07]',
    badge: 'bg-white/[0.06] border border-white/[0.1] text-gray-300',
    qrRing: 'ring-2 ring-blue-400/20',
    pTrack: 'bg-white/[0.07]',
    dot: 'bg-blue-400',
    spinner: 'border-blue-400/20 border-t-blue-400',
    checkBg: 'bg-gradient-to-br from-blue-500 to-indigo-500',
    checkPulse: 'bg-blue-400/20',
  } : {
    card: 'bg-white border border-gray-200 shadow-xl shadow-gray-200/50',
    text: 'text-gray-900',
    sub: 'text-gray-600',
    muted: 'text-gray-500',
    dim: 'text-gray-400',
    inputBg: 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-blue-500/15',
    btn: 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-600/20',
    btnSec: 'bg-gray-100 hover:bg-gray-200 text-gray-600 border border-gray-200',
    accent: 'text-blue-600',
    accentBg: 'bg-blue-50',
    step: 'bg-gradient-to-br from-blue-500 to-indigo-500 text-white',
    div: 'border-gray-100',
    badge: 'bg-gray-50 border border-gray-200 text-gray-600',
    qrRing: 'ring-2 ring-blue-500/15',
    pTrack: 'bg-gray-100',
    dot: 'bg-blue-500',
    spinner: 'border-blue-500/20 border-t-blue-500',
    checkBg: 'bg-gradient-to-br from-blue-500 to-indigo-500',
    checkPulse: 'bg-blue-500/20',
  }

  // ── Wrapper de página (elemento, não componente — evita remount) ──
  const pageBg = isDark ? 'bg-[#0a1628]' : 'bg-gradient-to-br from-gray-50 via-white to-blue-50/40'
  const pageWrap = (content: React.ReactNode) => (
    <div className={`min-h-screen flex items-center justify-center p-4 sm:p-6 ${pageBg}`}>
      {isDark && (
        <>
          <div className="fixed top-[-15%] left-[-8%] w-[550px] h-[550px] rounded-full bg-blue-600/[0.06] blur-[100px] pointer-events-none" />
          <div className="fixed bottom-[-10%] right-[-5%] w-[450px] h-[450px] rounded-full bg-indigo-500/[0.05] blur-[90px] pointer-events-none" />
        </>
      )}
      <div className="relative z-10 w-full flex flex-col items-center">{content}</div>
    </div>
  )

  // ── LOADING ──
  if (state === 'loading') {
    return pageWrap(
      <div className="flex flex-col items-center gap-5">
        <div className={`w-12 h-12 rounded-full border-[3px] animate-spin ${c.spinner}`} />
        <p className={`text-sm font-medium ${c.muted}`}>Carregando...</p>
      </div>
    )
  }

  // ── ERRO ──
  if (state === 'error') {
    return pageWrap(
        <div className={`w-full max-w-md rounded-2xl p-8 text-center ${c.card}`}>
          <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-red-500/10 flex items-center justify-center">
            <svg className="w-7 h-7 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h2 className={`text-lg font-bold mb-2 ${c.text}`}>Link indisponível</h2>
          <p className={`text-sm ${c.muted}`}>{error}</p>
        </div>
    )
  }

  // ── SENHA ──
  if (state === 'password') {
    return pageWrap(
        <div className={`w-full max-w-md rounded-2xl p-8 ${c.card}`}>
          <div className="text-center mb-7">
            <div className={`w-14 h-14 mx-auto mb-4 rounded-xl ${c.accentBg} flex items-center justify-center anim-float`}>
              <svg className={`w-6 h-6 ${c.accent}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="m7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h1 className={`text-xl font-bold mb-1.5 ${c.text}`}>Acesso protegido</h1>
            <p className={`text-sm ${c.muted}`}>
              {linkInfo?.instanceName && <span className="font-medium">{linkInfo.instanceName} · </span>}
              Digite a senha para continuar
            </p>
          </div>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <input type="password" value={password}
                onChange={e => { setPassword(e.target.value); setPasswordError('') }}
                placeholder="Senha de acesso" autoFocus
                className={`w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all focus:ring-4 ${c.inputBg}`}
              />
              {passwordError && <p className="text-red-400 text-xs mt-2 pl-1">{passwordError}</p>}
            </div>
            <button type="submit" disabled={loading || !password.trim()}
              className={`w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${c.btn}`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Verificando...
                </span>
              ) : 'Desbloquear'}
            </button>
          </form>
        </div>
    )
  }

  // ── CONECTADO ──
  if (state === 'connected') {
    return pageWrap(
        <div className={`w-full max-w-md rounded-2xl p-8 text-center ${c.card}`}>
          <div className="relative w-18 h-18 mx-auto mb-5">
            <div className={`absolute inset-0 rounded-full anim-pulse-ring ${c.checkPulse}`} />
            <div className={`relative w-[72px] h-[72px] rounded-full flex items-center justify-center ${c.checkBg}`}>
              <svg className="w-9 h-9 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
          </div>
          <h2 className={`text-xl font-bold mb-2 ${c.text}`}>Conectado!</h2>
          <p className={`text-sm mb-5 ${c.muted}`}>O WhatsApp foi conectado com sucesso.</p>
          {linkInfo?.profileName && (
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm ${c.badge}`}>
              <div className={`w-2 h-2 rounded-full ${c.dot}`} />
              {linkInfo.profileName}
            </div>
          )}
        </div>
    )
  }

  // ── QR CODE — Layout paisagem no desktop ──
  const steps = [
    { title: 'Abra o WhatsApp no seu celular', desc: 'Certifique-se de que está usando a versão mais recente do aplicativo.' },
    { title: 'Acesse as configurações', desc: 'Toque em Configurações → Dispositivos conectados.' },
    { title: 'Escolha um método de conexão', desc: 'Toque em Conectar um dispositivo e escaneie o QR Code.', alt: 'Ou insira o código de pareamento manualmente.' },
    { title: 'Aguarde a conexão', desc: 'Após escanear o QR Code ou inserir o código, aguarde a confirmação.' },
  ]

  return pageWrap(
      <div className={`w-full max-w-[960px] rounded-2xl overflow-hidden ${c.card}`}>
        {/* Header */}
        <div className="px-6 sm:px-8 pt-6 pb-5">
          <h1 className={`text-xl font-bold text-center ${c.text}`}>
            Conectar instância
          </h1>
          <p className={`text-sm text-center mt-1.5 ${c.muted}`}>
            Escaneie o QR Code ou digite o código de pareamento no WhatsApp para conectar.
          </p>
        </div>

        <div className={`border-t ${c.div}`} />

        {/* Corpo — paisagem no desktop */}
        <div className="p-6 sm:p-8">
          <div className="flex flex-col md:flex-row md:items-start gap-8">

            {/* ── Lado esquerdo: QR Code ── */}
            <div className="flex-shrink-0 flex flex-col items-center md:items-start">
              <h2 className={`text-sm font-semibold mb-4 ${c.text}`}>Escaneie o QR Code</h2>
              <div className={`rounded-xl p-2.5 bg-white ${c.qrRing}`}>
                {qrCode ? (
                  <img src={qrCode} alt="QR Code WhatsApp"
                    className="w-64 h-64 sm:w-[280px] sm:h-[280px]" draggable={false} />
                ) : (
                  <div className="w-64 h-64 sm:w-[280px] sm:h-[280px] flex items-center justify-center">
                    <div className={`w-10 h-10 border-[3px] rounded-full animate-spin ${c.spinner}`} />
                  </div>
                )}
              </div>

              {/* Timer / Refresh */}
              <div className="w-full max-w-[304px] mt-4">
                {timer > 0 ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <svg className={`w-3.5 h-3.5 ${c.dim}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span className={c.dim}>Expira em</span>
                      </div>
                      <span className={`font-mono font-semibold tabular-nums ${timer > 15 ? c.accent : timer > 7 ? 'text-amber-400' : 'text-red-400'}`}>
                        {timer} segundos
                      </span>
                    </div>
                    <div className={`w-full h-1.5 rounded-full overflow-hidden ${c.pTrack}`}>
                    <div className={`h-full rounded-full transition-all duration-1000 ease-linear ${getProgressBarColor(timer)}`}
                        style={{ width: `${(timer / 40) * 100}%` }} />
                    </div>
                  </div>
                ) : (
                  <button onClick={() => fetchQR()} disabled={loading}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${c.btnSec}`}>
                    <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" /><polyline points="21 3 21 9 15 9" />
                    </svg>
                    Gerar novo QR Code
                  </button>
                )}
              </div>
            </div>

            {/* ── Lado direito: Instruções ── */}
            <div className="flex-1 md:pt-0">
              <h2 className={`text-sm font-semibold mb-5 ${c.text}`}>Como conectar</h2>
              <div className="space-y-5">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-3.5">
                    <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${c.step}`}>
                      {i + 1}
                    </div>
                    <div className="pt-0.5 flex-1">
                      <p className={`text-sm font-medium ${c.text}`}>{step.title}</p>
                      <p className={`text-xs mt-1 leading-relaxed ${c.muted}`}>{step.desc}</p>
                      {step.alt && (
                        <>
                          <p className={`text-[10px] uppercase tracking-wider font-semibold my-1.5 ${c.dim}`}>OU</p>
                          <p className={`text-xs leading-relaxed ${c.muted}`}>{step.alt}</p>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Badge de status */}
              {qrCode && timer > 0 && (
                <div className={`mt-6 inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-medium ${c.badge}`}>
                  <span className="relative flex h-2 w-2">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${c.dot}`} />
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${c.dot}`} />
                  </span>
                  Aguardando conexão...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`border-t ${c.div} px-6 sm:px-8 py-3`}>
          <div className="flex items-center justify-center gap-1.5">
            <svg className={`w-3 h-3 ${c.dim}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="m7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <p className={`text-[11px] ${c.dim}`}>Conexão segura e criptografada</p>
          </div>
        </div>
      </div>
  )
}
