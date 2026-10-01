// Zustand 全局状态 — Auth + UI
import { create } from 'zustand'

const TOKEN_KEY = 'loom_token'
const USER_KEY = 'loom_user'

export interface AuthUser {
  id: string
  username: string
  displayName: string
  email: string
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  currentOrg: { id: string; name: string } | null
  setAuth: (token: string, user: AuthUser) => void
  clearAuth: () => void
  isLoggedIn: () => boolean
  setCurrentOrg: (org: { id: string; name: string } | null) => void
}

// 初始化时从 localStorage 恢复
function loadInitialState(): Pick<AuthState, 'token' | 'user'> {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const userRaw = localStorage.getItem(USER_KEY)
    if (token && userRaw) {
      return { token, user: JSON.parse(userRaw) as AuthUser }
    }
  } catch {
    // ignore
  }
  return { token: null, user: null }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ...loadInitialState(),
  currentOrg: null,

  setAuth(token, user) {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    set({ token, user })
  },

  clearAuth() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    set({ token: null, user: null, currentOrg: null })
  },

  isLoggedIn() {
    return get().token !== null && get().user !== null
  },

  setCurrentOrg(org) {
    set({ currentOrg: org })
  },
}))

