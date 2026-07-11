const latinToCyrillicMap: Record<string, string> = {
  A: '\u0410',
  B: '\u0412',
  E: '\u0415',
  K: '\u041A',
  M: '\u041C',
  H: '\u041D',
  O: '\u041E',
  P: '\u0420',
  C: '\u0421',
  T: '\u0422',
  Y: '\u0423',
  X: '\u0425',
}

export const PLATE_NUMBER_PATTERN =
  /^[\u0410\u0412\u0415\u041A\u041C\u041D\u041E\u0420\u0421\u0422\u0423\u0425][0-9]{3}[\u0410\u0412\u0415\u041A\u041C\u041D\u041E\u0420\u0421\u0422\u0423\u0425]{2}[0-9]{2,3}$/

export function normalizePlateNumber(value: string) {
  return value
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[ABEKMHOPCTYX]/g, (letter) => latinToCyrillicMap[letter] ?? letter)
    .replace(/[^0-9\u0410\u0412\u0415\u041A\u041C\u041D\u041E\u0420\u0421\u0422\u0423\u0425]/g, '')
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
