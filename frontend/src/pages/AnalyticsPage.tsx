import SummaryCards from '../components/analytics/SummaryCards'
import RiskTrendChart from '../components/analytics/RiskTrendChart'
import RiskDistributionChart from '../components/analytics/RiskDistributionChart'
import VendorChart from '../components/analytics/VendorChart'
import AnomalyTypesChart from '../components/analytics/AnomalyTypesChart'

export default function AnalyticsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-gray-500 text-sm mt-1">
          Aggregate insights across all processed invoices
        </p>
      </div>

      <SummaryCards />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
            Risk Score Trend
          </h2>
          <RiskTrendChart />
        </div>
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
            Risk Distribution
          </h2>
          <RiskDistributionChart />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
            Risk by Vendor (Top 10)
          </h2>
          <VendorChart />
        </div>
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
            Anomaly Types Breakdown
          </h2>
          <AnomalyTypesChart />
        </div>
      </div>
    </div>
  )
}
