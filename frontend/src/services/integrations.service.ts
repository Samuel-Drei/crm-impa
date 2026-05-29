import api from './api'

// ════════════════════════════════════════════════════════════════════
// Tipos públicos do módulo de Integrações
// ════════════════════════════════════════════════════════════════════

export type CompanyIntegrationType =
  | 'FISHAUDIO'
  | 'ELEVENLABS'
  | 'OPENAI'
  | 'CALCOM'
  | 'GOOGLE_CALENDAR'
  | 'CUSTOM'

export type CompanyIntegrationStatus = 'ACTIVE' | 'INACTIVE' | 'ERROR'

export type IntegrationCapability =
  | 'tts'
  | 'stt'
  | 'voice_models_crud'
  | 'list_event_types'
  | 'get_available_slots'
  | 'create_booking'
  | 'list_bookings'
  | 'cancel_booking'
  | 'reschedule_booking'

export interface CredentialField {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  required: boolean
  placeholder?: string
  helpText?: string
}

export interface IntegrationCatalogEntry {
  type: CompanyIntegrationType
  name: string
  description: string
  category: 'voice' | 'calendar' | 'other'
  icon: string
  docsUrl: string
  capabilities: IntegrationCapability[]
  credentialFields: CredentialField[]
}

export interface CompanyIntegration {
  id: string
  companyId: string
  type: CompanyIntegrationType
  name: string
  description: string | null
  status: CompanyIntegrationStatus
  config: any
  capabilities: IntegrationCapability[] | null
  credentialsMasked: Record<string, string>
  lastTestedAt: string | null
  lastError: string | null
  lastUsageAt: string | null
  totalRequests: number
  failedRequests: number
  createdAt: string
  updatedAt: string
}

export interface VoiceModel {
  id: string
  name: string
  type?: string
  visibility?: 'private' | 'public' | 'unlist'
  tags?: string[]
  state?: string
  createdAt?: string
  description?: string
  coverImageUrl?: string
}

export interface CalendarEventType {
  id: string
  slug: string
  title: string
  durationMinutes?: number
  scope?: string
  description?: string
}

// ════════════════════════════════════════════════════════════════════
// API helpers
// ════════════════════════════════════════════════════════════════════

export const integrationsService = {
  catalog: async () => {
    const { data } = await api.get<{ items: IntegrationCatalogEntry[] }>('/integrations/catalog')
    return data.items
  },

  list: async (filter?: { type?: CompanyIntegrationType }) => {
    const { data } = await api.get<{ items: CompanyIntegration[] }>('/integrations', { params: filter })
    return data.items
  },

  get: async (id: string) => {
    const { data } = await api.get<CompanyIntegration>(`/integrations/${id}`)
    return data
  },

  create: async (input: {
    type: CompanyIntegrationType
    name: string
    description?: string
    credentials: Record<string, any>
    config?: any
  }) => {
    const { data } = await api.post<CompanyIntegration>('/integrations', input)
    return data
  },

  update: async (
    id: string,
    patch: {
      name?: string
      description?: string
      credentials?: Record<string, any>
      config?: any
      status?: CompanyIntegrationStatus
    },
  ) => {
    const { data } = await api.put<CompanyIntegration>(`/integrations/${id}`, patch)
    return data
  },

  delete: async (id: string) => {
    await api.delete(`/integrations/${id}`)
  },

  test: async (id: string) => {
    const { data } = await api.post<{ ok: boolean; message: string; details?: any }>(`/integrations/${id}/test`)
    return data
  },

  // FishAudio voice models
  listVoiceModels: async (id: string, search?: string) => {
    const { data } = await api.get<{ items: VoiceModel[] }>(`/integrations/${id}/voice-models`, {
      params: search ? { search } : undefined,
    })
    return data.items
  },

  createVoiceModel: async (
    id: string,
    payload: { name: string; description?: string; visibility?: 'private' | 'public' | 'unlist'; voices: File[]; tags?: string[] },
  ) => {
    const form = new FormData()
    form.append('name', payload.name)
    if (payload.description) form.append('description', payload.description)
    if (payload.visibility) form.append('visibility', payload.visibility)
    if (payload.tags?.length) form.append('tags', JSON.stringify(payload.tags))
    for (const f of payload.voices) form.append('voices', f, f.name)
    const { data } = await api.post<VoiceModel>(`/integrations/${id}/voice-models`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  deleteVoiceModel: async (id: string, voiceId: string) => {
    await api.delete(`/integrations/${id}/voice-models/${voiceId}`)
  },

  // Cal.com event types
  listEventTypes: async (id: string) => {
    const { data } = await api.get<{ items: CalendarEventType[] }>(`/integrations/${id}/event-types`)
    return data.items
  },
}
