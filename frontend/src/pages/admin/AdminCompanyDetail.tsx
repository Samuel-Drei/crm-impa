import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, ArrowLeft, Users, Smartphone, Pencil, Power, PowerOff,
  Key, Loader2, Shield, Wifi, WifiOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import api from '@/services/api'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface CompanyDetail {
  id: string; name: string; email: string; document?: string; phone?: string
  plan: string; isActive: boolean; createdAt: string; updatedAt: string
  users: Array<{
    id: string; name: string; email: string; isActive: boolean; createdAt: string
    rbacRole: { id: string; name: string; slug: string }
  }>
  instances: Array<{
    id: string; name: string; status: string; channel: string; phoneNumber?: string; createdAt: string
  }>
  _count: {
    instances: number; contacts: number; campaigns: number; templates: number
    conversations: number; users: number; aiAgents: number; aiProviders: number
  }
}

interface PlanOption {
  id: string; name: string; slug: string; isActive: boolean
}

const statusColors: Record<string, string> = {
  CONNECTED: 'text-emerald-500', DISCONNECTED: 'text-red-400', CONNECTING: 'text-amber-500',
}

export function AdminCompanyDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string; email: string } | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [editData, setEditData] = useState({ name: '', plan: '', email: '' })

  const { data: company, isLoading } = useQuery<CompanyDetail>({
    queryKey: ['admin-company', id],
    queryFn: async () => (await api.get(`/admin/companies/${id}`)).data,
    enabled: !!id,
  })

  const { data: planOptions = [] } = useQuery<PlanOption[]>({
    queryKey: ['admin-plans-options'],
    queryFn: async () => (await api.get('/admin/plans')).data,
  })

  const updateMut = useMutation({
    mutationFn: (data: any) => api.put(`/admin/companies/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-company', id] })
      setEditOpen(false)
    },
  })

  const toggleMut = useMutation({
    mutationFn: (isActive: boolean) => api.put(`/admin/companies/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-company', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    },
  })

  const toggleUserMut = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      api.put(`/admin/users/${userId}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-company', id] }),
  })

  const passwordMut = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      api.put(`/admin/users/${userId}`, { password }),
    onSuccess: () => { setPasswordOpen(false); setNewPassword('') },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!company) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Empresa não encontrada</p>
        <Button variant="link" onClick={() => navigate('/admin/companies')}>Voltar</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin/companies')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{company.name}</h1>
              <Badge variant={company.isActive ? 'default' : 'secondary'}>
                {company.isActive ? 'Ativa' : 'Inativa'}
              </Badge>
              <Badge variant="outline">{planOptions.find(p => p.slug === company.plan)?.name || company.plan}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{company.email}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            setEditData({ name: company.name, plan: company.plan, email: company.email })
            setEditOpen(true)
          }}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
          </Button>
          <Button
            variant={company.isActive ? 'destructive' : 'default'}
            size="sm"
            onClick={() => toggleMut.mutate(!company.isActive)}
          >
            {company.isActive ? <PowerOff className="mr-2 h-3.5 w-3.5" /> : <Power className="mr-2 h-3.5 w-3.5" />}
            {company.isActive ? 'Desativar' : 'Ativar'}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Usuários', value: company._count.users, icon: Users },
          { label: 'Instâncias', value: company._count.instances, icon: Smartphone },
          { label: 'Contatos', value: company._count.contacts },
          { label: 'Conversas', value: company._count.conversations },
          { label: 'Campanhas', value: company._count.campaigns },
          { label: 'Templates', value: company._count.templates },
          { label: 'Agentes IA', value: company._count.aiAgents },
          { label: 'Providers IA', value: company._count.aiProviders },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold mt-1">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">
            <Users className="h-3.5 w-3.5 mr-1.5" /> Usuários ({company.users.length})
          </TabsTrigger>
          <TabsTrigger value="instances">
            <Smartphone className="h-3.5 w-3.5 mr-1.5" /> Instâncias ({company.instances.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Função</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Criado</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {company.users.map(u => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{u.name}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1">
                          <Shield className="h-3 w-3" /> {u.rbacRole.name}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.isActive ? 'default' : 'secondary'}>
                          {u.isActive ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(u.createdAt), 'dd/MM/yyyy', { locale: ptBR })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" asChild title="Detalhes">
                            <Link to={`/admin/users/${u.id}`}>
                              <Pencil className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button variant="ghost" size="icon" title="Alterar Senha" onClick={() => {
                            setSelectedUser(u)
                            setPasswordOpen(true)
                          }}>
                            <Key className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon"
                            title={u.isActive ? 'Desativar' : 'Ativar'}
                            onClick={() => toggleUserMut.mutate({ userId: u.id, isActive: !u.isActive })}
                          >
                            {u.isActive ? <PowerOff className="h-4 w-4 text-red-500" /> : <Power className="h-4 w-4 text-green-500" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {company.users.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Nenhum usuário</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="instances" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instância</TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Criado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {company.instances.map(inst => (
                    <TableRow key={inst.id}>
                      <TableCell className="font-medium">{inst.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{inst.channel}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{inst.phoneNumber || '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {inst.status === 'CONNECTED' ? (
                            <Wifi className={`h-3.5 w-3.5 ${statusColors[inst.status]}`} />
                          ) : (
                            <WifiOff className={`h-3.5 w-3.5 ${statusColors[inst.status] || 'text-muted-foreground'}`} />
                          )}
                          <span className="text-sm">{inst.status}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(inst.createdAt), 'dd/MM/yyyy', { locale: ptBR })}
                      </TableCell>
                    </TableRow>
                  ))}
                  {company.instances.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Nenhuma instância</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Company Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Empresa</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editData.name} onChange={e => setEditData(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Plano</Label>
              <Select value={editData.plan} onValueChange={v => setEditData(p => ({ ...p, plan: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {planOptions.filter(p => p.isActive).map(p => (
                    <SelectItem key={p.id} value={p.slug}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={() => updateMut.mutate(editData)} disabled={updateMut.isPending}>
              {updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Dialog */}
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Alterar Senha</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Alterando senha de: <strong>{selectedUser?.email}</strong>
            </p>
            <div className="space-y-2">
              <Label>Nova Senha</Label>
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => selectedUser && passwordMut.mutate({ userId: selectedUser.id, password: newPassword })}
              disabled={!newPassword || newPassword.length < 6 || passwordMut.isPending}
            >
              {passwordMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Alterar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
