import { useParams, Link } from 'react-router-dom'
import InvoiceDetail from '../components/invoices/InvoiceDetail'
import { useInvoiceStatus } from '../hooks/useInvoices'

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()

  if (!id) return <div className="text-red-500">Invalid invoice ID</div>

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500" aria-label="Breadcrumb">
        <Link to="/invoices" className="hover:text-brand-600 transition-colors">Invoices</Link>
        <span aria-hidden="true">/</span>
        <span className="text-gray-900 font-medium truncate max-w-xs">{id}</span>
      </nav>

      {/* Processing status banner */}
      <ProcessingBanner id={id} />

      <InvoiceDetail id={id} />
    </div>
  )
}

function ProcessingBanner({ id }: { id: string }) {
  const { data: status } = useInvoiceStatus(id)

  if (!status || status.status === 'COMPLETED' || status.status === 'FAILED') return null

  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
      <svg className="w-5 h-5 text-blue-500 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      <div>
        <p className="text-sm font-medium text-blue-800">Processing invoice…</p>
        {status.stage && (
          <p className="text-xs text-blue-600 mt-0.5">
            Stage: {status.stage.replace(/_/g, ' ')} — results will appear automatically
          </p>
        )}
      </div>
    </div>
  )
}
