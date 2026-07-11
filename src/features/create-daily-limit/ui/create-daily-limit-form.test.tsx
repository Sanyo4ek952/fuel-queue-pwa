/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateDailyLimitForm } from './create-daily-limit-form'

const mocks = vi.hoisted(() => ({
  createDailyLimit: vi.fn(),
  stations: [
    {
      id: 'station-id',
      name: 'АЗС №1',
      address: 'Адрес 1',
    },
  ],
}))

vi.mock('@/shared/api/rpc', () => ({
  createDailyLimit: mocks.createDailyLimit,
}))

vi.mock('@/entities/profile', () => ({
  useCurrentProfile: () => ({
    data: {
      stations: mocks.stations,
    },
  }),
}))

vi.mock('@/entities/reservation', () => ({
  todayQueueQueryKey: () => ['today-queue'],
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
  const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

  return {
    ...render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>),
    invalidateQueriesSpy,
  }
}

function mockSuccessfulDailyLimit(stationId = 'station-id') {
  mocks.createDailyLimit.mockResolvedValue({
    data: {
      id: 'limit-id',
      date: '2026-07-05',
      station_id: stationId,
      status: 'OPEN',
      client_mutation_id: 'mutation-id',
      fuel_type_limits: [],
      category_limits: [],
    },
    error: null,
  })
}

describe('CreateDailyLimitForm', () => {
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

    mocks.createDailyLimit.mockReset()
    mocks.stations = [
      {
        id: 'station-id',
        name: 'АЗС №1',
        address: 'Адрес 1',
      },
    ]
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders the five fuel type limits with separate save buttons', () => {
    renderWithQueryClient(<CreateDailyLimitForm />)

    expect(screen.getByText('АИ-92')).toBeInTheDocument()
    expect(screen.getByText('АИ-95')).toBeInTheDocument()
    expect(screen.getByText('АИ-100')).toBeInTheDocument()
    expect(screen.getByText('Дизель')).toBeInTheDocument()
    expect(screen.getByText('Газ')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Сохранить / })).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /Сохранить лимит/i })).not.toBeInTheDocument()
  })

  it('submits only the selected fuel type limit', async () => {
    mockSuccessfulDailyLimit()

    const { invalidateQueriesSpy } = renderWithQueryClient(<CreateDailyLimitForm />)
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить АИ-95' }))

    await waitFor(() => {
      expect(mocks.createDailyLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          fuelTypeLimits: [
            expect.objectContaining({
              fuelType: 'AI_95',
              status: 'OPEN',
              vehicleLimit: 20,
              litersLimit: 400,
            }),
          ],
          stationId: 'station-id',
        }),
      )
    })

    expect(mocks.createDailyLimit.mock.calls[0][0].fuelTypeLimits).toHaveLength(1)
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['today-queue'] })
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      predicate: expect.any(Function),
    })
  })

  it.each([
    ['АЗС №2', 'station-2'],
    ['АЗС №3', 'station-3'],
  ])('submits the selected station %s', async (stationName, stationId) => {
    mocks.stations = [
      { id: 'station-1', name: 'АЗС №1', address: 'Адрес 1' },
      { id: 'station-2', name: 'АЗС №2', address: 'Адрес 2' },
      { id: 'station-3', name: 'АЗС №3', address: 'Адрес 3' },
    ]
    mockSuccessfulDailyLimit(stationId)

    renderWithQueryClient(<CreateDailyLimitForm />)
    await userEvent.click(screen.getByLabelText('АЗС'))
    await userEvent.click(await screen.findByRole('option', { name: stationName }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить АИ-95' }))

    await waitFor(() => {
      expect(mocks.createDailyLimit).toHaveBeenCalledWith(
        expect.objectContaining({ stationId }),
      )
    })
  })

  it('shows an error when the server returns another station', async () => {
    mocks.stations = [
      { id: 'station-1', name: 'АЗС №1', address: 'Адрес 1' },
      { id: 'station-2', name: 'АЗС №2', address: 'Адрес 2' },
    ]
    mockSuccessfulDailyLimit('station-1')

    renderWithQueryClient(<CreateDailyLimitForm />)
    await userEvent.click(screen.getByLabelText('АЗС'))
    await userEvent.click(await screen.findByRole('option', { name: 'АЗС №2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить АИ-95' }))

    expect(
      await screen.findByText(
        'Сервер сохранил лимит для другой АЗС. Обновите страницу и повторите попытку.',
      ),
    ).toBeInTheDocument()
  })

  it('does not submit changed values from other fuel types', async () => {
    mockSuccessfulDailyLimit()

    renderWithQueryClient(<CreateDailyLimitForm />)
    const ai92Input = document.querySelector<HTMLInputElement>('#litersLimit-AI_92')

    expect(ai92Input).not.toBeNull()
    await userEvent.clear(ai92Input!)
    await userEvent.type(ai92Input!, '123')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить АИ-95' }))

    await waitFor(() => {
      expect(mocks.createDailyLimit).toHaveBeenCalledOnce()
    })

    expect(mocks.createDailyLimit.mock.calls[0][0].fuelTypeLimits).toEqual([
      expect.objectContaining({
        fuelType: 'AI_95',
        litersLimit: 400,
      }),
    ])
  })

  it('validates the date and selected fuel type before submitting', async () => {
    mockSuccessfulDailyLimit()

    renderWithQueryClient(<CreateDailyLimitForm />)
    await userEvent.clear(screen.getByLabelText('Дата'))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить АИ-95' }))

    expect(mocks.createDailyLimit).not.toHaveBeenCalled()
    expect(await screen.findByText('Выберите дату')).toBeInTheDocument()
  })

  it('does not submit without a selected station', async () => {
    mocks.stations = []
    mockSuccessfulDailyLimit()

    renderWithQueryClient(<CreateDailyLimitForm />)
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить АИ-95' }))

    expect(mocks.createDailyLimit).not.toHaveBeenCalled()
    expect(await screen.findByText('Выберите АЗС')).toBeInTheDocument()
  })
})
