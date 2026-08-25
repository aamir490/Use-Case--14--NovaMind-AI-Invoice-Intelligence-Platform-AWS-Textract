import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useAnalyticsSummary } from '../../hooks/useAnalytics'

const COLORS = { HIGH: '#ef4444', MEDIUM: '#f59e0b', LOW: '#22c55e' }

export default function RiskDistributionChart() {
  const { data, isLoading } = useAnalyticsSummary()

  if (isLoading) return <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
  if (!data) return null

  const chartData = [
    { name: 'High',   value: data.high_risk_count,   color: COLORS.HIGH },
    { name: 'Medium', value: data.medium_risk_count,  color: COLORS.MEDIUM },
    { name: 'Low',    value: data.low_risk_count,     color: COLORS.LOW },
  ].filter((d) => d.value > 0)

  if (!chartData.length) {
    return <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No data yet</div>
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%" cy="50%"
          innerRadius={60}
          outerRadius={90}
          paddingAngle={3}
          dataKey="value"
          aria-label="Risk distribution pie chart"
        >
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number) => [v, 'Invoices']} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  )
}
