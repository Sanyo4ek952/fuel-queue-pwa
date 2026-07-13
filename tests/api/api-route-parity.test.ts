import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

function walkFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)

    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath]
  })
}

function getClientApiPaths() {
  const sourceFiles = walkFiles(path.join(process.cwd(), 'src')).filter((file) =>
    /\.(ts|tsx)$/.test(file),
  )
  const apiPaths = new Set<string>()

  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8')

    for (const match of source.matchAll(/["'`]((?:\/api\/)[A-Za-z0-9_./?=&%-]+)["'`]/g)) {
      apiPaths.add(match[1].split('?')[0])
    }
  }

  return apiPaths
}

function getVercelApiPaths() {
  const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')) as {
    rewrites?: Array<{ source?: string }>
  }
  const rewrites = new Set(
    (vercel.rewrites ?? [])
      .map((rewrite) => rewrite.source)
      .filter((source): source is string => Boolean(source?.startsWith('/api/'))),
  )
  const functionFiles = walkFiles(path.join(process.cwd(), 'api'))
    .filter((file) => /\.(ts|js)$/.test(file))
    .map((file) => {
      const relativePath = path.relative(path.join(process.cwd(), 'api'), file)
      const withoutExtension = relativePath.replace(/\.(ts|js)$/, '').replaceAll(path.sep, '/')

      return `/api/${withoutExtension}`
    })

  return new Set([...rewrites, ...functionFiles])
}

function getLocalApiPaths() {
  const config = fs.readFileSync(path.join(process.cwd(), 'vite.config.ts'), 'utf8')
  const routes = new Set<string>()

  for (const match of config.matchAll(/mountLocalApiHandler\([\s\S]*?["'](\/api\/[A-Za-z0-9_./-]+)["']/g)) {
    routes.add(match[1])
  }

  for (const match of config.matchAll(/\['([^']+)',\s*'Local/g)) {
    routes.add(`/api/${match[1]}`)
  }

  return routes
}

describe('client API route parity', () => {
  it('covers every client /api path in production and local Vite', () => {
    const clientApiPaths = [...getClientApiPaths()].sort()
    const vercelApiPaths = getVercelApiPaths()
    const localApiPaths = getLocalApiPaths()

    const missing = clientApiPaths
      .map((apiPath) => ({
        apiPath,
        inVercel: vercelApiPaths.has(apiPath),
        inLocal: localApiPaths.has(apiPath),
      }))
      .filter((route) => !route.inVercel || !route.inLocal)

    expect(missing).toEqual([])
  })
})
