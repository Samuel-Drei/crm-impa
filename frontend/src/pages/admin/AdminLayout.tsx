import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Building2,
  Users,
  CreditCard,
  ArrowLeft,
  Crown,
  Package,
  Bug,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { path: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { path: '/admin/companies', label: 'Empresas', icon: Building2 },
  { path: '/admin/plans', label: 'Planos', icon: CreditCard },
  { path: '/admin/modules', label: 'Módulos', icon: Package },
  { path: '/admin/users', label: 'Usuários', icon: Users },
  { path: '/admin/ai-debug', label: 'Debug IA', icon: Bug },
]

export function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path
    return location.pathname.startsWith(path)
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 border-r border-border/50 bg-card flex flex-col shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Crown className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-semibold">Super Admin</p>
              <p className="text-[10px] text-muted-foreground">Painel Global</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                isActive(item.path, item.exact)
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-border/50">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors w-full"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao CRM
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
