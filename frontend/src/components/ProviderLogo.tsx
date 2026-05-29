/**
 * ProviderLogo — Logos SVG reais/estilizados dos provedores de IA
 */

interface ProviderLogoProps {
  type: string
  size?: number
  className?: string
}

export function ProviderLogo({ type, size = 24, className }: ProviderLogoProps) {
  const s = size
  const cls = className || ''

  switch (type) {
    // ═══ OpenAI — atom/hexagon logo ═══
    case 'OPENAI':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls}>
          <path fill="#10a37f" d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
        </svg>
      )

    // ═══ Google Gemini — sparkle star ═══
    case 'GEMINI':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls}>
          <path fill="#4285f4" d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z"/>
        </svg>
      )

    // ═══ Anthropic Claude — angular A mark ═══
    case 'CLAUDE':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls} fill="none">
          <path d="M8 19L12 5l4 14" stroke="#d97706" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M9.5 14.5h5" stroke="#d97706" strokeWidth="2.2" strokeLinecap="round"/>
        </svg>
      )

    // ═══ DeepSeek — diamond + core ═══
    case 'DEEPSEEK':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls} fill="none">
          <path d="M12 2L21 12L12 22L3 12Z" stroke="#0066ff" strokeWidth="2" strokeLinejoin="round"/>
          <circle cx="12" cy="12" r="3" fill="#0066ff"/>
        </svg>
      )

    // ═══ Groq — lightning bolt (speed) ═══
    case 'GROQ':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls}>
          <path d="M13 2L4 14h5l-2 8 9-12h-5l2-8z" fill="#f55036"/>
        </svg>
      )

    // ═══ OpenRouter — globe ═══
    case 'OPENROUTER':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls} fill="none">
          <circle cx="12" cy="12" r="9" stroke="#6366f1" strokeWidth="1.8"/>
          <ellipse cx="12" cy="12" rx="4" ry="9" stroke="#6366f1" strokeWidth="1.4"/>
          <line x1="3" y1="12" x2="21" y2="12" stroke="#6366f1" strokeWidth="1.4"/>
        </svg>
      )

    // ═══ Perplexity — search lens ═══
    case 'PERPLEXITY':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls} fill="none">
          <circle cx="10.5" cy="10.5" r="6" stroke="#20b2aa" strokeWidth="2.2"/>
          <line x1="15" y1="15" x2="21" y2="21" stroke="#20b2aa" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
      )

    // ═══ Mistral — colored bars ═══
    case 'MISTRAL':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls}>
          <rect x="4" y="4" width="16" height="3" rx="1.5" fill="#ff7000"/>
          <rect x="4" y="10.5" width="12" height="3" rx="1.5" fill="#ffbe1a"/>
          <rect x="4" y="17" width="16" height="3" rx="1.5" fill="#ff7000"/>
        </svg>
      )

    // ═══ Cohere — C shape with colored dots ═══
    case 'COHERE':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls} fill="none">
          <path d="M15 7a7 7 0 1 0 0 10" stroke="#39594d" strokeWidth="3" strokeLinecap="round"/>
          <circle cx="16" cy="7" r="2.5" fill="#d18ee2"/>
          <circle cx="16" cy="17" r="2.5" fill="#ff7759"/>
        </svg>
      )

    // ═══ xAI (Grok) — bold X ═══
    case 'XAI':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls} fill="none">
          <path d="M5 5l14 14M19 5L5 19" stroke="#1da1f2" strokeWidth="3.5" strokeLinecap="round"/>
        </svg>
      )

    // ═══ Together AI — connected nodes ═══
    case 'TOGETHER':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls}>
          <circle cx="7" cy="7" r="3" fill="#0ea5e9"/>
          <circle cx="17" cy="7" r="3" fill="#0ea5e9"/>
          <circle cx="12" cy="17" r="3" fill="#0ea5e9"/>
          <line x1="7" y1="10" x2="12" y2="14" stroke="#0ea5e9" strokeWidth="2"/>
          <line x1="17" y1="10" x2="12" y2="14" stroke="#0ea5e9" strokeWidth="2"/>
          <line x1="10" y1="7" x2="14" y2="7" stroke="#0ea5e9" strokeWidth="2"/>
        </svg>
      )

    // ═══ Fireworks — starburst ═══
    case 'FIREWORKS':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls} fill="none">
          <circle cx="12" cy="12" r="2.5" fill="#ef4444"/>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.8 2.8M15.2 15.2L18 18M6 18l2.8-2.8M15.2 8.8L18 6" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round"/>
        </svg>
      )

    // ═══ Cerebras — chip/processor ═══
    case 'CEREBRAS':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls} fill="none">
          <rect x="6" y="6" width="12" height="12" rx="2" stroke="#8b5cf6" strokeWidth="1.8"/>
          <rect x="9" y="9" width="6" height="6" rx="1" fill="#8b5cf6" opacity="0.3"/>
          <path d="M9 4v2M12 4v2M15 4v2M9 18v2M12 18v2M15 18v2M4 9h2M4 12h2M4 15h2M18 9h2M18 12h2M18 15h2" stroke="#8b5cf6" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
      )

    // ═══ GitHub Models — octocat mark ═══
    case 'GITHUB_MODELS':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls}>
          <path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
        </svg>
      )

    // ═══ GitHub Copilot — pilot goggles/twin-prop ═══
    case 'GITHUB_COPILOT':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls} fill="none">
          <rect x="3" y="8" width="18" height="10" rx="5" stroke="#24292e" strokeWidth="2"/>
          <circle cx="8.5" cy="13" r="2.5" fill="#24292e"/>
          <circle cx="15.5" cy="13" r="2.5" fill="#24292e"/>
          <circle cx="8.5" cy="13" r="1" fill="#4af626"/>
          <circle cx="15.5" cy="13" r="1" fill="#4af626"/>
          <path d="M11 13h2" stroke="#24292e" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M7 8V6a5 5 0 0 1 10 0v2" stroke="#24292e" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      )

    // ═══ Antigravity — upward arrow / rocket (Google coding AI) ═══
    case 'ANTIGRAVITY':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls} fill="none">
          <path d="M12 2L8 10h3v5l5-8h-3L12 2z" fill="#a855f7"/>
          <path d="M8 18c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="#a855f7" strokeWidth="2" strokeLinecap="round"/>
          <circle cx="12" cy="21" r="1.5" fill="#a855f7"/>
        </svg>
      )

    // ═══ OpenAI Compatible — plug/connector ═══
    case 'OPENAI_COMPATIBLE':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls} fill="none">
          <path d="M9 4v5M15 4v5" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round"/>
          <path d="M7 9h10v4a5 5 0 0 1-10 0V9z" stroke="#6b7280" strokeWidth="2" strokeLinejoin="round"/>
          <path d="M12 18v3" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
      )

    // ═══ Fallback ═══
    default:
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} className={cls}>
          <circle cx="12" cy="12" r="10" fill="#6b7280"/>
          <text x="12" y="16.5" textAnchor="middle" fill="white" fontSize="11" fontFamily="system-ui" fontWeight="bold">{type.charAt(0)}</text>
        </svg>
      )
  }
}
