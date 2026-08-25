import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useRiskTrend } from '../../hooks/useAnalytics'
import { format } from 'date-fns'

export default function RiskTrendChart() {
  const { data, isLoading } = useRiskTrend()

  if (isLoading) return <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
  if (!data?.trend?.length) {
    return <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No trend data yet</div>
  }

  const chartData = data.trend.map((d) => ({
    ...d,
    date: format(new Date(d.date), 'MMM d'),
  }))

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(v: number) => [v.toFixed(1), 'Avg Risk Score']}
          contentStyle={{ fontSize: 12 }}
        />
        <Line
          type="monotone"
          dataKey="avg_risk_score"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
          name="Avg Risk Score"
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
