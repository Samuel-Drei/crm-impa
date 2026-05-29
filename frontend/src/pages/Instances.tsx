import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Smartphone,
  MoreVertical,
  Power,
  PowerOff,
  Trash2,
  RefreshCw,
  Copy,
  QrCode,
  ArrowDownCircle,
  ArrowUpCircle,
  Loader2,
  Settings,
  Webhook,
  LogOut,
  Zap,
} from 'lucide-react'
import { useFacebookSDK } from '@/hooks/useFacebookSDK'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import api from '@/services/api'
import { getSocket, connectSocket, joinInstance, leaveInstance } from '@/services/socket'
import type { Instance } from '@/types'

// Componente que faz polling do QR Code direto da API (igual o Manager da Evo Go)
function QRCodePoller({
  instanceId,
  channel,
  isOpen,
  onQrCode,
  onConnected,
}: {
  instanceId: string | null
  channel: string
  isOpen: boolean
  onQrCode: (qr: string) => void
  onConnected: () => void
}) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Usar refs para callbacks para evitar stale closures no setInterval
  const onConnectedRef = useRef(onConnected)
  const onQrCodeRef = useRef(onQrCode)
  onConnectedRef.current = onConnected
  onQrCodeRef.current = onQrCode

  useEffect(() => {
    // Só faz polling para Evo Go quando o modal está aberto
    if (!isOpen || !instanceId || channel !== 'EVO_GO') {
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
        // QR não disponível ainda, continuar tentando
      }
    }

    // Buscar imediatamente ao abrir
    fetchQR()

    // Polling a cada 5 segundos (Manager usa 10s)
    intervalRef.current = setInterval(fetchQR, 5000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isOpen, instanceId, channel])

  return null // Componente invisível, só faz polling
}

export function Instances() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const { startCoexistenceSignup, isLoading: fbLoading, isSDKLoaded } = useFacebookSDK()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showQRModal, setShowQRModal] = useState(false)
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [newInstance, setNewInstance] = useState({
    name: '',
    description: '',
    channel: 'EVO_GO' as 'BAILEYS' | 'WHATSMEOW' | 'CLOUD_API' | 'COEXISTENCE' | 'EVO_GO',
  })
  const [systemBlocked, setSystemBlocked] = useState<string | null>(null)

  // Check system status
  const { data: systemStatus } = useQuery<{ operational: boolean; message: string | null; evoGoConfigured: boolean }>({
    queryKey: ['system-status'],
    queryFn: async () => {
      const response = await api.get('/instances/system-status')
      return response.data
    },
    refetchInterval: 10000,
  })

  // Update systemBlocked state based on API response
  useEffect(() => {
    if (systemStatus) {
      if (!systemStatus.operational) {
        setSystemBlocked(systemStatus.message || 'Sistema bloqueado')
      } else {
        setSystemBlocked(null)
      }
    }
  }, [systemStatus])

  const { data: instances, isLoading } = useQuery<Instance[]>({
    queryKey: ['instances'],
    queryFn: async () => {
      const response = await api.get('/instances')
      return response.data
    },
    refetchInterval: showQRModal ? 5000 : 10000, // Polling mais rápido quando modal QR está aberto
  })

  // Auto-fechar modal QR quando instância conectar (igual o Manager da Evo Go)
  useEffect(() => {
    if (showQRModal && selectedInstance && instances) {
      const current = instances.find((i) => i.id === selectedInstance.id)
      if (current && current.status === 'CONNECTED') {
        setShowQRModal(false)
        setQrCode(null)
      }
    }
  }, [instances, showQRModal, selectedInstance])

  const createMutation = useMutation({
    mutationFn: async (data: typeof newInstance) => {
      const response = await api.post('/instances', data)
      return response.data
    },
    onSuccess: async (createdInstance) => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      setShowCreateModal(false)
      setNewInstance({ name: '', description: '', channel: 'EVO_GO' as 'BAILEYS' | 'WHATSMEOW' | 'CLOUD_API' | 'COEXISTENCE' | 'EVO_GO' })

      // Se Evo Go com modo automático, conectar automaticamente e abrir QR
      if (createdInstance.channel === 'EVO_GO' && createdInstance.evoInstanceId) {
        try {
          await api.post(`/instances/${createdInstance.id}/connect`)
          setSelectedInstance(createdInstance)
          setShowQRModal(true)
          joinInstance(createdInstance.id)
        } catch (error: any) {
          console.error('Erro ao conectar Evo Go automaticamente:', error)
        }
        queryClient.invalidateQueries({ queryKey: ['instances'] })
      }
    },
    onError: (error: any) => {
      const msg = error.response?.data?.error || error.message || 'Erro ao criar instância'
      toast.error(msg)
    },
  })

  const connectMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/instances/${id}/connect`)
      return response.data
    },
    onSuccess: (_, id) => {
      setSelectedInstance(instances?.find((i) => i.id === id) || null)
      setShowQRModal(true)
      joinInstance(id)
    },
    onError: (error: any) => {
      const msg = error.response?.data?.error || error.message || 'Erro ao conectar'
      toast.error(msg)
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/instances/${id}/disconnect`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
  })

  const restartMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/instances/${id}/restart`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
    onError: (error: any) => {
      const msg = error.response?.data?.error || error.message || 'Erro ao reiniciar'
      toast.error(msg)
    },
  })

  const logoutMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/instances/${id}/logout`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/instances/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
    },
  })

  const syncTemplatesMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/instances/${id}/sync-templates`)
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast.success(`Sincronização concluída: ${data.message}`)
    },
    onError: (error: any) => {
      toast.error(`Erro ao sincronizar: ${error.response?.data?.error || error.message}`)
    },
  })

  const reimportHistoryMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/messages/reimport-history/${id}`)
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      toast.success(`Sincronização iniciada. Banco atual: ${data?.existingMessages ?? 0} msgs. Apenas mensagens novas serão adicionadas (pode levar alguns minutos).`)
    },
    onError: (error: any) => {
      toast.error(`Erro ao reimportar histórico: ${error.response?.data?.error || error.message}`)
    },
  })

  const embeddedSignupMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { code: string; wabaId?: string; phoneNumberId?: string } }) => {
      const response = await api.post(`/instances/${id}/embedded-signup`, data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      toast.success('Coexistence conectado com sucesso!')
    },
    onError: (error: any) => {
      const msg = error.response?.data?.error || error.message || 'Erro ao conectar Coexistence'
      toast.error(msg)
    },
  })

  const handleCoexistenceConnect = async (instance: Instance) => {
    const configId = import.meta.env.VITE_META_CONFIG_ID

    if (!configId) {
      toast.warning('VITE_META_CONFIG_ID não configurado. Verifique as variáveis de ambiente.')
      return
    }

    if (!isSDKLoaded) {
      toast.warning('Facebook SDK ainda não foi carregado. Aguarde um momento e tente novamente.')
      return
    }

    try {
      // 1. Start Embedded Signup (opens Meta modal)
      const result = await startCoexistenceSignup(configId)

      // 2. Send credentials to backend
      await embeddedSignupMutation.mutateAsync({
        id: instance.id,
        data: {
          code: result.code,
          wabaId: result.wabaId,
          phoneNumberId: result.phoneNumberId,
        },
      })
    } catch (error: any) {
      console.error('Coexistence connect error:', error)
      // Error is handled by the mutation or the hook
    }
  }

  useEffect(() => {
    connectSocket()
    const socket = getSocket()

    socket.on('qr-code', ({ instanceId, qrCode: qr }) => {
      if (selectedInstance?.id === instanceId) {
        setQrCode(qr)
      }
    })

    socket.on('status-update', ({ instanceId, status, message }) => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      if (status === 'CONNECTED' && selectedInstance?.id === instanceId) {
        setShowQRModal(false)
        setQrCode(null)
        setSystemBlocked(null)
      }
      // Show system blocked message
      if (message && status === 'DISCONNECTED') {
        setSystemBlocked(message)
      }
    })

    socket.on('qr-timeout', ({ instanceId }) => {
      if (selectedInstance?.id === instanceId) {
        setShowQRModal(false)
        setQrCode(null)
      }
    })

    return () => {
      socket.off('qr-code')
      socket.off('status-update')
      socket.off('qr-timeout')
    }
  }, [selectedInstance, queryClient])

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token)
  }

  const getWebhookUrl = (instanceId: string) => {
    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin
    return `${baseUrl}/api/webhook/cloud-api/${instanceId}`
  }

  const getEvoGoWebhookUrl = (instanceId: string) => {
    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin
    return `${baseUrl}/api/webhook/evo-go/${instanceId}`
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'CONNECTED':
        return 'success'
      case 'CONNECTING':
        return 'warning'
      case 'BANNED':
        return 'destructive'
      default:
        return 'secondary'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'CONNECTED':
        return 'Conectado'
      case 'CONNECTING':
        return 'Conectando'
      case 'BANNED':
        return 'Banido'
      default:
        return 'Desconectado'
    }
  }

  return (
    <div className="space-y-6">
      {/* System Blocked Alert */}
      {systemBlocked && (
        <div className="bg-red-500/10 border border-red-500 text-red-500 px-4 py-3 rounded-lg flex items-center gap-3">
          <PowerOff className="h-5 w-5" />
          <div>
            <p className="font-semibold">Sistema Bloqueado</p>
            <p className="text-sm">{systemBlocked}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/8"><Smartphone className="h-5 w-5 text-primary" /></div>
            Instâncias
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie suas conexões do WhatsApp
          </p>
        </div>
        <Button
          onClick={() => setShowCreateModal(true)}
          variant="whatsapp"
          disabled={!!systemBlocked}
          title={systemBlocked ? 'Sistema bloqueado' : undefined}
        >
          <Plus className="mr-2 h-4 w-4" />
          Nova Instância
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.isArray(instances) && instances.map((instance) => (
            <Card key={instance.id} className="relative overflow-hidden">
              {/* Status indicator */}
              <div
                className={`absolute top-0 left-0 right-0 h-1 ${
                  instance.status === 'CONNECTED'
                    ? 'bg-green-500'
                    : instance.status === 'CONNECTING'
                    ? 'bg-yellow-500'
                    : 'bg-gray-300 dark:bg-gray-700'
                }`}
              />

              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={instance.profilePicture || undefined} />
                      <AvatarFallback className="bg-whatsapp text-white">
                        <Smartphone className="h-6 w-6" />
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <CardTitle className="text-lg">{instance.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {instance.phoneNumber || 'Não conectado'}
                      </p>
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {instance.channel === 'BAILEYS' && ['DISCONNECTED', 'CONNECTING'].includes(instance.status) && (
                        <>
                          <DropdownMenuItem
                            onClick={() => connectMutation.mutate(instance.id)}
                          >
                            <Power className="mr-2 h-4 w-4" />
                            {instance.status === 'CONNECTING' ? 'Reconectar' : 'Conectar'}
                          </DropdownMenuItem>
                          {instance.status === 'CONNECTING' && (
                            <DropdownMenuItem
                              onClick={() => restartMutation.mutate(instance.id)}
                              disabled={restartMutation.isPending}
                            >
                              <RefreshCw className={`mr-2 h-4 w-4 ${restartMutation.isPending ? 'animate-spin' : ''}`} />
                              Reiniciar (novo QR)
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                      {instance.channel === 'BAILEYS' && instance.status === 'CONNECTED' && (
                        <>
                          <DropdownMenuItem
                            onClick={() => disconnectMutation.mutate(instance.id)}
                          >
                            <PowerOff className="mr-2 h-4 w-4" />
                            Desconectar (manter sessão)
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => logoutMutation.mutate(instance.id)}
                            className="text-orange-600"
                          >
                            <LogOut className="mr-2 h-4 w-4" />
                            Logout (trocar WhatsApp)
                          </DropdownMenuItem>
                        </>
                      )}
                      {(instance.channel === 'CLOUD_API' || instance.channel === 'COEXISTENCE') && instance.status === 'CONNECTED' && (
                        <DropdownMenuItem
                          onClick={() => disconnectMutation.mutate(instance.id)}
                        >
                          <PowerOff className="mr-2 h-4 w-4" />
                          Desconectar
                        </DropdownMenuItem>
                      )}
                      {instance.channel === 'EVO_GO' && ['DISCONNECTED', 'CONNECTING'].includes(instance.status) && (
                        <>
                          <DropdownMenuItem
                            onClick={() => connectMutation.mutate(instance.id)}
                          >
                            <Power className="mr-2 h-4 w-4" />
                            {instance.status === 'CONNECTING' ? 'Reconectar' : 'Conectar'}
                          </DropdownMenuItem>
                          {instance.status === 'CONNECTING' && (
                            <DropdownMenuItem
                              onClick={() => disconnectMutation.mutate(instance.id)}
                            >
                              <PowerOff className="mr-2 h-4 w-4" />
                              Desconectar
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                      {instance.channel === 'EVO_GO' && instance.status === 'CONNECTED' && (
                        <>
                          <DropdownMenuItem
                            onClick={() => disconnectMutation.mutate(instance.id)}
                          >
                            <PowerOff className="mr-2 h-4 w-4" />
                            Desconectar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => logoutMutation.mutate(instance.id)}
                            className="text-orange-600"
                          >
                            <LogOut className="mr-2 h-4 w-4" />
                            Logout
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => reimportHistoryMutation.mutate(instance.id)}
                            disabled={reimportHistoryMutation.isPending}
                          >
                            <RefreshCw className={`mr-2 h-4 w-4 ${reimportHistoryMutation.isPending ? 'animate-spin' : ''}`} />
                            Sincronizar histórico
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuItem
                        onClick={() => handleCopyToken(instance.apiToken)}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Copiar Token
                      </DropdownMenuItem>
                      {(instance.channel === 'CLOUD_API' || instance.channel === 'COEXISTENCE') && instance.status === 'CONNECTED' && (
                        <DropdownMenuItem
                          onClick={() => syncTemplatesMutation.mutate(instance.id)}
                          disabled={syncTemplatesMutation.isPending}
                        >
                          <RefreshCw className={`mr-2 h-4 w-4 ${syncTemplatesMutation.isPending ? 'animate-spin' : ''}`} />
                          Sincronizar Templates
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => navigate(`/instances/${instance.id}/settings`)}
                      >
                        <Settings className="mr-2 h-4 w-4" />
                        Configurações do Canal
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => deleteMutation.mutate(instance.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Badge variant={getStatusColor(instance.status) as any}>
                    {getStatusLabel(instance.status)}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={
                      instance.channel === 'COEXISTENCE' ? 'bg-purple-500/10 text-purple-600 border-purple-500' :
                      instance.channel === 'EVO_GO' ? 'bg-orange-500/10 text-orange-600 border-orange-500' :
                      instance.channel === 'WHATSMEOW' ? 'bg-teal-500/10 text-teal-600 border-teal-500' : ''
                    }
                  >
                    {instance.channel === 'BAILEYS' ? 'Baileys' : instance.channel === 'WHATSMEOW' ? 'WhatsMeow' : instance.channel === 'COEXISTENCE' ? 'Coexistence' : instance.channel === 'EVO_GO' ? 'Evo Go' : 'Cloud API'}
                  </Badge>
                </div>

                {/* Coexistence rate limit indicator */}
                {instance.channel === 'COEXISTENCE' && instance.status === 'CONNECTED' && (
                  <div className="flex items-center gap-1 text-xs text-purple-600 bg-purple-500/10 rounded px-2 py-1">
                    <span>20 MPS limit</span>
                  </div>
                )}

                {/* Metrics */}
                <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <ArrowUpCircle className="h-4 w-4 text-green-500" />
                    <div>
                      <p className="text-sm font-medium">{instance.messagesSent}</p>
                      <p className="text-xs text-muted-foreground">Enviadas</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowDownCircle className="h-4 w-4 text-blue-500" />
                    <div>
                      <p className="text-sm font-medium">{instance.messagesReceived}</p>
                      <p className="text-xs text-muted-foreground">Recebidas</p>
                    </div>
                  </div>
                </div>

                {/* Webhook URL for Cloud API / Coexistence */}
                {(instance.channel === 'CLOUD_API' || instance.channel === 'COEXISTENCE') && (
                  <div className="pt-2 border-t">
                    <Label className="text-xs flex items-center gap-1 mb-1">
                      <Webhook className="h-3 w-3" />
                      Webhook URL (para Meta)
                    </Label>
                    <div className="flex gap-1">
                      <Input
                        readOnly
                        value={getWebhookUrl(instance.id)}
                        className="bg-muted text-xs h-8"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigator.clipboard.writeText(getWebhookUrl(instance.id))
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Webhook URL for Evo Go */}
                {instance.channel === 'EVO_GO' && (
                  <div className="pt-2 border-t">
                    <Label className="text-xs flex items-center gap-1 mb-1">
                      <Webhook className="h-3 w-3" />
                      Webhook URL (para Evo Go)
                    </Label>
                    <div className="flex gap-1">
                      <Input
                        readOnly
                        value={getEvoGoWebhookUrl(instance.id)}
                        className="bg-muted text-xs h-8"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigator.clipboard.writeText(getEvoGoWebhookUrl(instance.id))
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Actions */}
                {instance.channel === 'BAILEYS' && ['DISCONNECTED', 'CONNECTING'].includes(instance.status) && (
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => connectMutation.mutate(instance.id)}
                    disabled={connectMutation.isPending || !!systemBlocked}
                    title={systemBlocked ? 'Sistema bloqueado' : undefined}
                  >
                    {connectMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <QrCode className="mr-2 h-4 w-4" />
                    )}
                    {instance.status === 'CONNECTING' ? 'Reconectar via QR Code' : 'Conectar via QR Code'}
                  </Button>
                )}
                {instance.channel === 'CLOUD_API' && instance.status === 'DISCONNECTED' && (
                  <p className="text-sm text-muted-foreground text-center">
                    Configure as credenciais da Meta nas configurações
                  </p>
                )}
                {instance.channel === 'COEXISTENCE' && instance.status === 'DISCONNECTED' && (
                  <Button
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={() => handleCoexistenceConnect(instance)}
                    disabled={fbLoading || embeddedSignupMutation.isPending || !isSDKLoaded || !!systemBlocked}
                    title={systemBlocked ? 'Sistema bloqueado' : !isSDKLoaded ? 'Carregando Facebook SDK...' : undefined}
                  >
                    {(fbLoading || embeddedSignupMutation.isPending) ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="mr-2 h-4 w-4" />
                    )}
                    Conectar Coexistence
                  </Button>
                )}
                {instance.channel === 'EVO_GO' && ['DISCONNECTED', 'CONNECTING'].includes(instance.status) && (
                  instance.evoApiUrl && instance.evoInstanceId ? (
                    <div className="flex gap-2 w-full">
                      <Button
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => connectMutation.mutate(instance.id)}
                        disabled={connectMutation.isPending || !!systemBlocked}
                        title={systemBlocked ? 'Sistema bloqueado' : undefined}
                      >
                        {connectMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Power className="mr-2 h-4 w-4" />
                        )}
                        {instance.status === 'CONNECTING' ? 'Reconectar' : 'Conectar Evo Go'}
                      </Button>
                      {instance.status === 'CONNECTING' && (
                        <Button
                          variant="outline"
                          onClick={() => disconnectMutation.mutate(instance.id)}
                          disabled={disconnectMutation.isPending}
                          title="Desconectar"
                        >
                          <PowerOff className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => navigate(`/instances/${instance.id}/settings?tab=evo-go`)}
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      Configurar Evo Go
                    </Button>
                  )
                )}
              </CardContent>
            </Card>
          ))}

          {instances?.length === 0 && (
            <Card className="col-span-full">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Smartphone className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="font-medium text-lg mb-2">Nenhuma instância</h3>
                <p className="text-muted-foreground text-center mb-4">
                  Crie sua primeira instância para começar a enviar mensagens
                </p>
                <Button onClick={() => setShowCreateModal(true)} variant="whatsapp">
                  <Plus className="mr-2 h-4 w-4" />
                  Criar Instância
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Create Instance Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Instância</DialogTitle>
            <DialogDescription>
              Configure uma nova conexão do WhatsApp
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                placeholder="Minha Instância"
                value={newInstance.name}
                onChange={(e) =>
                  setNewInstance({ ...newInstance, name: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descrição (opcional)</Label>
              <Input
                id="description"
                placeholder="Instância para atendimento"
                value={newInstance.description}
                onChange={(e) =>
                  setNewInstance({ ...newInstance, description: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="channel">Canal</Label>
              <Select
                value={newInstance.channel}
                onValueChange={(value: 'BAILEYS' | 'WHATSMEOW' | 'CLOUD_API' | 'COEXISTENCE' | 'EVO_GO') =>
                  setNewInstance({ ...newInstance, channel: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BAILEYS" disabled className="opacity-50 cursor-not-allowed">
                    Baileys (QR Code) — ⚠️ Em manutenção
                  </SelectItem>
                  <SelectItem value="WHATSMEOW" disabled className="opacity-50 cursor-not-allowed">
                    WhatsMeow (QR Code) — ⚠️ Em manutenção
                  </SelectItem>
                  <SelectItem value="CLOUD_API">Cloud API (Meta)</SelectItem>
                  <SelectItem value="COEXISTENCE">Coexistence (App + API)</SelectItem>
                  <SelectItem value="EVO_GO">Evo Go (API Externa)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Coexistence limitations warning */}
            {newInstance.channel === 'COEXISTENCE' && (
              <div className="bg-purple-500/10 border border-purple-500 text-purple-600 dark:text-purple-400 p-3 rounded-lg text-sm space-y-2">
                <p className="font-semibold">Limitações do Coexistence:</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Throughput limitado a 20 msg/seg (vs 80 da Cloud API)</li>
                  <li>Mensagens do App NÃO aparecem nos webhooks</li>
                  <li>Sem selo azul de verificação (OBA)</li>
                  <li>Funciona em: App, WhatsApp Web, Mac</li>
                  <li>NÃO funciona em: WhatsApp Windows</li>
                  <li>Custo: Via App = grátis, Via API = cobra</li>
                </ul>
              </div>
            )}

            {/* Evo Go info */}
            {newInstance.channel === 'EVO_GO' && (
              <div className={`p-3 rounded-lg text-sm space-y-2 ${
                systemStatus?.evoGoConfigured
                  ? 'bg-green-500/10 border border-green-500 text-green-600 dark:text-green-400'
                  : 'bg-orange-500/10 border border-orange-500 text-orange-600 dark:text-orange-400'
              }`}>
                {systemStatus?.evoGoConfigured ? (
                  <>
                    <p className="font-semibold">Evo Go — Modo Automático ✓</p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                      <li>A instância será criada automaticamente na Evo Go</li>
                      <li>Webhook será configurado automaticamente ao conectar</li>
                      <li>Basta criar e conectar — sem configuração manual</li>
                    </ul>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">Evo Go — Modo Manual</p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                      <li>Crie a instância e depois configure URL, ID e API Key manualmente</li>
                      <li>Para modo automático, configure EVO_GO_API_URL e EVO_GO_GLOBAL_API_KEY no ambiente</li>
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>
              Cancelar
            </Button>
            <Button
              variant="whatsapp"
              onClick={() => createMutation.mutate(newInstance)}
              disabled={!newInstance.name || createMutation.isPending}
            >
              {createMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Code Modal */}
      <Dialog open={showQRModal} onOpenChange={(open) => {
        setShowQRModal(open)
        if (!open && selectedInstance) {
          leaveInstance(selectedInstance.id)
          setSelectedInstance(null)
          setQrCode(null)
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Escanear QR Code</DialogTitle>
            <DialogDescription>
              Abra o WhatsApp no seu celular e escaneie o QR Code
            </DialogDescription>
          </DialogHeader>

          {/* Polling automático: busca QR da API a cada 5s (igual o Manager da Evo Go) */}
          <QRCodePoller
            instanceId={selectedInstance?.id || null}
            channel={selectedInstance?.channel || 'BAILEYS'}
            isOpen={showQRModal}
            onQrCode={(qr) => setQrCode(qr)}
            onConnected={() => {
              setShowQRModal(false)
              setQrCode(null)
              queryClient.invalidateQueries({ queryKey: ['instances'] })
            }}
          />

          <div className="flex items-center justify-center py-6">
            {qrCode ? (
              <img src={qrCode} alt="QR Code" className="w-64 h-64" />
            ) : (
              <div className="w-64 h-64 flex items-center justify-center bg-muted rounded-lg">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>

          <p className="text-center text-sm text-muted-foreground">
            O QR Code expira em 60 segundos. Aguardando leitura...
          </p>
        </DialogContent>
      </Dialog>

    </div>
  )
}
