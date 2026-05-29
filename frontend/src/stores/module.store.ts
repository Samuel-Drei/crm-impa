import { create } from 'zustand'
import type { ModuleDefinition, CustomFieldDef, CardTabDef, SidebarMenu, DashboardWidget, PipelineTemplate, StageValidation, CardAction } from '@/types'
import api from '@/services/api'

interface ModuleStore {
  activeModules: ModuleDefinition[]
  loading: boolean
  loaded: boolean

  // Actions
  fetchActiveModules: () => Promise<void>
  reset: () => void

  // Helpers — agregam definições de todos os módulos ativos
  getCustomFields: (target: 'card' | 'contact') => CustomFieldDef[]
  getCardTabs: () => CardTabDef[]
  getSidebarMenus: () => SidebarMenu[]
  getDashboardWidgets: () => DashboardWidget[]
  getPipelineTemplates: () => PipelineTemplate[]
  getStageValidations: (stageSlug: string) => StageValidation[]
  getCardActions: () => CardAction[]
  isModuleActive: (slug: string) => boolean
}

export const useModuleStore = create<ModuleStore>((set, get) => ({
  activeModules: [],
  loading: false,
  loaded: false,

  fetchActiveModules: async () => {
    set({ loading: true })
    try {
      const res = await api.get('/modules/active')
      set({ activeModules: res.data.modules, loaded: true })
    } catch (e) {
      console.error('Failed to load active modules:', e)
    } finally {
      set({ loading: false })
    }
  },

  reset: () => set({ activeModules: [], loaded: false }),

  getCustomFields: (target) => {
    return get().activeModules.flatMap(m => (m.customFields || []).filter(f => f.target === target))
  },

  getCardTabs: () => {
    return get().activeModules
      .flatMap(m => m.cardTabs || [])
      .sort((a, b) => a.position - b.position)
  },

  getSidebarMenus: () => {
    return get().activeModules
      .flatMap(m => m.sidebarMenus || [])
      .sort((a, b) => a.position - b.position)
  },

  getDashboardWidgets: () => {
    return get().activeModules
      .flatMap(m => m.dashboardWidgets || [])
      .sort((a, b) => a.position - b.position)
  },

  getPipelineTemplates: () => {
    return get().activeModules.flatMap(m => m.pipelineTemplates || [])
  },

  getStageValidations: (stageSlug) => {
    return get().activeModules
      .flatMap(m => m.stageValidations || [])
      .filter(v => v.stageSlug === stageSlug)
  },

  getCardActions: () => {
    return get().activeModules.flatMap(m => m.cardActions || [])
  },

  isModuleActive: (slug) => {
    return get().activeModules.some(m => m.slug === slug)
  },
}))
