import type { UserRole } from '@/shared/config/roles'

export function canCreateManualOverride(role: UserRole) {
  return role === 'shift_supervisor' || role === 'station_admin'
}
