/**
 * Calendar Tools Module — Ferramentas de agendamento (Cal.com, Google Calendar)
 *
 * Configuração no agente (calendarConfig):
 * {
 *   integrationId: string,            // ID da CompanyIntegration (CALCOM)
 *   eventTypes: [{ id, slug, title, label?, scope? }],
 *   defaultEventTypeId?: string,
 *   tools: {
 *     list_event_types: boolean,
 *     get_available_slots: boolean,
 *     create_booking: boolean,
 *     list_bookings: boolean,
 *     cancel_booking: boolean,
 *     reschedule_booking: boolean,
 *   }
 * }
 */

import type { AIToolDefinition } from '../../providers/base.provider.js'
import type { ToolModule, ToolExecutionContext, ToolExecutionResult } from '../tool-engine.js'
import { prisma } from '../../../../config/database.js'
import { getProvider } from '../../../integrations/registry.js'
import { getDecryptedCredentials, trackUsage } from '../../../integrations/integration.service.js'

export interface CalendarToolsConfig {
  integrationId: string
  eventTypes?: Array<{ id: string; slug?: string; title?: string; label?: string; scope?: string }>
  defaultEventTypeId?: string
  tools?: {
    list_event_types?: boolean
    get_available_slots?: boolean
    create_booking?: boolean
    list_bookings?: boolean
    cancel_booking?: boolean
    reschedule_booking?: boolean
  }
}

const TOOL_DEFAULTS = {
  list_event_types: true,
  get_available_slots: true,
  create_booking: true,
  list_bookings: true,
  cancel_booking: true,
  reschedule_booking: true,
}

// ── Tool definitions ─────────────────────────────────────────────

const TOOL_DEFS: Record<string, AIToolDefinition> = {
  list_event_types: {
    name: 'calendar_list_event_types',
    description: 'Lista os tipos de evento (agendas) disponíveis no calendário. Use ANTES de agendar para descobrir os IDs e durações dos serviços oferecidos.',
    parameters: { type: 'object', properties: {} },
  },
  get_available_slots: {
    name: 'calendar_get_available_slots',
    description: 'Retorna horários disponíveis para um determinado tipo de evento em uma janela de datas (ISO 8601). Use para sugerir horários ao cliente antes de agendar.',
    parameters: {
      type: 'object',
      properties: {
        event_type_id: { type: 'string', description: 'ID do tipo de evento (obtido em calendar_list_event_types)' },
        date_from: { type: 'string', description: 'Data/hora inicial em ISO 8601 (ex: 2026-04-25T00:00:00Z)' },
        date_to: { type: 'string', description: 'Data/hora final em ISO 8601 (ex: 2026-04-30T23:59:59Z)' },
        timezone: { type: 'string', description: 'Timezone IANA (default: America/Sao_Paulo)', required: false },
      },
      required: ['event_type_id', 'date_from', 'date_to'],
    },
  },
  create_booking: {
    name: 'calendar_create_booking',
    description: 'Cria um agendamento. SEMPRE confirme com o cliente o horário, nome e email antes de chamar.',
    parameters: {
      type: 'object',
      properties: {
        event_type_id: { type: 'string', description: 'ID do tipo de evento' },
        start: { type: 'string', description: 'Início do agendamento em ISO 8601' },
        attendee_name: { type: 'string', description: 'Nome do cliente' },
        attendee_email: { type: 'string', description: 'Email do cliente (obrigatório)' },
        attendee_phone: { type: 'string', description: 'Telefone (opcional)', required: false },
        timezone: { type: 'string', description: 'Timezone IANA do cliente (default: America/Sao_Paulo)', required: false },
        notes: { type: 'string', description: 'Observações adicionais (opcional)', required: false },
      },
      required: ['event_type_id', 'start', 'attendee_name', 'attendee_email'],
    },
  },
  list_bookings: {
    name: 'calendar_list_bookings',
    description: 'Lista agendamentos existentes. Filtre por email do cliente para mostrar APENAS os agendamentos dele.',
    parameters: {
      type: 'object',
      properties: {
        attendee_email: { type: 'string', description: 'Filtrar por email do participante', required: false },
        status: { type: 'string', description: 'Status: upcoming | past | cancelled', required: false },
      },
    },
  },
  cancel_booking: {
    name: 'calendar_cancel_booking',
    description: 'Cancela um agendamento existente. Confirme com o cliente antes de chamar.',
    parameters: {
      type: 'object',
      properties: {
        booking_uid: { type: 'string', description: 'UID do agendamento (obtido em calendar_list_bookings)' },
        reason: { type: 'string', description: 'Motivo do cancelamento', required: false },
      },
      required: ['booking_uid'],
    },
  },
  reschedule_booking: {
    name: 'calendar_reschedule_booking',
    description: 'Remarca um agendamento existente para um novo horário. Confirme com o cliente o novo horário antes de chamar.',
    parameters: {
      type: 'object',
      properties: {
        booking_uid: { type: 'string', description: 'UID do agendamento atual' },
        new_start: { type: 'string', description: 'Novo início em ISO 8601' },
        reason: { type: 'string', description: 'Motivo do reagendamento', required: false },
      },
      required: ['booking_uid', 'new_start'],
    },
  },
}

// Map tool name (com prefixo calendar_) → action key
const TOOL_NAME_TO_ACTION: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_DEFS).map(([action, def]) => [def.name, action]),
)

// ── Helper: load integration with credentials ────────────────────

async function loadIntegration(companyId: string, integrationId: string) {
  const row = await prisma.companyIntegration.findFirst({
    where: { id: integrationId, companyId, status: { in: ['ACTIVE', 'INACTIVE'] } },
  })
  if (!row) throw new Error(`Integração ${integrationId} não encontrada`)
  if (row.status !== 'ACTIVE') throw new Error(`Integração "${row.name}" está inativa`)
  return { row, credentials: getDecryptedCredentials(row), provider: getProvider(row.type) }
}

function jsonOk(data: any) {
  return JSON.stringify({ success: true, ...data })
}
function jsonErr(message: string, code = 'calendar_error') {
  return JSON.stringify({ success: false, error: code, message })
}

// ── Module ───────────────────────────────────────────────────────

export const calendarModule: ToolModule = {
  type: 'calendar',
  name: 'Calendar Tools',

  getTools(config: CalendarToolsConfig | null | undefined): AIToolDefinition[] {
    if (!config?.integrationId) return []
    const enabled = { ...TOOL_DEFAULTS, ...(config.tools || {}) }

    const defs: AIToolDefinition[] = []
    for (const [action, def] of Object.entries(TOOL_DEFS)) {
      if ((enabled as any)[action]) {
        // Para list_event_types, embute lista pré-resolvida na descrição se vier no config
        if (action === 'list_event_types' && config.eventTypes?.length) {
          const list = config.eventTypes
            .map((e) => `  - id="${e.id}" ${e.label || e.title || e.slug || ''}${e.scope ? ` (${e.scope})` : ''}`)
            .join('\n')
          defs.push({
            ...def,
            description: `${def.description}\n\nTipos de evento disponíveis:\n${list}`,
          })
        } else {
          defs.push(def)
        }
      }
    }
    return defs
  },

  async execute(
    toolName: string,
    args: Record<string, any>,
    config: CalendarToolsConfig | null | undefined,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!config?.integrationId) {
      return { success: false, result: jsonErr('Calendário não configurado para este agente', 'calendar_not_configured') }
    }
    const action = TOOL_NAME_TO_ACTION[toolName]
    if (!action) {
      return { success: false, result: jsonErr(`Tool ${toolName} desconhecida`, 'tool_not_found') }
    }

    const start = Date.now()
    try {
      const { row, credentials, provider } = await loadIntegration(ctx.companyId, config.integrationId)

      let result: any
      switch (action) {
        case 'list_event_types': {
          if (!provider.listEventTypes) throw new Error('Provider não suporta listEventTypes')
          const items = await provider.listEventTypes(credentials)
          // Filtra pelos eventTypes habilitados no agente, se houver
          const allowedIds = new Set((config.eventTypes || []).map((e) => String(e.id)))
          const filtered = allowedIds.size > 0 ? items.filter((it) => allowedIds.has(String(it.id))) : items
          result = jsonOk({ event_types: filtered })
          break
        }
        case 'get_available_slots': {
          if (!provider.getAvailableSlots) throw new Error('Provider não suporta getAvailableSlots')
          const slots = await provider.getAvailableSlots(
            credentials,
            String(args.event_type_id),
            String(args.date_from),
            String(args.date_to),
            args.timezone,
          )
          result = jsonOk({ slots })
          break
        }
        case 'create_booking': {
          if (!provider.createBooking) throw new Error('Provider não suporta createBooking')
          const booking = await provider.createBooking(credentials, {
            eventTypeId: String(args.event_type_id),
            start: String(args.start),
            attendee: {
              name: String(args.attendee_name),
              email: String(args.attendee_email),
              phone: args.attendee_phone,
              timezone: args.timezone || 'America/Sao_Paulo',
            },
            notes: args.notes,
          })
          result = jsonOk({ booking })
          break
        }
        case 'list_bookings': {
          if (!provider.listBookings) throw new Error('Provider não suporta listBookings')
          const bookings = await provider.listBookings(credentials, {
            attendeeEmail: args.attendee_email,
            status: args.status,
          })
          result = jsonOk({ bookings })
          break
        }
        case 'cancel_booking': {
          if (!provider.cancelBooking) throw new Error('Provider não suporta cancelBooking')
          await provider.cancelBooking(credentials, String(args.booking_uid), args.reason)
          result = jsonOk({ cancelled: true, booking_uid: args.booking_uid })
          break
        }
        case 'reschedule_booking': {
          if (!provider.rescheduleBooking) throw new Error('Provider não suporta rescheduleBooking')
          const booking = await provider.rescheduleBooking(
            credentials,
            String(args.booking_uid),
            String(args.new_start),
            args.reason,
          )
          result = jsonOk({ booking })
          break
        }
        default:
          throw new Error(`Action ${action} não implementada`)
      }

      await trackUsage(row.id, true)
      const latencyMs = Date.now() - start
      console.log(`[Calendar Module] ✅ ${toolName} (${latencyMs}ms)`)
      return { success: true, result, metadata: { latencyMs } }
    } catch (err: any) {
      const latencyMs = Date.now() - start
      console.error(`[Calendar Module] ❌ ${toolName}: ${err.message} (${latencyMs}ms)`)
      try { await trackUsage(config.integrationId, false) } catch {}
      return {
        success: false,
        result: jsonErr(err.message || 'Falha na operação de calendário'),
        error: err.message,
        metadata: { latencyMs },
      }
    }
  },
}
