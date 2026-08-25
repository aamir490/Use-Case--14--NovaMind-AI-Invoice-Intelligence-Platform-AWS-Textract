import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { useInvoices } from '../../hooks/useInvoices'
import { useInvoiceFilterStore } from '../../store'
import { RiskBadge, StatusBadge } from './RiskBadge'
import type { RiskLevel, ProcessingStatus } from '../../types'

export default function InvoiceList() {
  const { filters, setFilters, resetFilters } = useInvoiceFilterStore()
  const { data, isLoading, isError } = useInvoices(filters)
  const navigate = useNavigate()

  const hasFilters = filters.status || filters.risk_level || filters.from || filters.to

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label" htmlFor="filter-status">Status</label>
            <select
              id="filter-status"
              className="input w-36"
              value={filters.status || ''}
              onChange={(e) => setFilters({ ...filters, status: e.target.value as ProcessingStatus | '' })}
            >
              <option value="">All</option>
              <option value="COMPLETED">Completed</option>
              <option value="PROCESSING">Processing</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="filter-risk">Risk Level</label>
            <select
              id="filter-risk"
              className="input w-36"
              value={filters.risk_level || ''}
              onChange={(e) => setFilters({ ...filters, risk_level: e.target.value as RiskLevel | '' })}
            >
              <option value="">All</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="filter-from">From</label>
            <input
              id="filter-from"
              type="date"
              className="input w-40"
              value={filters.from || ''}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="filter-to">To</label>
            <input
              id="filter-to"
              type="date"
              className="input w-40"
              value={filters.to || ''}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </div>
          {hasFilters && (
            <button className="btn-secondary" onClick={resetFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
            Loading invoices…
          </div>
        ) : isError ? (
          <div role="alert" className="flex items-center justify-center h-48 text-red-500 text-sm">
            Failed to load invoices. Please refresh.
          </div>
        ) : !data?.items.length ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">No invoices found</p>
            {hasFilters && <p className="text-xs mt-1">Try clearing filters</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Invoice #', 'Vendor', 'Date', 'Total', 'Risk', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.items.map((inv) => (
                  <tr
                    key={inv.invoice_id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/invoices/${inv.invoice_id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {inv.invoice_number || inv.invoice_id}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{inv.vendor_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {inv.receipt_date || (inv.created_at ? format(new Date(inv.created_at), 'MMM d, yyyy') : '—')}
                    </td>
                    <td className="px-4 py-3 text-gray-900 font-medium">{inv.total_amount || '—'}</td>
                    <td className="px-4 py-3">
                      <RiskBadge level={inv.risk_level} score={inv.risk_score} showScore />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        className="text-brand-600 hover:text-brand-800 text-xs font-medium"
                        onClick={(e) => { e.stopPropagation(); navigate(`/invoices/${inv.invoice_id}`) }}
                        aria-label={`View invoice ${inv.invoice_number || inv.invoice_id}`}
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data?.next_cursor && (
          <div className="px-4 py-3 border-t border-gray-100 text-center">
            <button
              className="btn-secondary text-xs"
              onClick={() => setFilters({ ...filters, cursor: data.next_cursor ?? undefined })}
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
