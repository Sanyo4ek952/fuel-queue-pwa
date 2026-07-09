import type {
  FuelPreferenceMode,
  FuelQueueCategory,
  FuelType,
  ReservationCallStatus,
} from '@/shared/constants'

import type { CallFilter } from './types'

export const fuelTypeLabels: Record<FuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
  OTHER: 'Другое',
}

export const fuelPreferenceLabels: Record<FuelPreferenceMode, string> = {
  EXACT: 'Только выбранная марка',
  ANY_GASOLINE: 'Подойдёт АИ-92/95/100',
}

export const categoryLabels: Record<FuelQueueCategory, string> = {
  GASOLINE: 'Бензин',
  DIESEL: 'Дизель',
  GAS: 'Газ',
}

const callFilterLabels: Record<CallFilter, string> = {
  call: 'Обзвон',
  all: 'Все',
  contacted: 'Позвонили',
  no_answer: 'Не дозвонились',
}

export const TODAY_ARRIVALS_LABEL = 'Сегодня приедут'

export function getCallFilterLabel(filter: CallFilter) {
  return filter === 'call' ? TODAY_ARRIVALS_LABEL : callFilterLabels[filter]
}

export const callStatusLabels: Record<ReservationCallStatus, string> = {
  NOT_CALLED: 'Не звонили',
  CONTACTED: 'Позвонили',
  NO_ANSWER: 'Не ответил',
}

export const callStatusBadgeClasses: Record<ReservationCallStatus, string> = {
  NOT_CALLED: 'border-slate-200 bg-slate-50 text-slate-500',
  CONTACTED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  NO_ANSWER: 'border-amber-200 bg-amber-50 text-amber-800',
}

export const callUnavailableReasonLabels: Record<string, string> = {
  VEHICLE_BLOCKED: 'Автомобиль заблокирован',
  ALREADY_FUELED: 'Автомобиль уже заправлен сегодня',
  ALREADY_CONTACTED: 'Приглашение уже подтверждено оператором',
  NO_OPEN_DAILY_LIMIT: 'Дневной лимит не открыт',
  NO_COMPATIBLE_FUEL: 'Нет подходящей марки топлива',
  OUTSIDE_TODAY_LIMIT: 'Запись пока вне текущего лимита',
  UNKNOWN_OFFLINE_STATUS: 'Нет свежего серверного статуса',
}

export const callStatusButtonClasses: Record<ReservationCallStatus, string> = {
  NOT_CALLED:
    'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700',
  CONTACTED:
    'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800',
  NO_ANSWER:
    'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900',
}
