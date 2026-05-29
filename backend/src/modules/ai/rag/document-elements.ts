/**
 * Document Elements — Representação intermediária tipada
 * Inspirado no Unstructured (Element types) + Docling (DoclingDocument)
 * 
 * Cada documento é decomposto em elementos tipados ANTES de chunkar.
 * Isso permite chunking consciente da estrutura (heading-aware).
 */

// ============================================
// TYPES
// ============================================

export type ElementType =
  | 'title'
  | 'heading'
  | 'paragraph'
  | 'list_item'
  | 'table'
  | 'code'
  | 'page_break'
  | 'image_description'

export interface DocumentElement {
  type: ElementType
  text: string
  level?: number          // 1-6 para headings
  page?: number           // Número da página (PDFs)
  section?: string        // Heading pai mais próximo
  metadata?: Record<string, unknown>
}

export interface ParsedDocument {
  elements: DocumentElement[]
  title?: string
  pageCount?: number
  wordCount: number
  charCount: number
  language?: string
  parsingMethod: string    // 'docling' | 'mammoth' | 'basic' | etc.
  parseTimeMs: number
}

// ============================================
// ELEMENT PARTITIONER — Converte texto em elementos tipados
// ============================================

/**
 * Particiona texto Markdown em elementos tipados
 * Detecta: headings (#), listas (- *), tabelas (|), code blocks (```)
 */
export function partitionMarkdown(markdown: string): DocumentElement[] {
  const elements: DocumentElement[] = []
  let currentSection: string | undefined
  let inCodeBlock = false
  let codeLines: string[] = []
  let inTable = false
  let tableLines: string[] = []

  const lines = markdown.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Code blocks
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        const codeText = codeLines.join('\n')
        if (codeText.trim()) {
          elements.push({ type: 'code', text: codeText, section: currentSection })
        }
        codeLines = []
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      continue
    }
    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    // Tables
    if (trimmed.includes('|') && trimmed.startsWith('|')) {
      if (!inTable) {
        inTable = true
        tableLines = []
      }
      tableLines.push(trimmed)
      continue
    } else if (inTable) {
      elements.push({ type: 'table', text: tableLines.join('\n'), section: currentSection })
      tableLines = []
      inTable = false
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = headingMatch[2].trim()
      elements.push({ type: 'heading', text, level, section: currentSection })
      currentSection = text
      continue
    }

    // List items
    if (/^[-*+]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed)) {
      const text = trimmed.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '')
      elements.push({ type: 'list_item', text, section: currentSection })
      continue
    }

    // Normal paragraph
    if (trimmed.length > 0) {
      elements.push({ type: 'paragraph', text: trimmed, section: currentSection })
    }
  }

  // Flush remaining
  if (inTable && tableLines.length > 0) {
    elements.push({ type: 'table', text: tableLines.join('\n'), section: currentSection })
  }
  if (inCodeBlock && codeLines.length > 0) {
    elements.push({ type: 'code', text: codeLines.join('\n'), section: currentSection })
  }

  return elements
}

/**
 * Particiona texto puro com heurísticas de heading
 * Útil para PDFs onde não há marcação explícita
 */
export function partitionPlainText(text: string): DocumentElement[] {
  const elements: DocumentElement[] = []
  let currentSection: string | undefined

  const paragraphs = text.split(/\n{2,}/)

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue

    // Heurísticas para heading em texto puro:
    const isHeading = detectHeading(trimmed)
    if (isHeading) {
      elements.push({
        type: 'heading',
        text: trimmed,
        level: isHeading.level,
        section: currentSection,
      })
      currentSection = trimmed
    } else {
      elements.push({ type: 'paragraph', text: trimmed, section: currentSection })
    }
  }

  return elements
}

/**
 * Detecta se uma linha é um heading usando heurísticas
 * Retorna null se não for heading, ou {level} se for
 */
function detectHeading(line: string): { level: number } | null {
  // Linha muito longa não é heading
  if (line.length > 120) return null
  // Linha com pontuação final geralmente não é heading
  if (/[.;,!?]$/.test(line)) return null

  // 1. ALL CAPS (ex: "CAPÍTULO 1 - INTRODUÇÃO")
  if (line === line.toUpperCase() && line.length > 3 && /[A-ZÀ-Ú]/.test(line)) {
    return { level: 1 }
  }

  // 2. Numeração explícita (1., 1.1, 1.1.1, Capítulo, Seção)
  if (/^(\d+\.)+\s/.test(line) || /^\d+\s*[-–—]\s/.test(line)) {
    const dots = (line.match(/\./g) || []).length
    return { level: Math.min(dots + 1, 4) }
  }
  if (/^(capítulo|capitulo|seção|secao|parte|anexo)\s/i.test(line)) {
    return { level: 1 }
  }

  // 3. Linha curta (<60 chars), começa com maiúscula, sem pontuação final
  if (line.length <= 60 && /^[A-ZÀ-Ú]/.test(line)) {
    return { level: 2 }
  }

  return null
}

// ============================================
// ELEMENT UTILITIES
// ============================================

/**
 * Converte elementos de volta para Markdown (para indexação)
 */
export function elementsToMarkdown(elements: DocumentElement[]): string {
  const parts: string[] = []

  for (const el of elements) {
    switch (el.type) {
      case 'title':
      case 'heading': {
        const prefix = '#'.repeat(el.level || 1)
        parts.push(`${prefix} ${el.text}`)
        break
      }
      case 'paragraph':
        parts.push(el.text)
        break
      case 'list_item':
        parts.push(`- ${el.text}`)
        break
      case 'table':
        parts.push(el.text)
        break
      case 'code':
        parts.push(`\`\`\`\n${el.text}\n\`\`\``)
        break
      case 'image_description':
        parts.push(`[Imagem: ${el.text}]`)
        break
      default:
        if (el.text) parts.push(el.text)
    }
  }

  return parts.join('\n\n')
}

/**
 * Agrupa elementos por seção (heading como chave)
 * Retorna seções que podem ser convertidas em chunks
 */
export function groupBySection(elements: DocumentElement[]): DocumentSection[] {
  const sections: DocumentSection[] = []
  let currentHeading: string | undefined
  let currentLevel: number | undefined
  let currentPage: number | undefined
  let currentElements: DocumentElement[] = []

  for (const el of elements) {
    if (el.type === 'heading' || el.type === 'title') {
      // Salvar seção anterior
      if (currentElements.length > 0) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          page: currentPage,
          elements: currentElements,
          text: elementsToMarkdown(currentElements),
        })
      }

      currentHeading = el.text
      currentLevel = el.level
      currentPage = el.page
      currentElements = [el]
    } else {
      currentElements.push(el)
      if (el.page && !currentPage) currentPage = el.page
    }
  }

  // Última seção
  if (currentElements.length > 0) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      page: currentPage,
      elements: currentElements,
      text: elementsToMarkdown(currentElements),
    })
  }

  return sections
}

export interface DocumentSection {
  heading?: string
  level?: number
  page?: number
  elements: DocumentElement[]
  text: string
}

/**
 * Converte resposta do Docling microservice para DocumentElements nativos
 */
export function fromDoclingResponse(response: DoclingParseResponse): ParsedDocument {
  const elements: DocumentElement[] = response.elements.map((el) => ({
    type: mapDoclingElementType(el.type),
    text: el.text,
    level: el.level ?? undefined,
    page: el.page ?? undefined,
    section: el.section ?? undefined,
    metadata: el.metadata ?? undefined,
  }))

  return {
    elements,
    title: response.title ?? undefined,
    pageCount: response.page_count ?? undefined,
    wordCount: response.word_count,
    charCount: response.char_count,
    parsingMethod: response.parsing_method,
    parseTimeMs: response.parse_time_ms,
  }
}

function mapDoclingElementType(type: string): ElementType {
  const map: Record<string, ElementType> = {
    title: 'title',
    heading: 'heading',
    paragraph: 'paragraph',
    list_item: 'list_item',
    table: 'table',
    code: 'code',
    page_break: 'page_break',
    image_description: 'image_description',
    header: 'paragraph',
    footer: 'paragraph',
  }
  return map[type] || 'paragraph'
}

// ============================================
// DOCLING SERVICE RESPONSE TYPE
// ============================================

export interface DoclingParseResponse {
  success: boolean
  filename: string
  format: string
  elements: Array<{
    type: string
    text: string
    level?: number | null
    page?: number | null
    section?: string | null
    metadata?: Record<string, unknown> | null
  }>
  page_count?: number | null
  word_count: number
  char_count: number
  title?: string | null
  language?: string | null
  parsing_method: string
  parse_time_ms: number
  error?: string | null
}
