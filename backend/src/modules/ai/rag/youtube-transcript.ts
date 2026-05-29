/**
 * YouTube Transcript Service
 * 
 * Baseado na arquitetura do youtube-transcript-api (Python)
 * Reimplementado em TypeScript para o contexto do CRM
 * 
 * Fluxo:
 * 1. Extrai videoId da URL
 * 2. Fetch da página do YouTube + InnerTube API para obter captions
 * 3. Prioriza transcript manual no idioma desejado
 * 4. Fallback para transcript automática (ASR)
 * 5. Fallback para tradução se nenhum transcript no idioma
 * 6. Parse do XML das captions com timestamps (start, duration)
 * 7. Normaliza e segmenta por blocos de tempo
 * 8. Retorna trechos com timestamps para chunking
 * 
 * Preparado para fallback futuro com ASR (yt-dlp + whisper)
 */

import * as cheerio from 'cheerio'
import { ProxyAgent, type Dispatcher } from 'undici'
import { spawn } from 'node:child_process'
import { prisma } from '../../../config/database.js'
import * as fsSync from 'node:fs'
import * as pathSync from 'node:path'

// ============================================
// CONFIGURAÇÃO DINÂMICA (banco + fallback env)
// Lê de SystemSetting (campos separados, montados pelo backend):
//   - youtube.proxyHost      → ip ou hostname
//   - youtube.proxyPort      → porta
//   - youtube.proxyUser      → usuário (opcional)
//   - youtube.proxyPassword  → senha (opcional)
//   - youtube.proxyProtocol  → http|https|socks5 (default: http)
//   - youtube.proxyUrl       → URL completa (LEGADO; só usada se host/port vazios)
//   - youtube.cookies        → conteúdo Netscape do cookies.txt (texto inteiro)
// Fallback para env vars: YT_PROXY_URL, YT_COOKIES_FILE
// Cache de 30s para evitar query a cada vídeo.
// ============================================

interface YouTubeConfig {
  proxyUrl: string
  cookiesFile: string
  dispatcher: Dispatcher | undefined
}

const CONFIG_CACHE_MS = 30_000
let cachedConfig: { data: YouTubeConfig; expires: number } | null = null
const dispatcherByUrl = new Map<string, Dispatcher>()
let cookiesFileWritten: { content: string; path: string } | null = null
const COOKIES_DIR = process.env.YT_COOKIES_DIR || '/app/uploads'
const COOKIES_DB_PATH = pathSync.join(COOKIES_DIR, 'yt-cookies-db.txt')

function getDispatcher(url: string): Dispatcher | undefined {
  if (!url) return undefined
  let d = dispatcherByUrl.get(url)
  if (!d) {
    try { d = new ProxyAgent(url); dispatcherByUrl.set(url, d) } catch { return undefined }
  }
  return d
}

async function getYouTubeConfig(): Promise<YouTubeConfig> {
  const now = Date.now()
  if (cachedConfig && cachedConfig.expires > now) return cachedConfig.data

  let proxyUrl = ''
  let cookiesFile = ''
  try {
    const settings = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            'youtube.proxyHost',
            'youtube.proxyPort',
            'youtube.proxyUser',
            'youtube.proxyPassword',
            'youtube.proxyProtocol',
            'youtube.proxyUrl',
            'youtube.cookies',
          ],
        },
      },
    })
    const map: Record<string, string> = {}
    for (const s of settings) map[s.key] = s.value

    // Monta URL a partir de campos separados (preferencial)
    const host = (map['youtube.proxyHost'] || '').trim()
    const port = (map['youtube.proxyPort'] || '').trim()
    if (host && port) {
      const protocol = (map['youtube.proxyProtocol'] || 'http').trim().toLowerCase() || 'http'
      const user = (map['youtube.proxyUser'] || '').trim()
      const pass = (map['youtube.proxyPassword'] || '').trim()
      const auth = user
        ? `${encodeURIComponent(user)}${pass ? ':' + encodeURIComponent(pass) : ''}@`
        : ''
      proxyUrl = `${protocol}://${auth}${host}:${port}`
    } else {
      // Fallback legado: campo único
      proxyUrl = (map['youtube.proxyUrl'] || '').trim()
    }

    const cookiesContent = (map['youtube.cookies'] || '').trim()
    if (cookiesContent) {
      // Persiste em arquivo se mudou
      if (!cookiesFileWritten || cookiesFileWritten.content !== cookiesContent) {
        try {
          fsSync.mkdirSync(COOKIES_DIR, { recursive: true })
          fsSync.writeFileSync(COOKIES_DB_PATH, cookiesContent, { encoding: 'utf8', mode: 0o600 })
          cookiesFileWritten = { content: cookiesContent, path: COOKIES_DB_PATH }
        } catch (err: any) {
          console.warn(`[YouTube] Falha ao salvar cookies em ${COOKIES_DB_PATH}: ${err?.message}`)
        }
      }
      cookiesFile = COOKIES_DB_PATH
    }
  } catch (err: any) {
    console.warn(`[YouTube] Falha ao ler config do banco: ${err?.message}`)
  }

  // Fallback para env
  if (!proxyUrl) proxyUrl = process.env.YT_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''
  if (!cookiesFile) cookiesFile = process.env.YT_COOKIES_FILE || ''

  const data: YouTubeConfig = { proxyUrl, cookiesFile, dispatcher: getDispatcher(proxyUrl) }
  cachedConfig = { data, expires: now + CONFIG_CACHE_MS }
  return data
}

/** Invalida o cache (chamar após PUT /admin/settings) */
export function invalidateYouTubeConfigCache() {
  cachedConfig = null
}

async function ytFetch(url: string, init?: any): Promise<Response> {
  const cfg = await getYouTubeConfig()
  const opts: any = { ...(init || {}) }
  if (cfg.dispatcher) opts.dispatcher = cfg.dispatcher
  return fetch(url, opts)
}

// ============================================
// TIPOS
// ============================================

export interface TranscriptSnippet {
  text: string
  start: number      // segundos
  duration: number   // segundos
}

export interface TranscriptSegment {
  text: string
  startTime: number   // segundos
  endTime: number     // segundos
  startFormatted: string  // "MM:SS" ou "HH:MM:SS"
  endFormatted: string
}

export interface TranscriptResult {
  videoId: string
  title: string
  channelName: string
  description: string
  duration: number | null      // duração total em segundos
  language: string
  languageCode: string
  isGenerated: boolean         // true = auto-generated, false = manual
  snippets: TranscriptSnippet[]
  segments: TranscriptSegment[]  // agrupados por blocos de tempo
  fullText: string               // texto completo normalizado
  thumbnailUrl: string
  publishedAt: string | null
  viewCount: string | null
  needsAsrFallback: boolean    // true se não encontrou nenhum transcript
}

interface CaptionTrack {
  baseUrl: string
  languageCode: string
  language: string
  kind: string        // 'asr' = auto-generated, '' = manual
  isTranslatable: boolean
}

interface VideoMetadata {
  title: string
  channelName: string
  description: string
  duration: number | null
  thumbnailUrl: string
  publishedAt: string | null
  viewCount: string | null
}

// ============================================
// CONSTANTES (baseado no youtube-transcript-api)
// ============================================

const WATCH_URL = 'https://www.youtube.com/watch?v='
const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player'

// Múltiplos clientes InnerTube para fallback (YouTube bloqueia/degrada conforme client)
const INNERTUBE_CLIENTS = [
  {
    name: 'ANDROID',
    context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'pt-BR', gl: 'BR' } },
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
  },
  {
    name: 'IOS',
    context: { client: { clientName: 'IOS', clientVersion: '20.10.4', deviceModel: 'iPhone16,2', hl: 'pt-BR', gl: 'BR' } },
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)',
  },
  {
    name: 'WEB',
    context: { client: { clientName: 'WEB', clientVersion: '2.20250108.00.00', hl: 'pt-BR', gl: 'BR' } },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
  {
    name: 'MWEB',
    context: { client: { clientName: 'MWEB', clientVersion: '2.20250108.00.00', hl: 'pt-BR', gl: 'BR' } },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  },
]

// Idiomas preferidos para busca de transcript (prioridade decrescente)
const DEFAULT_LANGUAGES = ['pt', 'pt-BR', 'pt-PT', 'en', 'en-US', 'es', 'fr', 'de', 'it']

// Duração padrão de cada segmento agrupado (em segundos)
const DEFAULT_SEGMENT_DURATION = 120 // 2 minutos por segmento

// ============================================
// EXTRAÇÃO DE VIDEO ID
// ============================================

export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }

  // Se a string já for um videoId (11 chars alphanumeric + - _)
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url

  return null
}

// ============================================
// FETCH DE DADOS DO YOUTUBE (InnerTube API)
// ============================================

async function fetchVideoPage(videoId: string): Promise<string> {
  // Cookie CONSENT=YES+ pula o interstitial de consentimento (UE / IPs de datacenter)
  // que senão degrada toda a resposta (sem captions, sem metadata).
  const response = await ytFetch(`${WATCH_URL}${videoId}&hl=pt-BR&gl=BR`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+000; SOCS=CAI; PREF=hl=pt-BR&gl=BR',
    },
  })
  if (!response.ok) {
    throw new Error(`YouTube retornou status ${response.status} para o vídeo ${videoId}`)
  }
  return response.text()
}

function extractVisitorData(html: string): string | null {
  const m = html.match(/"visitorData":\s*"([^"]+)"/)
  return m ? m[1] : null
}

function extractInnertubeApiKey(html: string): string | null {
  const match = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/)
  return match ? match[1] : null
}

async function fetchInnertubeData(videoId: string, apiKey: string, visitorData?: string | null): Promise<any> {
  // Tenta cada client em ordem até obter resposta com captions
  let lastErr: any = null
  let bestData: any = null
  for (const client of INNERTUBE_CLIENTS) {
    try {
      const ctx: any = JSON.parse(JSON.stringify(client.context))
      if (visitorData) ctx.client.visitorData = visitorData
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': client.userAgent,
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+000; SOCS=CAI',
        'X-YouTube-Client-Name': client.name === 'ANDROID' ? '3' : client.name === 'IOS' ? '5' : client.name === 'MWEB' ? '2' : '1',
        'X-YouTube-Client-Version': client.context.client.clientVersion,
      }
      if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData

      const response = await ytFetch(`${INNERTUBE_API_URL}?key=${apiKey}&prettyPrint=false`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          context: ctx,
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      })
      if (!response.ok) {
        lastErr = new Error(`InnerTube ${client.name} status ${response.status}`)
        continue
      }
      const data: any = await response.json()
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []
      if (tracks.length > 0) {
        console.log(`[YouTube] InnerTube client ${client.name}: ${tracks.length} caption tracks`)
        return data
      }
      // Salva o melhor (com mais metadados) caso nenhum tenha captions
      if (!bestData && data?.videoDetails) bestData = data
      console.log(`[YouTube] InnerTube client ${client.name}: 0 caption tracks, tentando próximo...`)
    } catch (err: any) {
      lastErr = err
      console.warn(`[YouTube] InnerTube client ${client.name} falhou: ${err?.message}`)
    }
  }
  if (bestData) return bestData
  throw lastErr || new Error('Nenhum client InnerTube retornou captions')
}

// ============================================
// EXTRAÇÃO DE METADADOS DO VÍDEO
// ============================================

function extractVideoMetadata(html: string, videoId: string): VideoMetadata {
  const $ = cheerio.load(html)

  // Título
  const title = $('meta[property="og:title"]').attr('content')
    || $('meta[name="title"]').attr('content')
    || $('title').text().replace(/ - YouTube$/, '').trim()
    || `YouTube Video ${videoId}`

  // Canal
  const channelName = $('link[itemprop="name"]').attr('content')
    || $('meta[property="og:site_name"]').attr('content')
    || ''

  // Descrição
  const description = $('meta[property="og:description"]').attr('content')
    || $('meta[name="description"]').attr('content')
    || ''

  // Thumbnail
  const thumbnailUrl = $('meta[property="og:image"]').attr('content')
    || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`

  // Data de publicação
  const publishedAt = $('meta[itemprop="datePublished"]').attr('content')
    || $('meta[property="article:published_time"]').attr('content')
    || null

  // Duração (em formato ISO 8601 ou segundos)
  let duration: number | null = null
  const durationStr = $('meta[itemprop="duration"]').attr('content')
  if (durationStr) {
    duration = parseIsoDuration(durationStr)
  }

  // View count
  const viewCount = $('meta[itemprop="interactionCount"]').attr('content') || null

  return { title, channelName, description, duration, thumbnailUrl, publishedAt, viewCount }
}

function parseIsoDuration(iso: string): number | null {
  // PT1H2M3S → 3723 seconds
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return null
  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const seconds = parseInt(match[3] || '0', 10)
  return hours * 3600 + minutes * 60 + seconds
}

// ============================================
// EXTRAÇÃO DE CAPTIONS (baseado no youtube-transcript-api)
// ============================================

function extractCaptionTracks(innertubeData: any): CaptionTrack[] {
  const captions = innertubeData?.captions?.playerCaptionsTracklistRenderer
  if (!captions || !captions.captionTracks) {
    return []
  }

  return captions.captionTracks.map((track: any) => ({
    baseUrl: track.baseUrl.replace('&fmt=srv3', ''),
    languageCode: track.languageCode,
    language: track.name?.runs?.[0]?.text || track.name?.simpleText || track.languageCode,
    kind: track.kind || '',
    isTranslatable: !!track.isTranslatable,
  }))
}

/**
 * Seleciona o melhor transcript disponível
 * Prioridade: manual no idioma > automático no idioma > manual qualquer > automático qualquer
 */
function selectBestTrack(
  tracks: CaptionTrack[],
  preferredLanguages: string[] = DEFAULT_LANGUAGES
): { track: CaptionTrack; isGenerated: boolean } | null {
  if (tracks.length === 0) return null

  const manualTracks = tracks.filter(t => t.kind !== 'asr')
  const autoTracks = tracks.filter(t => t.kind === 'asr')

  // 1. Manual no idioma preferido
  for (const lang of preferredLanguages) {
    const found = manualTracks.find(t => t.languageCode === lang || t.languageCode.startsWith(lang.split('-')[0]))
    if (found) return { track: found, isGenerated: false }
  }

  // 2. Automático no idioma preferido
  for (const lang of preferredLanguages) {
    const found = autoTracks.find(t => t.languageCode === lang || t.languageCode.startsWith(lang.split('-')[0]))
    if (found) return { track: found, isGenerated: true }
  }

  // 3. Manual em qualquer idioma
  if (manualTracks.length > 0) {
    return { track: manualTracks[0], isGenerated: false }
  }

  // 4. Automático em qualquer idioma
  if (autoTracks.length > 0) {
    return { track: autoTracks[0], isGenerated: true }
  }

  return null
}

// ============================================
// PARSE DO XML DE CAPTIONS
// ============================================

async function fetchCaptionXml(captionUrl: string): Promise<string> {
  const response = await ytFetch(captionUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+000; SOCS=CAI',
    },
  })
  if (!response.ok) {
    throw new Error(`Falha ao buscar captions: status ${response.status}`)
  }
  return response.text()
}

function parseCaptionXml(xml: string): TranscriptSnippet[] {
  const snippets: TranscriptSnippet[] = []

  // Parse XML: <text start="0.0" dur="2.5">Hello world</text>
  const regex = /<text\s+start="([^"]+)"(?:\s+dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/gi
  let match: RegExpExecArray | null

  while ((match = regex.exec(xml)) !== null) {
    const start = parseFloat(match[1])
    const duration = parseFloat(match[2] || '0')
    let text = match[3]

    // Limpar HTML entities e tags
    text = text
      .replace(/<[^>]*>/g, '')          // Remove tags HTML
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/\n/g, ' ')
      .trim()

    if (text) {
      snippets.push({ text, start, duration })
    }
  }

  return snippets
}

// ============================================
// AGRUPAMENTO POR SEGMENTOS DE TEMPO
// ============================================

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Agrupa snippets de tempo em segmentos maiores (ex: 2 minutos cada)
 * Isso gera chunks naturais para o RAG com referência temporal
 */
export function groupSnippetsIntoSegments(
  snippets: TranscriptSnippet[],
  segmentDurationSecs: number = DEFAULT_SEGMENT_DURATION
): TranscriptSegment[] {
  if (snippets.length === 0) return []

  const segments: TranscriptSegment[] = []
  let currentTexts: string[] = []
  let segmentStart = snippets[0].start
  let segmentEnd = segmentStart

  for (const snippet of snippets) {
    // Se o snippet ultrapassar o limite do segmento atual, fechar o segmento
    if (snippet.start - segmentStart >= segmentDurationSecs && currentTexts.length > 0) {
      segments.push({
        text: currentTexts.join(' '),
        startTime: segmentStart,
        endTime: segmentEnd,
        startFormatted: formatTimestamp(segmentStart),
        endFormatted: formatTimestamp(segmentEnd),
      })
      currentTexts = []
      segmentStart = snippet.start
    }

    currentTexts.push(snippet.text)
    segmentEnd = snippet.start + snippet.duration
  }

  // Último segmento
  if (currentTexts.length > 0) {
    segments.push({
      text: currentTexts.join(' '),
      startTime: segmentStart,
      endTime: segmentEnd,
      startFormatted: formatTimestamp(segmentStart),
      endFormatted: formatTimestamp(segmentEnd),
    })
  }

  return segments
}

// ============================================
// FALLBACK: Extração via HTML (quando InnerTube falha)
// ============================================

function extractCaptionTrackFromHtml(html: string): string | null {
  // Tries to find the caption track URL in the page source
  const patterns = [
    /"captionTracks":\s*\[.*?"baseUrl":\s*"([^"]+)"/,
    /timedtext[^"]*lang=pt[^"]*/,
    /timedtext[^"]*lang=en[^"]*/,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) {
      let url = match[1] || match[0]
      url = url.replace(/\\u0026/g, '&')
      if (url.startsWith('http')) return url
    }
  }
  return null
}

// ============================================
// PRIMÁRIO: yt-dlp (mais robusto contra bloqueio de IP)
// ============================================

interface YtDlpResult {
  title?: string
  channel?: string
  description?: string
  duration?: number
  thumbnail?: string
  upload_date?: string
  view_count?: number
  subtitles?: Record<string, Array<{ url: string; ext: string; name?: string }>>
  automatic_captions?: Record<string, Array<{ url: string; ext: string; name?: string }>>
}

function runYtDlp(args: string[], timeoutMs = 45_000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const t = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch {}
      reject(new Error(`yt-dlp timeout após ${timeoutMs}ms`))
    }, timeoutMs)
    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('error', err => { clearTimeout(t); reject(err) })
    proc.on('close', code => { clearTimeout(t); resolve({ stdout, stderr, code: code ?? -1 }) })
  })
}

/** Parser simples para JSON3 (formato nativo do YouTube via yt-dlp) */
function parseJson3Captions(json3Text: string): TranscriptSnippet[] {  try {
    const data = JSON.parse(json3Text)
    const events = data?.events || []
    const snippets: TranscriptSnippet[] = []
    for (const ev of events) {
      const segs = ev?.segs
      if (!segs) continue
      const text = segs.map((s: any) => s.utf8 || '').join('').replace(/\n+/g, ' ').trim()
      if (!text) continue
      const start = (ev.tStartMs || 0) / 1000
      const duration = (ev.dDurationMs || 0) / 1000
      snippets.push({ text, start, duration })
    }
    return snippets
  } catch (err) {
    console.warn(`[YouTube/yt-dlp] Falha ao parsear JSON3: ${(err as Error).message}`)
    return []
  }
}

/** Parser simples para WebVTT (fallback comum do yt-dlp) */
function parseVttCaptions(vttText: string): TranscriptSnippet[] {
  const snippets: TranscriptSnippet[] = []
  const lines = vttText.replace(/\r/g, '').split('\n')
  const tsRe = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/
  const toSec = (h: string, m: string, s: string, ms: string) =>
    parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000
  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(tsRe)
    if (m) {
      const start = toSec(m[1], m[2], m[3], m[4])
      const end = toSec(m[5], m[6], m[7], m[8])
      const textParts: string[] = []
      i++
      while (i < lines.length && lines[i].trim() !== '') {
        // Remove tags <c>, <00:00:00.000>, etc.
        const clean = lines[i]
          .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
          .replace(/<\/?[a-zA-Z][^>]*>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
          .trim()
        if (clean) textParts.push(clean)
        i++
      }
      const text = textParts.join(' ').replace(/\s+/g, ' ').trim()
      if (text) snippets.push({ text, start, duration: Math.max(0, end - start) })
    }
    i++
  }
  // Deduplica linhas consecutivas idênticas (auto-captions VTT repetem)
  const dedup: TranscriptSnippet[] = []
  for (const s of snippets) {
    if (!dedup.length || dedup[dedup.length - 1].text !== s.text) dedup.push(s)
  }
  return dedup
}

/** Tenta obter transcript via yt-dlp. Retorna null se falhar. */
async function fetchTranscriptViaYtDlp(
  videoUrl: string,
  videoId: string,
  languages: string[]
): Promise<{ metadata: VideoMetadata; snippets: TranscriptSnippet[]; languageCode: string; language: string; isGenerated: boolean } | null> {
  try {
    const cfg = await getYouTubeConfig()
    const YT_COOKIES_FILE = cfg.cookiesFile
    const YT_PROXY_URL = cfg.proxyUrl
    // Player clients atualizados — alguns conseguem passar pelo bot-check em IPs de datacenter
    // tv_embedded e mediaconnect são frequentemente menos restritos
    const PLAYER_CLIENTS = process.env.YT_DLP_PLAYER_CLIENTS
      || 'tv_embedded,mediaconnect,web_safari,mweb,ios,android,web'

    // 1. Coleta metadados + URLs de captions com --dump-single-json
    const dumpArgs: string[] = [
      '--no-warnings',
      '--no-playlist',
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs', languages.join(',') + ',-live_chat',
      '--extractor-args', `youtube:player_client=${PLAYER_CLIENTS}`,
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--retries', '3',
      '--dump-single-json',
    ]
    if (YT_COOKIES_FILE) {
      dumpArgs.unshift('--cookies', YT_COOKIES_FILE)
      console.log(`[YouTube/yt-dlp] Usando cookies de ${YT_COOKIES_FILE}`)
    }
    if (YT_PROXY_URL) {
      dumpArgs.unshift('--proxy', YT_PROXY_URL)
      console.log(`[YouTube/yt-dlp] Usando proxy ${YT_PROXY_URL.replace(/\/\/[^@]+@/, '//***@')}`)
    }
    dumpArgs.push(videoUrl)

    const { stdout, stderr, code } = await runYtDlp(dumpArgs, 60_000)
    if (code !== 0 || !stdout.trim()) {
      const isBotCheck = /Sign in to confirm|not a bot|cookies/i.test(stderr)
      if (isBotCheck) {
        console.warn(`[YouTube/yt-dlp] BLOQUEIO ANTI-BOT do YouTube detectado (IP de datacenter).`)
        console.warn(`[YouTube/yt-dlp] Solução 1: definir YT_COOKIES_FILE=/app/yt-cookies.txt (cookies exportados de browser logado)`)
        console.warn(`[YouTube/yt-dlp] Solução 2: definir YT_PROXY_URL com proxy residencial (http://user:pass@host:port)`)
        console.warn(`[YouTube/yt-dlp] Solução 3: usar transcrição ASR (Whisper) — botão "Ver estimativa de custo" na UI`)
      } else {
        console.warn(`[YouTube/yt-dlp] dump-json saiu com code=${code}: ${stderr.slice(0, 400)}`)
      }
      return null
    }

    const info: YtDlpResult = JSON.parse(stdout)

    const metadata: VideoMetadata = {
      title: info.title || `YouTube Video ${videoId}`,
      channelName: info.channel || '',
      description: info.description || '',
      duration: info.duration || null,
      thumbnailUrl: info.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      publishedAt: info.upload_date
        ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`
        : null,
      viewCount: info.view_count != null ? String(info.view_count) : null,
    }

    console.log(`[YouTube/yt-dlp] Título: "${metadata.title}" | Canal: "${metadata.channelName}"`)

    // 2. Selecionar a melhor faixa: prefere manual, depois auto, na ordem dos idiomas
    const subs = info.subtitles || {}
    const autoSubs = info.automatic_captions || {}
    const allLangs = Array.from(new Set([...Object.keys(subs), ...Object.keys(autoSubs)]))
    console.log(`[YouTube/yt-dlp] Idiomas com captions: ${allLangs.join(', ') || '(nenhum)'}`)

    let chosenLang: string | null = null
    let isGenerated = false
    let langSource: 'manual' | 'auto' = 'manual'

    // Procura idiomas preferidos primeiro (manual antes de auto)
    for (const lang of languages) {
      if (subs[lang] && subs[lang].length > 0) { chosenLang = lang; langSource = 'manual'; isGenerated = false; break }
    }
    if (!chosenLang) {
      for (const lang of languages) {
        if (autoSubs[lang] && autoSubs[lang].length > 0) { chosenLang = lang; langSource = 'auto'; isGenerated = true; break }
      }
    }
    // Match parcial (pt-BR cobre 'pt')
    if (!chosenLang) {
      for (const lang of languages) {
        const found = allLangs.find(l => l.toLowerCase().startsWith(lang.toLowerCase()))
        if (found) {
          chosenLang = found
          if (subs[found]?.length) { langSource = 'manual'; isGenerated = false }
          else { langSource = 'auto'; isGenerated = true }
          break
        }
      }
    }
    // Último recurso: qualquer idioma disponível
    if (!chosenLang && allLangs.length > 0) {
      chosenLang = allLangs[0]
      if (subs[chosenLang]?.length) { langSource = 'manual'; isGenerated = false }
      else { langSource = 'auto'; isGenerated = true }
    }

    if (!chosenLang) {
      console.warn(`[YouTube/yt-dlp] Nenhuma caption disponível`)
      return { metadata, snippets: [], languageCode: '', language: '', isGenerated: false }
    }

    const trackList = (langSource === 'manual' ? subs : autoSubs)[chosenLang] || []
    // Prefere json3, depois srv3, depois vtt
    const preferredOrder = ['json3', 'srv3', 'vtt', 'ttml']
    const sorted = [...trackList].sort((a, b) => {
      const ai = preferredOrder.indexOf(a.ext); const bi = preferredOrder.indexOf(b.ext)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
    const chosenTrack = sorted[0]
    if (!chosenTrack?.url) return { metadata, snippets: [], languageCode: chosenLang, language: chosenLang, isGenerated }

    console.log(`[YouTube/yt-dlp] Selecionado: ${chosenLang} (${langSource}) formato=${chosenTrack.ext}`)

    // 3. Baixa o conteúdo da caption. Estratégia em camadas:
    //    (a) fetch SEM proxy (IP do servidor — endpoint timedtext usa URL assinada,
    //        normalmente não está rate-limited fora do bot-check)
    //    (b) fetch COM proxy via undici
    //    (c) yt-dlp em subprocess (último recurso, lento)
    let capText = ''

    // (a) Tenta sem proxy primeiro — URL é assinada
    try {
      const directRes = await fetch(chosenTrack.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'Referer': 'https://www.youtube.com/',
        },
      })
      if (directRes.ok) {
        capText = await directRes.text()
        console.log(`[YouTube/yt-dlp] Caption obtida via fetch direto SEM proxy (${capText.length} bytes)`)
      } else {
        console.warn(`[YouTube/yt-dlp] fetch sem proxy falhou: ${directRes.status} — tentando com proxy...`)
      }
    } catch (err: any) {
      console.warn(`[YouTube/yt-dlp] fetch sem proxy erro: ${err?.message}`)
    }

    // (b) Tenta com proxy via undici
    if (!capText) {
      try {
        const capRes = await ytFetch(chosenTrack.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Referer': 'https://www.youtube.com/',
          },
        })
        if (capRes.ok) {
          capText = await capRes.text()
          console.log(`[YouTube/yt-dlp] Caption obtida via fetch COM proxy (${capText.length} bytes)`)
        } else {
          console.warn(`[YouTube/yt-dlp] fetch com proxy falhou: ${capRes.status} — tentando via yt-dlp subprocess...`)
        }
      } catch (err: any) {
        console.warn(`[YouTube/yt-dlp] fetch com proxy erro: ${err?.message} — tentando via yt-dlp...`)
      }
    }

    // (c) Fallback: baixa via yt-dlp subprocess (--write-subs em arquivo)
    if (!capText) {
      try {
        const fs = await import('node:fs/promises')
        const os = await import('node:os')
        const path = await import('node:path')
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytdlp-'))
        const subFmt = chosenTrack.ext === 'json3' ? 'json3' : (chosenTrack.ext || 'vtt')
        const subFlag = langSource === 'auto' ? '--write-auto-subs' : '--write-subs'
        const dlArgs: string[] = [
          '--no-warnings', '--no-playlist', '--skip-download',
          subFlag,
          '--sub-langs', chosenLang,
          '--sub-format', `${subFmt}/vtt/ttml/srv3/srv2/srv1/best`,
          '--extractor-args', `youtube:player_client=${process.env.YT_DLP_PLAYER_CLIENTS || 'tv_embedded,mediaconnect,web_safari,mweb,ios,android,web'}`,
          '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          '--retries', '5',
          '--fragment-retries', '5',
          '--retry-sleep', 'fragment:exp=1:60',
          '-o', path.join(tmpDir, '%(id)s.%(ext)s'),
        ]
        if (YT_COOKIES_FILE) dlArgs.unshift('--cookies', YT_COOKIES_FILE)
        if (YT_PROXY_URL) dlArgs.unshift('--proxy', YT_PROXY_URL)
        dlArgs.push(videoUrl)

        const dl = await runYtDlp(dlArgs, 90_000)
        if (dl.code !== 0) {
          console.warn(`[YouTube/yt-dlp] download de caption falhou code=${dl.code}: ${dl.stderr.slice(0, 300)}`)
        } else {
          // Procura o arquivo de caption gerado
          const files = await fs.readdir(tmpDir)
          const subFile = files.find(f => f.includes(chosenLang) && (f.endsWith('.json3') || f.endsWith('.vtt') || f.endsWith('.srv3') || f.endsWith('.ttml')))
            || files.find(f => f.endsWith('.json3') || f.endsWith('.vtt') || f.endsWith('.srv3'))
          if (subFile) {
            capText = await fs.readFile(path.join(tmpDir, subFile), 'utf8')
            console.log(`[YouTube/yt-dlp] Caption baixada via yt-dlp: ${subFile} (${capText.length} bytes)`)
          } else {
            console.warn(`[YouTube/yt-dlp] yt-dlp não gerou arquivo de caption. Files: ${files.join(', ')}`)
          }
        }
        // Limpa o diretório temporário
        try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch {}
      } catch (err: any) {
        console.warn(`[YouTube/yt-dlp] fallback yt-dlp falhou: ${err?.message}`)
      }
    }

    if (!capText) {
      return { metadata, snippets: [], languageCode: chosenLang, language: chosenLang, isGenerated }
    }

    // 4. Parse conforme o formato (auto-detecta por conteúdo, pois yt-dlp pode baixar
    //    em fmt diferente do solicitado quando faz fallback)
    let snippets: TranscriptSnippet[] = []
    const trimmed = capText.trimStart()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      snippets = parseJson3Captions(capText)
    } else if (trimmed.startsWith('WEBVTT')) {
      snippets = parseVttCaptions(capText)
    } else if (trimmed.startsWith('<')) {
      snippets = parseCaptionXml(capText)
    } else if (chosenTrack.ext === 'json3' || chosenTrack.ext === 'srv3') {
      snippets = parseJson3Captions(capText)
    } else {
      snippets = parseCaptionXml(capText)
    }

    return {
      metadata,
      snippets,
      languageCode: chosenLang,
      language: chosenLang,
      isGenerated,
    }
  } catch (err: any) {
    console.warn(`[YouTube/yt-dlp] Falhou: ${err?.message}`)
    return null
  }
}

// ============================================
// FUNÇÃO PRINCIPAL: fetchYouTubeTranscript
// ============================================

export async function fetchYouTubeTranscript(
  videoUrl: string,
  options: {
    languages?: string[]
    segmentDuration?: number
  } = {}
): Promise<TranscriptResult> {
  const { languages = DEFAULT_LANGUAGES, segmentDuration = DEFAULT_SEGMENT_DURATION } = options

  // 1. Extrair videoId
  const videoId = extractVideoId(videoUrl)
  if (!videoId) {
    throw new Error(`URL de YouTube inválida: ${videoUrl}`)
  }

  console.log(`[YouTube] Processando vídeo: ${videoId}`)

  // 1.5. CAMINHO PRIMÁRIO: yt-dlp (mais robusto contra bloqueio de IP de datacenter)
  // Possui estratégias atualizadas (web_creator/mweb_safari/PoToken) para contornar
  // a proteção anti-bot do YouTube que afeta IPs cloud.
  const ytDlpResult = await fetchTranscriptViaYtDlp(`https://www.youtube.com/watch?v=${videoId}`, videoId, languages)
  if (ytDlpResult && ytDlpResult.snippets.length > 0) {
    const segments = groupSnippetsIntoSegments(ytDlpResult.snippets, segmentDuration)
    const fullText = ytDlpResult.snippets.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim()
    console.log(`[YouTube/yt-dlp] ${ytDlpResult.snippets.length} snippets extraídos com sucesso`)
    return {
      videoId,
      title: ytDlpResult.metadata.title,
      channelName: ytDlpResult.metadata.channelName,
      description: ytDlpResult.metadata.description,
      duration: ytDlpResult.metadata.duration,
      language: ytDlpResult.language,
      languageCode: ytDlpResult.languageCode,
      isGenerated: ytDlpResult.isGenerated,
      snippets: ytDlpResult.snippets,
      segments,
      fullText,
      thumbnailUrl: ytDlpResult.metadata.thumbnailUrl,
      publishedAt: ytDlpResult.metadata.publishedAt,
      viewCount: ytDlpResult.metadata.viewCount,
      needsAsrFallback: false,
    }
  }

  // Se yt-dlp obteve metadados mas sem captions, usa metadados do yt-dlp daqui pra frente
  const ytDlpMetadata = ytDlpResult?.metadata || null
  if (ytDlpResult && ytDlpResult.snippets.length === 0) {
    console.log(`[YouTube] yt-dlp encontrou vídeo mas não conseguiu caption — retornando para ASR fallback`)
    // Não tenta o fluxo antigo (InnerTube) — só faria nova request 429.
    // Marca como needsAsrFallback para o pipeline transcrever via Whisper.
    return {
      videoId,
      title: ytDlpMetadata!.title,
      channelName: ytDlpMetadata!.channelName,
      description: ytDlpMetadata!.description,
      duration: ytDlpMetadata!.duration,
      language: '',
      languageCode: '',
      isGenerated: false,
      snippets: [],
      segments: [],
      fullText: ytDlpMetadata!.description || `Vídeo: ${ytDlpMetadata!.title}. Transcrição indisponível.`,
      thumbnailUrl: ytDlpMetadata!.thumbnailUrl,
      publishedAt: ytDlpMetadata!.publishedAt,
      viewCount: ytDlpMetadata!.viewCount,
      needsAsrFallback: true,
    }
  }

  // 2. Fetch da página HTML do YouTube (fallback para o método antigo)
  const html = await fetchVideoPage(videoId)

  // 3. Extrair metadados do vídeo (prefere yt-dlp se disponível)
  const metadata = ytDlpMetadata || extractVideoMetadata(html, videoId)
  console.log(`[YouTube] Título: "${metadata.title}" | Canal: "${metadata.channelName}"`)

  // 4. Tentar InnerTube API (múltiplos clients: ANDROID → IOS → WEB → MWEB)
  let captionTracks: CaptionTrack[] = []
  const apiKey = extractInnertubeApiKey(html)
  const visitorData = extractVisitorData(html)
  if (visitorData) console.log(`[YouTube] visitorData extraído (${visitorData.length} chars)`)

  if (apiKey) {
    try {
      const innertubeData = await fetchInnertubeData(videoId, apiKey, visitorData)
      captionTracks = extractCaptionTracks(innertubeData)
      console.log(`[YouTube] InnerTube: ${captionTracks.length} tracks encontrados`)

      if (captionTracks.length > 0) {
        const trackInfo = captionTracks.map(t =>
          `${t.languageCode}(${t.kind === 'asr' ? 'auto' : 'manual'})`
        ).join(', ')
        console.log(`[YouTube] Tracks disponíveis: ${trackInfo}`)
      }
    } catch (error) {
      console.warn(`[YouTube] InnerTube API falhou: ${(error as Error).message}`)
    }
  } else {
    console.warn(`[YouTube] INNERTUBE_API_KEY não encontrada no HTML — IP provavelmente bloqueado pelo YouTube`)
  }

  // 5. Fallback: tentar extrair caption URL direto do HTML
  if (captionTracks.length === 0) {
    console.log('[YouTube] Tentando fallback via HTML...')
    const fallbackUrl = extractCaptionTrackFromHtml(html)
    if (fallbackUrl) {
      captionTracks = [{
        baseUrl: fallbackUrl,
        languageCode: 'unknown',
        language: 'Desconhecido',
        kind: 'asr',
        isTranslatable: false,
      }]
    }
  }

  // 6. Se não encontrou nenhum transcript, marcar para fallback ASR
  if (captionTracks.length === 0) {
    console.warn(`[YouTube] Nenhum transcript disponível para ${videoId}`)
    return {
      videoId,
      title: metadata.title,
      channelName: metadata.channelName,
      description: metadata.description,
      duration: metadata.duration,
      language: '',
      languageCode: '',
      isGenerated: false,
      snippets: [],
      segments: [],
      fullText: metadata.description || `Vídeo: ${metadata.title}. Transcrição indisponível.`,
      thumbnailUrl: metadata.thumbnailUrl,
      publishedAt: metadata.publishedAt,
      viewCount: metadata.viewCount,
      needsAsrFallback: true,
    }
  }

  // 7. Selecionar melhor track
  const selected = selectBestTrack(captionTracks, languages)
  if (!selected) {
    // Usar o primeiro disponível
    const fallbackTrack = captionTracks[0]
    console.log(`[YouTube] Usando track fallback: ${fallbackTrack.languageCode}`)
    return await processTrack(videoId, fallbackTrack, fallbackTrack.kind === 'asr', metadata, segmentDuration)
  }

  console.log(`[YouTube] Selecionado: ${selected.track.languageCode} (${selected.isGenerated ? 'auto' : 'manual'})`)
  return await processTrack(videoId, selected.track, selected.isGenerated, metadata, segmentDuration)
}

async function processTrack(
  videoId: string,
  track: CaptionTrack,
  isGenerated: boolean,
  metadata: VideoMetadata,
  segmentDuration: number
): Promise<TranscriptResult> {
  // Fetch e parse do XML de captions
  const xml = await fetchCaptionXml(track.baseUrl)
  const snippets = parseCaptionXml(xml)

  if (snippets.length === 0) {
    console.warn(`[YouTube] Track ${track.languageCode} retornou 0 snippets`)
    return {
      videoId,
      title: metadata.title,
      channelName: metadata.channelName,
      description: metadata.description,
      duration: metadata.duration,
      language: track.language,
      languageCode: track.languageCode,
      isGenerated,
      snippets: [],
      segments: [],
      fullText: metadata.description || `Vídeo: ${metadata.title}. Transcrição indisponível.`,
      thumbnailUrl: metadata.thumbnailUrl,
      publishedAt: metadata.publishedAt,
      viewCount: metadata.viewCount,
      needsAsrFallback: true,
    }
  }

  console.log(`[YouTube] ${snippets.length} snippets extraídos (${track.languageCode}, ${isGenerated ? 'auto-generated' : 'manual'})`)

  // Agrupar snippets em segmentos de ~N minutos
  const segments = groupSnippetsIntoSegments(snippets, segmentDuration)

  // Gerar texto completo normalizado
  const fullText = snippets.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim()

  return {
    videoId,
    title: metadata.title,
    channelName: metadata.channelName,
    description: metadata.description,
    duration: metadata.duration,
    language: track.language,
    languageCode: track.languageCode,
    isGenerated,
    snippets,
    segments,
    fullText,
    thumbnailUrl: metadata.thumbnailUrl,
    publishedAt: metadata.publishedAt,
    viewCount: metadata.viewCount,
    needsAsrFallback: false,
  }
}

// ============================================
// CHUNKING PARA RAG (com timestamps)
// ============================================

export interface YouTubeChunk {
  content: string           // Texto do chunk para embedding
  startTime: number
  endTime: number
  startFormatted: string
  endFormatted: string
  videoId: string
  videoTitle: string
  channelName: string
  youtubeUrl: string        // URL com timestamp
}

/**
 * Transforma o resultado do transcript em chunks prontos para RAG
 * Cada chunk tem contexto do vídeo + timestamp para citação
 */
export function createYouTubeChunks(
  result: TranscriptResult,
  maxChunkSize: number = 500
): YouTubeChunk[] {
  const chunks: YouTubeChunk[] = []
  const videoUrl = `https://www.youtube.com/watch?v=${result.videoId}`

  // Se não tem transcript, criar um chunk com a descrição
  if (result.segments.length === 0) {
    const content = [
      `# ${result.title}`,
      result.channelName ? `Canal: ${result.channelName}` : '',
      '',
      result.fullText,
    ].filter(Boolean).join('\n')

    chunks.push({
      content,
      startTime: 0,
      endTime: 0,
      startFormatted: '0:00',
      endFormatted: '0:00',
      videoId: result.videoId,
      videoTitle: result.title,
      channelName: result.channelName,
      youtubeUrl: videoUrl,
    })
    return chunks
  }

  // Processar cada segmento
  for (const segment of result.segments) {
    // Se o segmento é maior que maxChunkSize, subdividir
    if (segment.text.length > maxChunkSize) {
      const subChunks = splitSegmentBySize(segment, maxChunkSize, result)
      chunks.push(...subChunks)
    } else {
      // Adicionar header com contexto do vídeo
      const header = `[${result.title}] (${segment.startFormatted} - ${segment.endFormatted})`
      const content = `${header}\n${segment.text}`

      chunks.push({
        content,
        startTime: segment.startTime,
        endTime: segment.endTime,
        startFormatted: segment.startFormatted,
        endFormatted: segment.endFormatted,
        videoId: result.videoId,
        videoTitle: result.title,
        channelName: result.channelName,
        youtubeUrl: `${videoUrl}&t=${Math.floor(segment.startTime)}`,
      })
    }
  }

  return chunks
}

function splitSegmentBySize(
  segment: TranscriptSegment,
  maxSize: number,
  result: TranscriptResult
): YouTubeChunk[] {
  const videoUrl = `https://www.youtube.com/watch?v=${result.videoId}`
  const words = segment.text.split(' ')
  const subChunks: YouTubeChunk[] = []
  let currentWords: string[] = []
  let subIndex = 0
  const totalDuration = segment.endTime - segment.startTime
  const totalWords = words.length

  for (const word of words) {
    currentWords.push(word)
    const currentText = currentWords.join(' ')

    if (currentText.length >= maxSize) {
      // Estimar timestamp proporcional
      const progress = (subIndex + currentWords.length / 2) / totalWords
      const estimatedStart = segment.startTime + (totalDuration * (subIndex / totalWords))
      const estimatedEnd = segment.startTime + (totalDuration * ((subIndex + currentWords.length) / totalWords))

      const header = `[${result.title}] (${formatTimestamp(estimatedStart)} - ${formatTimestamp(estimatedEnd)})`

      subChunks.push({
        content: `${header}\n${currentText}`,
        startTime: estimatedStart,
        endTime: estimatedEnd,
        startFormatted: formatTimestamp(estimatedStart),
        endFormatted: formatTimestamp(estimatedEnd),
        videoId: result.videoId,
        videoTitle: result.title,
        channelName: result.channelName,
        youtubeUrl: `${videoUrl}&t=${Math.floor(estimatedStart)}`,
      })

      subIndex += currentWords.length
      currentWords = []
    }
  }

  // Resto
  if (currentWords.length > 0) {
    const estimatedStart = segment.startTime + (totalDuration * (subIndex / totalWords))
    const header = `[${result.title}] (${formatTimestamp(estimatedStart)} - ${segment.endFormatted})`

    subChunks.push({
      content: `${header}\n${currentWords.join(' ')}`,
      startTime: estimatedStart,
      endTime: segment.endTime,
      startFormatted: formatTimestamp(estimatedStart),
      endFormatted: segment.endFormatted,
      videoId: result.videoId,
      videoTitle: result.title,
      channelName: result.channelName,
      youtubeUrl: `${videoUrl}&t=${Math.floor(estimatedStart)}`,
    })
  }

  return subChunks
}
