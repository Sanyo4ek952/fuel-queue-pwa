import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()
const supabaseRoot = path.join(projectRoot, 'supabase')
const ignoredDirectories = new Set(['.branches', '.temp'])

const mojibakePattern =
  /(?:\u0420[\u0080-\u00bf\u0400-\u040f\u0450-\u045f\u2010-\u203a]|\u0421[\u0080-\u00bf\u0400-\u040f\u0450-\u045f\u2010-\u203a])/
const errors = []

const walkSqlFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue
    }

    const entryPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await walkSqlFiles(entryPath)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.sql')) {
      files.push(entryPath)
    }
  }

  return files
}

const toPosix = (value) => value.split(path.sep).join('/')

const sqlFiles = await walkSqlFiles(supabaseRoot)

for (const filePath of sqlFiles) {
  const content = await readFile(filePath, 'utf8')
  const lines = content.split(/\r?\n/)

  lines.forEach((line, index) => {
    if (mojibakePattern.test(line)) {
      errors.push(`${toPosix(path.relative(projectRoot, filePath))}:${index + 1}: ${line.trim()}`)
    }
  })
}

if (errors.length > 0) {
  console.error('SQL files contain likely mojibake text:')
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(`SQL encoding check passed (${sqlFiles.length} files).`)
