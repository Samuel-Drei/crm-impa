import { AsyncLocalStorage } from 'node:async_hooks';
export const tenantStorage = new AsyncLocalStorage();
/** Set tenant companyId (called by auth middleware after JWT verification) */
export function setTenantCompanyId(companyId) {
    const store = tenantStorage.getStore();
    if (store)
        store.companyId = companyId;
}
/** Mark current context as bypass — skips auto-scope (admin/system routes) */
export function setTenantBypass() {
    const store = tenantStorage.getStore();
    if (store)
        store.bypass = true;
}
/** Get current tenant companyId, or null if bypass/unset */
export function getTenantCompanyId() {
    const store = tenantStorage.getStore();
    if (!store || store.bypass)
        return null;
    return store.companyId;
}
//# sourceMappingURL=tenant-context.js.map