/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ROUTES } from '@/shared/config/routes'

import { SharePublicQueueCheckCard } from './share-public-queue-check-card'

function renderCard() {
  return render(
    <MemoryRouter>
      <SharePublicQueueCheckCard />
    </MemoryRouter>,
  )
}

describe('SharePublicQueueCheckCard', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    writeText.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText,
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows a public queue check link based on current origin', () => {
    const publicUrl = new URL(ROUTES.queueCheck, window.location.origin).toString()

    renderCard()

    expect(screen.getByRole('link', { name: publicUrl })).toHaveAttribute('href', publicUrl)
  })

  it('copies the public queue check link', async () => {
    const publicUrl = new URL(ROUTES.queueCheck, window.location.origin).toString()
    writeText.mockResolvedValue(undefined)

    renderCard()
    await userEvent.click(screen.getByRole('button', { name: /Скопировать/i }))

    expect(writeText).toHaveBeenCalledWith(publicUrl)
    expect(await screen.findByRole('button', { name: /Скопировано/i })).toBeInTheDocument()
  })

  it('shows a manual copy message when clipboard fails', async () => {
    writeText.mockRejectedValue(new Error('Clipboard unavailable'))

    renderCard()
    await userEvent.click(screen.getByRole('button', { name: /Скопировать/i }))

    expect(await screen.findByText('Не удалось скопировать')).toBeInTheDocument()
    expect(screen.getByText(/Скопируйте ссылку вручную/i)).toBeInTheDocument()
  })

  it('shows a placeholder when QR image is not available', async () => {
    renderCard()
    fireEvent.error(screen.getByAltText('QR-код публичной проверки номера'))

    await waitFor(() => {
      expect(screen.getByText('QR-код будет добавлен')).toBeInTheDocument()
    })
  })
})
