/**
 * Text Splitter — Chunking de documentos
 * Inspirado no Dify FixedRecursiveCharacterTextSplitter + Firecrawl + Unstructured chunk_by_title
 * 
 * Estratégias:
 *   1. splitText() — recursive character splitter (padrão genérico)
 *   2. splitByHeadings() — heading-aware chunking (para documentos com estrutura)
 *   3. splitElements() — chunking baseado em elementos tipados (melhor qualidade)
 * 
 * A conversão HTML→Markdown agora é feita pelo content-cleaner.ts
 */

import { htmlToMarkdown, htmlToPlainText } from './content-cleaner.js'
import { type DocumentElement, type DocumentSection, groupBySection, elementsToMarkdown } from './document-elements.js'

export interface ChunkResult {
  content: string
  index: number
  tokenCount: number
  metadata?: Record<string, unknown>
}

const DEFAULT_SEPARATORS = ['\n\n', '\n', '。', '. ', ', ', ' ', '']

/**
 * Recursive Character Text Splitter (padrão Dify/LangChain)
 */
export function splitText(
  text: string,
  options: {
    chunkSize?: number
    chunkOverlap?: number
    separators?: string[]
  } = {}
): ChunkResult[] {
  const {
    chunkSize = 500,
    chunkOverlap = 50,
    separators = DEFAULT_SEPARATORS,
  } = options

  if (!text || text.trim().length === 0) return []

  const rawChunks = recursiveSplit(text, separators, chunkSize)
  const mergedChunks = mergeWithOverlap(rawChunks, chunkSize, chunkOverlap)

  return mergedChunks.map((content, index) => ({
    content: content.trim(),
    index,
    tokenCount: Math.ceil(content.length / 4), // ~4 chars per token
  })).filter((c) => c.content.length > 10) // Ignorar chunks muito pequenos
}

/**
 * Split recursivo — tenta cada separador até que chunks fiquem menores que chunkSize
 */
function recursiveSplit(
  text: string,
  separators: string[],
  chunkSize: number
): string[] {
  if (text.length <= chunkSize) return [text]
  if (separators.length === 0) {
    // Fallback: dividir por caractere
    const chunks: string[] = []
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize))
    }
    return chunks
  }

  const separator = separators[0]
  const remainingSeparators = separators.slice(1)

  const parts = separator ? text.split(separator) : [text]
  const chunks: string[] = []
  let current = ''

  for (const part of parts) {
    const tentative = current ? current + separator + part : part

    if (tentative.length > chunkSize && current) {
      chunks.push(current)
      // Se a parte individual ainda é maior que chunkSize, recursão
      if (part.length > chunkSize) {
        chunks.push(...recursiveSplit(part, remainingSeparators, chunkSize))
        current = ''
      } else {
        current = part
      }
    } else {
      current = tentative
    }
  }

  if (current) chunks.push(current)
  return chunks
}

/**
 * Merge chunks com overlap (padrão Dify/LangChain)
 * Garante que chunks adjacentes compartilham texto no início/fim
 */
function mergeWithOverlap(
  chunks: string[],
  chunkSize: number,
  chunkOverlap: number
): string[] {
  if (chunks.length <= 1 || chunkOverlap === 0) return chunks

  const result: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      result.push(chunks[i])
    } else {
      // Pega as últimas N chars do chunk anterior como overlap
      const prevChunk = chunks[i - 1]
      const overlapText = prevChunk.slice(-chunkOverlap)
      const merged = overlapText + chunks[i]

      if (merged.length > chunkSize * 1.5) {
        // Se ficou muito grande, não faz overlap
        result.push(chunks[i])
      } else {
        result.push(merged)
      }
    }
  }
  return result
}

/**
 * Limpa HTML e normaliza texto (como Firecrawl markdownize)
 */
export function cleanText(text: string): string {
  return text
    // Remove tags HTML
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    // Decode HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    // Normalizar whitespace
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Extrai texto limpo de HTML — agora usa Cheerio via content-cleaner
 * Mantém assinatura original para não quebrar imports existentes
 */
export function htmlToCleanText(html: string): string {
  // Usar o novo content-cleaner com Cheerio (inspirado Firecrawl)
  const markdown = htmlToMarkdown(html)
  return markdown || cleanText(html) // fallback para cleanText se markdown vazio
}

// ============================================
// HEADING-AWARE CHUNKING (inspirado Unstructured chunk_by_title)
// ============================================

export interface StructuredChunk {
  content: string
  index: number
  tokenCount: number
  sectionTitle?: string
  pageNumber?: number
  elementType?: string   // tipo predominante do chunk
  metadata?: Record<string, unknown>
}

/**
 * Chunking baseado em elementos tipados — respeita headings, tabelas, code blocks
 * Inspirado no Unstructured chunk_by_title + Dify FixedRecursiveCharacterTextSplitter
 * 
 * Algoritmo:
 *   1. Agrupa elementos por seção (heading como delimitador)
 *   2. Se seção cabe no chunkSize → 1 chunk
 *   3. Se seção é maior → subdivide com recursive splitter mas mantém heading como prefixo
 *   4. Tabelas viram chunks próprios (não misturar com texto)
 *   5. Chunks pequenos adjacentes são combinados (combine_under_n_chars)
 */
export function splitElements(
  elements: DocumentElement[],
  options: {
    chunkSize?: number
    chunkOverlap?: number
    combineUnderNChars?: number  // Combinar chunks menores que N chars (Unstructured pattern)
  } = {}
): StructuredChunk[] {
  const {
    chunkSize = 500,
    chunkOverlap = 50,
    combineUnderNChars = 100,
  } = options

  if (elements.length === 0) return []

  const sections = groupBySection(elements)
  const rawChunks: StructuredChunk[] = []

  for (const section of sections) {
    const chunks = chunkSection(section, chunkSize, chunkOverlap)
    rawChunks.push(...chunks)
  }

  // Combinar chunks muito pequenos com o seguinte (Unstructured combine_text_under_n_chars)
  const combined = combineSmallChunks(rawChunks, combineUnderNChars, chunkSize)

  // Reatribuir índices
  return combined.map((c, i) => ({ ...c, index: i }))
}

/**
 * Chunka uma seção individual
 */
function chunkSection(
  section: DocumentSection,
  chunkSize: number,
  chunkOverlap: number,
): StructuredChunk[] {
  const chunks: StructuredChunk[] = []
  const headingPrefix = section.heading && section.level
    ? '#'.repeat(section.level) + ' ' + section.heading + '\n\n'
    : ''

  // Separar tabelas e code blocks (chunks isolados) do texto corrido
  const textElements: DocumentElement[] = []

  for (const el of section.elements) {
    if (el.type === 'table') {
      // Flush texto acumulado
      if (textElements.length > 0) {
        chunks.push(...chunkTextElements(textElements, headingPrefix, section, chunkSize, chunkOverlap))
        textElements.length = 0
      }
      // Tabela como chunk próprio
      const tableContent = headingPrefix + el.text
      if (tableContent.length <= chunkSize * 1.5) {
        chunks.push({
          content: tableContent,
          index: 0,
          tokenCount: Math.ceil(tableContent.length / 4),
          sectionTitle: section.heading,
          pageNumber: el.page || section.page,
          elementType: 'table',
        })
      } else {
        // Tabela grande: dividir por linhas mantendo header (Unstructured repeat_table_headers)
        chunks.push(...splitLargeTable(el.text, headingPrefix, section, chunkSize))
      }
    } else if (el.type === 'code') {
      // Flush texto acumulado
      if (textElements.length > 0) {
        chunks.push(...chunkTextElements(textElements, headingPrefix, section, chunkSize, chunkOverlap))
        textElements.length = 0
      }
      const codeContent = headingPrefix + '```\n' + el.text + '\n```'
      chunks.push({
        content: codeContent,
        index: 0,
        tokenCount: Math.ceil(codeContent.length / 4),
        sectionTitle: section.heading,
        pageNumber: el.page || section.page,
        elementType: 'code',
      })
    } else {
      textElements.push(el)
    }
  }

  // Flush restante
  if (textElements.length > 0) {
    chunks.push(...chunkTextElements(textElements, headingPrefix, section, chunkSize, chunkOverlap))
  }

  return chunks
}

/**
 * Chunk elementos de texto (parágrafos, listas, headings)
 */
function chunkTextElements(
  elements: DocumentElement[],
  headingPrefix: string,
  section: DocumentSection,
  chunkSize: number,
  chunkOverlap: number,
): StructuredChunk[] {
  const text = elementsToMarkdown(elements)
  const fullText = headingPrefix + text

  if (fullText.length <= chunkSize) {
    return [{
      content: fullText,
      index: 0,
      tokenCount: Math.ceil(fullText.length / 4),
      sectionTitle: section.heading,
      pageNumber: elements.find(e => e.page)?.page || section.page,
      elementType: detectPredominantType(elements),
    }]
  }

  // Texto maior que chunkSize: usar recursive splitter mas manter heading como prefixo
  const rawChunks = splitText(text, { chunkSize: chunkSize - headingPrefix.length, chunkOverlap })

  return rawChunks.map(c => ({
    content: headingPrefix + c.content,
    index: c.index,
    tokenCount: Math.ceil((headingPrefix + c.content).length / 4),
    sectionTitle: section.heading,
    pageNumber: elements.find(e => e.page)?.page || section.page,
    elementType: detectPredominantType(elements),
  }))
}

/**
 * Divide tabela grande mantendo header repetido (Unstructured repeat_table_headers)
 */
function splitLargeTable(
  tableText: string,
  headingPrefix: string,
  section: DocumentSection,
  chunkSize: number,
): StructuredChunk[] {
  const lines = tableText.split('\n')
  if (lines.length < 3) {
    return [{
      content: headingPrefix + tableText,
      index: 0,
      tokenCount: Math.ceil((headingPrefix + tableText).length / 4),
      sectionTitle: section.heading,
      pageNumber: section.page,
      elementType: 'table',
    }]
  }

  // Header = primeiras 2 linhas (header + separator)
  const headerLines = lines.slice(0, 2).join('\n')
  const dataLines = lines.slice(2)

  const chunks: StructuredChunk[] = []
  let currentLines: string[] = []
  let currentSize = headingPrefix.length + headerLines.length + 2

  for (const line of dataLines) {
    if (currentSize + line.length + 1 > chunkSize && currentLines.length > 0) {
      // Flush
      const content = headingPrefix + headerLines + '\n' + currentLines.join('\n')
      chunks.push({
        content,
        index: 0,
        tokenCount: Math.ceil(content.length / 4),
        sectionTitle: section.heading,
        pageNumber: section.page,
        elementType: 'table',
      })
      currentLines = []
      currentSize = headingPrefix.length + headerLines.length + 2
    }
    currentLines.push(line)
    currentSize += line.length + 1
  }

  // Último chunk
  if (currentLines.length > 0) {
    const content = headingPrefix + headerLines + '\n' + currentLines.join('\n')
    chunks.push({
      content,
      index: 0,
      tokenCount: Math.ceil(content.length / 4),
      sectionTitle: section.heading,
      pageNumber: section.page,
      elementType: 'table',
    })
  }

  return chunks
}

/**
 * Combina chunks adjacentes que são menores que N chars (Unstructured combine_text_under_n_chars)
 */
function combineSmallChunks(
  chunks: StructuredChunk[],
  minChars: number,
  maxChars: number,
): StructuredChunk[] {
  if (chunks.length <= 1) return chunks

  const result: StructuredChunk[] = []
  let buffer: StructuredChunk | null = null

  for (const chunk of chunks) {
    if (!buffer) {
      buffer = chunk
      continue
    }

    // Se o buffer é pequeno, tentar combinar
    if (buffer.content.length < minChars) {
      const combined: string = buffer.content + '\n\n' + chunk.content
      if (combined.length <= maxChars) {
        buffer = {
          ...buffer,
          content: combined,
          tokenCount: Math.ceil(combined.length / 4),
        }
        continue
      }
    }

    result.push(buffer)
    buffer = chunk
  }

  if (buffer) result.push(buffer)
  return result
}

function detectPredominantType(elements: DocumentElement[]): string {
  const counts: Record<string, number> = {}
  for (const el of elements) {
    counts[el.type] = (counts[el.type] || 0) + 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'paragraph'
}
