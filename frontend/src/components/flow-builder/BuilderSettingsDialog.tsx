import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BuilderSettingsPanel } from '@/components/flow-builder/BuilderSettingsPanel'
import type { BuilderSettings } from '@/lib/builderSettings'

type BuilderSettingsDialogProps = {
  open: boolean
  settings: BuilderSettings
  isSaving?: boolean
  onOpenChange: (open: boolean) => void
  onSave: (settings: BuilderSettings) => void
}

export function BuilderSettingsDialog({
  open,
  settings,
  isSaving = false,
  onOpenChange,
  onSave,
}: BuilderSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurações do Builder</DialogTitle>
          <DialogDescription>
            Preferências visuais e de conforto aplicadas a todos os seus fluxos.
          </DialogDescription>
        </DialogHeader>

        <BuilderSettingsPanel
          settings={settings}
          isSaving={isSaving}
          onCancel={() => onOpenChange(false)}
          onSave={onSave}
        />
      </DialogContent>
    </Dialog>
  )
}
