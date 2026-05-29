import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import axios from 'axios'
import type { User, Company } from '@/types'

interface AuthState {
  user: User | null
  company: Company | null
  token: string | null
  isAuthenticated: boolean
  setAuth: (user: User, company: Company, token: string) => void
  updateUser: (user: Partial<User>) => void
  updateCompany: (company: Partial<Company>) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      company: null,
      token: null,
      isAuthenticated: false,

      setAuth: (user, company, token) => {
        // Detect tenant/user switch — if switching, force a hard reset of all caches
        // to prevent the previous user's data from leaking into the new session
        const prev = (typeof window !== 'undefined') ? (useAuthStore.getState?.() as any) : null
        const switching = prev?.user && (prev.user.id !== user.id || prev.company?.id !== company.id)

        set({
          user: {
            ...user,
            permissions: user.permissions ?? [],
            teamIds: user.teamIds ?? [],
            conversationScope: user.conversationScope ?? 'OWN',
            defaultScope: user.defaultScope ?? 'OWN',
          },
          company,
          token,
          isAuthenticated: true,
        })

        if (switching && typeof window !== 'undefined') {
          try { (window as any).__queryClient?.clear() } catch {}
          try { sessionStorage.clear() } catch {}
        }
      },

      updateUser: (userData) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        }))
      },

      updateCompany: (companyData) => {
        set((state) => ({
          company: state.company ? { ...state.company, ...companyData } : null,
        }))
      },

      logout: () => {
        // Clear httpOnly cookie on backend
        const baseUrl = import.meta.env.VITE_API_URL
          ? `${import.meta.env.VITE_API_URL}/api`
          : '/api'
        axios.post(`${baseUrl}/auth/logout`, {}, { withCredentials: true }).catch(() => {})
        set({
          user: null,
          company: null,
          token: null,
          isAuthenticated: false,
        })

        // SECURITY: clear all caches and persisted state to prevent the next user
        // from seeing leftover data from the previous session before it refreshes
        if (typeof window !== 'undefined') {
          try { (window as any).__queryClient?.clear() } catch {}
          try { sessionStorage.clear() } catch {}
          try {
            // Wipe persisted Zustand stores (auth, modules, etc.) so React state
            // is rebuilt from a clean slate after the redirect.
            for (let i = localStorage.length - 1; i >= 0; i--) {
              const key = localStorage.key(i)
              if (!key) continue
              if (key.endsWith('-storage') || key.startsWith('auth-') || key.startsWith('module-')) {
                localStorage.removeItem(key)
              }
            }
          } catch {}
          // Hard reload to /login — destroys ALL React state, sockets, timers
          try { window.location.replace('/login') } catch {}
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        company: state.company,
        isAuthenticated: state.isAuthenticated,
        // token is NOT persisted — it lives in httpOnly cookie
      }),
    }
  )
)
