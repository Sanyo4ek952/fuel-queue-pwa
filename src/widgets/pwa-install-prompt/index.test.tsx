/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BeforeInstallPromptEvent } from '@/shared/lib/pwa-install'

import { PwaInstallPrompt } from './index'

const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
const originalMaxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  'maxTouchPoints',
)
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'platform')
const originalStandaloneDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'standalone')
const originalUserAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent')

function restoreProperty(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor)
    return
  }

  delete (target as Record<string, unknown>)[property]
}

function setStandaloneDisplayMode(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches }) as MediaQueryList),
  })
}

function setNavigatorForPlatform({
  maxTouchPoints,
  platform,
  standalone,
  userAgent,
}: {
  maxTouchPoints: number
  platform: string
  standalone?: boolean
  userAgent: string
}) {
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: maxTouchPoints,
  })
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  })
  Object.defineProperty(window.navigator, 'standalone', {
    configurable: true,
    value: standalone,
  })
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  })
}

function dispatchBeforeInstallPrompt(prompt = vi.fn()) {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent
  event.prompt = prompt
  event.userChoice = Promise.resolve({ outcome: 'dismissed' })
  window.dispatchEvent(event)

  return prompt
}

describe('PwaInstallPrompt', () => {
  beforeEach(() => {
    localStorage.clear()
    setStandaloneDisplayMode(false)
    setNavigatorForPlatform({
      maxTouchPoints: 0,
      platform: 'Linux armv8l',
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36',
    })
  })

  afterEach(() => {
    cleanup()
    restoreProperty(window, 'matchMedia', originalMatchMediaDescriptor)
    restoreProperty(window.navigator, 'maxTouchPoints', originalMaxTouchPointsDescriptor)
    restoreProperty(window.navigator, 'platform', originalPlatformDescriptor)
    restoreProperty(window.navigator, 'standalone', originalStandaloneDescriptor)
    restoreProperty(window.navigator, 'userAgent', originalUserAgentDescriptor)
    vi.clearAllMocks()
  })

  it('does not render when the app is already installed', () => {
    setStandaloneDisplayMode(true)

    render(<PwaInstallPrompt />)

    expect(screen.queryByText('Скачайте приложение')).not.toBeInTheDocument()
  })

  it('renders iOS install instructions for an uninstalled app', async () => {
    setNavigatorForPlatform({
      maxTouchPoints: 1,
      platform: 'iPhone',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    })

    render(<PwaInstallPrompt />)

    expect(
      await screen.findByRole('dialog', { name: 'Скачайте приложение' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Нажмите «Поделиться», затем «На экран Домой».')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Скачать приложение' })).not.toBeInTheDocument()
  })

  it('calls the saved native install prompt from the install button', async () => {
    const prompt = vi.fn().mockResolvedValue({ outcome: 'dismissed' })
    const user = userEvent.setup()

    render(<PwaInstallPrompt />)
    dispatchBeforeInstallPrompt(prompt)

    await user.click(await screen.findByRole('button', { name: 'Скачать приложение' }))

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('snoozes after closing the prompt', async () => {
    const user = userEvent.setup()

    render(<PwaInstallPrompt />)
    dispatchBeforeInstallPrompt(vi.fn().mockResolvedValue({ outcome: 'dismissed' }))

    await user.click(await screen.findByRole('button', { name: 'Напомнить позже' }))

    expect(localStorage.getItem('azs:pwa-install-prompt:snoozed-until')).not.toBeNull()
    expect(screen.queryByText('Скачайте приложение')).not.toBeInTheDocument()
  })

  it('hides after appinstalled fires', async () => {
    render(<PwaInstallPrompt />)
    dispatchBeforeInstallPrompt(vi.fn().mockResolvedValue({ outcome: 'dismissed' }))

    expect(await screen.findByText('Скачайте приложение')).toBeInTheDocument()

    window.dispatchEvent(new Event('appinstalled'))

    await waitFor(() => {
      expect(screen.queryByText('Скачайте приложение')).not.toBeInTheDocument()
    })
  })
})
