import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { useInvoice, useDeleteInvoice } from '../../hooks/useInvoices'
import { RiskBadge, StatusBadge } from './RiskBadge'
import type { Anomaly } from '../../types'

const ANOMALY_ICONS: Record<string, string> = {
  MATH_ERROR:           '🧮',
  DATE_INCONSISTENCY:   '📅',
  UNUSUAL_PRICE:        '💰',
  NON_STANDARD_FORMAT:  '📄',
  TAX_IRREGULARITY:     '🏛️',
  DUPLICATE_ITEM:       '🔁',
  MISSING_FIELD:        '❓',
  OTHER:                '⚠️',
}

interface Props { id: string }

export default function InvoiceDetail({ id }: Props) {
  const { data: invoice, isLoading, isError } = useInvoice(id)
  const deleteMutation = useDeleteInvoice()
  const navigate = useNavigate()

  const handleDelete = async () => {
    if (!window.confirm('Delete this invoice? This cannot be undone.')) return
    await deleteMutation.mutateAsync(id)
    navigate('/invoices')
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-gray-500 text-sm">Loading invoice…</div>
  )
  if (isError || !invoice) return (
    <div role="alert" className="flex items-center justify-center h-64 text-red-500 text-sm">
      Invoice not found or failed to load.
    </div>
  )

  const score = invoice.risk_score ?? 0
  const scoreColor = score >= 70 ? 'text-red-600' : score >= 30 ? 'text-yellow-600' : 'text-green-600'
  const ringColor  = score >= 70 ? '#ef4444'     : score >= 30 ? '#f59e0b'          : '#22c55e'

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">
              {invoice.invoice_number || invoice.invoice_id}
            </h1>
            <StatusBadge status={invoice.status} />
            <RiskBadge level={invoice.risk_level} score={invoice.risk_score} showScore />
          </div>
          <p className="text-sm text-gray-500 mt-1">{invoice.vendor_name || 'Unknown vendor'}</p>
        </div>
        <button
          className="btn-danger text-xs"
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          aria-label="Delete invoice"
        >
          {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: invoice metadata */}
        <div className="lg:col-span-2 space-y-6">

          {/* Key fields */}
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">Invoice Details</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              {[
                ['Invoice Number', invoice.invoice_number],
                ['Vendor',         invoice.vendor_name],
                ['Receipt Date',   invoice.receipt_date],
                ['Due Date',       invoice.due_date],
                ['Total Amount',   invoice.total_amount],
                ['Tax',            invoice.tax],
                ['Subtotal',       invoice.subtotal],
                ['Currency',       invoice.currency],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs text-gray-500">{label}</dt>
                  <dd className="text-sm font-medium text-gray-900 mt-0.5">{value || '—'}</dd>
                </div>
              ))}
              {invoice.processing_time_ms && (
                <div>
                  <dt className="text-xs text-gray-500">Processing Time</dt>
                  <dd className="text-sm font-medium text-gray-900 mt-0.5">
                    {(invoice.processing_time_ms / 1000).toFixed(1)}s
                  </dd>
                </div>
              )}
              {invoice.processed_at && (
                <div>
                  <dt className="text-xs text-gray-500">Processed At</dt>
                  <dd className="text-sm font-medium text-gray-900 mt-0.5">
                    {format(new Date(invoice.processed_at), 'MMM d, yyyy HH:mm')}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* Line items */}
          {invoice.line_items.length > 0 && (
            <section className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Line Items</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-5 py-2 text-left text-xs text-gray-500 font-medium">Item</th>
                    <th className="px-5 py-2 text-left text-xs text-gray-500 font-medium">Qty</th>
                    <th className="px-5 py-2 text-right text-xs text-gray-500 font-medium">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {invoice.line_items.map((li, i) => (
                    <tr key={i}>
                      <td className="px-5 py-2.5 text-gray-900">{li.item || '—'}</td>
                      <td className="px-5 py-2.5 text-gray-600">{li.quantity || '—'}</td>
                      <td className="px-5 py-2.5 text-right text-gray-900 font-medium">{li.price || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Anomalies */}
          {invoice.anomalies.length > 0 && (
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
                Anomalies Detected ({invoice.anomalies.length})
              </h2>
              <ul className="space-y-3" aria-label="Detected anomalies">
                {invoice.anomalies.map((anomaly: Anomaly, i) => (
                  <li key={i} className={`p-3 rounded-lg border ${
                    anomaly.severity === 'HIGH'   ? 'bg-red-50 border-red-200' :
                    anomaly.severity === 'MEDIUM' ? 'bg-yellow-50 border-yellow-200' :
                    'bg-gray-50 border-gray-200'
                  }`}>
                    <div className="flex items-start gap-3">
                      <span className="text-lg" aria-hidden="true">
                        {ANOMALY_ICONS[anomaly.type] || '⚠️'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-gray-700">{anomaly.type.replace(/_/g, ' ')}</span>
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                            anomaly.severity === 'HIGH'   ? 'bg-red-100 text-red-700' :
                            anomaly.severity === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {anomaly.severity}
                          </span>
                          {anomaly.field && (
                            <span className="text-xs text-gray-400">• {anomaly.field}</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 mt-0.5">{anomaly.description}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* AI Explanation */}
          {invoice.ai_explanation && (
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">AI Analysis</h2>
              <p className="text-sm text-gray-700 leading-relaxed">{invoice.ai_explanation}</p>
              {invoice.ai_confidence && (
                <p className="text-xs text-gray-400 mt-2">
                  Confidence: {(parseFloat(invoice.ai_confidence) * 100).toFixed(0)}%
                </p>
              )}
            </section>
          )}
        </div>

        {/* Right: risk score gauge */}
        <div className="space-y-4">
          <section className="card p-5 flex flex-col items-center">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide self-start">Risk Score</h2>
            <div className="relative w-36 h-36 flex items-center justify-center">
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e7eb" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="50" fill="none"
                  stroke={ringColor}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${(score / 100) * 314} 314`}
                  style={{ transition: 'stroke-dasharray 0.8s ease' }}
                />
              </svg>
              <div className="text-center">
                <span className={`text-4xl font-bold ${scoreColor}`}>{score}</span>
                <span className="text-xs text-gray-400 block">/ 100</span>
              </div>
            </div>
            <RiskBadge level={invoice.risk_level} />
          </section>

          <section className="card p-4 space-y-2 text-sm">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Processing Info</h2>
            <div className="flex justify-between">
              <span className="text-gray-500">Invoice ID</span>
              <span className="font-mono text-xs text-gray-700 truncate max-w-[120px]">{invoice.invoice_id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Status</span>
              <StatusBadge status={invoice.status} />
            </div>
            {invoice.processing_time_ms && (
              <div className="flex justify-between">
                <span className="text-gray-500">Duration</span>
                <span className="text-gray-700">{(invoice.processing_time_ms / 1000).toFixed(1)}s</span>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
