import { describe, expect, it } from 'vitest'

import { getConsumerCabinetErrorMessage } from './consumer-cabinet-error'

describe('getConsumerCabinetErrorMessage', () => {
  it('translates known RPC error codes', () => {
    expect(getConsumerCabinetErrorMessage('INVALID_DRIVER')).toBe(
      'Укажите ФИО и телефон водителя.',
    )
  })

  it('explains active queue vehicle claim conflicts', () => {
    expect(getConsumerCabinetErrorMessage('VEHICLE_IN_ACTIVE_QUEUE')).toBe(
      'Этот номер уже стоит в очереди. Добавить его можно после заправки или выхода из очереди.',
    )
  })

  it('explains duplicate vehicle assignment conflicts', () => {
    expect(getConsumerCabinetErrorMessage('VEHICLE_ALREADY_ASSIGNED')).toBe(
      'Этот госномер уже добавлен другим жителем. Если это ваш номер, обратитесь в администрацию.',
    )
  })

  it('shows a clear network error message', () => {
    expect(getConsumerCabinetErrorMessage(new Error('Failed to fetch'))).toBe(
      'Нет связи с сервером. Проверьте интернет и попробуйте снова.',
    )
  })

  it('hides technical messages behind the provided fallback', () => {
    expect(
      getConsumerCabinetErrorMessage(
        'Unexpected get_my_today_fueling_status response.',
        'Не удалось загрузить сегодняшнюю заправку.',
      ),
    ).toBe('Не удалось загрузить сегодняшнюю заправку.')
  })

  it('keeps already readable Russian messages', () => {
    expect(getConsumerCabinetErrorMessage('Не удалось загрузить автомобили.')).toBe(
      'Не удалось загрузить автомобили.',
    )
  })
})
