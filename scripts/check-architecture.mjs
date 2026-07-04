import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()
const srcRoot = path.join(projectRoot, 'src')

const orderedLayers = ['app', 'pages', 'widgets', 'features', 'entities', 'shared']
const layerRank = new Map(orderedLayers.map((layer, index) => [layer, index]))
const slicedLayers = new Set(['pages', 'widgets', 'features', 'entities'])

const sourceExtensions = new Set(['.ts', '.tsx'])
const importPattern =
  /(?:import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?|export\s+(?:type\s+)?[^'"]*?\s+from\s+)['"]([^'"]+)['"]/g

const errors = []

const toPosix = (value) => value.split(path.sep).join('/')

const isSourceFile = (filePath) =>
  sourceExtensions.has(path.extname(filePath)) && !filePath.endsWith('.d.ts')

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await walk(entryPath)))
      continue
    }

    if (entry.isFile() && isSourceFile(entryPath)) {
      files.push(entryPath)
    }
  }

  return files
}

const resolveAliasImport = (specifier) => {
  if (!specifier.startsWith('@/')) {
    return null
  }

  return specifier.slice(2).split('/').filter(Boolean)
}

const resolveRelativeImport = (filePath, specifier) => {
  if (!specifier.startsWith('.')) {
    return null
  }

  const resolvedPath = path.resolve(path.dirname(filePath), specifier)
  const relative = path.relative(srcRoot, resolvedPath)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }

  return toPosix(relative).split('/').filter(Boolean)
}

const getSourceInfo = (filePath) => {
  const relative = toPosix(path.relative(srcRoot, filePath))
  const parts = relative.split('/')
  const layer = parts[0]

  return {
    relative,
    layer: layerRank.has(layer) ? layer : null,
    slice: slicedLayers.has(layer) ? parts[1] : null,
  }
}

const addError = (file, specifier, message) => {
  errors.push(`${file}: ${message} (${specifier})`)
}

const checkLayerDirection = (source, targetParts, specifier) => {
  const targetLayer = targetParts[0]

  if (!source.layer || !layerRank.has(targetLayer)) {
    return
  }

  const sourceRank = layerRank.get(source.layer)
  const targetRank = layerRank.get(targetLayer)

  if (targetRank < sourceRank) {
    addError(
      source.relative,
      specifier,
      `FSD boundary violation: ${source.layer} cannot import upper layer ${targetLayer}`,
    )
  }
}

const checkPublicApi = (source, targetParts, specifier) => {
  const [targetLayer, targetSlice, nestedSegment] = targetParts

  if (!slicedLayers.has(targetLayer) || !targetSlice || !nestedSegment) {
    return
  }

  const sameSlice = source.layer === targetLayer && source.slice === targetSlice

  if (sameSlice) {
    return
  }

  addError(
    source.relative,
    specifier,
    `Public API violation: import ${targetLayer}/${targetSlice} through @/${targetLayer}/${targetSlice}`,
  )
}

const checkSupabaseAccess = (source, targetParts, specifier) => {
  const isSupabaseClientImport =
    targetParts[0] === 'shared' &&
    targetParts[1] === 'api' &&
    targetParts[2] === 'supabase'

  if (!isSupabaseClientImport) {
    return
  }

  const sourceIsSharedApi = source.relative.startsWith('shared/api/')

  if (!sourceIsSharedApi) {
    addError(
      source.relative,
      specifier,
      'Supabase boundary violation: use RPC wrappers or feature APIs instead of importing shared/api/supabase',
    )
  }
}

const checkFile = async (filePath) => {
  const source = getSourceInfo(filePath)
  const content = await readFile(filePath, 'utf8')
  const matches = content.matchAll(importPattern)

  for (const match of matches) {
    const specifier = match[1]
    const targetParts = resolveAliasImport(specifier) ?? resolveRelativeImport(filePath, specifier)

    if (!targetParts) {
      continue
    }

    checkLayerDirection(source, targetParts, specifier)
    checkPublicApi(source, targetParts, specifier)
    checkSupabaseAccess(source, targetParts, specifier)
  }
}

try {
  const files = await walk(srcRoot)

  for (const file of files) {
    await checkFile(file)
  }

  if (errors.length > 0) {
    console.error('Architecture check failed:')
    console.error(errors.map((error) => `- ${error}`).join('\n'))
    process.exit(1)
  }

  console.log(`Architecture check passed for ${files.length} source files.`)
} catch (error) {
  console.error('Architecture check could not run:')
  console.error(error)
  process.exit(1)
}
