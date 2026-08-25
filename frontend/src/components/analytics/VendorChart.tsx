import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useVendorStats } from '../../hooks/useAnalytics'

export default function VendorChart() {
  const { data, isLoading } = useVendorStats()

  if (isLoading) return <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
  if (!data?.vendors?.length) {
    return <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No vendor data yet</div>
  }

  const top10 = data.vendors.slice(0, 10)

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={top10} margin={{ top: 5, right: 20, left: 0, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="vendor"
          tick={{ fontSize: 10 }}
          angle={-35}
          textAnchor="end"
          interval={0}
        />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(v: number, _: string, p) => [v.toFixed(1), `Avg Risk — ${p.payload.invoice_count} invoices`]}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="avg_risk_score" radius={[4, 4, 0, 0]} name="Avg Risk Score">
          {top10.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.avg_risk_score >= 70 ? '#ef4444' : entry.avg_risk_score >= 30 ? '#f59e0b' : '#22c55e'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
