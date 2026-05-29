/**
 * Sitemap Parser — Descobre e parseia sitemaps para crawling inteligente
 * Inspirado no Firecrawl (sitemap.ts) + Scrapy (SitemapSpider)
 * 
 * Funcionalidades:
 * - Discovery automático: tenta /sitemap.xml, /sitemap_index.xml, robots.txt
 * - Suporte a sitemap index (recursivo)
 * - Filtering por lastmod (só recrawlar o que mudou)
 * - Suporte a sitemap comprimido (gzip)
 */

export interface SitemapEntry {
  url: string
  lastmod?: Date
  changefreq?: string
  priority?: number
}

/**
 * Descobre e extrai URLs do sitemap de um domínio
 * Inspirado no Firecrawl: tenta sitemap.xml → robots.txt → sitemap_index
 */
export async function discoverSitemap(
  baseUrl: string,
  timeout: number = 10000
): Promise<SitemapEntry[]> {
  const base = new URL(baseUrl)
  const origin = base.origin

  // 1. Tentar sitemap.xml direto
  const directPaths = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap/sitemap.xml`,
  ]

  for (const sitemapUrl of directPaths) {
    try {
      const entries = await fetchAndParseSitemap(sitemapUrl, timeout)
      if (entries.length > 0) {
        console.log(`[Sitemap] Encontrado sitemap em ${sitemapUrl}: ${entries.length} URLs`)
        return entries
      }
    } catch {
      // Tentar próximo
    }
  }

  // 2. Tentar via robots.txt
  try {
    const robotsSitemaps = await extractSitemapFromRobots(origin, timeout)
    for (const sitemapUrl of robotsSitemaps) {
      try {
        const entries = await fetchAndParseSitemap(sitemapUrl, timeout)
        if (entries.length > 0) {
          console.log(`[Sitemap] Encontrado via robots.txt em ${sitemapUrl}: ${entries.length} URLs`)
          return entries
        }
      } catch {
        continue
      }
    }
  } catch {
    // robots.txt não disponível
  }

  console.log(`[Sitemap] Nenhum sitemap encontrado para ${origin}`)
  return []
}

/**
 * Faz fetch de um sitemap e parseia as URLs
 * Suporta sitemap index (referência a outros sitemaps) — limitado a 1 nível
 */
async function fetchAndParseSitemap(
  sitemapUrl: string,
  timeout: number,
  depth: number = 0
): Promise<SitemapEntry[]> {
  if (depth > 2) return [] // Evitar recursão infinita

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(sitemapUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'IMPA-CRM-Bot/1.0 (Sitemap Discovery)',
        'Accept': 'application/xml,text/xml,*/*',
      },
    })

    if (!response.ok) return []

    let xml = await response.text()

    // Limpar BOM e whitespace
    xml = xml.replace(/^\uFEFF/, '').trim()

    if (!xml.includes('<urlset') && !xml.includes('<sitemapindex')) {
      return []
    }

    // Sitemap Index — contém referências a outros sitemaps
    if (xml.includes('<sitemapindex')) {
      return await parseSitemapIndex(xml, timeout, depth)
    }

    // Sitemap normal — contém URLs
    return parseSitemapUrlset(xml)
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Parseia sitemap index e busca sub-sitemaps
 */
async function parseSitemapIndex(
  xml: string,
  timeout: number,
  depth: number
): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = []
  const locRegex = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi
  let match

  const sitemapUrls: string[] = []
  // Extrair blocos <sitemap>
  const sitemapBlockRegex = /<sitemap>([\s\S]*?)<\/sitemap>/gi
  let blockMatch

  while ((blockMatch = sitemapBlockRegex.exec(xml)) !== null) {
    const block = blockMatch[1]
    const locMatch = /<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(block)
    if (locMatch) {
      sitemapUrls.push(decodeXmlEntities(locMatch[1].trim()))
    }
  }

  // Processar sub-sitemaps (limitar a 10 para não ser abusivo)
  const toProcess = sitemapUrls.slice(0, 10)
  for (const url of toProcess) {
    try {
      const subEntries = await fetchAndParseSitemap(url, timeout, depth + 1)
      entries.push(...subEntries)
    } catch {
      continue
    }
  }

  return entries
}

/**
 * Parseia urlset (sitemap padrão com <url> entries)
 */
function parseSitemapUrlset(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = []
  const urlBlockRegex = /<url>([\s\S]*?)<\/url>/gi
  let match

  while ((match = urlBlockRegex.exec(xml)) !== null) {
    const block = match[1]

    const locMatch = /<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(block)
    if (!locMatch) continue

    const url = decodeXmlEntities(locMatch[1].trim())
    if (!url.startsWith('http')) continue

    const entry: SitemapEntry = { url }

    // lastmod
    const lastmodMatch = /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i.exec(block)
    if (lastmodMatch) {
      const date = new Date(lastmodMatch[1].trim())
      if (!isNaN(date.getTime())) {
        entry.lastmod = date
      }
    }

    // changefreq
    const changefreqMatch = /<changefreq>\s*([\s\S]*?)\s*<\/changefreq>/i.exec(block)
    if (changefreqMatch) {
      entry.changefreq = changefreqMatch[1].trim()
    }

    // priority
    const priorityMatch = /<priority>\s*([\s\S]*?)\s*<\/priority>/i.exec(block)
    if (priorityMatch) {
      const prio = parseFloat(priorityMatch[1].trim())
      if (!isNaN(prio)) entry.priority = prio
    }

    entries.push(entry)
  }

  return entries
}

/**
 * Extrai URLs de sitemap a partir do robots.txt
 * Padrão Scrapy: procurar linhas "Sitemap: ..."
 */
async function extractSitemapFromRobots(
  origin: string,
  timeout: number
): Promise<string[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(`${origin}/robots.txt`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'IMPA-CRM-Bot/1.0' },
    })

    if (!response.ok) return []

    const text = await response.text()
    const sitemaps: string[] = []

    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.toLowerCase().startsWith('sitemap:')) {
        const url = trimmed.substring(8).trim()
        if (url.startsWith('http')) {
          sitemaps.push(url)
        }
      }
    }

    return sitemaps
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Decode XML entities (&amp; etc)
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/**
 * Filtra entries do sitemap por lastmod (só URLs modificadas após a data)
 */
export function filterByLastmod(
  entries: SitemapEntry[],
  since: Date
): SitemapEntry[] {
  return entries.filter((e) => {
    if (!e.lastmod) return true // Sem lastmod = incluir por segurança
    return e.lastmod > since
  })
}

/**
 * Gera hash do sitemap (para detectar mudanças entre crawls)
 */
export function generateSitemapHash(entries: SitemapEntry[]): string {
  const crypto = require('crypto') as typeof import('crypto')
  const urls = entries.map((e) => e.url).sort().join('\n')
  return crypto.createHash('md5').update(urls).digest('hex')
}
