/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsumerRegistrationForm } from './consumer-registration-form'
import { RegistrationForm } from './registration-form'

const mocks = vi.hoisted(() => ({
  hcaptchaToken: { value: 'captcha-token' },
  hcaptchaError: { value: null as string | null },
  hcaptchaReset: vi.fn(),
  signUpWithPassword: vi.fn(),
  signUpConsumerWithPassword: vi.fn(),
  resendSignupConfirmationEmail: vi.fn(),
}))

const pendingTimeouts: Array<() => void> = []

vi.mock('@/shared/ui/hcaptcha', () => ({
  useHcaptchaToken: () => ({
    containerRef: { current: null },
    error: mocks.hcaptchaError.value,
    isLoading: false,
    reset: mocks.hcaptchaReset,
    token: mocks.hcaptchaToken.value,
  }),
}))

vi.mock('@/shared/api/auth', () => ({
  signUpWithPassword: mocks.signUpWithPassword,
  signUpConsumerWithPassword: mocks.signUpConsumerWithPassword,
  resendSignupConfirmationEmail: mocks.resendSignupConfirmationEmail,
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

  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return {
    promise,
    reject,
    resolve,
  }
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function advanceCooldown(seconds = 65) {
  for (let index = 0; index < seconds; index += 1) {
    for (let attempt = 0; pendingTimeouts.length === 0 && attempt < 5; attempt += 1) {
      await flushAsync()
    }

    const timeout = pendingTimeouts.shift()

    if (!timeout) {
      break
    }

    await act(async () => {
      timeout()
    })
    await flushAsync()
  }
}

function fillStaffRegistrationForm() {
  fireEvent.change(screen.getByLabelText('Фамилия'), { target: { value: 'Иванов' } })
  fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Иван' } })
  fireEvent.change(screen.getByLabelText('Отчество'), { target: { value: 'Иванович' } })
  fireEvent.change(screen.getByLabelText('Должность'), { target: { value: 'Оператор' } })
  fireEvent.change(screen.getByLabelText('Подпись'), { target: { value: 'Иванов И.' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'cashier@example.local' } })
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'password123' } })
  fireEvent.change(screen.getByLabelText('Повтор пароля'), { target: { value: 'password123' } })
}

function fillConsumerRegistrationForm() {
  fireEvent.change(screen.getByLabelText('Фамилия'), { target: { value: 'Петров' } })
  fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Петр' } })
  fireEvent.change(screen.getByLabelText('Отчество'), { target: { value: 'Петрович' } })
  fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+79990000000' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'resident@example.local' } })
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'password123' } })
  fireEvent.change(screen.getByLabelText('Повтор пароля'), { target: { value: 'password123' } })
}

describe.sequential('registration confirmation resend', () => {
  beforeEach(() => {
    pendingTimeouts.length = 0
    vi.spyOn(window, 'setTimeout').mockImplementation((handler) => {
      pendingTimeouts.push(() => {
        if (typeof handler === 'function') {
          handler()
        }
      })

      return pendingTimeouts.length
    })
    vi.spyOn(window, 'clearTimeout').mockImplementation(() => undefined)
    mocks.hcaptchaToken.value = 'captcha-token'
    mocks.hcaptchaError.value = null
    mocks.hcaptchaReset.mockReset()
    mocks.signUpWithPassword.mockReset()
    mocks.signUpConsumerWithPassword.mockReset()
    mocks.resendSignupConfirmationEmail.mockReset()
    mocks.signUpWithPassword.mockResolvedValue({ data: null, error: null })
    mocks.signUpConsumerWithPassword.mockResolvedValue({ data: null, error: null })
    mocks.resendSignupConfirmationEmail.mockResolvedValue({ data: true, error: null })
  })

  afterEach(() => {
    cleanup()
    pendingTimeouts.length = 0
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('disables the staff registration button while the request is pending', async () => {
    const deferred = createDeferred<{ data: null; error: null }>()
    mocks.signUpWithPassword.mockReturnValue(deferred.promise)

    renderWithQueryClient(<RegistrationForm />)
    fillStaffRegistrationForm()
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }))
    await flushAsync()

    expect(screen.getByRole('button', { name: /Отправляем/i })).toBeDisabled()

    deferred.resolve({ data: null, error: null })
    await flushAsync()
    expect(screen.getByText('Заявка отправлена')).toBeInTheDocument()
  })

  it('shows resend button after staff registration and starts a 60 second cooldown', async () => {
    renderWithQueryClient(<RegistrationForm />)
    fillStaffRegistrationForm()
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }))
    await flushAsync()

    expect(screen.getByText('Заявка отправлена')).toBeInTheDocument()
    const resendButton = screen.getByRole('button', { name: 'Повторно через 60 сек.' })
    expect(resendButton).toBeDisabled()

    await advanceCooldown()

    expect(screen.getByRole('button', { name: 'Отправить письмо повторно' })).toBeEnabled()
  }, 15_000)

  it('resends staff confirmation email and restarts cooldown', async () => {
    const deferred = createDeferred<{ data: true; error: null }>()
    mocks.resendSignupConfirmationEmail.mockReturnValue(deferred.promise)

    renderWithQueryClient(<RegistrationForm />)
    fillStaffRegistrationForm()
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }))
    await flushAsync()
    expect(screen.getByText('Заявка отправлена')).toBeInTheDocument()
    await advanceCooldown()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Отправить письмо повторно' }))
    })
    await flushAsync()

    expect(mocks.resendSignupConfirmationEmail).toHaveBeenCalledWith({
      email: 'cashier@example.local',
      captchaToken: 'captcha-token',
    })

    deferred.resolve({ data: true, error: null })
    await flushAsync()
    expect(screen.getByText('Письмо отправлено повторно.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторно через 60 сек.' })).toBeDisabled()
  }, 15_000)

  it('shows a rate limit message and cooldown for staff registration 429 errors', async () => {
    mocks.signUpWithPassword.mockResolvedValue({
      data: null,
      error: 'Too many requests',
      status: 429,
    })

    renderWithQueryClient(<RegistrationForm />)
    fillStaffRegistrationForm()
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }))
    await flushAsync()

    expect(
      screen.getByText('Слишком много запросов. Повторите отправку через 60 секунд.'),
    ).toBeInTheDocument()
  })

  it('shows resend button after consumer registration and handles resend 429 with cooldown', async () => {
    mocks.resendSignupConfirmationEmail.mockResolvedValue({
      data: null,
      error: 'Too many requests',
      status: 429,
    })

    renderWithQueryClient(<ConsumerRegistrationForm />)
    fillConsumerRegistrationForm()
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    await flushAsync()

    expect(screen.getByText('Регистрация отправлена')).toBeInTheDocument()
    await advanceCooldown()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Отправить письмо повторно' }))
    })
    await flushAsync()

    expect(
      screen.getByText('Слишком много запросов. Повторите отправку через 60 секунд.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторно через 60 сек.' })).toBeDisabled()
  })

  it('disables the consumer registration button while the request is pending', async () => {
    const deferred = createDeferred<{ data: null; error: null }>()
    mocks.signUpConsumerWithPassword.mockReturnValue(deferred.promise)

    renderWithQueryClient(<ConsumerRegistrationForm />)
    fillConsumerRegistrationForm()
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    await flushAsync()

    expect(screen.getByRole('button', { name: /Регистрируем/i })).toBeDisabled()

    deferred.resolve({ data: null, error: null })
    await flushAsync()
    expect(screen.getByText('Регистрация отправлена')).toBeInTheDocument()
  })
})
