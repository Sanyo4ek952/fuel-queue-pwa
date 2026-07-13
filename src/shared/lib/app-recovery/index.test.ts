/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearAppCaches } from './index'

const originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
const originalCachesDescriptor = Object.getOwnPropertyDescriptor(window, 'caches')

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

describe('clearAppCaches', () => {
  afterEach(() => {
    restoreProperty(navigator, 'serviceWorker', originalServiceWorkerDescriptor)
    restoreProperty(window, 'caches', originalCachesDescriptor)
  })

  it('unregisters service workers and deletes Cache Storage entries', async () => {
    const unregisterOne = vi.fn().mockResolvedValue(true)
    const unregisterTwo = vi.fn().mockResolvedValue(true)
    const deleteCache = vi.fn().mockResolvedValue(true)

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistrations: vi.fn().mockResolvedValue([
          { unregister: unregisterOne },
          { unregister: unregisterTwo },
        ]),
      },
    })
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: {
        keys: vi.fn().mockResolvedValue(['precache', 'runtime']),
        delete: deleteCache,
      },
    })

    await clearAppCaches()

    expect(unregisterOne).toHaveBeenCalledTimes(1)
    expect(unregisterTwo).toHaveBeenCalledTimes(1)
    expect(deleteCache).toHaveBeenCalledWith('precache')
    expect(deleteCache).toHaveBeenCalledWith('runtime')
  })
})
