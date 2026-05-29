import { Lock, ArrowLeft, CreditCard } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { Button } from '@/components/ui/button'

interface PlanGateProps {
  featureKey: string
  children: React.ReactNode
  /** Custom message when blocked */
  blockedMessage?: string
}

/**
 * Wraps a page component and blocks access if the feature is disabled (limit = 0) in the plan.
 * Shows a professional lock screen with upgrade prompt.
 */
export function PlanGate({ featureKey, children, blockedMessage }: PlanGateProps) {
  const { isFeatureBlocked, plan, isLoading } = usePlanLimits()
  const navigate = useNavigate()

  // While loading, render children to avoid flash
  if (isLoading) return <>{children}</>

  if (!isFeatureBlocked(featureKey)) {
    return <>{children}</>
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md space-y-6">
        <div className="mx-auto h-20 w-20 rounded-full bg-muted/50 flex items-center justify-center">
          <Lock className="h-10 w-10 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">Recurso não disponível</h2>
          <p className="text-muted-foreground">
            {blockedMessage || 'Este recurso não está incluído no seu plano atual.'}
          </p>
          {plan && (
            <p className="text-sm text-muted-foreground">
              Seu plano: <span className="font-semibold text-foreground">{plan.name}</span>
            </p>
          )}
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <Button onClick={() => navigate('/settings')}>
            <CreditCard className="mr-2 h-4 w-4" />
            Ver Planos
          </Button>
        </div>
      </div>
    </div>
  )
}
