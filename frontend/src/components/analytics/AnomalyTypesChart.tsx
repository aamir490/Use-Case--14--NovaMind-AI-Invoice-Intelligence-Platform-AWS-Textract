import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useAnomalyTypes } from '../../hooks/useAnalytics'

export default function AnomalyTypesChart() {
  const { data, isLoading } = useAnomalyTypes()

  if (isLoading) return <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
  if (!data?.anomaly_types?.length) {
    return <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No anomaly data yet</div>
  }

  const chartData = data.anomaly_types.map((d) => ({
    ...d,
    type: d.type.replace(/_/g, ' '),
  }))

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="type" tick={{ fontSize: 10 }} width={95} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Count" />
      </BarChart>
    </ResponsiveContainer>
  )
}
