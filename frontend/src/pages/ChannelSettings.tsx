import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Users,
  Clock,
  Star,
  Plus,
  Trash2,
  Loader2,
  Save,
  UserPlus,
  BarChart3,
  Settings,
  Webhook,
  Copy,
  Share2,
  Link,
  ExternalLink,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Check,
  QrCode,
  Plug,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import api from '@/services/api'
import { getSocket, connectSocket, joinInstance, leaveInstance } from '@/services/socket'
import type { Instance } from '@/types'

// ══════════════════════════════════════════
// ═══ TIPOS ═══
// ══════════════════════════════════════════

interface InstanceMember {
  id: string
  instanceId: string
  userId: string
  createdAt: string
  user: {
    id: string
    name: string
    email: string
    isActive: boolean
  }
}

interface WorkingHour {
  id: string
  dayOfWeek: number
  openHour: number
  openMinutes: number
  closeHour: number
  closeMinutes: number
  closedAllDay: boolean
}

interface WorkingHoursConfig {
  workingHoursEnabled: boolean
  outOfOfficeMessage: string | null
  timezone: string
  hours: WorkingHour[]
}

interface CsatConfig {
  csatEnabled: boolean
  csatMessage: string | null
}

interface CsatResponse {
  id: string
  rating: number
  feedbackMessage: string | null
  createdAt: string
  contact: { id: string; name: string; phoneNumber: string; profilePicture: string | null }
  assignedAgent: { id: string; name: string; email: string } | null
  conversation: { id: string; remoteJid: string }
}

interface CsatMetrics {
  averageRating: number
  totalResponses: number
  distribution: { rating: number; count: number }[]
}

interface CompanyUser {
  id: string
  name: string
  email: string
  isActive: boolean
}

const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Fortaleza',
  'America/Manaus',
  'America/Rio_Branco',
  'America/Noronha',
  'America/Belem',
  'America/Cuiaba',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Maceio',
  'America/Recife',
  'America/Araguaina',
  'America/Bahia',
]

function formatTime(hour: number, minutes: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function parseTime(timeStr: string): { hour: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number)
  return { hour: h || 0, minutes: m || 0 }
}

// ══════════════════════════════════════════
// ═══ POLLING DE QR CODE ═══
// ══════════════════════════════════════════

function QRCodePoller({
  instanceId,
  channel,
  isActive,
  onQrCode,
  onConnected,
}: {
  instanceId: string | null
  channel: string
  isActive: boolean
  onQrCode: (qr: string) => void
  onConnected: () => void
}) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onConnectedRef = useRef(onConnected)
  const onQrCodeRef = useRef(onQrCode)
  onConnectedRef.current = onConnected
  onQrCodeRef.current = onQrCode

  useEffect(() => {
    if (!isActive || !instanceId || channel !== 'EVO_GO') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    const fetchQR = async () => {
      try {
        const res = await api.get(`/instances/${instanceId}/qrcode`)
        if (res.data.status === 'CONNECTED') {
          onConnectedRef.current()
          return
        }
        if (res.data.qrCode) {
          onQrCodeRef.current(res.data.qrCode)
        }
      } catch {
        // QR não disponível ainda
      }
    }

    fetchQR()
    intervalRef.current = setInterval(fetchQR, 5000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isActive, instanceId, channel])

  return null
}

// ══════════════════════════════════════════
// ═══ COMPONENTE PRINCIPAL ═══
// ══════════════════════════════════════════

export default function ChannelSettings() {
  const { instanceId } = useParams<{ instanceId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const defaultTab = searchParams.get('tab') || 'behavior'

  // Buscar info da instância
  const { data: instance, isLoading: instanceLoading } = useQuery<Instance>({
    queryKey: ['instance', instanceId],
    queryFn: () => api.get(`/instances/${instanceId}`).then(r => r.data),
    enabled: !!instanceId,
  })

  if (instanceLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Abas dinâmicas conforme canal
  const isCloudApi = instance?.channel === 'CLOUD_API' || instance?.channel === 'COEXISTENCE'
  const isEvoGo = instance?.channel === 'EVO_GO'
  const isBaileys = instance?.channel === 'BAILEYS' || instance?.channel === 'WHATSMEOW'
  const showBehavior = isBaileys || isEvoGo
  const showCloudApi = isCloudApi
  const showEvoGo = isEvoGo
  const showQrConnect = isBaileys || isEvoGo

  return (
    <div className="flex-1 overflow-auto bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/instances')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Configurações do Canal
            </h1>
            <p className="text-sm text-muted-foreground">
              {instance?.name || 'Carregando...'} —{' '}
              <Badge
                variant="outline"
                className={
                  instance?.channel === 'COEXISTENCE' ? 'bg-purple-500/10 text-purple-600 border-purple-500' :
                  instance?.channel === 'EVO_GO' ? 'bg-orange-500/10 text-orange-600 border-orange-500' :
                  ''
                }
              >
                {instance?.channel === 'BAILEYS' ? 'Baileys' : instance?.channel === 'WHATSMEOW' ? 'WhatsMeow' : instance?.channel === 'COEXISTENCE' ? 'Coexistence' : instance?.channel === 'EVO_GO' ? 'Evo Go' : 'Cloud API'}
              </Badge>
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue={defaultTab} className="space-y-4">
          <TabsList className="flex w-full overflow-x-auto">
            {showBehavior && (
              <TabsTrigger value="behavior" className="gap-2 flex-1">
                <Settings className="h-4 w-4" />
                Comportamento
              </TabsTrigger>
            )}
            {showCloudApi && (
              <TabsTrigger value="cloud-api" className="gap-2 flex-1">
                <Plug className="h-4 w-4" />
                {instance?.channel === 'COEXISTENCE' ? 'Coexistence' : 'Cloud API'}
              </TabsTrigger>
            )}
            {showEvoGo && (
              <TabsTrigger value="evo-go" className="gap-2 flex-1">
                <Plug className="h-4 w-4" />
                Evo Go
              </TabsTrigger>
            )}
            {showQrConnect && (
              <TabsTrigger value="connection" className="gap-2 flex-1">
                <QrCode className="h-4 w-4" />
                Conexão
              </TabsTrigger>
            )}
            <TabsTrigger value="share" className="gap-2 flex-1">
              <Share2 className="h-4 w-4" />
              Compartilhar
            </TabsTrigger>
            <TabsTrigger value="members" className="gap-2 flex-1">
              <Users className="h-4 w-4" />
              Colaboradores
            </TabsTrigger>
            <TabsTrigger value="hours" className="gap-2 flex-1">
              <Clock className="h-4 w-4" />
              Horário
            </TabsTrigger>
            <TabsTrigger value="csat" className="gap-2 flex-1">
              <Star className="h-4 w-4" />
              Satisfação
            </TabsTrigger>
          </TabsList>

          {showBehavior && (
            <TabsContent value="behavior">
              <BehaviorTab instanceId={instanceId!} instance={instance!} />
            </TabsContent>
          )}

          {showCloudApi && (
            <TabsContent value="cloud-api">
              <CloudApiTab instanceId={instanceId!} instance={instance!} />
            </TabsContent>
          )}

          {showEvoGo && (
            <TabsContent value="evo-go">
              <EvoGoTab instanceId={instanceId!} instance={instance!} />
            </TabsContent>
          )}

          {showQrConnect && (
            <TabsContent value="connection">
              <ConnectionTab instanceId={instanceId!} instance={instance!} />
            </TabsContent>
          )}

          <TabsContent value="share">
            <ShareTab instanceId={instanceId!} />
          </TabsContent>

          <TabsContent value="members">
            <MembersTab instanceId={instanceId!} />
          </TabsContent>

          <TabsContent value="hours">
            <WorkingHoursTab instanceId={instanceId!} />
          </TabsContent>

          <TabsContent value="csat">
            <CsatTab instanceId={instanceId!} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════
// ═══ ABA: COMPORTAMENTO ═══
// ══════════════════════════════════════════

function BehaviorTab({ instanceId, instance }: { instanceId: string; instance: Instance }) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [settings, setSettings] = useState({
    rejectCalls: false,
    ignoreGroups: false,
    ignoreBroadcasts: false,
    ignoreStatus: true,
    alwaysOnline: false,
    readMessages: true,
  })
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookEvents, setWebhookEvents] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        // For EVO_GO, fetch from Evo Go API
        if (instance.channel === 'EVO_GO' && instance.evoApiUrl) {
          try {
            const res = await api.get(`/instances/${instanceId}/evo-settings`)
            setSettings({
              rejectCalls: res.data.rejectCalls ?? false,
              ignoreGroups: res.data.ignoreGroups ?? false,
              ignoreBroadcasts: false,
              ignoreStatus: res.data.ignoreStatus ?? true,
              alwaysOnline: res.data.alwaysOnline ?? false,
              readMessages: res.data.readMessages ?? true,
            })
          } catch {
            setSettings({
              rejectCalls: instance.rejectCalls || false,
              ignoreGroups: instance.ignoreGroups || false,
              ignoreBroadcasts: false,
              ignoreStatus: instance.ignoreStatus ?? true,
              alwaysOnline: instance.alwaysOnline || false,
              readMessages: instance.readMessages ?? true,
            })
          }
        } else {
          setSettings({
            rejectCalls: instance.rejectCalls || false,
            ignoreGroups: instance.ignoreGroups || false,
            ignoreBroadcasts: instance.ignoreBroadcasts || false,
            ignoreStatus: instance.ignoreStatus ?? true,
            alwaysOnline: instance.alwaysOnline || false,
            readMessages: instance.readMessages ?? true,
          })
        }
        setWebhookUrl(instance.webhookUrl || '')
        setWebhookEvents(instance.webhookEvents || [])
      } finally {
        setLoading(false)
        setDirty(false)
      }
    }
    load()
  }, [instance, instanceId])

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/instances/${instanceId}`, {
        ...settings,
        webhookUrl,
        webhookEvents,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instance', instanceId] })
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      setDirty(false)
      toast.success('Configurações salvas com sucesso')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erro ao salvar')
    },
  })

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const toggleEvent = (event: string) => {
    setWebhookEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    )
    setDirty(true)
  }

  const update = (field: string, value: boolean) => {
    setSettings(prev => ({ ...prev, [field]: value }))
    setDirty(true)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Comportamento</CardTitle>
          <CardDescription>Configure como a instância lida com chamadas, grupos e status.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
            <div>
              <span className="text-sm font-medium">Rejeitar Chamadas</span>
              <p className="text-xs text-muted-foreground">Recusar chamadas automaticamente</p>
            </div>
            <Switch checked={settings.rejectCalls} onCheckedChange={v => update('rejectCalls', v)} />
          </label>

          <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
            <div>
              <span className="text-sm font-medium">Ignorar Grupos</span>
              <p className="text-xs text-muted-foreground">Não processar mensagens de grupos</p>
            </div>
            <Switch checked={settings.ignoreGroups} onCheckedChange={v => update('ignoreGroups', v)} />
          </label>

          {instance.channel !== 'EVO_GO' && (
            <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
              <div>
                <span className="text-sm font-medium">Ignorar Broadcasts</span>
                <p className="text-xs text-muted-foreground">Não processar listas de transmissão</p>
              </div>
              <Switch checked={settings.ignoreBroadcasts} onCheckedChange={v => update('ignoreBroadcasts', v)} />
            </label>
          )}

          <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
            <div>
              <span className="text-sm font-medium">Ignorar Status</span>
              <p className="text-xs text-muted-foreground">Não processar atualizações de status</p>
            </div>
            <Switch checked={settings.ignoreStatus} onCheckedChange={v => update('ignoreStatus', v)} />
          </label>

          <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
            <div>
              <span className="text-sm font-medium">Sempre Online</span>
              <p className="text-xs text-muted-foreground">Manter status online sempre</p>
            </div>
            <Switch checked={settings.alwaysOnline} onCheckedChange={v => update('alwaysOnline', v)} />
          </label>

          <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
            <div>
              <span className="text-sm font-medium">Marcar como Lido</span>
              <p className="text-xs text-muted-foreground">Marcar mensagens como lidas automaticamente</p>
            </div>
            <Switch checked={settings.readMessages} onCheckedChange={v => update('readMessages', v)} />
          </label>
        </CardContent>
      </Card>

      {/* Webhook — apenas Baileys */}
      {instance.channel !== 'EVO_GO' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              Webhook
            </CardTitle>
            <CardDescription>URL para receber notificações de mensagens.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>URL do Webhook</Label>
              <Input
                placeholder="https://seu-servidor.com/webhook"
                value={webhookUrl}
                onChange={e => { setWebhookUrl(e.target.value); setDirty(true) }}
              />
            </div>
            <div className="space-y-2">
              <Label>Eventos</Label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={webhookEvents.includes('message.sent')} onChange={() => toggleEvent('message.sent')} />
                  message.sent
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={webhookEvents.includes('message.received')} onChange={() => toggleEvent('message.received')} />
                  message.received
                </label>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Botão salvar */}
      {dirty && (
        <div className="flex justify-end">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar Configurações
          </Button>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════
// ═══ ABA: CLOUD API / COEXISTENCE ═══
// ══════════════════════════════════════════

function CloudApiTab({ instanceId, instance }: { instanceId: string; instance: Instance }) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [config, setConfig] = useState({
    wabaId: instance.wabaId || '',
    phoneNumberId: instance.phoneNumberId || '',
    accessToken: '',
    appId: instance.appId || '',
    webhookSecret: '',
    webhookUrl: instance.webhookUrl || '',
    webhookEvents: instance.webhookEvents || [] as string[],
  })

  const getWebhookUrl = () => {
    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin
    return `${baseUrl}/api/webhook/cloud-api/${instanceId}`
  }

  const saveMutation = useMutation({
    mutationFn: () => api.put(`/instances/${instanceId}/cloud-api-config`, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instance', instanceId] })
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      toast.success('Configuração salva com sucesso')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erro ao salvar')
    },
  })

  const update = (field: string, value: any) => setConfig(prev => ({ ...prev, [field]: value }))

  return (
    <div className="space-y-4">
      {instance.channel === 'COEXISTENCE' && (
        <div className="bg-purple-500/10 border border-purple-500 text-purple-600 dark:text-purple-400 p-3 rounded-lg text-sm">
          <p className="font-semibold mb-2">Sobre o Coexistence:</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>Use o mesmo número do App WhatsApp Business</li>
            <li>Mensagens via App/WhatsApp Web são gratuitas</li>
            <li>Apenas mensagens via API são cobradas</li>
            <li>Rate limit: 20 mensagens por segundo</li>
          </ul>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Credenciais da Meta</CardTitle>
          <CardDescription>Configure as credenciais do Meta Business Suite para esta instância.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>WABA ID (WhatsApp Business Account ID)</Label>
            <Input placeholder="123456789012345" value={config.wabaId} onChange={e => update('wabaId', e.target.value)} />
            <p className="text-xs text-muted-foreground">Encontre no Meta Business Suite → WhatsApp → Configurações</p>
          </div>

          <div className="space-y-2">
            <Label>Phone Number ID</Label>
            <Input placeholder="123456789012345" value={config.phoneNumberId} onChange={e => update('phoneNumberId', e.target.value)} />
            <p className="text-xs text-muted-foreground">ID do número de telefone vinculado à sua conta</p>
          </div>

          <div className="space-y-2">
            <Label>Access Token (Permanente)</Label>
            <Input type="password" placeholder="EAAxxxxxxx..." value={config.accessToken} onChange={e => update('accessToken', e.target.value)} />
            <p className="text-xs text-muted-foreground">Token de acesso permanente gerado no painel de desenvolvedores da Meta</p>
          </div>

          <div className="space-y-2">
            <Label>App ID</Label>
            <Input placeholder="123456789012345" value={config.appId} onChange={e => update('appId', e.target.value)} />
            <p className="text-xs text-muted-foreground">ID do App Meta (necessário para criar templates com PDF)</p>
          </div>

          <div className="space-y-2">
            <Label>Webhook Verify Token</Label>
            <Input placeholder="seu_token_secreto" value={config.webhookSecret} onChange={e => update('webhookSecret', e.target.value)} />
            <p className="text-xs text-muted-foreground">Token para verificação do webhook (você define)</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Webhook
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>URL do Webhook (configure na Meta)</Label>
            <div className="flex gap-2">
              <Input readOnly value={getWebhookUrl()} className="bg-muted" />
              <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(getWebhookUrl()); toast.success('URL copiada') }}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Configure esta URL no Meta Business Suite → WhatsApp → Configuração → Webhook</p>
          </div>

          <div className="space-y-2">
            <Label>Webhook de Notificação (receber eventos)</Label>
            <Input
              placeholder="https://seu-servidor.com/webhook"
              value={config.webhookUrl}
              onChange={e => update('webhookUrl', e.target.value)}
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {['message.sent', 'message.received'].map(ev => (
                <label key={ev} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={config.webhookEvents?.includes(ev) || false}
                    onChange={e => {
                      const events = config.webhookEvents || []
                      update('webhookEvents', e.target.checked ? [...events, ev] : events.filter(x => x !== ev))
                    }}
                  />
                  {ev}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!config.phoneNumberId || !config.accessToken || saveMutation.isPending}
          className="gap-2"
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar Configuração
        </Button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════
// ═══ ABA: EVO GO ═══
// ══════════════════════════════════════════

function EvoGoTab({ instanceId, instance }: { instanceId: string; instance: Instance }) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [config, setConfig] = useState({
    evoApiUrl: instance.evoApiUrl || '',
    evoInstanceId: instance.evoInstanceId || '',
    evoApiKey: '',
  })

  const getEvoGoWebhookUrl = () => {
    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin
    return `${baseUrl}/api/webhook/evo-go/${instanceId}`
  }

  const saveMutation = useMutation({
    mutationFn: () => api.put(`/instances/${instanceId}/evo-go-config`, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instance', instanceId] })
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      toast.success('Configuração Evo Go salva com sucesso')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erro ao salvar')
    },
  })

  const update = (field: string, value: string) => setConfig(prev => ({ ...prev, [field]: value }))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Configuração Evo Go
            <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500 text-xs">API Externa</Badge>
          </CardTitle>
          <CardDescription>Configure as credenciais da API Evo Go para esta instância.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>URL da API</Label>
            <Input placeholder="https://sua-api-evogo.com" value={config.evoApiUrl} onChange={e => update('evoApiUrl', e.target.value)} />
            <p className="text-xs text-muted-foreground">URL base da sua instância Evo Go (sem barra no final)</p>
          </div>

          <div className="space-y-2">
            <Label>Instance ID (UUID)</Label>
            <Input placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={config.evoInstanceId} onChange={e => update('evoInstanceId', e.target.value)} />
            <p className="text-xs text-muted-foreground">UUID da instância no Evo Go</p>
          </div>

          <div className="space-y-2">
            <Label>API Key</Label>
            <Input type="password" placeholder="sua-api-key" value={config.evoApiKey} onChange={e => update('evoApiKey', e.target.value)} />
            <p className="text-xs text-muted-foreground">Chave de autenticação da instância Evo Go</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Webhook (configurado automaticamente)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input readOnly value={getEvoGoWebhookUrl()} className="bg-muted" />
            <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(getEvoGoWebhookUrl()); toast.success('URL copiada') }}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-green-600">O webhook é configurado automaticamente ao salvar/conectar — não precisa configurar manualmente</p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          className="bg-orange-600 hover:bg-orange-700 text-white gap-2"
          onClick={() => saveMutation.mutate()}
          disabled={!config.evoApiUrl || !config.evoInstanceId || !config.evoApiKey || saveMutation.isPending}
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar Configuração
        </Button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════
// ═══ ABA: CONEXÃO (QR CODE) ═══
// ══════════════════════════════════════════

function ConnectionTab({ instanceId, instance }: { instanceId: string; instance: Instance }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)

  useEffect(() => {
    connectSocket()
    const socket = getSocket()

    socket.on('qr-code', ({ instanceId: iid, qrCode: qr }: any) => {
      if (iid === instanceId) setQrCode(qr)
    })
    socket.on('status-update', ({ instanceId: iid, status }: any) => {
      if (iid === instanceId) {
        queryClient.invalidateQueries({ queryKey: ['instance', instanceId] })
        queryClient.invalidateQueries({ queryKey: ['instances'] })
        if (status === 'CONNECTED') {
          setShowQr(false)
          setQrCode(null)
        }
      }
    })
    socket.on('qr-timeout', ({ instanceId: iid }: any) => {
      if (iid === instanceId) {
        setShowQr(false)
        setQrCode(null)
      }
    })

    return () => {
      socket.off('qr-code')
      socket.off('status-update')
      socket.off('qr-timeout')
    }
  }, [instanceId, queryClient])

  const connectMutation = useMutation({
    mutationFn: () => api.post(`/instances/${instanceId}/connect`),
    onSuccess: () => {
      setShowQr(true)
      joinInstance(instanceId)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erro ao conectar')
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: () => api.post(`/instances/${instanceId}/disconnect`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instance', instanceId] })
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      toast.success('Desconectado')
    },
  })

  const logoutMutation = useMutation({
    mutationFn: () => api.post(`/instances/${instanceId}/logout`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instance', instanceId] })
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      toast.success('Logout efetuado')
    },
  })

  const isConnected = instance.status === 'CONNECTED'
  const isDisconnected = instance.status === 'DISCONNECTED' || instance.status === 'CONNECTING'

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Status da Conexão</CardTitle>
          <CardDescription>Gerencie a conexão do WhatsApp para esta instância.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className="font-medium">{isConnected ? 'Conectado' : instance.status === 'CONNECTING' ? 'Conectando...' : 'Desconectado'}</span>
            {instance.phoneNumber && (
              <Badge variant="outline">{instance.phoneNumber}</Badge>
            )}
          </div>

          <div className="flex gap-3">
            {isDisconnected && (
              <Button
                variant="whatsapp"
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
              >
                {connectMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
                {instance.status === 'CONNECTING' ? 'Reconectar' : 'Conectar via QR Code'}
              </Button>
            )}
            {isConnected && (
              <>
                <Button variant="outline" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending}>
                  Desconectar (manter sessão)
                </Button>
                <Button variant="outline" className="text-orange-600" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>
                  Logout (trocar WhatsApp)
                </Button>
              </>
            )}
          </div>

          {/* QR Code inline */}
          {showQr && (
            <div className="border rounded-lg p-6 bg-muted/20 space-y-4">
              <QRCodePoller
                instanceId={instanceId}
                channel={instance.channel}
                isActive={showQr}
                onQrCode={(qr) => setQrCode(qr)}
                onConnected={() => {
                  setShowQr(false)
                  setQrCode(null)
                  queryClient.invalidateQueries({ queryKey: ['instance', instanceId] })
                  queryClient.invalidateQueries({ queryKey: ['instances'] })
                }}
              />
              <div className="flex items-center justify-center">
                {qrCode ? (
                  <img src={qrCode} alt="QR Code" className="w-64 h-64 rounded-lg" />
                ) : (
                  <div className="w-64 h-64 flex items-center justify-center bg-muted rounded-lg">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
              <p className="text-center text-sm text-muted-foreground">
                Abra o WhatsApp no seu celular e escaneie o QR Code. Expira em 60 segundos.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ══════════════════════════════════════════
// ═══ ABA: COMPARTILHAR QR ═══
// ══════════════════════════════════════════

function IconLockSmall() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-muted-foreground">
      <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
    </svg>
  )
}

function ShareTab({ instanceId }: { instanceId: string }) {
  const toast = useToast()
  const [shareForm, setShareForm] = useState({ label: '', password: '', theme: 'dark' as 'dark' | 'light', expiresInHours: 0, maxUses: 0 })
  const [shareLinks, setShareLinks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const res = await api.get(`/instances/${instanceId}/shared-links`)
        setShareLinks(res.data)
      } catch { setShareLinks([]) }
      finally { setLoading(false) }
    }
    load()
  }, [instanceId])

  const getShareUrl = (token: string) => `${window.location.origin}/shared/whatsapp/${token}`

  const handleCreate = async () => {
    setLoading(true)
    try {
      const payload: any = { instanceId, theme: shareForm.theme }
      if (shareForm.label.trim()) payload.label = shareForm.label.trim()
      if (shareForm.password.trim()) payload.password = shareForm.password.trim()
      if (shareForm.expiresInHours > 0) payload.expiresInHours = shareForm.expiresInHours
      if (shareForm.maxUses > 0) payload.maxUses = shareForm.maxUses
      await api.post(`/instances/${instanceId}/shared-links`, payload)
      const res = await api.get(`/instances/${instanceId}/shared-links`)
      setShareLinks(res.data)
      setShareForm({ label: '', password: '', theme: 'dark', expiresInHours: 0, maxUses: 0 })
      toast.success('Link criado com sucesso!')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erro ao criar link')
    } finally { setLoading(false) }
  }

  const handleDelete = async (linkId: string) => {
    try {
      await api.delete(`/instances/${instanceId}/shared-links/${linkId}`)
      setShareLinks(prev => prev.filter(l => l.id !== linkId))
      toast.success('Link excluído')
    } catch { toast.error('Erro ao excluir link') }
  }

  const handleToggle = async (linkId: string, isActive: boolean) => {
    try {
      await api.patch(`/instances/${instanceId}/shared-links/${linkId}`, { isActive: !isActive })
      setShareLinks(prev => prev.map(l => l.id === linkId ? { ...l, isActive: !isActive } : l))
    } catch { toast.error('Erro ao atualizar link') }
  }

  const handleCopy = (linkId: string, token: string) => {
    navigator.clipboard.writeText(getShareUrl(token))
    setCopiedLinkId(linkId)
    setTimeout(() => setCopiedLinkId(null), 2000)
    toast.success('Link copiado!')
  }

  return (
    <div className="space-y-4">
      {/* Formulário de criação */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Compartilhar QR Code
          </CardTitle>
          <CardDescription>Crie links de compartilhamento para que outras pessoas possam conectar o WhatsApp desta instância.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nome (opcional)</Label>
              <Input placeholder="Ex: Para o técnico" value={shareForm.label} onChange={e => setShareForm(f => ({ ...f, label: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Senha (opcional)</Label>
              <Input type="password" placeholder="Deixe vazio para sem senha" value={shareForm.password} onChange={e => setShareForm(f => ({ ...f, password: e.target.value }))} className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Tema</Label>
              <div className="flex items-center gap-1 mt-1">
                <button
                  onClick={() => setShareForm(f => ({ ...f, theme: 'dark' }))}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                    shareForm.theme === 'dark'
                      ? 'bg-gray-900 text-white border-gray-700'
                      : 'bg-muted text-muted-foreground border-transparent hover:border-border'
                  }`}
                >
                  <Moon className="h-3.5 w-3.5" /> Dark
                </button>
                <button
                  onClick={() => setShareForm(f => ({ ...f, theme: 'light' }))}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                    shareForm.theme === 'light'
                      ? 'bg-white text-gray-900 border-gray-300 shadow-sm'
                      : 'bg-muted text-muted-foreground border-transparent hover:border-border'
                  }`}
                >
                  <Sun className="h-3.5 w-3.5" /> Light
                </button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Expira em (horas)</Label>
              <Input type="number" min={0} placeholder="0 = sem expiração" value={shareForm.expiresInHours || ''} onChange={e => setShareForm(f => ({ ...f, expiresInHours: parseInt(e.target.value) || 0 }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Limite de acessos</Label>
              <Input type="number" min={0} placeholder="0 = ilimitado" value={shareForm.maxUses || ''} onChange={e => setShareForm(f => ({ ...f, maxUses: parseInt(e.target.value) || 0 }))} className="mt-1" />
            </div>
          </div>

          <Button onClick={handleCreate} disabled={loading} className="w-full">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link className="mr-2 h-4 w-4" />}
            Gerar link
          </Button>
        </CardContent>
      </Card>

      {/* Links existentes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Links ativos ({shareLinks.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && shareLinks.length === 0 ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : shareLinks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum link criado ainda</p>
          ) : (
            <div className="space-y-2">
              {shareLinks.map(link => (
                <div key={link.id} className={`border rounded-lg p-3 space-y-2 ${!link.isActive ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${link.isActive ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                      <span className="text-sm font-medium truncate">{link.label || 'Link sem nome'}</span>
                      {link.hasPassword && <IconLockSmall />}
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        link.theme === 'dark' ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600 border'
                      }`}>
                        {link.theme === 'dark' ? '🌙' : '☀️'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCopy(link.id, link.token)} title="Copiar link">
                        {copiedLinkId === link.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => window.open(getShareUrl(link.token), '_blank')} title="Abrir em nova aba">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleToggle(link.id, link.isActive)} title={link.isActive ? 'Desativar' : 'Ativar'}>
                        {link.isActive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(link.id)} title="Excluir">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    {link.expiresAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Expira: {new Date(link.expiresAt).toLocaleDateString('pt-BR')}
                      </span>
                    )}
                    {link.maxUses ? <span>Acessos: {link.currentUses}/{link.maxUses}</span> : <span>Acessos: {link.currentUses}</span>}
                    {link.createdBy?.name && <span>por {link.createdBy.name}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ══════════════════════════════════════════
// ═══ ABA: COLABORADORES ═══
// ══════════════════════════════════════════

function MembersTab({ instanceId }: { instanceId: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])

  // Membros atuais
  const { data: members = [], isLoading } = useQuery<InstanceMember[]>({
    queryKey: ['instance-members', instanceId],
    queryFn: () => api.get(`/channel-settings/${instanceId}/members`).then(r => r.data),
  })

  // Todos os usuários da empresa (para o dialog de adicionar)
  const { data: allUsers = [] } = useQuery<CompanyUser[]>({
    queryKey: ['company-users'],
    queryFn: () => api.get('/users').then(r => r.data),
    enabled: addOpen,
  })

  // Adicionar membros
  const addMutation = useMutation({
    mutationFn: (userIds: string[]) =>
      api.post(`/channel-settings/${instanceId}/members`, { userIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instance-members', instanceId] })
      setAddOpen(false)
      setSelectedUserIds([])
      toast.success('Colaboradores adicionados com sucesso')
    },
    onError: () => toast.error('Erro ao adicionar colaboradores'),
  })

  // Remover membro
  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/channel-settings/${instanceId}/members/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instance-members', instanceId] })
      toast.success('Colaborador removido')
    },
    onError: () => toast.error('Erro ao remover colaborador'),
  })

  const existingUserIds = new Set(members.map(m => m.userId))
  const availableUsers = allUsers.filter(u => !existingUserIds.has(u.id) && u.isActive)

  const toggleUser = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Colaboradores</CardTitle>
            <CardDescription>
              Usuários que podem acessar, visualizar e enviar mensagens por este canal.
              {members.length === 0 && ' Sem restrição: todos os usuários da empresa têm acesso.'}
            </CardDescription>
          </div>
          <Button onClick={() => setAddOpen(true)} size="sm" className="gap-2">
            <UserPlus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">Nenhum colaborador configurado</p>
            <p className="text-sm mt-1">Todos os usuários da empresa podem acessar este canal.</p>
            <p className="text-sm">Adicione colaboradores para restringir o acesso.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {members.map(member => (
              <div
                key={member.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm">
                    {member.user.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-sm text-foreground">{member.user.name}</p>
                    <p className="text-xs text-muted-foreground">{member.user.email}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => removeMutation.mutate(member.userId)}
                  disabled={removeMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Dialog adicionar */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Adicionar Colaboradores</DialogTitle>
              <DialogDescription>
                Selecione os usuários que terão acesso a este canal.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[300px] overflow-y-auto space-y-1 py-2">
              {availableUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Todos os usuários já são colaboradores deste canal.
                </p>
              ) : (
                availableUsers.map(user => (
                  <label
                    key={user.id}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedUserIds.includes(user.id)
                        ? 'bg-primary/10 border border-primary/30'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(user.id)}
                      onChange={() => toggleUser(user.id)}
                      className="rounded border-input"
                    />
                    <div>
                      <p className="text-sm font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </label>
                ))
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => addMutation.mutate(selectedUserIds)}
                disabled={selectedUserIds.length === 0 || addMutation.isPending}
              >
                {addMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Adicionar ({selectedUserIds.length})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

// ══════════════════════════════════════════
// ═══ ABA: HORÁRIO DE FUNCIONAMENTO ═══
// ══════════════════════════════════════════

function WorkingHoursTab({ instanceId }: { instanceId: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [enabled, setEnabled] = useState(false)
  const [message, setMessage] = useState('')
  const [timezone, setTimezone] = useState('America/Sao_Paulo')
  const [hours, setHours] = useState<WorkingHour[]>([])
  const [dirty, setDirty] = useState(false)

  const { data, isLoading } = useQuery<WorkingHoursConfig>({
    queryKey: ['working-hours', instanceId],
    queryFn: () => api.get(`/channel-settings/${instanceId}/working-hours`).then(r => r.data),
  })

  useEffect(() => {
    if (data) {
      setEnabled(data.workingHoursEnabled)
      setMessage(data.outOfOfficeMessage || '')
      setTimezone(data.timezone)
      setHours(data.hours)
      setDirty(false)
    }
  }, [data])

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/channel-settings/${instanceId}/working-hours`, {
        workingHoursEnabled: enabled,
        outOfOfficeMessage: message || null,
        timezone,
        hours: hours.map(h => ({
          dayOfWeek: h.dayOfWeek,
          openHour: h.openHour,
          openMinutes: h.openMinutes,
          closeHour: h.closeHour,
          closeMinutes: h.closeMinutes,
          closedAllDay: h.closedAllDay,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['working-hours', instanceId] })
      setDirty(false)
      toast.success('Horários salvos com sucesso')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erro ao salvar horários')
    },
  })

  const updateHour = (dayOfWeek: number, field: string, value: any) => {
    setHours(prev =>
      prev.map(h => (h.dayOfWeek === dayOfWeek ? { ...h, [field]: value } : h))
    )
    setDirty(true)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Config geral */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Horário de Funcionamento</CardTitle>
              <CardDescription>
                Configure o horário de atendimento. Fora do horário, uma mensagem automática será enviada.
              </CardDescription>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={v => { setEnabled(v); setDirty(true) }}
            />
          </div>
        </CardHeader>
        {enabled && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fuso horário</Label>
                <Select value={timezone} onValueChange={v => { setTimezone(v); setDirty(true) }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map(tz => (
                      <SelectItem key={tz} value={tz}>
                        {tz.replace('America/', '').replaceAll('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Mensagem de ausência</Label>
              <Textarea
                value={message}
                onChange={e => { setMessage(e.target.value); setDirty(true) }}
                placeholder="Olá! No momento estamos fora do horário de atendimento. Retornaremos em breve!"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Enviada automaticamente quando alguém envia mensagem fora do horário configurado.
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Horários por dia */}
      {enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Horários por dia da semana</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {hours.map(h => (
                <div
                  key={h.dayOfWeek}
                  className={`flex items-center gap-4 p-3 rounded-lg transition-colors ${
                    h.closedAllDay ? 'bg-red-500/5' : 'bg-muted/30'
                  }`}
                >
                  <div className="w-24 font-medium text-sm">
                    {DAY_SHORT[h.dayOfWeek]}
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={!h.closedAllDay}
                      onCheckedChange={v => updateHour(h.dayOfWeek, 'closedAllDay', !v)}
                    />
                    <span className="text-xs text-muted-foreground w-16">
                      {h.closedAllDay ? 'Fechado' : 'Aberto'}
                    </span>
                  </div>

                  {!h.closedAllDay && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={formatTime(h.openHour, h.openMinutes)}
                        onChange={e => {
                          const { hour, minutes } = parseTime(e.target.value)
                          updateHour(h.dayOfWeek, 'openHour', hour)
                          updateHour(h.dayOfWeek, 'openMinutes', minutes)
                        }}
                        className="w-28"
                      />
                      <span className="text-muted-foreground text-sm">até</span>
                      <Input
                        type="time"
                        value={formatTime(h.closeHour, h.closeMinutes)}
                        onChange={e => {
                          const { hour, minutes } = parseTime(e.target.value)
                          updateHour(h.dayOfWeek, 'closeHour', hour)
                          updateHour(h.dayOfWeek, 'closeMinutes', minutes)
                        }}
                        className="w-28"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Botão salvar */}
      {dirty && (
        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="gap-2"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar Horários
          </Button>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════
// ═══ ABA: PESQUISA DE SATISFAÇÃO (CSAT) ═══
// ══════════════════════════════════════════

function CsatTab({ instanceId }: { instanceId: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [csatEnabled, setCsatEnabled] = useState(false)
  const [csatMessage, setCsatMessage] = useState('')
  const [dirty, setDirty] = useState(false)

  // Config CSAT
  const { data: config } = useQuery<CsatConfig>({
    queryKey: ['csat-config', instanceId],
    queryFn: () => api.get(`/channel-settings/${instanceId}/csat`).then(r => r.data),
  })

  // Métricas
  const { data: metrics } = useQuery<CsatMetrics>({
    queryKey: ['csat-metrics', instanceId],
    queryFn: () => api.get(`/channel-settings/${instanceId}/csat/metrics`).then(r => r.data),
  })

  // Respostas recentes
  const { data: responsesData } = useQuery({
    queryKey: ['csat-responses', instanceId],
    queryFn: () => api.get(`/channel-settings/${instanceId}/csat/responses?limit=10`).then(r => r.data),
  })

  useEffect(() => {
    if (config) {
      setCsatEnabled(config.csatEnabled)
      setCsatMessage(config.csatMessage || '')
      setDirty(false)
    }
  }, [config])

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/channel-settings/${instanceId}/csat`, {
        csatEnabled,
        csatMessage: csatMessage || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['csat-config', instanceId] })
      setDirty(false)
      toast.success('Configuração de CSAT salva')
    },
    onError: () => toast.error('Erro ao salvar configuração'),
  })

  const responses: CsatResponse[] = responsesData?.responses || []
  const ratingEmojis = ['', '😡', '😕', '😐', '😊', '🤩']
  const ratingLabels = ['', 'Péssimo', 'Ruim', 'Regular', 'Bom', 'Excelente']

  return (
    <div className="space-y-4">
      {/* Config */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Pesquisa de Satisfação</CardTitle>
              <CardDescription>
                Ao resolver uma conversa, o contato recebe uma pesquisa diretamente pelo WhatsApp com botões de avaliação (1 a 5 estrelas).
              </CardDescription>
            </div>
            <Switch
              checked={csatEnabled}
              onCheckedChange={v => { setCsatEnabled(v); setDirty(true) }}
            />
          </div>
        </CardHeader>
        {csatEnabled && (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Mensagem da pesquisa</Label>
              <Textarea
                value={csatMessage}
                onChange={e => { setCsatMessage(e.target.value); setDirty(true) }}
                placeholder="Como você avalia o atendimento que recebeu? Por favor, escolha uma nota de 1 a 5:"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Esta mensagem é enviada junto com os botões de avaliação quando a conversa é resolvida.
              </p>
            </div>

            <div className="rounded-lg bg-muted/30 p-4">
              <p className="text-sm font-medium mb-2">Prévia da mensagem:</p>
              <div className="bg-green-600/10 rounded-lg p-3 max-w-sm space-y-1">
                <p className="text-xs font-semibold text-green-700 dark:text-green-400">📊 Pesquisa de Satisfação</p>
                <p className="text-sm text-foreground">
                  {csatMessage || 'Como você avalia o atendimento que recebeu?\n\nPor favor, escolha uma nota de 1 a 5:'}
                </p>
                <div className="flex flex-col gap-1 mt-2">
                  {['⭐ 1 - Péssimo', '⭐⭐ 2 - Ruim', '⭐⭐⭐ 3 - Regular'].map(btn => (
                    <div key={btn} className="bg-background/50 rounded px-3 py-1.5 text-center text-xs font-medium border border-border/30">
                      {btn}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {dirty && (
              <div className="flex justify-end">
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="gap-2"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Salvar
                </Button>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Métricas */}
      {csatEnabled && metrics && metrics.totalResponses > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Métricas</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-center p-4 rounded-lg bg-muted/30">
                <p className="text-3xl font-bold text-primary">
                  {metrics.averageRating.toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Média geral</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/30">
                <p className="text-3xl font-bold text-foreground">
                  {metrics.totalResponses}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Total de respostas</p>
              </div>
            </div>

            {/* Distribuição por nota */}
            <div className="space-y-2">
              {[5, 4, 3, 2, 1].map(rating => {
                const item = metrics.distribution.find(d => d.rating === rating)
                const count = item?.count || 0
                const pct = metrics.totalResponses > 0 ? (count / metrics.totalResponses) * 100 : 0
                return (
                  <div key={rating} className="flex items-center gap-3">
                    <span className="text-sm w-6 text-right">{rating}</span>
                    <span className="text-lg w-6">{ratingEmojis[rating]}</span>
                    <div className="flex-1 h-6 bg-muted/30 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          rating >= 4 ? 'bg-green-500' : rating === 3 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-12 text-right">
                      {count} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Respostas recentes */}
      {csatEnabled && responses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimas Avaliações</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {responses.map(resp => (
                <div key={resp.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{ratingEmojis[resp.rating]}</span>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {resp.contact.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {resp.assignedAgent ? `Atendido por ${resp.assignedAgent.name}` : 'Sem atendente'}
                        {' — '}
                        {new Date(resp.createdAt).toLocaleDateString('pt-BR')}
                      </p>
                      {resp.feedbackMessage && (
                        <p className="text-xs text-muted-foreground mt-1 italic">
                          "{resp.feedbackMessage}"
                        </p>
                      )}
                    </div>
                  </div>
                  <Badge variant={resp.rating >= 4 ? 'default' : resp.rating === 3 ? 'secondary' : 'destructive'}>
                    {ratingLabels[resp.rating]}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
