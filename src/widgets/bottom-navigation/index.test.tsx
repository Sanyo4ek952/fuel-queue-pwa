/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UserRole } from '@/shared/config/roles'

import { BottomNavigation } from './index'

const mocks = vi.hoisted(() => ({
  role: 'consumer' as UserRole,
}))

vi.mock('@/entities/profile', () => ({
  useCurrentProfile: () => ({
    data: {
      id: 'profile-id',
      full_name: 'Тестовый пользователь',
      role: mocks.role,
    },
  }),
}))

function renderBottomNavigation() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <BottomNavigation />
    </MemoryRouter>,
  )
}

describe('BottomNavigation', () => {
  beforeEach(() => {
    mocks.role = 'consumer'
  })

  afterEach(() => {
    cleanup()
  })

  it('hides the single dashboard item for consumers', () => {
    renderBottomNavigation()

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByText('Ещё')).not.toBeInTheDocument()
  })

  it('shows navigation for staff with multiple available items', () => {
    mocks.role = 'station_manager'

    renderBottomNavigation()

    expect(screen.getByRole('navigation')).toBeInTheDocument()
    expect(screen.getByText('Очередь')).toBeInTheDocument()
    expect(screen.getByText('Заправка')).toBeInTheDocument()
    expect(screen.getByText('Ещё')).toBeInTheDocument()
  })
})
