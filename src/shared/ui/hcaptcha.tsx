import { useCallback, useEffect, useRef, useState } from 'react'

import { env, isHcaptchaConfigured } from '@/shared/config/env'

type Hcaptcha = {
  render: (
    container: string | HTMLElement,
    parameters: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
    },
  ) => string
  reset: (widgetId?: string) => void
}

declare global {
  interface Window {
    hcaptcha?: Hcaptcha
  }
}

const HCAPTCHA_SCRIPT_ID = 'hcaptcha-api'

let hcaptchaScriptPromise: Promise<void> | null = null

function loadHcaptchaScript() {
  if (!isHcaptchaConfigured) {
    return Promise.resolve()
  }

  if (window.hcaptcha) {
    return Promise.resolve()
  }

  if (hcaptchaScriptPromise) {
    return hcaptchaScriptPromise
  }

  hcaptchaScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(HCAPTCHA_SCRIPT_ID)

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve())
      existingScript.addEventListener('error', () => reject(new Error('Failed to load hCaptcha.')))
      return
    }

    const script = document.createElement('script')
    script.id = HCAPTCHA_SCRIPT_ID
    script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => reject(new Error('Failed to load hCaptcha.')))
    document.head.append(script)
  })

  return hcaptchaScriptPromise
}

export function useHcaptchaToken() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(
    isHcaptchaConfigured ? null : 'hCaptcha не настроена. Добавьте VITE_HCAPTCHA_SITE_KEY.',
  )
  const [isLoading, setIsLoading] = useState(isHcaptchaConfigured)
  const [token, setToken] = useState('')

  const reset = useCallback(() => {
    setToken('')

    if (widgetIdRef.current && window.hcaptcha) {
      window.hcaptcha.reset(widgetIdRef.current)
    }
  }, [])

  useEffect(() => {
    if (!isHcaptchaConfigured || !containerRef.current || widgetIdRef.current) {
      return
    }

    let isMounted = true
    setIsLoading(true)

    loadHcaptchaScript()
      .then(() => {
        if (!isMounted || !containerRef.current || !window.hcaptcha || widgetIdRef.current) {
          return
        }

        widgetIdRef.current = window.hcaptcha.render(containerRef.current, {
          sitekey: env.hcaptchaSiteKey,
          callback: (nextToken) => {
            setToken(nextToken)
            setError(null)
          },
          'expired-callback': () => {
            setToken('')
            setError('Подтвердите hCaptcha ещё раз.')
          },
          'error-callback': () => {
            setToken('')
            setError('Не удалось выполнить проверку hCaptcha. Обновите страницу и попробуйте снова.')
          },
        })
      })
      .catch(() => {
        if (isMounted) {
          setError('Не удалось загрузить hCaptcha. Обновите страницу и попробуйте снова.')
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  return {
    containerRef,
    error,
    isLoading,
    reset,
    token,
  }
}
