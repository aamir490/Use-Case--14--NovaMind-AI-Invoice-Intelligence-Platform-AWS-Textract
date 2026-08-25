import { useQuery } from '@tanstack/react-query'
import {
  getAnalyticsSummary,
  getRiskTrend,
  getVendorStats,
  getAnomalyTypes,
} from '../services/api'

export function useAnalyticsSummary() {
  return useQuery({
    queryKey: ['analytics', 'summary'],
    queryFn:  getAnalyticsSummary,
    staleTime: 60_000,
  })
}

export function useRiskTrend() {
  return useQuery({
    queryKey: ['analytics', 'risk-trend'],
    queryFn:  getRiskTrend,
    staleTime: 60_000,
  })
}

export function useVendorStats() {
  return useQuery({
    queryKey: ['analytics', 'vendor-stats'],
    queryFn:  getVendorStats,
    staleTime: 60_000,
  })
}

export function useAnomalyTypes() {
  return useQuery({
    queryKey: ['analytics', 'anomaly-types'],
    queryFn:  getAnomalyTypes,
    staleTime: 60_000,
  })
}
