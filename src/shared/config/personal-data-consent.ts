export const PERSONAL_DATA_CONSENT_VERSION = '2026-07-12'

export const PERSONAL_DATA_CONSENT_DOCUMENT_HASH =
  'personal-data-consent-2026-07-12-city-queue-v1'

export const PERSONAL_DATA_OPERATOR = {
  name: 'Администрация города / уполномоченный оператор очереди на топливо',
  address: 'Укажите официальный адрес оператора перед запуском публичной регистрации',
  contactEmail: 'Укажите официальный email оператора перед запуском публичной регистрации',
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

