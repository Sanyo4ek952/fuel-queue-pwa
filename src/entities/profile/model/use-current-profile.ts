import { useQuery } from '@tanstack/react-query'

import {
  getCurrentProfile,
  type CurrentProfile,
  type ProfileStation,
} from '@/shared/api/profile'

export type Profile = CurrentProfile
export type ProfileWithStations = CurrentProfile
export type { ProfileStation }

export const currentProfileQueryKey = ['current-profile'] as const

export function useCurrentProfile(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: currentProfileQueryKey,
    queryFn: getCurrentProfile,
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  })
}
