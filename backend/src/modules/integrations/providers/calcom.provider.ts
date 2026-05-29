/**
 * Cal.com v2 Integration Provider.
 *
 * Docs: https://cal.com/docs/api-reference/v2/introduction
 * Endpoints usados:
 *   GET  /v2/event-types
 *   GET  /v2/slots/available
 *   POST /v2/bookings
 *   GET  /v2/bookings
 *   POST /v2/bookings/{uid}/cancel
 *   POST /v2/bookings/{uid}/reschedule
 */

import {
  BaseIntegrationProvider,
  type IntegrationCatalogEntry,
  type TestResult,
  type CalendarEventType,
  type CalendarSlot,
  type CalendarBooking,
  type CalendarBookingRequest,
} from '../types.js'
import type { CompanyIntegrationType } from '@prisma/client'

const DEFAULT_BASE_URL = 'https://api.cal.com'
const API_VERSION = '2024-08-13'

export class CalComProvider extends BaseIntegrationProvider {
  readonly type: CompanyIntegrationType = 'CALCOM'

  readonly catalog: IntegrationCatalogEntry = {
    type: 'CALCOM',
    name: 'Cal.com',
    description: 'Agendamento online — múltiplas agendas (event types) por agente. A IA pode listar horários, agendar, remarcar e cancelar.',
    category: 'calendar',
    icon: '📅',
    docsUrl: 'https://cal.com/docs/api-reference/v2/introduction',
    capabilities: [
      'list_event_types',
      'get_available_slots',
      'create_booking',
      'list_bookings',
      'cancel_booking',
      'reschedule_booking',
    ],
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        placeholder: 'cal_live_xxxxxxxxxx',
        helpText: 'Settings → Developer → API Keys em https://app.cal.com',
      },
      {
        key: 'baseUrl',
        label: 'Base URL (opcional)',
        type: 'url',
        required: false,
        placeholder: DEFAULT_BASE_URL,
        helpText: 'Customize apenas para self-hosted Cal.com.',
      },
    ],
  }

  private base(creds: Record<string, any>): string {
    return (creds.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  }

  private headers(creds: Record<string, any>): Record<string, string> {
    return {
      Authorization: `Bearer ${creds.apiKey}`,
      'cal-api-version': API_VERSION,
      'Content-Type': 'application/json',
    }
  }

  async test(credentials: Record<string, any>): Promise<TestResult> {
    if (!credentials?.apiKey) return { ok: false, message: 'API Key obrigatória' }
    try {
      const res = await fetch(`${this.base(credentials)}/v2/me`, { headers: this.headers(credentials) })
      if (!res.ok) {
        return { ok: false, message: `HTTP ${res.status} — ${await res.text().catch(() => '')}`.slice(0, 200) }
      }
      const data = await res.json() as any
      const user = data?.data || data
      return { ok: true, message: `Conectado como ${user?.email || user?.username || 'usuário Cal.com'}`, details: user }
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Falha de rede' }
    }
  }

  async listEventTypes(credentials: Record<string, any>): Promise<CalendarEventType[]> {
    const res = await fetch(`${this.base(credentials)}/v2/event-types`, { headers: this.headers(credentials) })
    if (!res.ok) throw new Error(`Cal.com event-types HTTP ${res.status}`)
    const data = await res.json() as any
    const items = Array.isArray(data?.data?.eventTypeGroups)
      ? data.data.eventTypeGroups.flatMap((g: any) =>
          (g.eventTypes || []).map((et: any) => this.mapEventType(et, g.profile?.slug || g.profile?.name))
        )
      : Array.isArray(data?.data) ? data.data.map((et: any) => this.mapEventType(et)) : []
    return items
  }

  async getAvailableSlots(
    credentials: Record<string, any>,
    eventTypeId: string,
    dateFrom: string,
    dateTo: string,
    timezone?: string,
  ): Promise<CalendarSlot[]> {
    const url = new URL(`${this.base(credentials)}/v2/slots/available`)
    url.searchParams.set('eventTypeId', eventTypeId)
    url.searchParams.set('startTime', dateFrom)
    url.searchParams.set('endTime', dateTo)
    if (timezone) url.searchParams.set('timeZone', timezone)

    const res = await fetch(url, { headers: this.headers(credentials) })
    if (!res.ok) throw new Error(`Cal.com slots HTTP ${res.status}`)
    const data = await res.json() as any
    const slotsByDay = data?.data?.slots || data?.slots || {}
    const flat: CalendarSlot[] = []
    for (const day of Object.keys(slotsByDay)) {
      for (const s of slotsByDay[day]) {
        flat.push({ start: s.time || s.start, end: s.end || s.time, attendees: s.attendees })
      }
    }
    return flat
  }

  async createBooking(credentials: Record<string, any>, req: CalendarBookingRequest): Promise<CalendarBooking> {
    const body = {
      eventTypeId: Number(req.eventTypeId),
      start: req.start,
      attendee: {
        name: req.attendee.name,
        email: req.attendee.email,
        timeZone: req.attendee.timezone || 'America/Sao_Paulo',
        ...(req.attendee.phone ? { phoneNumber: req.attendee.phone } : {}),
      },
      ...(req.notes ? { bookingFieldsResponses: { notes: req.notes } } : {}),
      ...(req.metadata ? { metadata: req.metadata } : {}),
    }
    const res = await fetch(`${this.base(credentials)}/v2/bookings`, {
      method: 'POST',
      headers: this.headers(credentials),
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Cal.com booking HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }
    const data = await res.json() as any
    return this.mapBooking(data?.data || data)
  }

  async listBookings(credentials: Record<string, any>, params?: { attendeeEmail?: string; status?: string }): Promise<CalendarBooking[]> {
    const url = new URL(`${this.base(credentials)}/v2/bookings`)
    if (params?.attendeeEmail) url.searchParams.set('attendeeEmail', params.attendeeEmail)
    if (params?.status) url.searchParams.set('status', params.status)

    const res = await fetch(url, { headers: this.headers(credentials) })
    if (!res.ok) throw new Error(`Cal.com list bookings HTTP ${res.status}`)
    const data = await res.json() as any
    return (data?.data || []).map((b: any) => this.mapBooking(b))
  }

  async cancelBooking(credentials: Record<string, any>, bookingUid: string, reason?: string): Promise<void> {
    const res = await fetch(`${this.base(credentials)}/v2/bookings/${bookingUid}/cancel`, {
      method: 'POST',
      headers: this.headers(credentials),
      body: JSON.stringify({ cancellationReason: reason || 'Cancelado pelo agente IA' }),
    })
    if (!res.ok) throw new Error(`Cal.com cancel booking HTTP ${res.status}`)
  }

  async rescheduleBooking(credentials: Record<string, any>, bookingUid: string, newStart: string, reason?: string): Promise<CalendarBooking> {
    const res = await fetch(`${this.base(credentials)}/v2/bookings/${bookingUid}/reschedule`, {
      method: 'POST',
      headers: this.headers(credentials),
      body: JSON.stringify({ start: newStart, reschedulingReason: reason || 'Remarcado pelo agente IA' }),
    })
    if (!res.ok) throw new Error(`Cal.com reschedule HTTP ${res.status}`)
    const data = await res.json() as any
    return this.mapBooking(data?.data || data)
  }

  // ── helpers ─────────────────────────────────────────────

  private mapEventType(et: any, scope?: string): CalendarEventType {
    return {
      id: String(et.id),
      slug: et.slug,
      title: et.title,
      durationMinutes: et.lengthInMinutes || et.length,
      scope,
      description: et.description,
    }
  }

  private mapBooking(b: any): CalendarBooking {
    return {
      id: String(b.id),
      uid: b.uid,
      status: b.status,
      start: b.start,
      end: b.end,
      eventTypeId: String(b.eventTypeId || b.eventType?.id || ''),
      attendees: (b.attendees || []).map((a: any) => ({ name: a.name, email: a.email })),
      meetingUrl: b.meetingUrl || b.location,
    }
  }
}
