import { useState } from 'react'
import InvoiceList from '../components/invoices/InvoiceList'
import InvoiceUpload from '../components/invoices/InvoiceUpload'

export default function InvoicesPage() {
  const [showUpload, setShowUpload] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
          <p className="text-gray-500 text-sm mt-1">All processed invoices with AI risk analysis</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => setShowUpload((v) => !v)}
          aria-expanded={showUpload}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Upload Invoice
        </button>
      </div>

      {showUpload && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Upload New Invoice</h2>
          <InvoiceUpload />
        </div>
      )}

      <InvoiceList />
    </div>
  )
}
