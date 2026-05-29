import api from './api'
import type { ModuleDefinition, ModuleRegistryItem } from '@/types'

// ── Módulos ativos (para usuário logado) ──
export async function getActiveModules(): Promise<ModuleDefinition[]> {
  const res = await api.get('/modules/active')
  return res.data.modules
}

export async function getModuleRegistry(): Promise<ModuleRegistryItem[]> {
  const res = await api.get('/modules/registry')
  return res.data.modules
}

export async function getModuleDefinition(slug: string): Promise<ModuleDefinition> {
  const res = await api.get(`/modules/${slug}`)
  return res.data.module
}

export async function getModuleTemplates(slug: string): Promise<any[]> {
  const res = await api.get(`/modules/${slug}/templates`)
  return res.data.templates
}

export async function validateStageMove(slug: string, stageSlug: string, customFields: Record<string, any>, cardData: Record<string, any>): Promise<{ valid: boolean; errors: string[] }> {
  const res = await api.post(`/modules/${slug}/validate-stage`, { stageSlug, customFields, cardData })
  return res.data
}

// ── Admin: Gestão de módulos por empresa ──
export async function getAdminModules(companyId?: string): Promise<ModuleRegistryItem[]> {
  const res = await api.get('/admin/modules', { params: companyId ? { companyId } : {} })
  return res.data.modules
}

export async function activateModule(slug: string, companyId: string, config?: any): Promise<void> {
  await api.post(`/admin/modules/${slug}/activate`, { companyId, config })
}

export async function deactivateModule(slug: string, companyId: string): Promise<void> {
  await api.post(`/admin/modules/${slug}/deactivate`, { companyId })
}

export async function getCompanyModules(companyId: string): Promise<any[]> {
  const res = await api.get(`/admin/companies/${companyId}/modules`)
  return res.data.modules
}

export async function updateModuleConfig(companyId: string, slug: string, config: any): Promise<void> {
  await api.put(`/admin/companies/${companyId}/modules/${slug}/config`, { config })
}
