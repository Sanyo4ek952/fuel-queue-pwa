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

export function useCurrentProfile(options?: { authUserId?: string; enabled?: boolean }) {
  return useQuery({
    queryKey: [...currentProfileQueryKey, options?.authUserId ?? null],
    queryFn: () => getCurrentProfile(options?.authUserId),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  })
}
