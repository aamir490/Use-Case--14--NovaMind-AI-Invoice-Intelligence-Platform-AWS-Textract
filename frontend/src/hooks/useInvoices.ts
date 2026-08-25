import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { getInvoices, getInvoice, getInvoiceStatus, deleteInvoice } from '../services/api'
import type { FilterState } from '../types'

export function useInvoices(filters: FilterState = {}) {
  return useQuery({
    queryKey: ['invoices', filters],
    queryFn:  () => getInvoices(filters),
    staleTime: 15_000,
  })
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: ['invoice', id],
    queryFn:  () => getInvoice(id),
    enabled:  !!id,
  })
}

export function useInvoiceStatus(id: string, enabled = true) {
  return useQuery({
    queryKey: ['invoiceStatus', id],
    queryFn:  () => getInvoiceStatus(id),
    enabled:  !!id && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      // Keep polling while still processing
      if (!status || status === 'PENDING' || status === 'PROCESSING') return 3000
      return false
    },
  })
}

export function useDeleteInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteInvoice,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}
