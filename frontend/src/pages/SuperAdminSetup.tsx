import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Shield, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth.store'
import api from '@/services/api'

const setupSchema = z.object({
  companyName: z.string().min(2, 'Nome da empresa obrigatório'),
  name: z.string().min(2, 'Nome obrigatório'),
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
  confirmPassword: z.string().min(6, 'Confirme sua senha'),
}).refine(data => data.password === data.confirmPassword, {
  message: 'As senhas não coincidem',
  path: ['confirmPassword'],
})

type SetupData = z.infer<typeof setupSchema>

export function SuperAdminSetup() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const form = useForm<SetupData>({
    resolver: zodResolver(setupSchema),
  })

  // Verificar se setup já foi completado
  useEffect(() => {
    api.get('/installation/status').then(res => {
      if (!res.data.setupRequired) {
        navigate('/login', { replace: true })
      }
    }).catch(() => {})
  }, [navigate])

  async function handleSetup(data: SetupData) {
    setIsLoading(true)
    setError('')

    try {
      const response = await api.post('/installation/setup', {
        companyName: data.companyName,
        name: data.name,
        email: data.email,
        password: data.password,
      })
      setAuth(response.data.user, response.data.company, response.data.token)
      navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao criar conta de administrador')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-600 text-white">
              <Shield className="h-7 w-7" />
            </div>
          </div>
          <CardTitle className="text-2xl">Configuração Inicial</CardTitle>
          <CardDescription>
            Bem-vindo ao IMPA CRM! Crie a conta de administrador para começar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(handleSetup)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company-name">Nome da Empresa</Label>
              <Input
                id="company-name"
                placeholder="Minha Empresa"
                {...form.register('companyName')}
              />
              {form.formState.errors.companyName && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.companyName.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-name">Seu Nome</Label>
              <Input
                id="admin-name"
                placeholder="João Silva"
                {...form.register('name')}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                placeholder="admin@empresa.com"
                {...form.register('email')}
              />
              {form.formState.errors.email && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-password">Senha</Label>
              <Input
                id="admin-password"
                type="password"
                placeholder="******"
                {...form.register('password')}
              />
              {form.formState.errors.password && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.password.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-confirm-password">Confirmar Senha</Label>
              <Input
                id="admin-confirm-password"
                type="password"
                placeholder="******"
                {...form.register('confirmPassword')}
              />
              {form.formState.errors.confirmPassword && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.confirmPassword.message}
                </p>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}

            <Button type="submit" className="w-full" variant="whatsapp" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Criar Conta de Administrador
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-center mt-4">
            Esta tela aparece apenas na primeira vez. Após criar o administrador, você será redirecionado para o painel.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
