import { AsyncLocalStorage } from 'node:async_hooks'

interface TenantStore {
  companyId: string | null
  bypass: boolean
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>()

/** Set tenant companyId (called by auth middleware after JWT verification) */
export function setTenantCompanyId(companyId: string) {
  const store = tenantStorage.getStore()
  if (store) store.companyId = companyId
}

/** Mark current context as bypass — skips auto-scope (admin/system routes) */
export function setTenantBypass() {
  const store = tenantStorage.getStore()
  if (store) store.bypass = true
}

/** Get current tenant companyId, or null if bypass/unset */
export function getTenantCompanyId(): string | null {
  const store = tenantStorage.getStore()
  if (!store || store.bypass) return null
  return store.companyId
}
