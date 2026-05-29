import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  User, ArrowLeft, Shield, Building2, MessageSquare, Mail, Calendar,
  Key, Loader2, Power, PowerOff, Users2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import api from '@/services/api'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface CompanyRole {
  id: string; name: string; slug: string; type: string; description?: string; isDefault?: boolean
}

export function AdminUserDetail() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', email: '', roleSlug: '' })
  const [newPassword, setNewPassword] = useState('')

  const { data: user, isLoading } = useQuery({
    queryKey: ['admin-user', id],
    queryFn: async () => (await api.get(`/admin/users/${id}`)).data,
    enabled: !!id,
  })

  // Fetch real roles from the user's company
  const { data: companyRoles } = useQuery<CompanyRole[]>({
    queryKey: ['admin-company-roles', user?.company?.id],
    queryFn: async () => (await api.get(`/admin/companies/${user.company.id}/roles`)).data,
    enabled: !!user?.company?.id,
  })

  const updateMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put(`/admin/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-user', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setEditOpen(false)
      setPasswordOpen(false)
      setNewPassword('')
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Usuário não encontrado
      </div>
    )
  }

  const openEdit = () => {
    setEditForm({
      name: user.name,
      email: user.email,
      roleSlug: user.rbacRole?.slug || '',
    })
    setEditOpen(true)
  }

  const handleSaveEdit = () => {
    const data: Record<string, unknown> = {}
    if (editForm.name !== user.name) data.name = editForm.name
    if (editForm.email !== user.email) data.email = editForm.email
    // If role changed, pass roleId directly (real company role)
    if (editForm.roleSlug !== user.rbacRole?.slug && companyRoles) {
      const newRole = companyRoles.find(r => r.slug === editForm.roleSlug)
      if (newRole) data.roleId = newRole.id
    }
    if (Object.keys(data).length > 0) {
      updateMut.mutate(data)
    } else {
      setEditOpen(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
            <Link to="/admin/users"><ArrowLeft className="mr-1 h-4 w-4" /> Voltar</Link>
          </Button>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
              <User className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{user.name}</h1>
              <p className="text-muted-foreground text-sm flex items-center gap-1">
                <Mail className="h-3 w-3" /> {user.email}
              </p>
            </div>
            <Badge variant={user.isActive ? 'default' : 'secondary'} className="ml-2">
              {user.isActive ? 'Ativo' : 'Inativo'}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2 mt-8">
          <Button variant="outline" size="sm" onClick={openEdit}>Editar</Button>
          <Button variant="outline" size="sm" onClick={() => { setNewPassword(''); setPasswordOpen(true) }}>
            <Key className="mr-1 h-4 w-4" /> Senha
          </Button>
          <Button variant="outline" size="sm"
            onClick={() => updateMut.mutate({ isActive: !user.isActive })}
          >
            {user.isActive
              ? <><PowerOff className="mr-1 h-4 w-4 text-red-500" /> Desativar</>
              : <><Power className="mr-1 h-4 w-4 text-green-500" /> Ativar</>}
          </Button>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Empresa
          </CardTitle></CardHeader>
          <CardContent>
            <Link to={`/admin/companies/${user.company.id}`} className="text-lg font-semibold hover:underline">
              {user.company.name}
            </Link>
            <div className="flex gap-2 mt-1">
              <Badge variant="outline" className="text-xs">{user.company.plan}</Badge>
              <Badge variant={user.company.isActive ? 'default' : 'secondary'} className="text-xs">
                {user.company.isActive ? 'Ativa' : 'Inativa'}
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Shield className="h-4 w-4" /> Função
          </CardTitle></CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{user.rbacRole?.name || 'Sem função'}</p>
            <p className="text-xs text-muted-foreground mt-1">Slug: {user.rbacRole?.slug || '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Desde
          </CardTitle></CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">
              {format(new Date(user.createdAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </p>
            {user.updatedAt && (
              <p className="text-xs text-muted-foreground mt-1">
                Atualizado: {format(new Date(user.updatedAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <MessageSquare className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold">{user._count?.assignedConversations || 0}</p>
            <p className="text-xs text-muted-foreground">Conversas atribuídas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Mail className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold">{user._count?.sentMessages || 0}</p>
            <p className="text-xs text-muted-foreground">Mensagens enviadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Users2 className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold">{user.teamMemberships?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Equipes</p>
          </CardContent>
        </Card>
      </div>

      {/* Teams */}
      {user.teamMemberships?.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Equipes</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {user.teamMemberships.map((tm: { team: { id: string; name: string } }) => (
                <Badge key={tm.team.id} variant="outline" className="gap-1">
                  <Users2 className="h-3 w-3" /> {tm.team.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Usuário</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Função</Label>
              <Select value={editForm.roleSlug} onValueChange={v => setEditForm(f => ({ ...f, roleSlug: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {(companyRoles || []).map(r => (
                    <SelectItem key={r.id} value={r.slug}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveEdit} disabled={updateMut.isPending}>
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
              Alterando senha de: <strong>{user.email}</strong>
            </p>
            <div className="space-y-2">
              <Label>Nova Senha</Label>
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => updateMut.mutate({ password: newPassword })}
              disabled={!newPassword || newPassword.length < 6 || updateMut.isPending}
            >
              {updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Alterar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
