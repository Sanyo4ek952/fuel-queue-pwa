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

export function normalizePlateNumber(value: string) {
  return value
    .replace(/[\s-]/g, '')
    .toUpperCase()
    .replace(/[ABEKMHOPCTYX]/g, (letter) => latinToCyrillicMap[letter] ?? letter)
}
