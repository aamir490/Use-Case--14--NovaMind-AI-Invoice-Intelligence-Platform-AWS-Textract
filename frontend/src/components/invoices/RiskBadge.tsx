import clsx from 'clsx'
import type { RiskLevel, ProcessingStatus } from '../../types'

interface RiskBadgeProps {
  level?: RiskLevel | null
  score?: number | null
  showScore?: boolean
}

export function RiskBadge({ level, score, showScore = false }: RiskBadgeProps) {
  if (!level) return <span className="badge-pending">—</span>

  const cls = level === 'HIGH' ? 'badge-high' : level === 'MEDIUM' ? 'badge-medium' : 'badge-low'
  return (
    <span className={cls}>
      {level}{showScore && score != null ? ` (${score})` : ''}
    </span>
  )
}

interface StatusBadgeProps {
  status: ProcessingStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const map: Record<ProcessingStatus, string> = {
    PENDING:    'badge-pending',
    PROCESSING: 'badge-pending',
    COMPLETED:  'badge-low',
    FAILED:     'badge-failed',
  }
  const labels: Record<ProcessingStatus, string> = {
    PENDING:    'Pending',
    PROCESSING: 'Processing…',
    COMPLETED:  'Completed',
    FAILED:     'Failed',
  }
  return <span className={map[status]}>{labels[status]}</span>
}
