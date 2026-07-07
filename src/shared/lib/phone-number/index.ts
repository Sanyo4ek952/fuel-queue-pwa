const RU_COUNTRY_CODE = '7'
const RU_NATIONAL_DIGIT_COUNT = 10

export function extractPhoneDigits(value: string) {
  return value.replace(/\D/g, '')
}

function getRuNationalDigits(value: string, { truncate }: { truncate: boolean }) {
  const digits = extractPhoneDigits(value)
  const trimmedValue = value.trim()

  if (digits.length === 0) {
    return ''
  }

  if (
    (digits.startsWith(RU_COUNTRY_CODE) &&
      (digits.length > RU_NATIONAL_DIGIT_COUNT || trimmedValue.startsWith('+7'))) ||
    (digits.startsWith('8') && digits.length > RU_NATIONAL_DIGIT_COUNT)
  ) {
    const nationalDigits = digits.slice(1)

    return truncate ? nationalDigits.slice(0, RU_NATIONAL_DIGIT_COUNT) : nationalDigits
  }

  return truncate ? digits.slice(0, RU_NATIONAL_DIGIT_COUNT) : digits
}

export function normalizeRuPhoneNumber(value: string) {
  const nationalDigits = getRuNationalDigits(value, { truncate: false })

  return nationalDigits.length === RU_NATIONAL_DIGIT_COUNT
    ? `+${RU_COUNTRY_CODE}${nationalDigits}`
    : ''
}

export function formatRuPhoneNumber(value: string) {
  const nationalDigits = getRuNationalDigits(value, { truncate: true })
  const firstPart = nationalDigits.slice(0, 3)
  const secondPart = nationalDigits.slice(3, 6)
  const thirdPart = nationalDigits.slice(6, 8)
  const fourthPart = nationalDigits.slice(8, 10)

  let formatted = `+${RU_COUNTRY_CODE}`

  if (firstPart) {
    formatted += ` ${firstPart}`
  }

  if (secondPart) {
    formatted += ` ${secondPart}`
  }

  if (thirdPart) {
    formatted += `-${thirdPart}`
  }

  if (fourthPart) {
    formatted += `-${fourthPart}`
  }

  return formatted
}

export function isValidRuPhoneNumber(value: string) {
  return normalizeRuPhoneNumber(value).length === RU_NATIONAL_DIGIT_COUNT + 2
}
