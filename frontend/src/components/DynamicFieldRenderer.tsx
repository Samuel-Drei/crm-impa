import { useState } from 'react'
import type { CustomFieldDef } from '@/types'

interface Props {
  fields: CustomFieldDef[]
  values: Record<string, any>
  onChange: (key: string, value: any) => void
  readOnly?: boolean
}

export function DynamicFieldRenderer({ fields, values, onChange, readOnly = false }: Props) {
  if (fields.length === 0) return null

  // Agrupar campos por grupo
  const grouped = fields.reduce<Record<string, CustomFieldDef[]>>((acc, field) => {
    const group = field.group || 'Geral'
    if (!acc[group]) acc[group] = []
    acc[group].push(field)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([groupName, groupFields]) => (
        <div key={groupName}>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{groupName}</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {groupFields.map(field => (
              <FieldInput
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={(val) => onChange(field.key, val)}
                readOnly={readOnly}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function FieldInput({
  field,
  value,
  onChange,
  readOnly,
}: {
  field: CustomFieldDef
  value: any
  onChange: (val: any) => void
  readOnly: boolean
}) {
  const baseClass = 'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50'

  switch (field.type) {
    case 'text':
    case 'url':
      return (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{field.label}</label>
          <input
            type={field.type === 'url' ? 'url' : 'text'}
            className={baseClass}
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder || field.label}
            disabled={readOnly}
          />
        </div>
      )

    case 'number':
      return (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{field.label}</label>
          <input
            type="number"
            className={baseClass}
            value={value ?? ''}
            onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
            placeholder={field.placeholder || field.label}
            disabled={readOnly}
          />
        </div>
      )

    case 'currency':
      return (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{field.label}</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
            <input
              type="number"
              step="0.01"
              className={`${baseClass} pl-8`}
              value={value ?? ''}
              onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
              disabled={readOnly}
            />
          </div>
        </div>
      )

    case 'date':
      return (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{field.label}</label>
          <input
            type="date"
            className={baseClass}
            value={value ? value.split('T')[0] : ''}
            onChange={e => onChange(e.target.value || null)}
            disabled={readOnly}
          />
        </div>
      )

    case 'select':
      return (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{field.label}</label>
          <select
            className={baseClass}
            value={value || ''}
            onChange={e => onChange(e.target.value || null)}
            disabled={readOnly}
          >
            <option value="">Selecionar...</option>
            {field.options?.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      )

    case 'multiselect':
      return (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{field.label}</label>
          <select
            multiple
            className={`${baseClass} min-h-[80px]`}
            value={Array.isArray(value) ? value : []}
            onChange={e => {
              const selected = Array.from(e.target.selectedOptions, opt => opt.value)
              onChange(selected)
            }}
            disabled={readOnly}
          >
            {field.options?.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      )

    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            className="rounded border-input"
            checked={!!value}
            onChange={e => onChange(e.target.checked)}
            disabled={readOnly}
          />
          <label className="text-xs font-medium text-muted-foreground">{field.label}</label>
        </div>
      )

    case 'textarea':
      return (
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{field.label}</label>
          <textarea
            className={`${baseClass} min-h-[80px]`}
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder || field.label}
            disabled={readOnly}
          />
        </div>
      )

    default:
      return null
  }
}
