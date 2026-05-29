import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Users, Search, Power, PowerOff, Eye, Key, Loader2, Shield,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

interface AdminUser {
  id: string; name: string; email: string; isActive: boolean; createdAt: string
  rbacRole: { id: string; name: string; slug: string }
  company: { id: string; name: string; plan: string; isActive: boolean }
}

export function AdminUsers() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterRole, setFilterRole] = useState('all')
  const [page, setPage] = useState(1)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [newPassword, setNewPassword] = useState('')

  // Fetch distinct role slugs across all companies
  const { data: distinctRoles } = useQuery<{ slug: string; name: string }[]>({
    queryKey: ['admin-roles-distinct'],
    queryFn: async () => (await api.get('/admin/roles')).data,
  })

  const queryParams = new URLSearchParams()
  if (search) queryParams.set('search', search)
  if (filterStatus !== 'all') queryParams.set('isActive', filterStatus)
  if (filterRole !== 'all') queryParams.set('role', filterRole)
  queryParams.set('page', String(page))
  queryParams.set('limit', '20')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', search, filterStatus, filterRole, page],
    queryFn: async () => (await api.get(`/admin/users?${queryParams}`)).data,
  })

  const users: AdminUser[] = data?.data || []
  const totalPages = data?.totalPages || 1

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/admin/users/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    },
  })

  const passwordMut = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.put(`/admin/users/${id}`, { password }),
    onSuccess: () => {
      setPasswordOpen(false)
      setNewPassword('')
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6 text-amber-500" />
          Usuários
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {data?.total || 0} usuários de todas as empresas
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-end flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou email..."
            className="pl-10"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <Select value={filterRole} onValueChange={v => { setFilterRole(v); setPage(1) }}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Função" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas funções</SelectItem>
            {(distinctRoles || []).map(r => (
              <SelectItem key={r.slug} value={r.slug}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={v => { setFilterStatus(v); setPage(1) }}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="true">Ativos</SelectItem>
            <SelectItem value="false">Inativos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Função</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Criado em</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(u => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{u.name}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link to={`/admin/companies/${u.company.id}`} className="hover:underline text-sm">
                          {u.company.name}
                        </Link>
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
                              <Eye className="h-4 w-4" />
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
                            onClick={() => toggleMut.mutate({ id: u.id, isActive: !u.isActive })}
                          >
                            {u.isActive ? <PowerOff className="h-4 w-4 text-red-500" /> : <Power className="h-4 w-4 text-green-500" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {users.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Nenhum usuário encontrado
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    Página {page} de {totalPages} ({data?.total} resultados)
                  </p>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                      Anterior
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                      Próxima
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Password Dialog */}
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Alterar Senha</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Alterando senha de: <strong>{selectedUser?.email}</strong>
              <br />
              <span className="text-xs">Empresa: {selectedUser?.company.name}</span>
            </p>
            <div className="space-y-2">
              <Label>Nova Senha</Label>
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => selectedUser && passwordMut.mutate({ id: selectedUser.id, password: newPassword })}
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
