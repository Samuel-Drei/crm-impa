/**
 * voice-runtime.ts
 *
 * Helpers de runtime para Voz (TTS) e Transcrição (STT) usados pela camada
 * de integração WhatsApp da IA. Centraliza:
 *  - Decisão sobre enviar audio vs texto baseado em voiceConfig.mode
 *  - Chamada ao provider (FishAudio, OpenAI, etc) para sintetizar audio
 *  - Transcrição de audio recebido usando agent.sttConfig OU instance.sttConfig
 *
 * Toda chamada respeita o sistema de Integrações (envelope encryption,
 * trackUsage, status ACTIVE) e suporta integrações virtuais derivadas de
 * AIProviders (`aiprovider:<id>`) — evita duplicar credencial OpenAI.
 */

import {
  resolveIntegrationForRuntime,
  trackUsage,
} from '../integrations/integration.service.js'
import { getProvider } from '../integrations/registry.js'

export interface VoiceConfig {
  integrationId: string
  voiceId?: string | null
  mode?: 'AI_DECIDES' | 'ALWAYS_AUDIO' | 'ALWAYS_TEXT' | 'AUTO_WHEN_RECEIVED_AUDIO'
  conditions?: string | null
  format?: 'mp3' | 'wav' | 'opus'
  sampleRate?: number
}

export interface SttConfig {
  integrationId: string
  language?: string | null
  ignoreTimestamps?: boolean
}

export interface SynthesizeResult {
  buffer: Buffer
  mimeType: string
}

// ───────────────────────── decisão TTS ─────────────────────────

/**
 * Decide se a resposta deve ser enviada como audio (TTS).
 * incomingType vem do tipo da mensagem recebida ('audio' indica o cliente mandou audio).
 */
export function shouldSpeakReply(
  voiceConfig: VoiceConfig | null | undefined,
  incomingType: string | undefined,
): boolean {
  if (!voiceConfig?.integrationId) return false
  const mode = voiceConfig.mode || 'AI_DECIDES'
  if (mode === 'ALWAYS_TEXT') return false
  if (mode === 'ALWAYS_AUDIO') return true
  if (mode === 'AUTO_WHEN_RECEIVED_AUDIO') return incomingType === 'audio' || incomingType === 'audioMessage'
  // AI_DECIDES: por padrão não manda audio (versão futura: detectar marcador da IA)
  return false
}

// ───────────────────────── TTS ─────────────────────────

/**
 * Sintetiza texto em audio usando voiceConfig do agente.
 * Retorna Buffer + mimetype para envio direto via Baileys.
 * Lança erro caso falhe — caller deve fazer fallback para texto.
 */
export async function synthesizeReply(params: {
  text: string
  voiceConfig: VoiceConfig
  companyId: string
}): Promise<SynthesizeResult> {
  const { text, voiceConfig, companyId } = params
  const integration = await resolveIntegrationForRuntime(companyId, voiceConfig.integrationId)
  if (!integration) {
    throw new Error(`Integration ${voiceConfig.integrationId} not found for company ${companyId}`)
  }
  if (integration.status !== 'ACTIVE') {
    throw new Error(`Integration ${integration.name} is not ACTIVE (status=${integration.status})`)
  }

  const provider = getProvider(integration.type)
  if (typeof (provider as any).tts !== 'function') {
    throw new Error(`Integration ${integration.name} does not support TTS`)
  }

  let success = true
  try {
    const result = await (provider as any).tts(integration.credentials, {
      text,
      modelId: voiceConfig.voiceId || undefined,
      format: voiceConfig.format || 'mp3',
    })
    return {
      buffer: result.audio,
      mimeType: result.contentType || 'audio/mpeg',
    }
  } catch (err) {
    success = false
    throw err
  } finally {
    await trackUsage(integration.id, success).catch(() => {})
  }
}

// ───────────────────────── STT ─────────────────────────

/**
 * Transcreve audio para texto usando sttConfig.
 */
export async function transcribeAudio(params: {
  audio: Buffer
  contentType?: string
  sttConfig: SttConfig
  companyId: string
}): Promise<{ text: string; language?: string; durationMs?: number }> {
  const { audio, contentType, sttConfig, companyId } = params
  const integration = await resolveIntegrationForRuntime(companyId, sttConfig.integrationId)
  if (!integration) {
    throw new Error(`Integration ${sttConfig.integrationId} not found for company ${companyId}`)
  }
  if (integration.status !== 'ACTIVE') {
    throw new Error(`Integration ${integration.name} is not ACTIVE (status=${integration.status})`)
  }

  const provider = getProvider(integration.type)
  if (typeof (provider as any).stt !== 'function') {
    throw new Error(`Integration ${integration.name} does not support STT`)
  }

  let success = true
  try {
    const result = await (provider as any).stt(integration.credentials, {
      audio,
      contentType: contentType || 'audio/ogg',
      language: sttConfig.language || undefined,
    })
    return {
      text: result.text || '',
      language: result.language,
      durationMs: result.durationMs,
    }
  } catch (err) {
    success = false
    throw err
  } finally {
    await trackUsage(integration.id, success).catch(() => {})
  }
}
