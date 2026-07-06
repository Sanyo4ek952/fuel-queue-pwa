const latinToCyrillicMap: Record<string, string> = {
  A: 'А',
  B: 'В',
  E: 'Е',
  K: 'К',
  M: 'М',
  H: 'Н',
  O: 'О',
  P: 'Р',
  C: 'С',
  T: 'Т',
  Y: 'У',
  X: 'Х',
}

export const PLATE_NUMBER_PATTERN = /^[АВЕКМНОРСТУХ][0-9]{3}[АВЕКМНОРСТУХ]{2}[0-9]{2,3}$/

export function normalizePlateNumber(value: string) {
  return value
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[ABEKMHOPCTYX]/g, (letter) => latinToCyrillicMap[letter] ?? letter)
    .replace(/[^0-9АВЕКМНОРСТУХ]/g, '')
}

export function formatPlateNumber(value: string) {
  const normalized = normalizePlateNumber(value)
  const letter = normalized.slice(0, 1)
  const digits = normalized.slice(1, 4)
  const letters = normalized.slice(4, 6)
  const region = normalized.slice(6, 9)

  return [letter, digits, letters, region].filter(Boolean).join(' ')
}

export function isValidPlateNumber(value: string) {
  return PLATE_NUMBER_PATTERN.test(normalizePlateNumber(value))
}
