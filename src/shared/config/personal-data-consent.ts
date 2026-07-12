export const PERSONAL_DATA_CONSENT_VERSION = '1.0'

export const PERSONAL_DATA_CONSENT_DOCUMENT_HASH =
  'personal-data-consent-v1-2026-07-12-sudak-admin'

export const PERSONAL_DATA_OPERATOR = {
  name: 'Администрация города Судака Республики Крым',
  ogrn: '1149102111817',
  inn: '9108009140',
  kpp: '910801001',
  address: '298000, Республика Крым, г. Судак, ул. Ленина, д. 85а',
  contactEmail: 'admin@sudakgs.rk.gov.ru',
  phone: '+7 (978) 538-82-12',
} as const

export const PERSONAL_DATA_CONSENT_STORAGE_KEY = 'fuelQueue.personalDataConsent.yandex'

export type PersonalDataConsentSource = 'email_password' | 'yandex_oauth'
export type PersonalDataConsentRegistrationRole = 'cashier' | 'mayor_assistant' | 'consumer'

export type PersonalDataConsentSnapshot = {
  accepted: true
  documentVersion: string
  documentHash: string
  acceptedAt: string
  source: PersonalDataConsentSource
  registrationRole: PersonalDataConsentRegistrationRole
  userAgent: string | null
}

export function createPersonalDataConsentSnapshot({
  registrationRole,
  source,
}: {
  registrationRole: PersonalDataConsentRegistrationRole
  source: PersonalDataConsentSource
}): PersonalDataConsentSnapshot {
  return {
    accepted: true,
    documentVersion: PERSONAL_DATA_CONSENT_VERSION,
    documentHash: PERSONAL_DATA_CONSENT_DOCUMENT_HASH,
    acceptedAt: new Date().toISOString(),
    source,
    registrationRole,
    userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
  }
}
