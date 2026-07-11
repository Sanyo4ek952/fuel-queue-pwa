const consumerCabinetErrorMessages: Record<string, string> = {
  ACTIVE_RESERVATION_ALREADY_EXISTS: 'Этот автомобиль уже есть в очереди.',
  CONSUMER_ACTIVE_RESERVATION_ALREADY_EXISTS: 'У вас уже есть активная запись в очереди.',
  CONSUMER_VEHICLE_LIMIT_EXCEEDED: 'Можно добавить не более 3 автомобилей.',
  FORBIDDEN: 'Недостаточно прав для этого действия.',
  FUEL_PREFERENCE_LOCKED_BY_ACTIVE_FUELING:
    'Топливо нельзя изменить, пока идет заправка. Попробуйте позже.',
  FUEL_PREFERENCE_LOCKED_BY_ACTIVE_GASOLINE_LIMIT:
    'Топливо нельзя изменить, пока по бензину установлен ненулевой лимит.',
  FUEL_PREFERENCE_LOCKED_BY_OPEN_LIMIT:
    'Топливо нельзя изменить после открытия лимитов на сегодня.',
  INVALID_DRIVER: 'Укажите ФИО и телефон водителя.',
  INVALID_DRIVER_FULL_NAME: 'Введите ФИО водителя.',
  INVALID_DRIVER_PHONE: 'Введите телефон водителя.',
  INVALID_FUEL_PREFERENCE_MODE: 'Выберите корректное предпочтение по топливу.',
  INVALID_FUEL_TYPE: 'Выберите вид топлива.',
  INVALID_PLATE_NUMBER: 'Введите корректный госномер.',
  INVALID_REQUESTED_LITERS: 'Укажите литры больше нуля.',
  OFFLINE_UNAVAILABLE: 'Действие доступно только при подключении к интернету.',
  REFUEL_COOLDOWN_ACTIVE:
    'Для этого автомобиля еще действует ограничение после заправки.',
  RESERVATION_CANCEL_FORBIDDEN: 'Запись уже нельзя отменить самостоятельно.',
  RESERVATION_NOT_FOUND: 'Активная запись не найдена.',
  UPDATE_RESERVATION_FUEL_PREFERENCE_FAILED: 'Не удалось сохранить марку топлива.',
  VEHICLE_BLOCKED: 'Этот автомобиль заблокирован для записи.',
  VEHICLE_NOT_OWNED: 'Выберите один из своих автомобилей.',
}

const technicalMessagePatterns = [
  /^Unexpected /i,
  /^Supabase is not configured\.$/i,
  /^[A-Z0-9_]+$/,
  /failed to fetch/i,
  /load failed/i,
  /network/i,
]

function getRawMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return ''
}

function isNetworkError(message: string) {
  return /failed to fetch|load failed|network/i.test(message)
}

function isTechnicalMessage(message: string) {
  return technicalMessagePatterns.some((pattern) => pattern.test(message))
}

function hasCyrillicText(message: string) {
  return /[А-Яа-яЁё]/.test(message)
}

export function getConsumerCabinetErrorMessage(
  error: unknown,
  fallbackMessage = 'Не удалось выполнить действие. Попробуйте еще раз.',
) {
  const message = getRawMessage(error).trim()

  if (!message) {
    return fallbackMessage
  }

  if (isNetworkError(message)) {
    return 'Нет связи с сервером. Проверьте интернет и попробуйте снова.'
  }

  const knownMessage = consumerCabinetErrorMessages[message]

  if (knownMessage) {
    return knownMessage
  }

  if (isTechnicalMessage(message)) {
    return fallbackMessage
  }

  if (hasCyrillicText(message)) {
    return message
  }

  return fallbackMessage
}
