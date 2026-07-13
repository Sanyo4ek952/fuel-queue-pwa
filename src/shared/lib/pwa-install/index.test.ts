/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  getPwaInstallPromptMode,
  getPwaInstallPromptSnoozedUntil,
  isIosStandalone,
  isPwaInstalled,
  isPwaInstallPromptSnoozed,
  shouldShowPwaInstallPrompt,
  snoozePwaInstallPrompt,
} from './index'

function createStorage() {
  const values = new Map<string, string>()

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size
    },
  } satisfies Storage
}

function createMatchMedia(matches: boolean) {
  return () =>
    ({
      matches,
    }) as MediaQueryList
}

describe('pwa-install shared logic', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('detects installed PWA through standalone display mode', () => {
    expect(
      isPwaInstalled({
        windowRef: { matchMedia: createMatchMedia(true) },
        navigatorRef: { standalone: false } as unknown as Navigator,
      }),
    ).toBe(true)
  })

  it('detects iOS standalone mode through navigator.standalone', () => {
    expect(isIosStandalone({ standalone: true } as unknown as Navigator)).toBe(true)
    expect(
      isPwaInstalled({
        windowRef: { matchMedia: createMatchMedia(false) },
        navigatorRef: { standalone: true } as unknown as Navigator,
      }),
    ).toBe(true)
  })

  it('uses iOS instructions instead of a native prompt on iPhone', () => {
    expect(
      getPwaInstallPromptMode({
        hasNativePrompt: false,
        navigatorRef: {
          maxTouchPoints: 1,
          platform: 'iPhone',
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        },
      }),
    ).toBe('ios-instructions')
  })

  it('uses a native prompt only after beforeinstallprompt is available', () => {
    const navigatorRef = {
      maxTouchPoints: 0,
      platform: 'Linux armv8l',
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36',
    }

    expect(getPwaInstallPromptMode({ hasNativePrompt: false, navigatorRef })).toBeNull()
    expect(getPwaInstallPromptMode({ hasNativePrompt: true, navigatorRef })).toBe('native')
  })

  it('snoozes the prompt for seven days by default', () => {
    const storage = createStorage()
    const now = Date.parse('2026-07-13T00:00:00.000Z')

    snoozePwaInstallPrompt({ storage, now })

    expect(getPwaInstallPromptSnoozedUntil(storage)).toBe(
      Date.parse('2026-07-20T00:00:00.000Z'),
    )
    expect(isPwaInstallPromptSnoozed({ storage, now: now + 6 * 24 * 60 * 60 * 1000 })).toBe(
      true,
    )
    expect(isPwaInstallPromptSnoozed({ storage, now: now + 8 * 24 * 60 * 60 * 1000 })).toBe(
      false,
    )
  })

  it('does not show when installed, snoozed, or unsupported', () => {
    expect(
      shouldShowPwaInstallPrompt({
        installed: false,
        mode: 'native',
        snoozed: false,
      }),
    ).toBe(true)
    expect(
      shouldShowPwaInstallPrompt({
        installed: true,
        mode: 'native',
        snoozed: false,
      }),
    ).toBe(false)
    expect(
      shouldShowPwaInstallPrompt({
        installed: false,
        mode: 'native',
        snoozed: true,
      }),
    ).toBe(false)
    expect(
      shouldShowPwaInstallPrompt({
        installed: false,
        mode: null,
        snoozed: false,
      }),
    ).toBe(false)
  })
})
