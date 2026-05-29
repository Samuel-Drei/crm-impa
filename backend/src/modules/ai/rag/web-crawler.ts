/**
 * Web Crawler — Extrai conteúdo de URLs e sites
 * Inspirado no Firecrawl (sitemap discovery + crawl pipeline + engines)
 * + Scrapy (deduplicação + prioridade + robots.txt)
 * + Crawl4AI (content filtering)
 * 
 * Melhorias sobre a versão anterior:
 * - Sitemap discovery antes do BFS (Firecrawl/Scrapy)
 * - Canonical URL detection (Firecrawl)
 * - Reusa HTML do scrape para extrair links (evita double-fetch)
 * - Deduplicação com UrlDeduplicator (Scrapy RFPDupeFilter)
 * - Content cleaner com Cheerio (Firecrawl removeUnwantedElements)
 * - Metadata enriquecida (language, publishedAt, canonical)
 */

import { htmlToCleanText, cleanText } from './text-splitter.js'
import { htmlToMarkdown, extractCanonicalUrl, extractTitle as extractTitleCheerio, extractMetaDescription as extractMetaDescCheerio, detectLanguage, extractPublishedDate } from './content-cleaner.js'
import { discoverSitemap, type SitemapEntry } from './sitemap.parser.js'
import { normalizeUrl as normalizeUrlAdvanced, isValidCrawlUrl, UrlDeduplicator, matchGlob, extractDomain } from './url-utils.js'

export interface CrawlResult {
  url: string
  canonicalUrl: string       // URL canônica real (via <link rel="canonical">)
  title: string
  content: string            // Markdown limpo (via content-cleaner)
  rawContent: string         // Texto bruto extraído (HTML→texto)
  contentHash: string
  metadata: {
    statusCode?: number
    contentType?: string
    language?: string
    description?: string
    wordCount: number
    publishedAt?: Date | null  // Data de publicação extraída
    fromSitemap?: boolean      // Se a URL veio do sitemap
  }
}

export interface CrawlConfig {
  maxPages: number
  maxDepth: number
  includePatterns?: string[]  // glob patterns para incluir
  excludePatterns?: string[]  // glob patterns para excluir
  respectRobots: boolean
  timeout: number             // ms por página
}

const DEFAULT_CRAWL_CONFIG: CrawlConfig = {
  maxPages: 50,
  maxDepth: 3,
  respectRobots: true,
  timeout: 15000,
}

/**
 * Scrape uma única URL — retorna conteúdo limpo como Markdown
 * Agora usa content-cleaner (Cheerio) em vez de regex
 * + detecta canonical URL, language, publishedAt
 */
export async function scrapeUrl(
  url: string,
  timeout: number = 15000
): Promise<CrawlResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'IMPA-CRM-Bot/1.0 (Knowledge Indexer)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const contentType = response.headers.get('content-type') || ''
    const html = await response.text()
    const finalUrl = response.url // URL final após redirects

    // Usar content-cleaner (Cheerio-based) — inspirado Firecrawl
    const content = htmlToMarkdown(html)
    const title = extractTitleCheerio(html)
    const canonicalUrl = extractCanonicalUrl(html, finalUrl)
    const language = detectLanguage(html)
    const description = extractMetaDescCheerio(html)
    const publishedAt = extractPublishedDate(html)

    // Hash para deduplicação (padrão Dify)
    const crypto = await import('crypto')
    const contentHash = crypto.createHash('md5').update(content).digest('hex')

    return {
      url: finalUrl,
      canonicalUrl,
      title,
      content,
      rawContent: content, // Markdown é o content limpo
      contentHash,
      metadata: {
        statusCode: response.status,
        contentType,
        language,
        description,
        wordCount: content.split(/\s+/).filter(Boolean).length,
        publishedAt,
      },
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Scrape uma URL e também retorna o HTML bruto (para extrair links sem re-fetch)
 * Uso interno do crawler — evita double-fetch
 */
async function scrapeUrlWithHtml(
  url: string,
  timeout: number = 15000
): Promise<{ result: CrawlResult; html: string } | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'IMPA-CRM-Bot/1.0 (Knowledge Indexer)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    })

    if (!response.ok) return null

    const contentType = response.headers.get('content-type') || ''
    // Só processar HTML
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) return null

    const html = await response.text()
    const finalUrl = response.url

    const content = htmlToMarkdown(html)
    const title = extractTitleCheerio(html)
    const canonicalUrl = extractCanonicalUrl(html, finalUrl)
    const language = detectLanguage(html)
    const description = extractMetaDescCheerio(html)
    const publishedAt = extractPublishedDate(html)

    const crypto = await import('crypto')
    const contentHash = crypto.createHash('md5').update(content).digest('hex')

    return {
      result: {
        url: finalUrl,
        canonicalUrl,
        title,
        content,
        rawContent: content,
        contentHash,
        metadata: {
          statusCode: response.status,
          contentType,
          language,
          description,
          wordCount: content.split(/\s+/).filter(Boolean).length,
          publishedAt,
        },
      },
      html,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Crawl de um site inteiro (descoberta de páginas + extração)
 * 
 * Pipeline melhorado (inspirado Firecrawl + Scrapy):
 * 1. Tentar sitemap.xml primeiro (Firecrawl/Scrapy) — mais eficiente
 * 2. Se não achar, BFS por links internos (fallback)
 * 3. Usar UrlDeduplicator (Scrapy RFPDupeFilter) para evitar revisitas
 * 4. Extrair links do HTML já baixado (evita double-fetch)
 * 5. Detectar canonical URL para cada página
 */
export async function crawlWebsite(
  startUrl: string,
  config: Partial<CrawlConfig> = {},
  onProgress?: (progress: { pagesFound: number; pagesProcessed: number; currentUrl: string }) => void
): Promise<CrawlResult[]> {
  const cfg = { ...DEFAULT_CRAWL_CONFIG, ...config }
  const baseDomain = extractDomain(startUrl)
  const dedup = new UrlDeduplicator()
  const results: CrawlResult[] = []

  // Buscar robots.txt (se respectRobots)
  let disallowedPaths: string[] = []
  if (cfg.respectRobots) {
    disallowedPaths = await fetchRobotsTxtDisallowed(baseDomain)
  }

  // === FASE 1: Tentar sitemap primeiro (Firecrawl/Scrapy pattern) ===
  let sitemapEntries: SitemapEntry[] = []
  try {
    sitemapEntries = await discoverSitemap(startUrl, cfg.timeout)
    console.log(`[Crawler] Sitemap discovery: ${sitemapEntries.length} URLs encontradas`)
  } catch (error) {
    console.warn('[Crawler] Sitemap discovery falhou:', (error as Error).message)
  }

  // Se temos sitemap com URLs, processar elas primeiro
  if (sitemapEntries.length > 0) {
    const sitemapUrls = sitemapEntries
      .map((e) => e.url)
      .filter((url) => isValidCrawlUrl(url, baseDomain))
      .filter((url) => !isDisallowed(url, disallowedPaths))
      .filter((url) => matchesPatterns(url, cfg.includePatterns, cfg.excludePatterns))
      .slice(0, cfg.maxPages)

    for (const url of sitemapUrls) {
      if (results.length >= cfg.maxPages) break
      if (!dedup.add(url)) continue

      onProgress?.({
        pagesFound: sitemapUrls.length,
        pagesProcessed: results.length,
        currentUrl: url,
      })

      try {
        const scraped = await scrapeUrlWithHtml(url, cfg.timeout)
        if (scraped && scraped.result.content.length >= 50) {
          scraped.result.metadata.fromSitemap = true
          results.push(scraped.result)
        }
      } catch (error) {
        console.warn(`[Crawler] Erro ao processar ${url} (sitemap):`, (error as Error).message)
      }
    }

    // Se o sitemap deu resultados suficientes, retornar
    if (results.length >= cfg.maxPages * 0.5) {
      console.log(`[Crawler] Sitemap forneceu ${results.length} resultados — skip BFS`)
      return results
    }
  }

  // === FASE 2: BFS por links internos (fallback/complemento) ===
  const bfsQueue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }]
  dedup.add(startUrl)

  while (bfsQueue.length > 0 && results.length < cfg.maxPages) {
    const { url, depth } = bfsQueue.shift()!

    if (depth > cfg.maxDepth) continue
    if (isDisallowed(url, disallowedPaths)) continue
    if (!matchesPatterns(url, cfg.includePatterns, cfg.excludePatterns)) continue

    try {
      onProgress?.({
        pagesFound: dedup.size,
        pagesProcessed: results.length,
        currentUrl: url,
      })

      // Scrape + extrair HTML (single fetch — evita double-fetch!)
      const scraped = await scrapeUrlWithHtml(url, cfg.timeout)
      if (!scraped) continue

      if (scraped.result.content.length >= 50) {
        results.push(scraped.result)
      }

      // Descobrir links internos do HTML já baixado (sem re-fetch)
      if (depth < cfg.maxDepth) {
        const links = extractLinksFromHtml(scraped.html, url, baseDomain)
        for (const link of links) {
          if (dedup.add(link) && isValidCrawlUrl(link, baseDomain)) {
            bfsQueue.push({ url: link, depth: depth + 1 })
          }
        }
      }
    } catch (error) {
      console.warn(`[Crawler] Erro ao processar ${url}:`, (error as Error).message)
    }
  }

  console.log(`[Crawler] Crawl concluído: ${results.length} páginas processadas, ${dedup.size} URLs descobertas`)
  return results
}

/**
 * Extrai transcript de vídeo YouTube via API pública
 */
export async function extractYouTubeTranscript(videoUrl: string): Promise<{
  title: string
  content: string
  duration?: number
  metadata: Record<string, unknown>
}> {
  const videoId = extractYouTubeVideoId(videoUrl)
  if (!videoId) throw new Error('URL de YouTube inválida')

  // Tentar extrair via página do YouTube (transcript pública)
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' },
  })

  const html = await response.text()
  const title = extractTitleCheerio(html) || `YouTube Video ${videoId}`

  // Extrair captions da página
  const captionTrack = extractCaptionTrack(html)
  let transcript = ''

  if (captionTrack) {
    try {
      const captionResponse = await fetch(captionTrack)
      const captionXml = await captionResponse.text()
      transcript = parseCaptionXml(captionXml)
    } catch {
      transcript = ''
    }
  }

  if (!transcript) {
    // Fallback: extrair descrição
    const description = extractMetaDescCheerio(html)
    transcript = description || `Vídeo: ${title}. Transcrição indisponível.`
  }

  return {
    title,
    content: cleanText(transcript),
    metadata: {
      videoId,
      source: 'youtube',
      url: videoUrl,
    },
  }
}

/**
 * Extrai texto de arquivo (PDF, TXT, MD, JSON, DOCX)
 */
export async function extractFileContent(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ content: string; title: string }> {
  const ext = fileName.split('.').pop()?.toLowerCase()

  switch (ext) {
    case 'txt':
    case 'md':
    case 'csv':
      return { content: buffer.toString('utf-8'), title: fileName }

    case 'json': {
      const json = JSON.parse(buffer.toString('utf-8'))
      return { content: JSON.stringify(json, null, 2), title: fileName }
    }

    case 'pdf': {
      try {
        const pdfParse = (await import('pdf-parse')).default
        const data = await pdfParse(buffer)
        return { content: cleanText(data.text), title: data.info?.Title || fileName }
      } catch {
        return { content: `[PDF: ${fileName} - extração falhou]`, title: fileName }
      }
    }

    case 'html':
    case 'htm':
      return { content: htmlToCleanText(buffer.toString('utf-8')), title: fileName }

    default:
      return { content: buffer.toString('utf-8'), title: fileName }
  }
}

// ============ Helpers internos ============

/**
 * Extrai links internos do HTML já baixado (SEM re-fetch!)
 * Melhoria: usa o HTML que já temos do scrape anterior
 */
function extractLinksFromHtml(html: string, baseUrl: string, baseDomain: string): string[] {
  const links: string[] = []
  const regex = /href=["']([^"'#]+)["']/gi
  let match

  while ((match = regex.exec(html)) !== null) {
    try {
      const href = match[1]
      // Ignorar javascript:, mailto:, tel:
      if (href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue

      const absoluteUrl = new URL(href, baseUrl).href
      const linkDomain = extractDomain(absoluteUrl)

      if (linkDomain === baseDomain.replace(/^www\./, '')) {
        // Limpar: remover fragment e query de tracking
        const clean = normalizeUrlAdvanced(absoluteUrl)
        links.push(clean)
      }
    } catch {
      // URL inválida, ignorar
    }
  }

  return [...new Set(links)] // Deduplicar
}

/**
 * Verifica se a URL está proibida pelo robots.txt
 */
function isDisallowed(url: string, disallowedPaths: string[]): boolean {
  if (disallowedPaths.length === 0) return false
  try {
    const pathname = new URL(url).pathname
    return disallowedPaths.some((path) => pathname.startsWith(path))
  } catch {
    return false
  }
}

/**
 * Verifica include/exclude patterns
 */
function matchesPatterns(
  url: string,
  includePatterns?: string[],
  excludePatterns?: string[]
): boolean {
  if (includePatterns?.length && !includePatterns.some((p) => matchGlob(url, p))) {
    return false
  }
  if (excludePatterns?.some((p) => matchGlob(url, p))) {
    return false
  }
  return true
}

async function fetchRobotsTxtDisallowed(domain: string): Promise<string[]> {
  try {
    const response = await fetch(`https://${domain}/robots.txt`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return []
    const text = await response.text()
    const disallowed: string[] = []
    let isRelevantAgent = false

    for (const line of text.split('\n')) {
      const trimmed = line.trim().toLowerCase()
      if (trimmed.startsWith('user-agent:')) {
        isRelevantAgent = trimmed.includes('*') || trimmed.includes('impa')
      }
      if (isRelevantAgent && trimmed.startsWith('disallow:')) {
        const path = trimmed.replace('disallow:', '').trim()
        if (path) disallowed.push(path)
      }
    }
    return disallowed
  } catch {
    return []
  }
}

function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

function extractCaptionTrack(html: string): string | null {
  const match = html.match(/"captionTracks":\[{"baseUrl":"([^"]+)"/)
  if (match) {
    return match[1].replace(/\\u0026/g, '&')
  }
  return null
}

function parseCaptionXml(xml: string): string {
  const segments: string[] = []
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/gi
  let match
  while ((match = regex.exec(xml)) !== null) {
    const text = match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .trim()
    if (text) segments.push(text)
  }
  return segments.join(' ')
}
