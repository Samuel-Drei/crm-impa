import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  Building2,
  Users,
  Smartphone,
  MessageSquare,
  BookUser,
  MessagesSquare,
  Bot,
  Crown,
  ArrowRight,
  Wifi,
  WifiOff,
  Settings,
  UserPlus,
  Loader2,
  Youtube,
  Save,
  Eye,
  EyeOff,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import api from '@/services/api'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface AdminStats {
  companies: { total: number; active: number }
  users: { total: number; active: number }
  instances: { total: number; connected: number }
  messages: { total: number; today: number }
  contacts: number
  conversations: number
  aiAgents: number
  recentCompanies: Array<{
    id: string; name: string; plan: string; isActive: boolean; createdAt: string
    _count: { users: number; instances: number }
  }>
}

const planLabels: Record<string, string> = {
  free: 'Gratuito', basic: 'Básico', pro: 'Pro', enterprise: 'Enterprise',
}

export function AdminDashboard() {
  const queryClient = useQueryClient()

  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => (await api.get('/admin/stats')).data,
  })

  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ['admin-settings'],
    queryFn: async () => (await api.get('/admin/settings')).data,
  })

  const settingsMut = useMutation({
    mutationFn: (data: Record<string, string>) => api.put('/admin/settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] })
    },
  })

  const signupEnabled = settings?.ENABLE_PUBLIC_SIGNUP === 'true'

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Crown className="h-6 w-6 text-amber-500" />
          Painel Administrativo
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Visão global do sistema</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Empresas"
          value={stats?.companies.total || 0}
          sub={`${stats?.companies.active || 0} ativas`}
          icon={Building2}
          href="/admin/companies"
        />
        <StatCard
          title="Usuários"
          value={stats?.users.total || 0}
          sub={`${stats?.users.active || 0} ativos`}
          icon={Users}
          href="/admin/users"
        />
        <StatCard
          title="Instâncias"
          value={stats?.instances.total || 0}
          sub={`${stats?.instances.connected || 0} conectadas`}
          icon={Smartphone}
        />
        <StatCard
          title="Mensagens Hoje"
          value={stats?.messages.today || 0}
          sub={`${(stats?.messages.total || 0).toLocaleString('pt-BR')} total`}
          icon={MessageSquare}
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid gap-4 grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <BookUser className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{(stats?.contacts || 0).toLocaleString('pt-BR')}</p>
                <p className="text-xs text-muted-foreground">Contatos totais</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <MessagesSquare className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{(stats?.conversations || 0).toLocaleString('pt-BR')}</p>
                <p className="text-xs text-muted-foreground">Conversas totais</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Bot className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.aiAgents || 0}</p>
                <p className="text-xs text-muted-foreground">Agentes IA</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* System Settings */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-3">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Configurações do Sistema</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <UserPlus className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <Label htmlFor="signup-toggle" className="text-sm font-medium cursor-pointer">
                  Cadastro Público
                </Label>
                <p className="text-xs text-muted-foreground">
                  {signupEnabled
                    ? 'Qualquer pessoa pode criar uma conta na tela de login'
                    : 'Apenas o administrador pode criar novas contas'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {settingsMut.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Switch
                id="signup-toggle"
                checked={signupEnabled}
                disabled={settingsMut.isPending}
                onCheckedChange={(checked) => {
                  settingsMut.mutate({ ENABLE_PUBLIC_SIGNUP: checked ? 'true' : 'false' })
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* YouTube RAG Settings */}
      <YouTubeSettingsCard
        settings={settings}
        onSave={(data) => settingsMut.mutate(data)}
        isPending={settingsMut.isPending}
      />

      {/* Recent Companies */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Empresas Recentes</CardTitle>
          <Link to="/admin/companies" className="text-xs text-amber-500 hover:underline flex items-center gap-1">
            Ver todas <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {stats?.recentCompanies?.map(company => (
              <Link
                key={company.id}
                to={`/admin/companies/${company.id}`}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-accent flex items-center justify-center">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{company.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {company._count.users} usuários · {company._count.instances} instâncias
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-[10px]">
                    {planLabels[company.plan] || company.plan}
                  </Badge>
                  {company.isActive ? (
                    <Wifi className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5 text-red-400" />
                  )}
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(company.createdAt), 'dd/MM/yy', { locale: ptBR })}
                  </span>
                </div>
              </Link>
            ))}
            {(!stats?.recentCompanies || stats.recentCompanies.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhuma empresa cadastrada</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ title, value, sub, icon: Icon, href }: {
  title: string; value: number; sub: string; icon: any; href?: string
}) {
  const content = (
    <Card className={href ? 'hover:border-amber-500/30 transition-colors cursor-pointer' : ''}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value.toLocaleString('pt-BR')}</div>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  )

  if (href) return <Link to={href}>{content}</Link>
  return content
}

function YouTubeSettingsCard({
  settings,
  onSave,
  isPending,
}: {
  settings?: Record<string, string>
  onSave: (data: Record<string, string>) => void
  isPending: boolean
}) {
  const [protocol, setProtocol] = useState('http')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [cookies, setCookies] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (settings) {
      setProtocol(settings['youtube.proxyProtocol'] || 'http')
      setHost(settings['youtube.proxyHost'] || '')
      setPort(settings['youtube.proxyPort'] || '')
      setUser(settings['youtube.proxyUser'] || '')
      setPassword(settings['youtube.proxyPassword'] || '')
      setCookies(settings['youtube.cookies'] || '')
      setDirty(false)
    }
  }, [settings])

  const handleSave = () => {
    onSave({
      'youtube.proxyProtocol': protocol.trim() || 'http',
      'youtube.proxyHost': host.trim(),
      'youtube.proxyPort': port.trim(),
      'youtube.proxyUser': user.trim(),
      'youtube.proxyPassword': password,
      // Limpa o campo legado para evitar conflito
      'youtube.proxyUrl': '',
      'youtube.cookies': cookies.trim(),
    })
    setDirty(false)
  }

  const cookieLines = cookies.split('\n').filter(l => l.trim() && !l.startsWith('#')).length
  const previewUrl = host && port
    ? `${protocol || 'http'}://${user ? `${user}${password ? ':***' : ''}@` : ''}${host}:${port}`
    : ''

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <Youtube className="h-4 w-4 text-red-500" />
        <CardTitle className="text-base">Configurações do YouTube (RAG)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Configurações usadas pela ingestão de vídeos do YouTube na base de conhecimento.
          O proxy é necessário quando o IP do servidor é bloqueado pelo bot-check do YouTube.
          Cookies são opcionais e ajudam em vídeos com restrição de idade ou login.
        </p>

        {/* Proxy — campos separados */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Proxy (opcional)</Label>

          <div className="grid grid-cols-12 gap-2">
            {/* Protocolo */}
            <div className="col-span-3 sm:col-span-2 space-y-1">
              <Label htmlFor="yt-proto" className="text-[11px] text-muted-foreground">Protocolo</Label>
              <select
                id="yt-proto"
                value={protocol}
                onChange={(e) => { setProtocol(e.target.value); setDirty(true) }}
                className="h-9 w-full rounded-md border bg-background px-2 text-xs font-mono"
              >
                <option value="http">http</option>
                <option value="https">https</option>
                <option value="socks5">socks5</option>
                <option value="socks5h">socks5h</option>
              </select>
            </div>

            {/* Host / IP */}
            <div className="col-span-6 sm:col-span-7 space-y-1">
              <Label htmlFor="yt-host" className="text-[11px] text-muted-foreground">Host / IP</Label>
              <Input
                id="yt-host"
                placeholder="ex: 31.59.20.176 ou p.webshare.io"
                value={host}
                onChange={(e) => { setHost(e.target.value); setDirty(true) }}
                className="font-mono text-xs"
              />
            </div>

            {/* Porta */}
            <div className="col-span-3 space-y-1">
              <Label htmlFor="yt-port" className="text-[11px] text-muted-foreground">Porta</Label>
              <Input
                id="yt-port"
                placeholder="6754"
                value={port}
                onChange={(e) => { setPort(e.target.value.replace(/[^0-9]/g, '')); setDirty(true) }}
                className="font-mono text-xs"
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Usuário */}
            <div className="space-y-1">
              <Label htmlFor="yt-user" className="text-[11px] text-muted-foreground">Usuário</Label>
              <Input
                id="yt-user"
                placeholder="usuario"
                value={user}
                onChange={(e) => { setUser(e.target.value); setDirty(true) }}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </div>

            {/* Senha */}
            <div className="space-y-1">
              <Label htmlFor="yt-pass" className="text-[11px] text-muted-foreground">Senha</Label>
              <div className="relative">
                <Input
                  id="yt-pass"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="senha"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setDirty(true) }}
                  className="pr-10 font-mono text-xs"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Ocultar' : 'Mostrar'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {previewUrl && (
            <p className="text-[11px] text-muted-foreground">
              URL gerada: <code className="font-mono">{previewUrl}</code>
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Deixe Host e Porta em branco para desabilitar o proxy. Caracteres especiais em usuário/senha são codificados automaticamente.
          </p>
        </div>

        {/* Cookies */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="yt-cookies" className="text-sm font-medium">
              Cookies (formato Netscape)
            </Label>
            {cookies && (
              <Badge variant="outline" className="text-[10px]">
                {cookieLines} cookie(s)
              </Badge>
            )}
          </div>
          <Textarea
            id="yt-cookies"
            placeholder={`# Netscape HTTP Cookie File\n# Cole aqui o conteúdo de yt-cookies.txt exportado do navegador\n.youtube.com\tTRUE\t/\tTRUE\t...\tLOGIN_INFO\t...`}
            value={cookies}
            onChange={(e) => { setCookies(e.target.value); setDirty(true) }}
            className="font-mono text-[11px] min-h-[140px]"
          />
          <p className="text-[11px] text-muted-foreground">
            Use a extensão <a href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc" target="_blank" rel="noreferrer" className="underline">"Get cookies.txt LOCALLY"</a> em
            uma sessão logada do YouTube e cole o conteúdo aqui. Deixe em branco para usar somente o proxy.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={handleSave}
            disabled={!dirty || isPending}
            size="sm"
            className="gap-2"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar configurações
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
