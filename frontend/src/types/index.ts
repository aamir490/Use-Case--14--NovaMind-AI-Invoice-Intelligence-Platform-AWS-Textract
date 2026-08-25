export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type ProcessingStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH'

export type AnomalyType =
  | 'MATH_ERROR'
  | 'DATE_INCONSISTENCY'
  | 'UNUSUAL_PRICE'
  | 'NON_STANDARD_FORMAT'
  | 'TAX_IRREGULARITY'
  | 'DUPLICATE_ITEM'
  | 'MISSING_FIELD'
  | 'OTHER'

export interface LineItem {
  item: string
  price: string
  quantity?: string
}

export interface Anomaly {
  type: AnomalyType
  severity: AnomalySeverity
  description: string
  field?: string | null
}

export interface Invoice {
  tenant_id: string
  invoice_id: string
  invoice_number?: string
  vendor_name?: string
  due_date?: string
  receipt_date?: string
  total_amount?: string
  subtotal?: string
  tax?: string
  currency?: string
  status: ProcessingStatus
  risk_score?: number
  risk_level?: RiskLevel
  line_items: LineItem[]
  anomalies: Anomaly[]
  ai_explanation?: string
  ai_confidence?: string
  s3_key?: string
  created_at: string
  processed_at?: string
  processing_time_ms?: number
}

export interface InvoiceStatus {
  invoice_id: string
  status: ProcessingStatus
  stage?: string
  risk_score?: number
  risk_level?: RiskLevel
  processing_time_ms?: number
  error_message?: string
}

export interface InvoiceListResponse {
  items: Invoice[]
  count: number
  next_cursor?: string | null
}

export interface UploadUrlResponse {
  invoice_id: string
  job_id: string
  upload_url: string
  s3_key: string
  expires_in: number
}

export interface AnalyticsSummary {
  total_invoices: number
  completed_invoices: number
  high_risk_count: number
  medium_risk_count: number
  low_risk_count: number
  average_risk_score: number
  average_processing_time_ms: number
}

export interface RiskTrendPoint {
  date: string
  avg_risk_score: number
  count: number
}

export interface VendorStat {
  vendor: string
  invoice_count: number
  avg_risk_score: number
}

export interface AnomalyTypeCount {
  type: string
  count: number
}

export interface FilterState {
  status?: ProcessingStatus | ''
  risk_level?: RiskLevel | ''
  from?: string
  to?: string
  cursor?: string
}
