/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ManagedProfile, ManagedProfilesSection } from '../model/use-managed-profiles'

const mocks = vi.hoisted(() => ({
  fetchNextPage: {
    pending: vi.fn(),
    active: vi.fn(),
    rejected: vi.fn(),
    disabled: vi.fn(),
  },
  useApproveRegistration: vi.fn(),
  useDeactivateProfile: vi.fn(),
  useManagedProfiles: vi.fn(),
  useRejectRegistration: vi.fn(),
  useCurrentProfile: vi.fn(),
}))

vi.mock('@/entities/profile', () => ({
  useCurrentProfile: mocks.useCurrentProfile,
}))

vi.mock('../model/use-managed-profiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model/use-managed-profiles')>()

  return {
    ...actual,
    useApproveRegistration: mocks.useApproveRegistration,
    useDeactivateProfile: mocks.useDeactivateProfile,
    useManagedProfiles: mocks.useManagedProfiles,
    useRejectRegistration: mocks.useRejectRegistration,
  }
})

import { UsersManagementPanel } from './users-management-panel'

function makeProfile(
  id: string,
  overrides: Partial<ManagedProfile> = {},
): ManagedProfile {
  return {
    id,
    auth_user_id: `${id}-auth`,
    email: null,
    full_name: `Сотрудник ${id}`,
    first_name: null,
    last_name: null,
    middle_name: null,
    phone: null,
    avatar_url: null,
    auth_provider: null,
    position: 'Оператор',
    signature_name: 'Оператор',
    role: 'cashier',
    is_active: true,
    approval_status: 'approved',
    requested_station_id: null,
    requested_station_name: 'АЗС #1',
    approved_by: null,
    approved_by_name: null,
    approved_at: null,
    rejected_by: null,
    rejected_by_name: null,
    rejected_at: null,
    rejection_reason: null,
    deactivated_by: null,
    deactivated_by_name: null,
    deactivated_at: null,
    deactivation_reason: null,
    personal_data_consent_version: null,
    personal_data_consented_at: null,
    created_at: '2026-07-13T08:00:00.000Z',
    updated_at: '2026-07-13T08:00:00.000Z',
    stations: [{ id: '10000000-0000-0000-0000-000000000001', name: 'АЗС #1', address: null }],
    ...overrides,
  }
}

function makeQuery(section: ManagedProfilesSection, profile: ManagedProfile, totalCount = 1) {
  return {
    data: {
      pages: [
        {
          items: [profile],
          totalCount,
          hasMore: totalCount > 1,
        },
      ],
    },
    error: null,
    fetchNextPage: mocks.fetchNextPage[section],
    hasNextPage: totalCount > 1,
    isError: false,
    isFetchingNextPage: false,
    isLoading: false,
  }
}

function setupQueries() {
  const queries = {
    pending: makeQuery(
      'pending',
      makeProfile('pending', { approval_status: 'pending', full_name: 'Новая заявка' }),
      11,
    ),
    active: makeQuery('active', makeProfile('active', { full_name: 'Действующий сотрудник' })),
    rejected: makeQuery(
      'rejected',
      makeProfile('rejected', {
        approval_status: 'rejected',
        full_name: 'Отклоненный сотрудник',
        rejection_reason: 'Нет документов',
      }),
    ),
    disabled: makeQuery(
      'disabled',
      makeProfile('disabled', {
        is_active: false,
        full_name: 'Отключенный сотрудник',
        deactivation_reason: 'Уволен',
      }),
    ),
  }

  mocks.useManagedProfiles.mockImplementation((section: ManagedProfilesSection) => queries[section])
}

describe('UsersManagementPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useCurrentProfile.mockReturnValue({
      data: {
        role: 'mayor',
        stations: [],
      },
    })
    mocks.useApproveRegistration.mockReturnValue({ error: null, isPending: false, mutate: vi.fn() })
    mocks.useDeactivateProfile.mockReturnValue({ error: null, isPending: false, mutate: vi.fn() })
    mocks.useRejectRegistration.mockReturnValue({ error: null, isPending: false, mutate: vi.fn() })
    setupQueries()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders independent sections and loads more only for the selected section', () => {
    render(<UsersManagementPanel />)

    expect(screen.getByText('Заявки на регистрацию')).toBeInTheDocument()
    expect(screen.getByText('Действующие сотрудники')).toBeInTheDocument()
    expect(screen.getAllByText('Отклоненные').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Отключенные').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Показать ещё/ }))

    expect(mocks.fetchNextPage.pending).toHaveBeenCalledTimes(1)
    expect(mocks.fetchNextPage.active).not.toHaveBeenCalled()
    expect(mocks.fetchNextPage.rejected).not.toHaveBeenCalled()
    expect(mocks.fetchNextPage.disabled).not.toHaveBeenCalled()
  })

  it('renders mobile cards with summary, details, and bottom actions', () => {
    render(<UsersManagementPanel />)

    const cards = screen.getByTestId('pending-mobile-cards')

    expect(within(cards).getByText('Новая заявка')).toBeInTheDocument()
    expect(within(cards).getByText('Ожидает')).toBeInTheDocument()
    expect(within(cards).getAllByText('Кассир АЗС').length).toBeGreaterThan(0)
    expect(within(cards).getByText('АЗС #1')).toBeInTheDocument()
    expect(within(cards).getByText('История и данные')).toBeInTheDocument()
    expect(within(cards).getByRole('button', { name: 'Одобрить' })).toBeInTheDocument()
    expect(within(cards).getByRole('button', { name: 'Отклонить' })).toBeInTheDocument()
  })

  it('opens desktop actions through a compact menu', () => {
    render(<UsersManagementPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Действия: Новая заявка' }))

    expect(screen.getByRole('button', { name: 'Одобрить' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeInTheDocument()
  })
})
