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
}))

vi.mock('@/shared/api/rpc', () => ({
  createDailyLimit: mocks.createDailyLimit,
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

describe('CreateDailyLimitForm', () => {
  beforeEach(() => {
    mocks.createDailyLimit.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders the five fuel type limits', () => {
    renderWithQueryClient(<CreateDailyLimitForm />)

    expect(screen.getByText('АИ-92')).toBeInTheDocument()
    expect(screen.getByText('АИ-95')).toBeInTheDocument()
    expect(screen.getByText('АИ-100')).toBeInTheDocument()
    expect(screen.getByText('Дизель')).toBeInTheDocument()
    expect(screen.getByText('Газ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /сохранить лимит/i })).toBeEnabled()
  })

  it('submits default fuel type limit values', async () => {
    mocks.createDailyLimit.mockResolvedValue({
      data: {
        id: 'limit-id',
        date: '2026-07-05',
        station_id: null,
        status: 'OPEN',
        client_mutation_id: 'mutation-id',
        fuel_type_limits: [],
        category_limits: [],
      },
      error: null,
    })

    renderWithQueryClient(<CreateDailyLimitForm />)
    await userEvent.click(screen.getByRole('button', { name: /сохранить лимит/i }))

    await waitFor(() => {
      expect(mocks.createDailyLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          fuelTypeLimits: [
            expect.objectContaining({
              fuelType: 'AI_92',
              limitMode: 'fuel_liters',
              litersLimit: 0,
            }),
            expect.objectContaining({
              fuelType: 'AI_95',
              limitMode: 'fuel_liters',
              litersLimit: 400,
            }),
            expect.objectContaining({
              fuelType: 'AI_100',
              limitMode: 'fuel_liters',
              litersLimit: 0,
            }),
            expect.objectContaining({
              fuelType: 'DIESEL',
              limitMode: 'fuel_liters',
              litersLimit: 400,
            }),
            expect.objectContaining({
              fuelType: 'GAS',
              limitMode: 'fuel_liters',
              litersLimit: 400,
            }),
          ],
        }),
      )
    })
  })
})
