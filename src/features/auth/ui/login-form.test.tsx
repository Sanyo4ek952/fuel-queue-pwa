/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LoginForm } from './login-form'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signInWithYandex: vi.fn(),
}))

vi.mock('@/shared/api/auth', () => ({
  signInWithPassword: mocks.signInWithPassword,
  signInWithYandex: mocks.signInWithYandex,
}))

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('LoginForm', () => {
  beforeEach(() => {
    mocks.signInWithPassword.mockReset()
    mocks.signInWithPassword.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    mocks.signInWithYandex.mockReset()
    mocks.signInWithYandex.mockResolvedValue({
      data: true,
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('starts Yandex ID login from the separate button', async () => {
    renderWithQueryClient(<LoginForm />)

    fireEvent.click(screen.getByLabelText(/Я согласен на обработку персональных данных/i))
    fireEvent.click(screen.getByRole('button', { name: /Яндекс ID/i }))

    await waitFor(() => expect(mocks.signInWithYandex).toHaveBeenCalledTimes(1))
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  it('does not start Yandex ID login without personal data consent', async () => {
    renderWithQueryClient(<LoginForm />)

    fireEvent.click(screen.getByRole('button', { name: /Яндекс ID/i }))

    expect(mocks.signInWithYandex).not.toHaveBeenCalled()
    expect(
      screen.getByText('Подтвердите согласие на обработку персональных данных.'),
    ).toBeInTheDocument()
  })

  it('keeps email login working', async () => {
    const onSuccess = vi.fn()

    renderWithQueryClient(<LoginForm onSuccess={onSuccess} />)
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'resident@example.local' },
    })
    fireEvent.change(screen.getByLabelText(/РџР°СЂРѕР»СЊ|Пароль/i), {
      target: { value: 'password123' },
    })
    const submitButton = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('type') === 'submit')

    expect(submitButton).toBeDefined()
    fireEvent.click(submitButton!)

    await waitFor(() =>
      expect(mocks.signInWithPassword).toHaveBeenCalledWith({
        email: 'resident@example.local',
        password: 'password123',
      }),
    )
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })
})
