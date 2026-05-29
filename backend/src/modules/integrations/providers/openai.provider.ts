/**
 * OpenAI Integration Provider.
 *
 * Capabilities: TTS (gpt-4o-mini-tts / tts-1 / tts-1-hd) e STT (whisper-1 / gpt-4o-transcribe).
 * Docs:
 *  - TTS: https://platform.openai.com/docs/api-reference/audio/createSpeech
 *  - STT: https://platform.openai.com/docs/api-reference/audio/createTranscription
 *
 * Observação: as vozes do TTS da OpenAI são fixas (alloy, ash, ballad, coral, echo,
 * fable, nova, onyx, sage, shimmer), portanto `listVoiceModels` retorna o catálogo
 * estático e não há criação/edição/remoção (CRUD desabilitado).
 */

import {
  BaseIntegrationProvider,
  type IntegrationCatalogEntry,
  type TestResult,
  type TtsRequest,
  type TtsResult,
  type SttRequest,
  type SttResult,
  type VoiceModel,
} from '../types.js'
import type { CompanyIntegrationType } from '@prisma/client'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

const OPENAI_VOICES: Array<{ id: string; name: string; description: string }> = [
  { id: 'alloy',   name: 'Alloy',   description: 'Voz neutra e versátil' },
  { id: 'ash',     name: 'Ash',     description: 'Voz masculina natural' },
  { id: 'ballad',  name: 'Ballad',  description: 'Voz suave e expressiva' },
  { id: 'coral',   name: 'Coral',   description: 'Voz feminina calorosa' },
  { id: 'echo',    name: 'Echo',    description: 'Voz masculina articulada' },
  { id: 'fable',   name: 'Fable',   description: 'Voz com sotaque britânico' },
  { id: 'nova',    name: 'Nova',    description: 'Voz feminina jovem e brilhante' },
  { id: 'onyx',    name: 'Onyx',    description: 'Voz masculina profunda' },
  { id: 'sage',    name: 'Sage',    description: 'Voz calma e refinada' },
  { id: 'shimmer', name: 'Shimmer', description: 'Voz feminina suave' },
]

export class OpenAIProvider extends BaseIntegrationProvider {
  readonly type: CompanyIntegrationType = 'OPENAI'

  readonly catalog: IntegrationCatalogEntry = {
    type: 'OPENAI',
    name: 'OpenAI Audio',
    description: 'Síntese de voz (TTS) com vozes naturais e transcrição (Whisper / gpt-4o-transcribe).',
    category: 'voice',
    icon: '🤖',
    docsUrl: 'https://platform.openai.com/docs/guides/text-to-speech',
    capabilities: ['tts', 'stt'],
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 'sk-...',
        helpText: 'Gere em https://platform.openai.com/api-keys.',
      },
      {
        key: 'baseUrl',
        label: 'Base URL (opcional)',
        type: 'url',
        required: false,
        placeholder: DEFAULT_BASE_URL,
        helpText: 'Para gateways compatíveis (Azure OpenAI, proxies). Deixe em branco para usar a OpenAI oficial.',
      },
      {
        key: 'ttsModel',
        label: 'Modelo TTS padrão (opcional)',
        type: 'text',
        required: false,
        placeholder: 'gpt-4o-mini-tts',
        helpText: 'Padrão: gpt-4o-mini-tts. Alternativas: tts-1, tts-1-hd.',
      },
      {
        key: 'sttModel',
        label: 'Modelo STT padrão (opcional)',
        type: 'text',
        required: false,
        placeholder: 'gpt-4o-mini-transcribe',
        helpText: 'Padrão: gpt-4o-mini-transcribe. Alternativas: whisper-1, gpt-4o-transcribe.',
      },
    ],
  }

  private base(creds: Record<string, any>): string {
    const url = (creds.baseUrl as string | undefined)?.trim()
    return url && url.length > 0 ? url.replace(/\/+$/, '') : DEFAULT_BASE_URL
  }

  private headers(creds: Record<string, any>, contentType?: string): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Bearer ${creds.apiKey}` }
    if (contentType) h['Content-Type'] = contentType
    return h
  }

  async test(credentials: Record<string, any>): Promise<TestResult> {
    if (!credentials?.apiKey) return { ok: false, message: 'API Key obrigatória' }
    try {
      const res = await fetch(`${this.base(credentials)}/models`, { headers: this.headers(credentials) })
      if (!res.ok) {
        return { ok: false, message: `HTTP ${res.status} — ${await res.text().catch(() => '')}`.slice(0, 200) }
      }
      return { ok: true, message: 'Conectado com sucesso' }
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Falha de rede' }
    }
  }

  async tts(credentials: Record<string, any>, req: TtsRequest): Promise<TtsResult> {
    const format = req.format || 'mp3'
    const voice = req.modelId || 'alloy'
    const model = (credentials.ttsModel as string | undefined) || 'gpt-4o-mini-tts'

    const body: Record<string, any> = {
      model,
      voice,
      input: req.text,
      response_format: format === 'ogg' ? 'opus' : format,
    }
    if (typeof req.speed === 'number' && req.speed > 0) body.speed = req.speed

    const res = await fetch(`${this.base(credentials)}/audio/speech`, {
      method: 'POST',
      headers: { ...this.headers(credentials, 'application/json'), Accept: 'audio/*' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`OpenAI TTS HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }
    const audio = Buffer.from(await res.arrayBuffer())
    const contentType =
      format === 'mp3' ? 'audio/mpeg' :
      format === 'wav' ? 'audio/wav' :
      format === 'opus' || format === 'ogg' ? 'audio/ogg' :
      'application/octet-stream'
    return { audio, contentType }
  }

  async stt(credentials: Record<string, any>, req: SttRequest): Promise<SttResult> {
    const model = req.model || (credentials.sttModel as string | undefined) || 'gpt-4o-mini-transcribe'

    const form = new FormData()
    const ext =
      req.contentType?.includes('mpeg') ? 'mp3' :
      req.contentType?.includes('wav')  ? 'wav' :
      req.contentType?.includes('ogg')  ? 'ogg' :
      req.contentType?.includes('webm') ? 'webm' :
      req.contentType?.includes('mp4') || req.contentType?.includes('m4a') ? 'm4a' :
      'ogg'
    form.append('file', new Blob([req.audio], { type: req.contentType || 'audio/ogg' }), `audio.${ext}`)
    form.append('model', model)
    if (req.language) form.append('language', req.language)
    form.append('response_format', 'json')

    const res = await fetch(`${this.base(credentials)}/audio/transcriptions`, {
      method: 'POST',
      headers: this.headers(credentials),
      body: form as any,
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`OpenAI STT HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }
    const data = await res.json() as any
    return {
      text: data.text || '',
      language: data.language,
      durationMs: data.duration ? Math.round(data.duration * 1000) : undefined,
    }
  }

  async listVoiceModels(_credentials: Record<string, any>, params?: { search?: string }): Promise<VoiceModel[]> {
    const q = (params?.search || '').toLowerCase().trim()
    const list = q
      ? OPENAI_VOICES.filter(v => v.name.toLowerCase().includes(q) || v.id.includes(q))
      : OPENAI_VOICES
    return list.map(v => ({
      id: v.id,
      name: v.name,
      type: 'tts',
      visibility: 'public',
      description: v.description,
      state: 'ready',
    }))
  }
}
