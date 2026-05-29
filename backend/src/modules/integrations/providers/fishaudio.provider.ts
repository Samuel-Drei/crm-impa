/**
 * FishAudio Integration Provider.
 *
 * Capabilities: TTS, STT, Voice Models CRUD.
 * Docs: https://docs.fish.audio/api-reference
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
  type CreateVoiceModelRequest,
} from '../types.js'
import type { CompanyIntegrationType } from '@prisma/client'

const BASE_URL = 'https://api.fish.audio'

export class FishAudioProvider extends BaseIntegrationProvider {
  readonly type: CompanyIntegrationType = 'FISHAUDIO'

  readonly catalog: IntegrationCatalogEntry = {
    type: 'FISHAUDIO',
    name: 'Fish Audio',
    description: 'Text-to-Speech (vozes naturais), Speech-to-Text e treino de vozes personalizadas.',
    category: 'voice',
    icon: '🐟',
    docsUrl: 'https://docs.fish.audio/api-reference',
    capabilities: ['tts', 'stt', 'voice_models_crud'],
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 'fa-xxxxxxxxxxxxxxxx',
        helpText: 'Gere em https://fish.audio (Settings → API Keys).',
      },
    ],
  }

  private headers(creds: Record<string, any>, contentType?: string): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Bearer ${creds.apiKey}` }
    if (contentType) h['Content-Type'] = contentType
    return h
  }

  async test(credentials: Record<string, any>): Promise<TestResult> {
    if (!credentials?.apiKey) return { ok: false, message: 'API Key obrigatória' }
    try {
      // List models é endpoint leve e autenticado
      const res = await fetch(`${BASE_URL}/model?page_size=1`, { headers: this.headers(credentials) })
      if (!res.ok) {
        return { ok: false, message: `HTTP ${res.status} — ${await res.text().catch(() => '')}`.slice(0, 200) }
      }
      return { ok: true, message: 'Conectado com sucesso' }
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Falha de rede' }
    }
  }

  async tts(credentials: Record<string, any>, req: TtsRequest): Promise<TtsResult> {
    const body: any = {
      text: req.text,
      format: req.format || 'mp3',
    }
    if (req.modelId) body.reference_id = req.modelId

    const res = await fetch(`${BASE_URL}/v1/tts`, {
      method: 'POST',
      headers: { ...this.headers(credentials, 'application/json'), Accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`FishAudio TTS HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }
    const audio = Buffer.from(await res.arrayBuffer())
    return {
      audio,
      contentType: `audio/${body.format === 'opus' ? 'ogg' : body.format}`,
    }
  }

  async stt(credentials: Record<string, any>, req: SttRequest): Promise<SttResult> {
    // FishAudio STT: multipart/form-data com 'audio' file
    const form = new FormData()
    form.append('audio', new Blob([req.audio], { type: req.contentType || 'audio/ogg' }), 'audio')
    if (req.language) form.append('language', req.language)
    if (req.model) form.append('model', req.model)

    const res = await fetch(`${BASE_URL}/v1/asr`, {
      method: 'POST',
      headers: this.headers(credentials),
      body: form as any,
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`FishAudio STT HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }
    const data = await res.json() as any
    return {
      text: data.text || data.transcript || '',
      language: data.language,
      durationMs: data.duration ? Math.round(data.duration * 1000) : undefined,
    }
  }

  async listVoiceModels(credentials: Record<string, any>, params?: { search?: string }): Promise<VoiceModel[]> {
    const url = new URL(`${BASE_URL}/model`)
    url.searchParams.set('self', 'true')
    url.searchParams.set('page_size', '100')
    if (params?.search) url.searchParams.set('title', params.search)

    const res = await fetch(url, { headers: this.headers(credentials) })
    if (!res.ok) throw new Error(`FishAudio list models HTTP ${res.status}`)
    const data = await res.json() as any
    return (data.items || []).map((m: any) => this.mapVoiceModel(m))
  }

  async getVoiceModel(credentials: Record<string, any>, id: string): Promise<VoiceModel> {
    const res = await fetch(`${BASE_URL}/model/${id}`, { headers: this.headers(credentials) })
    if (!res.ok) throw new Error(`FishAudio get model HTTP ${res.status}`)
    return this.mapVoiceModel(await res.json())
  }

  async createVoiceModel(credentials: Record<string, any>, req: CreateVoiceModelRequest): Promise<VoiceModel> {
    const form = new FormData()
    form.append('title', req.name)
    if (req.description) form.append('description', req.description)
    form.append('type', 'tts')
    form.append('train_mode', 'fast')
    form.append('visibility', req.visibility || 'private')
    if (req.tags?.length) form.append('tags', JSON.stringify(req.tags))
    for (const v of req.voices) {
      form.append('voices', new Blob([v.audio], { type: v.contentType }), v.filename || 'voice.mp3')
      if (v.transcript) form.append('texts', v.transcript)
    }
    const res = await fetch(`${BASE_URL}/model`, {
      method: 'POST',
      headers: this.headers(credentials),
      body: form as any,
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`FishAudio create model HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }
    return this.mapVoiceModel(await res.json())
  }

  async updateVoiceModel(credentials: Record<string, any>, id: string, patch: Partial<VoiceModel>): Promise<VoiceModel> {
    const body: any = {}
    if (patch.name !== undefined) body.title = patch.name
    if (patch.description !== undefined) body.description = patch.description
    if (patch.visibility !== undefined) body.visibility = patch.visibility
    if (patch.tags !== undefined) body.tags = patch.tags

    const res = await fetch(`${BASE_URL}/model/${id}`, {
      method: 'PATCH',
      headers: this.headers(credentials, 'application/json'),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`FishAudio update model HTTP ${res.status}`)
    return this.mapVoiceModel(await res.json())
  }

  async deleteVoiceModel(credentials: Record<string, any>, id: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/model/${id}`, {
      method: 'DELETE',
      headers: this.headers(credentials),
    })
    if (!res.ok) throw new Error(`FishAudio delete model HTTP ${res.status}`)
  }

  private mapVoiceModel(m: any): VoiceModel {
    return {
      id: m._id || m.id,
      name: m.title || m.name,
      type: m.type,
      visibility: m.visibility,
      tags: m.tags,
      state: m.state,
      createdAt: m.created_at || m.createdAt,
      description: m.description,
      coverImageUrl: m.cover_image,
    }
  }
}
