import { create } from 'zustand'
import type { FilterState } from '../types'

interface User {
  userId: string
  email: string
  name?: string
}

interface AuthState {
  isAuthenticated: boolean
  user: User | null
  setAuthenticated: (val: boolean) => void
  setUser: (user: User | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  setAuthenticated: (val) => set({ isAuthenticated: val }),
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  logout: () => set({ isAuthenticated: false, user: null }),
}))

interface InvoiceFilterState {
  filters: FilterState
  setFilters: (filters: FilterState) => void
  resetFilters: () => void
}

const defaultFilters: FilterState = {
  status: '',
  risk_level: '',
  from: '',
  to: '',
}

export const useInvoiceFilterStore = create<InvoiceFilterState>((set) => ({
  filters: defaultFilters,
  setFilters: (filters) => set({ filters }),
  resetFilters: () => set({ filters: defaultFilters }),
}))

interface UploadState {
  activeUploads: Record<string, { filename: string; progress: number; status: string }>
  addUpload: (invoiceId: string, filename: string) => void
  updateUpload: (invoiceId: string, progress: number, status: string) => void
  removeUpload: (invoiceId: string) => void
}

export const useUploadStore = create<UploadState>((set) => ({
  activeUploads: {},
  addUpload: (invoiceId, filename) =>
    set((s) => ({
      activeUploads: { ...s.activeUploads, [invoiceId]: { filename, progress: 0, status: 'uploading' } },
    })),
  updateUpload: (invoiceId, progress, status) =>
    set((s) => ({
      activeUploads: {
        ...s.activeUploads,
        [invoiceId]: { ...s.activeUploads[invoiceId], progress, status },
      },
    })),
  removeUpload: (invoiceId) =>
    set((s) => {
      const next = { ...s.activeUploads }
      delete next[invoiceId]
      return { activeUploads: next }
    }),
}))
