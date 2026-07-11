/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FuelingScheduleSettingsCard } from './fueling-schedule-settings-card'

const stationOne = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'АЗС №1',
  address: 'Адрес 1',
}

const stationTwo = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'АЗС №2',
  address: 'Адрес 2',
}

const mocks = vi.hoisted(() => ({
  getDailyFuelingSchedule: vi.fn(),
  setDailyFuelingSchedule: vi.fn(),
  stations: [] as Array<{ id: string; name: string; address: string | null }>,
}))

vi.mock('@/entities/profile', () => ({
  useCurrentProfile: () => ({
    data: {
      stations: mocks.stations,
    },
  }),
}))

vi.mock('@/shared/lib/sync', () => ({
  useOnlineStatus: () => true,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  getCachedDailyFuelingSchedule: vi.fn(),
}))

vi.mock('@/shared/api/rpc', () => ({
  getDailyFuelingSchedule: mocks.getDailyFuelingSchedule,
  setDailyFuelingSchedule: mocks.setDailyFuelingSchedule,
}))

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
      },
    },
  })

  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
}

function mockSchedule(stationId: string, gasolineStartTime = '13:00') {
  return [
    {
      id: `${stationId}-gasoline`,
      date: '2026-07-11',
      station_id: stationId,
      fuel_category: 'GASOLINE',
      start_time: gasolineStartTime,
      interval_minutes: 5,
      vehicles_per_interval: 5,
      updated_at: null,
      client_mutation_id: null,
    },
  ]
}

describe('FuelingScheduleSettingsCard', () => {
  beforeEach(() => {
    if (!Element.prototype.hasPointerCapture) {
      Element.prototype.hasPointerCapture = () => false
    }

    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = () => undefined
    }

    if (!Element.prototype.releasePointerCapture) {
      Element.prototype.releasePointerCapture = () => undefined
    }

    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => undefined
    }

    vi.stubGlobal('crypto', {
      randomUUID: () => '00000000-0000-4000-8000-000000000099',
    })

    mocks.getDailyFuelingSchedule.mockReset()
    mocks.setDailyFuelingSchedule.mockReset()
    mocks.getDailyFuelingSchedule.mockResolvedValue({
      data: [],
      error: null,
    })
    mocks.setDailyFuelingSchedule.mockResolvedValue({
      data: [],
      error: null,
    })
    mocks.stations = [stationOne]
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('saves with the only profile station when the station select is hidden', async () => {
    renderWithQueryClient(<FuelingScheduleSettingsCard canEdit />)

    expect(screen.queryByLabelText('АЗС')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Сохранить расписание/i })).toBeEnabled()
    })

    await userEvent.click(screen.getByRole('button', { name: /Сохранить расписание/i }))

    await waitFor(() => {
      expect(mocks.setDailyFuelingSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          stationId: stationOne.id,
        }),
      )
    })
    expect(screen.queryByText('Выберите АЗС')).not.toBeInTheDocument()
  })

  it('keeps the selected station while loaded schedule data resets schedule fields', async () => {
    mocks.stations = [stationOne, stationTwo]
    mocks.getDailyFuelingSchedule.mockImplementation(async (_targetDate: string, stationId: string) => ({
      data: mockSchedule(stationId, stationId === stationTwo.id ? '14:00' : '13:00'),
      error: null,
    }))

    renderWithQueryClient(<FuelingScheduleSettingsCard canEdit />)

    await userEvent.click(screen.getByLabelText('АЗС'))
    await userEvent.click(await screen.findByRole('option', { name: 'АЗС №2' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('14:00')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /Сохранить расписание/i }))

    await waitFor(() => {
      expect(mocks.setDailyFuelingSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          stationId: stationTwo.id,
        }),
      )
    })
  })
})
