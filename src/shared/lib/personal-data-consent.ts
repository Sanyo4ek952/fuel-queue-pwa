import {
  PERSONAL_DATA_CONSENT_STORAGE_KEY,
  type PersonalDataConsentSnapshot,
} from '@/shared/config/personal-data-consent'

function isConsentSnapshot(value: unknown): value is PersonalDataConsentSnapshot {
  if (!value || typeof value !== 'object') {
    return false
  }

  const snapshot = value as Partial<PersonalDataConsentSnapshot>

  return (
    snapshot.accepted === true &&
    typeof snapshot.documentVersion === 'string' &&
    typeof snapshot.documentHash === 'string' &&
    typeof snapshot.acceptedAt === 'string' &&
    typeof snapshot.source === 'string' &&
    typeof snapshot.registrationRole === 'string'
  )
}

export function savePendingYandexPersonalDataConsent(snapshot: PersonalDataConsentSnapshot) {
  localStorage.setItem(PERSONAL_DATA_CONSENT_STORAGE_KEY, JSON.stringify(snapshot))
}

export function readPendingYandexPersonalDataConsent(): PersonalDataConsentSnapshot | null {
  const rawValue = localStorage.getItem(PERSONAL_DATA_CONSENT_STORAGE_KEY)

  if (!rawValue) {
    return null
  }

  try {
    const value: unknown = JSON.parse(rawValue)

    return isConsentSnapshot(value) ? value : null
  } catch {
    return null
  }
}

export function clearPendingYandexPersonalDataConsent() {
  localStorage.removeItem(PERSONAL_DATA_CONSENT_STORAGE_KEY)
}

