/**
 * IntegrationsTab.tsx
 *
 * Aba de Integrações dentro do editor de Agente de IA.
 * Layout inspirado em Dify (cards de provider), Nexus (status pills + brand colors),
 * Chatwoot (badge "Conectado/Não conectado" + ações claras).
 *
 * Estrutura:
 *  - Cabeçalho com descrição + CTA para a página de Integrações da empresa
 *  - 3 grupos: Voz, Transcrição, Agenda
 *  - Cada grupo tem cards de providers com status, expandindo um painel de configuração
 *  - Providers "Em breve" aparecem desabilitados com tag indicativa
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Volume2, Mic, Calendar, CheckCircle2, AlertCircle, Plug, ChevronDown, ChevronUp,
  Sparkles, ExternalLink, Settings,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  integrationsService,
  type CompanyIntegration,
  type CompanyIntegrationType,
  type VoiceModel,
  type CalendarEventType,
} from '@/services/integrations.service'

// ─────────────────────── tipos ───────────────────────

type VoiceConfig = {
  enabled: boolean
  integrationId: string
  voiceId: string
  mode: 'AI_DECIDES' | 'ALWAYS_AUDIO' | 'ALWAYS_TEXT' | 'AUTO_WHEN_RECEIVED_AUDIO'
  conditions: string
  format: 'mp3' | 'wav' | 'opus'
  sampleRate: number
}

type SttConfig = {
  enabled: boolean
  integrationId: string
  language: string
  ignoreTimestamps: boolean
}

type CalendarConfig = {
  enabled: boolean
  integrationId: string
  eventTypes: number[]
  defaultEventTypeId: number | null
  timezone: string
  tools: {
    list_event_types: boolean
    get_available_slots: boolean
    create_booking: boolean
    list_bookings: boolean
    cancel_booking: boolean
    reschedule_booking: boolean
  }
}

type Toast = {
  success: (msg: string) => void
  error: (msg: string) => void
}

interface Props {
  integrationsList: CompanyIntegration[]
  voiceConfig: VoiceConfig
  setVoiceConfig: React.Dispatch<React.SetStateAction<VoiceConfig>>
  voiceModels: VoiceModel[]
  setVoiceModels: React.Dispatch<React.SetStateAction<VoiceModel[]>>
  voiceModelsLoading: boolean
  setVoiceModelsLoading: React.Dispatch<React.SetStateAction<boolean>>
  sttConfig: SttConfig
  setSttConfig: React.Dispatch<React.SetStateAction<SttConfig>>
  calendarConfig: CalendarConfig
  setCalendarConfig: React.Dispatch<React.SetStateAction<CalendarConfig>>
  calendarEventTypes: CalendarEventType[]
  setCalendarEventTypes: React.Dispatch<React.SetStateAction<CalendarEventType[]>>
  calendarEventTypesLoading: boolean
  setCalendarEventTypesLoading: React.Dispatch<React.SetStateAction<boolean>>
  expandedCard: 'tts' | 'stt' | 'calendar' | null
  setExpandedCard: React.Dispatch<React.SetStateAction<'tts' | 'stt' | 'calendar' | null>>
  toast: Toast
}

// ─────────────────────── catálogo de providers exibidos ───────────────────────

interface ProviderCard {
  type: CompanyIntegrationType
  name: string
  description: string
  brandColor: string  // tailwind: hsl ou hex usado em rgba
  brandIcon: string   // emoji/letra da marca
  available: boolean
  comingSoon?: boolean
}

const PROVIDERS_TTS: ProviderCard[] = [
  { type: 'FISHAUDIO', name: 'Fish Audio', description: 'Vozes clonadas, multi-idioma, baixa latência', brandColor: '#3b82f6', brandIcon: '🐟', available: true },
  { type: 'OPENAI', name: 'OpenAI Audio', description: 'Vozes naturais (gpt-4o-mini-tts) já incluídas no plano OpenAI', brandColor: '#10a37f', brandIcon: 'AI', available: true },
  { type: 'ELEVENLABS', name: 'ElevenLabs', description: 'Vozes ultra-realistas em 29 idiomas', brandColor: '#7c3aed', brandIcon: 'EL', available: false, comingSoon: true },
]

const PROVIDERS_STT: ProviderCard[] = [
  { type: 'FISHAUDIO', name: 'Fish Audio ASR', description: 'Transcrição rápida com pontuação automática', brandColor: '#0ea5e9', brandIcon: '🐟', available: true },
  { type: 'OPENAI', name: 'OpenAI Whisper', description: 'Transcrição multi-idioma com Whisper / gpt-4o-transcribe', brandColor: '#10a37f', brandIcon: 'AI', available: true },
]

const PROVIDERS_CALENDAR: ProviderCard[] = [
  { type: 'CALCOM', name: 'Cal.com', description: 'Múltiplas agendas, reservas, reagendamentos via API v2', brandColor: '#10b981', brandIcon: 'C', available: true },
  { type: 'GOOGLE_CALENDAR', name: 'Google Calendar', description: 'Sincronização bidirecional com agendas Google Workspace', brandColor: '#ea4335', brandIcon: 'G', available: false, comingSoon: true },
]

// ─────────────────────── helpers ───────────────────────

function StatusPill({ kind, children }: { kind: 'connected' | 'inactive' | 'soon'; children: React.ReactNode }) {
  const styles = {
    connected: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    inactive: 'bg-muted text-muted-foreground border-border',
    soon: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  } as const
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wide ${styles[kind]}`}>
      {children}
    </span>
  )
}

function BrandIcon({ provider, size = 'md' }: { provider: ProviderCard; size?: 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'w-12 h-12 text-lg' : 'w-10 h-10 text-sm'
  return (
    <div
      className={`${sz} rounded-xl flex items-center justify-center font-semibold flex-shrink-0 shadow-sm`}
      style={{
        background: `linear-gradient(135deg, ${provider.brandColor}22, ${provider.brandColor}11)`,
        border: `1px solid ${provider.brandColor}33`,
        color: provider.brandColor,
      }}
    >
      {provider.brandIcon}
    </div>
  )
}

// ─────────────────────── componente ───────────────────────

export function IntegrationsTab(props: Props) {
  const {
    integrationsList, voiceConfig, setVoiceConfig, voiceModels, setVoiceModels,
    voiceModelsLoading, setVoiceModelsLoading, sttConfig, setSttConfig,
    calendarConfig, setCalendarConfig, calendarEventTypes, setCalendarEventTypes,
    calendarEventTypesLoading, setCalendarEventTypesLoading,
    expandedCard, setExpandedCard, toast,
  } = props

  // Integrações da empresa indexadas por tipo
  const byType = useMemo(() => {
    const map = new Map<CompanyIntegrationType, CompanyIntegration[]>()
    for (const i of integrationsList) {
      const arr = map.get(i.type) || []
      arr.push(i)
      map.set(i.type, arr)
    }
    return map
  }, [integrationsList])

  const ttsAvailable = useMemo(
    () => integrationsList.filter(i => i.status === 'ACTIVE' && (i.capabilities || []).includes('tts')),
    [integrationsList],
  )
  const sttAvailable = useMemo(
    () => integrationsList.filter(i => i.status === 'ACTIVE' && (i.capabilities || []).includes('stt')),
    [integrationsList],
  )
  const calAvailable = useMemo(
    () => integrationsList.filter(i => i.status === 'ACTIVE' && i.type === 'CALCOM'),
    [integrationsList],
  )

  function toggleCard(card: 'tts' | 'stt' | 'calendar') {
    setExpandedCard(expandedCard === card ? null : card)
  }

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 pb-2 border-b">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Plug className="h-4 w-4 text-primary" />
            Integrações do agente
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Conecte serviços externos para dar superpoderes ao seu agente: voz humanizada, transcrição
            automática de áudios e agendamento de reuniões diretamente nas conversas.
          </p>
        </div>
        <Link
          to="/integrations"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border bg-card hover:bg-muted transition shrink-0"
        >
          <Settings className="h-3.5 w-3.5" />
          Gerenciar integrações
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {/* ═══════════════════════ VOZ (TTS) ═══════════════════════ */}
      <section>
        <SectionHeader
          icon={<Volume2 className="h-4 w-4" />}
          color="#a855f7"
          title="Voz da IA (Text-to-Speech)"
          description="Faça o agente responder com áudio realista. Ideal para conversas mais humanas no WhatsApp."
          enabled={voiceConfig.enabled && !!voiceConfig.integrationId}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          {PROVIDERS_TTS.map(p => {
            const integrations = byType.get(p.type) || []
            const isSelectedHere = !!voiceConfig.integrationId && integrations.some(i => i.id === voiceConfig.integrationId)
            return (
              <ProviderCardView
                key={p.type}
                provider={p}
                integrationsCount={integrations.length}
                connected={isSelectedHere && voiceConfig.enabled}
                onConfigure={p.available ? () => toggleCard('tts') : undefined}
                isOpen={expandedCard === 'tts' && p.available && (isSelectedHere || ttsAvailable.length > 0 || integrations.length > 0)}
              />
            )
          })}
        </div>

        {expandedCard === 'tts' && (
          <ConfigPanel
            color="#a855f7"
            onClose={() => setExpandedCard(null)}
            title="Configurar voz do agente"
          >
            <ToggleRow
              label="Habilitar voz para este agente"
              checked={voiceConfig.enabled}
              onChange={v => setVoiceConfig(s => ({ ...s, enabled: v }))}
            />

            {voiceConfig.enabled && (
              <>
                <FieldGroup
                  label="Integração TTS"
                  hint={ttsAvailable.length === 0 ? (
                    <>Nenhuma integração de voz cadastrada. <Link to="/integrations" className="text-primary hover:underline">Adicionar agora →</Link></>
                  ) : `${ttsAvailable.length} integração(ões) ativa(s)`}
                >
                  <select
                    className="select-input"
                    value={voiceConfig.integrationId}
                    onChange={async e => {
                      const integrationId = e.target.value
                      setVoiceConfig(v => ({ ...v, integrationId, voiceId: '' }))
                      setVoiceModels([])
                      if (integrationId) {
                        setVoiceModelsLoading(true)
                        try {
                          const models = await integrationsService.listVoiceModels(integrationId)
                          setVoiceModels(models)
                        } catch (err: any) {
                          toast.error('Falha ao listar vozes: ' + (err.response?.data?.error || err.message))
                        }
                        setVoiceModelsLoading(false)
                      }
                    }}
                  >
                    <option value="">Selecione uma integração…</option>
                    {ttsAvailable.map(i => (
                      <option key={i.id} value={i.id}>{i.name} ({i.type})</option>
                    ))}
                  </select>
                </FieldGroup>

                {voiceConfig.integrationId && (
                  <FieldGroup
                    label="Voz"
                    hint={voiceModelsLoading ? 'Carregando vozes…' : `${voiceModels.length} voz(es) disponível(eis)`}
                  >
                    <select
                      className="select-input"
                      value={voiceConfig.voiceId}
                      onChange={e => setVoiceConfig(v => ({ ...v, voiceId: e.target.value }))}
                      disabled={voiceModelsLoading}
                    >
                      <option value="">Voz padrão da integração</option>
                      {voiceModels.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name}{m.visibility ? ` · ${m.visibility}` : ''}
                        </option>
                      ))}
                    </select>
                  </FieldGroup>
                )}

                <FieldGroup
                  label="Modo de envio"
                  hint="Quando o agente deve responder em áudio em vez de texto."
                >
                  <select
                    className="select-input"
                    value={voiceConfig.mode}
                    onChange={e => setVoiceConfig(v => ({ ...v, mode: e.target.value as any }))}
                  >
                    <option value="AUTO_WHEN_RECEIVED_AUDIO">Espelhar o cliente (áudio só quando ele mandar áudio)</option>
                    <option value="ALWAYS_AUDIO">Sempre responder em áudio</option>
                    <option value="ALWAYS_TEXT">Sempre responder em texto</option>
                    <option value="AI_DECIDES">A IA decide com base nas condições abaixo</option>
                  </select>
                </FieldGroup>

                {voiceConfig.mode === 'AI_DECIDES' && (
                  <FieldGroup label="Condições para usar voz" hint="Instruções que serão injetadas no system prompt.">
                    <Textarea
                      rows={3}
                      value={voiceConfig.conditions}
                      onChange={e => setVoiceConfig(v => ({ ...v, conditions: e.target.value }))}
                      placeholder="Ex.: Use voz para mensagens curtas e calorosas. Não use voz para listas, tabelas ou mensagens com mais de 200 caracteres."
                    />
                  </FieldGroup>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <FieldGroup label="Formato">
                    <select
                      className="select-input"
                      value={voiceConfig.format}
                      onChange={e => setVoiceConfig(v => ({ ...v, format: e.target.value as any }))}
                    >
                      <option value="mp3">MP3</option>
                      <option value="wav">WAV</option>
                      <option value="opus">Opus</option>
                    </select>
                  </FieldGroup>
                  <FieldGroup label="Sample rate (Hz)">
                    <Input
                      type="number"
                      value={voiceConfig.sampleRate}
                      onChange={e => setVoiceConfig(v => ({ ...v, sampleRate: parseInt(e.target.value) || 44100 }))}
                    />
                  </FieldGroup>
                </div>
              </>
            )}
          </ConfigPanel>
        )}
      </section>

      {/* ═══════════════════════ STT ═══════════════════════ */}
      <section>
        <SectionHeader
          icon={<Mic className="h-4 w-4" />}
          color="#0ea5e9"
          title="Transcrição de áudio (Speech-to-Text)"
          description="Permita que o agente entenda mensagens de áudio enviadas pelos clientes."
          enabled={sttConfig.enabled && !!sttConfig.integrationId}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          {PROVIDERS_STT.map(p => {
            const integrations = byType.get(p.type) || []
            const isSelectedHere = !!sttConfig.integrationId && integrations.some(i => i.id === sttConfig.integrationId)
            return (
              <ProviderCardView
                key={p.type}
                provider={p}
                integrationsCount={integrations.length}
                connected={isSelectedHere && sttConfig.enabled}
                onConfigure={p.available ? () => toggleCard('stt') : undefined}
                isOpen={expandedCard === 'stt' && p.available}
              />
            )
          })}
        </div>

        {expandedCard === 'stt' && (
          <ConfigPanel
            color="#0ea5e9"
            onClose={() => setExpandedCard(null)}
            title="Configurar transcrição de áudio"
          >
            <ToggleRow
              label="Habilitar transcrição automática para este agente"
              checked={sttConfig.enabled}
              onChange={v => setSttConfig(s => ({ ...s, enabled: v }))}
            />

            {sttConfig.enabled && (
              <>
                <FieldGroup
                  label="Integração STT"
                  hint={sttAvailable.length === 0 ? (
                    <>Nenhuma integração de transcrição cadastrada. <Link to="/integrations" className="text-primary hover:underline">Adicionar agora →</Link></>
                  ) : `${sttAvailable.length} integração(ões) ativa(s)`}
                >
                  <select
                    className="select-input"
                    value={sttConfig.integrationId}
                    onChange={e => setSttConfig(s => ({ ...s, integrationId: e.target.value }))}
                  >
                    <option value="">Selecione uma integração…</option>
                    {sttAvailable.map(i => (
                      <option key={i.id} value={i.id}>{i.name} ({i.type})</option>
                    ))}
                  </select>
                </FieldGroup>

                <div className="grid grid-cols-2 gap-3">
                  <FieldGroup label="Idioma" hint="ISO 639-1, ex.: pt, en, es">
                    <Input
                      value={sttConfig.language}
                      onChange={e => setSttConfig(s => ({ ...s, language: e.target.value }))}
                      placeholder="pt"
                    />
                  </FieldGroup>
                  <FieldGroup label="Timestamps">
                    <label className="flex items-center gap-2 text-sm h-9 px-3 border rounded-md bg-background">
                      <input
                        type="checkbox"
                        checked={sttConfig.ignoreTimestamps}
                        onChange={e => setSttConfig(s => ({ ...s, ignoreTimestamps: e.target.checked }))}
                        className="h-4 w-4 accent-primary"
                      />
                      Ignorar timestamps
                    </label>
                  </FieldGroup>
                </div>
              </>
            )}
          </ConfigPanel>
        )}
      </section>

      {/* ═══════════════════════ AGENDA ═══════════════════════ */}
      <section>
        <SectionHeader
          icon={<Calendar className="h-4 w-4" />}
          color="#10b981"
          title="Agenda e agendamentos"
          description="Permita que o agente consulte horários disponíveis, crie, remarque ou cancele reuniões."
          enabled={calendarConfig.enabled && !!calendarConfig.integrationId}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          {PROVIDERS_CALENDAR.map(p => {
            const integrations = byType.get(p.type) || []
            const isSelectedHere = !!calendarConfig.integrationId && integrations.some(i => i.id === calendarConfig.integrationId)
            return (
              <ProviderCardView
                key={p.type}
                provider={p}
                integrationsCount={integrations.length}
                connected={isSelectedHere && calendarConfig.enabled}
                onConfigure={p.available ? () => toggleCard('calendar') : undefined}
                isOpen={expandedCard === 'calendar' && p.available}
              />
            )
          })}
        </div>

        {expandedCard === 'calendar' && (
          <ConfigPanel
            color="#10b981"
            onClose={() => setExpandedCard(null)}
            title="Configurar agenda do agente"
          >
            <ToggleRow
              label="Habilitar ferramentas de agenda para este agente"
              checked={calendarConfig.enabled}
              onChange={v => setCalendarConfig(c => ({ ...c, enabled: v }))}
            />

            {calendarConfig.enabled && (
              <>
                <FieldGroup
                  label="Integração Cal.com"
                  hint={calAvailable.length === 0 ? (
                    <>Nenhuma integração Cal.com cadastrada. <Link to="/integrations" className="text-primary hover:underline">Adicionar agora →</Link></>
                  ) : `${calAvailable.length} conta(s) Cal.com ativa(s)`}
                >
                  <select
                    className="select-input"
                    value={calendarConfig.integrationId}
                    onChange={async e => {
                      const integrationId = e.target.value
                      setCalendarConfig(c => ({ ...c, integrationId, eventTypes: [], defaultEventTypeId: null }))
                      setCalendarEventTypes([])
                      if (integrationId) {
                        setCalendarEventTypesLoading(true)
                        try {
                          const ets = await integrationsService.listEventTypes(integrationId)
                          setCalendarEventTypes(ets)
                        } catch (err: any) {
                          toast.error('Falha ao listar event types: ' + (err.response?.data?.error || err.message))
                        }
                        setCalendarEventTypesLoading(false)
                      }
                    }}
                  >
                    <option value="">Selecione uma conta Cal.com…</option>
                    {calAvailable.map(i => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                </FieldGroup>

                {calendarConfig.integrationId && (
                  <FieldGroup
                    label="Event Types disponíveis ao agente"
                    hint={calendarEventTypesLoading
                      ? 'Buscando event types na sua conta Cal.com…'
                      : `Marque quais tipos de reunião o agente pode oferecer. ${calendarConfig.eventTypes.length} selecionado(s).`}
                  >
                    <div className="flex items-center justify-end mb-1">
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={async () => {
                          setCalendarEventTypesLoading(true)
                          try {
                            const ets = await integrationsService.listEventTypes(calendarConfig.integrationId)
                            setCalendarEventTypes(ets)
                          } catch (err: any) {
                            toast.error('Falha: ' + (err.response?.data?.error || err.message))
                          }
                          setCalendarEventTypesLoading(false)
                        }}
                      >
                        Atualizar lista
                      </button>
                    </div>
                    {calendarEventTypes.length === 0 && !calendarEventTypesLoading ? (
                      <div className="text-xs text-muted-foreground border border-dashed rounded-md p-4 text-center">
                        Nenhum event type encontrado nesta conta Cal.com.
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-64 overflow-y-auto border rounded-md p-1.5 bg-background">
                        {calendarEventTypes.map(et => {
                          const numId = parseInt(et.id)
                          const checked = calendarConfig.eventTypes.includes(numId)
                          return (
                            <label
                              key={et.id}
                              className={`flex items-center gap-3 text-sm py-2 px-3 rounded-md cursor-pointer transition ${checked ? 'bg-emerald-500/5' : 'hover:bg-muted/50'}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e => {
                                  setCalendarConfig(c => ({
                                    ...c,
                                    eventTypes: e.target.checked
                                      ? [...c.eventTypes, numId]
                                      : c.eventTypes.filter(x => x !== numId),
                                  }))
                                }}
                                className="h-4 w-4 accent-emerald-500"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">{et.title}</div>
                                <div className="text-[11px] text-muted-foreground truncate">
                                  /{et.slug} · {et.durationMinutes ?? '?'} min{et.scope ? ` · ${et.scope}` : ''}
                                </div>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </FieldGroup>
                )}

                {calendarConfig.eventTypes.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    <FieldGroup label="Event Type padrão" hint="Sugerido pela IA quando o cliente não especifica.">
                      <select
                        className="select-input"
                        value={calendarConfig.defaultEventTypeId ?? ''}
                        onChange={e => setCalendarConfig(c => ({ ...c, defaultEventTypeId: e.target.value ? parseInt(e.target.value) : null }))}
                      >
                        <option value="">Nenhum (IA escolhe)</option>
                        {calendarEventTypes
                          .filter(et => calendarConfig.eventTypes.includes(parseInt(et.id)))
                          .map(et => (
                            <option key={et.id} value={et.id}>{et.title}</option>
                          ))}
                      </select>
                    </FieldGroup>
                    <FieldGroup label="Timezone padrão">
                      <Input
                        value={calendarConfig.timezone}
                        onChange={e => setCalendarConfig(c => ({ ...c, timezone: e.target.value }))}
                        placeholder="America/Sao_Paulo"
                      />
                    </FieldGroup>
                  </div>
                )}

                <FieldGroup
                  label="Ferramentas habilitadas"
                  hint="Cada ferramenta vira uma function-call disponível para a IA."
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 border rounded-md p-2 bg-background">
                    {([
                      ['list_event_types', 'Listar tipos de reunião', 'A IA pode informar quais reuniões oferece'],
                      ['get_available_slots', 'Consultar horários livres', 'Sugere horários ao cliente'],
                      ['create_booking', 'Criar agendamento', 'Marca a reunião automaticamente'],
                      ['list_bookings', 'Listar agendamentos', 'Consulta agendamentos existentes'],
                      ['cancel_booking', 'Cancelar agendamento', 'Cancela uma reunião'],
                      ['reschedule_booking', 'Remarcar agendamento', 'Move horário de uma reunião'],
                    ] as const).map(([key, label, sub]) => {
                      const checked = calendarConfig.tools[key]
                      return (
                        <label
                          key={key}
                          className={`flex items-start gap-2.5 p-2 rounded-md cursor-pointer transition ${checked ? 'bg-emerald-500/5' : 'hover:bg-muted/50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => setCalendarConfig(c => ({
                              ...c,
                              tools: { ...c.tools, [key]: e.target.checked },
                            }))}
                            className="mt-0.5 h-4 w-4 accent-emerald-500"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">{label}</div>
                            <div className="text-[11px] text-muted-foreground leading-snug">{sub}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </FieldGroup>
              </>
            )}
          </ConfigPanel>
        )}
      </section>
    </div>
  )
}

// ─────────────────────── subcomponentes ───────────────────────

function SectionHeader({
  icon, color, title, description, enabled,
}: { icon: React.ReactNode; color: string; title: string; description: string; enabled: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
          style={{
            background: `linear-gradient(135deg, ${color}26, ${color}10)`,
            border: `1px solid ${color}33`,
            color,
          }}
        >
          {icon}
        </div>
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            {title}
            {enabled && <StatusPill kind="connected"><CheckCircle2 className="h-2.5 w-2.5" /> Ativo</StatusPill>}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">{description}</p>
        </div>
      </div>
    </div>
  )
}

function ProviderCardView({
  provider, integrationsCount, connected, onConfigure, isOpen,
}: {
  provider: ProviderCard
  integrationsCount: number
  connected: boolean
  onConfigure?: () => void
  isOpen: boolean
}) {
  const disabled = !provider.available
  return (
    <button
      type="button"
      onClick={onConfigure}
      disabled={disabled}
      className={`group relative text-left rounded-xl border p-3.5 transition-all bg-card ${
        disabled
          ? 'opacity-60 cursor-not-allowed'
          : 'hover:border-primary/40 hover:shadow-md cursor-pointer'
      } ${isOpen ? 'border-primary/60 shadow-md ring-1 ring-primary/20' : ''}`}
    >
      <div className="flex items-start gap-3">
        <BrandIcon provider={provider} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-sm leading-tight">{provider.name}</h4>
            {connected && <StatusPill kind="connected"><CheckCircle2 className="h-2.5 w-2.5" /> Conectado</StatusPill>}
            {provider.comingSoon && <StatusPill kind="soon"><Sparkles className="h-2.5 w-2.5" /> Em breve</StatusPill>}
            {provider.available && !connected && integrationsCount === 0 && (
              <StatusPill kind="inactive"><AlertCircle className="h-2.5 w-2.5" /> Sem credenciais</StatusPill>
            )}
            {provider.available && integrationsCount > 0 && !connected && (
              <StatusPill kind="inactive">{integrationsCount} disponível(eis)</StatusPill>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-snug">
            {provider.description}
          </p>
        </div>
        {provider.available && (
          <div className="text-muted-foreground shrink-0 mt-0.5">
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        )}
      </div>
    </button>
  )
}

function ConfigPanel({
  color, title, onClose, children,
}: { color: string; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="mt-3 rounded-xl border bg-card p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200"
      style={{ borderColor: `${color}40`, boxShadow: `0 0 0 1px ${color}10, 0 4px 20px -10px ${color}30` }}
    >
      <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: `${color}20` }}>
        <h4 className="text-sm font-semibold" style={{ color }}>{title}</h4>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground transition px-2 py-1 rounded hover:bg-muted"
        >
          Fechar
        </button>
      </div>
      <div className="space-y-4">
        <style>{`
          .select-input {
            width: 100%;
            padding: 0.5rem 0.75rem;
            border-radius: 0.5rem;
            border: 1px solid hsl(var(--border));
            background: hsl(var(--background));
            font-size: 0.875rem;
            line-height: 1.25rem;
          }
          .select-input:focus {
            outline: none;
            border-color: hsl(var(--primary));
            box-shadow: 0 0 0 2px hsl(var(--primary) / 0.2);
          }
        `}</style>
        {children}
      </div>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-background cursor-pointer hover:bg-muted/30 transition">
      <span className="text-sm font-medium">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
          checked ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  )
}

function FieldGroup({
  label, hint, children,
}: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground/80">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>}
    </div>
  )
}
