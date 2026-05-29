/**
 * Document Parser — Parsing multi-formato de documentos para RAG
 * 
 * Estratégia modular:
 *   1. Se Docling microservice está disponível → usa Docling (melhor para PDF/DOCX/HTML)
 *   2. Se não → parsers locais nativos (mammoth para DOCX, pdf-parse para PDF, cheerio para HTML)
 *   3. Fallback → texto puro com heurísticas de heading
 * 
 * Inspirado em:
 *   - Docling (representação intermediária rica)
 *   - Unstructured (elementos tipados)
 *   - Dify (extractors por tipo de arquivo)
 */

import { htmlToMarkdown } from './content-cleaner.js'
import {
  type DocumentElement,
  type ParsedDocument,
  type DoclingParseResponse,
  fromDoclingResponse,
  partitionMarkdown,
  partitionPlainText,
} from './document-elements.js'

// ============================================
// CONFIG
// ============================================

const DOCLING_URL = process.env.DOCLING_SERVICE_URL || 'http://docling:8000'
let doclingAvailable: boolean | null = null // Cache do health check

/**
 * Verifica se o microservice Docling está disponível (com cache de 60s)
 */
let lastHealthCheck = 0
async function isDoclingAvailable(): Promise<boolean> {
  const now = Date.now()
  if (doclingAvailable !== null && now - lastHealthCheck < 60_000) {
    return doclingAvailable
  }
  try {
    const resp = await fetch(`${DOCLING_URL}/health`, { signal: AbortSignal.timeout(3000) })
    const data = await resp.json() as { status: string; docling_available: boolean }
    doclingAvailable = data.status === 'ok' && data.docling_available
    lastHealthCheck = now
    console.log(`[DocumentParser] Docling service: ${doclingAvailable ? 'disponível' : 'indisponível (sem docling lib)'}`)
    return doclingAvailable
  } catch {
    doclingAvailable = false
    lastHealthCheck = now
    console.log('[DocumentParser] Docling service: offline — usando parsers locais')
    return false
  }
}

// ============================================
// MAIN PARSER
// ============================================

export interface ParseOptions {
  forceLocal?: boolean      // Forçar parsers locais (ignorar Docling)
  forceDocling?: boolean    // Forçar Docling (erro se indisponível)
}

/**
 * Parse de documento — ponto de entrada principal
 * Retorna ParsedDocument com elementos tipados + metadata
 */
export async function parseDocument(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  options: ParseOptions = {}
): Promise<ParsedDocument> {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const start = Date.now()

  // Formatos que se beneficiam do Docling (OCR, layout, tabelas)
  const doclingFormats = ['pdf', 'docx', 'doc', 'pptx', 'xlsx', 'xls', 'html', 'htm']
  const shouldTryDocling = doclingFormats.includes(ext) && !options.forceLocal

  // 1. Tentar Docling microservice
  if (shouldTryDocling || options.forceDocling) {
    const available = await isDoclingAvailable()
    if (available) {
      try {
        const result = await parseWithDocling(buffer, filename)
        if (result.elements.length > 0) {
          console.log(`[DocumentParser] ${filename}: Docling OK — ${result.elements.length} elements em ${result.parseTimeMs}ms`)
          return result
        }
        console.log(`[DocumentParser] ${filename}: Docling retornou 0 elements — usando fallback local`)
      } catch (err) {
        console.warn(`[DocumentParser] ${filename}: Docling falhou — usando fallback local:`, (err as Error).message)
      }
    }
    if (options.forceDocling) {
      throw new Error('Docling microservice não disponível e forceDocling=true')
    }
  }

  // 2. Parsers locais nativos
  try {
    const result = await parseLocal(buffer, filename, ext, mimeType)
    console.log(`[DocumentParser] ${filename}: Parser local (${result.parsingMethod}) — ${result.elements.length} elements em ${result.parseTimeMs}ms`)
    return result
  } catch (err) {
    console.error(`[DocumentParser] ${filename}: Todos os parsers falharam:`, err)
    // 3. Último fallback — tratar como texto
    return parsePlainText(buffer, filename)
  }
}

// ============================================
// DOCLING PARSER (via microservice)
// ============================================

async function parseWithDocling(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  const formData = new FormData()
  const blob = new Blob([buffer])
  formData.append('file', blob, filename)

  const resp = await fetch(`${DOCLING_URL}/parse`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(120_000), // PDFs grandes podem levar até 2min
  })

  if (!resp.ok) {
    const error = await resp.text()
    throw new Error(`Docling HTTP ${resp.status}: ${error}`)
  }

  const data = await resp.json() as DoclingParseResponse

  if (!data.success) {
    throw new Error(`Docling parse failed: ${data.error}`)
  }

  return fromDoclingResponse(data)
}

// ============================================
// PARSERS LOCAIS
// ============================================

async function parseLocal(
  buffer: Buffer,
  filename: string,
  ext: string,
  mimeType: string
): Promise<ParsedDocument> {
  switch (ext) {
    case 'pdf':
      return parsePdfLocal(buffer, filename)
    case 'docx':
    case 'doc':
      return parseDocxLocal(buffer, filename)
    case 'xlsx':
    case 'xls':
      return parseXlsxLocal(buffer, filename)
    case 'html':
    case 'htm':
      return parseHtmlLocal(buffer, filename)
    case 'md':
      return parseMarkdownLocal(buffer, filename)
    case 'csv':
      return parseCsvLocal(buffer, filename)
    case 'json':
      return parseJsonLocal(buffer, filename)
    case 'txt':
    default:
      return parsePlainText(buffer, filename)
  }
}

/**
 * PDF local — usa pdf-parse com heurísticas de heading
 */
async function parsePdfLocal(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  const start = Date.now()

  try {
    const pdfParse = (await import('pdf-parse')).default
    const data = await pdfParse(buffer)

    // pdf-parse retorna texto por página quando acessamos pages
    // Infelizmente a lib não expõe páginas individuais facilmente
    // Usar heurísticas para detectar headings + quebras de página
    const elements = partitionPlainText(data.text)

    // Tentar detectar quebras de página (\f = form feed)
    let currentPage = 1
    for (const el of elements) {
      if (el.text.includes('\f')) {
        currentPage++
        el.text = el.text.replace(/\f/g, '')
      }
      el.page = currentPage
    }

    return {
      elements: elements.filter(el => el.text.trim()),
      title: data.info?.Title || undefined,
      pageCount: data.numpages,
      wordCount: data.text.split(/\s+/).filter(Boolean).length,
      charCount: data.text.length,
      parsingMethod: 'pdf-parse',
      parseTimeMs: Date.now() - start,
    }
  } catch {
    return {
      elements: [{ type: 'paragraph', text: `[PDF: ${filename} - extração falhou]` }],
      wordCount: 0,
      charCount: 0,
      parsingMethod: 'pdf-parse-failed',
      parseTimeMs: Date.now() - start,
    }
  }
}

/**
 * DOCX local — usa mammoth para converter para HTML, depois extrai elementos
 */
async function parseDocxLocal(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  const start = Date.now()

  const mammoth = await import('mammoth')
  const result = await mammoth.default.convertToHtml({ buffer })
  const html = result.value

  // Converter HTML para Markdown preservando headings, listas, tabelas
  const markdown = htmlToMarkdown(html)
  const elements = partitionMarkdown(markdown)

  // Extrair título do primeiro heading H1
  const titleEl = elements.find(el => el.type === 'heading' && el.level === 1)

  const fullText = elements.map(e => e.text).join(' ')

  return {
    elements,
    title: titleEl?.text,
    wordCount: fullText.split(/\s+/).filter(Boolean).length,
    charCount: fullText.length,
    parsingMethod: 'mammoth',
    parseTimeMs: Date.now() - start,
  }
}

/**
 * XLSX local — usa xlsx lib para extrair sheets como tabelas
 */
async function parseXlsxLocal(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  const start = Date.now()

  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const elements: DocumentElement[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    // Sheet name como heading
    elements.push({ type: 'heading', text: sheetName, level: 1, section: sheetName })

    // Converter sheet para CSV
    const csv = XLSX.utils.sheet_to_csv(sheet)
    const lines = csv.split('\n').filter((l: string) => l.trim())

    if (lines.length > 0) {
      // Converter para tabela markdown
      const header = lines[0].split(',').map((c: string) => c.trim()).join(' | ')
      const separator = lines[0].split(',').map(() => '---').join(' | ')
      let tableText = `${header}\n${separator}`
      for (let i = 1; i < lines.length; i++) {
        tableText += '\n' + lines[i].split(',').map((c: string) => c.trim()).join(' | ')
      }

      elements.push({ type: 'table', text: tableText, section: sheetName })
    }
  }

  const fullText = elements.map(e => e.text).join(' ')

  return {
    elements,
    wordCount: fullText.split(/\s+/).filter(Boolean).length,
    charCount: fullText.length,
    parsingMethod: 'xlsx',
    parseTimeMs: Date.now() - start,
  }
}

/**
 * HTML local — usa content-cleaner para converter para markdown, depois particiona
 */
function parseHtmlLocal(buffer: Buffer, filename: string): ParsedDocument {
  const start = Date.now()
  const html = buffer.toString('utf-8')
  const markdown = htmlToMarkdown(html)
  const elements = partitionMarkdown(markdown)

  const titleEl = elements.find(el => el.type === 'heading' && el.level === 1)
  const fullText = elements.map(e => e.text).join(' ')

  return {
    elements,
    title: titleEl?.text,
    wordCount: fullText.split(/\s+/).filter(Boolean).length,
    charCount: fullText.length,
    parsingMethod: 'cheerio',
    parseTimeMs: Date.now() - start,
  }
}

/**
 * Markdown local — partição direta
 */
function parseMarkdownLocal(buffer: Buffer, filename: string): ParsedDocument {
  const start = Date.now()
  const text = buffer.toString('utf-8')
  const elements = partitionMarkdown(text)

  const titleEl = elements.find(el => el.type === 'heading' && el.level === 1)
  const fullText = elements.map(e => e.text).join(' ')

  return {
    elements,
    title: titleEl?.text,
    wordCount: fullText.split(/\s+/).filter(Boolean).length,
    charCount: fullText.length,
    parsingMethod: 'markdown',
    parseTimeMs: Date.now() - start,
  }
}

/**
 * CSV local — header + rows como tabela
 */
function parseCsvLocal(buffer: Buffer, filename: string): ParsedDocument {
  const start = Date.now()
  const text = buffer.toString('utf-8')
  const lines = text.split('\n').filter(l => l.trim())
  const elements: DocumentElement[] = []

  if (lines.length > 0) {
    elements.push({ type: 'heading', text: filename.replace(/\.\w+$/, ''), level: 1 })

    const header = lines[0].split(',').map(c => c.trim()).join(' | ')
    const separator = lines[0].split(',').map(() => '---').join(' | ')
    let tableText = `${header}\n${separator}`
    for (let i = 1; i < Math.min(lines.length, 500); i++) { // Limitar a 500 rows
      tableText += '\n' + lines[i].split(',').map(c => c.trim()).join(' | ')
    }
    elements.push({ type: 'table', text: tableText })
  }

  return {
    elements,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    charCount: text.length,
    parsingMethod: 'csv',
    parseTimeMs: Date.now() - start,
  }
}

/**
 * JSON local — formato como code block
 */
function parseJsonLocal(buffer: Buffer, filename: string): ParsedDocument {
  const start = Date.now()
  let text: string
  try {
    const data = JSON.parse(buffer.toString('utf-8'))
    text = JSON.stringify(data, null, 2)
  } catch {
    text = buffer.toString('utf-8')
  }

  return {
    elements: [{ type: 'code', text }],
    wordCount: text.split(/\s+/).filter(Boolean).length,
    charCount: text.length,
    parsingMethod: 'json',
    parseTimeMs: Date.now() - start,
  }
}

/**
 * Texto puro — fallback final
 */
function parsePlainText(buffer: Buffer, filename: string): ParsedDocument {
  const start = Date.now()
  const text = buffer.toString('utf-8')
  const elements = partitionPlainText(text)

  return {
    elements: elements.filter(el => el.text.trim()),
    wordCount: text.split(/\s+/).filter(Boolean).length,
    charCount: text.length,
    parsingMethod: 'plaintext',
    parseTimeMs: Date.now() - start,
  }
}

// ============================================
// EXPORT
// ============================================

export { isDoclingAvailable }
