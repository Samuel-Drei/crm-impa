/**
 * URL Utils — Normalização, canonical detection e deduplicação de URLs
 * Inspirado no Scrapy (RFPDupeFilter) + Firecrawl (URL normalization)
 * 
 * Funções para:
 * - Normalizar URLs (remover tracking params, trailing slashes, etc.)
 * - Detectar canonical URLs
 * - Gerar fingerprints para deduplicação (padrão Scrapy)
 * - Validar URLs para crawling
 */

/**
 * Normaliza uma URL para deduplicação
 * Remove: fragment (#), trailing slash, parametros de tracking, www
 * Lowercase: hostname e scheme
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)

    // Lowercase scheme e host
    u.protocol = u.protocol.toLowerCase()
    u.hostname = u.hostname.toLowerCase()

    // Remover fragment
    u.hash = ''

    // Remover trailing slash (exceto root)
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '')
    }

    // Remover www.
    if (u.hostname.startsWith('www.')) {
      u.hostname = u.hostname.substring(4)
    }

    // Remover parâmetros de tracking comuns
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'fbclid', 'gclid', 'gclsrc', 'dclid',
      'mc_cid', 'mc_eid',
      'ref', '_ref', 'source',
      'hsCtaTracking', 'hsa_acc', 'hsa_cam', 'hsa_grp', 'hsa_ad', 'hsa_src', 'hsa_tgt', 'hsa_kw', 'hsa_mt', 'hsa_net', 'hsa_ver',
    ]

    for (const param of trackingParams) {
      u.searchParams.delete(param)
    }

    // Ordenar search params (para normalização consistente)
    u.searchParams.sort()

    // Se não sobrou params, remover o "?"
    const result = u.toString()
    return result.endsWith('?') ? result.slice(0, -1) : result
  } catch {
    return url
  }
}

/**
 * Gera fingerprint único de uma URL (padrão Scrapy RFPDupeFilter)
 * Usa SHA-1 do URL normalizado para comparação rápida
 */
export function urlFingerprint(url: string): string {
  const normalized = normalizeUrl(url)
  // Usar hash simples em vez de crypto para evitar import
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36)
}

/**
 * Verifica se uma URL é válida para crawling
 */
export function isValidCrawlUrl(url: string, baseDomain: string): boolean {
  try {
    const u = new URL(url)

    // Deve ser HTTP(S)
    if (!u.protocol.startsWith('http')) return false

    // Deve ser do mesmo domínio (normalize www)
    const urlDomain = u.hostname.replace(/^www\./, '')
    const targetDomain = baseDomain.replace(/^www\./, '')
    if (urlDomain !== targetDomain) return false

    // Ignorar URLs de recursos estáticos
    const staticExtensions = [
      '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
      '.css', '.js', '.woff', '.woff2', '.ttf', '.eot',
      '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv',
      '.zip', '.rar', '.gz', '.tar', '.7z',
      '.exe', '.dmg', '.msi',
      '.xml', '.rss', '.atom',
    ]
    const pathLower = u.pathname.toLowerCase()
    if (staticExtensions.some((ext) => pathLower.endsWith(ext))) return false

    // Ignorar URLs de login/admin/api
    const ignoredPaths = [
      '/login', '/signin', '/signup', '/register',
      '/admin', '/dashboard', '/api/',
      '/wp-admin', '/wp-login', '/wp-json',
      '/cart', '/checkout', '/account',
      '/search', '/tag/', '/category/',
    ]
    if (ignoredPaths.some((p) => pathLower.includes(p))) return false

    return true
  } catch {
    return false
  }
}

/**
 * Extrai o domínio base de uma URL
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Resolve uma URL relativa contra uma URL base
 */
export function resolveUrl(relativeUrl: string, baseUrl: string): string | null {
  try {
    return new URL(relativeUrl, baseUrl).href
  } catch {
    return null
  }
}

/**
 * Limpa URL removendo fragment e normalizando
 */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.href
  } catch {
    return url
  }
}

/**
 * Verifica se o glob pattern simples combina com a URL
 */
export function matchGlob(url: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(regex, 'i').test(url)
}

/**
 * Set de deduplicação de URLs (inspirado no Scrapy DupeFilter)
 */
export class UrlDeduplicator {
  private seen = new Set<string>()

  /**
   * Verifica se a URL já foi vista e marca como vista
   * Retorna true se é nova (não duplicada)
   */
  add(url: string): boolean {
    const normalized = normalizeUrl(url)
    if (this.seen.has(normalized)) return false
    this.seen.add(normalized)
    return true
  }

  /**
   * Verifica se a URL já foi vista (sem marcar)
   */
  has(url: string): boolean {
    return this.seen.has(normalizeUrl(url))
  }

  get size(): number {
    return this.seen.size
  }

  clear(): void {
    this.seen.clear()
  }
}
