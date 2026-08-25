import axios from 'axios'
import { getIdToken } from './auth'
import type {
  Invoice,
  InvoiceListResponse,
  InvoiceStatus,
  UploadUrlResponse,
  AnalyticsSummary,
  RiskTrendPoint,
  VendorStat,
  AnomalyTypeCount,
  FilterState,
} from '../types'

const BASE_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || ''

const apiClient = axios.create({ baseURL: BASE_URL })

// Attach JWT token to every request
apiClient.interceptors.request.use(async (config) => {
  try {
    const token = await getIdToken()
    // Only set the header if we actually have a non-empty token string
    if (token && token.length > 0) {
      config.headers.Authorization = `Bearer ${token}`
      console.debug('[API] Token attached, length:', token.length)
    } else {
      console.warn('[API] No token available — request will be unauthorized')
    }
  } catch (e) {
    console.warn('[API] getIdToken() threw:', e)
  }
  console.debug('[API] Request:', config.method?.toUpperCase(), config.baseURL + config.url)
  return config
})

// Normalize errors so callers always get a useful message
apiClient.interceptors.response.use(
  (response) => response,
  (err) => {
    // Axios wraps non-2xx as errors — attach the status so callers can check it
    if (err.response) {
      // Server responded with an error status — not a network issue
      return Promise.reject(err)
    }
    // True network error (DNS, CORS block, timeout) — make it identifiable
    const networkErr = new Error(
      `Network error reaching API. Check your internet connection or API URL. (${err.message})`
    )
    ;(networkErr as any).isNetworkError = true
    return Promise.reject(networkErr)
  }
)

// ── Invoice endpoints ──────────────────────────────────────────────────────

export async function requestUploadUrl(filename: string, contentType: string): Promise<UploadUrlResponse> {
  const { data } = await apiClient.post('/invoices/upload-url', { filename, content_type: contentType })
  return data
}

export async function getInvoices(filters: FilterState = {}): Promise<InvoiceListResponse> {
  const params: Record<string, string> = {}
  if (filters.status)     params.status     = filters.status
  if (filters.risk_level) params.risk_level = filters.risk_level
  if (filters.from)       params.from       = filters.from
  if (filters.to)         params.to         = filters.to
  if (filters.cursor)     params.cursor     = filters.cursor
  const { data } = await apiClient.get('/invoices', { params })
  return data
}

export async function getInvoice(id: string): Promise<Invoice> {
  const { data } = await apiClient.get(`/invoices/${id}`)
  return data
}

export async function getInvoiceStatus(id: string): Promise<InvoiceStatus> {
  const { data } = await apiClient.get(`/invoices/${id}/status`)
  return data
}

export async function deleteInvoice(id: string): Promise<void> {
  await apiClient.delete(`/invoices/${id}`)
}

// ── Analytics endpoints ────────────────────────────────────────────────────

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  const { data } = await apiClient.get('/analytics/summary')
  return data
}

export async function getRiskTrend(): Promise<{ trend: RiskTrendPoint[] }> {
  const { data } = await apiClient.get('/analytics/risk-trend')
  return data
}

export async function getVendorStats(): Promise<{ vendors: VendorStat[] }> {
  const { data } = await apiClient.get('/analytics/vendor-stats')
  return data
}

export async function getAnomalyTypes(): Promise<{ anomaly_types: AnomalyTypeCount[] }> {
  const { data } = await apiClient.get('/analytics/anomaly-types')
  return data
}
