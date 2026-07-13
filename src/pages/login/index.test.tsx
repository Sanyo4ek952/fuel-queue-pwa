/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ROUTES } from '@/shared/config/routes'

import { LoginPage } from './index'

vi.mock('@/features/auth', () => ({
  ConsumerRegistrationForm: () => <div>consumer registration form</div>,
  LoginForm: () => <div>login form</div>,
  RegistrationForm: () => <div>registration form</div>,
}))

describe('LoginPage', () => {
  afterEach(() => {
    cleanup()
  })

  it('links to public queue check without login', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Проверить очередь без входа' })).toHaveAttribute(
      'href',
      ROUTES.queueCheck,
    )
  })
})
