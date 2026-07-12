/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  approveRegistration: vi.fn(),
  deactivateProfile: vi.fn(),
  listManagedProfiles: vi.fn(),
  rejectRegistration: vi.fn(),
}))

vi.mock('@/shared/api/profile', () => ({
  approveRegistration: mocks.approveRegistration,
  deactivateProfile: mocks.deactivateProfile,
  listManagedProfiles: mocks.listManagedProfiles,
}))

import {
  managedProfilesQueryKey,
  useApproveRegistration,
  useManagedProfiles,
} from './use-managed-profiles'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useManagedProfiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listManagedProfiles.mockResolvedValue({
      items: [],
      totalCount: 0,
      hasMore: false,
    })
    mocks.approveRegistration.mockResolvedValue(undefined)
  })

  it('loads each section independently and fetches the next page with offset 10', async () => {
    mocks.listManagedProfiles
      .mockResolvedValueOnce({
        items: [{ id: 'active-1' }],
        totalCount: 11,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'pending-1' }],
        totalCount: 1,
        hasMore: false,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'active-2' }],
        totalCount: 11,
        hasMore: false,
      })
    const wrapper = makeWrapper(makeQueryClient())
    const active = renderHook(() => useManagedProfiles('active'), { wrapper })
    renderHook(() => useManagedProfiles('pending'), { wrapper })

    await waitFor(() =>
      expect(mocks.listManagedProfiles).toHaveBeenCalledWith({
        section: 'active',
        limit: 10,
        offset: 0,
      }),
    )
    await waitFor(() =>
      expect(mocks.listManagedProfiles).toHaveBeenCalledWith({
        section: 'pending',
        limit: 10,
        offset: 0,
      }),
    )

    await act(async () => {
      await active.result.current.fetchNextPage()
    })

    expect(mocks.listManagedProfiles).toHaveBeenLastCalledWith({
      section: 'active',
      limit: 10,
      offset: 10,
    })
  })

  it('invalidates managed profile sections after an approval mutation', async () => {
    const queryClient = makeQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = makeWrapper(queryClient)
    const { result } = renderHook(() => useApproveRegistration(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        profileId: '30000000-0000-0000-0000-000000000001',
        role: 'cashier',
        stationIds: ['10000000-0000-0000-0000-000000000001'],
      })
    })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: managedProfilesQueryKey })
  })
})
