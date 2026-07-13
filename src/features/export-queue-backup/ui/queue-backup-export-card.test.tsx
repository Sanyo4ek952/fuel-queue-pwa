/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  mutationState: {
    isPending: false,
    error: null as Error | null,
    data: null as { fileName: string } | null,
  },
}))

vi.mock('../model/use-export-queue-backup', () => ({
  useExportQueueBackup: () => ({
    mutateAsync: mocks.mutateAsync,
    ...mocks.mutationState,
  }),
}))

import { QueueBackupExportCard } from './queue-backup-export-card'

describe('QueueBackupExportCard', () => {
  beforeEach(() => {
    mocks.mutateAsync.mockResolvedValue({ fileName: 'azs-queue-backup-all.csv' })
    mocks.mutationState.isPending = false
    mocks.mutationState.error = null
    mocks.mutationState.data = null
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('exports all waiting queue entries', async () => {
    render(<QueueBackupExportCard />)

    expect(screen.queryByLabelText('Дата')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Скачать очередь/i }))

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        targetDate: null,
      })
    })
  })
})
