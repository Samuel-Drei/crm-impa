import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  defaultBuilderSettings,
  builderEdgeMarkerOptions,
  builderEdgeTypeOptions,
  normalizeBuilderSettings,
  type BuilderBackgroundVariant,
  type BuilderEdgeMarker,
  type BuilderEdgeStyle,
  type BuilderEdgeType,
  type BuilderSettings,
} from '@/lib/builderSettings'

type BuilderSettingsPanelProps = {
  settings: BuilderSettings
  isSaving?: boolean
  layout?: 'dialog' | 'sidebar'
  onChange?: (settings: BuilderSettings) => void
  onCancel?: () => void
  onSave: (settings: BuilderSettings) => void
}

const numberOrPrevious = (value: string, previous: number) => {
  const next = Number(value)
  return Number.isFinite(next) ? next : previous
}

export function BuilderSettingsPanel({
  settings,
  isSaving = false,
  layout = 'dialog',
  onChange,
  onCancel,
  onSave,
}: BuilderSettingsPanelProps) {
  const [draft, setDraft] = useState<BuilderSettings>(settings)
  const isSidebar = layout === 'sidebar'
  const gridClassName = isSidebar ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  const updateDraft = (
    updater: BuilderSettings | ((current: BuilderSettings) => BuilderSettings),
  ) => {
    setDraft((current) => {
      const next = normalizeBuilderSettings(
        typeof updater === 'function' ? updater(current) : updater,
      )
      onChange?.(next)
      return next
    })
  }

  const resetToDefaults = () => {
    setDraft(defaultBuilderSettings)
    onChange?.(defaultBuilderSettings)
  }

  const cancel = () => {
    setDraft(settings)
    onChange?.(settings)
    onCancel?.()
  }

  const save = () => {
    onSave(normalizeBuilderSettings(draft))
  }

  return (
    <div className={isSidebar ? 'space-y-5 pb-2' : 'space-y-5'}>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="builder-snap">Ajustar à grade</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Alinha nodes ao grid durante movimentação.
            </p>
          </div>
          <Switch
            id="builder-snap"
            checked={draft.snapToGrid}
            onCheckedChange={(checked) =>
              updateDraft((current) => ({ ...current, snapToGrid: checked }))
            }
          />
        </div>

        <div className={gridClassName}>
          <div className="space-y-2">
            <Label htmlFor="builder-snap-grid">Tamanho da grade</Label>
            <Input
              id="builder-snap-grid"
              type="number"
              min={5}
              max={80}
              step={1}
              value={draft.snapGrid}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  snapGrid: numberOrPrevious(event.target.value, current.snapGrid),
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="builder-background-gap">Espaço do fundo</Label>
            <Input
              id="builder-background-gap"
              type="number"
              min={8}
              max={80}
              step={1}
              value={draft.backgroundGap}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  backgroundGap: numberOrPrevious(
                    event.target.value,
                    current.backgroundGap,
                  ),
                }))
              }
            />
          </div>
        </div>

        <div className={gridClassName}>
          <div className="space-y-2">
            <Label htmlFor="builder-background">Fundo</Label>
            <Select
              value={draft.backgroundVariant}
              onValueChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  backgroundVariant: value as BuilderBackgroundVariant,
                }))
              }
            >
              <SelectTrigger id="builder-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dots">Pontos</SelectItem>
                <SelectItem value="lines">Linhas</SelectItem>
                <SelectItem value="cross">Cruzes</SelectItem>
                <SelectItem value="none">Nenhum</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="builder-background-size">Tamanho do fundo</Label>
            <Input
              id="builder-background-size"
              type="number"
              min={0.5}
              max={4}
              step={0.5}
              value={draft.backgroundSize}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  backgroundSize: numberOrPrevious(
                    event.target.value,
                    current.backgroundSize,
                  ),
                }))
              }
            />
          </div>
        </div>

        <div className={gridClassName}>
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <Label htmlFor="builder-controls">Controles</Label>
            <Switch
              id="builder-controls"
              checked={draft.controlsVisible}
              onCheckedChange={(checked) =>
                updateDraft((current) => ({ ...current, controlsVisible: checked }))
              }
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <Label htmlFor="builder-minimap">Mini mapa</Label>
            <Switch
              id="builder-minimap"
              checked={draft.minimapVisible}
              onCheckedChange={(checked) =>
                updateDraft((current) => ({ ...current, minimapVisible: checked }))
              }
            />
          </div>
        </div>

        <div className={gridClassName}>
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <Label htmlFor="builder-edge-animated">Edges animadas</Label>
            <Switch
              id="builder-edge-animated"
              checked={draft.defaultEdgeAnimated}
              onCheckedChange={(checked) =>
                updateDraft((current) => ({
                  ...current,
                  defaultEdgeAnimated: checked,
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="builder-edge-style">Estilo das edges</Label>
            <Select
              value={draft.edgeStyle}
              onValueChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  edgeStyle: value as BuilderEdgeStyle,
                }))
              }
            >
              <SelectTrigger id="builder-edge-style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dashed">Tracejada</SelectItem>
                <SelectItem value="solid">Contínua</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="builder-edge-type">Tipo padrão de edge</Label>
          <Select
            value={draft.defaultEdgeType}
            onValueChange={(value) =>
              updateDraft((current) => ({
                ...current,
                defaultEdgeType: value as BuilderEdgeType,
              }))
            }
          >
            <SelectTrigger id="builder-edge-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {builderEdgeTypeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className={gridClassName}>
          <div className="space-y-2">
            <Label htmlFor="builder-edge-color">Cor da edge</Label>
            <Input
              id="builder-edge-color"
              type="color"
              value={draft.edgeColor}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  edgeColor: event.target.value,
                }))
              }
              className="h-10 w-full p-1"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="builder-selected-edge-color">Cor selecionada</Label>
            <Input
              id="builder-selected-edge-color"
              type="color"
              value={draft.selectedEdgeColor}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  selectedEdgeColor: event.target.value,
                }))
              }
              className="h-10 w-full p-1"
            />
          </div>
        </div>

        <div className={gridClassName}>
          <div className="space-y-2">
            <Label htmlFor="builder-edge-stroke-width">Espessura</Label>
            <Select
              value={String(draft.edgeStrokeWidth)}
              onValueChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  edgeStrokeWidth: Number(value),
                }))
              }
            >
              <SelectTrigger id="builder-edge-stroke-width">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map((width) => (
                  <SelectItem key={width} value={String(width)}>
                    {width}px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="builder-edge-opacity">Opacidade</Label>
            <Select
              value={String(draft.edgeOpacity)}
              onValueChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  edgeOpacity: Number(value),
                }))
              }
            >
              <SelectTrigger id="builder-edge-opacity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">100%</SelectItem>
                <SelectItem value="0.85">85%</SelectItem>
                <SelectItem value="0.7">70%</SelectItem>
                <SelectItem value="0.5">50%</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="builder-edge-marker-end">Seta final</Label>
          <Select
            value={draft.edgeMarkerEnd}
            onValueChange={(value) =>
              updateDraft((current) => ({
                ...current,
                edgeMarkerEnd: value as BuilderEdgeMarker,
              }))
            }
          >
            <SelectTrigger id="builder-edge-marker-end">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {builderEdgeMarkerOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="builder-edge-marker-size">Tamanho da seta</Label>
          <Select
            value={String(draft.edgeMarkerSize)}
            onValueChange={(value) =>
              updateDraft((current) => ({
                ...current,
                edgeMarkerSize: Number(value),
              }))
            }
          >
            <SelectTrigger id="builder-edge-marker-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[12, 16, 20, 24, 32].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}px
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        className={
          isSidebar
            ? 'sticky bottom-0 -mx-3 flex flex-col gap-2 border-t border-gray-100 bg-white px-3 pb-3 pt-3 dark:border-zinc-800 dark:bg-zinc-950'
            : 'flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end'
        }
      >
        <Button variant="outline" onClick={resetToDefaults} disabled={isSaving}>
          Restaurar padrão
        </Button>
        <Button variant="outline" onClick={cancel} disabled={isSaving}>
          Cancelar
        </Button>
        <Button onClick={save} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </div>
  )
}
