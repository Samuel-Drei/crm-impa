/**
 * Cron NLP Service
 *
 * Converte instruções em linguagem natural (PT-BR) → expressão cron padrão (5 campos).
 * Estratégia em 2 etapas:
 *   1. Heurística determinística (regex) — cobre 80% dos casos comuns
 *   2. Fallback LLM (opcional) — usa o provider default da empresa para casos complexos
 *
 * Também calcula `nextRunAt` a partir de uma expressão cron + timezone (sem dependência externa).
 */

export interface CronParseResult {
  cronExpr: string
  description: string  // descrição humana do cron interpretado
  source: 'heuristic' | 'llm'
}

export const DEFAULT_CRON_TIMEZONE = 'America/Sao_Paulo'

// ──────────────────────────────────────────────────────────────────────
// Heurística PT-BR
// ──────────────────────────────────────────────────────────────────────

const DAY_NAMES: Record<string, number> = {
  domingo: 0, dom: 0,
  segunda: 1, segundas: 1, 'segunda-feira': 1, seg: 1,
  terca: 2, terça: 2, 'terça-feira': 2, ter: 2,
  quarta: 3, quartas: 3, 'quarta-feira': 3, qua: 3,
  quinta: 4, quintas: 4, 'quinta-feira': 4, qui: 4,
  sexta: 5, sextas: 5, 'sexta-feira': 5, sex: 5,
  sabado: 6, sábado: 6, sab: 6, sáb: 6,
}

const WEEKDAY_NAMES: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

interface ZonedDateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  dayOfWeek: number
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    const parts = formatter.formatToParts(date)
    const get = (type: string) => parts.find(p => p.type === type)?.value || ''
    return {
      year: Number(get('year')) || date.getUTCFullYear(),
      month: Number(get('month')) || (date.getUTCMonth() + 1),
      day: Number(get('day')) || date.getUTCDate(),
      hour: (Number(get('hour')) || 0) % 24,
      minute: Number(get('minute')) || date.getUTCMinutes(),
      second: Number(get('second')) || date.getUTCSeconds(),
      dayOfWeek: WEEKDAY_NAMES[get('weekday')] ?? date.getUTCDay(),
    }
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      dayOfWeek: date.getUTCDay(),
    }
  }
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = getZonedDateParts(date, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return (asUtc - date.getTime()) / 60000
}

function hasExplicitTimeZone(input: string): boolean {
  return /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(input.trim())
}

export function parseDateTimeInTimeZone(input: string, timeZone: string = DEFAULT_CRON_TIMEZONE): Date | null {
  const value = String(input || '').trim()
  if (!value) return null

  if (hasExplicitTimeZone(value)) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const hour = Number(hourStr)
  const minute = Number(minuteStr)
  const second = secondStr ? Number(secondStr) : 0

  if (
    Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day) ||
    Number.isNaN(hour) || Number.isNaN(minute) || Number.isNaN(second)
  ) {
    return null
  }

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  let offsetMin = getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone)
  let utcMs = utcGuess - offsetMin * 60_000
  const refinedOffsetMin = getTimeZoneOffsetMinutes(new Date(utcMs), timeZone)
  if (refinedOffsetMin !== offsetMin) {
    offsetMin = refinedOffsetMin
    utcMs = utcGuess - offsetMin * 60_000
  }

  return new Date(utcMs)
}

/**
 * Heurística pura — retorna null se não conseguir interpretar.
 */
export function tryHeuristicCron(input: string): CronParseResult | null {
  const text = normalize(input)

  // "a cada N minutos"
  let m = text.match(/a cada (\d+) minutos?/)
  if (m) {
    const n = parseInt(m[1])
    if (n > 0 && n < 60) {
      return { cronExpr: `*/${n} * * * *`, description: `A cada ${n} minutos`, source: 'heuristic' }
    }
  }

  // "a cada N horas"
  m = text.match(/a cada (\d+) horas?/)
  if (m) {
    const n = parseInt(m[1])
    if (n > 0 && n < 24) {
      return { cronExpr: `0 */${n} * * *`, description: `A cada ${n} horas`, source: 'heuristic' }
    }
  }

  // "todo dia HH:MM" ou "diariamente as HH:MM"
  m = text.match(/(?:todo dia|diariamente|todos os dias|diario)(?:\s+as|\s+às|\s+as|\s+\u00e0s)?\s+(\d{1,2})(?:[:h](\d{1,2}))?/)
  if (m) {
    const h = parseInt(m[1])
    const mi = m[2] ? parseInt(m[2]) : 0
    if (h <= 23 && mi <= 59) {
      return { cronExpr: `${mi} ${h} * * *`, description: `Todo dia às ${h}:${String(mi).padStart(2, '0')}`, source: 'heuristic' }
    }
  }

  // "todo dia util as HH" / "dias uteis"
  m = text.match(/(?:todo dia util|dias uteis|dias utilis|util)(?:\s+as|\s+\u00e0s)?\s+(\d{1,2})(?:[:h](\d{1,2}))?/)
  if (m) {
    const h = parseInt(m[1])
    const mi = m[2] ? parseInt(m[2]) : 0
    if (h <= 23 && mi <= 59) {
      return { cronExpr: `${mi} ${h} * * 1-5`, description: `Dias úteis às ${h}:${String(mi).padStart(2, '0')}`, source: 'heuristic' }
    }
  }

  // "toda <dia da semana> as HH"
  m = text.match(/toda(?:s)?\s+([a-z\-]+)(?:\s+as|\s+\u00e0s)?\s+(\d{1,2})(?:[:h](\d{1,2}))?/)
  if (m) {
    const dayKey = m[1]
    const h = parseInt(m[2])
    const mi = m[3] ? parseInt(m[3]) : 0
    const dayNum = DAY_NAMES[dayKey]
    if (dayNum !== undefined && h <= 23 && mi <= 59) {
      return { cronExpr: `${mi} ${h} * * ${dayNum}`, description: `Toda semana (dia ${dayKey}) às ${h}:${String(mi).padStart(2, '0')}`, source: 'heuristic' }
    }
  }

  // "todo mes dia D as HH" / "todo dia D do mes as HH"
  m = text.match(/(?:todo m[eê]s|mensalmente|todo dia)\s+(?:dia\s+)?(\d{1,2})(?:\s+(?:do m[eê]s|de cada m[eê]s))?(?:\s+as|\s+\u00e0s)?\s+(\d{1,2})(?:[:h](\d{1,2}))?/)
  if (m) {
    const d = parseInt(m[1])
    const h = parseInt(m[2])
    const mi = m[3] ? parseInt(m[3]) : 0
    if (d >= 1 && d <= 31 && h <= 23 && mi <= 59) {
      return { cronExpr: `${mi} ${h} ${d} * *`, description: `Todo mês dia ${d} às ${h}:${String(mi).padStart(2, '0')}`, source: 'heuristic' }
    }
  }

  // Já é cron válido? (5 campos)
  const cronRe = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/
  if (cronRe.test(input.trim())) {
    return { cronExpr: input.trim(), description: 'Expressão cron fornecida', source: 'heuristic' }
  }

  return null
}

/**
 * Conversão NL → cron usando provider LLM (fallback).
 * Recebe uma função `callLLM(prompt)` injetada para evitar dependência circular.
 */
export async function parseToCronNL(
  input: string,
  callLLM?: (prompt: string) => Promise<string>
): Promise<CronParseResult> {
  const heur = tryHeuristicCron(input)
  if (heur) return heur

  if (!callLLM) {
    throw new Error(`Não foi possível interpretar a recorrência: "${input}". Forneça em formato cron (ex: "0 9 * * 1-5") ou em linguagem mais simples (ex: "todo dia 9h").`)
  }

  const prompt = `Você é um conversor de linguagem natural para expressão cron (5 campos: minuto hora dia-do-mês mês dia-da-semana).
Texto: "${input}"
Retorne APENAS um JSON com este formato (sem markdown, sem explicação):
{"cron":"<expressão>","description":"<descrição em PT-BR>"}
Exemplos:
- "todo dia 9h" → {"cron":"0 9 * * *","description":"Todo dia às 09:00"}
- "toda segunda às 14:30" → {"cron":"30 14 * * 1","description":"Toda segunda-feira às 14:30"}
- "a cada 15 minutos" → {"cron":"*/15 * * * *","description":"A cada 15 minutos"}`

  const response = await callLLM(prompt)
  let parsed: any
  try {
    const cleaned = response.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`LLM retornou resposta inválida ao converter para cron: ${response.slice(0, 200)}`)
  }

  if (!parsed.cron || typeof parsed.cron !== 'string') {
    throw new Error('LLM não retornou campo "cron" válido')
  }
  return { cronExpr: parsed.cron.trim(), description: parsed.description || 'Cron interpretado por LLM', source: 'llm' }
}

// ──────────────────────────────────────────────────────────────────────
// Validação cron + cálculo de próxima execução
// ──────────────────────────────────────────────────────────────────────

interface CronFields {
  minute: number[]
  hour: number[]
  dom: number[]      // dia do mês (1-31)
  month: number[]    // mês (1-12)
  dow: number[]      // dia da semana (0-6, 0=domingo)
}

function parseCronField(field: string, min: number, max: number): number[] {
  const result = new Set<number>()
  const parts = field.split(',')
  for (const part of parts) {
    let step = 1
    let range = part
    if (part.includes('/')) {
      const [r, s] = part.split('/')
      range = r
      step = parseInt(s) || 1
    }
    let start: number, end: number
    if (range === '*') {
      start = min
      end = max
    } else if (range.includes('-')) {
      const [s, e] = range.split('-').map(n => parseInt(n))
      start = s
      end = e
    } else {
      const v = parseInt(range)
      start = v
      end = v
    }
    for (let i = start; i <= end; i += step) {
      if (i >= min && i <= max) result.add(i)
    }
  }
  return Array.from(result).sort((a, b) => a - b)
}

export function parseCronExpression(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Expressão cron deve ter 5 campos, recebeu ${parts.length}: "${expr}"`)
  const [m, h, dom, mo, dow] = parts
  return {
    minute: parseCronField(m, 0, 59),
    hour: parseCronField(h, 0, 23),
    dom: parseCronField(dom, 1, 31),
    month: parseCronField(mo, 1, 12),
    dow: parseCronField(dow, 0, 6),
  }
}

export function isValidCron(expr: string): boolean {
  try {
    const f = parseCronExpression(expr)
    return f.minute.length > 0 && f.hour.length > 0 && f.dom.length > 0 && f.month.length > 0 && f.dow.length > 0
  } catch {
    return false
  }
}

/**
 * Calcula a próxima execução depois de `from`, avaliando o cron no timezone informado.
 * O valor retornado continua sendo um `Date` absoluto (UTC internamente), pronto para persistência.
 *
 * Implementação: itera minuto a minuto até encontrar match (max 366*24*60 minutos = 1 ano).
 */
export function getNextRunAt(
  cronExpr: string,
  from: Date = new Date(),
  timeZone: string = DEFAULT_CRON_TIMEZONE,
): Date | null {
  const fields = parseCronExpression(cronExpr)
  const start = new Date(from.getTime() + 60_000) // próximo minuto
  start.setSeconds(0, 0)

  const maxIters = 366 * 24 * 60
  const cur = new Date(start.getTime())

  for (let i = 0; i < maxIters; i++) {
    const zoned = getZonedDateParts(cur, timeZone)
    const min = zoned.minute
    const hr = zoned.hour
    const d = zoned.day
    const mo = zoned.month
    const dw = zoned.dayOfWeek

    if (
      fields.minute.includes(min) &&
      fields.hour.includes(hr) &&
      fields.month.includes(mo) &&
      // cron padrão: se ambos dom e dow forem restritivos (não '*'), match em QUALQUER um
      (fields.dom.includes(d) || fields.dow.includes(dw))
    ) {
      // mas se dom é '*' (1-31 todos) E dow é '*' (0-6), passa
      // se um deles é restritivo, basta um match
      const domAll = fields.dom.length === 31
      const dowAll = fields.dow.length === 7
      if ((domAll && dowAll) || (!domAll && fields.dom.includes(d)) || (!dowAll && fields.dow.includes(dw))) {
        return new Date(cur.getTime())
      }
    }
    cur.setUTCMinutes(cur.getUTCMinutes() + 1)
  }
  return null
}
