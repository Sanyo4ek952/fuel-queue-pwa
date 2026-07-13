import { useCallback, useEffect, useMemo, useState } from 'react'

export type PwaInstallPromptMode = 'native' | 'ios-instructions'

export type BeforeInstallPromptChoice = {
  outcome: 'accepted' | 'dismissed'
  platform?: string
}

export type BeforeInstallPromptEvent = Event & {
  platforms?: string[]
  userChoice: Promise<BeforeInstallPromptChoice>
  prompt: () => Promise<BeforeInstallPromptChoice>
}

const pwaInstallPromptSnoozedUntilStorageKey = 'azs:pwa-install-prompt:snoozed-until'
const pwaInstallPromptSnoozeDays = 7
const dayMs = 24 * 60 * 60 * 1000

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean
}

export function isPwaStandalone(windowRef: Pick<Window, 'matchMedia'> = window) {
  return windowRef.matchMedia('(display-mode: standalone)').matches
}

export function isIosStandalone(navigatorRef: NavigatorWithStandalone = navigator) {
  return navigatorRef.standalone === true
}

export function isPwaInstalled({
  windowRef = window,
  navigatorRef = navigator,
}: {
  windowRef?: Pick<Window, 'matchMedia'>
  navigatorRef?: NavigatorWithStandalone
} = {}) {
  return isPwaStandalone(windowRef) || isIosStandalone(navigatorRef)
}

export function isIosDevice(navigatorRef: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator) {
  const userAgent = navigatorRef.userAgent

  return (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigatorRef.platform === 'MacIntel' && navigatorRef.maxTouchPoints > 1)
  )
}

export function getPwaInstallPromptMode({
  hasNativePrompt,
  navigatorRef = navigator,
}: {
  hasNativePrompt: boolean
  navigatorRef?: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>
}): PwaInstallPromptMode | null {
  if (isIosDevice(navigatorRef)) {
    return 'ios-instructions'
  }

  return hasNativePrompt ? 'native' : null
}

export function getPwaInstallPromptSnoozedUntil(storage: Storage = localStorage) {
  const rawValue = storage.getItem(pwaInstallPromptSnoozedUntilStorageKey)

  if (!rawValue) {
    return null
  }

  const value = Date.parse(rawValue)

  return Number.isNaN(value) ? null : value
}

export function isPwaInstallPromptSnoozed({
  storage = localStorage,
  now = Date.now(),
}: {
  storage?: Storage
  now?: number
} = {}) {
  const snoozedUntil = getPwaInstallPromptSnoozedUntil(storage)

  return snoozedUntil !== null && snoozedUntil > now
}

export function snoozePwaInstallPrompt({
  storage = localStorage,
  now = Date.now(),
  days = pwaInstallPromptSnoozeDays,
}: {
  storage?: Storage
  now?: number
  days?: number
} = {}) {
  const snoozedUntil = new Date(now + days * dayMs).toISOString()
  storage.setItem(pwaInstallPromptSnoozedUntilStorageKey, snoozedUntil)

  return snoozedUntil
}

export function shouldShowPwaInstallPrompt({
  installed,
  snoozed,
  mode,
}: {
  installed: boolean
  snoozed: boolean
  mode: PwaInstallPromptMode | null
}) {
  return !installed && !snoozed && mode !== null
}

export function usePwaInstallPrompt() {
  const [nativePrompt, setNativePrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(() =>
    typeof window === 'undefined' ? true : isPwaInstalled(),
  )
  const [snoozed, setSnoozed] = useState(() =>
    typeof window === 'undefined' ? true : isPwaInstallPromptSnoozed(),
  )

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setNativePrompt(event as BeforeInstallPromptEvent)
    }
    const handleAppInstalled = () => {
      setInstalled(true)
      setNativePrompt(null)
    }

    setInstalled(isPwaInstalled())
    setSnoozed(isPwaInstallPromptSnoozed())
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const mode = useMemo(
    () => getPwaInstallPromptMode({ hasNativePrompt: nativePrompt !== null }),
    [nativePrompt],
  )
  const isVisible = shouldShowPwaInstallPrompt({ installed, snoozed, mode })

  const install = useCallback(async () => {
    if (!nativePrompt) {
      return
    }

    const choice = await nativePrompt.prompt()
    setNativePrompt(null)

    if (choice.outcome === 'accepted') {
      setInstalled(true)
    }
  }, [nativePrompt])

  const snooze = useCallback(() => {
    snoozePwaInstallPrompt()
    setSnoozed(true)
  }, [])

  return {
    install,
    isVisible,
    mode,
    snooze,
  }
}
