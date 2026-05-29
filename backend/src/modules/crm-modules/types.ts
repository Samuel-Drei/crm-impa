// ══════════════════════════════════════════
// Tipos do Sistema de Módulos Nativos
// ══════════════════════════════════════════

export interface CustomFieldDef {
  target: 'card' | 'contact'
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean' | 'url' | 'currency' | 'textarea'
  options?: string[]
  required?: boolean
  group?: string
  placeholder?: string
}

export interface PipelineTemplate {
  name: string
  type: string
  description?: string
  stages: {
    name: string
    slug: string
    color: string
    position: number
    isWon?: boolean
    isLost?: boolean
    rottingDays?: number
  }[]
}

export interface CardAction {
  key: string
  label: string
  icon: string
  confirmText?: string
  handler?: string // nome do handler em handlers.ts
}

export interface StageValidation {
  stageSlug: string
  rules: {
    field: string
    operator: 'not_empty' | 'equals' | 'min' | 'max' | 'regex'
    value?: any
    message: string
  }[]
}

export interface SidebarMenu {
  label: string
  icon: string
  path: string
  position: number
  section: 'modules'
}

export interface CardTab {
  key: string
  label: string
  icon: string
  position: number
}

export interface DashboardWidget {
  key: string
  label: string
  size: 'sm' | 'md' | 'lg'
  position: number
}

export interface ModuleDefinition {
  slug: string
  name: string
  description: string
  icon: string
  category: string

  customFields?: CustomFieldDef[]
  pipelineTemplates?: PipelineTemplate[]
  cardActions?: CardAction[]
  stageValidations?: StageValidation[]
  sidebarMenus?: SidebarMenu[]
  cardTabs?: CardTab[]
  dashboardWidgets?: DashboardWidget[]
}
