import { useState, useEffect, useCallback, createContext, useContext } from 'react'

// ============ TYPES ============

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: number
  type: ToastType
  message: string
  duration: number
}

interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface ToastContextType {
  success: (message: string) => void
  error: (message: string) => void
  warning: (message: string) => void
  info: (message: string) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

// ============ CONTEXT ============

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast deve estar dentro de <ToastProvider>')
  return ctx
}

// ============ ICONS ============

const icons: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
}

const colors: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'bg-emerald-500 text-white' },
  error: { bg: 'bg-red-500/10', border: 'border-red-500/30', icon: 'bg-red-500 text-white' },
  warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: 'bg-amber-500 text-white' },
  info: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', icon: 'bg-blue-500 text-white' },
}

// ============ TOAST ITEM COMPONENT ============

function ToastItemComponent({ toast, onClose }: { toast: ToastItem; onClose: (id: number) => void }) {
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), toast.duration - 300)
    const removeTimer = setTimeout(() => onClose(toast.id), toast.duration)
    return () => { clearTimeout(exitTimer); clearTimeout(removeTimer) }
  }, [toast.id, toast.duration, onClose])

  const c = colors[toast.type]

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-md shadow-lg ${c.bg} ${c.border}
        transition-all duration-300 min-w-[320px] max-w-[480px]
        ${exiting ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'}
      `}
      style={{ animation: exiting ? undefined : 'slideInRight 0.3s ease-out' }}
    >
      <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${c.icon}`}>
        {icons[toast.type]}
      </div>
      <p className="flex-1 text-sm text-gray-800 dark:text-gray-100">{toast.message}</p>
      <button
        onClick={() => { setExiting(true); setTimeout(() => onClose(toast.id), 300) }}
        className="flex-shrink-0 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors text-lg leading-none"
      >
        ×
      </button>
    </div>
  )
}

// ============ CONFIRM DIALOG ============

function ConfirmDialog({ options, onResult }: { options: ConfirmOptions; onResult: (confirmed: boolean) => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onResult(false)
      if (e.key === 'Enter') onResult(true)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onResult])

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ animation: 'fadeIn 0.15s ease-out' }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => onResult(false)} />
      <div
        className="relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4"
        style={{ animation: 'scaleIn 0.2s ease-out' }}
      >
        {options.title && (
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{options.title}</h3>
        )}
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">{options.message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => onResult(false)}
            className="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            {options.cancelText || 'Cancelar'}
          </button>
          <button
            onClick={() => onResult(true)}
            className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${
              options.danger
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-emerald-600 text-white hover:bg-emerald-500'
            }`}
            autoFocus
          >
            {options.confirmText || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============ PROVIDER ============

let globalId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [confirmState, setConfirmState] = useState<{
    options: ConfirmOptions
    resolve: (value: boolean) => void
  } | null>(null)

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((type: ToastType, message: string, duration = 4000) => {
    const id = ++globalId
    setToasts(prev => [...prev.slice(-4), { id, type, message, duration }]) // max 5 toasts
  }, [])

  const context: ToastContextType = {
    success: (msg) => addToast('success', msg),
    error: (msg) => addToast('error', msg, 6000),
    warning: (msg) => addToast('warning', msg, 5000),
    info: (msg) => addToast('info', msg),
    confirm: (options) => new Promise((resolve) => {
      setConfirmState({ options, resolve })
    }),
  }

  const handleConfirmResult = useCallback((result: boolean) => {
    if (confirmState) {
      confirmState.resolve(result)
      setConfirmState(null)
    }
  }, [confirmState])

  return (
    <ToastContext.Provider value={context}>
      {children}

      {/* Toast container */}
      <div className="fixed top-4 right-4 z-[9998] flex flex-col gap-2 pointer-events-auto">
        {toasts.map(t => (
          <ToastItemComponent key={t.id} toast={t} onClose={removeToast} />
        ))}
      </div>

      {/* Confirm dialog */}
      {confirmState && (
        <ConfirmDialog options={confirmState.options} onResult={handleConfirmResult} />
      )}

      {/* Animations */}
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(40px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </ToastContext.Provider>
  )
}
