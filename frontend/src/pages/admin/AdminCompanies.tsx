import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Building2, Plus, Search, Power, PowerOff, Pencil, Trash2, Loader2, Eye,
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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import api from '@/services/api'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface Company {
  id: string; name: string; email: string; plan: string; planId: string | null; isActive: boolean; createdAt: string
  planRef?: { id: string; name: string; slug: string } | null
  users: Array<{ id: string; name: string; email: string; isActive: boolean }>
  _count: { instances: number; contacts: number; campaigns: number; conversations: number; users: number }
}

interface PlanOption {
  id: string; name: string; slug: string; isActive: boolean
}

export function AdminCompanies() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterPlan, setFilterPlan] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [selected, setSelected] = useState<Company | null>(null)

  const [newCompany, setNewCompany] = useState({
    companyName: '', userName: '', email: '', password: '', plan: 'free',
  })
  const [editData, setEditData] = useState({ name: '', plan: 'free' })

  const { data: planOptions = [] } = useQuery<PlanOption[]>({
    queryKey: ['admin-plans-options'],
    queryFn: async () => (await api.get('/admin/plans')).data,
  })

  const queryParams = new URLSearchParams()
  if (search) queryParams.set('search', search)
  if (filterPlan !== 'all') queryParams.set('plan', filterPlan)
  if (filterStatus !== 'all') queryParams.set('isActive', filterStatus)
  queryParams.set('page', String(page))
  queryParams.set('limit', '20')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-companies', search, filterPlan, filterStatus, page],
    queryFn: async () => (await api.get(`/admin/companies?${queryParams}`)).data,
  })

  const companies: Company[] = data?.data || []
  const totalPages = data?.totalPages || 1

  const createMut = useMutation({
    mutationFn: (d: typeof newCompany) => api.post('/admin/companies', d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-companies'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      setCreateOpen(false)
      setNewCompany({ companyName: '', userName: '', email: '', password: '', plan: 'free' })
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/admin/companies/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-companies'] })
      setEditOpen(false)
    },
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.put(`/admin/companies/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-companies'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/companies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-companies'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      setDeleteOpen(false)
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-6 w-6 text-amber-500" />
            Empresas
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {data?.total || 0} empresas cadastradas
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nova Empresa
        </Button>
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
        <Select value={filterPlan} onValueChange={v => { setFilterPlan(v); setPage(1) }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Plano" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos planos</SelectItem>
            {planOptions.map(p => (
              <SelectItem key={p.id} value={p.slug}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={v => { setFilterStatus(v); setPage(1) }}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="true">Ativas</SelectItem>
            <SelectItem value="false">Inativas</SelectItem>
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
                    <TableHead>Empresa</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead className="text-center">Usuários</TableHead>
                    <TableHead className="text-center">Instâncias</TableHead>
                    <TableHead className="text-center">Contatos</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Criado em</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {c.planRef?.name || c.plan}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">{c._count.users}</TableCell>
                      <TableCell className="text-center">{c._count.instances}</TableCell>
                      <TableCell className="text-center">{c._count.contacts}</TableCell>
                      <TableCell>
                        <Badge variant={c.isActive ? 'default' : 'secondary'}>
                          {c.isActive ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(c.createdAt), 'dd/MM/yyyy', { locale: ptBR })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" asChild title="Detalhes">
                            <Link to={`/admin/companies/${c.id}`}>
                              <Eye className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button variant="ghost" size="icon" title="Editar" onClick={() => {
                            setSelected(c)
                            setEditData({ name: c.name, plan: c.plan })
                            setEditOpen(true)
                          }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon"
                            title={c.isActive ? 'Desativar' : 'Ativar'}
                            onClick={() => toggleMut.mutate({ id: c.id, isActive: !c.isActive })}
                          >
                            {c.isActive ? <PowerOff className="h-4 w-4 text-red-500" /> : <Power className="h-4 w-4 text-green-500" />}
                          </Button>
                          <Button variant="ghost" size="icon" title="Excluir" onClick={() => { setSelected(c); setDeleteOpen(true) }}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {companies.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        Nenhuma empresa encontrada
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              {/* Pagination */}
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

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova Empresa</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome da Empresa</Label>
                <Input value={newCompany.companyName} onChange={e => setNewCompany(p => ({ ...p, companyName: e.target.value }))} placeholder="Minha Empresa" />
              </div>
              <div className="space-y-2">
                <Label>Nome do Admin</Label>
                <Input value={newCompany.userName} onChange={e => setNewCompany(p => ({ ...p, userName: e.target.value }))} placeholder="João Silva" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={newCompany.email} onChange={e => setNewCompany(p => ({ ...p, email: e.target.value }))} placeholder="email@exemplo.com" />
              </div>
              <div className="space-y-2">
                <Label>Senha</Label>
                <Input type="password" value={newCompany.password} onChange={e => setNewCompany(p => ({ ...p, password: e.target.value }))} placeholder="••••••" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Plano</Label>
              <Select value={newCompany.plan} onValueChange={v => setNewCompany(p => ({ ...p, plan: v }))}>
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
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => createMut.mutate(newCompany)}
              disabled={!newCompany.companyName || !newCompany.email || !newCompany.password || createMut.isPending}
            >
              {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
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
            <Button
              onClick={() => selected && updateMut.mutate({ id: selected.id, data: editData })}
              disabled={updateMut.isPending}
            >
              {updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso excluirá permanentemente <strong>{selected?.name}</strong> e todos os dados relacionados
              (usuários, instâncias, contatos, conversas, mensagens). Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => selected && deleteMut.mutate(selected.id)}
            >
              {deleteMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir Permanentemente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
