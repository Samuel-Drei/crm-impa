/**
 * Content Cleaner — Limpeza avançada de HTML para RAG
 * Inspirado no Firecrawl (removeUnwantedElements + htmlToMarkdown)
 * + Crawl4AI (content filtering)
 * 
 * Usa Cheerio para manipulação DOM robusta (em vez de regex frágil)
 * Remove elementos de layout, navegação, ads, modais, etc.
 * Preserva conteúdo semântico e converte para Markdown limpo
 */

import * as cheerio from 'cheerio'

// ============================================
// Seletores de exclusão — inspirado no Firecrawl
// removeUnwantedElements (40+ seletores)
// ============================================

const UNWANTED_SELECTORS = [
  // Navegação e layout
  'nav', 'footer', 'header', 'aside',
  '.nav', '.navbar', '.navigation', '.menu', '.sidebar',
  '.footer', '.header', '.breadcrumb', '.breadcrumbs',
  '#nav', '#navbar', '#navigation', '#menu', '#sidebar',
  '#footer', '#header',

  // Ads e promoções
  '.ad', '.ads', '.advert', '.advertisement', '.banner',
  '.sponsor', '.sponsored', '.promo', '.promotion',
  '[class*="ad-"]', '[class*="ads-"]', '[id*="ad-"]',
  '[data-ad]', '[data-ads]',

  // Popups e modais
  '.modal', '.popup', '.overlay', '.lightbox',
  '.cookie', '.cookie-banner', '.cookie-consent', '.cookies',
  '.gdpr', '.consent',
  '#cookie-banner', '#cookie-consent',

  // Share e social
  '.share', '.social', '.social-share', '.share-buttons',
  '.social-media', '.social-links', '.social-icons',
  '.follow', '.like-button',

  // Widgets e elementos não-conteúdo
  '.widget', '.related', '.related-posts', '.recommended',
  '.comments', '.comment-section', '#comments', '#disqus',
  '.newsletter', '.subscribe', '.subscription',
  '.signup', '.sign-up', '.cta',
  '.search', '.search-form', '#search',
  '.pagination', '.pager',
  '.tags', '.tag-cloud',
  '.author-bio', '.author-box',

  // Elementos técnicos
  'script', 'style', 'noscript', 'iframe', 'object', 'embed',
  'svg', 'canvas', 'video', 'audio',
  'form', 'input', 'select', 'textarea', 'button',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[role="complementary"]', '[role="search"]',
  '[aria-hidden="true"]',

  // Print e skip
  '.print-only', '.screen-reader-only', '.sr-only', '.visually-hidden',
  '.skip-link', '.skip-nav',
  '.noprint', '.d-print-none',

  // Misc
  '.back-to-top', '.scroll-to-top',
  '.loading', '.spinner', '.skeleton',
  '.toast', '.notification', '.alert:not(.alert-info)',
  '.toolbar', '.action-bar',
]

/**
 * Limpa HTML removendo elementos indesejados e converte para Markdown
 * Pipeline: HTML → remove lixo → extract content → markdown
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html.trim().length === 0) return ''

  const $ = cheerio.load(html)

  // 1. Remover todos os elementos indesejados
  removeUnwantedElements($)

  // 2. Remover elementos ocultos via CSS inline
  removeHiddenElements($)

  // 3. Extrair e converter o conteúdo principal
  const markdown = convertToMarkdown($)

  // 4. Normalizar whitespace
  return normalizeWhitespace(markdown)
}

/**
 * Extrai apenas texto limpo do HTML (sem formatação markdown)
 * Útil para comparação/hashing
 */
export function htmlToPlainText(html: string): string {
  if (!html || html.trim().length === 0) return ''

  const $ = cheerio.load(html)
  removeUnwantedElements($)
  removeHiddenElements($)

  return normalizeWhitespace($('body').text() || $.root().text())
}

/**
 * Remove elementos indesejados do DOM
 */
function removeUnwantedElements($: cheerio.CheerioAPI): void {
  for (const selector of UNWANTED_SELECTORS) {
    try {
      $(selector).remove()
    } catch {
      // Seletor inválido, ignorar
    }
  }

  // Remover comentários HTML
  $('*').contents().filter(function () {
    return this.type === 'comment'
  }).remove()

  // Remover tags vazias (exceto br, img, hr)
  $('div, span, p, section, article').filter(function () {
    return $(this).text().trim() === '' && $(this).find('img').length === 0
  }).remove()
}

/**
 * Remove elementos ocultos via CSS inline
 */
function removeHiddenElements($: cheerio.CheerioAPI): void {
  $('[style]').each(function () {
    const style = $(this).attr('style') || ''
    if (
      style.includes('display:none') ||
      style.includes('display: none') ||
      style.includes('visibility:hidden') ||
      style.includes('visibility: hidden')
    ) {
      $(this).remove()
    }
  })
}

/**
 * Converte DOM limpo para Markdown
 * Inspirado no Firecrawl html-to-markdown + turndown simplificado
 */
function convertToMarkdown($: cheerio.CheerioAPI): string {
  const parts: string[] = []

  // Tentar encontrar conteúdo principal
  const mainContent = $('main, article, [role="main"], .content, .post-content, .entry-content, #content, .article-body').first()
  const root = mainContent.length > 0 ? mainContent : $('body').length > 0 ? $('body') : $.root()

  processNode($, root, parts)

  return parts.join('')
}

/**
 * Processa recursivamente os nós do DOM e gera Markdown
 */
function processNode($: cheerio.CheerioAPI, element: cheerio.Cheerio<any>, parts: string[]): void {
  element.contents().each(function () {
    const node = $(this)

    if (this.type === 'text') {
      const text = node.text()
      if (text.trim()) {
        parts.push(text)
      }
      return
    }

    if (this.type !== 'tag') return

    const tagName = (this as any).tagName?.toLowerCase()

    switch (tagName) {
      case 'h1':
        parts.push(`\n\n# ${getInlineText($, node)}\n\n`)
        break
      case 'h2':
        parts.push(`\n\n## ${getInlineText($, node)}\n\n`)
        break
      case 'h3':
        parts.push(`\n\n### ${getInlineText($, node)}\n\n`)
        break
      case 'h4':
        parts.push(`\n\n#### ${getInlineText($, node)}\n\n`)
        break
      case 'h5':
        parts.push(`\n\n##### ${getInlineText($, node)}\n\n`)
        break
      case 'h6':
        parts.push(`\n\n###### ${getInlineText($, node)}\n\n`)
        break

      case 'p':
        parts.push('\n\n')
        processNode($, node, parts)
        parts.push('\n\n')
        break

      case 'br':
        parts.push('\n')
        break

      case 'hr':
        parts.push('\n\n---\n\n')
        break

      case 'strong':
      case 'b':
        parts.push(`**${getInlineText($, node)}**`)
        break

      case 'em':
      case 'i':
        parts.push(`*${getInlineText($, node)}*`)
        break

      case 'code': {
        const text = node.text()
        if (text.includes('\n')) {
          parts.push(`\n\`\`\`\n${text}\n\`\`\`\n`)
        } else {
          parts.push(`\`${text}\``)
        }
        break
      }

      case 'pre': {
        const codeElement = node.find('code')
        const codeText = codeElement.length > 0 ? codeElement.text() : node.text()
        const lang = codeElement.attr('class')?.match(/language-(\w+)/)?.[1] || ''
        parts.push(`\n\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`)
        break
      }

      case 'a': {
        const href = node.attr('href')
        const text = getInlineText($, node)
        if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
          parts.push(`[${text}](${href})`)
        } else if (text) {
          parts.push(text)
        }
        break
      }

      case 'img': {
        const alt = node.attr('alt') || ''
        const src = node.attr('src') || ''
        if (alt) {
          parts.push(`[Imagem: ${alt}]`)
        } else if (src) {
          parts.push(`[Imagem]`)
        }
        break
      }

      case 'ul':
      case 'ol':
        parts.push('\n')
        node.children('li').each(function (i) {
          const prefix = tagName === 'ol' ? `${i + 1}. ` : '- '
          parts.push(`\n${prefix}${getInlineText($, $(this))}`)
        })
        parts.push('\n\n')
        break

      case 'li':
        // Handled by ul/ol
        break

      case 'blockquote':
        parts.push('\n\n')
        const bqText = getInlineText($, node)
        bqText.split('\n').forEach((line) => {
          parts.push(`> ${line}\n`)
        })
        parts.push('\n')
        break

      case 'table':
        parts.push('\n\n')
        convertTable($, node, parts)
        parts.push('\n\n')
        break

      case 'dl':
        node.children().each(function () {
          const child = $(this)
          const childTag = (this as any).tagName?.toLowerCase()
          if (childTag === 'dt') {
            parts.push(`\n**${getInlineText($, child)}**\n`)
          } else if (childTag === 'dd') {
            parts.push(`: ${getInlineText($, child)}\n`)
          }
        })
        break

      default: {
        // Elementos de bloco = separar com newlines
        // Elementos inline = separar com espaços
        const BLOCK_ELEMENTS = new Set([
          'div', 'section', 'article', 'main', 'figure', 'figcaption',
          'details', 'summary', 'address', 'fieldset', 'legend',
          'hgroup', 'header', 'footer', 'nav', 'aside', 'dd', 'dt',
        ])

        if (BLOCK_ELEMENTS.has(tagName)) {
          parts.push('\n')
          processNode($, node, parts)
          parts.push('\n')
        } else {
          // Inline: span, label, time, abbr, etc — add space boundary
          parts.push(' ')
          processNode($, node, parts)
          parts.push(' ')
        }
        break
      }
    }
  })
}

/**
 * Extrai texto inline de um nó — preserva espaçamento entre filhos
 * Fix: node.text() do Cheerio concatena sem espaços entre tags irmãs
 * Agora insere espaço na fronteira de cada elemento filho
 */
function getInlineText($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>): string {
  let text = ''
  node.contents().each(function () {
    if (this.type === 'text') {
      text += $(this).text()
    } else if (this.type === 'tag') {
      const childText = getInlineText($, $(this))
      if (childText.trim()) {
        // Insere espaço na fronteira entre o texto anterior e o texto deste elemento
        if (text.length > 0 && !text.endsWith(' ') && !text.endsWith('\n')) {
          text += ' '
        }
        text += childText + ' '
      }
    }
  })
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Converte tabela HTML para Markdown
 */
function convertTable($: cheerio.CheerioAPI, table: cheerio.Cheerio<any>, parts: string[]): void {
  const rows: string[][] = []

  table.find('tr').each(function () {
    const cells: string[] = []
    $(this).find('th, td').each(function () {
      cells.push(getInlineText($, $(this)))
    })
    if (cells.length > 0) rows.push(cells)
  })

  if (rows.length === 0) return

  // Normalizar colunas
  const maxCols = Math.max(...rows.map((r) => r.length))
  const normalized = rows.map((r) => {
    while (r.length < maxCols) r.push('')
    return r
  })

  // Header
  parts.push('| ' + normalized[0].join(' | ') + ' |\n')
  parts.push('| ' + normalized[0].map(() => '---').join(' | ') + ' |\n')

  // Body
  for (let i = 1; i < normalized.length; i++) {
    parts.push('| ' + normalized[i].join(' | ') + ' |\n')
  }
}

/**
 * Normaliza whitespace do markdown final
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')          // Colapsar espaços múltiplos
    .replace(/ \n/g, '\n')           // Espaço antes de newline
    .replace(/\n /g, '\n')           // Espaço depois de newline
    .replace(/\n{4,}/g, '\n\n\n')   // Max 2 linhas em branco
    .replace(/^\s+/, '')             // Trim start
    .replace(/\s+$/, '')             // Trim end
}

/**
 * Detecta o idioma do documento via tag <html lang="">
 */
export function detectLanguage(html: string): string {
  const $ = cheerio.load(html)
  return $('html').attr('lang') || $('html').attr('xml:lang') || 'pt-BR'
}

/**
 * Extrai canonical URL do documento
 */
export function extractCanonicalUrl(html: string, pageUrl: string): string {
  const $ = cheerio.load(html)
  const canonical = $('link[rel="canonical"]').attr('href')

  if (canonical) {
    try {
      // Pode ser relativo
      return new URL(canonical, pageUrl).href
    } catch {
      return pageUrl
    }
  }

  // Fallback: og:url
  const ogUrl = $('meta[property="og:url"]').attr('content')
  if (ogUrl) {
    try {
      return new URL(ogUrl, pageUrl).href
    } catch {
      return pageUrl
    }
  }

  return pageUrl
}

/**
 * Extrai título do documento (hierarquia: og:title > title > h1)
 */
export function extractTitle(html: string): string {
  const $ = cheerio.load(html)

  const ogTitle = $('meta[property="og:title"]').attr('content')
  if (ogTitle?.trim()) return ogTitle.trim()

  const title = $('title').text()
  if (title?.trim()) return title.trim()

  const h1 = $('h1').first().text()
  if (h1?.trim()) return h1.trim()

  return ''
}

/**
 * Extrai meta description
 */
export function extractMetaDescription(html: string): string {
  const $ = cheerio.load(html)

  const ogDesc = $('meta[property="og:description"]').attr('content')
  if (ogDesc?.trim()) return ogDesc.trim()

  const desc = $('meta[name="description"]').attr('content')
  if (desc?.trim()) return desc.trim()

  return ''
}

/**
 * Extrai data de publicação (artigos, blog posts)
 */
export function extractPublishedDate(html: string): Date | null {
  const $ = cheerio.load(html)

  // Schema.org
  const datePublished = $('meta[property="article:published_time"]').attr('content')
    || $('[itemprop="datePublished"]').attr('content')
    || $('time[datetime]').first().attr('datetime')

  if (datePublished) {
    const date = new Date(datePublished)
    if (!isNaN(date.getTime())) return date
  }

  return null
}
