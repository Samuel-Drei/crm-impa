import axios from 'axios'
import { useAuthStore } from '@/stores/auth.store'

// Em produção, nginx faz proxy de /api para o backend
// Em dev, VITE_API_URL aponta para localhost:3333
const API_BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  // Token is sent as httpOnly cookie automatically via withCredentials
  // Fallback: also send Authorization header if token is in store (transition period)
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

let isRefreshing = false
let failedQueue: Array<{ resolve: (v?: unknown) => void; reject: (e?: unknown) => void }> = []

function processQueue(error: any) {
  failedQueue.forEach(({ resolve, reject }) => (error ? reject(error) : resolve()))
  failedQueue = []
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // Try refresh on 401 (but not for auth login/register/refresh/logout endpoints)
    const skipRefreshUrls = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout']
    const shouldSkipRefresh = skipRefreshUrls.some(u => originalRequest.url?.includes(u))
    if (error.response?.status === 401 && !originalRequest._retry && !shouldSkipRefresh) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then(() => api(originalRequest))
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        await axios.post(
          `${API_BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true }
        )
        processQueue(null)
        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError)
        useAuthStore.getState().logout()
        window.location.href = '/login'
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    if (error.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    // JWT antigo sem permissões RBAC — forçar re-login
    // (mas não quando for bloqueio de plano)
    if (error.response?.status === 403) {
      const code = error.response?.data?.code
      if (code === 'PLAN_LIMIT_REACHED' || code === 'PLAN_FEATURE_BLOCKED') {
        // Plan limit error — don't logout, just reject
        return Promise.reject(error)
      }
      const user = useAuthStore.getState().user
      if (!user?.permissions || user.permissions.length === 0) {
        useAuthStore.getState().logout()
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api
