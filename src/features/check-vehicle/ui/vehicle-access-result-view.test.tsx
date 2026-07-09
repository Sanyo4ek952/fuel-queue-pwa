/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { VehicleAccessResultView } from './vehicle-access-result-view'

describe('VehicleAccessResultView', () => {
  afterEach(() => {
    cleanup()
  })

  it('hides preferential queue name and shows desired fuel label', () => {
    render(
      <VehicleAccessResultView
        result={{
          status: 'ALLOWED',
          reason: 'PREFERENTIAL_QUEUE_ACTIVE',
          normalized_plate_number: 'А333АА333',
          preferential_queue_name: 'Врачи',
          fuel_category: 'GASOLINE',
          fuel_type: 'AI_95',
        }}
      />,
    )

    expect(screen.getByText('Льготная очередь')).toBeInTheDocument()
    expect(screen.queryByText('Врачи')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Машина есть в активной льготной очереди мэра.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Номер')).not.toBeInTheDocument()
    expect(screen.queryByText('А333АА333')).not.toBeInTheDocument()
    expect(screen.queryByText('Очередь')).not.toBeInTheDocument()
    expect(screen.queryByText('Бензин')).not.toBeInTheDocument()
    expect(screen.getByText('Желаемое топливо')).toBeInTheDocument()
    expect(screen.getByText('AI_95')).toBeInTheDocument()
  })

  it('shows matched fuel when it differs from the desired fuel', () => {
    render(
      <VehicleAccessResultView
        result={{
          status: 'ALLOWED',
          reason: 'ACTIVE_RESERVATION',
          normalized_plate_number: 'Рђ123Р’РЎ777',
          fuel_type: 'AI_95',
          matched_fuel_type: 'AI_92',
        }}
      />,
    )

    expect(screen.getAllByText('AI_95').length).toBeGreaterThan(0)
    expect(screen.getByText('AI_92')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Замена разрешена: желаемой марки нет в лимите, владелец разрешил бензин-замену.',
      ),
    ).toBeInTheDocument()
  })

  it('shows an instruction to use the desired fuel when it is available', () => {
    render(
      <VehicleAccessResultView
        result={{
          status: 'ALLOWED',
          reason: 'ACTIVE_RESERVATION',
          normalized_plate_number: 'А123ВС777',
          fuel_type: 'AI_95',
          matched_fuel_type: 'AI_95',
        }}
      />,
    )

    expect(
      screen.getByText('Заправить желаемую марку: АИ-95.'),
    ).toBeInTheDocument()
  })

  it('shows preferential queue name when it is explicitly allowed', () => {
    render(
      <VehicleAccessResultView
        canShowPreferentialQueueName
        result={{
          status: 'ALLOWED',
          reason: 'PREFERENTIAL_QUEUE_ACTIVE',
          normalized_plate_number: 'А333АА333',
          preferential_queue_name: 'Врачи',
          fuel_type: 'AI_95',
        }}
      />,
    )

    expect(screen.getByText('Врачи')).toBeInTheDocument()
    expect(
      screen.queryByText('Машина есть в активной льготной очереди мэра.'),
    ).not.toBeInTheDocument()
  })

  it('shows generic preferential queue label when the name is redacted by RPC', () => {
    render(
      <VehicleAccessResultView
        result={{
          status: 'ALLOWED',
          reason: 'PREFERENTIAL_QUEUE_ACTIVE',
          normalized_plate_number: 'А333АА333',
          preferential_queue_entry_id: 'entry-id',
          preferential_queue_id: 'queue-id',
          fuel_type: 'AI_95',
        }}
      />,
    )

    expect(screen.getByText('Льготная очередь')).toBeInTheDocument()
  })
})
