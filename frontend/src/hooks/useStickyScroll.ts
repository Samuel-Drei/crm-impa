import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface Options {
  /** Tolerância em px para considerar o usuário como "no fim" */
  threshold?: number
  /** Lista de dependências cuja mudança deve disparar o sticky-scroll (ex: messages, sending) */
  deps?: any[]
}

/**
 * Hook de auto-scroll robusto para áreas de chat.
 *
 * - Mantém scroll pinado no fim quando o usuário JÁ está no fim.
 * - Se o usuário rolou pra cima, NÃO força scroll automático e expõe `isPinned=false`
 *   para que a UI possa mostrar um botão flutuante "↓ novas mensagens".
 * - Usa requestAnimationFrame + ResizeObserver para reagir a mudanças de layout
 *   (incluindo quando o "indicador de digitando" entra/sai e quando bolhas crescem
 *   por streaming de markdown). Sem isso, o `scrollTop = scrollHeight` em useEffect
 *   roda antes do reflow e dá a sensação de "scroll infinito".
 */
export function useStickyScroll<T extends HTMLElement>(opts: Options = {}) {
  const { threshold = 80, deps = [] } = opts
  const scrollRef = useRef<T | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [isPinned, setIsPinned] = useState(true)

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    })
  }, [])

  // Detecta se o usuário está no fim
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setIsPinned(distance <= threshold)
  }, [threshold])

  // Quando dependências mudam (mensagens novas, typing) — se estiver pinado, scrolla
  useLayoutEffect(() => {
    if (isPinned) scrollToBottom(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // Observa mudanças de tamanho do conteúdo interno
  useEffect(() => {
    if (!innerRef.current) return
    const ro = new ResizeObserver(() => {
      if (isPinned) scrollToBottom(false)
    })
    ro.observe(innerRef.current)
    return () => ro.disconnect()
  }, [isPinned, scrollToBottom])

  return { scrollRef, innerRef, isPinned, scrollToBottom, onScroll }
}
