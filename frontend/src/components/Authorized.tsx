import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { usePermissions } from '@/hooks/usePermissions'

interface AuthorizedProps {
  /** Permissões necessárias (todas devem estar presentes) */
  permission?: string | string[]
  /** Permissões alternativas (pelo menos uma) */
  any?: string[]
  /** Conteúdo a exibir quando não autorizado (padrão: null) */
  fallback?: ReactNode
  children: ReactNode
}

/**
 * Renderiza children apenas se o usuário tem as permissões necessárias.
 * Admin sempre passa.
 */
export function Authorized({ permission, any, fallback = null, children }: AuthorizedProps) {
  const { can, canAny } = usePermissions()

  let allowed = true

  if (permission) {
    const slugs = Array.isArray(permission) ? permission : [permission]
    allowed = can(...slugs)
  } else if (any) {
    allowed = canAny(...any)
  }

  if (!allowed) return <>{fallback}</>
  return <>{children}</>
}

interface PermissionRouteProps {
  /** Permissões necessárias (todas) */
  permission?: string | string[]
  /** Permissões alternativas (pelo menos uma) */
  any?: string[]
  /** Redireciona para esta rota quando não autorizado (padrão: /) */
  redirectTo?: string
  children: ReactNode
}

/**
 * Guard para rotas — redireciona se não tem permissão.
 */
export function PermissionRoute({ permission, any, redirectTo = '/', children }: PermissionRouteProps) {
  const { can, canAny } = usePermissions()

  let allowed = true

  if (permission) {
    const slugs = Array.isArray(permission) ? permission : [permission]
    allowed = can(...slugs)
  } else if (any) {
    allowed = canAny(...any)
  }

  if (!allowed) return <Navigate to={redirectTo} replace />
  return <>{children}</>
}
