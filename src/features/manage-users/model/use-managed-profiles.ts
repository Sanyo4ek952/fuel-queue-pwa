import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { currentProfileQueryKey } from '@/entities/profile'
import {
  approveRegistration,
  deactivateProfile,
  listManagedProfiles,
  rejectRegistration,
  type ManagedProfile,
  type ManagedProfilesSection,
} from '@/shared/api/profile'

import type {
  ApproveRegistrationValues,
  DeactivateProfileValues,
  RejectRegistrationValues,
} from './schema'

export type { ManagedProfile }
export type { ManagedProfilesSection }

export const MANAGED_PROFILES_PAGE_SIZE = 10
export const managedProfilesQueryKey = ['managed-profiles'] as const
export const managedProfileSections = ['pending', 'active', 'rejected', 'disabled'] as const

function useInvalidateManagedProfiles() {
  const queryClient = useQueryClient()

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: managedProfilesQueryKey }),
      queryClient.invalidateQueries({ queryKey: currentProfileQueryKey }),
    ])
  }
}

export function useManagedProfiles(section: ManagedProfilesSection) {
  return useInfiniteQuery({
    queryKey: [...managedProfilesQueryKey, section],
    queryFn: ({ pageParam }) =>
      listManagedProfiles({
        section,
        limit: MANAGED_PROFILES_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length * MANAGED_PROFILES_PAGE_SIZE : undefined,
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
