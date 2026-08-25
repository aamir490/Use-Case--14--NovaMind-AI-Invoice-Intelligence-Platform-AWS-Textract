import { useAnalyticsSummary } from '../../hooks/useAnalytics'

interface CardProps {
  label: string
  value: string | number
  sub?: string
  color?: string
}

function StatCard({ label, value, sub, color = 'text-gray-900' }: CardProps) {
  return (
    <div className="card p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

export default function SummaryCards() {
  const { data, isLoading } = useAnalyticsSummary()

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card p-5 animate-pulse">
            <div className="h-3 bg-gray-200 rounded w-24 mb-3" />
            <div className="h-8 bg-gray-200 rounded w-16" />
          </div>
        ))}
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label="Total Invoices"
        value={data.total_invoices}
        sub={`${data.completed_invoices} completed`}
      />
      <StatCard
        label="High Risk"
        value={data.high_risk_count}
        sub="Require review"
        color={data.high_risk_count > 0 ? 'text-red-600' : 'text-gray-900'}
      />
      <StatCard
        label="Avg Risk Score"
        value={data.average_risk_score}
        sub="Out of 100"
        color={data.average_risk_score >= 70 ? 'text-red-600' : data.average_risk_score >= 30 ? 'text-yellow-600' : 'text-green-600'}
      />
      <StatCard
        label="Avg Processing"
        value={`${(data.average_processing_time_ms / 1000).toFixed(1)}s`}
        sub="End-to-end"
      />
    </div>
  )
}
