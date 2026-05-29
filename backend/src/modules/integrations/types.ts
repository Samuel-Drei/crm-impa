/**
 * Tipos compartilhados do módulo de Integrações.
 *
 * Toda integração (FishAudio, Cal.com, Google Calendar, ElevenLabs, etc)
 * implementa BaseIntegrationProvider e é registrada no provider registry.
 */

import type { CompanyIntegrationType } from '@prisma/client'

// ── Catálogo público (sem dados sensíveis) ─────────────────

export interface IntegrationCatalogEntry {
  type: CompanyIntegrationType
  name: string
  description: string
  category: 'voice' | 'calendar' | 'other'
  icon: string                  // emoji/short name (frontend renderiza)
  docsUrl: string
  capabilities: IntegrationCapability[]
  credentialFields: CredentialField[]
}

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

// ── Resultados padronizados ─────────────────────────────────

export interface TestResult {
  ok: boolean
  message: string
  details?: any
}

export interface TtsRequest {
  text: string
  modelId?: string             // ID da voz (ex: FishAudio reference_id)
  format?: 'mp3' | 'opus' | 'wav' | 'ogg'
  speed?: number
  language?: string
}

export interface TtsResult {
  audio: Buffer
  contentType: string
  durationMs?: number
}

export interface SttRequest {
  audio: Buffer
  contentType: string
  language?: string
  model?: string
}

export interface SttResult {
  text: string
  language?: string
  durationMs?: number
}

// Cal.com / agenda
export interface CalendarEventType {
  id: string
  slug: string
  title: string
  durationMinutes?: number
  scope?: string               // ex: "user/john" ou "team/clinica-centro"
  description?: string
}

export interface CalendarSlot {
  start: string                // ISO
  end: string
  attendees?: number
}

export interface CalendarBookingRequest {
  eventTypeId: string
  start: string                // ISO
  attendee: { name: string; email: string; phone?: string; timezone?: string }
  notes?: string
  metadata?: Record<string, any>
}

export interface CalendarBooking {
  id: string
  uid?: string
  status: string
  start: string
  end: string
  eventTypeId: string
  attendees: Array<{ name: string; email: string }>
  meetingUrl?: string
}

// Voice training
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

export interface CreateVoiceModelRequest {
  name: string
  description?: string
  visibility?: 'private' | 'public' | 'unlist'
  voices: Array<{ audio: Buffer; contentType: string; filename?: string; transcript?: string }>
  tags?: string[]
}

// ── Provider abstrato ───────────────────────────────────────

export abstract class BaseIntegrationProvider {
  abstract readonly type: CompanyIntegrationType
  abstract readonly catalog: IntegrationCatalogEntry

  /** Valida credenciais com chamada leve ao serviço externo. */
  abstract test(credentials: Record<string, any>): Promise<TestResult>

  // — Voz —
  tts?(credentials: Record<string, any>, req: TtsRequest): Promise<TtsResult>
  stt?(credentials: Record<string, any>, req: SttRequest): Promise<SttResult>

  // — Voice models (treino) —
  listVoiceModels?(credentials: Record<string, any>, params?: { search?: string }): Promise<VoiceModel[]>
  getVoiceModel?(credentials: Record<string, any>, id: string): Promise<VoiceModel>
  createVoiceModel?(credentials: Record<string, any>, req: CreateVoiceModelRequest): Promise<VoiceModel>
  updateVoiceModel?(credentials: Record<string, any>, id: string, patch: Partial<VoiceModel>): Promise<VoiceModel>
  deleteVoiceModel?(credentials: Record<string, any>, id: string): Promise<void>

  // — Calendário —
  listEventTypes?(credentials: Record<string, any>): Promise<CalendarEventType[]>
  getAvailableSlots?(credentials: Record<string, any>, eventTypeId: string, dateFrom: string, dateTo: string, timezone?: string): Promise<CalendarSlot[]>
  createBooking?(credentials: Record<string, any>, req: CalendarBookingRequest): Promise<CalendarBooking>
  listBookings?(credentials: Record<string, any>, params?: { attendeeEmail?: string; status?: string }): Promise<CalendarBooking[]>
  cancelBooking?(credentials: Record<string, any>, bookingId: string, reason?: string): Promise<void>
  rescheduleBooking?(credentials: Record<string, any>, bookingId: string, newStart: string, reason?: string): Promise<CalendarBooking>
}
