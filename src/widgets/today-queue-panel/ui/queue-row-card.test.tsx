/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { TodayQueueRow } from '@/entities/reservation'

import { QueueRowCard } from './queue-row-card'

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
  }
})

afterEach(() => {
  cleanup()
})

function makeQueueRow(overrides: Partial<TodayQueueRow> = {}): TodayQueueRow {
  return {
    id: 'reservation-id',
    date: null,
    station_id: null,
    station_name: null,
    station_address: null,
    vehicle_id: 'vehicle-id',
    driver_id: null,
    created_by_profile_id: 'profile-id',
    created_by_full_name: 'Мария Петрова',
    created_by_role: 'cashier',
    created_by_signature_name: 'Петрова М.',
    queue_number: 1,
    ticket_number: 1,
    current_position: 1,
    people_ahead: 0,
    normalized_plate_number: 'А123ВС777',
    driver_full_name: 'Иван Иванов',
    driver_phone: '+79990000000',
    fuel_type: 'AI_95',
    requested_liters: 40,
    status: 'RESERVED',
    sync_status: 'SYNCED',
    comment: null,
    client_mutation_id: null,
    is_offline: false,
    is_within_today_limit: true,
    latest_call_status: null,
    latest_called_by_profile_id: null,
    latest_called_by_full_name: '',
    latest_called_by_role: null,
    latest_called_by_signature_name: null,
    latest_called_at: null,
    latest_call_comment: null,
    latest_call_client_mutation_id: null,
    latest_call_sync_status: null,
    ...overrides,
  }
}

function renderCard(row = makeQueueRow()) {
  const onLogCall = vi.fn()
  const onUpdateFuelPreference = vi.fn()
  const onCancel = vi.fn()

  render(
    <QueueRowCard
      row={row}
      estimatedArrivalTime={null}
      isLoggingCall={false}
      isUpdatingFuelPreference={false}
      isFuelPreferenceUpdateUnavailable={false}
      isFuelPreferenceLockedByGasolineLimit={false}
      canCancel
      isCancelling={false}
      onLogCall={onLogCall}
      onUpdateFuelPreference={onUpdateFuelPreference}
      onCancel={onCancel}
    />,
  )

  return { onCancel, onLogCall, onUpdateFuelPreference }
}

describe('QueueRowCard', () => {
  it('logs contacted status from the quick call action', async () => {
    const row = makeQueueRow()
    const { onLogCall } = renderCard(row)

    await userEvent.click(screen.getByRole('button', { name: 'Дозвонились' }))

    expect(onLogCall).toHaveBeenCalledWith(row, 'CONTACTED')
  })

  it('disables mutation actions for offline rows', () => {
    renderCard(makeQueueRow({ is_offline: true }))

    expect(screen.getByRole('button', { name: 'Дозвонились' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Удалить из очереди' })).toBeDisabled()
  })

  it('shows current position separately from ticket number for diesel rows', async () => {
    renderCard(
      makeQueueRow({
        fuel_type: 'DIESEL',
        ticket_number: 10,
        current_position: 3,
        people_ahead: 2,
      }),
    )

    expect(screen.getByLabelText('Позиция в очереди топлива 3')).toBeInTheDocument()
    expect(screen.getByText('В очереди дизель: 3 · Талон №10')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Открыть детали' }))

    const article = screen.getByRole('article')

    expect(within(article).getByText('Позиция в очереди топлива')).toBeInTheDocument()
    expect(within(article).getByText('Номер талона')).toBeInTheDocument()
    expect(within(article).getByText('№10')).toBeInTheDocument()
  })

  it('shows assigned station name and address', async () => {
    renderCard(
      makeQueueRow({
        station_id: 'station-id',
        station_name: 'АЗС №1',
        station_address: 'Адрес 1',
      }),
    )

    expect(screen.getByText('АЗС №1')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Открыть детали' }))

    expect(screen.getByText('Адрес 1')).toBeInTheDocument()
  })

  it('shows station fallback when station will be selected at fueling', () => {
    renderCard()

    expect(screen.getByText('АЗС будет выбрана при заправке')).toBeInTheDocument()
  })

  it('cancels only the selected reservation row', async () => {
    const row = makeQueueRow({ id: 'diesel-reservation-id', ticket_number: 10 })
    const { onCancel } = renderCard(row)

    await userEvent.click(screen.getByRole('button', { name: 'Удалить из очереди' }))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledWith(row, {
      reason: 'OWNER_CANCELLED',
      comment: '',
    })
  })
})
