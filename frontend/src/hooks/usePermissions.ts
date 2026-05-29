import { useAuthStore } from '@/stores/auth.store'

export function usePermissions() {
  const user = useAuthStore((s) => s.user)

  const permissions = user?.permissions ?? []
  const role = user?.role ?? ''
  const isAdmin = role === 'admin'
  const isManager = role === 'manager'
  const isAgent = role === 'agent'

  /** Retorna true se o usuário possui TODAS as permissões listadas (admin bypassa) */
  function can(...slugs: string[]): boolean {
    if (isAdmin) return true
    return slugs.every((s) => permissions.includes(s))
  }

  /** Retorna true se o usuário possui PELO MENOS UMA das permissões listadas */
  function canAny(...slugs: string[]): boolean {
    if (isAdmin) return true
    return slugs.some((s) => permissions.includes(s))
  }

  return { can, canAny, isAdmin, isManager, isAgent, permissions, role }
}
