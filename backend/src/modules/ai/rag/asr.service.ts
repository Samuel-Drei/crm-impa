/**
 * ASR (Automatic Speech Recognition) Service
 * 
 * Transcrição de áudio para texto usando:
 * - OpenAI Whisper API (pago, $0.006/min)
 * - Whisper local via API compatível (grátis, mais lento em CPU)
 * 
 * Usado como fallback quando o YouTube não tem legendas disponíveis.
 * 
 * Fluxo:
 * 1. Baixa áudio do YouTube via yt-dlp
 * 2. Estima custo baseado na duração
 * 3. Usuário confirma o custo
 * 4. Transcreve via provider escolhido (OpenAI ou local)
 * 5. Retorna transcript com timestamps
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { prisma } from '../../../config/database.js'

const execAsync = promisify(exec)

// ============================================
// TIPOS
// ============================================

export type AsrProvider = 'openai' | 'local'

export interface AsrConfig {
  provider: AsrProvider
  apiKey?: string        // Para OpenAI
  baseUrl?: string       // Para local whisper (ex: http://localhost:9000)
  model?: string         // "whisper-1" (OpenAI) ou modelo local
  language?: string      // Idioma esperado (melhora qualidade)
}

export interface AsrCostEstimate {
  videoId: string
  title: string
  durationSeconds: number
  durationFormatted: string
  provider: AsrProvider
  estimatedCostUsd: number
  pricePerMinute: number
  isFree: boolean
  message: string
}

export interface AsrTranscriptSegment {
  text: string
  start: number      // segundos
  end: number        // segundos
}

export interface AsrTranscriptResult {
  text: string
  segments: AsrTranscriptSegment[]
  language: string
  durationSeconds: number
  provider: AsrProvider
  model: string
  costUsd: number
}

// ============================================
// CONSTANTES
// ============================================

const OPENAI_WHISPER_PRICE_PER_MINUTE = 0.006
const OPENAI_WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions'
const TEMP_DIR = path.join(os.tmpdir(), 'crm-asr')
const MAX_AUDIO_SIZE_MB = 25  // Limite da API OpenAI

// ============================================
// DOWNLOAD DE ÁUDIO (yt-dlp)
// ============================================

async function ensureTempDir(): Promise<void> {
  await fs.mkdir(TEMP_DIR, { recursive: true })
}

/**
 * Baixa o áudio de um vídeo do YouTube usando yt-dlp
 * Retorna o path do arquivo de áudio (mp3, <25MB)
 */
export async function downloadYouTubeAudio(videoId: string): Promise<string> {
  await ensureTempDir()
  const outputPath = path.join(TEMP_DIR, `${videoId}.mp3`)

  // Limpar arquivo anterior se existir
  try { await fs.unlink(outputPath) } catch { /* ok */ }

  console.log(`[ASR] Baixando áudio do vídeo ${videoId}...`)

  try {
    // yt-dlp: extrair apenas áudio, converter para mp3, limitar qualidade para ficar <25MB
    await execAsync(
      `yt-dlp -x --audio-format mp3 --audio-quality 5 ` +
      `--no-playlist --no-warnings --quiet ` +
      `-o "${outputPath}" ` +
      `"https://www.youtube.com/watch?v=${videoId}"`,
      { timeout: 300_000 } // 5 min timeout
    )

    // Verificar se o arquivo foi criado
    const stat = await fs.stat(outputPath)
    const sizeMB = stat.size / (1024 * 1024)
    console.log(`[ASR] Áudio baixado: ${sizeMB.toFixed(1)}MB`)

    if (sizeMB > MAX_AUDIO_SIZE_MB) {
      // Re-baixar com qualidade menor para ficar dentro do limite
      await fs.unlink(outputPath)
      await execAsync(
        `yt-dlp -x --audio-format mp3 --audio-quality 9 ` +
        `--no-playlist --no-warnings --quiet ` +
        `-o "${outputPath}" ` +
        `"https://www.youtube.com/watch?v=${videoId}"`,
        { timeout: 300_000 }
      )
    }

    return outputPath
  } catch (error) {
    const msg = (error as Error).message
    // Limpar arquivo parcial
    try { await fs.unlink(outputPath) } catch { /* ok */ }

    if (msg.includes('not found') || msg.includes('No such file')) {
      throw new Error('yt-dlp não está instalado. Instale com: pip install yt-dlp')
    }
    throw new Error(`Falha ao baixar áudio: ${msg}`)
  }
}

/**
 * Limpa arquivo de áudio temporário
 */
export async function cleanupAudioFile(filePath: string): Promise<void> {
  try { await fs.unlink(filePath) } catch { /* ok */ }
}

// ============================================
// ESTIMATIVA DE CUSTO
// ============================================

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}min ${s}s`
  if (m > 0) return `${m}min ${s}s`
  return `${s}s`
}

/**
 * Estima o custo da transcrição ASR baseado na duração do vídeo
 */
export function estimateAsrCost(
  videoId: string,
  title: string,
  durationSeconds: number,
  provider: AsrProvider
): AsrCostEstimate {
  const durationMinutes = durationSeconds / 60
  const isFree = provider === 'local'
  const pricePerMinute = isFree ? 0 : OPENAI_WHISPER_PRICE_PER_MINUTE
  const estimatedCostUsd = isFree ? 0 : Math.ceil(durationMinutes) * pricePerMinute

  let message: string
  if (isFree) {
    const estimatedTimeMins = Math.ceil(durationMinutes * 5) // ~5x tempo real em CPU
    message = `Transcrição local (grátis). Tempo estimado: ~${estimatedTimeMins} minutos em CPU.`
  } else {
    message = `Transcrição via OpenAI Whisper. Custo: US$ ${estimatedCostUsd.toFixed(4)} (${formatDuration(durationSeconds)} × $${pricePerMinute}/min).`
  }

  return {
    videoId,
    title,
    durationSeconds,
    durationFormatted: formatDuration(durationSeconds),
    provider,
    estimatedCostUsd,
    pricePerMinute,
    isFree,
    message,
  }
}

// ============================================
// TRANSCRIÇÃO VIA OPENAI WHISPER API
// ============================================

async function transcribeWithOpenAI(
  audioPath: string,
  apiKey: string,
  language?: string,
  model: string = 'whisper-1'
): Promise<AsrTranscriptResult> {
  console.log(`[ASR] Transcrevendo via OpenAI Whisper (model: ${model})...`)

  const audioBuffer = await fs.readFile(audioPath)
  const audioStat = await fs.stat(audioPath)
  const durationEstimate = audioStat.size / (16000 * 2) // Estimativa bruta (16kHz, 16-bit)

  // FormData para enviar o arquivo
  const formData = new FormData()
  formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), path.basename(audioPath))
  formData.append('model', model)
  formData.append('response_format', 'verbose_json')
  formData.append('timestamp_granularities[]', 'segment')
  if (language) {
    formData.append('language', language)
  }

  const response = await fetch(OPENAI_WHISPER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`OpenAI Whisper API erro ${response.status}: ${errorBody}`)
  }

  const result = await response.json() as any

  // Extrair segmentos com timestamps
  const segments: AsrTranscriptSegment[] = (result.segments || []).map((seg: any) => ({
    text: (seg.text || '').trim(),
    start: seg.start || 0,
    end: seg.end || 0,
  }))

  const actualDuration = result.duration || durationEstimate
  const costUsd = Math.ceil(actualDuration / 60) * OPENAI_WHISPER_PRICE_PER_MINUTE

  return {
    text: result.text || segments.map(s => s.text).join(' '),
    segments,
    language: result.language || language || 'unknown',
    durationSeconds: actualDuration,
    provider: 'openai',
    model,
    costUsd,
  }
}

// ============================================
// TRANSCRIÇÃO VIA WHISPER LOCAL (API compatível)
// ============================================

async function transcribeWithLocalWhisper(
  audioPath: string,
  baseUrl: string,
  language?: string,
  model?: string
): Promise<AsrTranscriptResult> {
  console.log(`[ASR] Transcrevendo via Whisper local (${baseUrl})...`)

  const audioBuffer = await fs.readFile(audioPath)

  // API compatível com OpenAI (faster-whisper-server, whisper.cpp server)
  const formData = new FormData()
  formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), path.basename(audioPath))
  formData.append('response_format', 'verbose_json')
  formData.append('timestamp_granularities[]', 'segment')
  if (model) formData.append('model', model)
  if (language) formData.append('language', language)

  const url = baseUrl.replace(/\/$/, '') + '/v1/audio/transcriptions'

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Whisper local erro ${response.status}: ${errorBody}`)
  }

  const result = await response.json() as any

  const segments: AsrTranscriptSegment[] = (result.segments || []).map((seg: any) => ({
    text: (seg.text || '').trim(),
    start: seg.start || 0,
    end: seg.end || 0,
  }))

  return {
    text: result.text || segments.map(s => s.text).join(' '),
    segments,
    language: result.language || language || 'unknown',
    durationSeconds: result.duration || 0,
    provider: 'local',
    model: model || 'whisper-local',
    costUsd: 0, // Grátis
  }
}

// ============================================
// FUNÇÃO PRINCIPAL: Transcrever vídeo do YouTube
// ============================================

/**
 * Fluxo completo de transcrição ASR de um vídeo do YouTube:
 * 1. Baixa o áudio
 * 2. Transcreve via provider escolhido
 * 3. Limpa arquivo temporário
 * 4. Registra custo no relatório de tokens
 */
export async function transcribeYouTubeVideo(
  videoId: string,
  config: AsrConfig,
  companyId: string
): Promise<AsrTranscriptResult> {
  let audioPath: string | null = null

  try {
    // 1. Baixar áudio
    audioPath = await downloadYouTubeAudio(videoId)

    // 2. Transcrever
    let result: AsrTranscriptResult

    if (config.provider === 'openai') {
      if (!config.apiKey) {
        throw new Error('API key da OpenAI é necessária para transcrição via Whisper')
      }
      result = await transcribeWithOpenAI(
        audioPath,
        config.apiKey,
        config.language,
        config.model || 'whisper-1'
      )
    } else {
      if (!config.baseUrl) {
        throw new Error('URL do servidor Whisper local é necessária')
      }
      result = await transcribeWithLocalWhisper(
        audioPath,
        config.baseUrl,
        config.language,
        config.model
      )
    }

    console.log(`[ASR] Transcrição concluída: ${result.segments.length} segmentos, ${result.durationSeconds.toFixed(0)}s`)

    // 3. Registrar custo no relatório
    if (result.costUsd > 0) {
      await logAsrCost(companyId, result)
    }

    return result
  } finally {
    // 4. Limpar arquivo temporário
    if (audioPath) {
      await cleanupAudioFile(audioPath)
    }
  }
}

// ============================================
// LOG DE CUSTO NO RELATÓRIO DE TOKENS
// ============================================

async function logAsrCost(companyId: string, result: AsrTranscriptResult): Promise<void> {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Estimar tokens (1 token ≈ 4 chars no texto transcrito)
    const estimatedTokens = Math.ceil(result.text.length / 4)

    await prisma.aITokenReport.upsert({
      where: {
        companyId_agentId_instanceId_date: {
          companyId,
          agentId: '__asr__',
          instanceId: '__youtube__',
          date: today,
        },
      },
      create: {
        companyId,
        agentId: '__asr__',
        instanceId: '__youtube__',
        date: today,
        messagesCount: 1,
        sessionsCount: 0,
        promptTokens: estimatedTokens,
        completionTokens: 0,
        totalTokens: estimatedTokens,
        costUsd: result.costUsd,
        modelBreakdown: [{
          model: result.model,
          tokens: estimatedTokens,
          cost: result.costUsd,
          type: 'asr',
          provider: result.provider,
          durationSeconds: result.durationSeconds,
        }],
      },
      update: {
        messagesCount: { increment: 1 },
        promptTokens: { increment: estimatedTokens },
        totalTokens: { increment: estimatedTokens },
        costUsd: { increment: result.costUsd },
      },
    })

    console.log(`[ASR] Custo registrado: US$ ${result.costUsd.toFixed(4)} (${result.model})`)
  } catch (e) {
    console.error('[ASR] Erro ao registrar custo:', e)
  }
}

// ============================================
// TRANSCRIÇÃO DE ÁUDIO GENÉRICO (mensagens WhatsApp, etc.)
// ============================================

/**
 * Transcreve um buffer de áudio (WhatsApp, upload, etc.)
 * Não depende de yt-dlp — recebe o buffer direto
 */
export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
  config: AsrConfig,
  options?: { fileName?: string; language?: string }
): Promise<AsrTranscriptResult> {
  await ensureTempDir()
  const fileName = options?.fileName || `audio_${Date.now()}.ogg`
  const tempPath = path.join(TEMP_DIR, fileName)

  try {
    // Salvar buffer em arquivo temporário
    await fs.writeFile(tempPath, audioBuffer)

    let result: AsrTranscriptResult

    if (config.provider === 'openai') {
      if (!config.apiKey) {
        throw new Error('API key da OpenAI é necessária para transcrição via Whisper')
      }
      result = await transcribeWithOpenAI(
        tempPath,
        config.apiKey,
        options?.language || config.language,
        config.model || 'whisper-1'
      )
    } else {
      if (!config.baseUrl) {
        throw new Error('URL do servidor Whisper local é necessária')
      }
      result = await transcribeWithLocalWhisper(
        tempPath,
        config.baseUrl,
        options?.language || config.language,
        config.model
      )
    }

    return result
  } finally {
    await cleanupAudioFile(tempPath)
  }
}

/**
 * Transcreve um áudio a partir de uma URL (ex: mediaUrl de mensagem WhatsApp)
 */
export async function transcribeAudioFromUrl(
  audioUrl: string,
  config: AsrConfig,
  companyId: string,
  options?: { language?: string; instanceId?: string }
): Promise<AsrTranscriptResult> {
  console.log(`[ASR] Baixando áudio de: ${audioUrl}`)

  // Baixar o áudio da URL
  const response = await fetch(audioUrl)
  if (!response.ok) {
    throw new Error(`Falha ao baixar áudio: HTTP ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const sizeMB = buffer.length / (1024 * 1024)
  console.log(`[ASR] Áudio baixado: ${sizeMB.toFixed(1)}MB`)

  if (sizeMB > MAX_AUDIO_SIZE_MB) {
    throw new Error(`Áudio muito grande (${sizeMB.toFixed(1)}MB). Limite: ${MAX_AUDIO_SIZE_MB}MB`)
  }

  const result = await transcribeAudioBuffer(buffer, config, {
    fileName: `msg_${Date.now()}.ogg`,
    language: options?.language,
  })

  // Registrar custo
  if (result.costUsd > 0) {
    await logAsrCostMessage(companyId, result, options?.instanceId)
  }

  return result
}

export async function logAsrCostMessage(companyId: string, result: AsrTranscriptResult, instanceId?: string): Promise<void> {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const estimatedTokens = Math.ceil(result.text.length / 4)

    await prisma.aITokenReport.upsert({
      where: {
        companyId_agentId_instanceId_date: {
          companyId,
          agentId: '__asr__',
          instanceId: instanceId || '__message__',
          date: today,
        },
      },
      create: {
        companyId,
        agentId: '__asr__',
        instanceId: instanceId || '__message__',
        date: today,
        messagesCount: 1,
        sessionsCount: 0,
        promptTokens: estimatedTokens,
        completionTokens: 0,
        totalTokens: estimatedTokens,
        costUsd: result.costUsd,
        modelBreakdown: [{
          model: result.model,
          tokens: estimatedTokens,
          cost: result.costUsd,
          type: 'asr_message',
          provider: result.provider,
          durationSeconds: result.durationSeconds,
        }],
      },
      update: {
        messagesCount: { increment: 1 },
        promptTokens: { increment: estimatedTokens },
        totalTokens: { increment: estimatedTokens },
        costUsd: { increment: result.costUsd },
      },
    })
  } catch (e) {
    console.error('[ASR] Erro ao registrar custo de transcrição:', e)
  }
}

// ============================================
// VERIFICAÇÃO DE DISPONIBILIDADE DO YT-DLP
// ============================================

export async function checkYtDlpAvailable(): Promise<boolean> {
  try {
    await execAsync('yt-dlp --version', { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

/**
 * Resolve config de ASR: primeiro tenta da company (provedor configurado), depois env
 */
export async function resolveAsrConfig(companyId: string, preferredProvider?: AsrProvider): Promise<AsrConfig | null> {
  // Se o usuário escolheu local
  if (preferredProvider === 'local') {
    // Verificar se há URL de whisper local configurada na env
    const localUrl = process.env.WHISPER_LOCAL_URL || process.env.WHISPER_BASE_URL
    if (localUrl) {
      return {
        provider: 'local',
        baseUrl: localUrl,
        model: process.env.WHISPER_LOCAL_MODEL,
      }
    }
    return null
  }

  // Para OpenAI: buscar API key do provider da empresa
  const openaiProvider = await prisma.aIProvider.findFirst({
    where: {
      companyId,
      type: 'OPENAI',
      isActive: true,
    },
    select: { apiKey: true },
  })

  if (openaiProvider?.apiKey) {
    return {
      provider: 'openai',
      apiKey: openaiProvider.apiKey,
      model: 'whisper-1',
    }
  }

  // Fallback para env
  const envKey = process.env.OPENAI_API_KEY
  if (envKey) {
    return {
      provider: 'openai',
      apiKey: envKey,
      model: 'whisper-1',
    }
  }

  return null
}
