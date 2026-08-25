import { Link } from 'react-router-dom'
import { useAuthStore } from '../store'
import SummaryCards from '../components/analytics/SummaryCards'
import RiskTrendChart from '../components/analytics/RiskTrendChart'
import RiskDistributionChart from '../components/analytics/RiskDistributionChart'
import InvoiceUpload from '../components/invoices/InvoiceUpload'
import { useInvoices } from '../hooks/useInvoices'
import { RiskBadge, StatusBadge } from '../components/invoices/RiskBadge'

export default function DashboardPage() {
  const { user } = useAuthStore()
  const { data: recent } = useInvoices({ status: '' })

  const recentItems = recent?.items.slice(0, 5) || []

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back{user?.name ? `, ${user.name}` : ''}
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Here's what's happening with your invoice processing pipeline.
        </p>
      </div>

      {/* KPI Cards */}
      <SummaryCards />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Upload widget */}
        <div className="xl:col-span-1">
          <div className="card p-5 h-full">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
              Upload Invoice
            </h2>
            <InvoiceUpload />
          </div>
        </div>

        {/* Risk trend chart */}
        <div className="xl:col-span-2">
          <div className="card p-5 h-full">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
              Risk Score Trend (Last 30 Days)
            </h2>
            <RiskTrendChart />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recent invoices */}
        <div className="xl:col-span-2">
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Recent Invoices</h2>
              <Link to="/invoices" className="text-xs text-brand-600 hover:text-brand-800 font-medium">View all →</Link>
            </div>
            {recentItems.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">No invoices yet. Upload one above.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Invoice #', 'Vendor', 'Total', 'Risk', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs text-gray-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentItems.map((inv) => (
                    <tr key={inv.invoice_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <Link to={`/invoices/${inv.invoice_id}`} className="font-medium text-brand-600 hover:underline">
                          {inv.invoice_number || inv.invoice_id.slice(0, 12)}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{inv.vendor_name || '—'}</td>
                      <td className="px-4 py-2.5 font-medium">{inv.total_amount || '—'}</td>
                      <td className="px-4 py-2.5"><RiskBadge level={inv.risk_level} score={inv.risk_score} showScore /></td>
                      <td className="px-4 py-2.5"><StatusBadge status={inv.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Risk distribution */}
        <div className="xl:col-span-1">
          <div className="card p-5 h-full">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Risk Distribution</h2>
            <RiskDistributionChart />
          </div>
        </div>
      </div>
    </div>
  )
}
