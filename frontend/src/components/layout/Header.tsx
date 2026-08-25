import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store'
import { logout } from '../../services/auth'

export default function Header() {
  const { user, logout: clearStore } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    clearStore()
    navigate('/login')
  }

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">NovaMind Ai Invoice Intelligence Platform</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
          Live
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-gray-900">{user?.name || user?.email || 'User'}</p>
          <p className="text-xs text-gray-500">{user?.email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="btn-secondary text-xs px-3 py-1.5"
          aria-label="Sign out"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
