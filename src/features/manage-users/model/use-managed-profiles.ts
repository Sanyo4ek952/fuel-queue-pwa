import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { currentProfileQueryKey } from '@/entities/profile'
import {
  approveRegistration,
  deactivateProfile,
  listManagedProfiles,
  rejectRegistration,
  type ManagedProfile,
} from '@/shared/api/profile'

import type {
  ApproveRegistrationValues,
  DeactivateProfileValues,
  RejectRegistrationValues,
} from './schema'

export type { ManagedProfile }

export const managedProfilesQueryKey = ['managed-profiles'] as const

function useInvalidateManagedProfiles() {
  const queryClient = useQueryClient()

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: managedProfilesQueryKey }),
      queryClient.invalidateQueries({ queryKey: currentProfileQueryKey }),
    ])
  }
}

export function useManagedProfiles() {
  return useQuery({
    queryKey: managedProfilesQueryKey,
    queryFn: listManagedProfiles,
    staleTime: 15_000,
  })
}

export function useApproveRegistration() {
  const invalidate = useInvalidateManagedProfiles()

  return useMutation({
    mutationFn: (values: ApproveRegistrationValues) => approveRegistration(values),
    onSuccess: invalidate,
  })
}

export function useRejectRegistration() {
  const invalidate = useInvalidateManagedProfiles()

  return useMutation({
    mutationFn: (values: RejectRegistrationValues) => rejectRegistration(values),
    onSuccess: invalidate,
  })
}

export function useDeactivateProfile() {
  const invalidate = useInvalidateManagedProfiles()

  return useMutation({
    mutationFn: (values: DeactivateProfileValues) => deactivateProfile(values),
    onSuccess: invalidate,
  })
}
