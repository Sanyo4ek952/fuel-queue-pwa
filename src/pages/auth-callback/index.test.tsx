/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CurrentProfile } from '@/shared/api/profile'

import { AuthCallbackPage } from './index'

const mocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
  signOut: vi.fn(),
  useCurrentProfile: vi.fn(),
}))

vi.mock('@/shared/api/auth', () => ({
  getAuthSession: mocks.getAuthSession,
  signOut: mocks.signOut,
}))

vi.mock('@/entities/profile', () => ({
  useCurrentProfile: mocks.useCurrentProfile,
}))

vi.mock('@/shared/api/profile', async () => {
  const actual = await vi.importActual<typeof import('@/shared/api/profile')>('@/shared/api/profile')

  return {
    ...actual,
    isConsumerProfileComplete: (
      profile: Pick<CurrentProfile, 'first_name' | 'last_name' | 'phone'>,
    ) => Boolean(profile.first_name?.trim() && profile.last_name?.trim() && profile.phone?.trim()),
  }
})

const consumerProfile: CurrentProfile = {
  id: 'profile-id',
  auth_user_id: 'auth-user-id',
  email: 'resident@example.local',
  full_name: 'Resident User',
  first_name: 'Resident',
  last_name: 'User',
  middle_name: null,
  phone: '+79990000000',
  avatar_url: null,
  auth_provider: 'custom:yandex',
  position: null,
  signature_name: null,
  role: 'consumer',
  is_active: true,
  approval_status: 'approved',
  requested_station_id: null,
  approved_by: null,
  approved_at: null,
  rejected_by: null,
  rejected_at: null,
  rejection_reason: null,
  deactivated_by: null,
  deactivated_at: null,
  deactivation_reason: null,
  stations: [],
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

function LoginProbe({ onState }: { onState: (state: unknown) => void }) {
  const location = useLocation()

  onState(location.state)

  return <div>login page</div>
}

function renderCallback({
  initialEntry = '/auth/callback',
  onLoginState = vi.fn(),
}: {
  initialEntry?: string
  onLoginState?: (state: unknown) => void
} = {}) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/login" element={<LoginProbe onState={onLoginState} />} />
          <Route path="/dashboard" element={<div>dashboard page</div>} />
          <Route path="/profile/setup" element={<div>profile setup page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    mocks.getAuthSession.mockReset()
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    mocks.signOut.mockReset()
    mocks.signOut.mockResolvedValue({
      data: true,
      error: null,
    })
    mocks.useCurrentProfile.mockReset()
    mocks.useCurrentProfile.mockReturnValue({
      data: consumerProfile,
      error: null,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('returns to login when OAuth reports a user cancellation', async () => {
    const onLoginState = vi.fn()

    renderCallback({
      initialEntry: '/auth/callback?error=access_denied&error_description=user_cancelled',
      onLoginState,
    })

    await screen.findByText('login page')
    expect(mocks.getAuthSession).not.toHaveBeenCalled()
    expect(onLoginState).toHaveBeenLastCalledWith({
      authError: 'Вход через Яндекс ID отменён.',
    })
  })

  it('returns to login when Supabase did not create a session', async () => {
    const onLoginState = vi.fn()

    mocks.getAuthSession.mockResolvedValue({
      data: null,
      error: null,
    })
    renderCallback({ onLoginState })

    await screen.findByText('login page')
    expect(onLoginState).toHaveBeenLastCalledWith({
      authError: 'Не удалось завершить вход через Яндекс ID. Попробуйте ещё раз.',
    })
  })

  it('returns to login when no server profile exists after OAuth', async () => {
    const onLoginState = vi.fn()

    mocks.useCurrentProfile.mockReturnValue({
      data: null,
      error: null,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    })
    renderCallback({ onLoginState })

    await screen.findByText('login page')
    expect(onLoginState).toHaveBeenLastCalledWith({
      authError: 'Профиль пользователя не найден после входа через Яндекс ID.',
    })
  })

  it('opens dashboard for an existing consumer with a complete profile', async () => {
    renderCallback()

    await screen.findByText('dashboard page')
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('opens profile setup for a new consumer with an incomplete profile', async () => {
    mocks.useCurrentProfile.mockReturnValue({
      data: {
        ...consumerProfile,
        first_name: null,
        phone: null,
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    })
    renderCallback()

    await screen.findByText('profile setup page')
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('signs out a staff profile linked to Yandex OAuth by email', async () => {
    const onLoginState = vi.fn()

    mocks.useCurrentProfile.mockReturnValue({
      data: {
        ...consumerProfile,
        role: 'cashier',
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    })
    renderCallback({ onLoginState })

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1))
    await screen.findByText('login page')
    expect(onLoginState).toHaveBeenLastCalledWith({
      authError: 'Яндекс ID доступен только жителям. Сотрудникам нужно входить через рабочий email.',
    })
  })
})
